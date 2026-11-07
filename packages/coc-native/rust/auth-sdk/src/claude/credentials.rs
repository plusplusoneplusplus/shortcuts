use crate::Secret;
use std::path::{Path, PathBuf};

/// macOS Keychain service name under which `claude login` stores the OAuth
/// credentials JSON. The same `{ claudeAiOauth: { accessToken, … } }` shape
/// is used by the on-disk file on Linux/Windows.
pub const MACOS_KEYCHAIN_SERVICE: &str = "Claude Code-credentials";

/// Default credentials file path relative to the home directory.
pub const CREDENTIALS_FILE: &str = ".claude/.credentials.json";

/// Parsed Claude OAuth token extracted from the credentials JSON.
#[derive(Clone)]
pub struct ClaudeToken {
    pub access_token: Secret,
    pub refresh_token: Option<Secret>,
    /// Access token expiry as epoch milliseconds, if present.
    pub expires_at: Option<u64>,
    /// Refresh token expiry as epoch milliseconds, if present.
    pub refresh_token_expires_at: Option<u64>,
    pub scopes: Vec<String>,
    pub subscription_type: Option<String>,
    pub rate_limit_tier: Option<String>,
}

/// Injectable credential sources for [`read_credentials`].
pub struct ClaudeCredentialSources {
    /// Override credentials file path (e.g. from `$CLAUDE_CREDENTIALS_FILE`).
    /// When set, the file is used exclusively — keychain is not consulted.
    pub credentials_file_override: Option<PathBuf>,
    /// Home directory used to locate `~/.claude/.credentials.json`.
    pub home_dir: PathBuf,
    /// When `true`, skip the macOS Keychain fallback entirely.
    /// Useful in tests or headless environments where Keychain access is
    /// unavailable or would return unrelated credentials.
    pub skip_keychain: bool,
}

/// Reads Claude credentials from the first available source:
///   1. `credentials_file_override` (if set) — file only, no keychain
///   2. `~/.claude/.credentials.json` — default file path
///   3. macOS Keychain (`Claude Code-credentials` service) — darwin only
///
/// Returns `None` when no source yields a valid token.
/// This function is read-only — it never writes credentials.
pub async fn read_credentials(sources: &ClaudeCredentialSources) -> Option<ClaudeToken> {
    let cancel = tokio_util::sync::CancellationToken::new();
    let store = super::keychain::store(
        &cancel,
        tokio::time::Instant::now() + std::time::Duration::from_secs(5),
    );
    let (_, raw) = resolve_raw(sources, &store, keychain_account().as_deref()).await?;
    extract_token(&raw)
}

pub(super) enum CredentialSource {
    File(PathBuf),
    Keychain(String),
}

pub(super) fn keychain_account() -> Option<String> {
    #[cfg(target_os = "macos")]
    {
        std::env::var("USER").ok().filter(|account| !account.is_empty())
    }
    #[cfg(not(target_os = "macos"))]
    {
        None
    }
}

pub(super) async fn resolve_raw(
    sources: &ClaudeCredentialSources,
    store: &dyn super::keychain::ClaudeStore,
    account: Option<&str>,
) -> Option<(CredentialSource, String)> {
    if let Some(path) = &sources.credentials_file_override {
        return read_file(path).map(|raw| (CredentialSource::File(path.clone()), raw));
    }
    let path = sources.home_dir.join(CREDENTIALS_FILE);
    if let Some(raw) = read_file(&path) {
        return Some((CredentialSource::File(path), raw));
    }
    if sources.skip_keychain {
        return None;
    }
    let account = account?;
    let raw = store.read(account).await.ok()??;
    let raw = raw.expose().trim();
    if raw.is_empty() {
        None
    } else {
        Some((CredentialSource::Keychain(account.to_owned()), raw.to_owned()))
    }
}

fn read_file(path: &Path) -> Option<String> {
    let content = std::fs::read_to_string(path).ok()?;
    let trimmed = content.trim();
    if trimmed.is_empty() {
        return None;
    }
    Some(trimmed.to_owned())
}

