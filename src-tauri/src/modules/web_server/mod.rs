use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct WebServerInfo {
    pub url: String,
    pub port: u16,
    pub root_path: String,
    pub server_type: String, // "static" | "php"
}

enum RunningServer {
    Static {
        port: u16,
        root_path: PathBuf,
        stop_flag: Arc<AtomicBool>,
    },
    Php {
        port: u16,
        root_path: PathBuf,
        child: Child,
    },
}

#[derive(Default)]
pub struct WebServerState {
    servers: Mutex<HashMap<String, RunningServer>>,
}

impl WebServerState {
    pub fn stop_all(&self) {
        let mut map = self.servers.lock().unwrap_or_else(|e| e.into_inner());
        for (_, server) in map.drain() {
            match server {
                RunningServer::Static { stop_flag, .. } => {
                    stop_flag.store(true, Ordering::SeqCst);
                }
                RunningServer::Php { mut child, .. } => {
                    let _ = child.kill();
                    let _ = child.wait();
                }
            }
        }
    }
}

pub fn clean_path(p: &Path) -> PathBuf {
    let s = p.to_string_lossy();
    if let Some(stripped) = s.strip_prefix(r"\\?\UNC\") {
        PathBuf::from(format!(r"\\{}", stripped))
    } else if let Some(stripped) = s.strip_prefix(r"\\?\") {
        PathBuf::from(stripped)
    } else {
        p.to_path_buf()
    }
}

pub fn normalize_root_path(raw: &str) -> Result<PathBuf, String> {
    let trimmed = raw.trim();
    let mut p = if trimmed.is_empty() {
        if let Some(snapshot) = crate::modules::workspace::launch_cwd_snapshot() {
            snapshot
        } else if let Ok(cwd) = std::env::current_dir() {
            cwd
        } else {
            return Err("No path provided and failed to get current directory".to_string());
        }
    } else {
        PathBuf::from(trimmed)
    };

    if !p.exists() {
        if trimmed.len() == 2 && trimmed.ends_with(':') {
            p = PathBuf::from(format!("{}\\", trimmed));
        }
        if !p.exists() {
            return Err(format!("Path does not exist: {}", trimmed));
        }
    }
    let canonical = p
        .canonicalize()
        .map_err(|e| format!("Failed to canonicalize path {trimmed}: {e}"))?;
    let cleaned = clean_path(&canonical);
    if cleaned.is_file() {
        Ok(cleaned.parent().unwrap_or(&cleaned).to_path_buf())
    } else {
        Ok(cleaned)
    }
}

pub fn has_php_files(dir: &Path) -> bool {
    let clean = clean_path(dir);
    if let Ok(entries) = fs::read_dir(&clean) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() {
                if let Some(ext) = path.extension() {
                    if ext.eq_ignore_ascii_case("php") {
                        return true;
                    }
                }
            }
        }
    }
    false
}

pub fn is_php_available() -> bool {
    which::which("php").is_ok()
}

pub fn guess_mime(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_ascii_lowercase())
        .as_deref()
    {
        Some("html") | Some("htm") => "text/html; charset=utf-8",
        Some("css") => "text/css; charset=utf-8",
        Some("js") | Some("mjs") => "application/javascript; charset=utf-8",
        Some("json") => "application/json; charset=utf-8",
        Some("svg") => "image/svg+xml",
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("ico") => "image/x-icon",
        Some("woff") => "font/woff",
        Some("woff2") => "font/woff2",
        Some("ttf") => "font/ttf",
        Some("otf") => "font/otf",
        Some("mp4") => "video/mp4",
        Some("webm") => "video/webm",
        Some("mp3") => "audio/mpeg",
        Some("wav") => "audio/wav",
        Some("pdf") => "application/pdf",
        Some("txt") | Some("md") => "text/plain; charset=utf-8",
        Some("xml") => "application/xml; charset=utf-8",
        Some("wasm") => "application/wasm",
        _ => "application/octet-stream",
    }
}

fn url_decode(s: &str) -> String {
    let mut out = Vec::new();
    let bytes = s.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(val) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(val);
                i += 3;
                continue;
            }
        }
        if bytes[i] == b'+' {
            out.push(b' ');
        } else {
            out.push(bytes[i]);
        }
        i += 1;
    }
    String::from_utf8_lossy(&out).to_string()
}

fn sanitize_request_path(request_uri: &str) -> &str {
    let uri = request_uri.split('?').next().unwrap_or(request_uri);
    uri.split('#').next().unwrap_or(uri)
}

