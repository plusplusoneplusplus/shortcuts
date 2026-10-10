use super::{coordination::CredentialLock, identity, Dependencies, OAuthOptions};
use crate::{
    contracts::{fail, Lifetime},
    Account, AuthError, CredentialStore, ErrorCode, Result, Secret, Token,
};
use serde::Deserialize;

#[derive(Deserialize)]
pub(crate) struct TokenResponse {
    pub access_token: Secret,
    pub token_type: String,
    pub expires_in: u64,
    pub refresh_token: Option<Secret>,
    pub id_token: Option<Secret>,
    pub scope: Option<String>,
}

pub(crate) fn response(body: &str, status: u16) -> Result<TokenResponse> {
    if status != 200 {
        #[derive(Deserialize)]
        struct Failure {
            error: String,
        }
        let error = serde_json::from_str::<Failure>(body)
            .map_err(|_| AuthError::new(ErrorCode::InvalidTokenResponse))?;
        return fail(match error.error.as_str() {
            "invalid_grant" | "interaction_required" | "login_required" | "consent_required" => {
                ErrorCode::InteractionRequired
            }
            "access_denied" | "authorization_declined" => ErrorCode::AccessDenied,
            "expired_token" => ErrorCode::TokenExpired,
            _ => ErrorCode::InvalidTokenResponse,
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
        return fail(ErrorCode::InvalidTokenResponse);
    }
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
    let mut form = super::http::Form(vec![
        ("grant_type".into(), "refresh_token".into()),
        ("client_id".into(), options.client_id.clone()),
        ("refresh_token".into(), refresh.expose().to_owned()),
        ("scope".into(), options.scopes.join(" ")),
    ]);
    if let Some(resource) = &options.resource {
        form.push(("resource".into(), resource.clone()));
    }
    let output = dependencies.http.request(&metadata.token, Some(&form)).await;
    let output = output?;
    let response = response(output.body.expose(), output.status)?;
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