/// Extracts a [`ClaudeToken`] from a raw credentials JSON string.
///
/// Supports two formats:
/// - Claude Code CLI: `{ "claudeAiOauth": { "accessToken": "…", … } }`
/// - Flat SDK format: `{ "access_token": "…" }`
///
/// The nested format is preferred; the flat format is a fallback.
pub(crate) fn extract_token(raw: &str) -> Option<ClaudeToken> {
    let value: serde_json::Value = serde_json::from_str(raw).ok()?;

    // Try nested claudeAiOauth format first.
    if let Some((nested, access_token)) = value
        .get("claudeAiOauth")
        .and_then(|v| v.as_object())
        .and_then(|nested| non_empty_str(nested.get("accessToken")).map(|token| (nested, token)))
    {
        return Some(ClaudeToken {
            access_token: Secret::new(access_token),
            refresh_token: non_empty_str(nested.get("refreshToken")).map(Secret::new),
            expires_at: nested.get("expiresAt").and_then(|v| v.as_u64()),
            refresh_token_expires_at: nested.get("refreshTokenExpiresAt").and_then(|v| v.as_u64()),
            scopes: nested
                .get("scopes")
                .and_then(|v| v.as_array())
                .map(|arr| arr.iter().filter_map(|v| v.as_str().map(str::to_owned)).collect())
                .unwrap_or_default(),
            subscription_type: non_empty_str(nested.get("subscriptionType")),
            rate_limit_tier: non_empty_str(nested.get("rateLimitTier")),
        });
    }

    // Flat format fallback.
    let access_token = non_empty_str(value.get("access_token"))?;
    Some(ClaudeToken {
        access_token: Secret::new(access_token),
        refresh_token: non_empty_str(value.get("refresh_token")).map(Secret::new),
        expires_at: value.get("expires_at").and_then(|v| v.as_u64()),
        refresh_token_expires_at: None,
        scopes: Vec::new(),
        subscription_type: None,
        rate_limit_tier: None,
    })
}

