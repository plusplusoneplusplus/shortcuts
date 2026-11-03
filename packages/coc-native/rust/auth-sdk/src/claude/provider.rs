use super::credentials::{extract_token, keychain_account, resolve_raw, CredentialSource};
use super::keychain::ClaudeStore;
use super::persist::{atomic_write, merge_fields};
use super::{
    is_expired, refresh_token, ClaudeCredentialSources, ClaudeRefreshOptions, ClaudeToken,
    PersistFields, MACOS_KEYCHAIN_SERVICE,
};
use crate::contracts::checkpoint;
use crate::oauth::{CredentialLock, HttpTransport, OAuthRefreshError};
use crate::{AuthError, ErrorCode, Secret};
use std::path::Path;
use tokio_util::sync::CancellationToken;

/// Configuration for one demand-driven acquisition. All callers sharing credentials
/// must use the same existing, private coordination directory.
pub struct ClaudeTokenOptions<'a> {
    pub sources: &'a ClaudeCredentialSources,
    pub coordination_dir: &'a Path,
    /// Renew even a fresh token, for example after an API rejects it with HTTP 401.
    pub force_refresh: bool,
    pub refresh: ClaudeRefreshOptions<'a>,
}

/// Reads credentials and renews known expiries within the expiry margin, or on
/// explicit force. Unknown expiry is otherwise unchanged. Missing credentials
/// never trigger login.
///
/// Refresh pins the selected file or Keychain account, locks it, and re-reads it
/// before exchanging. Rotated credentials are saved to that exact source before
/// publication; persistence failure never returns the new token. This coordinates
/// SDK callers only: the Claude CLI does not participate in this lock protocol.
/// Synchronous credential-store/file I/O should run on a worker, not a UI thread.
pub async fn acquire_token(
    http: &dyn HttpTransport,
    options: &ClaudeTokenOptions<'_>,
    cancel: &CancellationToken,
    deadline: tokio::time::Instant,
) -> Result<ClaudeToken, OAuthRefreshError> {
    let store = super::keychain::store(cancel, deadline);
    acquire_with_store(http, options, &store, keychain_account().as_deref(), cancel, deadline).await
}

