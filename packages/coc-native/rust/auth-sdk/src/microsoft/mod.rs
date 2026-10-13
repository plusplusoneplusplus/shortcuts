mod cli;
mod config;
mod coordination;
mod http;
mod identity;
mod oauth;
mod provider;
mod signin;

pub use cli::{CliOutput, CliRunner, ProcessCliRunner};
pub use config::{
    AzureCliOptions, AzureCliSelection, MicrosoftTokenSource, OAuthOptions, OAuthRefreshOptions,
    ProviderOptions,
};
pub use http::{HttpResponse, HttpTransport, ReqwestTransport};
pub use oauth::{
    exchange_refresh_token, OAuthRefreshError, OAuthRefreshRejection, OAuthRefreshResponse,
};
pub use provider::{Dependencies, MicrosoftTokenProvider};
pub use signin::{MicrosoftOAuthSignIn, SignInInstructions, SignInResult};

#[cfg(test)]
mod tests;
