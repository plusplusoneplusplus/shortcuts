use std::path::{Path, PathBuf};

use super::credentials::CREDENTIALS_FILE;
use super::refresh::ClaudeRefreshResponse;

/// Fields to persist into the `claudeAiOauth` section of the credentials JSON.
/// This is a write-only view; fields not present here are preserved from the
/// existing credential file.
pub struct PersistFields<'a> {
    pub access_token: &'a str,
    pub refresh_token: &'a str,
    pub expires_at: u64,
    pub scopes: &'a [String],
    pub subscription_type: Option<&'a str>,
    pub rate_limit_tier: Option<&'a str>,
}

impl<'a> From<&'a ClaudeRefreshResponse> for PersistFields<'a> {
    fn from(r: &'a ClaudeRefreshResponse) -> Self {
        Self {
            access_token: r.access_token.expose(),
            refresh_token: r.refresh_token.expose(),
            expires_at: r.expires_at,
            scopes: &r.scopes,
            subscription_type: None,
            rate_limit_tier: None,
        }
    }
}

/// Result of a [`persist_credentials`] call.
pub struct PersistResult {
    /// `true` when the credentials were durably written to at least one backend.
    pub success: bool,
    /// Warning message when a non-primary backend was used (e.g. plaintext fallback).
    pub warning: Option<String>,
}

/// Where to persist the credentials.
pub struct PersistTarget {
    /// Home directory for locating `~/.claude/.credentials.json`.
    pub home_dir: PathBuf,
    /// When `true`, skip the macOS Keychain and persist only to the file.
    pub skip_keychain: bool,
}

/// Persists refreshed Claude credentials back to the credential store.
///
/// The write is a read-modify-write: the existing JSON is read, only the
/// `claudeAiOauth` section is updated, and sibling keys like `mcpOAuth`
/// are preserved. The result is written back to the same source.
///
/// ## Write priority (macOS)
///
/// 1. **Keychain** — primary. If the write succeeds, any stale plaintext file
///    is left alone (the CLI deletes it, but we don't to avoid races).
/// 2. **File** — fallback. Used when Keychain is unavailable, locked, or
///    `skip_keychain` is set.
///
/// ## Write priority (Linux / Windows)
///
/// File-only: writes to `~/.claude/.credentials.json` with mode `0o600`.
pub async fn persist_credentials(
    fields: &PersistFields<'_>,
    target: &PersistTarget,
) -> PersistResult {
    let existing_json = read_existing_json(target);
    let merged = merge_fields(&existing_json, fields);
    // Keep Keychain values readable as JSON through the Claude CLI's security -w.
    let json_str = match serde_json::to_string(&merged) {
        Ok(s) => s,
        Err(_) => return PersistResult { success: false, warning: None },
    };

    if !target.skip_keychain {
        if let Some(result) = try_write_keychain(&json_str).await {
            return result;
        }
    }

    write_file(&target.home_dir, &json_str)
}

fn read_existing_json(target: &PersistTarget) -> serde_json::Value {
    let path = target.home_dir.join(CREDENTIALS_FILE);
    std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_else(|| serde_json::Value::Object(serde_json::Map::new()))
}

pub(super) fn merge_fields(
    existing: &serde_json::Value,
    fields: &PersistFields<'_>,
) -> serde_json::Value {
    let mut root = match existing {
        serde_json::Value::Object(_) => existing.clone(),
        _ => serde_json::Value::Object(serde_json::Map::new()),
    };
    let obj = root.as_object_mut().unwrap();

    let mut oauth = match obj.remove("claudeAiOauth") {
        Some(serde_json::Value::Object(m)) => m,
        _ => serde_json::Map::new(),
    };

    oauth.insert("accessToken".into(), fields.access_token.into());
    oauth.insert("refreshToken".into(), fields.refresh_token.into());
    oauth.insert("expiresAt".into(), fields.expires_at.into());
    oauth.insert(
        "scopes".into(),
        serde_json::Value::Array(
            fields.scopes.iter().map(|s| serde_json::Value::String(s.clone())).collect(),
        ),
    );
    if let Some(st) = fields.subscription_type {
        oauth.insert("subscriptionType".into(), st.into());
    }
    if let Some(rlt) = fields.rate_limit_tier {
        oauth.insert("rateLimitTier".into(), rlt.into());
    }

    obj.insert("claudeAiOauth".into(), serde_json::Value::Object(oauth));

    root
}

