//! Read one exact generic credential; never enumerate accounts or write tokens.

pub fn read(target: &str) -> Result<Option<String>, &'static str> {
    if target.is_empty() || target.contains('\0') || target.encode_utf16().count() > 32_767 {
        return Err("Invalid Windows credential target.");
    }
    read_platform(target)
}

#[cfg(not(windows))]
fn read_platform(_target: &str) -> Result<Option<String>, &'static str> {
    Err("Windows Credential Manager is unavailable on this platform.")
}

#[cfg(windows)]
fn read_platform(target: &str) -> Result<Option<String>, &'static str> {
    use windows_sys::Win32::Foundation::{GetLastError, ERROR_NOT_FOUND};
    use windows_sys::Win32::Security::Credentials::{
        CredFree, CredReadW, CREDENTIALW, CRED_MAX_CREDENTIAL_BLOB_SIZE, CRED_TYPE_GENERIC,
    };

    struct Credential(*mut CREDENTIALW);
    impl Drop for Credential {
        fn drop(&mut self) {
            // CredReadW owns the allocation until CredFree, including on decoding errors.
            unsafe { CredFree(self.0.cast()) };
        }
    }

    let target: Vec<u16> = target.encode_utf16().chain(Some(0)).collect();
    let mut pointer = std::ptr::null_mut();
    // The target is NUL-terminated and the returned allocation is guarded below.
    if unsafe { CredReadW(target.as_ptr(), CRED_TYPE_GENERIC, 0, &mut pointer) } == 0 {
        return if unsafe { GetLastError() } == ERROR_NOT_FOUND {
            Ok(None)
        } else {
            Err("Windows credential could not be read.")
        };
    }
    if pointer.is_null() {
        return Err("Windows credential returned an invalid allocation.");
    }
    let credential = Credential(pointer);
    let record = unsafe { &*credential.0 };
    if record.CredentialBlobSize == 0
        || record.CredentialBlobSize > CRED_MAX_CREDENTIAL_BLOB_SIZE
        || record.CredentialBlob.is_null()
    {
        return Err("Windows credential contains an invalid token blob.");
    }
    let bytes = unsafe {
        std::slice::from_raw_parts(record.CredentialBlob, record.CredentialBlobSize as usize)
    };
    String::from_utf8(bytes.to_vec())
        .map(Some)
        .map_err(|_| "Windows credential token is not UTF-8.")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_invalid_targets() {
        for target in ["", "account\0suffix", &"a".repeat(32_768)] {
            assert_eq!(read(target), Err("Invalid Windows credential target."));
        }
    }

    #[cfg(not(windows))]
    #[test]
    fn rejects_other_platforms() {
        assert_eq!(
            read("coc-test/fixture"),
            Err("Windows Credential Manager is unavailable on this platform.")
        );
    }

    #[cfg(windows)]
    #[test]
    fn reads_only_exact_generic_credential_and_handles_invalid_blobs() {
        use windows_sys::Win32::Security::Credentials::{
            CredDeleteW, CredWriteW, CREDENTIALW, CRED_PERSIST_SESSION, CRED_TYPE_GENERIC,
        };
        let target = format!(
            "coc-test/credential-{}-{}",
            std::process::id(),
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
        );
        let wide: Vec<u16> = target.encode_utf16().chain(Some(0)).collect();
        struct Cleanup(Vec<u16>);
        impl Drop for Cleanup {
            fn drop(&mut self) {
                unsafe { CredDeleteW(self.0.as_ptr(), CRED_TYPE_GENERIC, 0) };
            }
        }
        let _cleanup = Cleanup(wide.clone());
        assert_eq!(read(&target), Ok(None));
        for blob in [b"gho_fixture".as_slice(), &[0xff], &[]] {
            let mut bytes = blob.to_vec();
            let mut record: CREDENTIALW = unsafe { std::mem::zeroed() };
            record.Type = CRED_TYPE_GENERIC;
            record.TargetName = wide.as_ptr().cast_mut();
            record.CredentialBlobSize = bytes.len() as u32;
            record.CredentialBlob = bytes.as_mut_ptr();
            record.Persist = CRED_PERSIST_SESSION;
            assert_ne!(unsafe { CredWriteW(&record, 0) }, 0);
            assert_eq!(read(&format!("{target}-other")), Ok(None));
            match blob {
                b"gho_fixture" => assert_eq!(read(&target), Ok(Some("gho_fixture".into()))),
                [0xff] => assert_eq!(read(&target), Err("Windows credential token is not UTF-8.")),
                _ => assert_eq!(
                    read(&target),
                    Err("Windows credential contains an invalid token blob.")
                ),
            }
        }
    }
}
