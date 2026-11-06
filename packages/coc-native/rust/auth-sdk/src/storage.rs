use crate::{contracts::fail, AuthError, ErrorCode, Result, Secret};

/// Platform credential store with no key-format assumptions.
/// Implementations must securely commit before returning.
/// Synchronous store operations must be bounded by the OS backend; no plaintext fallback.
pub trait CredentialStore: Send + Sync {
    fn read(&self, key: &str) -> Result<Option<Secret>>;
    fn write(&self, key: &str, value: &Secret) -> Result<()>;
    fn delete(&self, key: &str) -> Result<()>;
}

/// OS-backed credential store parameterized by service name.
/// No key-format validation — callers choose their own key scheme.
pub struct OsCredentialStore {
    service: String,
}

impl OsCredentialStore {
    pub fn new(service: impl Into<String>) -> Self {
        Self { service: service.into() }
    }
}

/// Validates `auth-sdk:v1:<64 hex chars>` key format, then delegates to an inner store.
/// Use this for auth-sdk–owned credentials (Microsoft OAuth refresh tokens).
pub struct AuthSdkCredentialStore {
    inner: Box<dyn CredentialStore>,
}

impl AuthSdkCredentialStore {
    pub fn new(inner: impl CredentialStore + 'static) -> Self {
        Self { inner: Box::new(inner) }
    }

    pub fn os() -> Self {
        Self::new(OsCredentialStore::new("auth-sdk"))
    }
}

fn validate_sdk_key(key: &str) -> Result<()> {
    if !key.starts_with("auth-sdk:v1:")
        || key.len() != 76
        || !key[12..].bytes().all(|c| c.is_ascii_hexdigit())
    {
        return fail(ErrorCode::InvalidConfiguration);
    }
    Ok(())
}

impl CredentialStore for AuthSdkCredentialStore {
    fn read(&self, key: &str) -> Result<Option<Secret>> {
        validate_sdk_key(key)?;
        self.inner.read(key)
    }
    fn write(&self, key: &str, value: &Secret) -> Result<()> {
        validate_sdk_key(key)?;
        self.inner.write(key, value)
    }
    fn delete(&self, key: &str) -> Result<()> {
        validate_sdk_key(key)?;
        self.inner.delete(key)
    }
}

impl CredentialStore for OsCredentialStore {
    fn read(&self, key: &str) -> Result<Option<Secret>> {
        #[cfg(target_os = "windows")]
        {
            windows::read(&self.service, key)
        }
        #[cfg(target_os = "macos")]
        {
            macos::read(&self.service, key)
        }
        #[cfg(target_os = "linux")]
        {
            linux::read(&self.service, key)
        }
        #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
        {
            let _ = key;
            fail(ErrorCode::StorageUnavailable)
        }
    }

    fn write(&self, key: &str, value: &Secret) -> Result<()> {
        #[cfg(target_os = "windows")]
        {
            windows::write(&self.service, key, value)
        }
        #[cfg(target_os = "macos")]
        {
            macos::write(&self.service, key, value)
        }
        #[cfg(target_os = "linux")]
        {
            linux::write(&self.service, key, value)
        }
        #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
        {
            let _ = (key, value);
            fail(ErrorCode::StorageUnavailable)
        }
    }

    fn delete(&self, key: &str) -> Result<()> {
        #[cfg(target_os = "windows")]
        {
            windows::delete(&self.service, key)
        }
        #[cfg(target_os = "macos")]
        {
            macos::delete(&self.service, key)
        }
        #[cfg(target_os = "linux")]
        {
            linux::delete(&self.service, key)
        }
        #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
        {
            let _ = key;
            fail(ErrorCode::StorageUnavailable)
        }
    }
}

#[cfg(target_os = "windows")]
mod windows {
    use super::*;

    fn entry(service: &str, key: &str) -> Result<keyring::Entry> {
        keyring::Entry::new(service, key).map_err(map)
    }

    fn map(error: keyring::Error) -> AuthError {
        AuthError::new(match error {
            keyring::Error::NoStorageAccess(_) => ErrorCode::StorageDenied,
            keyring::Error::PlatformFailure(_) => ErrorCode::StorageUnavailable,
            _ => ErrorCode::StorageFailed,
        })
    }

    pub fn read(service: &str, key: &str) -> Result<Option<Secret>> {
        match entry(service, key)?.get_secret() {
            Ok(bytes) => {
                let bytes = zeroize::Zeroizing::new(bytes);
                let value = String::from_utf8(bytes.to_vec())
                    .map_err(|_| AuthError::new(ErrorCode::StorageFailed))?;
                Ok(Some(Secret::new(value)))
            }
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(error) => Err(map(error)),
        }
    }

