//! Pure parsing and matching of the OpenSSH `known_hosts` format.
//!
//! Deciding what to do about an unknown or changed host key belongs to the
//! user, so this module only reports a verdict and never writes or trusts on
//! its own.

use base64::engine::general_purpose::STANDARD;
use base64::Engine;

/// Entries above this are refused rather than parsed: a `known_hosts` this
/// large is a corrupt or hostile file, not a user's host list.
const MAX_ENTRIES: usize = 50_000;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum HostPattern {
    Plain(String),
    Negated(String),
    Hashed { salt: Vec<u8>, hash: Vec<u8> },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EntryMarker {
    None,
    CertAuthority,
    Revoked,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct KnownHostEntry {
    pub marker: EntryMarker,
    pub patterns: Vec<HostPattern>,
    pub key_type: String,
    pub key_base64: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum HostKeyVerdict {
    Trusted,
    Unknown,
    Changed { known_key_base64: String },
    Revoked,
}

/// The exact text OpenSSH uses to key a host: bare for port 22, bracketed
/// otherwise. Hashed entries are HMACs of this string, so it has to match
/// byte for byte.
pub fn host_spec(host: &str, port: u16) -> String {
    if port == 22 {
        host.to_ascii_lowercase()
    } else {
        format!("[{}]:{}", host.to_ascii_lowercase(), port)
    }
}

pub fn parse(content: &str) -> Vec<KnownHostEntry> {
    content
        .lines()
        .filter_map(parse_line)
        .take(MAX_ENTRIES)
        .collect()
}

pub fn parse_line(line: &str) -> Option<KnownHostEntry> {
    let line = line.trim();
    if line.is_empty() || line.starts_with('#') {
        return None;
    }

    let mut fields = line.split_whitespace();
    let mut first = fields.next()?;

    let marker = match first {
        "@cert-authority" => {
            first = fields.next()?;
            EntryMarker::CertAuthority
        }
        "@revoked" => {
            first = fields.next()?;
            EntryMarker::Revoked
        }
        _ => EntryMarker::None,
    };

    let patterns: Vec<HostPattern> = first.split(',').filter_map(parse_pattern).collect();
    if patterns.is_empty() {
        return None;
    }

    let key_type = fields.next()?.to_string();
    let key_base64 = fields.next()?.to_string();
    if key_type.is_empty() || key_base64.is_empty() {
        return None;
    }

    Some(KnownHostEntry {
        marker,
        patterns,
        key_type,
        key_base64,
    })
}

fn parse_pattern(raw: &str) -> Option<HostPattern> {
    if raw.is_empty() {
        return None;
    }
    if let Some(rest) = raw.strip_prefix("|1|") {
        let (salt, hash) = rest.split_once('|')?;
        let salt = STANDARD.decode(salt).ok()?;
        let hash = STANDARD.decode(hash).ok()?;
        if salt.is_empty() || hash.is_empty() {
            return None;
        }
        return Some(HostPattern::Hashed { salt, hash });
    }
    match raw.strip_prefix('!') {
        Some(negated) if !negated.is_empty() => {
            Some(HostPattern::Negated(negated.to_ascii_lowercase()))
        }
        Some(_) => None,
        None => Some(HostPattern::Plain(raw.to_ascii_lowercase())),
    }
}

fn hashed_matches(salt: &[u8], hash: &[u8], spec: &str) -> bool {
    let key = ring::hmac::Key::new(ring::hmac::HMAC_SHA1_FOR_LEGACY_USE_ONLY, salt);
    ring::hmac::verify(&key, spec.as_bytes(), hash).is_ok()
}

/// OpenSSH host patterns accept `*` and `?`, and nothing else.
fn glob_matches(pattern: &str, value: &str) -> bool {
    let p: Vec<char> = pattern.chars().collect();
    let v: Vec<char> = value.chars().collect();
    let (mut pi, mut vi) = (0usize, 0usize);
    let (mut star, mut backtrack) = (None, 0usize);

    while vi < v.len() {
        if pi < p.len() && (p[pi] == '?' || p[pi] == v[vi]) {
            pi += 1;
            vi += 1;
        } else if pi < p.len() && p[pi] == '*' {
            star = Some(pi);
            backtrack = vi;
            pi += 1;
        } else if let Some(s) = star {
            pi = s + 1;
            backtrack += 1;
            vi = backtrack;
        } else {
            return false;
        }
    }
    p[pi..].iter().all(|c| *c == '*')
}

pub fn entry_matches(entry: &KnownHostEntry, spec: &str) -> bool {
    let mut matched = false;
    for pattern in &entry.patterns {
        match pattern {
            HostPattern::Negated(p) => {
                if glob_matches(p, spec) {
                    return false;
                }
            }
            HostPattern::Plain(p) => {
                if glob_matches(p, spec) {
                    matched = true;
                }
            }
            HostPattern::Hashed { salt, hash } => {
                if hashed_matches(salt, hash, spec) {
                    matched = true;
                }
            }
        }
    }
    matched
}

/// Compare a presented host key against the known entries.
///
/// A host that is known under other key types but not this one is `Unknown`,
/// not `Changed`: OpenSSH treats an unseen algorithm as a first sighting.
pub fn verify(
    entries: &[KnownHostEntry],
    host: &str,
    port: u16,
    key_type: &str,
    key_base64: &str,
) -> HostKeyVerdict {
    let spec = host_spec(host, port);
    let matching: Vec<&KnownHostEntry> =
        entries.iter().filter(|e| entry_matches(e, &spec)).collect();

    // Revocation is scanned first: a revoked key must lose to nothing, whatever
    // order the entries happen to sit in.
    if matching
        .iter()
        .any(|e| e.marker == EntryMarker::Revoked && e.key_base64 == key_base64)
    {
        return HostKeyVerdict::Revoked;
    }

    let mut changed: Option<String> = None;
    for entry in matching {
        if entry.marker != EntryMarker::None || entry.key_type != key_type {
            continue;
        }
        if entry.key_base64 == key_base64 {
            return HostKeyVerdict::Trusted;
        }
        changed.get_or_insert_with(|| entry.key_base64.clone());
    }

    match changed {
        Some(known_key_base64) => HostKeyVerdict::Changed { known_key_base64 },
        None => HostKeyVerdict::Unknown,
    }
}

/// The line to append once the user accepts a key. Always plain, never hashed:
/// hashing is the writing tool's choice and OpenSSH reads both.
pub fn entry_line(host: &str, port: u16, key_type: &str, key_base64: &str) -> String {
    format!("{} {} {}", host_spec(host, port), key_type, key_base64)
}

#[cfg(test)]
mod tests {
    use super::*;

    const KEY_A: &str = "AAAAC3NzaC1lZDI1NTE5AAAAIGtestkeyAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    const KEY_B: &str = "AAAAC3NzaC1lZDI1NTE5AAAAIGotherkeyAAAAAAAAAAAAAAAAAAAAAAAAAA";

    fn entries(content: &str) -> Vec<KnownHostEntry> {
        parse(content)
    }

    #[test]
    fn host_spec_brackets_only_non_default_ports() {
        assert_eq!(host_spec("Example.com", 22), "example.com");
        assert_eq!(host_spec("example.com", 2222), "[example.com]:2222");
    }

    #[test]
    fn comments_and_blank_lines_are_skipped() {
        assert!(parse_line("").is_none());
        assert!(parse_line("   ").is_none());
        assert!(parse_line("# a comment").is_none());
    }

    #[test]
    fn truncated_lines_are_skipped() {
        assert!(parse_line("example.com ssh-ed25519").is_none());
        assert!(parse_line("@revoked").is_none());
    }

    #[test]
    fn a_matching_key_is_trusted() {
        let known = entries(&format!("example.com ssh-ed25519 {KEY_A}\n"));
        assert_eq!(
            verify(&known, "example.com", 22, "ssh-ed25519", KEY_A),
            HostKeyVerdict::Trusted
        );
    }

    #[test]
    fn an_unseen_host_is_unknown() {
        let known = entries(&format!("example.com ssh-ed25519 {KEY_A}\n"));
        assert_eq!(
            verify(&known, "other.com", 22, "ssh-ed25519", KEY_A),
            HostKeyVerdict::Unknown
        );
    }

    #[test]
    fn a_different_key_for_the_same_type_has_changed() {
        let known = entries(&format!("example.com ssh-ed25519 {KEY_A}\n"));
        assert_eq!(
            verify(&known, "example.com", 22, "ssh-ed25519", KEY_B),
            HostKeyVerdict::Changed {
                known_key_base64: KEY_A.to_string()
            }
        );
    }

    #[test]
    fn a_known_host_with_a_new_key_type_is_unknown_not_changed() {
        let known = entries(&format!("example.com ssh-ed25519 {KEY_A}\n"));
        assert_eq!(
            verify(&known, "example.com", 22, "ssh-rsa", KEY_B),
            HostKeyVerdict::Unknown
        );
    }

    #[test]
    fn a_revoked_key_is_reported_even_when_another_entry_trusts_it() {
        let known = entries(&format!(
            "example.com ssh-ed25519 {KEY_A}\n@revoked example.com ssh-ed25519 {KEY_A}\n"
        ));
        assert_eq!(
            verify(&known, "example.com", 22, "ssh-ed25519", KEY_A),
            HostKeyVerdict::Revoked
        );
    }

    #[test]
    fn revoking_a_different_key_does_not_block_the_trusted_one() {
        let known = entries(&format!(
            "@revoked example.com ssh-ed25519 {KEY_B}\nexample.com ssh-ed25519 {KEY_A}\n"
        ));
        assert_eq!(
            verify(&known, "example.com", 22, "ssh-ed25519", KEY_A),
            HostKeyVerdict::Trusted
        );
    }

    #[test]
    fn a_cert_authority_entry_never_reports_changed() {
        let known = entries(&format!(
            "@cert-authority *.example.com ssh-ed25519 {KEY_A}\n"
        ));
        assert_eq!(
            verify(&known, "host.example.com", 22, "ssh-ed25519", KEY_B),
            HostKeyVerdict::Unknown
        );
    }

    #[test]
    fn a_non_default_port_only_matches_its_bracketed_entry() {
        let known = entries(&format!("[example.com]:2222 ssh-ed25519 {KEY_A}\n"));
        assert_eq!(
            verify(&known, "example.com", 2222, "ssh-ed25519", KEY_A),
            HostKeyVerdict::Trusted
        );
        assert_eq!(
            verify(&known, "example.com", 22, "ssh-ed25519", KEY_A),
            HostKeyVerdict::Unknown
        );
    }

    #[test]
    fn wildcards_and_negations_are_honoured() {
        let known = entries(&format!(
            "*.example.com,!secret.example.com ssh-ed25519 {KEY_A}\n"
        ));
        assert_eq!(
            verify(&known, "web.example.com", 22, "ssh-ed25519", KEY_A),
            HostKeyVerdict::Trusted
        );
        assert_eq!(
            verify(&known, "secret.example.com", 22, "ssh-ed25519", KEY_A),
            HostKeyVerdict::Unknown
        );
    }

    #[test]
    fn glob_handles_leading_and_repeated_stars() {
        assert!(glob_matches("*", "anything"));
        assert!(glob_matches("*.example.com", "a.b.example.com"));
        assert!(glob_matches("h?st", "host"));
        assert!(!glob_matches("h?st", "hoost"));
        assert!(glob_matches("a**b", "ab"));
        assert!(!glob_matches("*.example.com", "example.com"));
    }

    #[test]
    fn a_hashed_entry_matches_its_host() {
        let spec = host_spec("example.com", 22);
        let salt = [7u8; 20];
        let key = ring::hmac::Key::new(ring::hmac::HMAC_SHA1_FOR_LEGACY_USE_ONLY, &salt);
        let digest = ring::hmac::sign(&key, spec.as_bytes());
        let line = format!(
            "|1|{}|{} ssh-ed25519 {KEY_A}",
            STANDARD.encode(salt),
            STANDARD.encode(digest.as_ref())
        );

        let known = entries(&line);
        assert_eq!(
            verify(&known, "example.com", 22, "ssh-ed25519", KEY_A),
            HostKeyVerdict::Trusted
        );
        assert_eq!(
            verify(&known, "other.com", 22, "ssh-ed25519", KEY_A),
            HostKeyVerdict::Unknown
        );
    }

    #[test]
    fn a_malformed_hashed_entry_is_skipped() {
        assert!(parse_line("|1|notbase64 ssh-ed25519 AAAA").is_none());
        assert!(parse_line("|1||| ssh-ed25519 AAAA").is_none());
    }

    #[test]
    fn entry_line_round_trips_through_the_parser() {
        let line = entry_line("example.com", 2222, "ssh-ed25519", KEY_A);
        let parsed = parse_line(&line).expect("line parses");
        assert_eq!(parsed.key_type, "ssh-ed25519");
        assert!(entry_matches(&parsed, &host_spec("example.com", 2222)));
    }
}