fn non_empty_str(value: Option<&serde_json::Value>) -> Option<String> {
    value.and_then(|v| v.as_str()).filter(|s| !s.is_empty()).map(str::to_owned)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nested_format_extracts_all_fields() {
        let json = serde_json::json!({
            "claudeAiOauth": {
                "accessToken": "sk-ant-access",
                "refreshToken": "sk-ant-refresh",
                "expiresAt": 1700000000000u64,
                "refreshTokenExpiresAt": 1702592000000u64,
                "scopes": ["openid", "offline_access", "profile"],
                "subscriptionType": "pro",
                "rateLimitTier": "default_claude_ai"
            }
        });
        let token = extract_token(&json.to_string()).unwrap();
        assert_eq!(token.access_token.expose(), "sk-ant-access");
        assert_eq!(token.refresh_token.as_ref().unwrap().expose(), "sk-ant-refresh");
        assert_eq!(token.expires_at, Some(1700000000000));
        assert_eq!(token.refresh_token_expires_at, Some(1702592000000));
        assert_eq!(token.scopes, vec!["openid", "offline_access", "profile"]);
        assert_eq!(token.subscription_type.as_deref(), Some("pro"));
        assert_eq!(token.rate_limit_tier.as_deref(), Some("default_claude_ai"));
    }

    #[test]
    fn nested_format_minimal_fields() {
        let json = serde_json::json!({
            "claudeAiOauth": {
                "accessToken": "sk-ant-minimal"
            }
        });
        let token = extract_token(&json.to_string()).unwrap();
        assert_eq!(token.access_token.expose(), "sk-ant-minimal");
        assert!(token.refresh_token.is_none());
        assert!(token.expires_at.is_none());
        assert!(token.refresh_token_expires_at.is_none());
        assert!(token.scopes.is_empty());
        assert!(token.subscription_type.is_none());
        assert!(token.rate_limit_tier.is_none());
    }

    #[test]
    fn flat_format_extracts_token() {
        let json = serde_json::json!({
            "access_token": "flat-token",
            "refresh_token": "flat-refresh",
            "expires_at": 1700000000000u64
        });
        let token = extract_token(&json.to_string()).unwrap();
        assert_eq!(token.access_token.expose(), "flat-token");
        assert_eq!(token.refresh_token.as_ref().unwrap().expose(), "flat-refresh");
        assert_eq!(token.expires_at, Some(1700000000000));
        assert!(token.refresh_token_expires_at.is_none());
        assert!(token.scopes.is_empty());
    }

    #[test]
    fn nested_format_preferred_over_flat() {
        let json = serde_json::json!({
            "claudeAiOauth": {
                "accessToken": "nested-wins"
            },
            "access_token": "flat-loses"
        });
        let token = extract_token(&json.to_string()).unwrap();
        assert_eq!(token.access_token.expose(), "nested-wins");
    }

    #[test]
    fn empty_nested_token_preserves_flat_fallback() {
        let raw = r#"{"claudeAiOauth":{"accessToken":""},"access_token":"flat-access"}"#;
        assert_eq!(extract_token(raw).unwrap().access_token.expose(), "flat-access");
    }

    #[test]
    fn empty_access_token_returns_none() {
        for json in [
            serde_json::json!({"claudeAiOauth": {"accessToken": ""}}),
            serde_json::json!({"access_token": ""}),
            serde_json::json!({"claudeAiOauth": {}}),
            serde_json::json!({}),
        ] {
            assert!(extract_token(&json.to_string()).is_none(), "expected None for: {}", json);
        }
    }

    #[test]
    fn malformed_json_returns_none() {
        assert!(extract_token("not json").is_none());
        assert!(extract_token("").is_none());
        assert!(extract_token("null").is_none());
        assert!(extract_token("42").is_none());
    }

    #[test]
    fn mcp_oauth_ignored() {
        let json = serde_json::json!({
            "mcpOAuth": {"plugin:design:figma": {}},
            "claudeAiOauth": {
                "accessToken": "real-token"
            }
        });
        let token = extract_token(&json.to_string()).unwrap();
        assert_eq!(token.access_token.expose(), "real-token");
    }

    #[tokio::test]
    async fn read_credentials_from_file() {
        let dir = tempfile::tempdir().unwrap();
        let creds_dir = dir.path().join(".claude");
        std::fs::create_dir_all(&creds_dir).unwrap();
        let creds_file = creds_dir.join(".credentials.json");
        std::fs::write(&creds_file, r#"{"claudeAiOauth":{"accessToken":"file-token"}}"#).unwrap();
        let sources = ClaudeCredentialSources {
            credentials_file_override: None,
            home_dir: dir.path().to_owned(),
            skip_keychain: true,
        };
        let token = read_credentials(&sources).await.unwrap();
        assert_eq!(token.access_token.expose(), "file-token");
    }

    #[tokio::test]
    async fn read_credentials_from_override_file() {
        let dir = tempfile::tempdir().unwrap();
        let override_file = dir.path().join("custom-creds.json");
        std::fs::write(&override_file, r#"{"access_token":"override-token"}"#).unwrap();
        let sources = ClaudeCredentialSources {
            credentials_file_override: Some(override_file),
            home_dir: dir.path().to_owned(),
            skip_keychain: true,
        };
        let token = read_credentials(&sources).await.unwrap();
        assert_eq!(token.access_token.expose(), "override-token");
    }

    #[tokio::test]
    async fn read_credentials_returns_none_for_missing_file() {
        let dir = tempfile::tempdir().unwrap();
        let sources = ClaudeCredentialSources {
            credentials_file_override: None,
            home_dir: dir.path().to_owned(),
            skip_keychain: true,
        };
        assert!(read_credentials(&sources).await.is_none());
    }

    #[tokio::test]
    async fn read_credentials_returns_none_for_empty_file() {
        let dir = tempfile::tempdir().unwrap();
        let creds_dir = dir.path().join(".claude");
        std::fs::create_dir_all(&creds_dir).unwrap();
        std::fs::write(creds_dir.join(".credentials.json"), "  ").unwrap();
        let sources = ClaudeCredentialSources {
            credentials_file_override: None,
            home_dir: dir.path().to_owned(),
            skip_keychain: true,
        };
        assert!(read_credentials(&sources).await.is_none());
    }

    #[tokio::test]
    async fn read_credentials_override_ignores_default_file() {
        let dir = tempfile::tempdir().unwrap();
        // Write a real token in the default location.
        let creds_dir = dir.path().join(".claude");
        std::fs::create_dir_all(&creds_dir).unwrap();
        std::fs::write(
            creds_dir.join(".credentials.json"),
            r#"{"claudeAiOauth":{"accessToken":"default-token"}}"#,
        )
        .unwrap();
        // Override points to a nonexistent file.
        let sources = ClaudeCredentialSources {
            credentials_file_override: Some(dir.path().join("nonexistent.json")),
            home_dir: dir.path().to_owned(),
            skip_keychain: true,
        };
        assert!(read_credentials(&sources).await.is_none());
    }
}