fn handle_connection(mut stream: TcpStream, root: &Path) {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(5)));

    let mut buf = [0u8; 4096];
    let n = match stream.read(&mut buf) {
        Ok(n) if n > 0 => n,
        _ => return,
    };

    let req_str = String::from_utf8_lossy(&buf[..n]);
    let mut lines = req_str.lines();
    let request_line = match lines.next() {
        Some(l) => l,
        None => return,
    };

    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or("GET");
    let raw_uri = parts.next().unwrap_or("/");

    if method != "GET" && method != "HEAD" && method != "OPTIONS" {
        let resp =
            "HTTP/1.1 405 Method Not Allowed\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
        let _ = stream.write_all(resp.as_bytes());
        return;
    }

    if method == "OPTIONS" {
        let resp = "HTTP/1.1 204 No Content\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, HEAD, OPTIONS\r\nAccess-Control-Allow-Headers: *\r\nConnection: close\r\n\r\n";
        let _ = stream.write_all(resp.as_bytes());
        return;
    }

    let clean_uri = sanitize_request_path(raw_uri);
    let decoded = url_decode(clean_uri);
    let relative = decoded.trim_start_matches('/');

    let clean_root = clean_path(&root.canonicalize().unwrap_or_else(|_| root.to_path_buf()));
    let target_path = if relative.is_empty() {
        clean_root.clone()
    } else {
        clean_root.join(relative)
    };

    // Path traversal check
    let canonical = target_path.canonicalize().unwrap_or(target_path);
    let clean_target = clean_path(&canonical);

    if !clean_target.starts_with(&clean_root) {
        let resp = "HTTP/1.1 403 Forbidden\r\nContent-Type: text/plain\r\nContent-Length: 9\r\nConnection: close\r\n\r\nForbidden";
        let _ = stream.write_all(resp.as_bytes());
        return;
    }

    let file_to_serve = if clean_target.is_dir() {
        let index_html = clean_target.join("index.html");
        let index_htm = clean_target.join("index.htm");
        let index_php = clean_target.join("index.php");

        if index_html.is_file() {
            index_html
        } else if index_htm.is_file() {
            index_htm
        } else if index_php.is_file() {
            send_php_fallback(&mut stream, &clean_target);
            return;
        } else {
            send_directory_listing(&mut stream, &clean_target, &clean_root, &decoded);
            return;
        }
    } else {
        clean_target
    };

    // If requested a PHP file directly under static server
    if file_to_serve
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.eq_ignore_ascii_case("php"))
        .unwrap_or(false)
    {
        send_php_fallback(&mut stream, &file_to_serve);
        return;
    }

    match File::open(&file_to_serve) {
        Ok(mut f) => {
            let metadata = f.metadata().ok();
            let len = metadata.map(|m| m.len()).unwrap_or(0);
            let mime = guess_mime(&file_to_serve);

            let header = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: {}\r\nContent-Length: {}\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, HEAD, OPTIONS\r\nAccess-Control-Allow-Headers: *\r\nConnection: close\r\n\r\n",
                mime, len
            );

            if stream.write_all(header.as_bytes()).is_ok() && method == "GET" {
                let mut buffer = [0u8; 8192];
                while let Ok(read_bytes) = f.read(&mut buffer) {
                    if read_bytes == 0 {
                        break;
                    }
                    if stream.write_all(&buffer[..read_bytes]).is_err() {
                        break;
                    }
                }
            }
        }
        Err(_) => {
            send_404(&mut stream, &decoded);
        }
    }
}

