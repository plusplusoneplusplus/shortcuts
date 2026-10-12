use super::{
    config::{cli_argument, guid},
    AzureCliOptions, AzureCliSelection,
};
use crate::{contracts::fail, Account, AuthError, ErrorCode, Result, Secret, Token};
use async_trait::async_trait;
use serde::Deserialize;
use std::path::PathBuf;
use tokio::process::Command;

pub struct CliOutput {
    pub success: bool,
    pub stdout: Secret,
}

#[async_trait]
pub trait CliRunner: Send + Sync {
    async fn run(&self, arguments: &[String]) -> Result<CliOutput>;
}

/// Optional executable injection is a trusted Rust test boundary, not an N-API option.
#[derive(Default)]
pub struct ProcessCliRunner {
    pub executable: Option<PathBuf>,
}

#[async_trait]
impl CliRunner for ProcessCliRunner {
    async fn run(&self, arguments: &[String]) -> Result<CliOutput> {
        #[cfg(windows)]
        let command = {
            let executable = self
                .executable
                .clone()
                .or_else(|| {
                    std::env::var_os("PATH").and_then(|path| {
                        std::env::split_paths(&path)
                            .map(|dir| dir.join("az.cmd"))
                            .find(|file| file.is_file())
                    })
                })
                .ok_or_else(|| AuthError::new(ErrorCode::CliUnavailable))?;
            if executable.extension().is_some_and(|e| e.eq_ignore_ascii_case("cmd")) {
                let executable =
                    executable.to_str().ok_or_else(|| AuthError::new(ErrorCode::CliUnavailable))?;
                if executable.contains(['"', '%', '\r', '\n']) {
                    return fail(ErrorCode::CliUnavailable);
                }
                // Only validated SDK arguments reach cmd; no user command line is accepted.
                if arguments
                    .iter()
                    .any(|a| a.contains(['"', '%', '&', '|', '<', '>', '^', '\r', '\n']))
                {
                    return fail(ErrorCode::InvalidConfiguration);
                }
                let line = format!(
                    "\"\"{}\" {}\"",
                    executable,
                    arguments.iter().map(|a| format!("\"{a}\"")).collect::<Vec<_>>().join(" ")
                );
                let mut cmd =
                    Command::new(std::env::var_os("COMSPEC").unwrap_or_else(|| "cmd.exe".into()));
                cmd.args(["/d", "/s", "/c"]).raw_arg(line);
                cmd
            } else {
                let mut cmd = Command::new(executable);
                cmd.args(arguments);
                cmd
            }
        };
        #[cfg(not(windows))]
        let command = {
            let mut cmd = Command::new(self.executable.clone().unwrap_or_else(|| "az".into()));
            cmd.args(arguments);
            cmd
        };
        let (success, stdout) = crate::process::run(command, 1024 * 1024).await?;
        Ok(CliOutput { success, stdout })
    }
}

#[derive(Deserialize)]
struct Selection {
    id: String,
    #[serde(rename = "tenantId")]
    tenant: String,
    user: User,
}
#[derive(Deserialize)]
struct User {
    name: String,
    #[serde(rename = "type")]
    kind: String,
}

#[derive(Deserialize)]
#[serde(untagged)]
enum EpochSeconds {
    Number(u64),
    Text(String),
}

#[derive(Deserialize)]
struct CliToken {
    #[serde(rename = "accessToken")]
    access_token: Secret,
    #[serde(rename = "tokenType")]
    token_type: String,
    tenant: String,
    subscription: String,
    expires_on: EpochSeconds,
}

async fn verify(runner: &dyn CliRunner, options: &AzureCliOptions) -> Result<()> {
    let (account, subscription) = options.explicit()?;
    let output = runner
        .run(&[
            "account".into(),
            "show".into(),
            "--subscription".into(),
            subscription.into(),
            "--output".into(),
            "json".into(),
            "--only-show-errors".into(),
        ])
        .await?;
    if !output.success {
        return fail(ErrorCode::LoginRequired);
    }
    let selection: Selection = serde_json::from_str(output.stdout.expose())
        .map_err(|_| AuthError::new(ErrorCode::InvalidTokenResponse))?;
    if !selection.id.eq_ignore_ascii_case(subscription)
        || !selection.tenant.eq_ignore_ascii_case(&account.tenant)
        || !selection.user.name.eq_ignore_ascii_case(&account.id)
        || selection.user.kind != "user"
    {
        return fail(ErrorCode::AccountMismatch);
    }
    Ok(())
}

