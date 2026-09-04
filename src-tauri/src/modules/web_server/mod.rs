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

pub const INSPECTOR_BUNDLE_JS: &str = r##"(function() {
  if (window.__VOKTTY_INSPECTOR_INSTALLED__) return;
  window.__VOKTTY_INSPECTOR_INSTALLED__ = true;

  function generateCssSelector(el) {
    if (!el) return "";
    if (el.id && /^[A-Za-z_-][\w-]*$/.test(el.id)) return "#" + el.id;
    var parts = [];
    var current = el;
    var depth = 0;
    while (current && depth < 4) {
      var tag = (current.tagName || "").toLowerCase();
      if (tag === "body" || tag === "html" || !tag) break;
      var part = tag;
      if (current.id && /^[A-Za-z_-][\w-]*$/.test(current.id)) {
        part += "#" + current.id;
        parts.unshift(part);
        break;
      }
      var classArray = Array.from(current.classList || []).filter(function(c) {
        return !c.startsWith("voktty-") && !c.includes(":") && !c.includes("/");
      }).slice(0, 2);
      if (classArray.length > 0) part += "." + classArray.join(".");
      parts.unshift(part);
      current = current.parentElement;
      depth++;
    }
    return parts.join(" > ") || (el.tagName ? el.tagName.toLowerCase() : "element");
  }

  function extractReactFiberMetadata(el) {
    var hierarchy = [];
    var componentName, filePath, lineNumber, columnNumber, propsSummary;
    var fiberKey = Object.keys(el || {}).find(function(k) {
      return k.startsWith("__reactFiber$") || k.startsWith("__reactInternalInstance$");
    });
    if (!fiberKey) return { hierarchy: hierarchy };
    var fiber = el[fiberKey];
    var curr = fiber;
    var depth = 0;
    while (curr && depth < 20) {
      if (curr.type) {
        var name = typeof curr.type === "string" ? curr.type : (curr.type.displayName || curr.type.name);
        if (name && typeof name === "string" && /^[A-Z]/.test(name) && !hierarchy.includes(name)) {
          hierarchy.push(name);
          if (!componentName) componentName = name;
          if (!propsSummary && curr.memoizedProps) {
            try {
              var s = {};
              for (var k in curr.memoizedProps) {
                if (k !== "children" && typeof curr.memoizedProps[k] !== "function") {
                  s[k] = curr.memoizedProps[k];
                }
              }
              propsSummary = s;
            } catch(e) {}
          }
        }
      }
      if (curr._debugSource && !filePath) {
        filePath = curr._debugSource.fileName;
        lineNumber = curr._debugSource.lineNumber;
        columnNumber = curr._debugSource.columnNumber;
      }
      curr = curr.return;
      depth++;
    }
    return {
      componentName: componentName,
      filePath: filePath,
      lineNumber: lineNumber,
      columnNumber: columnNumber,
      propsSummary: propsSummary,
      hierarchy: hierarchy
    };
  }

  function extractDomMetadata(element, url) {
    var tagName = (element.tagName || "").toLowerCase();
    var idAttr = element.id || undefined;
    var classList = element.classList ? Array.from(element.classList).filter(function(c) { return !c.startsWith("voktty-"); }) : [];
    var attributes = {};
    if (element.attributes) {
      for (var i = 0; i < element.attributes.length; i++) {
        var attr = element.attributes[i];
        if (attr && !attr.name.startsWith("voktty-")) {
          attributes[attr.name] = attr.value;
        }
      }
    }
    var selector = generateCssSelector(element);
    var framework = "dom-generic";
    var componentName, filePath, lineNumber, columnNumber, propsSummary, hierarchy = [];

    if (typeof element.closest === "function") {
      var astroEl = element.closest("[data-astro-source-file]");
      if (astroEl) {
        framework = "astro";
        var src = astroEl.getAttribute("data-astro-source-file");
        if (src) {
          var p = src.split(":");
          filePath = p[0];
          lineNumber = parseInt(p[1], 10) || undefined;
          columnNumber = parseInt(p[2], 10) || undefined;
        }
      }
      var vueEl = element.closest("[data-v-inspector]");
      if (vueEl) {
        framework = "vue";
        var insp = vueEl.getAttribute("data-v-inspector");
        if (insp) {
          var vp = insp.split(":");
          filePath = vp[0];
          lineNumber = parseInt(vp[1], 10) || undefined;
          columnNumber = parseInt(vp[2], 10) || undefined;
        }
      }
      var svelteEl = element.closest("[data-svelte-h], [data-svelte-component]");
      if (svelteEl) {
        framework = "svelte";
        componentName = svelteEl.getAttribute("data-svelte-component") || undefined;
      }
    }

    var reactMeta = extractReactFiberMetadata(element);
    if (reactMeta.componentName || reactMeta.filePath || reactMeta.hierarchy.length > 0) {
      framework = "react";
      if (!componentName) componentName = reactMeta.componentName;
      if (!filePath) filePath = reactMeta.filePath;
      if (lineNumber === undefined) lineNumber = reactMeta.lineNumber;
      if (columnNumber === undefined) columnNumber = reactMeta.columnNumber;
      if (!propsSummary) propsSummary = reactMeta.propsSummary;
      if (reactMeta.hierarchy.length > 0) hierarchy = reactMeta.hierarchy;
    }

    var rect = element.getBoundingClientRect();
    var boundingBox = {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      left: rect.left
    };

    var computedStyle = window.getComputedStyle ? window.getComputedStyle(element) : null;
    var styles = {};
    if (computedStyle) {
      var sampleProps = [
        "display", "position", "flexDirection", "gridTemplateColumns",
        "gap", "padding", "margin", "width", "height", "color",
        "backgroundColor", "fontSize", "fontWeight", "borderRadius", "border"
      ];
      for (var j = 0; j < sampleProps.length; j++) {
        var sp = sampleProps[j];
        var val = computedStyle[sp];
        if (val) styles[sp] = val;
      }
    }

    var textSnippet = (element.innerText || element.textContent || "").trim();
    if (textSnippet.length > 120) {
      textSnippet = textSnippet.slice(0, 117) + "...";
    }

    var outerHtml = element.outerHTML || "";
    if (outerHtml.length > 600) {
      outerHtml = outerHtml.slice(0, 597) + "...";
    }

    return {
      id: "comp_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7),
      tagName: tagName,
      idAttr: idAttr,
      classList: classList,
      attributes: attributes,
      selector: selector,
      componentName: componentName,
      filePath: filePath,
      lineNumber: lineNumber,
      columnNumber: columnNumber,
      propsSummary: propsSummary,
      framework: framework,
      hierarchy: hierarchy,
      boundingBox: boundingBox,
      styles: styles,
      textSnippet: textSnippet || undefined,
      outerHtml: outerHtml || undefined,
      timestamp: Date.now(),
      pageUrl: url || window.location.href
    };
  }

  var active = false;
  var hoveredEl = null;

  var overlayHost = document.createElement("div");
  overlayHost.id = "voktty-inspector-root";
  overlayHost.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:2147483647;";
  var shadow = overlayHost.attachShadow({ mode: "open" });

  var box = document.createElement("div");
  box.style.cssText = "position:absolute;display:none;pointer-events:none;border:2px solid #06b6d4;background:rgba(6,182,212,0.12);border-radius:4px;box-shadow:0 0 12px rgba(6,182,212,0.35);transition:all 60ms ease-out;z-index:2147483647;";

  var label = document.createElement("div");
  label.style.cssText = "position:absolute;bottom:calc(100% + 4px);left:0;background:#0f172a;color:#38bdf8;padding:2px 8px;border-radius:4px;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;font-size:11px;font-weight:600;white-space:nowrap;border:1px solid #0284c7;box-shadow:0 2px 8px rgba(0,0,0,0.5);pointer-events:none;";
  box.appendChild(label);
  shadow.appendChild(box);

  function updateHighlight(el) {
    if (!el || !active) {
      box.style.display = "none";
      return;
    }
    var r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) {
      box.style.display = "none";
      return;
    }
    box.style.display = "block";
    box.style.top = (r.top + window.scrollY) + "px";
    box.style.left = (r.left + window.scrollX) + "px";
    box.style.width = r.width + "px";
    box.style.height = r.height + "px";

    var title = (el.tagName || "").toLowerCase();
    if (el.id) title += "#" + el.id;
    else if (el.classList && el.classList.length > 0) {
      var cls = Array.from(el.classList).filter(function(c){ return !c.startsWith("voktty-"); })[0];
      if (cls) title += "." + cls;
    }
    label.textContent = "\u{1F3AF} " + title;
  }

  function handleMouseMove(e) {
    if (!active) return;
    var target = document.elementFromPoint(e.clientX, e.clientY);
    if (target && target !== overlayHost && !overlayHost.contains(target)) {
      if (hoveredEl !== target) {
        hoveredEl = target;
        updateHighlight(target);
      }
    }
  }

  function handleClick(e) {
    if (!active) return;
    var target = document.elementFromPoint(e.clientX, e.clientY);
    if (target && target !== overlayHost && !overlayHost.contains(target)) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      var meta = extractDomMetadata(target, window.location.href);
      try {
        window.parent.postMessage({
          type: "VOKTTY_LIVE_COMPONENT_SELECTED",
          payload: meta
        }, "*");
      } catch (err) {
        console.warn("[Voktty Inspector] PostMessage failed", err);
      }
    }
  }

  window.addEventListener("message", function(e) {
    if (e.data && e.data.type === "VOKTTY_SET_INSPECTOR_ACTIVE") {
      active = Boolean(e.data.active);
      if (active) {
        if (!document.body.contains(overlayHost)) {
          document.body.appendChild(overlayHost);
        }
        document.addEventListener("mousemove", handleMouseMove, true);
        document.addEventListener("click", handleClick, true);
      } else {
        box.style.display = "none";
        document.removeEventListener("mousemove", handleMouseMove, true);
        document.removeEventListener("click", handleClick, true);
      }
      try {
        window.parent.postMessage({
          type: "VOKTTY_INSPECTOR_STATE_CHANGE",
          payload: { active: active }
        }, "*");
      } catch (_) {}
    }
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function() {
      if (document.body) document.body.appendChild(overlayHost);
    });
  } else if (document.body) {
    document.body.appendChild(overlayHost);
  }
})();"##;

