use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::BTreeMap;
use std::env;
use std::fs;
use std::io::{self, BufRead, Read, Write};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use wait_timeout::ChildExt;
use x11rb::connection::Connection;
use x11rb::protocol::Event;
use x11rb::protocol::xinput::{ConnectionExt as _, EventMask, XIEventMask};

const COMMAND_TIMEOUT: Duration = Duration::from_millis(2500);
const MAX_OUTPUT: usize = 128 * 1024;

#[derive(Deserialize)]
struct Request {
    id: Value,
    method: String,
    #[serde(default)]
    params: Value,
}

#[derive(Serialize)]
struct Response {
    id: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

#[derive(Deserialize)]
struct Candidate {
    command: Option<String>,
    #[serde(default)]
    args: Vec<String>,
    expect: Option<String>,
    operation: Option<String>,
    delta: Option<i32>,
}

struct X11Listener {
    id: u64,
    stop: Arc<AtomicBool>,
    thread: std::thread::JoinHandle<()>,
}

#[derive(Default)]
struct AppState {
    x11_listener: Option<X11Listener>,
}

fn main() {
    let stdin = io::stdin();
    let output = Arc::new(Mutex::new(io::stdout()));
    let mut state = AppState::default();

    for line in stdin.lock().lines() {
        let response = match line {
            Ok(line) => handle_line_with_state(&line, &mut state, &output),
            Err(error) => Response {
                id: Value::Null,
                result: None,
                error: Some(error.to_string()),
            },
        };
        if write_message(&output, &response).is_err() {
            break;
        }
    }
    stop_x11_listener(&mut state);
}

fn handle_line_with_state(
    line: &str,
    state: &mut AppState,
    output: &Arc<Mutex<io::Stdout>>,
) -> Response {
    let request: Request = match serde_json::from_str(line) {
        Ok(request) => request,
        Err(error) => {
            return Response {
                id: Value::Null,
                result: None,
                error: Some(format!("invalid request: {error}")),
            };
        }
    };
    let result = match request.method.as_str() {
        "ping" => Ok(json!({
            "version": env!("CARGO_PKG_VERSION"),
            "capabilities": ["listener-scoped-stop"]
        })),
        "environment" => Ok(environment()),
        "probe_tools" => probe_tools(&request.params),
        "run_candidates" => run_candidates(&request.params),
        "start_x11_wheel" => start_x11_listener(state, Arc::clone(output), &request.params),
        "stop_x11_wheel" => {
            // Late cleanup from an older client must not stop a newer listener.
            let matches = match request.params.get("listenerId") {
                None => true,
                Some(id) => state
                    .x11_listener
                    .as_ref()
                    .is_some_and(|listener| id.as_u64() == Some(listener.id)),
            };
            if matches {
                stop_x11_listener(state);
            }
            Ok(json!({ "stopped": matches }))
        }
        _ => Err(format!("unknown method: {}", request.method)),
    };
    match result {
        Ok(value) => Response {
            id: request.id,
            result: Some(value),
            error: None,
        },
        Err(error) => Response {
            id: request.id,
            result: None,
            error: Some(error),
        },
    }
}

#[cfg(test)]
fn handle_line(line: &str) -> Response {
    let output = Arc::new(Mutex::new(io::stdout()));
    handle_line_with_state(line, &mut AppState::default(), &output)
}

fn write_message(output: &Arc<Mutex<io::Stdout>>, value: &impl Serialize) -> io::Result<()> {
    let mut stdout = output
        .lock()
        .map_err(|_| io::Error::other("stdout lock poisoned"))?;
    serde_json::to_writer(&mut *stdout, value)?;
    writeln!(stdout)?;
    stdout.flush()
}

fn start_x11_listener(
    state: &mut AppState,
    output: Arc<Mutex<io::Stdout>>,
    params: &Value,
) -> Result<Value, String> {
    let listener_id = params
        .get("listenerId")
        .and_then(Value::as_u64)
        .ok_or("params.listenerId must be an integer")?;
    if let Some(listener) = &state.x11_listener {
        if listener.id == listener_id {
            return Ok(json!({ "started": true }));
        }
        return Err("another XInput2 listener is still active".into());
    }
    let (ready_tx, ready_rx) = mpsc::channel();
    let stop = Arc::new(AtomicBool::new(false));
    let thread_stop = Arc::clone(&stop);
    let thread =
        std::thread::spawn(move || x11_wheel_loop(thread_stop, output, ready_tx, listener_id));
    match ready_rx.recv_timeout(Duration::from_secs(2)) {
        Ok(Ok(())) => {
            state.x11_listener = Some(X11Listener {
                id: listener_id,
                stop,
                thread,
            });
            Ok(json!({ "started": true }))
        }
        Ok(Err(error)) => {
            let _ = thread.join();
            Err(error)
        }
        Err(_) => {
            stop.store(true, Ordering::Relaxed);
            Err("XInput2 listener startup timed out".into())
        }
    }
}

fn stop_x11_listener(state: &mut AppState) {
    if let Some(listener) = state.x11_listener.take() {
        listener.stop.store(true, Ordering::Relaxed);
        let _ = listener.thread.join();
    }
}

fn x11_wheel_loop(
    stop: Arc<AtomicBool>,
    output: Arc<Mutex<io::Stdout>>,
    ready: mpsc::Sender<Result<(), String>>,
    listener_id: u64,
) {
    let result = (|| -> Result<(), String> {
        let (connection, screen_number) =
            x11rb::connect(None).map_err(|error| error.to_string())?;
        connection
            .xinput_xi_query_version(2, 0)
            .map_err(|error| error.to_string())?
            .reply()
            .map_err(|error| error.to_string())?;
        let root = connection.setup().roots[screen_number].root;
        connection
            .xinput_xi_select_events(
                root,
                &[EventMask {
                    // XIAllMasterDevices avoids duplicate slave/master delivery.
                    deviceid: 1,
                    mask: vec![XIEventMask::RAW_BUTTON_PRESS],
                }],
            )
            .map_err(|error| error.to_string())?
            .check()
            .map_err(|error| error.to_string())?;
        connection.flush().map_err(|error| error.to_string())?;
        let _ = ready.send(Ok(()));

        while !stop.load(Ordering::Relaxed) {
            match connection
                .poll_for_event()
                .map_err(|error| error.to_string())?
            {
                Some(Event::XinputRawButtonPress(event)) => {
                    let direction = match event.detail {
                        4 => Some("up"),
                        5 => Some("down"),
                        _ => None,
                    };
                    if let Some(direction) = direction {
                        let notification = json!({
                            "event": "wheel",
                            "payload": { "direction": direction, "listenerId": listener_id }
                        });
                        if write_message(&output, &notification).is_err() {
                            break;
                        }
                    }
                }
                Some(_) | None => std::thread::sleep(Duration::from_millis(5)),
            }
        }
        Ok(())
    })();
    if let Err(error) = result {
        let _ = ready.send(Err(error.clone()));
        let _ = write_message(
            &output,
            &json!({
                "event": "x11-wheel-error",
                "payload": { "error": error, "listenerId": listener_id }
            }),
        );
    }
}

fn environment() -> Value {
    let session_type = normalize_session_type();
    let desktop = normalize_desktop();
    json!({
        "sessionType": session_type,
        "desktop": desktop,
        "isWayland": session_type == "wayland",
        "raw": {
            "sessionType": env::var("XDG_SESSION_TYPE").unwrap_or_default(),
            "currentDesktop": env::var("XDG_CURRENT_DESKTOP").unwrap_or_default()
        }
    })
}

fn normalize_session_type() -> String {
    let explicit = env::var("XDG_SESSION_TYPE")
        .unwrap_or_default()
        .to_lowercase();
    if explicit == "wayland" || explicit == "x11" {
        return explicit;
    }
    if env_nonempty("WAYLAND_DISPLAY") {
        return "wayland".into();
    }
    if env_nonempty("DISPLAY") {
        return "x11".into();
    }
    "unknown".into()
}

fn normalize_desktop() -> &'static str {
    if env_nonempty("HYPRLAND_INSTANCE_SIGNATURE") {
        return "hyprland";
    }
    if env_nonempty("SWAYSOCK") {
        return "sway";
    }
    let sources = [
        "XDG_CURRENT_DESKTOP",
        "XDG_SESSION_DESKTOP",
        "DESKTOP_SESSION",
    ]
    .map(|key| env::var(key).unwrap_or_default());
    desktop_family(&sources)
}

