//! Read-only import of explicitly selected CLI credentials, not GitHub identity verification.

mod config;
#[cfg(test)]
mod tests;
#[cfg(any(windows, test))]
mod windows;

use crate::{
    contracts::{checkpoint, fail},
    AuthError, ErrorCode, Result, Secret,
};
use std::{path::PathBuf, time::Duration};
use tokio::process::Command;
use tokio_util::sync::CancellationToken;

#[derive(Clone, serde::Deserialize)]
pub struct GitHubAccount {
    pub host: String,
    pub login: String,
}

#[derive(Clone)]
pub enum CopilotAccountSelection {
    ActiveCliAccount,
    Explicit(GitHubAccount),
}

#[derive(Clone)]
pub enum GitHubCredentialSource {
    CopilotCliConfig { config_path: PathBuf, account: CopilotAccountSelection },
    GhCli { account: GitHubAccount },
}

#[derive(Clone)]
pub struct GitHubCredentialOptions {
    pub source: GitHubCredentialSource,
    pub timeout_ms: u32,
}

pub struct GitHubCredentialSnapshot {
    pub account: GitHubAccount,
    pub token: Secret,
}

fn normalize_host(value: &str) -> Result<String> {
    let host = if value.get(..8).is_some_and(|s| s.eq_ignore_ascii_case("https://")) {
        value[8..].strip_suffix('/').unwrap_or(&value[8..])
    } else {
        value
    };
    if host.is_empty()
        || !host.is_ascii()
        || !host.as_bytes()[0].is_ascii_alphanumeric()
        || !host.as_bytes()[host.len() - 1].is_ascii_alphanumeric()
        || !host.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'-')
    {
        return fail(ErrorCode::InvalidConfiguration);
    }
    let parsed = url::Url::parse(&format!("https://{host}"))
        .map_err(|_| AuthError::new(ErrorCode::InvalidConfiguration))?;
    parsed
        .host_str()
        .map(str::to_ascii_lowercase)
        .ok_or_else(|| AuthError::new(ErrorCode::InvalidConfiguration))
}

impl GitHubAccount {
    fn normalized(&self) -> Result<Self> {
        if self.login.is_empty()
            || !self.login.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
        {
            return fail(ErrorCode::InvalidConfiguration);
        }
        Ok(Self { host: normalize_host(&self.host)?, login: self.login.clone() })
    }
}

impl GitHubCredentialOptions {
    /// Validation only. The host supplies the resolved config path.
    pub fn validate(&self) -> Result<()> {
        if self.timeout_ms == 0 || self.timeout_ms > 10_000 {
            return fail(ErrorCode::InvalidConfiguration);
        }
        match &self.source {
            GitHubCredentialSource::CopilotCliConfig { config_path, account } => {
                if !config_path.is_absolute() {
                    return fail(ErrorCode::InvalidConfiguration);
                }
                if let CopilotAccountSelection::Explicit(account) = account {
                    account.normalized()?;
                }
            }
            GitHubCredentialSource::GhCli { account } => {
                account.normalized()?;
                // gh takes a hostname, not a URL.
                if account.host.contains('/') {
                    return fail(ErrorCode::InvalidConfiguration);
                }
            }
        }
        Ok(())
    }
}

async fn command_token(command: Command) -> Result<Secret> {
    let (success, output) = crate::process::run(command, 16_384).await?;
    if !success {
        return fail(ErrorCode::LoginRequired);
    }
    let token = output.expose().trim();
    if token.is_empty() {
        return fail(ErrorCode::InvalidTokenResponse);
    }
    Ok(Secret::new(token.to_owned()))
}

fn gh_command(account: &GitHubAccount) -> Command {
    let mut command = Command::new("gh");
    command.args(["auth", "token", "--hostname", &account.host, "--user", &account.login]);
    for name in ["GH_TOKEN", "GITHUB_TOKEN", "GH_ENTERPRISE_TOKEN", "GITHUB_ENTERPRISE_TOKEN"] {
        command.env_remove(name);
    }
    command
}

async fn os_token(account: &GitHubAccount) -> Result<Secret> {
    #[cfg(windows)]
    {
        let target = format!("copilot-cli/{}:{}", account.host, account.login);
        // CredReadW is synchronous. This worker cannot be preempted; cancelled results are discarded.
        tokio::task::spawn_blocking(move || windows::read(&target))
            .await
            .map_err(|_| AuthError::new(ErrorCode::StorageFailed))?
            .map_err(|_| AuthError::new(ErrorCode::StorageFailed))?
            .ok_or_else(|| AuthError::new(ErrorCode::LoginRequired))
    }
    #[cfg(target_os = "macos")]
    {
        let mut command = Command::new("/usr/bin/security");
        command.args([
            "find-generic-password",
            "-s",
            "copilot-cli",
            "-a",
            &format!("{}:{}", account.host, account.login),
            "-w",
        ]);
        command_token(command).await
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        let _ = account;
        fail(ErrorCode::StorageUnavailable)
    }
}

/// Each call resolves and reads anew. Cancellation belongs only to this request.
pub async fn read_credential(
    options: GitHubCredentialOptions,
    cancel: &CancellationToken,
) -> Result<GitHubCredentialSnapshot> {
    options.validate()?;
    let deadline = tokio::time::Instant::now() + Duration::from_millis(options.timeout_ms as u64);
    checkpoint(cancel, deadline)?;
    let work = async {
        let (stored, token) = match options.source {
            GitHubCredentialSource::CopilotCliConfig { config_path, account } => {
                let cancellation = cancel.clone();
                let (stored, token) = tokio::task::spawn_blocking(move || {
                    config::read(&config_path, &account, &cancellation, deadline)
                })
                .await
                .map_err(|_| AuthError::new(ErrorCode::StorageFailed))??;
                checkpoint(cancel, deadline)?;
                let token = match token {
                    Some(token) => token,
                    None => os_token(&stored).await?,
                };
                (stored, token)
            }
            GitHubCredentialSource::GhCli { account } => {
                let token = command_token(gh_command(&account)).await?;
                (account, token)
            }
        };
        if token.expose().is_empty() {
            return fail(ErrorCode::InvalidTokenResponse);
        }
        Ok(GitHubCredentialSnapshot { account: stored.normalized()?, token })
    };
    let result = tokio::select! {
        biased;
        _ = cancel.cancelled() => fail(ErrorCode::Cancelled),
        result = tokio::time::timeout_at(deadline, work) =>
            result.unwrap_or_else(|_| fail(ErrorCode::TimedOut)),
    };
    checkpoint(cancel, deadline)?;
    result
}
