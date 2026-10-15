use crate::{
    contracts::{fail, Lifetime},
    oauth::{self, CredentialLock, ExchangeOptions},
    Account, AuthError, CredentialStore, ErrorCode, Result, Secret, Token,
};
use super::{identity, config::OAuthRefreshOptions, Dependencies, OAuthOptions};
use tokio_util::sync::CancellationToken;

pub(crate) type TokenResponse = oauth::OAuthRefreshResponse;

pub(crate) fn response(body: &str, status: u16) -> Result<TokenResponse> {
    oauth::parse_token_response(body, status).map_err(|error| error.error)
}

/// Microsoft-specific refresh exchange: validates Microsoft authority options,
/// resolves the token endpoint, then delegates to the generic OAuth exchange.
pub async fn exchange_refresh_token(
    http: &dyn oauth::HttpTransport,
    options: &OAuthRefreshOptions,
    refresh: &Secret,
    cancel: &CancellationToken,
    deadline: tokio::time::Instant,
) -> std::result::Result<oauth::OAuthRefreshResponse, oauth::OAuthRefreshError> {
    options.validate()?;
    let endpoint = options.token_endpoint();
    oauth::exchange_refresh_token(
        http,
        &ExchangeOptions {
            token_endpoint: &endpoint,
            client_id: &options.client_id,
            scopes: &options.scopes,
            resource: options.resource.as_deref(),
        },
        refresh,
        cancel,
        deadline,
    )
    .await
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
    let rotated = response.refresh_token.as_ref().unwrap_or(&refresh);
    persist(dependencies.store.as_ref(), &key, account, rotated, life, cancel, deadline)?;
    token(response, options, account.clone(), dependencies.clock.now_ms())
}
