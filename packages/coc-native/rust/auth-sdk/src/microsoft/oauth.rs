use super::{
    coordination::CredentialLock, identity, Dependencies, HttpTransport, OAuthOptions,
    OAuthRefreshOptions,
};
use crate::{
    contracts::{fail, Lifetime},
    Account, AuthError, CredentialStore, ErrorCode, Result, Secret, Token,
};
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

pub(crate) type TokenResponse = OAuthRefreshResponse;

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
    fn with_status(mut self, status: u16) -> Self {
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

pub(crate) fn response(body: &str, status: u16) -> Result<TokenResponse> {
    exchange_response(body, status).map_err(|error| error.error)
}

fn exchange_response(
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
    let response: TokenResponse =
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

/// Exchanges caller-owned credentials without discovery, identity verification or storage access.
/// The caller retains scope policy, credential coordination and persistence ownership.
pub async fn exchange_refresh_token(
    http: &dyn HttpTransport,
    options: &OAuthRefreshOptions,
    refresh: &Secret,
    cancel: &CancellationToken,
    deadline: tokio::time::Instant,
) -> std::result::Result<OAuthRefreshResponse, OAuthRefreshError> {
    crate::contracts::checkpoint(cancel, deadline)?;
    options.validate()?;
    if refresh.expose().is_empty()
        || refresh.expose().len() > 1024 * 1024
        || refresh.expose().chars().any(char::is_control)
    {
        return Err(AuthError::new(ErrorCode::InvalidConfiguration).into());
    }
    let mut form = super::http::Form(vec![
        ("grant_type".into(), "refresh_token".into()),
        ("client_id".into(), options.client_id.clone()),
        ("refresh_token".into(), refresh.expose().to_owned()),
        ("scope".into(), options.scopes.join(" ")),
    ]);
    if let Some(resource) = &options.resource {
        form.push(("resource".into(), resource.clone()));
    }
    let endpoint = options.token_endpoint();
    let output = tokio::select! {
        biased;
        _ = cancel.cancelled() => Err(AuthError::new(ErrorCode::Cancelled)),
        output = tokio::time::timeout_at(deadline, http.request(&endpoint, Some(&form))) =>
            output.unwrap_or_else(|_| fail(ErrorCode::TimedOut)),
    };
    crate::contracts::checkpoint(cancel, deadline)?;
    let output = output?;
    let response = exchange_response(output.body.expose(), output.status)
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

pub(crate) fn account_matches(actual: &Account, expected: &Account) -> bool {
    actual.id.eq_ignore_ascii_case(&expected.id)
        && actual.tenant.eq_ignore_ascii_case(&expected.tenant)
}

pub(crate) fn read_credential(
    store: &dyn CredentialStore,
    key: &str,
    expected: &Account,
) -> Result<Secret> {
    let value = store.read(key)?.ok_or_else(|| AuthError::new(ErrorCode::InteractionRequired))?;
    let mut parts = value.expose().splitn(4, '\n');
    if parts.next() != Some("v1")
        || parts.next() != Some(&expected.tenant.to_ascii_lowercase())
        || parts.next() != Some(&expected.id.to_ascii_lowercase())
    {
        return fail(ErrorCode::StorageFailed);
    }
    let secret = parts
        .next()
        .filter(|s| !s.is_empty() && !s.chars().any(char::is_control))
        .ok_or_else(|| AuthError::new(ErrorCode::StorageFailed))?;
    Ok(Secret::new(secret.to_owned()))
}

pub(crate) fn persist(
    store: &dyn CredentialStore,
    key: &str,
    account: &Account,
    refresh: &Secret,
    life: &Lifetime,
    cancel: &tokio_util::sync::CancellationToken,
    deadline: tokio::time::Instant,
) -> Result<()> {
    if refresh.expose().is_empty() || refresh.expose().chars().any(char::is_control) {
        return fail(ErrorCode::InvalidTokenResponse);
    }
    let value = Secret::new(format!(
        "v1\n{}\n{}\n{}",
        account.tenant.to_ascii_lowercase(),
        account.id.to_ascii_lowercase(),
        refresh.expose()
    ));
    life.publish(|| {
        crate::contracts::checkpoint(cancel, deadline)?;
        store.write(key, &value)
    })
}

pub(crate) fn token(
    response: TokenResponse,
    options: &OAuthOptions,
    account: Account,
    now: u64,
) -> Result<Token> {
    let expires_at = now
        .checked_add(response.expires_in * 1000)
        .ok_or_else(|| AuthError::new(ErrorCode::InvalidTokenResponse))?;
    if expires_at > 9_007_199_254_740_991 {
        return fail(ErrorCode::InvalidTokenResponse);
    }
    Ok(Token {
        access_token: response.access_token,
        token_type: response.token_type,
        expires_at,
        source: "oauth".into(),
        target: options.target.clone(),
        account,
        granted_scopes: response.scope.map(|s| s.split_whitespace().map(str::to_owned).collect()),
    })
}

pub(crate) async fn acquire(
    dependencies: &Dependencies,
    options: &OAuthOptions,
    account: &Account,
    life: &Lifetime,
    cancel: &tokio_util::sync::CancellationToken,
    deadline: tokio::time::Instant,
) -> Result<Token> {
    let key = options.credential_key(account);
    let _lock = CredentialLock::acquire(&options.coordination_dir, &key).await?;
    let refresh = read_credential(dependencies.store.as_ref(), &key, account)?;
    let metadata = identity::metadata(dependencies.http.as_ref(), options).await?;
    let response = exchange_refresh_token(
        dependencies.http.as_ref(),
        &OAuthRefreshOptions::from(options),
        &refresh,
        cancel,
        deadline,
    )
    .await
    .map_err(|error| error.error)?;
    if let Some(id_token) = &response.id_token {
        let actual = identity::verify(
            dependencies.http.as_ref(),
            options,
            &metadata,
            id_token.expose(),
            None,
            dependencies.clock.as_ref(),
        )
        .await?;
        if !account_matches(&actual, account) {
            return fail(ErrorCode::AccountMismatch);
        }
    }
    // A refresh result without an ID token inherits identity only from our verified credential.
    let rotated = response.refresh_token.as_ref().unwrap_or(&refresh);
    persist(dependencies.store.as_ref(), &key, account, rotated, life, cancel, deadline)?;
    token(response, options, account.clone(), dependencies.clock.now_ms())
}
