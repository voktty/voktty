use super::*;
use std::io::{Read, Write};
use std::net::TcpStream;

struct Server(Child);

impl Drop for Server {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

struct Reply {
    status: u16,
    headers: String,
    body: Vec<u8>,
}

impl Reply {
    fn text(&self) -> String {
        String::from_utf8_lossy(&self.body).into_owned()
    }
}

fn request(port: u16, path: &str, accept: &str) -> Reply {
    let mut last = String::new();
    for _ in 0..40 {
        match TcpStream::connect(("127.0.0.1", port)) {
            Ok(mut stream) => {
                let head = format!(
                    "GET {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nAccept: {accept}\r\nConnection: close\r\n\r\n"
                );
                stream.write_all(head.as_bytes()).unwrap();
                let mut raw = Vec::new();
                stream.read_to_end(&mut raw).unwrap();
                let split = raw
                    .windows(4)
                    .position(|window| window == b"\r\n\r\n")
                    .unwrap_or_else(|| panic!("no HTTP header in reply: {raw:?}"));
                let headers = String::from_utf8_lossy(&raw[..split]).into_owned();
                let status = headers
                    .split_whitespace()
                    .nth(1)
                    .and_then(|code| code.parse().ok())
                    .unwrap_or_else(|| panic!("no status line in {headers:?}"));
                return Reply {
                    status,
                    headers,
                    body: raw[split + 4..].to_vec(),
                };
            }
            Err(error) => {
                last = error.to_string();
                thread::sleep(Duration::from_millis(50));
            }
        }
    }
    panic!("PHP server did not start: {last}");
}

fn fixture() -> (tempfile::TempDir, Server, u16) {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().canonicalize().unwrap();
    let public = root.join("public");
    fs::create_dir_all(public.join("sub")).unwrap();
    fs::write(root.join("secret.txt"), "TOP-SECRET").unwrap();
    fs::write(
        public.join("index.php"),
        "<?php echo '<html><body>front:' . $_SERVER['REQUEST_URI'] . ' script=' . $_SERVER['SCRIPT_NAME'] . '</body></html>';",
    )
    .unwrap();
    fs::write(public.join("app.css"), "body{color:red}").unwrap();
    fs::write(public.join("real.txt"), "plain").unwrap();
    fs::write(
        public.join("page.html"),
        "<!DOCTYPE html><html><body>doc</body></html>",
    )
    .unwrap();
    fs::write(
        public.join("api.php"),
        "<?php header('Content-Type: application/json'); echo '{\"ok\":true}';",
    )
    .unwrap();
    fs::write(
        public.join("redirect.php"),
        "<?php header('Location: /target'); http_response_code(302);",
    )
    .unwrap();
    fs::write(
        public.join("globals.php"),
        "<?php global $marker; $marker = 'g1'; function show() { global $marker; echo '<body>marker=' . $marker . '</body>'; } show();",
    )
    .unwrap();
    fs::write(
        public.join("sub").join("tool.php"),
        "<?php echo '<body>info=' . ($_SERVER['PATH_INFO'] ?? '-') . '</body>';",
    )
    .unwrap();
    let (port, child) = start_php_server(&root, None).unwrap();
    (dir, Server(child), port)
}

const BROWSER: &str = "text/html,application/xhtml+xml,*/*;q=0.8";

macro_rules! php_or_return {
    () => {
        if !is_php_available() {
            return;
        }
    };
}

#[test]
fn static_assets_are_served_with_valid_headers_and_untouched() {
    php_or_return!();
    let (_dir, _server, port) = fixture();
    let css = request(port, "/app.css", "text/css,*/*");
    assert_eq!(css.status, 200);
    assert!(css
        .headers
        .to_ascii_lowercase()
        .contains("content-type: text/css"));
    assert_eq!(css.text(), "body{color:red}");
    assert_eq!(request(port, "/real.txt", "*/*").text(), "plain");
}

#[test]
fn inspector_is_injected_once_into_html_and_php_pages() {
    php_or_return!();
    let (_dir, _server, port) = fixture();
    for path in ["/page.html", "/", "/about", "/globals.php"] {
        let reply = request(port, path, BROWSER);
        assert_eq!(reply.status, 200, "{path}");
        assert_eq!(
            reply.text().matches("__voktty_inspector.js").count(),
            1,
            "{path}: {}",
            reply.text()
        );
    }
    let html = request(port, "/page.html", BROWSER).text();
    assert!(html.starts_with("<!DOCTYPE html>"));
}

#[test]
fn responses_that_are_not_navigations_stay_untouched() {
    php_or_return!();
    let (_dir, _server, port) = fixture();
    let json = request(port, "/api.php", "application/json");
    assert_eq!(json.text(), "{\"ok\":true}");
    let fetch = request(port, "/api.php", "*/*");
    assert_eq!(fetch.text(), "{\"ok\":true}");
    let redirect = request(port, "/redirect.php", BROWSER);
    assert_eq!(redirect.status, 302);
    assert!(!redirect.text().contains("__voktty_inspector"));
}

#[test]
fn pretty_urls_reach_the_front_controller_but_missing_assets_stay_404() {
    php_or_return!();
    let (_dir, _server, port) = fixture();
    let page = request(port, "/posts/42?draft=1", BROWSER);
    assert_eq!(page.status, 200);
    assert!(page
        .text()
        .contains("front:/posts/42?draft=1 script=/index.php"));
    assert_eq!(request(port, "/missing.css", "text/css").status, 404);
}

#[test]
fn php_globals_and_path_info_behave_like_a_normal_server() {
    php_or_return!();
    let (_dir, _server, port) = fixture();
    assert!(request(port, "/globals.php", BROWSER)
        .text()
        .contains("marker=g1"));
    assert!(request(port, "/sub/tool.php/a/b", BROWSER)
        .text()
        .contains("info=/a/b"));
}

#[test]
fn requests_cannot_leave_the_document_root() {
    php_or_return!();
    let (_dir, _server, port) = fixture();
    for path in [
        "/../secret.txt",
        "/%2e%2e/secret.txt",
        "/sub/../../secret.txt",
    ] {
        let reply = request(port, path, "*/*");
        assert!(!reply.text().contains("TOP-SECRET"), "{path} leaked");
    }
}

#[test]
fn the_proxy_injects_the_inspector_into_a_plain_remote_style_php_server() {
    php_or_return!();
    let dir = tempfile::tempdir().unwrap();
    let public = clean_path(&dir.path().canonicalize().unwrap().join("public"));
    fs::create_dir_all(&public).unwrap();
    fs::write(
        public.join("index.php"),
        "<?php echo '<!DOCTYPE html><html><head></head><body>front:' . $_SERVER['REQUEST_URI'] . '</body></html>';",
    )
    .unwrap();
    let port = {
        let probe = TcpListener::bind("127.0.0.1:0").unwrap();
        probe.local_addr().unwrap().port()
    };
    // The same command a remote terminal runs: no router, no helper files.
    let child = Command::new("php")
        .args(["-S", &format!("127.0.0.1:{port}"), "-t"])
        .arg(&public)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .unwrap();
    let _server = Server(child);
    // The proxy does not retry, so wait until PHP is listening.
    for _ in 0..100 {
        if TcpStream::connect(("127.0.0.1", port)).is_ok() {
            break;
        }
        thread::sleep(Duration::from_millis(50));
    }
    let (proxy_port, stop) = start_proxy_server_thread().unwrap();

    let target = url_encode(&format!("http://127.0.0.1:{port}/about"));
    let reply = request(
        proxy_port,
        &format!("/__voktty_proxy?url={target}"),
        BROWSER,
    );
    stop.store(true, std::sync::atomic::Ordering::Relaxed);

    assert_eq!(reply.status, 200, "{}", reply.text());
    let html = reply.text();
    assert!(html.contains("front:/about"), "{html}");
    assert_eq!(html.matches("__VOKTTY_IS_PROXIED__ = true").count(), 1);
    assert_eq!(
        html.matches("__VOKTTY_INSPECTOR_INSTALLED__ = true")
            .count(),
        1
    );
    assert!(html.contains("<base href="), "base tag missing");
}