fn send_404(stream: &mut TcpStream, path: &str) {
    let body = format!(
        "<!DOCTYPE html><html><head><meta charset='utf-8'><title>404 Not Found</title><style>body{{font-family:system-ui,-apple-system,sans-serif;padding:3rem;background:#0f172a;color:#f8fafc}}h1{{color:#ef4444}}code{{background:#1e293b;padding:0.2rem 0.4rem;border-radius:4px}}</style></head><body><h1>404 Not Found</h1><p>The requested path <code>{}</code> was not found on this Voktty Live Server.</p></body></html>",
        path
    );
    let resp = format!(
        "HTTP/1.1 404 Not Found\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    );
    let _ = stream.write_all(resp.as_bytes());
}

fn send_php_fallback(stream: &mut TcpStream, file_path: &Path) {
    let name = file_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("index.php");
    let body = format!(
        r#"<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>PHP Script Detected - Voktty Live Server</title>
  <style>
    body {{ font-family: system-ui, -apple-system, sans-serif; padding: 3rem; background: #0f172a; color: #f8fafc; line-height: 1.6; max-width: 680px; margin: 0 auto; }}
    .card {{ background: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 2rem; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.3); }}
    h2 {{ margin-top: 0; color: #60a5fa; display: flex; align-items: center; gap: 0.5rem; }}
    code {{ background: #0f172a; color: #38bdf8; padding: 0.2rem 0.5rem; border-radius: 6px; font-size: 0.9em; }}
    .tip {{ background: #1e3a8a25; border-left: 4px solid #3b82f6; padding: 0.8rem 1rem; border-radius: 4px; margin-top: 1.5rem; }}
  </style>
</head>
<body>
  <div class="card">
    <h2>🐘 PHP Script Detected: <code>{}</code></h2>
    <p>This workspace contains PHP files. Voktty started in Static Web Server mode because the <code>php</code> CLI binary was not found in the local PATH.</p>
    <div class="tip">
      <strong>To run PHP code natively:</strong>
      <p style="margin: 0.5rem 0 0 0;">Install PHP (or activate it in your environment/Docker). Once PHP is in your PATH, Voktty will automatically launch the native PHP Server (<code>php -S</code>) for full dynamic execution.</p>
    </div>
  </div>
</body>
</html>"#,
        name
    );
    let resp = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    );
    let _ = stream.write_all(resp.as_bytes());
}

fn send_directory_listing(stream: &mut TcpStream, dir: &Path, root: &Path, request_path: &str) {
    let clean_dir = clean_path(dir);
    let clean_root = clean_path(root);
    let mut entries_html = String::new();
    let rel_parent = if clean_dir != clean_root {
        let parent = clean_dir.parent().unwrap_or(&clean_root);
        let rel = parent
            .strip_prefix(&clean_root)
            .unwrap_or(Path::new(""))
            .to_string_lossy()
            .replace('\\', "/");
        format!(
            "<li>📁 <a href=\"/{}\">.. (Parent Directory)</a></li>",
            rel.trim_start_matches('/')
        )
    } else {
        String::new()
    };

    if let Ok(read) = fs::read_dir(&clean_dir) {
        let mut items: Vec<_> = read.flatten().collect();
        items.sort_by_key(|e| (e.path().is_file(), e.file_name()));

        for item in items {
            let p = clean_path(&item.path());
            let is_d = p.is_dir();
            let name = item.file_name().to_string_lossy().to_string();
            let rel = p
                .strip_prefix(&clean_root)
                .unwrap_or(&p)
                .to_string_lossy()
                .replace('\\', "/");
            let icon = if is_d { "📁" } else { "📄" };
            entries_html.push_str(&format!(
                "<li>{} <a href=\"/{}\">{}</a></li>\n",
                icon,
                rel.trim_start_matches('/'),
                name
            ));
        }
    }

    let body = format!(
        r#"<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Directory Index - Voktty Live Server</title>
  <style>
    body {{ font-family: system-ui, -apple-system, sans-serif; padding: 2rem; background: #0f172a; color: #f8fafc; line-height: 1.6; }}
    h1 {{ font-size: 1.5rem; color: #38bdf8; margin-bottom: 1rem; }}
    ul {{ list-style: none; padding: 0; }}
    li {{ padding: 0.4rem 0.6rem; border-radius: 6px; }}
    li:hover {{ background: #1e293b; }}
    a {{ color: #93c5fd; text-decoration: none; }}
    a:hover {{ text-decoration: underline; }}
  </style>
</head>
<body>
  <h1>📂 Index of /{}</h1>
  <ul>
    {}{}
  </ul>
</body>
</html>"#,
        request_path.trim_start_matches('/'),
        rel_parent,
        entries_html
    );

    let resp = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    );
    let _ = stream.write_all(resp.as_bytes());
}

fn start_static_server_thread(
    root: PathBuf,
    preferred_port: Option<u16>,
) -> Result<(u16, Arc<AtomicBool>), String> {
    let port = preferred_port.unwrap_or(0);
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let listener =
        TcpListener::bind(addr).map_err(|e| format!("Failed to bind web server port: {e}"))?;
    let actual_port = listener
        .local_addr()
        .map_err(|e| format!("Failed to get local addr: {e}"))?
        .port();

    let _ = listener.set_nonblocking(true);
    let stop_flag = Arc::new(AtomicBool::new(false));
    let stop_clone = Arc::clone(&stop_flag);

    thread::spawn(move || {
        while !stop_clone.load(Ordering::Relaxed) {
            match listener.accept() {
                Ok((stream, _)) => {
                    let root_clone = root.clone();
                    thread::spawn(move || {
                        handle_connection(stream, &root_clone);
                    });
                }
                Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    thread::sleep(Duration::from_millis(20));
                }
                Err(_) => {
                    thread::sleep(Duration::from_millis(50));
                }
            }
        }
    });

    Ok((actual_port, stop_flag))
}

fn start_php_server(root: &Path, preferred_port: Option<u16>) -> Result<(u16, Child), String> {
    let port = if let Some(p) = preferred_port {
        p
    } else {
        let temp_listener = TcpListener::bind("127.0.0.1:0")
            .map_err(|e| format!("Failed to allocate port for PHP server: {e}"))?;
        temp_listener
            .local_addr()
            .map_err(|e| e.to_string())?
            .port()
    };

    let bind_target = format!("127.0.0.1:{}", port);
    let clean_root = clean_path(root);
    let root_str = clean_root.to_string_lossy().to_string();

    let mut cmd = Command::new("php");
    cmd.args(["-S", &bind_target, "-t", &root_str])
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    crate::modules::proc::hide_console(&mut cmd);

    let child = cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn PHP server: {e}"))?;

    thread::sleep(Duration::from_millis(60));

    Ok((port, child))
}

#[tauri::command]
pub async fn web_server_start(
    state: State<'_, WebServerState>,
    path: String,
    port: Option<u16>,
) -> Result<WebServerInfo, String> {
    let canonical = normalize_root_path(&path)?;
    let key = canonical.to_string_lossy().to_string();

    let mut map = state.servers.lock().map_err(|e| e.to_string())?;

    if let Some(running) = map.get(&key) {
        match running {
            RunningServer::Static {
                port, root_path, ..
            } => {
                return Ok(WebServerInfo {
                    url: format!("http://127.0.0.1:{}", port),
                    port: *port,
                    root_path: root_path.to_string_lossy().to_string(),
                    server_type: "static".to_string(),
                });
            }
            RunningServer::Php {
                port, root_path, ..
            } => {
                return Ok(WebServerInfo {
                    url: format!("http://127.0.0.1:{}", port),
                    port: *port,
                    root_path: root_path.to_string_lossy().to_string(),
                    server_type: "php".to_string(),
                });
            }
        }
    }

    let is_php = has_php_files(&canonical) && is_php_available();

    if is_php {
        match start_php_server(&canonical, port) {
            Ok((actual_port, child)) => {
                let info = WebServerInfo {
                    url: format!("http://127.0.0.1:{}", actual_port),
                    port: actual_port,
                    root_path: key.clone(),
                    server_type: "php".to_string(),
                };
                map.insert(
                    key,
                    RunningServer::Php {
                        port: actual_port,
                        root_path: canonical,
                        child,
                    },
                );
                return Ok(info);
            }
            Err(e) => {
                log::warn!("Failed to start PHP server, falling back to static: {}", e);
            }
        }
    }

    let (actual_port, stop_flag) = start_static_server_thread(canonical.clone(), port)?;
    let info = WebServerInfo {
        url: format!("http://127.0.0.1:{}", actual_port),
        port: actual_port,
        root_path: key.clone(),
        server_type: "static".to_string(),
    };

    map.insert(
        key,
        RunningServer::Static {
            port: actual_port,
            root_path: canonical,
            stop_flag,
        },
    );

    Ok(info)
}

#[tauri::command]
pub async fn web_server_stop(
    state: State<'_, WebServerState>,
    path: Option<String>,
    port: Option<u16>,
) -> Result<(), String> {
    let mut map = state.servers.lock().map_err(|e| e.to_string())?;

    if let Some(p) = port {
        let key_to_remove = map.iter().find_map(|(k, s)| match s {
            RunningServer::Static { port: sp, .. } if *sp == p => Some(k.clone()),
            RunningServer::Php { port: pp, .. } if *pp == p => Some(k.clone()),
            _ => None,
        });
        if let Some(key) = key_to_remove {
            if let Some(server) = map.remove(&key) {
                match server {
                    RunningServer::Static { stop_flag, .. } => {
                        stop_flag.store(true, Ordering::SeqCst);
                    }
                    RunningServer::Php { mut child, .. } => {
                        let _ = child.kill();
                        let _ = child.wait();
                    }
                }
            }
        }
        return Ok(());
    }

    if let Some(path_str) = path {
        let canonical = match normalize_root_path(&path_str) {
            Ok(p) => p,
            Err(_) => PathBuf::from(&path_str),
        };
        let key = canonical.to_string_lossy().to_string();
        if let Some(server) = map.remove(&key) {
            match server {
                RunningServer::Static { stop_flag, .. } => {
                    stop_flag.store(true, Ordering::SeqCst);
                }
                RunningServer::Php { mut child, .. } => {
                    let _ = child.kill();
                    let _ = child.wait();
                }
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn web_server_get_for_path(
    state: State<'_, WebServerState>,
    path: String,
) -> Result<Option<WebServerInfo>, String> {
    let canonical = match normalize_root_path(&path) {
        Ok(p) => p,
        Err(_) => return Ok(None),
    };
    let key = canonical.to_string_lossy().to_string();

    let map = state.servers.lock().map_err(|e| e.to_string())?;
    if let Some(running) = map.get(&key) {
        match running {
            RunningServer::Static {
                port, root_path, ..
            } => Ok(Some(WebServerInfo {
                url: format!("http://127.0.0.1:{}", port),
                port: *port,
                root_path: root_path.to_string_lossy().to_string(),
                server_type: "static".to_string(),
            })),
            RunningServer::Php {
                port, root_path, ..
            } => Ok(Some(WebServerInfo {
                url: format!("http://127.0.0.1:{}", port),
                port: *port,
                root_path: root_path.to_string_lossy().to_string(),
                server_type: "php".to_string(),
            })),
        }
    } else {
        Ok(None)
    }
}

#[tauri::command]
pub async fn web_server_list(
    state: State<'_, WebServerState>,
) -> Result<Vec<WebServerInfo>, String> {
    let map = state.servers.lock().map_err(|e| e.to_string())?;
    let mut list = Vec::new();
    for running in map.values() {
        match running {
            RunningServer::Static {
                port, root_path, ..
            } => {
                list.push(WebServerInfo {
                    url: format!("http://127.0.0.1:{}", port),
                    port: *port,
                    root_path: root_path.to_string_lossy().to_string(),
                    server_type: "static".to_string(),
                });
            }
            RunningServer::Php {
                port, root_path, ..
            } => {
                list.push(WebServerInfo {
                    url: format!("http://127.0.0.1:{}", port),
                    port: *port,
                    root_path: root_path.to_string_lossy().to_string(),
                    server_type: "php".to_string(),
                });
            }
        }
    }
    Ok(list)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn test_mime_detection() {
        assert_eq!(
            guess_mime(Path::new("index.html")),
            "text/html; charset=utf-8"
        );
        assert_eq!(
            guess_mime(Path::new("style.css")),
            "text/css; charset=utf-8"
        );
        assert_eq!(
            guess_mime(Path::new("app.js")),
            "application/javascript; charset=utf-8"
        );
        assert_eq!(guess_mime(Path::new("icon.svg")), "image/svg+xml");
        assert_eq!(guess_mime(Path::new("image.webp")), "image/webp");
        assert_eq!(guess_mime(Path::new("font.woff2")), "font/woff2");
        assert_eq!(
            guess_mime(Path::new("unknown.xyz")),
            "application/octet-stream"
        );
    }

    #[test]
    fn test_url_decode() {
        assert_eq!(url_decode("hello%20world"), "hello world");
        assert_eq!(url_decode("a+b"), "a b");
        assert_eq!(url_decode("%2Fpath%2Fto%2Ffile"), "/path/to/file");
    }

    #[test]
    fn test_sanitize_request_path() {
        assert_eq!(sanitize_request_path("/index.html?v=123"), "/index.html");
        assert_eq!(sanitize_request_path("/page#section"), "/page");
    }

    #[test]
    fn test_static_server_serves_html() {
        let dir = tempdir().unwrap();
        let html_file = dir.path().join("index.html");
        fs::write(&html_file, "<h1>Hello Voktty</h1>").unwrap();

        let (port, stop_flag) = start_static_server_thread(dir.path().to_path_buf(), None).unwrap();
        assert!(port > 0);
        thread::sleep(Duration::from_millis(50));

        let mut stream = TcpStream::connect(format!("127.0.0.1:{}", port)).unwrap();
        stream
            .write_all(b"GET / HTTP/1.1\r\nHost: localhost\r\n\r\n")
            .unwrap();

        let mut res = String::new();
        stream.read_to_string(&mut res).unwrap();

        assert!(res.starts_with("HTTP/1.1 200 OK"));
        assert!(res.contains("Content-Type: text/html; charset=utf-8"));
        assert!(res.contains("<h1>Hello Voktty</h1>"));

        stop_flag.store(true, Ordering::SeqCst);
    }
}