async fn try_write_keychain(json_str: &str) -> Option<PersistResult> {
    #[cfg(not(target_os = "macos"))]
    {
        let _ = json_str;
        None
    }
    #[cfg(target_os = "macos")]
    {
        use super::keychain::ClaudeStore;
        use crate::Secret;
        let account = match std::env::var("USER") {
            Ok(u) if !u.is_empty() => u,
            _ => return None,
        };
        let cancel = tokio_util::sync::CancellationToken::new();
        let store = super::keychain::store(
            &cancel,
            tokio::time::Instant::now() + std::time::Duration::from_secs(5),
        );
        let secret = Secret::new(json_str.to_owned());
        match store.write(&account, &secret).await {
            Ok(()) => Some(PersistResult { success: true, warning: None }),
            Err(_) => None,
        }
    }
}

fn write_file(home_dir: &Path, json_str: &str) -> PersistResult {
    let dir = home_dir.join(".claude");
    let path = dir.join(".credentials.json");

    if std::fs::create_dir_all(&dir).is_err() {
        return PersistResult { success: false, warning: None };
    }

    match atomic_write(&path, json_str) {
        Ok(()) => {
            set_file_permissions(&path);
            PersistResult {
                success: true,
                warning: Some("Warning: Storing credentials in plaintext.".into()),
            }
        }
        Err(_) => PersistResult { success: false, warning: None },
    }
}

pub(super) fn atomic_write(path: &Path, content: &str) -> std::io::Result<()> {
    use std::io::Write;

    let dir = path.parent().unwrap_or(Path::new("."));
    let mut tmp = tempfile::NamedTempFile::new_in(dir)?;
    tmp.write_all(content.as_bytes())?;
    tmp.flush()?;
    tmp.as_file().sync_all()?;
    tmp.persist(path)?;
    Ok(())
}

#[cfg(unix)]
fn set_file_permissions(path: &Path) {
    use std::os::unix::fs::PermissionsExt;
    let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
}

