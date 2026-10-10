use super::{
    config::{cli_argument, guid},
    AzureCliOptions, AzureCliSelection,
};
use crate::{contracts::fail, Account, AuthError, ErrorCode, Result, Secret, Token};
use async_trait::async_trait;
use serde::Deserialize;
use std::{path::PathBuf, process::Stdio};
use tokio::{io::AsyncReadExt, process::Command};
use zeroize::Zeroizing;

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

#[cfg(windows)]
struct ProcessTree(windows_sys::Win32::Foundation::HANDLE);
#[cfg(windows)]
unsafe impl Send for ProcessTree {}
#[cfg(windows)]
unsafe impl Sync for ProcessTree {}

#[cfg(windows)]
impl ProcessTree {
    fn new(child: &tokio::process::Child) -> Result<Self> {
        use windows_sys::Win32::{
            Foundation::{CloseHandle, INVALID_HANDLE_VALUE},
            System::{Diagnostics::ToolHelp::*, JobObjects::*, Threading::*},
        };
        unsafe {
            let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
            if job.is_null() {
                return fail(ErrorCode::CliUnavailable);
            }
            let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
            limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            let configured = SetInformationJobObject(
                job,
                JobObjectExtendedLimitInformation,
                &limits as *const _ as *const _,
                std::mem::size_of_val(&limits) as u32,
            );
            let assigned = configured != 0
                && AssignProcessToJobObject(job, child.raw_handle().unwrap_or_default() as _) != 0;
            if !assigned {
                CloseHandle(job);
                return fail(ErrorCode::CliUnavailable);
            }
            let tree = Self(job);
            // Spawn suspended so no descendant can escape before job assignment.
            let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0);
            if snapshot == INVALID_HANDLE_VALUE {
                return fail(ErrorCode::CliUnavailable);
            }
            let mut entry: THREADENTRY32 = std::mem::zeroed();
            entry.dwSize = std::mem::size_of_val(&entry) as u32;
            let mut found = false;
            let mut next = Thread32First(snapshot, &mut entry);
            while next != 0 {
                if Some(entry.th32OwnerProcessID) == child.id() {
                    let thread = OpenThread(THREAD_SUSPEND_RESUME, 0, entry.th32ThreadID);
                    if !thread.is_null() {
                        found = ResumeThread(thread) != u32::MAX;
                        CloseHandle(thread);
                    }
                    break;
                }
                next = Thread32Next(snapshot, &mut entry);
            }
            CloseHandle(snapshot);
            if !found {
                return fail(ErrorCode::CliUnavailable);
            }
            Ok(tree)
        }
    }
}

#[cfg(windows)]
impl Drop for ProcessTree {
    fn drop(&mut self) {
        unsafe {
            windows_sys::Win32::Foundation::CloseHandle(self.0);
        }
    }
}

#[cfg(unix)]
struct ProcessTree(u32);
#[cfg(unix)]
impl Drop for ProcessTree {
    fn drop(&mut self) {
        unsafe {
            libc::kill(-(self.0 as i32), libc::SIGKILL);
        }
    }
}

async fn read_bounded(pipe: impl tokio::io::AsyncRead + Unpin) -> Result<Zeroizing<Vec<u8>>> {
    let mut bytes = Zeroizing::new(Vec::new());
    pipe.take(1024 * 1024 + 1)
        .read_to_end(&mut bytes)
        .await
        .map_err(|_| AuthError::new(ErrorCode::InvalidTokenResponse))?;
    if bytes.len() > 1024 * 1024 {
        return fail(ErrorCode::InvalidTokenResponse);
    }
    Ok(bytes)
}

#[async_trait]
impl CliRunner for ProcessCliRunner {
    async fn run(&self, arguments: &[String]) -> Result<CliOutput> {
        #[cfg(windows)]
        let mut command = {
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
                cmd.creation_flags(0x08000004);
                cmd
            } else {
                let mut cmd = Command::new(executable);
                cmd.args(arguments).creation_flags(0x08000004);
                cmd
            }
        };
        #[cfg(not(windows))]
        let mut command = {
            let mut cmd = Command::new(self.executable.clone().unwrap_or_else(|| "az".into()));
            cmd.args(arguments);
            #[cfg(unix)]
            cmd.process_group(0);
            cmd
        };
        command
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        let mut child = command.spawn().map_err(|e| {
            AuthError::new(if e.kind() == std::io::ErrorKind::NotFound {
                ErrorCode::CliUnavailable
            } else {
                ErrorCode::LoginRequired
            })
        })?;
        #[cfg(windows)]
        let _tree = ProcessTree::new(&child)?;
        #[cfg(unix)]
        let _tree =
            ProcessTree(child.id().ok_or_else(|| AuthError::new(ErrorCode::CliUnavailable))?);
        let stdout =
            child.stdout.take().ok_or_else(|| AuthError::new(ErrorCode::InvalidTokenResponse))?;
        let stderr =
            child.stderr.take().ok_or_else(|| AuthError::new(ErrorCode::InvalidTokenResponse))?;
        let (out, _err, status) =
            tokio::try_join!(read_bounded(stdout), read_bounded(stderr), async {
                child.wait().await.map_err(|_| AuthError::new(ErrorCode::InvalidTokenResponse))
            })?;
        let text = String::from_utf8(out.to_vec())
            .map_err(|_| AuthError::new(ErrorCode::InvalidTokenResponse))?;
        Ok(CliOutput { success: status.success(), stdout: Secret::new(text) })
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
