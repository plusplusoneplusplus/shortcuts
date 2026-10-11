use std::path::PathBuf;
use std::time::Duration;

use sha2::{Digest, Sha256};
use url::Url;

use crate::{contracts::fail, Account, ErrorCode, Refresh, Result};

#[derive(Clone, Debug)]
pub struct OAuthOptions {
    pub namespace: String,
    /// A tenant-specific Microsoft cloud authority, e.g. HTTPS login host / tenant UUID.
    pub authority: String,
    pub client_id: String,
    pub scopes: Vec<String>,
    pub target: String,
    pub resource: Option<String>,
    /// Caller-owned private directory shared by all processes using this namespace.
    /// Contains advisory lock files only, never credentials.
    pub coordination_dir: PathBuf,
}

#[derive(Clone, Debug)]
pub struct AzureCliOptions {
    pub namespace: String,
    pub resource: String,
    pub selection: AzureCliSelection,
}

#[derive(Clone, Debug)]
pub enum AzureCliSelection {
    ActiveAccount,
    Explicit {
        /// Exact CLI user.name returned by `az account show`, not an access-token claim.
        account: Account,
        subscription: String,
    },
}

impl AzureCliOptions {
    pub(crate) fn explicit(&self) -> Result<(&Account, &str)> {
        match &self.selection {
            AzureCliSelection::Explicit { account, subscription } => Ok((account, subscription)),
            AzureCliSelection::ActiveAccount => fail(ErrorCode::InvalidConfiguration),
        }
    }
}

#[derive(Clone, Debug)]
pub enum MicrosoftTokenSource {
    OAuth { options: OAuthOptions, account: Account },
    AzureCli(AzureCliOptions),
}

#[derive(Clone, Debug)]
pub struct ProviderOptions {
    pub source: MicrosoftTokenSource,
    pub refresh: Refresh,
    pub expiry_margin_seconds: u64,
    pub timeout: Duration,
}

pub(crate) fn guid(value: &str) -> bool {
    value.len() == 36
        && value.bytes().enumerate().all(|(i, b)| {
            if [8, 13, 18, 23].contains(&i) {
                b == b'-'
            } else {
                b.is_ascii_hexdigit()
            }
        })
}

pub(crate) fn text(value: &str, max: usize) -> bool {
    !value.is_empty() && value.len() <= max && !value.chars().any(char::is_control)
}

pub(crate) fn cli_argument(value: &str) -> bool {
    text(value, 2048)
        && !value.starts_with('-')
        && value.bytes().all(|c| c.is_ascii_alphanumeric() || b"-._:/@".contains(&c))
}

pub(crate) fn hash(parts: &[&str]) -> String {
    // Length prefixes prevent delimiter collisions in namespace / scope keys.
    let mut digest = Sha256::new();
    for part in parts {
        digest.update((part.len() as u64).to_be_bytes());
        digest.update(part.as_bytes());
    }
    format!("{:x}", digest.finalize())
}

pub(crate) fn timeout_valid(timeout: Duration) -> bool {
    (Duration::from_millis(100)..=Duration::from_secs(900)).contains(&timeout)
}

impl OAuthOptions {
    pub fn validate(&self) -> Result<()> {
        let url = Url::parse(&self.authority)
            .map_err(|_| crate::AuthError::new(ErrorCode::InvalidConfiguration))?;
        let host = url.host_str().unwrap_or_default();
        let tenant = url.path().trim_matches('/');
        if !["login.microsoftonline.com", "login.microsoftonline.us", "login.chinacloudapi.cn"]
            .contains(&host)
            || url.scheme() != "https"
            || url.port().is_some()
            || !url.username().is_empty()
            || url.password().is_some()
            || url.query().is_some()
            || url.fragment().is_some()
            || !guid(tenant)
            || !guid(&self.client_id)
            || !text(&self.namespace, 256)
            || !text(&self.target, 2048)
            || self.scopes.is_empty()
            || self.scopes.len() > 64
            || self.scopes.iter().any(|s| !text(s, 2048) || s.chars().any(char::is_whitespace))
            || !self.scopes.iter().any(|s| s == "openid")
            || !self.scopes.iter().any(|s| s == "profile")
            || !self.scopes.iter().any(|s| s == "offline_access")
            || self.resource.as_ref().is_some_and(|r| !cli_argument(r))
            || !self.coordination_dir.is_absolute()
        {
            return fail(ErrorCode::InvalidConfiguration);
        }
        Ok(())
    }

    pub(crate) fn tenant(&self) -> String {
        self.authority
            .trim_end_matches('/')
            .rsplit('/')
            .next()
            .unwrap_or_default()
            .to_ascii_lowercase()
    }

    pub(crate) fn authority(&self) -> String {
        self.authority.trim_end_matches('/').to_ascii_lowercase()
    }

    pub(crate) fn credential_key(&self, account: &Account) -> String {
        format!(
            "auth-sdk:v1:{}",
            hash(&[
                &self.namespace,
                &self.authority(),
                &self.client_id.to_ascii_lowercase(),
                &account.id.to_ascii_lowercase(),
                &account.tenant.to_ascii_lowercase(),
                &self.coordination_dir.to_string_lossy(),
            ])
        )
    }

    pub(crate) fn account_valid(&self, account: &Account) -> bool {
        guid(&account.id) && account.tenant.eq_ignore_ascii_case(&self.tenant())
    }
}

impl ProviderOptions {
    pub fn new(source: MicrosoftTokenSource, refresh: Refresh) -> Self {
        Self { source, refresh, expiry_margin_seconds: 60, timeout: Duration::from_secs(30) }
    }

    pub fn validate(&self) -> Result<()> {
        if !timeout_valid(self.timeout) || self.expiry_margin_seconds > 3600 {
            return fail(ErrorCode::InvalidConfiguration);
        }
        match &self.source {
            MicrosoftTokenSource::OAuth { options, account } => {
                options.validate()?;
                if !options.account_valid(account) {
                    return fail(ErrorCode::InvalidConfiguration);
                }
            }
            MicrosoftTokenSource::AzureCli(options) => {
                if !text(&options.namespace, 256) || !cli_argument(&options.resource) {
                    return fail(ErrorCode::InvalidConfiguration);
                }
                if let AzureCliSelection::Explicit { account, subscription } = &options.selection {
                    if !cli_argument(&account.id) || !guid(&account.tenant) || !guid(subscription) {
                        return fail(ErrorCode::InvalidConfiguration);
                    }
                }
            }
        }
        Ok(())
    }

    pub(crate) fn key(&self) -> String {
        match &self.source {
            MicrosoftTokenSource::OAuth { options, account } => {
                let mut scopes = options.scopes.clone();
                scopes.sort();
                scopes.dedup();
                hash(&[
                    "oauth",
                    &options.credential_key(account),
                    &options.target,
                    options.resource.as_deref().unwrap_or_default(),
                    &scopes.join(" "),
                    &options.coordination_dir.to_string_lossy(),
                ])
            }
            MicrosoftTokenSource::AzureCli(o) => match &o.selection {
                AzureCliSelection::Explicit { account, subscription } => hash(&[
                    "azure-cli",
                    &o.namespace,
                    &account.id.to_ascii_lowercase(),
                    &account.tenant.to_ascii_lowercase(),
                    &subscription.to_ascii_lowercase(),
                    &o.resource,
                ]),
                AzureCliSelection::ActiveAccount => {
                    hash(&["azure-cli-active", &o.namespace, &o.resource])
                }
            },
        }
    }
}