pub(crate) async fn active_selection(
    runner: &dyn CliRunner,
    options: &AzureCliOptions,
) -> Result<AzureCliOptions> {
    let output = runner
        .run(&[
            "account".into(),
            "show".into(),
            "--output".into(),
            "json".into(),
            "--only-show-errors".into(),
        ])
        .await?;
    if !output.success {
        return fail(ErrorCode::LoginRequired);
    }
    let selection: Selection = serde_json::from_str(output.stdout.expose())
        .map_err(|_| AuthError::new(ErrorCode::InvalidTokenResponse))?;
    if !guid(&selection.id) || !guid(&selection.tenant) || !cli_argument(&selection.user.name) {
        return fail(ErrorCode::InvalidTokenResponse);
    }
    if selection.user.kind != "user" {
        return fail(ErrorCode::AccountMismatch);
    }
    Ok(AzureCliOptions {
        namespace: options.namespace.clone(),
        resource: options.resource.clone(),
        selection: AzureCliSelection::Explicit {
            account: Account { id: selection.user.name, tenant: selection.tenant },
            subscription: selection.id,
        },
    })
}

pub(crate) fn same_selection(a: &AzureCliOptions, b: &AzureCliOptions) -> bool {
    match (a.explicit(), b.explicit()) {
        (Ok((a, a_sub)), Ok((b, b_sub))) => {
            a.id.eq_ignore_ascii_case(&b.id)
                && a.tenant.eq_ignore_ascii_case(&b.tenant)
                && a_sub.eq_ignore_ascii_case(b_sub)
        }
        _ => false,
    }
}

pub(crate) async fn acquire(runner: &dyn CliRunner, options: &AzureCliOptions) -> Result<Token> {
    let (account, selected_subscription) = options.explicit()?;
    verify(runner, options).await?;
    let output = runner
        .run(&[
            "account".into(),
            "get-access-token".into(),
            "--subscription".into(),
            selected_subscription.into(),
            "--resource".into(),
            options.resource.clone(),
            "--output".into(),
            "json".into(),
            "--only-show-errors".into(),
        ])
        .await?;
    if !output.success {
        return fail(ErrorCode::LoginRequired);
    }
    let value: CliToken = serde_json::from_str(output.stdout.expose())
        .map_err(|_| AuthError::new(ErrorCode::InvalidTokenResponse))?;
    let tenant = &value.tenant;
    let subscription = &value.subscription;
    if !guid(tenant)
        || !tenant.eq_ignore_ascii_case(&account.tenant)
        || !subscription.eq_ignore_ascii_case(selected_subscription)
    {
        return fail(ErrorCode::AccountMismatch);
    }
    // Modern az emits an unambiguous UTC epoch. Older local expiresOn is not trusted.
    let seconds = match value.expires_on {
        EpochSeconds::Number(value) => value,
        EpochSeconds::Text(value) => {
            value.parse().map_err(|_| AuthError::new(ErrorCode::InvalidTokenResponse))?
        }
    };
    let expires_at =
        seconds.checked_mul(1000).ok_or_else(|| AuthError::new(ErrorCode::InvalidTokenResponse))?;
    if expires_at > 9_007_199_254_740_991
        || value.access_token.expose().is_empty()
        || value.access_token.expose().len() > 1024 * 1024
        || value.access_token.expose().chars().any(char::is_whitespace)
        || !value.token_type.eq_ignore_ascii_case("bearer")
    {
        return fail(ErrorCode::InvalidTokenResponse);
    }
    let result = Token {
        access_token: value.access_token,
        token_type: value.token_type,
        expires_at,
        source: "azure-cli".into(),
        target: options.resource.clone(),
        account: account.clone(),
        granted_scopes: None,
    };
    verify(runner, options).await?;
    Ok(result)
}
