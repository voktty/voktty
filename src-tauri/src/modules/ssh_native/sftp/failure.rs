//! Telling a dead transport apart from a refused operation.
//!
//! The distinction decides whether the SFTP channel is reopened. Reopening on
//! every failure would hammer the server on a plain permission error; never
//! reopening would leave the panel dead after one dropped connection.

use russh_sftp::client::error::Error as SftpError;
use russh_sftp::protocol::StatusCode;

use super::super::types::{SshErrorCode, SshNativeError};

/// True only when the channel itself is gone, so the caller should reopen it.
pub fn is_transport_dead(error: &SftpError) -> bool {
    match error {
        SftpError::IO(_) | SftpError::Timeout | SftpError::UnexpectedPacket => true,
        SftpError::UnexpectedBehavior(_) | SftpError::Limited(_) => false,
        SftpError::Status(status) => matches!(
            status.status_code,
            StatusCode::NoConnection | StatusCode::ConnectionLost
        ),
    }
}

/// Map an SFTP failure onto the module's error type, keeping the server's own
/// wording, which is usually more precise than anything invented here.
pub fn classify(error: SftpError, context: &str) -> SshNativeError {
    let code = match &error {
        SftpError::Timeout => SshErrorCode::Timeout,
        SftpError::IO(_) => SshErrorCode::Unreachable,
        SftpError::Status(status) => match status.status_code {
            StatusCode::NoConnection | StatusCode::ConnectionLost => SshErrorCode::Unreachable,
            StatusCode::NoSuchFile => SshErrorCode::NotFound,
            _ => SshErrorCode::Protocol,
        },
        _ => SshErrorCode::Protocol,
    };
    SshNativeError::new(code, format!("{context}: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use russh_sftp::protocol::Status;

    fn status(code: StatusCode) -> SftpError {
        SftpError::Status(Status {
            id: 1,
            status_code: code,
            error_message: "server said so".into(),
            language_tag: String::new(),
        })
    }

    #[test]
    fn a_refused_operation_is_not_a_dead_transport() {
        assert!(!is_transport_dead(&status(StatusCode::PermissionDenied)));
        assert!(!is_transport_dead(&status(StatusCode::NoSuchFile)));
        assert!(!is_transport_dead(&status(StatusCode::Failure)));
        assert!(!is_transport_dead(&SftpError::Limited("too big".into())));
    }

    #[test]
    fn a_lost_channel_is_a_dead_transport() {
        assert!(is_transport_dead(&status(StatusCode::ConnectionLost)));
        assert!(is_transport_dead(&status(StatusCode::NoConnection)));
        assert!(is_transport_dead(&SftpError::IO("broken pipe".into())));
        assert!(is_transport_dead(&SftpError::Timeout));
    }

    #[test]
    fn classification_keeps_the_server_wording_and_the_operation() {
        let error = classify(status(StatusCode::PermissionDenied), "read /etc/shadow");
        assert_eq!(error.code, SshErrorCode::Protocol);
        assert!(error.message.contains("read /etc/shadow"));
        assert!(error.message.contains("Permission denied"));
    }

    #[test]
    fn only_a_missing_path_is_classified_as_not_found() {
        assert_eq!(
            classify(status(StatusCode::NoSuchFile), "stat /x").code,
            SshErrorCode::NotFound
        );
        // A permission error must never look like a missing file.
        assert_eq!(
            classify(status(StatusCode::PermissionDenied), "stat /x").code,
            SshErrorCode::Protocol
        );
        assert_eq!(
            classify(status(StatusCode::Failure), "stat /x").code,
            SshErrorCode::Protocol
        );
    }

    #[test]
    fn a_timeout_and_a_lost_link_get_distinct_codes() {
        assert_eq!(
            classify(SftpError::Timeout, "list /").code,
            SshErrorCode::Timeout
        );
        assert_eq!(
            classify(status(StatusCode::ConnectionLost), "list /").code,
            SshErrorCode::Unreachable
        );
    }
}
