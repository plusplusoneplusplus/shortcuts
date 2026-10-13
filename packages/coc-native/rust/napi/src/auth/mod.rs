use auth_sdk::{
    microsoft::{
        self, AzureCliOptions, AzureCliSelection, MicrosoftTokenSource, OAuthOptions,
        ProviderOptions,
    },
    Account, AuthError, ErrorCode, Refresh, Token,
};
use napi::{bindgen_prelude::PromiseRaw, Env, Error, Result};
use napi_derive::napi;
use std::{
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio_util::sync::CancellationToken;

mod github;
mod refresh;

fn error(error: AuthError) -> Error {
    Error::from_reason(format!("[auth-sdk:{:?}] Authentication operation failed.", error.code))
}

fn configuration() -> Error {
    error(AuthError::new(ErrorCode::InvalidConfiguration))
}

#[napi(object)]
pub struct MicrosoftAccount {
    pub id: String,
    pub tenant: String,
}
impl From<MicrosoftAccount> for Account {
    fn from(account: MicrosoftAccount) -> Self {
        Self { id: account.id, tenant: account.tenant }
    }
}
impl From<Account> for MicrosoftAccount {
    fn from(account: Account) -> Self {
        Self { id: account.id, tenant: account.tenant }
    }
}

#[napi(object)]
pub struct MicrosoftOAuthOptions {
    pub namespace: String,
    pub authority: String,
    pub client_id: String,
    pub scopes: Vec<String>,
    pub target: String,
    pub resource: Option<String>,
    pub coordination_directory: String,
}
impl From<MicrosoftOAuthOptions> for OAuthOptions {
    fn from(options: MicrosoftOAuthOptions) -> Self {
        Self {
            namespace: options.namespace,
            authority: options.authority,
            client_id: options.client_id,
            scopes: options.scopes,
            target: options.target,
            resource: options.resource,
            coordination_dir: options.coordination_directory.into(),
        }
    }
}

#[napi(object)]
pub struct MicrosoftAzureCliOptions {
    pub namespace: String,
    pub account: MicrosoftAccount,
    pub subscription: String,
    pub resource: String,
}

#[napi(object)]
pub struct MicrosoftActiveAzureCliOptions {
    pub namespace: String,
    pub resource: String,
}

#[napi(object)]
pub struct MicrosoftProviderPolicy {
    pub refresh: String,
    pub expiry_margin_seconds: Option<u32>,
    pub timeout_ms: Option<u32>,
}

fn options(
    source: MicrosoftTokenSource,
    policy: MicrosoftProviderPolicy,
) -> Result<ProviderOptions> {
    let refresh = match policy.refresh.as_str() {
        "auto" => Refresh::Auto,
        "never" => Refresh::Never,
        _ => return Err(configuration()),
    };
    Ok(ProviderOptions {
        source,
        refresh,
        expiry_margin_seconds: policy.expiry_margin_seconds.unwrap_or(60) as u64,
        timeout: Duration::from_millis(policy.timeout_ms.unwrap_or(30_000) as u64),
    })
}

#[napi(object)]
pub struct MicrosoftToken {
    pub access_token: String,
    pub token_type: String,
    pub expires_at: f64,
    pub source: String,
    pub target: String,
    pub account: MicrosoftAccount,
    pub granted_scopes: Option<Vec<String>>,
}

impl From<Token> for MicrosoftToken {
    fn from(token: Token) -> Self {
        Self {
            access_token: token.access_token.expose().to_owned(),
            token_type: token.token_type,
            expires_at: token.expires_at as f64,
            source: token.source,
            target: token.target,
            account: token.account.into(),
            granted_scopes: token.granted_scopes,
        }
    }
}

#[napi]
pub struct NativeMicrosoftTokenProvider {
    inner: Arc<microsoft::MicrosoftTokenProvider>,
    cancellation: Mutex<CancellationToken>,
}

#[napi]
impl NativeMicrosoftTokenProvider {
    #[napi(factory)]
    pub fn oauth(
        options_value: MicrosoftOAuthOptions,
        account: MicrosoftAccount,
        policy: MicrosoftProviderPolicy,
    ) -> Result<Self> {
        let source =
            MicrosoftTokenSource::OAuth { options: options_value.into(), account: account.into() };
        let inner =
            microsoft::MicrosoftTokenProvider::new(options(source, policy)?).map_err(error)?;
        Ok(Self { inner: Arc::new(inner), cancellation: Mutex::new(CancellationToken::new()) })
    }

    #[napi(factory)]
    pub fn azure_cli(
        options_value: MicrosoftAzureCliOptions,
        policy: MicrosoftProviderPolicy,
    ) -> Result<Self> {
        let source = MicrosoftTokenSource::AzureCli(AzureCliOptions {
            namespace: options_value.namespace,
            selection: AzureCliSelection::Explicit {
                account: options_value.account.into(),
                subscription: options_value.subscription,
            },
            resource: options_value.resource,
        });
        let inner =
            microsoft::MicrosoftTokenProvider::new(options(source, policy)?).map_err(error)?;
        Ok(Self { inner: Arc::new(inner), cancellation: Mutex::new(CancellationToken::new()) })
    }

    #[napi(factory)]
    pub fn azure_cli_active(
        options_value: MicrosoftActiveAzureCliOptions,
        policy: MicrosoftProviderPolicy,
    ) -> Result<Self> {
        let source = MicrosoftTokenSource::AzureCli(AzureCliOptions {
            namespace: options_value.namespace,
            resource: options_value.resource,
            selection: AzureCliSelection::ActiveAccount,
        });
        let inner =
            microsoft::MicrosoftTokenProvider::new(options(source, policy)?).map_err(error)?;
        Ok(Self { inner: Arc::new(inner), cancellation: Mutex::new(CancellationToken::new()) })
    }

    #[napi]
    pub fn get_token<'env>(
        &self,
        env: &'env Env,
        force_refresh: Option<bool>,
    ) -> Result<PromiseRaw<'env, MicrosoftToken>> {
        let cancel = self.cancellation.lock().map_err(|_| configuration())?.clone();
        let inner = self.inner.clone();
        let publish = self.inner.clone();
        env.spawn_future_with_callback(
            async move { inner.get_token(force_refresh.unwrap_or(false), &cancel).await.map_err(error) },
            move |_, token| {
                publish.ensure_active().map_err(error)?;
                Ok(MicrosoftToken::from(token))
            },
        )
    }

    #[napi]
    pub async fn invalidate(&self) -> Result<()> {
        self.inner.invalidate().await.map_err(error)
    }

    #[napi]
    pub fn delete_credentials<'env>(&self, env: &'env Env) -> Result<PromiseRaw<'env, ()>> {
        let cancel = self.cancellation.lock().map_err(|_| configuration())?.clone();
        let inner = self.inner.clone();
        env.spawn_future(async move { inner.delete_credentials(&cancel).await.map_err(error) })
    }

    #[napi]
    pub fn cancel_outstanding(&self) {
        let mut cancel = self.cancellation.lock().unwrap_or_else(|e| e.into_inner());
        cancel.cancel();
        *cancel = CancellationToken::new();
    }

    #[napi]
    pub fn dispose(&self) {
        self.inner.dispose();
        self.cancel_outstanding();
    }
}