    pub fn write(service: &str, key: &str, value: &Secret) -> Result<()> {
        entry(service, key)?.set_secret(value.expose().as_bytes()).map_err(map)
    }

    pub fn delete(service: &str, key: &str) -> Result<()> {
        match entry(service, key)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => Err(map(error)),
        }
    }
}

#[cfg(target_os = "macos")]
mod macos {
    use super::*;
    use core_foundation::{base::TCFType, string::CFString};
    use security_framework::passwords::{self, PasswordOptions};
    use security_framework_sys::item::kSecUseAuthenticationUI;

    #[link(name = "Security", kind = "framework")]
    extern "C" {
        #[link_name = "kSecUseAuthenticationUIFail"]
        static AUTHENTICATION_UI_FAIL: core_foundation::string::CFStringRef;
    }

    fn options(service: &str, key: &str) -> PasswordOptions {
        let mut options = PasswordOptions::new_generic_password(service, key);
        options.set_access_synchronized(Some(false));
        #[allow(deprecated)]
        unsafe {
            options.query.push((
                CFString::wrap_under_get_rule(kSecUseAuthenticationUI),
                CFString::wrap_under_get_rule(AUTHENTICATION_UI_FAIL).into_CFType(),
            ));
        }
        options
    }

    fn map(error: security_framework::base::Error) -> AuthError {
        AuthError::new(match error.code() {
            -25308 => ErrorCode::StorageLocked,
            -25293 | -128 => ErrorCode::StorageDenied,
            -25291 => ErrorCode::StorageUnavailable,
            _ => ErrorCode::StorageFailed,
        })
    }

    pub fn read(service: &str, key: &str) -> Result<Option<Secret>> {
        match passwords::generic_password(options(service, key)) {
            Ok(bytes) => {
                let bytes = zeroize::Zeroizing::new(bytes);
                let value = String::from_utf8(bytes.to_vec())
                    .map_err(|_| AuthError::new(ErrorCode::StorageFailed))?;
                Ok(Some(Secret::new(value)))
            }
            Err(error) if error.code() == -25300 => Ok(None),
            Err(error) => Err(map(error)),
        }
    }

    pub fn write(service: &str, key: &str, value: &Secret) -> Result<()> {
        passwords::set_generic_password_options(value.expose().as_bytes(), options(service, key))
            .map_err(map)
    }

    pub fn delete(service: &str, key: &str) -> Result<()> {
        match passwords::delete_generic_password_options(options(service, key)) {
            Ok(()) => Ok(()),
            Err(error) if error.code() == -25300 => Ok(()),
            Err(error) => Err(map(error)),
        }
    }
}

#[cfg(target_os = "linux")]
mod linux {
    use super::*;
    use dbus_secret_service::{EncryptionType, Error, Item, SecretService};
    use std::collections::HashMap;

    fn map(error: Error) -> AuthError {
        AuthError::new(match error {
            Error::Locked => ErrorCode::StorageLocked,
            Error::Prompt => ErrorCode::StorageDenied,
            Error::Unavailable | Error::NoResult => ErrorCode::StorageUnavailable,
            Error::Dbus(ref error)
                if error
                    .name()
                    .is_some_and(|name| name == "org.freedesktop.DBus.Error.AccessDenied") =>
            {
                ErrorCode::StorageDenied
            }
            Error::Dbus(_) => ErrorCode::StorageUnavailable,
            _ => ErrorCode::StorageFailed,
        })
    }

