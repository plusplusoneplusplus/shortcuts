use crate::{CredentialStore, Result, Secret};
use async_trait::async_trait;
use tokio_util::sync::CancellationToken;

/// Claude's shared store needs the same macOS access identity as its CLI reader.
#[async_trait]
pub(super) trait ClaudeStore: Send + Sync {
    async fn read(&self, account: &str) -> Result<Option<Secret>>;
    async fn write(&self, account: &str, value: &Secret) -> Result<()>;
    fn validate_write(&self, _account: &str, _value: &Secret) -> Result<()> {
        Ok(())
    }
}

#[async_trait]
impl<T: CredentialStore + ?Sized> ClaudeStore for T {
    async fn read(&self, account: &str) -> Result<Option<Secret>> {
        CredentialStore::read(self, account)
    }
    async fn write(&self, account: &str, value: &Secret) -> Result<()> {
        CredentialStore::write(self, account, value)
    }
}

pub(super) fn store(
    cancel: &CancellationToken,
    deadline: tokio::time::Instant,
) -> impl ClaudeStore {
    #[cfg(target_os = "macos")]
    {
        macos::SecurityStore {
            service: super::MACOS_KEYCHAIN_SERVICE.into(),
            keychain: None,
            cancel: cancel.clone(),
            deadline,
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (cancel, deadline);
        crate::OsCredentialStore::new(super::MACOS_KEYCHAIN_SERVICE)
    }
}

#[cfg(target_os = "macos")]
pub(super) mod macos {
    use super::*;
    use crate::{AuthError, ErrorCode};
    use std::time::Duration;
    use tokio::process::Command;

    pub(in super::super) struct SecurityStore {
        pub service: String,
        pub keychain: Option<String>,
        pub cancel: CancellationToken,
        pub deadline: tokio::time::Instant,
    }

    fn write_input(
        service: &str,
        account: &str,
        value: &Secret,
        keychain: Option<&str>,
    ) -> Result<Secret> {
        use std::fmt::Write;
        if service
            .chars()
            .chain(account.chars())
            .chain(keychain.unwrap_or("").chars())
            .any(|c| c.is_control() || c == '"' || c == '\\')
        {
            return Err(AuthError::new(ErrorCode::InvalidConfiguration));
        }
        let quote = |text: &str| format!("\"{text}\"");
        let suffix = keychain.map(|k| format!(" {}", quote(k))).unwrap_or_default();
        let mut input = zeroize::Zeroizing::new(format!(
            "add-generic-password -U -s {} -a {} -X ",
            quote(service),
            quote(account)
        ));
        // security -i has a 4096-byte command buffer. Reject before launching;
        // otherwise it can report failure after writing a truncated credential.
        if input
            .len()
            .saturating_add(value.expose().len().saturating_mul(2))
            .saturating_add(suffix.len())
            >= 4095
        {
            return Err(AuthError::new(ErrorCode::InvalidConfiguration));
        }
        for byte in value.expose().as_bytes() {
            write!(input, "{byte:02x}").unwrap();
        }
        input.push_str(&suffix);
        input.push('\n');
        Ok(Secret::new(input.to_string()))
    }

    #[async_trait]
    impl ClaudeStore for SecurityStore {
        fn validate_write(&self, account: &str, value: &Secret) -> Result<()> {
            write_input(&self.service, account, value, self.keychain.as_deref()).map(|_| ())
        }
        async fn read(&self, account: &str) -> Result<Option<Secret>> {
            let mut command = Command::new("/usr/bin/security");
            command.args(["find-generic-password", "-s", &self.service, "-a", account, "-w"]);
            if let Some(keychain) = &self.keychain {
                command.arg(keychain);
            }
            let work = crate::process::run(command, 1024 * 1024);
            let (success, value) = tokio::select! {
                biased;
                _ = self.cancel.cancelled() => return Err(AuthError::new(ErrorCode::Cancelled)),
                result = tokio::time::timeout_at(self.deadline, work) =>
                    result.map_err(|_| AuthError::new(ErrorCode::TimedOut))??,
            };
            if !success {
                return Err(AuthError::new(ErrorCode::StorageDenied));
            }
            Ok(Some(Secret::new(value.expose().trim().to_owned())))
        }

        async fn write(&self, account: &str, value: &Secret) -> Result<()> {
            let input = write_input(&self.service, account, value, self.keychain.as_deref())?;
            let mut command = Command::new("/usr/bin/security");
            command.arg("-i");
            // Finish saving a rotated secret even if the request was cancelled.
            // A separate finite bound prevents a stuck Keychain prompt hanging it.
            let (success, _) = tokio::time::timeout(
                Duration::from_secs(5),
                crate::process::run_with_input(command, 16 * 1024, Some(&input)),
            )
            .await
            .map_err(|_| AuthError::new(ErrorCode::TimedOut))??;
            if success {
                Ok(())
            } else {
                Err(AuthError::new(ErrorCode::StorageFailed))
            }
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn credentials_are_only_in_stdin_and_oversized_commands_are_rejected() {
            let value = Secret::new("dummy-secret".into());
            let input = write_input("fixture", "account with spaces", &value, None).unwrap();
            assert_eq!(input.expose(), "add-generic-password -U -s \"fixture\" -a \"account with spaces\" -X 64756d6d792d736563726574\n");
            assert!(!input.expose().contains(value.expose()));
            assert!(
                write_input("fixture", "account", &Secret::new("x".repeat(2048)), None).is_err()
            );
            for invalid in ["account\nother-command", "account\"other", "account\\other"] {
                assert!(write_input("fixture", invalid, &value, None).is_err());
            }
        }

        #[tokio::test]
        async fn pre_cancelled_reads_do_not_launch_keychain_helper() {
            let cancel = CancellationToken::new();
            cancel.cancel();
            let store = SecurityStore {
                service: "unused-cancelled-fixture".into(),
                keychain: None,
                cancel,
                deadline: tokio::time::Instant::now() - Duration::from_secs(1),
            };
            assert_eq!(store.read("unused").await.err().unwrap().code, ErrorCode::Cancelled);
        }
    }
}
