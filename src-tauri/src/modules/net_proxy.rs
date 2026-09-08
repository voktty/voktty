//! A minimal HTTP CONNECT proxy, std-only save for `regex`, meant to be the
//! network half of Hito 4's per-session sandbox (see
//! `PROMPTS/planes/PLAN_ORQUESTACION_MULTIAGENTE_SANDBOX.md`). Not wired
//! into harness session spawn yet — that is a separate increment once the
//! opt-in surface (per-session allowlist source, UI) is decided. This module
//! is deliberately decoupled from that decision: it only knows how to run a
//! CONNECT tunnel gated by a caller-supplied hostname allowlist.
//!
//! Deny-by-default: unmatched hosts, non-CONNECT requests, and any allowed
//! hostname that resolves to a loopback/private/link-local/metadata address
//! are all rejected. A hostname allowlist alone would not stop DNS
//! rebinding — an attacker-controlled DNS record for an allowed name
//! resolving to `169.254.169.254` or `127.0.0.1` — so every resolved
//! address is re-checked before connecting, not just the name.

use std::io::{self, BufRead, BufReader, Write};
use std::net::{IpAddr, SocketAddr, TcpListener, TcpStream, ToSocketAddrs};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

use regex::Regex;

/// Caps concurrent tunnels so one runaway session can't exhaust threads/fds.
const MAX_CONCURRENT_CONNECTIONS: usize = 64;
/// Bounds how long we wait to read a client's CONNECT request line/headers.
const REQUEST_READ_TIMEOUT: Duration = Duration::from_secs(10);
/// Caps request line + header bytes read before giving up on a client.
const MAX_REQUEST_BYTES: usize = 8 * 1024;
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);

/// A running proxy. Dropping it stops the listener and lets in-flight
/// tunnels finish on their own (they are not forcibly killed).
pub struct ProxyHandle {
    addr: SocketAddr,
    stopped: Arc<AtomicBool>,
}

impl ProxyHandle {
    pub fn addr(&self) -> SocketAddr {
        self.addr
    }

    /// Idempotent. Unblocks the accept loop with a local self-connect since
    /// `TcpListener::accept` has no async-cancel in std.
    pub fn stop(&self) {
        if self.stopped.swap(true, Ordering::AcqRel) {
            return;
        }
        let _ = TcpStream::connect_timeout(&self.addr, Duration::from_millis(200));
    }
}

impl Drop for ProxyHandle {
    fn drop(&mut self) {
        self.stop();
    }
}

/// Compiles a hostname allowlist. Each pattern is anchored and matched
/// case-insensitively against the CONNECT target's hostname (not the port).
pub fn compile_allowlist(patterns: &[&str]) -> Result<Vec<Regex>, regex::Error> {
    patterns
        .iter()
        .map(|pattern| Regex::new(&format!("(?i)^{pattern}$")))
        .collect()
}

/// Compiles a user-facing hostname allowlist: entries are literal hostnames
/// unless prefixed with `*.`, meaning "this host or any subdomain of it".
/// Unlike `compile_allowlist`, entries are never treated as raw regex —
/// this is what session settings should feed with, so a host containing
/// regex metacharacters (most don't, but `.` is one) can't accidentally
/// match more than intended.
pub fn compile_allowlist_hosts(hosts: &[String]) -> Result<Vec<Regex>, regex::Error> {
    hosts
        .iter()
        .map(|host| {
            let host = host.trim().to_ascii_lowercase();
            match host.strip_prefix("*.") {
                Some(rest) => Regex::new(&format!("(?i)^([a-z0-9-]+\\.)*{}$", regex::escape(rest))),
                None => Regex::new(&format!("(?i)^{}$", regex::escape(&host))),
            }
        })
        .collect()
}

