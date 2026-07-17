use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::BTreeMap;
use std::env;
use std::fs;
use std::io::{self, BufRead, Write};
use std::path::PathBuf;

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

#[cfg(test)]
mod tests {
    use super::handle_line;

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
}
