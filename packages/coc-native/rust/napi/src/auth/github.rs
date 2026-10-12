use super::{configuration, error};
use auth_sdk::github::{
    self, CopilotAccountSelection, GitHubCredentialOptions, GitHubCredentialSource,
};
use auth_sdk::{AuthError, ErrorCode};
use napi::{bindgen_prelude::PromiseRaw, Env, Result};
use napi_derive::napi;
use std::sync::atomic::{AtomicBool, Ordering};
use tokio_util::sync::CancellationToken;

#[napi(object)]
pub struct GitHubAccount {
    pub host: String,
    pub login: String,
}
impl From<GitHubAccount> for github::GitHubAccount {
    fn from(value: GitHubAccount) -> Self {
        Self { host: value.host, login: value.login }
    }
}

#[napi(object)]
pub struct GitHubCredentialSnapshot {
    pub host: String,
    pub login: String,
    pub token: String,
}

/// One request, one cancellation token; never a cached provider or shared cancellation scope.
#[napi]
pub struct NativeGitHubCredentialRequest {
    options: GitHubCredentialOptions,
    cancel: CancellationToken,
    started: AtomicBool,
}

impl NativeGitHubCredentialRequest {
    fn new(source: GitHubCredentialSource, timeout_ms: Option<u32>) -> Result<Self> {
        let options = GitHubCredentialOptions { source, timeout_ms: timeout_ms.unwrap_or(10_000) };
        options.validate().map_err(error)?;
        Ok(Self { options, cancel: CancellationToken::new(), started: AtomicBool::new(false) })
    }
}

#[napi]
impl NativeGitHubCredentialRequest {
    #[napi(factory)]
    pub fn copilot_cli_config(
        config_path: String,
        account: Option<GitHubAccount>,
        timeout_ms: Option<u32>,
    ) -> Result<Self> {
        Self::new(
            GitHubCredentialSource::CopilotCliConfig {
                config_path: config_path.into(),
                account: account
                    .map(|a| CopilotAccountSelection::Explicit(a.into()))
                    .unwrap_or(CopilotAccountSelection::ActiveCliAccount),
            },
            timeout_ms,
        )
    }

    #[napi(factory)]
    pub fn gh_cli(account: GitHubAccount, timeout_ms: Option<u32>) -> Result<Self> {
        Self::new(GitHubCredentialSource::GhCli { account: account.into() }, timeout_ms)
    }

    #[napi]
    pub fn read<'env>(&self, env: &'env Env) -> Result<PromiseRaw<'env, GitHubCredentialSnapshot>> {
        if self.started.swap(true, Ordering::AcqRel) {
            return Err(configuration());
        }
        let mut options = self.options.clone();
        let cancel = self.cancel.clone();
        let publish = cancel.clone();
        let deadline =
            std::time::Instant::now() + std::time::Duration::from_millis(options.timeout_ms as u64);
        env.spawn_future_with_callback(
            async move {
                let remaining =
                    deadline.saturating_duration_since(std::time::Instant::now()).as_millis();
                if remaining == 0 {
                    return Err(error(AuthError::new(ErrorCode::TimedOut)));
                }
                options.timeout_ms = options.timeout_ms.min(remaining as u32);
                github::read_credential(options, &cancel).await.map_err(error)
            },
            move |_, snapshot| {
                if publish.is_cancelled() {
                    return Err(error(AuthError::new(ErrorCode::Cancelled)));
                }
                if std::time::Instant::now() >= deadline {
                    return Err(error(AuthError::new(ErrorCode::TimedOut)));
                }
                Ok(GitHubCredentialSnapshot {
                    host: snapshot.account.host,
                    login: snapshot.account.login,
                    token: snapshot.token.expose().to_owned(),
                })
            },
        )
    }

    #[napi]
    pub fn cancel(&self) {
        self.cancel.cancel();
    }
}

impl Drop for NativeGitHubCredentialRequest {
    fn drop(&mut self) {
        self.cancel.cancel();
    }
}