    fn attributes<'a>(service: &'a str, key: &'a str) -> HashMap<&'a str, &'a str> {
        HashMap::from([("application", service), ("service", service), ("username", key)])
    }

    fn connect() -> Result<SecretService> {
        SecretService::connect_with_max_prompt_timeout(EncryptionType::Dh, 0).map_err(map)
    }

    fn find<'a>(service: &'a SecretService, svc: &str, key: &str) -> Result<Option<Item<'a>>> {
        let mut items = service.search_items(attributes(svc, key)).map_err(map)?;
        if !items.locked.is_empty() {
            return fail(ErrorCode::StorageLocked);
        }
        if items.unlocked.len() > 1 {
            return fail(ErrorCode::StorageFailed);
        }
        Ok(items.unlocked.pop())
    }

    pub fn read(service: &str, key: &str) -> Result<Option<Secret>> {
        let conn = connect()?;
        if let Some(item) = find(&conn, service, key)? {
            let bytes = zeroize::Zeroizing::new(item.get_secret().map_err(map)?);
            let text = String::from_utf8(bytes.to_vec())
                .map_err(|_| AuthError::new(ErrorCode::StorageFailed))?;
            Ok(Some(Secret::new(text)))
        } else {
            Ok(None)
        }
    }

    pub fn write(service: &str, key: &str, value: &Secret) -> Result<()> {
        let conn = connect()?;
        if let Some(item) = find(&conn, service, key)? {
            item.set_secret(value.expose().as_bytes(), "text/plain").map_err(map)?;
        } else {
            let collection = conn.get_default_collection().map_err(map)?;
            if collection.is_locked().map_err(map)? {
                return fail(ErrorCode::StorageLocked);
            }
            collection
                .create_item(
                    &format!("{service} credential"),
                    attributes(service, key),
                    value.expose().as_bytes(),
                    true,
                    "text/plain",
                )
                .map_err(map)?;
        }
        Ok(())
    }

    pub fn delete(service: &str, key: &str) -> Result<()> {
        let conn = connect()?;
        if let Some(item) = find(&conn, service, key)? {
            item.delete().map_err(map)?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn err_code<T>(result: Result<T>) -> ErrorCode {
        match result {
            Ok(_) => panic!("expected error"),
            Err(e) => e.code,
        }
    }

    #[test]
    fn auth_sdk_store_rejects_invalid_keys() {
        let store = AuthSdkCredentialStore::os();
        for key in [
            "copilot-cli/fixture",
            "auth-sdk:v1:short",
            "auth-sdk:v1:zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz",
        ] {
            assert_eq!(err_code(store.read(key)), ErrorCode::InvalidConfiguration);
            assert_eq!(
                err_code(store.write(key, &Secret::new("fixture".into()))),
                ErrorCode::InvalidConfiguration,
            );
            assert_eq!(err_code(store.delete(key)), ErrorCode::InvalidConfiguration);
        }
    }

    #[test]
    fn auth_sdk_store_accepts_valid_key_format() {
        let valid_key =
            "auth-sdk:v1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
        assert_eq!(valid_key.len(), 76);
        assert!(validate_sdk_key(valid_key).is_ok());
    }

    #[test]
    fn os_credential_store_has_no_key_restrictions() {
        let store = OsCredentialStore::new("test-service");
        for key in ["any-key", "claude-credentials", &"x".repeat(200)] {
            let result = store.read(key);
            if let Err(e) = &result {
                assert_ne!(e.code, ErrorCode::InvalidConfiguration);
            }
        }
    }

    #[test]
    fn auth_sdk_store_delegates_to_inner() {
        use std::sync::{Arc, Mutex};

        #[derive(Clone)]
        struct Recorder {
            ops: Arc<Mutex<Vec<(String, String)>>>,
        }
        impl CredentialStore for Recorder {
            fn read(&self, key: &str) -> Result<Option<Secret>> {
                self.ops.lock().unwrap().push(("read".into(), key.into()));
                Ok(Some(Secret::new("recorded".into())))
            }
            fn write(&self, key: &str, _value: &Secret) -> Result<()> {
                self.ops.lock().unwrap().push(("write".into(), key.into()));
                Ok(())
            }
            fn delete(&self, key: &str) -> Result<()> {
                self.ops.lock().unwrap().push(("delete".into(), key.into()));
                Ok(())
            }
        }

        let key = "auth-sdk:v1:abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
        let ops = Arc::new(Mutex::new(vec![]));
        let store = AuthSdkCredentialStore::new(Recorder { ops: ops.clone() });

        assert_eq!(store.read(key).unwrap().unwrap().expose(), "recorded");
        store.write(key, &Secret::new("value".into())).unwrap();
        store.delete(key).unwrap();

        let recorded = ops.lock().unwrap();
        assert_eq!(recorded.len(), 3);
        assert_eq!(recorded[0], ("read".into(), key.into()));
        assert_eq!(recorded[1], ("write".into(), key.into()));
        assert_eq!(recorded[2], ("delete".into(), key.into()));
    }

    #[test]
    fn auth_sdk_store_rejects_before_delegating() {
        use std::sync::{Arc, Mutex};

        #[derive(Clone)]
        struct Counter {
            calls: Arc<Mutex<usize>>,
        }
        impl CredentialStore for Counter {
            fn read(&self, _key: &str) -> Result<Option<Secret>> {
                *self.calls.lock().unwrap() += 1;
                Ok(None)
            }
            fn write(&self, _key: &str, _value: &Secret) -> Result<()> {
                *self.calls.lock().unwrap() += 1;
                Ok(())
            }
            fn delete(&self, _key: &str) -> Result<()> {
                *self.calls.lock().unwrap() += 1;
                Ok(())
            }
        }

        let calls = Arc::new(Mutex::new(0));
        let store = AuthSdkCredentialStore::new(Counter { calls: calls.clone() });

        let _ = store.read("bad-key");
        let _ = store.write("bad-key", &Secret::new("v".into()));
        let _ = store.delete("bad-key");
        assert_eq!(*calls.lock().unwrap(), 0, "inner store must not be called for invalid keys");
    }
}
