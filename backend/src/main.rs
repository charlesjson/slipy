use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::BTreeMap;
use std::env;
use std::fs;
use std::io::{self, BufRead, Read, Write};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::time::Duration;
use wait_timeout::ChildExt;

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

fn main() {
    let stdin = io::stdin();
    let mut stdout = io::BufWriter::new(io::stdout().lock());

    for line in stdin.lock().lines() {
        let response = match line {
            Ok(line) => handle_line(&line),
            Err(error) => Response {
                id: Value::Null,
                result: None,
                error: Some(error.to_string()),
            },
        };
        if serde_json::to_writer(&mut stdout, &response).is_err()
            || writeln!(stdout).is_err()
            || stdout.flush().is_err()
        {
            break;
        }
    }
}

fn handle_line(line: &str) -> Response {
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
        "ping" => Ok(json!({ "version": env!("CARGO_PKG_VERSION") })),
        "environment" => Ok(environment()),
        "probe_tools" => probe_tools(&request.params),
        "run_candidates" => run_candidates(&request.params),
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
    let names = [
        "XDG_CURRENT_DESKTOP",
        "XDG_SESSION_DESKTOP",
        "DESKTOP_SESSION",
    ]
    .map(|key| env::var(key).unwrap_or_default())
    .join(":")
    .to_lowercase();
    for (needle, family) in [
        ("hyprland", "hyprland"),
        ("sway", "sway"),
        ("kde", "kde"),
        ("plasma", "kde"),
        ("gnome", "gnome"),
        ("unity", "gnome"),
        ("ubuntu", "gnome"),
        ("pantheon", "gnome"),
        ("cinnamon", "cinnamon"),
        ("xfce", "xfce"),
        ("mate", "mate"),
        ("lxqt", "lxqt"),
        ("lxde", "lxde"),
        ("budgie", "budgie"),
        ("cosmic", "cosmic"),
        ("deepin", "deepin"),
        ("dde", "deepin"),
    ] {
        if names.contains(needle) {
            return family;
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
    use super::{handle_line, run_candidates};
    use serde_json::json;

    #[test]
    fn responds_to_ping() {
        let response = handle_line(r#"{"id":1,"method":"ping"}"#);
        assert_eq!(response.id, 1);
        assert!(response.error.is_none());
    }

    #[test]
    fn rejects_unknown_methods() {
        let response = handle_line(r#"{"id":2,"method":"missing"}"#);
        assert!(response.error.unwrap().contains("unknown method"));
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
