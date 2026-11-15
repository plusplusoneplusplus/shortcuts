use std::fs::{self, File, OpenOptions};
use std::io;
use std::path::Path;

const LOCK_FILE: &str = ".coc-profile-lock";
const DATA_STORE_FILE: &str = "data-store-id";

/// Holds the profile for the helper's lifetime. The OS releases the advisory lock
/// even when the helper crashes.
pub struct ProfileLock {
    _file: File,
}

pub fn lock(profile: &Path) -> io::Result<ProfileLock> {
    fs::create_dir_all(profile)?;
    let file = OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(profile.join(LOCK_FILE))?;
    file.try_lock().map_err(|error| match error {
        fs::TryLockError::WouldBlock => {
            io::Error::new(io::ErrorKind::WouldBlock, "the browser profile is in use")
        }
        fs::TryLockError::Error(error) => error,
    })?;
    Ok(ProfileLock { _file: file })
}

/// Canonical lowercase hyphenated UUID, the form `NSUUID` accepts and
/// `WKWebsiteDataStore(forIdentifier:)` persists under.
pub fn valid_uuid(value: &str) -> bool {
    value.len() == 36
        && value.bytes().enumerate().all(|(index, byte)| match index {
            8 | 13 | 18 | 23 => byte == b'-',
            _ => byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase(),
        })
}

/// The dedicated persistent data store for this profile. A missing or damaged id is
/// replaced, which starts a fresh store rather than sharing another one.
pub fn data_store_id(profile: &Path, generate: impl FnOnce() -> String) -> io::Result<String> {
    let path = profile.join(DATA_STORE_FILE);
    match fs::read_to_string(&path) {
        Ok(id) if valid_uuid(id.trim()) => return Ok(id.trim().to_string()),
        Ok(_) => {}
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(error) => return Err(error),
    }
    let id = generate().to_ascii_lowercase();
    if !valid_uuid(&id) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "generated data store id is not a UUID",
        ));
    }
    let temporary = profile.join(format!("{DATA_STORE_FILE}.tmp"));
    fs::write(&temporary, &id)?;
    fs::rename(&temporary, &path)?;
    Ok(id)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temporary_profile(name: &str) -> std::path::PathBuf {
        let path =
            std::env::temp_dir().join(format!("coc-wkwebview-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&path);
        path
    }

    #[test]
    fn data_store_id_is_created_once_and_reused() {
        let profile = temporary_profile("store");
        fs::create_dir_all(&profile).unwrap();
        let id = data_store_id(&profile, || "6F9619FF-8B86-D011-B42D-00C04FC964FF".into()).unwrap();
        assert_eq!(id, "6f9619ff-8b86-d011-b42d-00c04fc964ff");
        let again = data_store_id(&profile, || panic!("an existing id must be reused")).unwrap();
        assert_eq!(again, id);
        fs::write(profile.join(DATA_STORE_FILE), "damaged").unwrap();
        let replaced =
            data_store_id(&profile, || "00000000-0000-4000-8000-000000000001".into()).unwrap();
        assert_eq!(replaced, "00000000-0000-4000-8000-000000000001");
        assert!(data_store_id(&temporary_profile("store-bad"), || "x".into()).is_err());
        fs::remove_dir_all(&profile).unwrap();
    }

    #[test]
    fn uuids_are_canonical() {
        assert!(valid_uuid("6f9619ff-8b86-d011-b42d-00c04fc964ff"));
        for value in [
            "",
            "6F9619FF-8B86-D011-B42D-00C04FC964FF",
            "6f9619ff8b86d011b42d00c04fc964ff",
            "6f9619ff-8b86-d011-b42d-00c04fc964fg",
        ] {
            assert!(!valid_uuid(value), "{value}");
        }
    }

    #[test]
    fn a_profile_is_locked_by_one_holder_at_a_time() {
        let profile = temporary_profile("lock");
        let held = lock(&profile).unwrap();
        assert_eq!(lock(&profile).err().map(|error| error.kind()), Some(io::ErrorKind::WouldBlock));
        drop(held);
        drop(lock(&profile).unwrap());
        fs::remove_dir_all(&profile).unwrap();
    }
}