fn desktop_family(sources: &[String]) -> &'static str {
    // Keep precedence aligned with src/main/desktop-env.js: current desktop
    // wins over legacy session labels, and specific variants win over Ubuntu.
    let families = [
        ("hyprland", "hyprland"),
        ("sway", "sway"),
        ("kde", "kde"),
        ("plasma", "kde"),
        ("kubuntu", "kde"),
        ("cinnamon", "cinnamon"),
        ("x-cinnamon", "cinnamon"),
        ("xfce", "xfce"),
        ("xubuntu", "xfce"),
        ("mate", "mate"),
        ("lxqt", "lxqt"),
        ("lxde", "lxde"),
        ("lubuntu", "lxqt"),
        ("budgie", "budgie"),
        ("cosmic", "cosmic"),
        ("deepin", "deepin"),
        ("dde", "deepin"),
        ("gnome", "gnome"),
        ("unity", "gnome"),
        ("pantheon", "gnome"),
        ("ubuntu", "gnome"),
    ];
    for source in sources {
        let names = source.to_lowercase();
        for (needle, family) in families {
            if names.contains(needle) {
                return family;
            }
        }
    }
    "unknown"
}

fn env_nonempty(key: &str) -> bool {
    env::var_os(key).is_some_and(|value| !value.is_empty())
}

