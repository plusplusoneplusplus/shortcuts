use crate::{contracts::fail, AuthError, ErrorCode, Result, Secret};
use std::process::Stdio;
use tokio::{io::AsyncReadExt, process::Command};
use zeroize::Zeroizing;

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
            // No descendant can escape job assignment: the child starts suspended.
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

async fn read_bounded(
    pipe: impl tokio::io::AsyncRead + Unpin,
    limit: u64,
) -> Result<Zeroizing<Vec<u8>>> {
    let mut bytes = Zeroizing::new(Vec::new());
    pipe.take(limit + 1)
        .read_to_end(&mut bytes)
        .await
        .map_err(|_| AuthError::new(ErrorCode::InvalidTokenResponse))?;
    if bytes.len() as u64 > limit {
        return fail(ErrorCode::InvalidTokenResponse);
    }
    Ok(bytes)
}

/// Dropping this future closes the process tree and lets Tokio reap the child.
pub(crate) async fn run(mut command: Command, limit: u64) -> Result<(bool, Secret)> {
    #[cfg(windows)]
    command.creation_flags(0x08000004);
    #[cfg(unix)]
    command.process_group(0);
    command.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped()).kill_on_drop(true);
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
    let _tree = ProcessTree(child.id().ok_or_else(|| AuthError::new(ErrorCode::CliUnavailable))?);
    let stdout =
        child.stdout.take().ok_or_else(|| AuthError::new(ErrorCode::InvalidTokenResponse))?;
    let stderr =
        child.stderr.take().ok_or_else(|| AuthError::new(ErrorCode::InvalidTokenResponse))?;
    let (out, _err, status) =
        tokio::try_join!(read_bounded(stdout, limit), read_bounded(stderr, limit), async {
            child.wait().await.map_err(|_| AuthError::new(ErrorCode::InvalidTokenResponse))
        })?;
    let text =
        std::str::from_utf8(&out).map_err(|_| AuthError::new(ErrorCode::InvalidTokenResponse))?;
    Ok((status.success(), Secret::new(text.to_owned())))
}
