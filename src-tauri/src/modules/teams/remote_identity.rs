pub(super) fn normalize(value: &str) -> Result<String, String> {
    let rest = value
        .strip_prefix("remote://voktty-ssh-")
        .ok_or("Team project requires a saved SSH namespace")?;
    if value.len() > 32768 || value.chars().any(char::is_control) || value.contains('\\') {
        return Err("Invalid remote team project".into());
    }
    let (encoded, path) = rest
        .split_once('/')
        .ok_or("Remote team project needs an absolute path")?;
    let mut decoded = Vec::new();
    let mut bytes = encoded.as_bytes().iter().copied();
    while let Some(byte) = bytes.next() {
        if byte == b'%' {
            let a = bytes
                .next()
                .and_then(|b| (b as char).to_digit(16))
                .ok_or("Invalid SSH connection encoding")?;
            let b = bytes
                .next()
                .and_then(|b| (b as char).to_digit(16))
                .ok_or("Invalid SSH connection encoding")?;
            decoded.push((a * 16 + b) as u8);
        } else {
            decoded.push(byte);
        }
    }
    let connection = std::str::from_utf8(&decoded).map_err(|_| "Invalid SSH connection ID")?;
    if connection.is_empty()
        || connection.len() > 256
        || connection.trim() != connection
        || connection.chars().any(char::is_control)
    {
        return Err("Invalid SSH connection ID".into());
    }
    let path = path.strip_suffix('/').unwrap_or(path);
    if path.is_empty()
        || path
            .split('/')
            .any(|part| part.is_empty() || part == "." || part == "..")
    {
        return Err("Remote team path must be absolute without empty or relative segments".into());
    }
    let mut normalized = String::new();
    for byte in decoded {
        if byte.is_ascii_alphanumeric() || b"-_.~".contains(&byte) {
            normalized.push(byte as char);
        } else {
            normalized.push_str(&format!("%{byte:02X}"));
        }
    }
    Ok(format!("remote://voktty-ssh-{normalized}/{path}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_encoded_connection_and_trailing_slash_without_folding_posix_case() {
        assert_eq!(
            normalize("remote://voktty-ssh-%6dini/srv/App/").unwrap(),
            "remote://voktty-ssh-mini/srv/App"
        );
        assert_ne!(
            normalize("remote://voktty-ssh-mini/srv/App").unwrap(),
            normalize("remote://voktty-ssh-mini/srv/app").unwrap()
        );
    }

    #[test]
    fn rejects_traversal_root_malformed_connections_and_double_slashes() {
        for value in [
            "remote://voktty-ssh-mini/srv/../escape",
            "remote://voktty-ssh-mini/srv/./app",
            "remote://voktty-ssh-mini/srv//app",
            "remote://voktty-ssh-mini/",
            "remote://voktty-ssh-/srv/app",
            "remote://voktty-ssh-%GG/srv/app",
            "remote://voktty-ssh-%00/srv/app",
            "remote://host/srv/app",
            "remote://voktty-ssh-mini/C:\\app",
        ] {
            assert!(normalize(value).is_err(), "accepted {value}");
        }
    }
}