async fn acquire_with_store(
    http: &dyn HttpTransport,
    options: &ClaudeTokenOptions<'_>,
    store: &dyn ClaudeStore,
    account: Option<&str>,
    cancel: &CancellationToken,
    deadline: tokio::time::Instant,
) -> Result<ClaudeToken, OAuthRefreshError> {
    checkpoint(cancel, deadline)?;
    let selected = resolve_raw(options.sources, store, account).await;
    checkpoint(cancel, deadline)?;
    let (mut source, raw) = selected.ok_or_else(|| AuthError::new(ErrorCode::LoginRequired))?;
    let token = parse(&raw)?;
    if !options.force_refresh && !needs_refresh(&token) {
        return Ok(token);
    }

    // Canonical paths make file aliases share a lock and preserve a symlink target
    // during atomic replacement. Never switch to another backend after selection.
    let key = match &mut source {
        CredentialSource::File(path) => {
            *path = std::fs::canonicalize(&path)
                .map_err(|_| AuthError::new(ErrorCode::StorageFailed))?;
            let path =
                path.to_str().ok_or_else(|| AuthError::new(ErrorCode::InvalidConfiguration))?;
            format!("claude:file:{path}")
        }
        CredentialSource::Keychain(account) => format!("claude:{MACOS_KEYCHAIN_SERVICE}:{account}"),
    };
    let _lock = tokio::select! {
        biased;
        _ = cancel.cancelled() => return Err(AuthError::new(ErrorCode::Cancelled).into()),
        result = tokio::time::timeout_at(
            deadline, CredentialLock::acquire(options.coordination_dir, &key),
        ) => result.map_err(|_| AuthError::new(ErrorCode::TimedOut))??,
    };
    checkpoint(cancel, deadline)?;
    let observed = token;
    let raw = read_source(&source, store).await?;
    if let CredentialSource::Keychain(account) = &source {
        store.validate_write(account, &raw)?;
    }
    let token = parse(raw.expose())?;
    let changed = token.access_token.expose() != observed.access_token.expose()
        || token.refresh_token.as_ref().map(Secret::expose)
            != observed.refresh_token.as_ref().map(Secret::expose);
    if !needs_refresh(&token) && (!options.force_refresh || changed) {
        checkpoint(cancel, deadline)?;
        return Ok(token);
    }
    let refresh =
        token.refresh_token.as_ref().ok_or_else(|| AuthError::new(ErrorCode::LoginRequired))?;
    if token
        .refresh_token_expires_at
        .is_some_and(|expiry| crate::Clock::now_ms(&crate::SystemClock) >= expiry)
    {
        return Err(AuthError::new(ErrorCode::InteractionRequired).into());
    }
    let response = refresh_token(http, &options.refresh, refresh, cancel, deadline).await?;

    // Re-read for sibling changes and detect an external credential replacement.
    // Do not retry a rotation with an unknown outcome or fall back to another store.
    let raw = read_source(&source, store).await?;
    let current = parse(raw.expose())?;
    if current.access_token.expose() != token.access_token.expose()
        || current.refresh_token.as_ref().map(Secret::expose) != Some(refresh.expose())
    {
        return Err(AuthError::new(ErrorCode::AccountMismatch).into());
    }
    let existing = serde_json::from_str(raw.expose())
        .map_err(|_| AuthError::new(ErrorCode::InvalidTokenResponse))?;
    let mut fields = PersistFields::from(&response);
    if fields.scopes.is_empty() {
        fields.scopes = &token.scopes;
    }
    let merged = merge_fields(&existing, &fields);
    let raw = Secret::new(
        // security -w hex-encodes multiline Keychain values; Claude expects JSON.
        serde_json::to_string(&merged).map_err(|_| AuthError::new(ErrorCode::StorageFailed))?,
    );
    // Once rotation succeeds, finish saving it even if cancellation arrives here.
    match &source {
        CredentialSource::File(path) => atomic_write(path, raw.expose())
            .map_err(|_| AuthError::new(ErrorCode::StorageFailed))?,
        CredentialSource::Keychain(account) => store.write(account, &raw).await?,
    }
    checkpoint(cancel, deadline)?;
    Ok(parse(raw.expose())?)
}

fn needs_refresh(token: &ClaudeToken) -> bool {
    token.expires_at.is_some_and(is_expired)
}

fn parse(raw: &str) -> crate::Result<ClaudeToken> {
    extract_token(raw).ok_or_else(|| AuthError::new(ErrorCode::InvalidTokenResponse))
}