/// Starts the proxy on a loopback-only random port. `allowlist` is matched
/// against the hostname of every CONNECT target; a host matching none of
/// the patterns is refused before any DNS lookup or outbound connection.
pub fn start(allowlist: Vec<Regex>) -> io::Result<ProxyHandle> {
    let listener = TcpListener::bind(("127.0.0.1", 0))?;
    let addr = listener.local_addr()?;
    let stopped = Arc::new(AtomicBool::new(false));
    let allowlist = Arc::new(allowlist);
    let active = Arc::new(AtomicUsize::new(0));

    let loop_stopped = stopped.clone();
    thread::Builder::new()
        .name("voktty-net-proxy-accept".into())
        .spawn(move || {
            for incoming in listener.incoming() {
                if loop_stopped.load(Ordering::Acquire) {
                    break;
                }
                let Ok(stream) = incoming else { continue };
                if active.fetch_add(1, Ordering::AcqRel) >= MAX_CONCURRENT_CONNECTIONS {
                    active.fetch_sub(1, Ordering::AcqRel);
                    let _ = respond(&stream, 503, "Too Many Requests");
                    continue;
                }
                let allowlist = allowlist.clone();
                let active = active.clone();
                thread::spawn(move || {
                    handle_connection(stream, &allowlist);
                    active.fetch_sub(1, Ordering::AcqRel);
                });
            }
        })?;

    Ok(ProxyHandle { addr, stopped })
}

fn handle_connection(mut client: TcpStream, allowlist: &[Regex]) {
    let _ = client.set_read_timeout(Some(REQUEST_READ_TIMEOUT));
    let target = match read_connect_target(&client) {
        Ok(target) => target,
        Err(_) => {
            let _ = respond(&client, 400, "Bad Request");
            return;
        }
    };

    if !allowlist
        .iter()
        .any(|pattern| pattern.is_match(&target.host))
    {
        log::info!("[net_proxy] denied (not allowlisted): {}", target.host);
        let _ = respond(&client, 403, "Forbidden");
        return;
    }

    let upstream = match connect_to_safe_address(&target) {
        Ok(upstream) => upstream,
        Err(error) => {
            log::info!(
                "[net_proxy] denied (unsafe or unreachable): {} ({error})",
                target.host
            );
            let _ = respond(&client, 502, "Bad Gateway");
            return;
        }
    };

    if client
        .write_all(b"HTTP/1.1 200 Connection Established\r\n\r\n")
        .is_err()
    {
        return;
    }
    let _ = client.set_read_timeout(None);
    relay(client, upstream);
}

struct ConnectTarget {
    host: String,
    port: u16,
}

/// Reads only the request line and headers (up to the blank line), leaving
/// no buffered bytes lost: once a CONNECT is accepted, the raw `TcpStream`
/// (not the `BufReader`) is spliced, so nothing read here may be needed
/// again — a CONNECT request carries no body.
fn read_connect_target(stream: &TcpStream) -> io::Result<ConnectTarget> {
    let mut reader = BufReader::new(stream.try_clone()?);
    let mut request_line = String::new();
    read_line_bounded(&mut reader, &mut request_line)?;

    let mut parts = request_line.trim_end().split(' ');
    let method = parts.next().unwrap_or("");
    let target = parts.next().unwrap_or("");
    if method != "CONNECT" || target.is_empty() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "not a CONNECT request",
        ));
    }

    // Drain headers so the client isn't left writing into a socket nobody
    // reads (some clients wait for us to consume the full header block).
    let mut total = request_line.len();
    loop {
        let mut line = String::new();
        let read = read_line_bounded(&mut reader, &mut line)?;
        total += read;
        if total > MAX_REQUEST_BYTES {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "request too large",
            ));
        }
        if line.trim_end().is_empty() {
            break;
        }
    }

    let (host, port) = target
        .rsplit_once(':')
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "missing port"))?;
    let port: u16 = port
        .parse()
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "invalid port"))?;
    if host.is_empty() {
        return Err(io::Error::new(io::ErrorKind::InvalidData, "empty host"));
    }

    Ok(ConnectTarget {
        host: host.to_ascii_lowercase(),
        port,
    })
}

fn read_line_bounded(reader: &mut impl BufRead, out: &mut String) -> io::Result<usize> {
    let read = reader.read_line(out)?;
    if read == 0 {
        return Err(io::Error::new(
            io::ErrorKind::UnexpectedEof,
            "connection closed",
        ));
    }
    if out.len() > MAX_REQUEST_BYTES {
        return Err(io::Error::new(io::ErrorKind::InvalidData, "line too large"));
    }
    Ok(read)
}

