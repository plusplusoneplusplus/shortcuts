use crate::{contracts::fail, AuthError, ErrorCode, Result};
use fs2::FileExt;
use std::{
    fs::{File, OpenOptions},
    path::Path,
    time::Duration,
};

pub(crate) struct CredentialLock(File);

impl CredentialLock {
    /// OS advisory locks survive neither a crash nor process exit. Secret stores are not CAS.
    pub async fn acquire(directory: &Path, key: &str) -> Result<Self> {
        let metadata = std::fs::symlink_metadata(directory)
            .map_err(|_| AuthError::new(ErrorCode::CoordinationUnavailable))?;
        if !metadata.is_dir() || metadata.file_type().is_symlink() {
            return fail(ErrorCode::CoordinationUnavailable);
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if metadata.permissions().mode() & 0o077 != 0 {
                return fail(ErrorCode::CoordinationUnavailable);
            }
        }
        let path = directory.join(format!("{}.lock", super::config::hash(&[key])));
        if std::fs::symlink_metadata(&path)
            .is_ok_and(|m| !m.is_file() || m.file_type().is_symlink())
        {
            return fail(ErrorCode::CoordinationUnavailable);
        }
        let mut options = OpenOptions::new();
        options.read(true).write(true).create(true).truncate(false);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let file =
            options.open(path).map_err(|_| AuthError::new(ErrorCode::CoordinationUnavailable))?;
        loop {
            match file.try_lock_exclusive() {
                Ok(()) => return Ok(Self(file)),
                Err(e)
                    if e.kind() == std::io::ErrorKind::WouldBlock
                        || e.raw_os_error() == fs2::lock_contended_error().raw_os_error() =>
                {
                    tokio::time::sleep(Duration::from_millis(25)).await;
                }
                Err(_) => return fail(ErrorCode::CoordinationUnavailable),
            }
        }
    }
}

impl Drop for CredentialLock {
    fn drop(&mut self) {
        let _ = FileExt::unlock(&self.0);
    }
}
