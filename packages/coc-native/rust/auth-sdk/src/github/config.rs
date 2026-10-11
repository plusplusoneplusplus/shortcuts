use super::{CopilotAccountSelection, GitHubAccount};
use crate::{
    contracts::{checkpoint, fail},
    AuthError, ErrorCode, Result, Secret,
};
use serde_json::Value;
use std::{
    fs::{File, Metadata},
    io::Read,
    path::Path,
};
use tokio_util::sync::CancellationToken;
use zeroize::{Zeroize, Zeroizing};

const LIMIT: usize = 1024 * 1024;

fn invalid() -> AuthError {
    AuthError::new(ErrorCode::InvalidTokenResponse)
}

// The config may contain credentials for other accounts. Erase parsed string values.
struct Document(Value);
impl Drop for Document {
    fn drop(&mut self) {
        fn erase(value: &mut Value) {
            match value {
                Value::String(text) => text.zeroize(),
                Value::Array(values) => values.iter_mut().for_each(erase),
                Value::Object(values) => values.values_mut().for_each(erase),
                _ => {}
            }
        }
        erase(&mut self.0);
    }
}

#[derive(PartialEq)]
struct Stamp {
    length: u64,
    modified: std::time::SystemTime,
    #[cfg(unix)]
    identity: (u64, u64, i64, i64),
    #[cfg(windows)]
    times: (i64, i64, i64, i64),
}

fn stamp(file: &File, metadata: &Metadata) -> Result<Stamp> {
    #[cfg(unix)]
    use std::os::unix::fs::MetadataExt;
    #[cfg(windows)]
    let times = {
        use std::os::windows::io::AsRawHandle;
        use windows_sys::Win32::Storage::FileSystem::{
            FileBasicInfo, GetFileInformationByHandleEx, FILE_BASIC_INFO,
        };
        let mut info: FILE_BASIC_INFO = unsafe { std::mem::zeroed() };
        if unsafe {
            GetFileInformationByHandleEx(
                file.as_raw_handle() as _,
                FileBasicInfo,
                (&mut info as *mut FILE_BASIC_INFO).cast(),
                std::mem::size_of_val(&info) as u32,
            )
        } == 0
        {
            return Err(invalid());
        }
        (info.CreationTime, info.LastWriteTime, info.ChangeTime, info.FileAttributes as i64)
    };
    #[cfg(not(windows))]
    let _ = file;
    Ok(Stamp {
        length: metadata.len(),
        modified: metadata.modified().map_err(|_| invalid())?,
        #[cfg(unix)]
        identity: (metadata.dev(), metadata.ino(), metadata.ctime(), metadata.ctime_nsec()),
        #[cfg(windows)]
        times,
    })
}

pub(super) fn read(
    path: &Path,
    selection: &CopilotAccountSelection,
    cancel: &CancellationToken,
    deadline: tokio::time::Instant,
) -> Result<(GitHubAccount, Option<Secret>)> {
    read_with_hook(path, selection, cancel, deadline, || {})
}

fn read_with_hook(
    path: &Path,
    selection: &CopilotAccountSelection,
    cancel: &CancellationToken,
    deadline: tokio::time::Instant,
    after_stat: impl FnOnce(),
) -> Result<(GitHubAccount, Option<Secret>)> {
    checkpoint(cancel, deadline)?;
    let mut open = std::fs::OpenOptions::new();
    open.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        // A configured FIFO must not leave an uncancellable open blocked on a writer.
        open.custom_flags(libc::O_NONBLOCK);
    }
    let mut file = open.open(path).map_err(|_| AuthError::new(ErrorCode::StorageFailed))?;
    let metadata = file.metadata().map_err(|_| invalid())?;
    if !metadata.is_file() || metadata.len() > LIMIT as u64 {
        return Err(invalid());
    }
    let before = stamp(&file, &metadata)?;
    after_stat();
    let mut bytes = Zeroizing::new(Vec::new());
    let mut chunk = Zeroizing::new([0u8; 8192]);
    loop {
        checkpoint(cancel, deadline)?;
        let count = file.read(&mut *chunk).map_err(|_| invalid())?;
        if count == 0 {
            break;
        }
        if bytes.len() + count > LIMIT {
            return Err(invalid());
        }
        bytes.extend_from_slice(&chunk[..count]);
    }
    let after = file.metadata().map_err(|_| invalid())?;
    if before != stamp(&file, &after)? || bytes.len() as u64 != before.length {
        return Err(invalid());
    }
    // Match the CLI's current JSONC format: full-line // comments, not inline or block comments.
    let text = std::str::from_utf8(&bytes).map_err(|_| invalid())?;
    let mut json = Zeroizing::new(String::with_capacity(text.len()));
    for line in text.split_inclusive('\n') {
        if line.trim_start().starts_with("//") {
            json.push('\n');
        } else {
            json.push_str(line);
        }
    }
    let doc = Document(serde_json::from_str(&json).map_err(|_| invalid())?);
    let object = doc.0.as_object().ok_or_else(invalid)?;
    let account = match selection {
        CopilotAccountSelection::Explicit(account) => account.clone(),
        CopilotAccountSelection::ActiveCliAccount => {
            serde_json::from_value(object.get("lastLoggedInUser").ok_or_else(invalid)?.clone())
                .map_err(|_| invalid())?
        }
    };
    account.normalized().map_err(|_| invalid())?;
    let key = Zeroizing::new(format!("{}:{}", account.host, account.login));
    let value = object.get("copilotTokens").and_then(|tokens| tokens.get(key.as_str()));
    let token = match value {
        None | Some(Value::Null) => None,
        Some(Value::String(value)) if value.is_empty() => None,
        Some(Value::String(value)) => Some(Secret::new(value.clone())),
        _ => return fail(ErrorCode::InvalidTokenResponse),
    };
    checkpoint(cancel, deadline)?;
    Ok((account, token))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn rejects_mutation_and_growth_during_read() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("config.json");
        let original = r#"{"lastLoggedInUser":{"host":"github.com","login":"fixture"},"copilotTokens":{"github.com:fixture":"gho_fixture"}}"#;
        for replacement in [
            b"{}".to_vec(),
            vec![b' '; LIMIT + 1],
            original.replace("gho_fixture", "gho_changed").into_bytes(),
        ] {
            std::fs::write(&path, original).unwrap();
            let result = read_with_hook(
                &path,
                &CopilotAccountSelection::ActiveCliAccount,
                &CancellationToken::new(),
                tokio::time::Instant::now() + std::time::Duration::from_secs(10),
                || std::fs::write(&path, replacement).unwrap(),
            );
            assert_eq!(result.err().unwrap().code, ErrorCode::InvalidTokenResponse);
        }
    }
}