async fn read_source(source: &CredentialSource, store: &dyn ClaudeStore) -> crate::Result<Secret> {
    match source {
        CredentialSource::File(path) => std::fs::read_to_string(path)
            .map(Secret::new)
            .map_err(|_| AuthError::new(ErrorCode::StorageFailed)),
        CredentialSource::Keychain(account) => {
            store.read(account).await?.ok_or_else(|| AuthError::new(ErrorCode::LoginRequired))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::oauth::{HttpResponse, OAuthRefreshRejection};
    use crate::CredentialStore;
    use async_trait::async_trait;
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        Mutex,
    };
    use std::time::Duration;

    #[derive(Default)]
    struct Store {
        raw: Mutex<Option<Secret>>,
        writes: AtomicUsize,
        fail_write: bool,
        cancel_on_write: Option<CancellationToken>,
    }

    impl CredentialStore for Store {
        fn read(&self, _: &str) -> crate::Result<Option<Secret>> {
            Ok(self.raw.lock().unwrap().clone())
        }
        fn write(&self, _: &str, value: &Secret) -> crate::Result<()> {
            self.writes.fetch_add(1, Ordering::SeqCst);
            if self.fail_write {
                return Err(AuthError::new(ErrorCode::StorageDenied));
            }
            *self.raw.lock().unwrap() = Some(value.clone());
            if let Some(cancel) = &self.cancel_on_write {
                cancel.cancel();
            }
            Ok(())
        }
        fn delete(&self, _: &str) -> crate::Result<()> {
            panic!("acquisition must not delete credentials")
        }
    }

    #[derive(Default)]
    struct Http {
        calls: AtomicUsize,
        reject: bool,
        pending: bool,
        action: Option<Box<dyn Fn() + Send + Sync>>,
    }

    #[async_trait]
    impl HttpTransport for Http {
        async fn request(
            &self,
            _: &str,
            _: Option<&[(String, String)]>,
        ) -> crate::Result<HttpResponse> {
            panic!("Claude refresh must use JSON")
        }
        async fn request_json(&self, _: &str, body: &str) -> crate::Result<HttpResponse> {
            let body: serde_json::Value = serde_json::from_str(body).unwrap();
            assert_eq!(body["refresh_token"], "old-refresh");
            self.calls.fetch_add(1, Ordering::SeqCst);
            if let Some(action) = &self.action {
                action();
            }
            if self.pending {
                return std::future::pending().await;
            }
            // Let a concurrent caller reach the credential lock before publishing.
            tokio::task::yield_now().await;
            Ok(HttpResponse {
                status: if self.reject { 400 } else { 200 },
                body: Secret::new(if self.reject {
                    r#"{"error":"invalid_grant"}"#.into()
                } else {
                    r#"{"access_token":"new-access","refresh_token":"new-refresh","expires_in":3600}"#.into()
                }),
            })
        }
    }

    struct Fixture {
        _dir: tempfile::TempDir,
        sources: ClaudeCredentialSources,
        locks: std::path::PathBuf,
    }

    impl Fixture {
        fn new() -> Self {
            let dir = tempfile::tempdir().unwrap();
            let locks = dir.path().join("locks");
            std::fs::create_dir(&locks).unwrap();
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                std::fs::set_permissions(&locks, std::fs::Permissions::from_mode(0o700)).unwrap();
            }
            let sources = ClaudeCredentialSources {
                home_dir: dir.path().to_owned(),
                credentials_file_override: None,
                skip_keychain: true,
            };
            Self { _dir: dir, sources, locks }
        }
        fn path(&self) -> std::path::PathBuf {
            self.sources
                .credentials_file_override
                .clone()
                .unwrap_or_else(|| self.sources.home_dir.join(super::super::CREDENTIALS_FILE))
        }
        fn write(&self, value: &serde_json::Value) {
            let path = self.path();
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, value.to_string()).unwrap();
        }
        fn options(&self) -> ClaudeTokenOptions<'_> {
            ClaudeTokenOptions {
                sources: &self.sources,
                coordination_dir: &self.locks,
                force_refresh: false,
                refresh: ClaudeRefreshOptions::default(),
            }
        }
        async fn acquire(
            &self,
            http: &Http,
            store: &Store,
        ) -> Result<ClaudeToken, OAuthRefreshError> {
            acquire_with_store(
                http,
                &self.options(),
                store,
                Some("test-account"),
                &CancellationToken::new(),
                deadline(),
            )
            .await
        }
    }

    fn deadline() -> tokio::time::Instant {
        tokio::time::Instant::now() + Duration::from_secs(5)
    }

    fn expired() -> serde_json::Value {
        serde_json::json!({
            "claudeAiOauth": {
                "accessToken": "old-access", "refreshToken": "old-refresh", "expiresAt": 1,
                "subscriptionType": "pro", "scopes": ["user:inference"]
            },
            "mcpOAuth": {"server": "unrelated"}
        })
    }

    fn error(result: Result<ClaudeToken, OAuthRefreshError>) -> OAuthRefreshError {
        match result {
            Ok(_) => panic!("expected error"),
            Err(e) => e,
        }
    }

    #[tokio::test]
    async fn fresh_and_unknown_expiry_do_not_refresh_or_need_lock_directory() {
        let f = Fixture::new();
        std::fs::remove_dir(&f.locks).unwrap();
        let http = Http::default();
        for expiry in [serde_json::json!(u64::MAX), serde_json::Value::Null] {
            let mut value = expired();
            value["claudeAiOauth"]["expiresAt"] = expiry;
            f.write(&value);
            assert_eq!(
                f.acquire(&http, &Store::default()).await.unwrap().access_token.expose(),
                "old-access"
            );
        }
        assert_eq!(http.calls.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn concurrent_callers_refresh_once_and_preserve_metadata() {
        let f = Fixture::new();
        f.write(&expired());
        let http = Http::default();
        let store = Store::default();
        let (a, b) = tokio::join!(f.acquire(&http, &store), f.acquire(&http, &store));
        for token in [a.unwrap(), b.unwrap()] {
            assert_eq!(token.access_token.expose(), "new-access");
            assert_eq!(token.refresh_token.unwrap().expose(), "new-refresh");
            assert_eq!(token.subscription_type.as_deref(), Some("pro"));
            assert_eq!(token.scopes, ["user:inference"]);
        }
        assert_eq!(http.calls.load(Ordering::SeqCst), 1);
        let saved: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(f.path()).unwrap()).unwrap();
        assert_eq!(saved["mcpOAuth"]["server"], "unrelated");
        assert_eq!(saved["claudeAiOauth"]["refreshToken"], "new-refresh");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(std::fs::metadata(f.path()).unwrap().permissions().mode() & 0o777, 0o600);
        }
    }

    #[tokio::test]
    async fn concurrent_forced_refresh_renews_a_fresh_token_only_once() {
        let f = Fixture::new();
        let mut value = expired();
        value["claudeAiOauth"]["expiresAt"] = serde_json::json!(u64::MAX);
        f.write(&value);
        let mut options = f.options();
        options.force_refresh = true;
        let http = Http::default();
        let store = Store::default();
        let cancel = CancellationToken::new();
        let (a, b) = tokio::join!(
            acquire_with_store(&http, &options, &store, None, &cancel, deadline()),
            acquire_with_store(&http, &options, &store, None, &cancel, deadline()),
        );
        assert_eq!(a.unwrap().access_token.expose(), "new-access");
        assert_eq!(b.unwrap().access_token.expose(), "new-access");
        assert_eq!(http.calls.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn override_writes_only_override_and_never_keychain() {
        let mut f = Fixture::new();
        f.write(&expired());
        let default = f.path();
        let original = std::fs::read(&default).unwrap();
        f.sources.credentials_file_override = Some(f.sources.home_dir.join("custom.json"));
        f.sources.skip_keychain = false;
        f.write(&expired());
        let store =
            Store { raw: Mutex::new(Some(Secret::new(expired().to_string()))), ..Store::default() };
        assert_eq!(
            f.acquire(&Http::default(), &store).await.unwrap().access_token.expose(),
            "new-access"
        );
        assert_eq!(std::fs::read(default).unwrap(), original);
        assert_eq!(store.writes.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn missing_override_never_falls_back() {
        let mut f = Fixture::new();
        f.write(&expired());
        f.sources.credentials_file_override = Some(f.sources.home_dir.join("missing.json"));
        assert_eq!(
            error(f.acquire(&Http::default(), &Store::default()).await).error.code,
            ErrorCode::LoginRequired
        );
    }

    #[tokio::test]
    async fn default_file_stays_primary_even_when_keychain_exists() {
        let mut f = Fixture::new();
        f.sources.skip_keychain = false;
        f.write(&expired());
        let store =
            Store { raw: Mutex::new(Some(Secret::new(expired().to_string()))), ..Store::default() };
        f.acquire(&Http::default(), &store).await.unwrap();
        assert_eq!(store.writes.load(Ordering::SeqCst), 0);
        assert_eq!(
            parse(&std::fs::read_to_string(f.path()).unwrap()).unwrap().access_token.expose(),
            "new-access"
        );
    }

    #[tokio::test]
    async fn keychain_preserves_siblings_and_never_creates_file() {
        let mut f = Fixture::new();
        f.sources.skip_keychain = false;
        let store =
            Store { raw: Mutex::new(Some(Secret::new(expired().to_string()))), ..Store::default() };
        f.acquire(&Http::default(), &store).await.unwrap();
        assert!(!store.raw.lock().unwrap().as_ref().unwrap().expose().contains('\n'));
        let saved: serde_json::Value =
            serde_json::from_str(store.raw.lock().unwrap().as_ref().unwrap().expose()).unwrap();
        assert_eq!(saved["mcpOAuth"]["server"], "unrelated");
        assert_eq!(saved["claudeAiOauth"]["refreshToken"], "new-refresh");
        assert!(!f.path().exists());
    }

    #[cfg(target_os = "macos")]
    #[tokio::test]
    #[ignore = "Explicit isolated CLI Keychain fixture"]
    async fn refreshed_keychain_is_json_through_security_cli() {
        let service = format!("coc-claude-format-test-{}", std::process::id());
        let account = "dummy refresh fixture";
        use core_foundation::base::TCFType;
        use security_framework::os::macos::keychain::{CreateOptions, SecKeychain};
        let directory = tempfile::tempdir().unwrap();
        let keychain_path = directory.path().join("fixture.keychain-db");
        let keychain =
            CreateOptions::new().password("dummy-fixture-password").create(&keychain_path).unwrap();
        struct Cleanup(SecKeychain);
        impl Drop for Cleanup {
            fn drop(&mut self) {
                extern "C" {
                    fn SecKeychainDelete(keychain: *const std::ffi::c_void) -> i32;
                }
                unsafe {
                    assert_eq!(SecKeychainDelete(self.0.as_CFTypeRef()), 0);
                }
            }
        }
        let _cleanup = Cleanup(keychain.clone());
        use super::super::keychain::macos::SecurityStore;
        let cancel = CancellationToken::new();
        let store = SecurityStore {
            service: service.clone(),
            keychain: Some(keychain_path.to_str().unwrap().into()),
            cancel: cancel.clone(),
            deadline: tokio::time::Instant::now() + Duration::from_secs(20),
        };
        store.write(account, &Secret::new(expired().to_string())).await.unwrap();
        let mut f = Fixture::new();
        f.sources.skip_keychain = false;
        for _ in 0..2 {
            store.write(account, &Secret::new(expired().to_string())).await.unwrap();
            acquire_with_store(
                &Http::default(),
                &f.options(),
                &store,
                Some(account),
                &cancel,
                deadline(),
            )
            .await
            .unwrap();
            let raw = store.read(account).await.unwrap().unwrap();
            let saved: serde_json::Value = serde_json::from_str(raw.expose()).unwrap();
            assert_eq!(saved["claudeAiOauth"]["accessToken"], "new-access");
            assert_eq!(saved["claudeAiOauth"]["refreshToken"], "new-refresh");
            assert_eq!(saved["mcpOAuth"]["server"], "unrelated");
            assert!(!raw.expose().contains('\n'));
        }
        assert!(!f.path().exists());
    }

    #[tokio::test]
    async fn keychain_write_failure_returns_error_without_file_fallback() {
        let mut f = Fixture::new();
        f.sources.skip_keychain = false;
        let store = Store {
            raw: Mutex::new(Some(Secret::new(expired().to_string()))),
            fail_write: true,
            ..Store::default()
        };
        assert_eq!(
            error(f.acquire(&Http::default(), &store).await).error.code,
            ErrorCode::StorageDenied
        );
        assert!(!f.path().exists());
    }

    #[tokio::test]
    async fn unsupported_keychain_payload_fails_before_rotating_tokens() {
        struct Unwritable(Store);
        #[async_trait]
        impl ClaudeStore for Unwritable {
            async fn read(&self, key: &str) -> crate::Result<Option<Secret>> {
                CredentialStore::read(&self.0, key)
            }
            async fn write(&self, _: &str, _: &Secret) -> crate::Result<()> {
                panic!("Unsupported payload must never be exchanged or saved");
            }
            fn validate_write(&self, _: &str, _: &Secret) -> crate::Result<()> {
                Err(AuthError::new(ErrorCode::InvalidConfiguration))
            }
        }
        let mut f = Fixture::new();
        f.sources.skip_keychain = false;
        let store = Unwritable(Store {
            raw: Mutex::new(Some(Secret::new(expired().to_string()))),
            ..Store::default()
        });
        let http = Http::default();
        assert_eq!(
            error(
                acquire_with_store(
                    &http,
                    &f.options(),
                    &store,
                    Some("test-account"),
                    &CancellationToken::new(),
                    deadline()
                )
                .await
            )
            .error
            .code,
            ErrorCode::InvalidConfiguration
        );
        assert_eq!(http.calls.load(Ordering::SeqCst), 0);
        assert!(!f.path().exists());
    }

    #[tokio::test]
    async fn invalid_credentials_and_missing_or_expired_refresh_do_not_call_endpoint() {
        let f = Fixture::new();
        let http = Http::default();
        assert_eq!(
            error(f.acquire(&http, &Store::default()).await).error.code,
            ErrorCode::LoginRequired
        );
        f.write(&serde_json::json!({}));
        assert_eq!(
            error(f.acquire(&http, &Store::default()).await).error.code,
            ErrorCode::InvalidTokenResponse
        );
        let mut value = expired();
        value["claudeAiOauth"].as_object_mut().unwrap().remove("refreshToken");
        f.write(&value);
        assert_eq!(
            error(f.acquire(&http, &Store::default()).await).error.code,
            ErrorCode::LoginRequired
        );
        let mut value = expired();
        value["claudeAiOauth"]["refreshTokenExpiresAt"] = 1.into();
        f.write(&value);
        assert_eq!(
            error(f.acquire(&http, &Store::default()).await).error.code,
            ErrorCode::InteractionRequired
        );
        assert_eq!(http.calls.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn rejected_refresh_keeps_credentials_and_safe_diagnostics() {
        let f = Fixture::new();
        f.write(&expired());
        let original = std::fs::read(f.path()).unwrap();
        let http = Http { reject: true, ..Http::default() };
        let err = error(f.acquire(&http, &Store::default()).await);
        assert_eq!(err.status, Some(400));
        assert_eq!(err.rejection, Some(OAuthRefreshRejection::InvalidGrant));
        assert_eq!(std::fs::read(f.path()).unwrap(), original);
        assert!(!format!("{err:?}").contains("old-refresh"));
    }

    #[tokio::test]
    async fn external_replacement_during_refresh_is_not_overwritten() {
        let f = Fixture::new();
        f.write(&expired());
        let path = f.path();
        let http = Http {
            action: Some(Box::new(move || {
                std::fs::write(&path, r#"{"access_token":"external-token"}"#).unwrap();
            })),
            ..Http::default()
        };
        assert_eq!(
            error(f.acquire(&http, &Store::default()).await).error.code,
            ErrorCode::AccountMismatch
        );
        assert_eq!(
            parse(&std::fs::read_to_string(f.path()).unwrap()).unwrap().access_token.expose(),
            "external-token"
        );
    }

    #[tokio::test]
    async fn sibling_updates_during_exchange_are_preserved() {
        let f = Fixture::new();
        f.write(&expired());
        let path = f.path();
        let http = Http {
            action: Some(Box::new(move || {
                let mut value = expired();
                value["mcpOAuth"]["new-server"] = "added-during-refresh".into();
                std::fs::write(&path, value.to_string()).unwrap();
            })),
            ..Http::default()
        };
        f.acquire(&http, &Store::default()).await.unwrap();
        let value: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(f.path()).unwrap()).unwrap();
        assert_eq!(value["mcpOAuth"]["new-server"], "added-during-refresh");
    }

    #[tokio::test]
    async fn cancellation_during_commit_saves_rotation_but_does_not_publish() {
        let mut f = Fixture::new();
        f.sources.skip_keychain = false;
        let cancel = CancellationToken::new();
        let store = Store {
            raw: Mutex::new(Some(Secret::new(expired().to_string()))),
            cancel_on_write: Some(cancel.clone()),
            ..Store::default()
        };
        let result = acquire_with_store(
            &Http::default(),
            &f.options(),
            &store,
            Some("test-account"),
            &cancel,
            deadline(),
        )
        .await;
        assert_eq!(error(result).error.code, ErrorCode::Cancelled);
        assert_eq!(
            parse(store.raw.lock().unwrap().as_ref().unwrap().expose())
                .unwrap()
                .refresh_token
                .unwrap()
                .expose(),
            "new-refresh"
        );
    }

    #[tokio::test]
    async fn unavailable_coordination_fails_before_refresh() {
        let f = Fixture::new();
        f.write(&expired());
        std::fs::remove_dir(&f.locks).unwrap();
        let http = Http::default();
        assert_eq!(
            error(f.acquire(&http, &Store::default()).await).error.code,
            ErrorCode::CoordinationUnavailable
        );
        assert_eq!(http.calls.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn file_disappearing_during_refresh_does_not_publish_rotated_token() {
        let f = Fixture::new();
        f.write(&expired());
        let path = f.path();
        let http = Http {
            action: Some(Box::new(move || {
                std::fs::remove_file(&path).unwrap();
            })),
            ..Http::default()
        };
        assert_eq!(
            error(f.acquire(&http, &Store::default()).await).error.code,
            ErrorCode::StorageFailed
        );
    }

    #[tokio::test(start_paused = true)]
    async fn lock_wait_has_deadline_and_cancellation_and_releases_on_http_cancel() {
        let f = Fixture::new();
        f.write(&expired());
        let canonical = std::fs::canonicalize(f.path()).unwrap();
        let key = format!("claude:file:{}", canonical.to_str().unwrap());
        let lock = CredentialLock::acquire(&f.locks, &key).await.unwrap();
        let http = Http::default();
        let cancel = CancellationToken::new();
        let options = f.options();
        let timed = acquire_token(
            &http,
            &options,
            &cancel,
            tokio::time::Instant::now() + Duration::from_millis(50),
        )
        .await;
        assert_eq!(error(timed).error.code, ErrorCode::TimedOut);
        let pending = acquire_token(&http, &options, &cancel, deadline());
        let abort = async {
            tokio::task::yield_now().await;
            cancel.cancel();
        };
        let (result, _) = tokio::join!(pending, abort);
        assert_eq!(error(result).error.code, ErrorCode::Cancelled);
        assert_eq!(http.calls.load(Ordering::SeqCst), 0);
        drop(lock);

        let cancel = CancellationToken::new();
        let abort_token = cancel.clone();
        let http = Http {
            pending: true,
            action: Some(Box::new(move || abort_token.cancel())),
            ..Http::default()
        };
        assert_eq!(
            error(acquire_token(&http, &options, &cancel, deadline()).await).error.code,
            ErrorCode::Cancelled
        );
        // A subsequent caller can take the same lock and complete the refresh.
        f.acquire(&Http::default(), &Store::default()).await.unwrap();
    }

    #[tokio::test]
    async fn pre_cancelled_or_expired_deadline_never_reads_credentials() {
        let f = Fixture::new();
        let cancel = CancellationToken::new();
        cancel.cancel();
        assert_eq!(
            error(acquire_token(&Http::default(), &f.options(), &cancel, deadline()).await)
                .error
                .code,
            ErrorCode::Cancelled
        );
        assert_eq!(
            error(
                acquire_token(
                    &Http::default(),
                    &f.options(),
                    &CancellationToken::new(),
                    tokio::time::Instant::now()
                )
                .await
            )
            .error
            .code,
            ErrorCode::TimedOut
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn symlink_alias_preserves_target_and_link() {
        let mut f = Fixture::new();
        f.write(&expired());
        let target = f.path();
        let alias = f.sources.home_dir.join("alias.json");
        std::os::unix::fs::symlink(&target, &alias).unwrap();
        f.sources.credentials_file_override = Some(alias.clone());
        f.acquire(&Http::default(), &Store::default()).await.unwrap();
        assert!(std::fs::symlink_metadata(alias).unwrap().file_type().is_symlink());
        assert_eq!(
            parse(&std::fs::read_to_string(target).unwrap()).unwrap().access_token.expose(),
            "new-access"
        );
    }
}