fn probe_tools(params: &Value) -> Result<Value, String> {
    let tools = params
        .get("tools")
        .and_then(Value::as_array)
        .ok_or("params.tools must be an array")?;
    let availability: BTreeMap<String, bool> = tools
        .iter()
        .map(|tool| {
            let name = tool.as_str().unwrap_or_default().to_string();
            let found = !name.is_empty() && executable_on_path(&name);
            (name, found)
        })
        .collect();
    serde_json::to_value(availability).map_err(|error| error.to_string())
}

fn executable_on_path(command: &str) -> bool {
    env::var_os("PATH").is_some_and(|path| {
        env::split_paths(&path).any(|directory| {
            let file: PathBuf = directory.join(command);
            fs::metadata(file).is_ok_and(|metadata| {
                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    metadata.is_file() && metadata.permissions().mode() & 0o111 != 0
                }
                #[cfg(not(unix))]
                {
                    metadata.is_file()
                }
            })
        })
    })
}

fn run_candidates(params: &Value) -> Result<Value, String> {
    let values = params
        .get("candidates")
        .and_then(Value::as_array)
        .ok_or("params.candidates must be an array")?;
    if values.is_empty() || values.len() > 6 {
        return Err("params.candidates must contain 1 to 6 entries".into());
    }
    let candidates: Vec<Candidate> = values
        .iter()
        .map(|value| serde_json::from_value(value.clone()).map_err(|error| error.to_string()))
        .collect::<Result<_, _>>()?;
    let mut last_error = command_error("COMMAND_FAILED", "no command candidates");
    for candidate in candidates {
        match run_candidate(candidate) {
            Ok(()) => return Ok(json!({ "ok": true })),
            Err(error) => last_error = error,
        }
    }
    Ok(json!({ "ok": false, "code": last_error.0, "error": last_error.1, "details": last_error.2 }))
}

fn run_candidate(candidate: Candidate) -> Result<(), (String, String, Value)> {
    if candidate.operation.as_deref() == Some("wmctrl-cycle") {
        return wmctrl_cycle(candidate.delta.unwrap_or(0));
    }
    let command = candidate
        .command
        .ok_or_else(|| command_error("INVALID_CANDIDATE", "candidate command is missing"))?;
    if command.is_empty()
        || command.len() > 256
        || candidate.args.len() > 64
        || candidate.args.iter().any(|argument| argument.len() > 4096)
    {
        return Err(command_error(
            "INVALID_CANDIDATE",
            "candidate command or arguments are invalid",
        ));
    }
    if candidate.expect.is_none() {
        return command_status(&command, &candidate.args);
    }
    let output = command_output(&command, &candidate.args)?;
    if !output.status.success() {
        let code = output.status.code().unwrap_or(-1);
        return Err(command_error_with(
            "COMMAND_FAILED",
            format!("{command} exited with code {code}"),
            json!({ "command": command, "exitCode": code }),
        ));
    }
    if let Some(pattern) = candidate.expect {
        let regex = regex::Regex::new(&pattern)
            .map_err(|error| command_error("INVALID_CANDIDATE", error.to_string()))?;
        let stdout = String::from_utf8_lossy(&output.stdout);
        if !regex.is_match(&stdout) {
            let text = stdout.trim();
            return Err(command_error_with(
                "COMMAND_REFUSED",
                format!(
                    "{command} refused the request: {}",
                    if text.is_empty() {
                        "empty output"
                    } else {
                        text
                    }
                ),
                json!({ "command": command, "output": text }),
            ));
        }
    }
    Ok(())
}

