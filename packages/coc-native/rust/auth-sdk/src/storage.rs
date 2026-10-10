use crate::{contracts::fail, AuthError, ErrorCode, Result, Secret};

/// Exact SDK-owned keys only. Implementations must securely commit before returning.
/// Synchronous store operations must be bounded by the OS backend; no plaintext fallback.
pub trait CredentialStore: Send + Sync {
    fn read(&self, key: &str) -> Result<Option<Secret>>;
    fn write(&self, key: &str, value: &Secret) -> Result<()>;
    fn delete(&self, key: &str) -> Result<()>;
}

pub struct OsCredentialStore;

fn validate_key(key: &str) -> Result<()> {
    if !key.starts_with("auth-sdk:v1:")
        || key.len() != 76
        || !key[12..].bytes().all(|c| c.is_ascii_hexdigit())
    {
        return fail(ErrorCode::InvalidConfiguration);
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn entry(key: &str) -> Result<keyring::Entry> {
    validate_key(key)?;
    keyring::Entry::new("auth-sdk", key).map_err(map_error)
}

#[cfg(target_os = "windows")]
fn map_error(error: keyring::Error) -> AuthError {
    match error {
        keyring::Error::NoStorageAccess(_) => AuthError::new(ErrorCode::StorageDenied),
        keyring::Error::PlatformFailure(_) => AuthError::new(ErrorCode::StorageUnavailable),
        _ => AuthError::new(ErrorCode::StorageFailed),
    }
}

impl CredentialStore for OsCredentialStore {
    fn read(&self, key: &str) -> Result<Option<Secret>> {
        #[cfg(target_os = "windows")]
        {
            match entry(key)?.get_password() {
                Ok(value) => Ok(Some(Secret::new(value))),
                Err(keyring::Error::NoEntry) => Ok(None),
                Err(error) => Err(map_error(error)),
            }
        }
        #[cfg(target_os = "linux")]
        {
            linux::read(key)
        }
        #[cfg(target_os = "macos")]
        {
            macos::read(key)
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
            entry(key)?.set_password(value.expose()).map_err(map_error)
        }
        #[cfg(target_os = "linux")]
        {
            linux::write(key, value)
        }
        #[cfg(target_os = "macos")]
        {
            macos::write(key, value)
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
            match entry(key)?.delete_credential() {
                Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
                Err(error) => Err(map_error(error)),
            }
        }
        #[cfg(target_os = "linux")]
        {
            linux::delete(key)
        }
        #[cfg(target_os = "macos")]
        {
            macos::delete(key)
        }
        #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
        {
            let _ = key;
            fail(ErrorCode::StorageUnavailable)
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

    fn options(key: &str) -> Result<PasswordOptions> {
        validate_key(key)?;
        let mut options = PasswordOptions::new_generic_password("auth-sdk", key);
        options.set_access_synchronized(Some(false));
        // The library has no setter for this per-query noninteractive policy.
        #[allow(deprecated)]
        unsafe {
            options.query.push((
                CFString::wrap_under_get_rule(kSecUseAuthenticationUI),
                CFString::wrap_under_get_rule(AUTHENTICATION_UI_FAIL).into_CFType(),
            ));
        }
        Ok(options)
    }

    fn map(error: security_framework::base::Error) -> AuthError {
        AuthError::new(match error.code() {
            -25308 => ErrorCode::StorageLocked,
            -25293 | -128 => ErrorCode::StorageDenied,
            -25291 => ErrorCode::StorageUnavailable,
            _ => ErrorCode::StorageFailed,
        })
    }

    pub fn read(key: &str) -> Result<Option<Secret>> {
        match passwords::generic_password(options(key)?) {
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

    pub fn write(key: &str, value: &Secret) -> Result<()> {
        passwords::set_generic_password_options(value.expose().as_bytes(), options(key)?)
            .map_err(map)
    }

    pub fn delete(key: &str) -> Result<()> {
        match passwords::delete_generic_password_options(options(key)?) {
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

    fn attributes(key: &str) -> HashMap<&str, &str> {
        HashMap::from([("application", "auth-sdk"), ("service", "auth-sdk"), ("username", key)])
    }

    fn connect(key: &str) -> Result<SecretService> {
        validate_key(key)?;
        // Zero prompt timeout prevents storage UI from appearing.
        SecretService::connect_with_max_prompt_timeout(EncryptionType::Dh, 0).map_err(map)
    }

    fn find<'a>(service: &'a SecretService, key: &str) -> Result<Option<Item<'a>>> {
        let mut items = service.search_items(attributes(key)).map_err(map)?;
        if !items.locked.is_empty() {
            return fail(ErrorCode::StorageLocked);
        }
        if items.unlocked.len() > 1 {
            return fail(ErrorCode::StorageFailed);
        }
        Ok(items.unlocked.pop())
    }

    pub fn read(key: &str) -> Result<Option<Secret>> {
        let service = connect(key)?;
        if let Some(item) = find(&service, key)? {
            let bytes = zeroize::Zeroizing::new(item.get_secret().map_err(map)?);
            let text = String::from_utf8(bytes.to_vec())
                .map_err(|_| AuthError::new(ErrorCode::StorageFailed))?;
            Ok(Some(Secret::new(text)))
        } else {
            Ok(None)
        }
    }

    pub fn write(key: &str, value: &Secret) -> Result<()> {
        let service = connect(key)?;
        if let Some(item) = find(&service, key)? {
            item.set_secret(value.expose().as_bytes(), "text/plain").map_err(map)?;
        } else {
            let collection = service.get_default_collection().map_err(map)?;
            if collection.is_locked().map_err(map)? {
                return fail(ErrorCode::StorageLocked);
            }
            collection
                .create_item(
                    "auth-sdk refresh credential",
                    attributes(key),
                    value.expose().as_bytes(),
                    true,
                    "text/plain",
                )
                .map_err(map)?;
        }
        Ok(())
    }

    pub fn delete(key: &str) -> Result<()> {
        let service = connect(key)?;
        if let Some(item) = find(&service, key)? {
            item.delete().map_err(map)?;
        }
        Ok(())
    }
}
