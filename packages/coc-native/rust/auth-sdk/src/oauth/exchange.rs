use super::http::{Form, HttpTransport};
use crate::{contracts::fail, AuthError, ErrorCode, Secret};
use serde::Deserialize;
use tokio_util::sync::CancellationToken;

/// Token endpoint fields only. An ID token here is unverified, not account evidence.
/// No credential fallback, persistence, or absolute-expiry calculation is performed.
#[derive(Deserialize)]
pub struct OAuthRefreshResponse {
    pub access_token: Secret,
    pub token_type: String,
    pub expires_in: u64,
    pub refresh_token: Option<Secret>,
    pub id_token: Option<Secret>,
    pub scope: Option<String>,
}

/// Exact rejections relevant to a caller-owned cache's invalidation policy.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum OAuthRefreshRejection {
    InvalidGrant,
    InteractionRequired,
    ConsentRequired,
}

/// Safe exchange diagnostics; provider descriptions and unknown error strings are discarded.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OAuthRefreshError {
    pub error: AuthError,
    pub status: Option<u16>,
    pub rejection: Option<OAuthRefreshRejection>,
}

impl From<AuthError> for OAuthRefreshError {
    fn from(error: AuthError) -> Self {
        Self { error, status: None, rejection: None }
    }
}

impl OAuthRefreshError {
    pub(crate) fn with_status(mut self, status: u16) -> Self {
        self.status = Some(status);
        self
    }
}

impl std::fmt::Display for OAuthRefreshError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        self.error.fmt(f)
    }
}

impl std::error::Error for OAuthRefreshError {}

/// Parses a token endpoint response body. Validates field ranges and types.
pub fn parse_token_response(
    body: &str,
    status: u16,
) -> std::result::Result<OAuthRefreshResponse, OAuthRefreshError> {
    if status != 200 {
        #[derive(Deserialize)]
        struct Failure {
            error: String,
        }
        let error = serde_json::from_str::<Failure>(body)
            .map_err(|_| AuthError::new(ErrorCode::InvalidTokenResponse))?;
        let rejection = match error.error.as_str() {
            "invalid_grant" => Some(OAuthRefreshRejection::InvalidGrant),
            "interaction_required" => Some(OAuthRefreshRejection::InteractionRequired),
            "consent_required" => Some(OAuthRefreshRejection::ConsentRequired),
            _ => None,
        };
        let code = match error.error.as_str() {
            "invalid_grant" | "interaction_required" | "login_required" | "consent_required" => {
                ErrorCode::InteractionRequired
            }
            "access_denied" | "authorization_declined" => ErrorCode::AccessDenied,
            "expired_token" => ErrorCode::TokenExpired,
            _ => ErrorCode::InvalidTokenResponse,
        };
        return Err(OAuthRefreshError {
            error: AuthError::new(code),
            status: Some(status),
            rejection,
        });
    }
    let response: OAuthRefreshResponse =
        serde_json::from_str(body).map_err(|_| AuthError::new(ErrorCode::InvalidTokenResponse))?;
    if response.access_token.expose().is_empty()
        || response.access_token.expose().len() > 1024 * 1024
        || response.access_token.expose().chars().any(char::is_whitespace)
        || !response.token_type.eq_ignore_ascii_case("bearer")
        || response.expires_in == 0
        || response.expires_in > 604800
        || response
            .scope
            .as_ref()
            .is_some_and(|s| s.len() > 16384 || s.chars().any(char::is_control))
    {
        return Err(AuthError::new(ErrorCode::InvalidTokenResponse).into());
    }
    Ok(response)
}

/// Vendor-neutral options for a refresh token exchange.
pub struct ExchangeOptions<'a> {
    /// The token endpoint URL (e.g. `https://login.microsoftonline.com/common/oauth2/v2.0/token`).
    pub token_endpoint: &'a str,
    pub client_id: &'a str,
    pub scopes: &'a [String],
    pub resource: Option<&'a str>,
}

/// Exchanges caller-owned credentials without discovery, identity verification or storage access.
/// The caller retains scope policy, credential coordination and persistence ownership.
pub async fn exchange_refresh_token(
    http: &dyn HttpTransport,
    options: &ExchangeOptions<'_>,
    refresh: &Secret,
    cancel: &CancellationToken,
    deadline: tokio::time::Instant,
) -> std::result::Result<OAuthRefreshResponse, OAuthRefreshError> {
    crate::contracts::checkpoint(cancel, deadline)?;
    if refresh.expose().is_empty()
        || refresh.expose().len() > 1024 * 1024
        || refresh.expose().chars().any(char::is_control)
    {
        return Err(AuthError::new(ErrorCode::InvalidConfiguration).into());
    }
    let mut form = Form(vec![
        ("grant_type".into(), "refresh_token".into()),
        ("client_id".into(), options.client_id.to_owned()),
        ("refresh_token".into(), refresh.expose().to_owned()),
        ("scope".into(), options.scopes.join(" ")),
    ]);
    if let Some(resource) = options.resource {
        form.push(("resource".into(), resource.to_owned()));
    }
    let output = tokio::select! {
        biased;
        _ = cancel.cancelled() => Err(AuthError::new(ErrorCode::Cancelled)),
        output = tokio::time::timeout_at(deadline, http.request(options.token_endpoint, Some(&form))) =>
            output.unwrap_or_else(|_| fail(ErrorCode::TimedOut)),
    };
    crate::contracts::checkpoint(cancel, deadline)?;
    let output = output?;
    let response = parse_token_response(output.body.expose(), output.status)
        .map_err(|error| error.with_status(output.status))?;
    if response.refresh_token.as_ref().is_some_and(|secret| {
        secret.expose().is_empty()
            || secret.expose().len() > 1024 * 1024
            || secret.expose().chars().any(char::is_control)
    }) {
        return Err(OAuthRefreshError::from(AuthError::new(ErrorCode::InvalidTokenResponse))
            .with_status(output.status));
    }
    crate::contracts::checkpoint(cancel, deadline)?;
    Ok(response)
}
