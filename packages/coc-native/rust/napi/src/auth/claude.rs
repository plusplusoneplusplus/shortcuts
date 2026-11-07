use super::{configuration, error};
use auth_sdk::{
    claude::{
        self, ClaudeCredentialSources, ClaudeRefreshOptions, ClaudeToken, ClaudeTokenOptions,
    },
    oauth::{HttpTransport, OAuthRefreshError, ReqwestTransport},
    AuthError, ErrorCode,
};
use napi::{bindgen_prelude::PromiseRaw, Env, Error, Result};
use napi_derive::napi;
use std::{
    path::Path,
    sync::{
        atomic::{AtomicBool, AtomicU8, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};
use tokio_util::sync::CancellationToken;

#[derive(Clone)]
#[napi(object)]
pub struct ClaudeCredentialOptions {
    pub home_dir: String,
    pub coordination_directory: String,
    pub credentials_file: Option<String>,
    pub skip_keychain: Option<bool>,
    pub force_refresh: Option<bool>,
    pub timeout_ms: Option<u32>,
}

/// Refresh secrets stay in Rust; JS receives only the access credential and metadata.
#[napi(object)]
pub struct ClaudeCredentialSnapshot {
    pub access_token: String,
    pub expires_at: Option<f64>,
    pub scopes: Vec<String>,
    pub subscription_type: Option<String>,
    pub rate_limit_tier: Option<String>,
}

impl From<ClaudeToken> for ClaudeCredentialSnapshot {
    fn from(token: ClaudeToken) -> Self {
        Self {
            access_token: token.access_token.expose().to_owned(),
            expires_at: token.expires_at.map(|v| v as f64),
            scopes: token.scopes,
            subscription_type: token.subscription_type,
            rate_limit_tier: token.rate_limit_tier,
        }
    }
}

fn check(cancel: &CancellationToken, deadline: Instant) -> auth_sdk::Result<()> {
    if cancel.is_cancelled() {
        return Err(AuthError::new(ErrorCode::Cancelled));
    }
    if Instant::now() >= deadline {
        return Err(AuthError::new(ErrorCode::TimedOut));
    }
    Ok(())
}

async fn acquire(
    options: &ClaudeCredentialOptions,
    http: &dyn HttpTransport,
    cancel: &CancellationToken,
    deadline: Instant,
) -> std::result::Result<ClaudeToken, OAuthRefreshError> {
    check(cancel, deadline)?;
    let sources = ClaudeCredentialSources {
        home_dir: options.home_dir.clone().into(),
        credentials_file_override: options.credentials_file.as_ref().map(Into::into),
        skip_keychain: options.skip_keychain.unwrap_or(false),
    };
    let options = ClaudeTokenOptions {
        sources: &sources,
        coordination_dir: Path::new(&options.coordination_directory),
        // Endpoint/client overrides are deliberately not exposed to JavaScript.
        refresh: ClaudeRefreshOptions::default(),
        force_refresh: options.force_refresh.unwrap_or(false),
    };
    let token =
        claude::acquire_token(http, &options, cancel, tokio::time::Instant::from_std(deadline))
            .await?;
    check(cancel, deadline)?;
    Ok(token)
}

async fn acquire_on_worker(
    options: ClaudeCredentialOptions,
    http: Arc<dyn HttpTransport>,
    cancel: CancellationToken,
    deadline: Instant,
) -> std::result::Result<ClaudeToken, OAuthRefreshError> {
    check(&cancel, deadline)?;
    let runtime = tokio::runtime::Handle::current();
    let worker_cancel = cancel.clone();
    // 0 = queued, 1 = running, 2 = revoked before starting. The gate prevents
    // a queued closure from beginning I/O after its caller has settled.
    let state = Arc::new(AtomicU8::new(0));
    let worker_state = state.clone();
    let mut worker = tokio::task::spawn_blocking(move || {
        if worker_state.compare_exchange(0, 1, Ordering::AcqRel, Ordering::Acquire).is_err() {
            return Err(AuthError::new(ErrorCode::Cancelled).into());
        }
        runtime.block_on(acquire(&options, http.as_ref(), &worker_cancel, deadline))
    });
    let failure = tokio::select! {
        biased;
        _ = cancel.cancelled() => ErrorCode::Cancelled,
        _ = tokio::time::sleep_until(tokio::time::Instant::from_std(deadline)) => ErrorCode::TimedOut,
        result = &mut worker => return result
            .map_err(|_| AuthError::new(ErrorCode::StorageFailed))?,
    };
    cancel.cancel();
    worker.abort();
    if state.compare_exchange(0, 2, Ordering::AcqRel, Ordering::Acquire).is_err() {
        // Running synchronous store transactions cannot be interrupted. Await
        // settlement so no detached writer can commit after this promise settles.
        // Queued work is revoked by the gate and cannot perform I/O, even if
        // Tokio does not dequeue its cancelled task until a worker becomes free.
        let _ = worker.await;
    }
    Err(AuthError::new(failure).into())
}

/// One acquisition, one cancellation scope. No cached provider or token state.
#[napi]
pub struct NativeClaudeCredentialRequest {
    options: ClaudeCredentialOptions,
    cancel: CancellationToken,
    started: AtomicBool,
}

impl NativeClaudeCredentialRequest {
    fn begin(&self) -> auth_sdk::Result<Instant> {
        if self.started.swap(true, Ordering::AcqRel) {
            return Err(AuthError::new(ErrorCode::InvalidConfiguration));
        }
        let deadline = Instant::now()
            + Duration::from_millis(self.options.timeout_ms.unwrap_or(30_000) as u64);
        check(&self.cancel, deadline)?;
        Ok(deadline)
    }
}

#[napi]
impl NativeClaudeCredentialRequest {
    #[napi(constructor)]
    pub fn new(options: ClaudeCredentialOptions) -> Result<Self> {
        let valid_path =
            |value: &str| Path::new(value).is_absolute() && !value.chars().any(char::is_control);
        if !valid_path(&options.home_dir)
            || !valid_path(&options.coordination_directory)
            || options.credentials_file.as_deref().is_some_and(|p| !valid_path(p))
            || !(100..=900_000).contains(&options.timeout_ms.unwrap_or(30_000))
        {
            return Err(configuration());
        }
        Ok(Self { options, cancel: CancellationToken::new(), started: AtomicBool::new(false) })
    }

    #[napi]
    pub fn acquire<'env>(
        &self,
        env: &'env Env,
    ) -> Result<PromiseRaw<'env, ClaudeCredentialSnapshot>> {
        let deadline = self.begin().map_err(error)?;
        let options = self.options.clone();
        let cancel = self.cancel.clone();
        let publish = cancel.clone();
        env.spawn_future_with_callback(
            async move {
                acquire_on_worker(options, Arc::new(ReqwestTransport), cancel, deadline)
                    .await
                    .map_err(|value| {
                        Error::from_reason(super::refresh::refresh_error_reason(value))
                    })
            },
            move |_, token| {
                check(&publish, deadline).map_err(error)?;
                Ok(ClaudeCredentialSnapshot::from(token))
            },
        )
    }

    #[napi]
    pub fn cancel(&self) {
        self.cancel.cancel();
    }
}

impl Drop for NativeClaudeCredentialRequest {
    fn drop(&mut self) {
        self.cancel.cancel();
    }
}

#[cfg(test)]
#[path = "claude_tests.rs"]
mod tests;