/// Resolves the target and connects only to an address that is not
/// loopback/private/link-local/multicast — the allowlist governs *names*,
/// this governs the *addresses those names are allowed to resolve to*.
fn connect_to_safe_address(target: &ConnectTarget) -> io::Result<TcpStream> {
    let candidates = (target.host.as_str(), target.port).to_socket_addrs()?;
    let mut last_error = None;
    for addr in candidates {
        if !is_public_unicast(addr.ip()) {
            last_error = Some(io::Error::new(
                io::ErrorKind::PermissionDenied,
                format!(
                    "{} resolved to a non-public address ({})",
                    target.host,
                    addr.ip()
                ),
            ));
            continue;
        }
        match TcpStream::connect_timeout(&addr, CONNECT_TIMEOUT) {
            Ok(stream) => return Ok(stream),
            Err(error) => last_error = Some(error),
        }
    }
    Err(last_error.unwrap_or_else(|| {
        io::Error::new(io::ErrorKind::NotFound, "host resolved to no addresses")
    }))
}

fn is_public_unicast(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v) => {
            !(v.is_loopback()
                || v.is_unspecified()
                || v.is_broadcast()
                || v.is_multicast()
                || v.is_link_local()
                || v.is_private()
                // CGNAT (100.64.0.0/10) and IETF benchmarking (198.18.0.0/15)
                || (v.octets()[0] == 100 && (64..=127).contains(&v.octets()[1]))
                || (v.octets()[0] == 198 && (18..=19).contains(&v.octets()[1])))
        }
        IpAddr::V6(v) => !(v.is_loopback() || v.is_unspecified() || v.is_multicast()),
    }
}

fn relay(client: TcpStream, upstream: TcpStream) {
    let Ok(client_writer) = client.try_clone() else {
        return;
    };
    let Ok(upstream_writer) = upstream.try_clone() else {
        return;
    };

    let to_upstream = thread::spawn(move || copy_and_shutdown(client, upstream_writer));
    let to_client = thread::spawn(move || copy_and_shutdown(upstream, client_writer));
    let _ = to_upstream.join();
    let _ = to_client.join();
}

fn copy_and_shutdown(mut src: TcpStream, mut dst: TcpStream) {
    let _ = io::copy(&mut src, &mut dst);
    let _ = dst.shutdown(std::net::Shutdown::Write);
}

