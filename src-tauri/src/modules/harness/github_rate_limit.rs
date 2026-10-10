use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

struct GitHubRateLimitBackoff {
    until: SystemTime,
    error: String,
}

const FALLBACK_BACKOFF: Duration = Duration::from_secs(60);

static GITHUB_RATE_LIMIT_BACKOFF: Mutex<Option<GitHubRateLimitBackoff>> = Mutex::new(None);

pub(crate) fn run(
    args: &[&str],
    allow_empty: bool,
    execute: impl FnMut(&[&str], bool) -> Result<String, String>,
) -> Result<String, String> {
    run_with_backoff(&GITHUB_RATE_LIMIT_BACKOFF, args, allow_empty, execute)
}

fn active_rate_limit_error(
    backoff: &mut Option<GitHubRateLimitBackoff>,
    now: SystemTime,
) -> Option<String> {
    if let Some(active) = backoff.as_ref().filter(|active| now < active.until) {
        return Some(active.error.clone());
    }
    *backoff = None;
    None
}

fn run_with_backoff(
    backoff: &Mutex<Option<GitHubRateLimitBackoff>>,
    args: &[&str],
    allow_empty: bool,
    mut execute: impl FnMut(&[&str], bool) -> Result<String, String>,
) -> Result<String, String> {
    if let Ok(mut slot) = backoff.lock() {
        if let Some(error) = active_rate_limit_error(&mut slot, SystemTime::now()) {
            return Err(error);
        }
    }

    let result = execute(args, allow_empty);
    let Err(error) = &result else {
        return result;
    };
    let message = error.to_lowercase();
    let primary = message.contains("api rate limit") && message.contains("exceeded");
    let secondary = message.contains("secondary rate limit") || message.contains("abuse detection");
    if !primary && !secondary {
        return result;
    }

    if let Ok(mut slot) = backoff.lock() {
        if active_rate_limit_error(&mut slot, SystemTime::now()).is_some() {
            return result;
        }
        *slot = Some(GitHubRateLimitBackoff {
            until: SystemTime::now() + FALLBACK_BACKOFF,
            error: error.clone(),
        });
    } else {
        return result;
    }

    if primary && message.contains("graphql") {
        let reset = execute(
            &[
                "api",
                "graphql",
                "-f",
                "query=query { rateLimit { remaining resetAt } }",
            ],
            false,
        )
        .and_then(|json| parse_github_rate_limit_backoff(&json));
        if let Ok(until) = reset {
            if let Ok(mut slot) = backoff.lock() {
                *slot = until
                    .filter(|until| *until > SystemTime::now())
                    .map(|until| GitHubRateLimitBackoff {
                        until,
                        error: error.clone(),
                    });
            }
        }
    }

    result
}

fn parse_github_rate_limit_backoff(json: &str) -> Result<Option<SystemTime>, String> {
    let response: serde_json::Value =
        serde_json::from_str(json).map_err(|error| error.to_string())?;
    let rate = &response["data"]["rateLimit"];
    let remaining = rate["remaining"]
        .as_u64()
        .ok_or_else(|| "GitHub did not return its remaining quota".to_string())?;
    if remaining > 0 {
        return Ok(None);
    }
    let reset = rate["resetAt"]
        .as_str()
        .ok_or_else(|| "GitHub did not return its rate-limit reset".to_string())?;
    let seconds = chrono::DateTime::parse_from_rfc3339(reset)
        .map_err(|error| error.to_string())?
        .timestamp();
    let seconds = u64::try_from(seconds).map_err(|error| error.to_string())?;
    UNIX_EPOCH
        .checked_add(Duration::from_secs(seconds.saturating_add(1)))
        .map(Some)
        .ok_or_else(|| "Invalid GitHub rate-limit reset".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn primary_rate_limit_blocks_commands_until_the_reported_reset() {
        let backoff = Mutex::new(None);
        let error = "GraphQL: API rate limit already exceeded for user ID 1.";
        let mut calls = 0;
        let result = run_with_backoff(&backoff, &["pr", "list"], false, |args, _| {
            calls += 1;
            if args.first() == Some(&"api") {
                Ok(
                    r#"{"data":{"rateLimit":{"remaining":0,"resetAt":"2099-01-01T00:00:00Z"}}}"#
                        .into(),
                )
            } else {
                Err(error.into())
            }
        });
        assert_eq!(result.unwrap_err(), error);
        assert_eq!(calls, 2);

        assert_eq!(
            run_with_backoff(&backoff, &["issue", "view", "42"], false, |_, _| {
                panic!("Commands must stay blocked until the reported reset")
            })
            .unwrap_err(),
            error
        );
        backoff.lock().unwrap().as_mut().unwrap().until =
            SystemTime::now() - Duration::from_secs(1);
        assert_eq!(
            run_with_backoff(&backoff, &["pr", "list"], false, |_, _| {
                Ok("fresh".into())
            })
            .unwrap(),
            "fresh"
        );
        assert!(backoff.lock().unwrap().is_none());
    }

    #[test]
    fn failed_reset_probe_keeps_the_fallback_pause() {
        let backoff = Mutex::new(None);
        let mut calls = 0;
        assert!(run_with_backoff(&backoff, &["pr", "list"], false, |_, _| {
            calls += 1;
            if calls == 1 {
                Err("GraphQL: API rate limit already exceeded".into())
            } else {
                Err("offline".into())
            }
        })
        .is_err());
        assert_eq!(calls, 2);
        assert!(run_with_backoff(&backoff, &["pr", "view"], false, |_, _| {
            panic!("A failed reset probe must still pause requests")
        })
        .is_err());
    }

    #[test]
    fn secondary_rate_limits_pause_without_a_quota_probe() {
        let backoff = Mutex::new(None);
        let mut calls = 0;
        assert!(run_with_backoff(&backoff, &["pr", "list"], false, |_, _| {
            calls += 1;
            Err("You have exceeded a secondary rate limit".into())
        })
        .is_err());
        assert_eq!(calls, 1);
        assert!(backoff.lock().unwrap().is_some());
    }

    #[test]
    fn unrelated_errors_do_not_pause_later_commands() {
        let backoff = Mutex::new(None);
        assert!(run_with_backoff(&backoff, &["pr", "list"], false, |_, _| {
            Err("error connecting to api.github.com".into())
        })
        .is_err());
        assert!(backoff.lock().unwrap().is_none());
        assert_eq!(
            run_with_backoff(&backoff, &["pr", "view"], false, |_, _| Ok("fresh".into())).unwrap(),
            "fresh"
        );
    }

    #[test]
    fn reset_parser_checks_quota_and_rfc3339_timestamp() {
        let reset = parse_github_rate_limit_backoff(
            r#"{"data":{"rateLimit":{"remaining":0,"resetAt":"2026-10-06T13:48:40Z"}}}"#,
        )
        .unwrap()
        .unwrap();
        assert_eq!(reset, UNIX_EPOCH + Duration::from_secs(1_791_294_521));
        assert!(
            parse_github_rate_limit_backoff(r#"{"data":{"rateLimit":{"remaining":10}}}"#)
                .unwrap()
                .is_none()
        );
        assert!(parse_github_rate_limit_backoff(r#"{"errors":[{"message":"offline"}]}"#).is_err());
        assert!(parse_github_rate_limit_backoff(
            r#"{"data":{"rateLimit":{"remaining":0,"resetAt":"invalid"}}}"#
        )
        .is_err());
    }
}