#[napi(object)]
pub struct MicrosoftSignInInstructions {
    pub authorization_url: Option<String>,
    pub user_code: Option<String>,
    pub verification_uri: Option<String>,
    pub expires_at: f64,
}
impl From<microsoft::SignInInstructions> for MicrosoftSignInInstructions {
    fn from(value: microsoft::SignInInstructions) -> Self {
        Self {
            authorization_url: value.authorization_url,
            user_code: value.user_code,
            verification_uri: value.verification_uri,
            expires_at: value.expires_at as f64,
        }
    }
}

#[napi(object)]
pub struct MicrosoftSignInResult {
    pub account: MicrosoftAccount,
    pub token: MicrosoftToken,
}

#[napi]
pub struct NativeMicrosoftOAuthSignIn {
    inner: microsoft::MicrosoftOAuthSignIn,
}
#[napi]
impl NativeMicrosoftOAuthSignIn {
    #[napi(constructor)]
    pub fn new(
        options: MicrosoftOAuthOptions,
        expected_account: Option<MicrosoftAccount>,
        timeout_ms: Option<u32>,
    ) -> Result<Self> {
        let inner = microsoft::MicrosoftOAuthSignIn::new(
            options.into(),
            expected_account.map(Into::into),
            Duration::from_millis(timeout_ms.unwrap_or(300_000) as u64),
        )
        .map_err(error)?;
        Ok(Self { inner })
    }

    #[napi]
    pub async fn begin_browser(&self) -> Result<MicrosoftSignInInstructions> {
        self.inner.begin_browser().await.map(Into::into).map_err(error)
    }

    #[napi]
    pub async fn begin_device(&self) -> Result<MicrosoftSignInInstructions> {
        self.inner.begin_device().await.map(Into::into).map_err(error)
    }

    #[napi]
    pub async fn wait(&self) -> Result<MicrosoftSignInResult> {
        let value = self.inner.wait().await.map_err(error)?;
        Ok(MicrosoftSignInResult { account: value.account.into(), token: value.token.into() })
    }

    #[napi]
    pub fn cancel(&self) {
        self.inner.cancel();
    }

    #[napi]
    pub fn dispose(&self) {
        self.inner.dispose();
    }
}
