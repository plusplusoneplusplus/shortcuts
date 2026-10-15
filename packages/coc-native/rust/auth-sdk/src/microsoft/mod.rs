mod cli;
pub(crate) mod config;
mod identity;
mod oauth;
mod provider;
mod signin;

pub use cli::{CliOutput, CliRunner, ProcessCliRunner};
pub use config::{
    AzureCliOptions, AzureCliSelection, MicrosoftTokenSource, OAuthOptions, OAuthRefreshOptions,
    ProviderOptions,
};
pub use oauth::exchange_refresh_token;
pub use provider::{Dependencies, MicrosoftTokenProvider};
pub use signin::{MicrosoftOAuthSignIn, SignInInstructions, SignInResult};

// Re-export generic OAuth types through the microsoft module for backward compatibility.
pub use crate::oauth::{
    HttpResponse, HttpTransport, OAuthRefreshError, OAuthRefreshRejection, OAuthRefreshResponse,
    ReqwestTransport,
};

#[cfg(test)]
mod tests;