fn respond(mut stream: &TcpStream, status: u16, reason: &str) -> io::Result<()> {
    write!(
        stream,
        "HTTP/1.1 {status} {reason}\r\nConnection: close\r\n\r\n"
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;

    fn spawn_echo_server() -> SocketAddr {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let addr = listener.local_addr().unwrap();
        thread::spawn(move || {
            if let Ok((mut stream, _)) = listener.accept() {
                let mut buf = [0u8; 64];
                if let Ok(n) = stream.read(&mut buf) {
                    let _ = stream.write_all(&buf[..n]);
                }
            }
        });
        addr
    }

    fn connect_request(target: &str) -> String {
        format!("CONNECT {target} HTTP/1.1\r\nHost: {target}\r\n\r\n")
    }

    fn read_status_line(stream: &mut TcpStream) -> String {
        let mut reader = BufReader::new(stream.try_clone().unwrap());
        let mut line = String::new();
        reader.read_line(&mut line).unwrap();
        line
    }

    #[test]
    fn relays_bytes_bidirectionally_until_either_side_closes() {
        let listener_a = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let addr_a = listener_a.local_addr().unwrap();
        let listener_b = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let addr_b = listener_b.local_addr().unwrap();

        let accept_a = thread::spawn(move || listener_a.accept().unwrap().0);
        let accept_b = thread::spawn(move || listener_b.accept().unwrap().0);
        let mut client_a = TcpStream::connect(addr_a).unwrap();
        let mut client_b = TcpStream::connect(addr_b).unwrap();
        let proxy_side_a = accept_a.join().unwrap();
        let proxy_side_b = accept_b.join().unwrap();

        let relay_thread = thread::spawn(move || relay(proxy_side_a, proxy_side_b));

        client_a.write_all(b"to-b").unwrap();
        let mut buf = [0u8; 4];
        client_b.read_exact(&mut buf).unwrap();
        assert_eq!(&buf, b"to-b");

        client_b.write_all(b"to-a").unwrap();
        client_b.shutdown(std::net::Shutdown::Write).unwrap();
        client_a.read_exact(&mut buf).unwrap();
        assert_eq!(&buf, b"to-a");

        drop(client_a);
        relay_thread.join().unwrap();
    }

    #[test]
    fn rejects_a_host_outside_the_allowlist() {
        let upstream_addr = spawn_echo_server();
        let allowlist = compile_allowlist(&["only-this-host\\.example"]).unwrap();
        let proxy = start(allowlist).unwrap();

        let mut client = TcpStream::connect(proxy.addr()).unwrap();
        client
            .write_all(connect_request(&upstream_addr.to_string()).as_bytes())
            .unwrap();
        let status = read_status_line(&mut client);
        assert!(status.contains("403"), "expected 403, got {status:?}");
    }

    #[test]
    fn rejects_a_non_connect_request() {
        let allowlist = compile_allowlist(&[".*"]).unwrap();
        let proxy = start(allowlist).unwrap();

        let mut client = TcpStream::connect(proxy.addr()).unwrap();
        client
            .write_all(b"GET http://example.com/ HTTP/1.1\r\n\r\n")
            .unwrap();
        let status = read_status_line(&mut client);
        assert!(status.contains("400"), "expected 400, got {status:?}");
    }

    #[test]
    fn allowlisted_hostname_resolving_to_a_private_address_is_still_denied() {
        // "localhost" is a plausible allowlist entry that resolves to a
        // loopback address; the address-safety check must catch it even
        // though the name itself matched.
        let allowlist = compile_allowlist(&["localhost"]).unwrap();
        let proxy = start(allowlist).unwrap();

        let mut client = TcpStream::connect(proxy.addr()).unwrap();
        client
            .write_all(connect_request("localhost:1").as_bytes())
            .unwrap();
        let status = read_status_line(&mut client);
        assert!(status.contains("502"), "expected 502, got {status:?}");
    }

    #[test]
    fn allowlist_patterns_are_anchored_and_case_insensitive() {
        let allowlist = compile_allowlist(&["api\\.example\\.com"]).unwrap();
        assert!(allowlist[0].is_match("API.EXAMPLE.COM"));
        assert!(!allowlist[0].is_match("evil-api.example.com.attacker.net"));
        assert!(!allowlist[0].is_match("notapi.example.com"));
    }

    #[test]
    fn host_allowlist_matches_the_exact_host_only() {
        let allowlist = compile_allowlist_hosts(&["api.example.com".to_string()]).unwrap();
        assert!(allowlist[0].is_match("API.EXAMPLE.COM"));
        assert!(!allowlist[0].is_match("evil-api.example.com.attacker.net"));
        assert!(!allowlist[0].is_match("sub.api.example.com"));
    }

    #[test]
    fn host_allowlist_wildcard_matches_the_apex_and_any_subdomain() {
        let allowlist = compile_allowlist_hosts(&["*.githubusercontent.com".to_string()]).unwrap();
        assert!(allowlist[0].is_match("raw.githubusercontent.com"));
        assert!(allowlist[0].is_match("a.b.githubusercontent.com"));
        assert!(allowlist[0].is_match("githubusercontent.com"));
        assert!(!allowlist[0].is_match("githubusercontent.com.attacker.net"));
        assert!(!allowlist[0].is_match("notgithubusercontent.com"));
    }

    #[test]
    fn host_allowlist_treats_dots_literally_not_as_regex() {
        // A raw regex would let "." match any character; the host compiler
        // must not let "exampleXcom" slip through for an "example.com" entry.
        let allowlist = compile_allowlist_hosts(&["example.com".to_string()]).unwrap();
        assert!(!allowlist[0].is_match("exampleXcom"));
    }

    #[test]
    fn is_public_unicast_rejects_loopback_private_and_metadata_ranges() {
        for blocked in [
            "127.0.0.1",
            "10.0.0.1",
            "172.16.0.1",
            "192.168.1.1",
            "169.254.169.254",
            "100.64.0.1",
            "198.18.0.1",
            "::1",
        ] {
            assert!(
                !is_public_unicast(blocked.parse().unwrap()),
                "{blocked} should not be public"
            );
        }
        for allowed in ["93.184.216.34", "2606:2800:220:1:248:1893:25c8:1946"] {
            assert!(
                is_public_unicast(allowed.parse().unwrap()),
                "{allowed} should be public"
            );
        }
    }

    #[test]
    fn stop_unblocks_the_accept_loop_and_is_idempotent() {
        let proxy = start(Vec::new()).unwrap();
        proxy.stop();
        proxy.stop();
    }
}