fn command_output(
    command: &str,
    args: &[String],
) -> Result<std::process::Output, (String, String, Value)> {
    let mut child = Command::new(command)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(io_command_error)?;
    let stdout = child.stdout.take().expect("piped stdout");
    let stderr = child.stderr.take().expect("piped stderr");
    let (sender, receiver) = mpsc::channel();
    let stdout_sender = sender.clone();
    std::thread::spawn(move || {
        let _ = stdout_sender.send((true, read_limited(stdout)));
    });
    std::thread::spawn(move || {
        let _ = sender.send((false, read_limited(stderr)));
    });
    let status = child
        .wait_timeout(COMMAND_TIMEOUT)
        .map_err(io_command_error)?;
    if status.is_none() {
        let _ = child.kill();
        let _ = child.wait();
        return Err(command_error_with(
            "COMMAND_TIMEOUT",
            format!("{command} timed out"),
            json!({ "command": command }),
        ));
    }
    let mut stdout = Vec::new();
    let mut stderr = Vec::new();
    for _ in 0..2 {
        let (is_stdout, result) = receiver
            .recv_timeout(Duration::from_millis(100))
            .map_err(|_| command_error("COMMAND_FAILED", "command output remained open"))?;
        let output = result.map_err(io_command_error)?;
        if is_stdout {
            stdout = output;
        } else {
            stderr = output;
        }
    }
    Ok(std::process::Output {
        status: status.expect("checked status"),
        stdout,
        stderr,
    })
}

fn command_status(command: &str, args: &[String]) -> Result<(), (String, String, Value)> {
    let mut child = Command::new(command)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(io_command_error)?;
    let status = child
        .wait_timeout(COMMAND_TIMEOUT)
        .map_err(io_command_error)?;
    let Some(status) = status else {
        let _ = child.kill();
        let _ = child.wait();
        return Err(command_error_with(
            "COMMAND_TIMEOUT",
            format!("{command} timed out"),
            json!({ "command": command }),
        ));
    };
    if status.success() {
        Ok(())
    } else {
        let code = status.code().unwrap_or(-1);
        Err(command_error_with(
            "COMMAND_FAILED",
            format!("{command} exited with code {code}"),
            json!({ "command": command, "exitCode": code }),
        ))
    }
}

fn read_limited(mut reader: impl Read) -> io::Result<Vec<u8>> {
    let mut output = Vec::new();
    let mut buffer = [0_u8; 8192];
    loop {
        let count = reader.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        let remaining = MAX_OUTPUT.saturating_sub(output.len());
        output.extend_from_slice(&buffer[..count.min(remaining)]);
    }
    Ok(output)
}

