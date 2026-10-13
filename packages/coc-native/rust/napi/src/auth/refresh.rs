use super::error;
use auth_sdk::{
    microsoft::{
        exchange_refresh_token, OAuthRefreshError, OAuthRefreshOptions, OAuthRefreshRejection,
        OAuthRefreshResponse, ReqwestTransport,
    },
    AuthError, ErrorCode, Secret,
};
use napi::{bindgen_prelude::PromiseRaw, Env, Error, Result};
use napi_derive::napi;
use std::{
    sync::atomic::{AtomicBool, Ordering},
    time::{Duration, Instant},
};
use tokio_util::sync::CancellationToken;

#[napi(object)]
pub struct MicrosoftOAuthRefreshOptions {
    pub authority: String,
    pub client_id: String,
    pub scopes: Vec<String>,
    pub resource: Option<String>,
}

impl From<MicrosoftOAuthRefreshOptions> for OAuthRefreshOptions {
    fn from(value: MicrosoftOAuthRefreshOptions) -> Self {
        Self {
            authority: value.authority,
            client_id: value.client_id,
            scopes: value.scopes,
            resource: value.resource,
        }
    }
}

#[napi(object)]
pub struct MicrosoftOAuthRefreshResponse {
    pub access_token: String,
    pub token_type: String,
    /// Lifetime in seconds, as reported by the token endpoint.
    pub expires_in: u32,
    pub scope: Option<String>,
    pub refresh_token: Option<String>,
}

impl From<OAuthRefreshResponse> for MicrosoftOAuthRefreshResponse {
    fn from(value: OAuthRefreshResponse) -> Self {
        Self {
            access_token: value.access_token.expose().to_owned(),
            token_type: value.token_type,
            // The shared exchange validates a maximum lifetime of 604800 seconds.
            expires_in: value.expires_in as u32,
            scope: value.scope,
            refresh_token: value.refresh_token.as_ref().map(|secret| secret.expose().to_owned()),
        }
    }
}

fn refresh_error_reason(value: OAuthRefreshError) -> String {
    let rejection = match value.rejection {
        Some(OAuthRefreshRejection::InvalidGrant) => "invalid_grant",
        Some(OAuthRefreshRejection::InteractionRequired) => "interaction_required",
        Some(OAuthRefreshRejection::ConsentRequired) => "consent_required",
        None => "",
    };
    format!(
        "[auth-refresh:{:?}:{}:{}] Authentication operation failed.",
        value.error.code,
        value.status.map(|status| status.to_string()).unwrap_or_default(),
        rejection,
    )
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

/// Exchange only: no account discovery, credential store or token cache.
#[napi]
pub struct NativeMicrosoftOAuthRefreshRequest {
    options: OAuthRefreshOptions,
    timeout: Duration,
    cancel: CancellationToken,
    started: AtomicBool,
}

impl NativeMicrosoftOAuthRefreshRequest {
    fn begin(&self, refresh: String) -> auth_sdk::Result<(Secret, Instant)> {
        let refresh = Secret::new(refresh);
        if self.started.swap(true, Ordering::AcqRel) {
            return Err(AuthError::new(ErrorCode::InvalidConfiguration));
        }
        let deadline = Instant::now() + self.timeout;
        check(&self.cancel, deadline)?;
        Ok((refresh, deadline))
    }
}

#[napi]
impl NativeMicrosoftOAuthRefreshRequest {
    #[napi(constructor)]
    pub fn new(options: MicrosoftOAuthRefreshOptions, timeout_ms: Option<u32>) -> Result<Self> {
        let options = OAuthRefreshOptions::from(options);
        options.validate().map_err(error)?;
        let timeout_ms = timeout_ms.unwrap_or(30_000);
        if !(100..=900_000).contains(&timeout_ms) {
            return Err(error(AuthError::new(ErrorCode::InvalidConfiguration)));
        }
        Ok(Self {
            options,
            timeout: Duration::from_millis(timeout_ms as u64),
            cancel: CancellationToken::new(),
            started: AtomicBool::new(false),
        })
    }

    #[napi]
    pub fn exchange<'env>(
        &self,
        env: &'env Env,
        refresh_token: String,
    ) -> Result<PromiseRaw<'env, MicrosoftOAuthRefreshResponse>> {
        let (refresh, deadline) = self.begin(refresh_token).map_err(error)?;
        let options = self.options.clone();
        let cancel = self.cancel.clone();
        let publish = cancel.clone();
        env.spawn_future_with_callback(
            async move {
                exchange_refresh_token(
                    &ReqwestTransport,
                    &options,
                    &refresh,
                    &cancel,
                    tokio::time::Instant::from_std(deadline),
                )
                .await
                .map_err(|value| Error::from_reason(refresh_error_reason(value)))
            },
            move |_, response| {
                check(&publish, deadline).map_err(error)?;
                Ok(MicrosoftOAuthRefreshResponse::from(response))
            },
        )
    }

    #[napi]
    pub fn cancel(&self) {
        self.cancel.cancel();
    }
}

impl Drop for NativeMicrosoftOAuthRefreshRequest {
    fn drop(&mut self) {
        self.cancel.cancel();
    }
}

#[cfg(test)]
#[path = "refresh_tests.rs"]
mod tests;