#[cfg(not(unix))]
fn set_file_permissions(_path: &Path) {}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Secret;

    fn default_fields() -> PersistFields<'static> {
        PersistFields {
            access_token: "new-access",
            refresh_token: "new-refresh",
            expires_at: 1700000000000,
            scopes: &[],
            subscription_type: None,
            rate_limit_tier: None,
        }
    }

    #[test]
    fn merge_creates_claude_ai_oauth_section() {
        let existing = serde_json::json!({});
        let result = merge_fields(&existing, &default_fields());
        let oauth = result["claudeAiOauth"].as_object().unwrap();
        assert_eq!(oauth["accessToken"], "new-access");
        assert_eq!(oauth["refreshToken"], "new-refresh");
        assert_eq!(oauth["expiresAt"], 1700000000000u64);
    }

    #[test]
    fn merge_preserves_sibling_keys() {
        let existing = serde_json::json!({
            "mcpOAuth": {"plugin:figma": {"token": "xyz"}},
            "someOtherKey": 42
        });
        let result = merge_fields(&existing, &default_fields());
        assert_eq!(result["mcpOAuth"]["plugin:figma"]["token"], "xyz");
        assert_eq!(result["someOtherKey"], 42);
        assert_eq!(result["claudeAiOauth"]["accessToken"], "new-access");
    }

    #[test]
    fn merge_preserves_existing_oauth_fields() {
        let existing = serde_json::json!({
            "claudeAiOauth": {
                "accessToken": "old-access",
                "refreshToken": "old-refresh",
                "subscriptionType": "pro",
                "rateLimitTier": "default",
                "clientId": "original-client"
            }
        });
        let result = merge_fields(&existing, &default_fields());
        let oauth = result["claudeAiOauth"].as_object().unwrap();
        assert_eq!(oauth["accessToken"], "new-access");
        assert_eq!(oauth["refreshToken"], "new-refresh");
        assert_eq!(oauth["clientId"], "original-client");
        assert_eq!(oauth["subscriptionType"], "pro");
    }

    #[test]
    fn merge_updates_subscription_and_rate_limit() {
        let scopes = vec!["user:inference".to_owned()];
        let fields = PersistFields {
            access_token: "tok",
            refresh_token: "rt",
            expires_at: 999,
            scopes: &scopes,
            subscription_type: Some("max"),
            rate_limit_tier: Some("tier-1"),
        };
        let result = merge_fields(&serde_json::json!({}), &fields);
        let oauth = result["claudeAiOauth"].as_object().unwrap();
        assert_eq!(oauth["subscriptionType"], "max");
        assert_eq!(oauth["rateLimitTier"], "tier-1");
        assert_eq!(oauth["scopes"], serde_json::json!(["user:inference"]));
    }

    #[test]
    fn merge_replaces_non_object_existing() {
        let existing = serde_json::json!("not an object");
        let result = merge_fields(&existing, &default_fields());
        assert!(result["claudeAiOauth"].is_object());
    }

    #[test]
    fn merge_replaces_non_object_oauth() {
        let existing = serde_json::json!({"claudeAiOauth": "string"});
        let result = merge_fields(&existing, &default_fields());
        assert_eq!(result["claudeAiOauth"]["accessToken"], "new-access");
    }

    #[tokio::test]
    async fn persist_to_file_creates_credentials() {
        let dir = tempfile::tempdir().unwrap();
        let target = PersistTarget { home_dir: dir.path().to_owned(), skip_keychain: true };
        let result = persist_credentials(&default_fields(), &target).await;
        assert!(result.success);
        assert!(result.warning.is_some());

        let content =
            std::fs::read_to_string(dir.path().join(".claude/.credentials.json")).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&content).unwrap();
        assert!(
            !content.contains('\n'),
            "Credential JSON must also be safe for CLI Keychain readers"
        );
        assert_eq!(parsed["claudeAiOauth"]["accessToken"], "new-access");
        assert_eq!(parsed["claudeAiOauth"]["refreshToken"], "new-refresh");
    }

    #[tokio::test]
    async fn persist_to_file_preserves_existing_content() {
        let dir = tempfile::tempdir().unwrap();
        let creds_dir = dir.path().join(".claude");
        std::fs::create_dir_all(&creds_dir).unwrap();
        std::fs::write(
            creds_dir.join(".credentials.json"),
            r#"{"mcpOAuth":{"figma":"tok"},"claudeAiOauth":{"accessToken":"old"}}"#,
        )
        .unwrap();

        let target = PersistTarget { home_dir: dir.path().to_owned(), skip_keychain: true };
        let result = persist_credentials(&default_fields(), &target).await;
        assert!(result.success);

        let content =
            std::fs::read_to_string(dir.path().join(".claude/.credentials.json")).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&content).unwrap();
        assert_eq!(parsed["mcpOAuth"]["figma"], "tok");
        assert_eq!(parsed["claudeAiOauth"]["accessToken"], "new-access");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn persist_sets_file_permissions_600() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let target = PersistTarget { home_dir: dir.path().to_owned(), skip_keychain: true };
        persist_credentials(&default_fields(), &target).await;

        let meta = std::fs::metadata(dir.path().join(".claude/.credentials.json")).unwrap();
        assert_eq!(meta.permissions().mode() & 0o777, 0o600);
    }

    #[tokio::test]
    async fn persist_creates_directory_if_missing() {
        let dir = tempfile::tempdir().unwrap();
        let target = PersistTarget { home_dir: dir.path().to_owned(), skip_keychain: true };
        let result = persist_credentials(&default_fields(), &target).await;
        assert!(result.success);
        assert!(dir.path().join(".claude/.credentials.json").exists());
    }

    #[test]
    fn from_refresh_response() {
        let response = ClaudeRefreshResponse {
            access_token: Secret::new("acc".into()),
            refresh_token: Secret::new("ref".into()),
            expires_at: 12345,
            scopes: vec!["a".into(), "b".into()],
        };
        let fields = PersistFields::from(&response);
        assert_eq!(fields.access_token, "acc");
        assert_eq!(fields.refresh_token, "ref");
        assert_eq!(fields.expires_at, 12345);
        assert_eq!(fields.scopes, &["a", "b"]);
        assert!(fields.subscription_type.is_none());
        assert!(fields.rate_limit_tier.is_none());
    }
}
