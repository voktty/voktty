use std::sync::LazyLock;

/// Saneador de seguridad y redacción de secretos antes de indexar en SQLite FTS5.
/// Previene la indexación y fuga de API keys, tokens JWT, certificados y contraseñas.
pub struct Sanitizer;

static RE_BEARER: LazyLock<regex::Regex> = LazyLock::new(|| {
    regex::Regex::new(r"(?i)\bBearer\s+([A-Za-z0-9\-\._~\+\/]+=*)").unwrap()
});

static RE_OPENAI_KEY: LazyLock<regex::Regex> = LazyLock::new(|| {
    regex::Regex::new(r"\bsk-[a-zA-Z0-9_-]{20,}\b").unwrap()
});

static RE_ANTHROPIC_KEY: LazyLock<regex::Regex> = LazyLock::new(|| {
    regex::Regex::new(r"\bsk-ant-[a-zA-Z0-9_-]{20,}\b").unwrap()
});

static RE_GITHUB_TOKEN: LazyLock<regex::Regex> = LazyLock::new(|| {
    regex::Regex::new(r"\b(ghp|gho|ghu|ghs|ghr|github_pat)_[a-zA-Z0-9_]{16,}\b").unwrap()
});

static RE_AWS_KEY: LazyLock<regex::Regex> = LazyLock::new(|| {
    regex::Regex::new(r"\bAKIA[0-9A-Z]{16}\b").unwrap()
});

static RE_GOOGLE_API_KEY: LazyLock<regex::Regex> = LazyLock::new(|| {
    regex::Regex::new(r"\bAIzaSy[a-zA-Z0-9_-]{33}\b").unwrap()
});

static RE_PRIVATE_KEY: LazyLock<regex::Regex> = LazyLock::new(|| {
    regex::Regex::new(r"-----BEGIN [A-Z ]+PRIVATE KEY-----[^-]+-----END [A-Z ]+PRIVATE KEY-----").unwrap()
});

impl Sanitizer {
    /// Sanea una cadena de texto, reemplazando secretos identificables con marcadores redactados.
    /// Retorna `(texto_saneado, hubo_redaccion)`.
    pub fn sanitize_text(input: &str) -> (String, bool) {
        if input.is_empty() {
            return (String::new(), false);
        }

        let mut redacted = false;
        let mut text = input.to_string();

        if RE_PRIVATE_KEY.is_match(&text) {
            text = RE_PRIVATE_KEY.replace_all(&text, "[REDACTED_PRIVATE_KEY]").into_owned();
            redacted = true;
        }

        if RE_OPENAI_KEY.is_match(&text) {
            text = RE_OPENAI_KEY.replace_all(&text, "sk-***[REDACTED_API_KEY]***").into_owned();
            redacted = true;
        }

        if RE_ANTHROPIC_KEY.is_match(&text) {
            text = RE_ANTHROPIC_KEY.replace_all(&text, "sk-ant-***[REDACTED_API_KEY]***").into_owned();
            redacted = true;
        }

        if RE_GITHUB_TOKEN.is_match(&text) {
            text = RE_GITHUB_TOKEN.replace_all(&text, "ghp_***[REDACTED_TOKEN]***").into_owned();
            redacted = true;
        }

        if RE_AWS_KEY.is_match(&text) {
            text = RE_AWS_KEY.replace_all(&text, "AKIA***[REDACTED_AWS_KEY]***").into_owned();
            redacted = true;
        }

        if RE_GOOGLE_API_KEY.is_match(&text) {
            text = RE_GOOGLE_API_KEY.replace_all(&text, "AIzaSy***[REDACTED_GOOGLE_KEY]***").into_owned();
            redacted = true;
        }

        if RE_BEARER.is_match(&text) {
            text = RE_BEARER.replace_all(&text, "Bearer [REDACTED_BEARER_TOKEN]").into_owned();
            redacted = true;
        }

        (text, redacted)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sanitize_clean_text() {
        let (out, red) = Sanitizer::sanitize_text("Hello, how are you doing?");
        assert_eq!(out, "Hello, how are you doing?");
        assert!(!red);
    }

    #[test]
    fn test_sanitize_openai_key() {
        let text = "Use key sk-proj-1234567890abcdef1234567890abcdef for request";
        let (out, red) = Sanitizer::sanitize_text(text);
        assert!(red);
        assert!(!out.contains("1234567890abcdef"));
        assert!(out.contains("[REDACTED_API_KEY]"));
    }

    #[test]
    fn test_sanitize_github_token() {
        let text = "export GITHUB_TOKEN=ghp_abcdef1234567890abcdef1234567890";
        let (out, red) = Sanitizer::sanitize_text(text);
        assert!(red);
        assert!(!out.contains("abcdef1234567890"));
        assert!(out.contains("[REDACTED_TOKEN]"));
    }

    #[test]
    fn test_sanitize_bearer() {
        let text = "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9";
        let (out, red) = Sanitizer::sanitize_text(text);
        assert!(red);
        assert!(out.contains("Bearer [REDACTED_BEARER_TOKEN]"));
    }
}