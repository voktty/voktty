use std::path::Path;

/// Converts an already resolved native path to the application's display spelling.
/// This does not resolve links, normalize case, authorize access or qualify a host.
pub fn canonical_display_path(path: impl AsRef<Path>) -> String {
    let text = path.as_ref().to_string_lossy();
    #[cfg(windows)]
    {
        windows_display_path(&text)
    }
    #[cfg(not(windows))]
    {
        text.into_owned()
    }
}

/// Windows-only spelling rules, kept pure for shared tests on any host.
pub fn windows_display_path(text: &str) -> String {
    let stripped = if let Some(rest) = text.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{rest}")
    } else if let Some(rest) = text.strip_prefix(r"\\?\") {
        rest.to_string()
    } else {
        text.to_string()
    };
    stripped.replace('\\', "/")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn windows_spelling_preserves_case_unicode_and_unc_authority() {
        for (source, expected) in [
            (r"\\?\C:\Users\Éva", "C:/Users/Éva"),
            (r"\\?\UNC\server\share\dir", "//server/share/dir"),
            (r"C:\Users\foo", "C:/Users/foo"),
            ("C:/Users/foo", "C:/Users/foo"),
            (r"\\?\C:\", "C:/"),
        ] {
            assert_eq!(windows_display_path(source), expected);
            assert_eq!(windows_display_path(expected), expected);
        }
    }

    #[cfg(not(windows))]
    #[test]
    fn native_unix_paths_keep_literal_backslashes() {
        assert_eq!(
            canonical_display_path(r"/tmp/literal\name"),
            r"/tmp/literal\name"
        );
    }

    #[cfg(windows)]
    #[test]
    fn native_windows_conversion_uses_the_same_rules() {
        assert_eq!(canonical_display_path(r"\\?\C:\Users\Éva"), "C:/Users/Éva");
    }
}