pub fn ensure_php_helpers() -> Result<(PathBuf, PathBuf), String> {
    let dir = std::env::temp_dir().join("voktty_web_server");
    let _ = fs::create_dir_all(&dir);

    let js_path = dir.join("voktty_inspector.js");
    let router_path = dir.join("voktty_router.php");
    let append_path = dir.join("voktty_append.php");

    let _ = fs::write(&js_path, INSPECTOR_BUNDLE_JS);

    let router_code = r#"<?php
$uri = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);
if ($uri === '/__voktty_inspector.js') {
    header('Content-Type: application/javascript; charset=utf-8');
    header('Access-Control-Allow-Origin: *');
    echo file_get_contents(__DIR__ . '/voktty_inspector.js');
    exit;
}
$docroot = $_SERVER['DOCUMENT_ROOT'] ?? getcwd();
$filePath = $docroot . $uri;
if ($uri !== '/' && file_exists($filePath) && !is_dir($filePath)) {
    return false;
}
if (is_dir($filePath)) {
    if (file_exists($filePath . '/index.php')) {
        include $filePath . '/index.php';
        exit;
    }
    if (file_exists($filePath . '/index.html')) {
        include $filePath . '/index.html';
        exit;
    }
}
return false;
"#;
    let _ = fs::write(&router_path, router_code);

    let append_code = r#"<?php