fn wmctrl_cycle(delta: i32) -> Result<(), (String, String, Value)> {
    if delta != -1 && delta != 1 {
        return Err(command_error(
            "INVALID_CANDIDATE",
            "workspace delta must be -1 or 1",
        ));
    }
    let output = command_output("wmctrl", &["-d".into()])?;
    if !output.status.success() {
        return Err(command_error("COMMAND_FAILED", "wmctrl -d failed"));
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let desktops: Vec<&str> = stdout
        .lines()
        .filter(|line| !line.trim().is_empty())
        .collect();
    let current = desktops.iter().position(|line| {
        let mut fields = line.split_whitespace();
        fields.next().is_some() && fields.next() == Some("*")
    });
    let Some(current) = current else {
        return Err(command_error("NO_WORKSPACES", "no active workspace found"));
    };
    if desktops.len() < 2 {
        return Err(command_error(
            "NO_WORKSPACES",
            "fewer than two workspaces are available",
        ));
    }
    let target = (current as i32 + delta).rem_euclid(desktops.len() as i32);
    let output = command_output("wmctrl", &["-s".into(), target.to_string()])?;
    if output.status.success() {
        Ok(())
    } else {
        Err(command_error(
            "COMMAND_FAILED",
            "wmctrl workspace switch failed",
        ))
    }
}

fn io_command_error(error: io::Error) -> (String, String, Value) {
    let code = if error.kind() == io::ErrorKind::NotFound {
        "ENOENT"
    } else {
        "COMMAND_FAILED"
    };
    command_error(code, error.to_string())
}

fn command_error(code: impl Into<String>, message: impl Into<String>) -> (String, String, Value) {
    (code.into(), message.into(), json!({}))
}

fn command_error_with(
    code: impl Into<String>,
    message: impl Into<String>,
    details: Value,
) -> (String, String, Value) {
    (code.into(), message.into(), details)
}

#[cfg(test)]
mod tests {
    use super::{
        AppState, X11Listener, desktop_family, handle_line, handle_line_with_state, run_candidates,
    };
    use serde_json::json;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{Arc, Mutex};

    #[test]
    fn responds_to_ping() {
        let response = handle_line(r#"{"id":1,"method":"ping"}"#);
        assert_eq!(response.id, 1);
        assert!(response.error.is_none());
        assert_eq!(
            response.result.unwrap()["capabilities"],
            json!(["listener-scoped-stop"])
        );
    }

    #[test]
    fn rejects_unknown_methods() {
        let response = handle_line(r#"{"id":2,"method":"missing"}"#);
        assert!(response.error.unwrap().contains("unknown method"));
    }

    #[test]
    fn desktop_variants_win_over_generic_ubuntu_labels() {
        for (name, family) in [
            ("ubuntu:XFCE", "xfce"),
            ("ubuntu:MATE", "mate"),
            ("ubuntu:Budgie", "budgie"),
            ("ubuntu:Cinnamon", "cinnamon"),
            ("kubuntu", "kde"),
            ("xubuntu", "xfce"),
            ("lubuntu", "lxqt"),
        ] {
            assert_eq!(desktop_family(&[name.into()]), family, "{name}");
        }
    }

    #[test]
    fn desktop_current_session_precedes_legacy_session_names() {
        assert_eq!(
            desktop_family(&["GNOME".into(), "".into(), "plasma".into()]),
            "gnome"
        );
        assert_eq!(
            desktop_family(&["unknown".into(), "MATE".into(), "gnome".into()]),
            "mate"
        );
    }

    #[test]
    fn stale_stop_requests_do_not_stop_the_active_listener() {
        let stop = Arc::new(AtomicBool::new(false));
        let mut state = AppState {
            x11_listener: Some(X11Listener {
                id: 2,
                stop: Arc::clone(&stop),
                thread: std::thread::spawn(|| {}),
            }),
        };
        let output = Arc::new(Mutex::new(std::io::stdout()));
        let stale = handle_line_with_state(
            r#"{"id":1,"method":"stop_x11_wheel","params":{"listenerId":1}}"#,
            &mut state,
            &output,
        );
        assert_eq!(stale.result.unwrap()["stopped"], false);
        assert!(!stop.load(Ordering::Relaxed));
        assert!(state.x11_listener.is_some());

        let active = handle_line_with_state(
            r#"{"id":2,"method":"stop_x11_wheel","params":{"listenerId":2}}"#,
            &mut state,
            &output,
        );
        assert_eq!(active.result.unwrap()["stopped"], true);
        assert!(stop.load(Ordering::Relaxed));
        assert!(state.x11_listener.is_none());
    }

    #[test]
    fn command_candidates_fall_back_until_one_succeeds() {
        let result = run_candidates(&json!({ "candidates": [
            { "command": "/bin/sh", "args": ["-c", "exit 2"] },
            { "command": "/bin/sh", "args": ["-c", "printf success"], "expect": "success" }
        ]}))
        .unwrap();
        assert_eq!(result["ok"], true);
    }

    #[test]
    fn command_candidates_return_the_last_failure() {
        let result = run_candidates(&json!({ "candidates": [
            { "command": "/definitely/missing/slipy-command" }
        ]}))
        .unwrap();
        assert_eq!(result["ok"], false);
        assert_eq!(result["code"], "ENOENT");
    }

    #[test]
    fn command_output_is_drained_while_the_process_runs() {
        let result = run_candidates(&json!({ "candidates": [{
            "command": "/bin/sh",
            "args": ["-c", "i=0; while [ $i -lt 20000 ]; do printf 1234567890; i=$((i+1)); done"]
        }]}))
        .unwrap();
        assert_eq!(result["ok"], true);
    }

    #[test]
    fn inherited_output_pipes_do_not_block_the_backend() {
        let started = std::time::Instant::now();
        let result = run_candidates(&json!({ "candidates": [{
            "command": "/bin/sh", "args": ["-c", "sleep 2 & printf success"], "expect": "success"
        }]}))
        .unwrap();
        assert_eq!(result["ok"], false);
        assert!(started.elapsed() < std::time::Duration::from_secs(1));
    }
}