if (function_exists('headers_list')) {
    echo "\n<script src=\"/__voktty_inspector.js\"></script>\n";
}
"#;
    let _ = fs::write(&append_path, append_code);

    Ok((router_path, append_path))
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
    if clean.is_file() {
        if let Some(ext) = clean.extension() {
            if ext.eq_ignore_ascii_case("php") {
                return true;
            }
        }
    }
    if let Ok(entries) = fs::read_dir(&clean) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() {
                if let Some(ext) = path.extension() {
                    if ext.eq_ignore_ascii_case("php") {
                        return true;
                    }
                }
            } else if path.is_dir() {
                let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
                let lower = name.to_ascii_lowercase();
                if matches!(
                    lower.as_str(),
                    "public" | "src" | "app" | "www" | "web" | "html"
                ) {
                    if let Ok(sub_entries) = fs::read_dir(&path) {
                        for sub in sub_entries.flatten() {
                            if sub
                                .path()
                                .extension()
                                .map(|e| e.eq_ignore_ascii_case("php"))
                                .unwrap_or(false)
                            {
                                return true;
                            }
                        }
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

    if relative == "__voktty_inspector.js" {
        let resp = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/javascript; charset=utf-8\r\nContent-Length: {}\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, HEAD, OPTIONS\r\nAccess-Control-Allow-Headers: *\r\nConnection: close\r\n\r\n{}",
            INSPECTOR_BUNDLE_JS.len(),
            INSPECTOR_BUNDLE_JS
        );
        let _ = stream.write_all(resp.as_bytes());
        return;
    }

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

    let mime = guess_mime(&file_to_serve);
    if mime.starts_with("text/html") {
        if let Ok(mut html_content) = fs::read_to_string(&file_to_serve) {
            let script_tag = "<script src=\"/__voktty_inspector.js\"></script>";
            if !html_content.contains("__voktty_inspector.js") {
                if let Some(pos) = html_content.rfind("</body>") {
                    html_content.insert_str(pos, script_tag);
                } else if let Some(pos) = html_content.rfind("</html>") {
                    html_content.insert_str(pos, script_tag);
                } else {
                    html_content.push_str(script_tag);
                }
            }
            let bytes = html_content.as_bytes();
            let header = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: {}\r\nContent-Length: {}\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, HEAD, OPTIONS\r\nAccess-Control-Allow-Headers: *\r\nConnection: close\r\n\r\n",
                mime,
                bytes.len()
            );
            let _ = stream.write_all(header.as_bytes());
            if method == "GET" {
                let _ = stream.write_all(bytes);
            }
            return;
        }
    }

    match File::open(&file_to_serve) {
        Ok(mut f) => {
            let metadata = f.metadata().ok();
            let len = metadata.map(|m| m.len()).unwrap_or(0);

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
  <script src="/__voktty_inspector.js"></script>
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
    let listener = match TcpListener::bind(addr) {
        Ok(l) => l,
        Err(e) if port != 0 => {
            log::warn!(
                "Static server port {} in use ({}), allocating random port",
                port,
                e
            );
            TcpListener::bind("127.0.0.1:0")
                .map_err(|e2| format!("Failed to bind web server port: {e2}"))?
        }
        Err(e) => return Err(format!("Failed to bind web server port: {e}")),
    };
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
        if p != 0 {
            if let Ok(test_bind) = TcpListener::bind(format!("127.0.0.1:{}", p)) {
                drop(test_bind);
                p
            } else {
                log::warn!("Preferred PHP port {} in use, allocating random port", p);
                let temp_listener = TcpListener::bind("127.0.0.1:0")
                    .map_err(|e| format!("Failed to allocate port for PHP server: {e}"))?;
                let allocated = temp_listener
                    .local_addr()
                    .map_err(|e| e.to_string())?
                    .port();
                drop(temp_listener);
                allocated
            }
        } else {
            let temp_listener = TcpListener::bind("127.0.0.1:0")
                .map_err(|e| format!("Failed to allocate port for PHP server: {e}"))?;
            let allocated = temp_listener
                .local_addr()
                .map_err(|e| e.to_string())?
                .port();
            drop(temp_listener);
            allocated
        }
    } else {
        let temp_listener = TcpListener::bind("127.0.0.1:0")
            .map_err(|e| format!("Failed to allocate port for PHP server: {e}"))?;
        let allocated = temp_listener
            .local_addr()
            .map_err(|e| e.to_string())?
            .port();
        drop(temp_listener);
        allocated
    };

    let bind_target = format!("127.0.0.1:{}", port);
    let clean_root = clean_path(root);
    let mut doc_root = clean_root.clone();
    let public_dir = clean_root.join("public");
    if public_dir.join("index.php").is_file() {
        doc_root = public_dir;
    }
    let root_str = doc_root.to_string_lossy().to_string();

    let (router_path, append_path) =
        ensure_php_helpers().unwrap_or_else(|_| (PathBuf::new(), PathBuf::new()));

    let mut cmd = Command::new("php");
    cmd.args(["-S", &bind_target, "-t", &root_str]);
    if append_path.exists() {
        cmd.arg("-d")
            .arg(format!("auto_append_file={}", append_path.to_string_lossy()));
    }
    if router_path.exists() {
        cmd.arg(&router_path.to_string_lossy().to_string());
    }
    cmd.stdout(Stdio::null()).stderr(Stdio::null());

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
