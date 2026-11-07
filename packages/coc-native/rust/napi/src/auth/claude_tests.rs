use super::*;
use async_trait::async_trait;
use auth_sdk::{
    oauth::{HttpResponse, OAuthRefreshRejection},
    Secret,
};
use std::{path::PathBuf, sync::atomic::AtomicUsize};

struct Fixture(PathBuf);
impl Fixture {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!("claude-napi-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(path.join(".claude")).unwrap();
        std::fs::create_dir(path.join("locks")).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(path.join("locks"), std::fs::Permissions::from_mode(0o700))
                .unwrap();
        }
        Self(path)
    }
    fn options(&self) -> ClaudeCredentialOptions {
        ClaudeCredentialOptions {
            home_dir: self.0.to_str().unwrap().into(),
            coordination_directory: self.0.join("locks").to_str().unwrap().into(),
            credentials_file: None,
            skip_keychain: Some(true),
            force_refresh: None,
            timeout_ms: Some(100),
        }
    }
    fn write(&self) {
        std::fs::write(self.0.join(".claude/.credentials.json"),
            r#"{"claudeAiOauth":{"accessToken":"old-access","refreshToken":"private-refresh","expiresAt":1,"subscriptionType":"pro","rateLimitTier":"tier","scopes":["user:inference"]},"mcpOAuth":{"sibling":true}}"#).unwrap();
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        std::fs::remove_dir_all(&self.0).unwrap();
    }
}

struct Http {
    calls: AtomicUsize,
    active: AtomicUsize,
    pending: bool,
    reject: bool,
}
impl Http {
    fn new() -> Self {
        Self {
            calls: AtomicUsize::new(0),
            active: AtomicUsize::new(0),
            pending: false,
            reject: false,
        }
    }
}
struct InFlight<'a>(&'a AtomicUsize);
impl Drop for InFlight<'_> {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::SeqCst);
    }
}
#[async_trait]
impl HttpTransport for Http {
    async fn request(
        &self,
        _: &str,
        _: Option<&[(String, String)]>,
    ) -> auth_sdk::Result<HttpResponse> {
        panic!("must use JSON")
    }
    async fn request_json(&self, url: &str, body: &str) -> auth_sdk::Result<HttpResponse> {
        assert_eq!(url, claude::TOKEN_ENDPOINT);
        let body: serde_json::Value = serde_json::from_str(body).unwrap();
        assert_eq!(body["refresh_token"], "private-refresh");
        self.calls.fetch_add(1, Ordering::SeqCst);
        self.active.fetch_add(1, Ordering::SeqCst);
        let _guard = InFlight(&self.active);
        if self.pending {
            return std::future::pending().await;
        }
        Ok(HttpResponse {
            status: if self.reject { 400 } else { 200 },
            body: Secret::new(if self.reject {
                r#"{"error":"invalid_grant","error_description":"private-refresh"}"#
            } else {
                r#"{"access_token":"new-access","refresh_token":"new-refresh","expires_in":3600}"#
            }.into()),
        })
    }
}

#[tokio::test]
async fn acquisition_persists_rotation_and_marshals_only_access_and_metadata() {
    let f = Fixture::new();
    f.write();
    let request = NativeClaudeCredentialRequest::new(f.options()).unwrap();
    let token = acquire(&request.options, &Http::new(), &request.cancel, request.begin().unwrap())
        .await
        .unwrap();
    let value = ClaudeCredentialSnapshot::from(token);
    assert_eq!(value.access_token, "new-access");
    assert!(value.expires_at.unwrap() > 1.0);
    assert_eq!(value.scopes, ["user:inference"]);
    assert_eq!(value.subscription_type.as_deref(), Some("pro"));
    assert_eq!(value.rate_limit_tier.as_deref(), Some("tier"));
    let saved: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string(f.0.join(".claude/.credentials.json")).unwrap(),
    )
    .unwrap();
    assert_eq!(saved["claudeAiOauth"]["refreshToken"], "new-refresh");
    assert_eq!(saved["mcpOAuth"]["sibling"], true);
}

#[test]
fn construction_validates_without_io_and_handles_are_one_shot() {
    let f = Fixture::new();
    let mut options = f.options();
    options.home_dir = f.0.join("nonexistent").to_str().unwrap().into();
    let request = NativeClaudeCredentialRequest::new(options).unwrap();
    assert!(request.begin().is_ok());
    assert_eq!(request.begin().unwrap_err().code, ErrorCode::InvalidConfiguration);
    for timeout in [0, 99, 900_001] {
        let mut options = f.options();
        options.timeout_ms = Some(timeout);
        assert!(NativeClaudeCredentialRequest::new(options).is_err());
    }
    for field in 0..3 {
        let mut options = f.options();
        match field {
            0 => options.home_dir = "relative".into(),
            1 => options.coordination_directory = "".into(),
            _ => options.credentials_file = Some("relative.json".into()),
        }
        assert!(NativeClaudeCredentialRequest::new(options).is_err());
    }
    let mut options = f.options();
    options.timeout_ms = None;
    let request = NativeClaudeCredentialRequest::new(options).unwrap();
    assert!(request.begin().unwrap().duration_since(Instant::now()) > Duration::from_secs(29));
    let request = NativeClaudeCredentialRequest::new(f.options()).unwrap();
    let cancel = request.cancel.clone();
    drop(request);
    assert!(cancel.is_cancelled());
}

#[tokio::test]
async fn cancellation_and_deadline_before_dispatch_do_not_read_or_exchange() {
    let f = Fixture::new();
    f.write();
    let http = Http::new();
    let request = NativeClaudeCredentialRequest::new(f.options()).unwrap();
    let deadline = request.begin().unwrap();
    request.cancel();
    assert_eq!(
        acquire(&request.options, &http, &request.cancel, deadline).await.err().unwrap().error.code,
        ErrorCode::Cancelled
    );
    let request = NativeClaudeCredentialRequest::new(f.options()).unwrap();
    assert_eq!(
        acquire(&request.options, &http, &request.cancel, Instant::now())
            .await
            .err()
            .unwrap()
            .error
            .code,
        ErrorCode::TimedOut
    );
    assert_eq!(http.calls.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn cancellation_and_timeout_drop_exchange_and_leave_other_requests_usable() {
    for cancelled in [true, false] {
        let f = Fixture::new();
        f.write();
        let request = NativeClaudeCredentialRequest::new(f.options()).unwrap();
        let mut http = Http::new();
        http.pending = true;
        let http = Arc::new(http);
        let (result, _) = tokio::join!(
            acquire_on_worker(
                request.options.clone(),
                http.clone(),
                request.cancel.clone(),
                request.begin().unwrap()
            ),
            async {
                if cancelled {
                    while http.calls.load(Ordering::SeqCst) == 0 {
                        tokio::task::yield_now().await;
                    }
                    request.cancel();
                }
            },
        );
        assert_eq!(
            result.err().unwrap().error.code,
            if cancelled { ErrorCode::Cancelled } else { ErrorCode::TimedOut }
        );
        assert_eq!(http.active.load(Ordering::SeqCst), 0);
        let survivor = NativeClaudeCredentialRequest::new(f.options()).unwrap();
        acquire(&survivor.options, &Http::new(), &survivor.cancel, survivor.begin().unwrap())
            .await
            .unwrap();
    }
}

#[tokio::test]
async fn errors_keep_only_safe_code_status_and_rejection() {
    let f = Fixture::new();
    f.write();
    let request = NativeClaudeCredentialRequest::new(f.options()).unwrap();
    let mut http = Http::new();
    http.reject = true;
    let err = acquire(&request.options, &http, &request.cancel, request.begin().unwrap())
        .await
        .err()
        .unwrap();
    assert_eq!(err.status, Some(400));
    assert_eq!(err.rejection, Some(OAuthRefreshRejection::InvalidGrant));
    let reason = super::super::refresh::refresh_error_reason(err);
    assert_eq!(
        reason,
        "[auth-refresh:InteractionRequired:400:invalid_grant] Authentication operation failed."
    );
    assert!(!reason.contains("private-refresh"));
}

#[test]
fn publication_rechecks_cancellation_and_deadline() {
    let f = Fixture::new();
    let request = NativeClaudeCredentialRequest::new(f.options()).unwrap();
    assert_eq!(check(&request.cancel, Instant::now()).unwrap_err().code, ErrorCode::TimedOut);
    let deadline = request.begin().unwrap();
    request.cancel();
    assert_eq!(check(&request.cancel, deadline).unwrap_err().code, ErrorCode::Cancelled);
}

#[test]
fn queued_workers_are_aborted_on_timeout_or_cancel_before_any_io() {
    for cancelled in [true, false] {
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(1)
            .max_blocking_threads(1)
            .enable_all()
            .build()
            .unwrap();
        let (release, held) = std::sync::mpsc::channel();
        let (ready, started) = std::sync::mpsc::channel();
        let blocker = runtime.spawn_blocking(move || {
            ready.send(()).unwrap();
            let _ = held.recv_timeout(Duration::from_secs(5));
        });
        started.recv_timeout(Duration::from_secs(5)).unwrap();
        let f = Fixture::new();
        f.write();
        let original = std::fs::read(f.0.join(".claude/.credentials.json")).unwrap();
        let http = Arc::new(Http::new());
        let cancel = CancellationToken::new();
        let started_at = Instant::now();
        let result = runtime.block_on(async {
            let work = acquire_on_worker(
                f.options(),
                http.clone(),
                cancel.clone(),
                Instant::now() + Duration::from_millis(100),
            );
            let abort = async {
                if cancelled {
                    tokio::task::yield_now().await;
                    cancel.cancel();
                }
            };
            tokio::join!(work, abort).0
        });
        // This settles while the only blocking thread is still held.
        assert!(started_at.elapsed() < Duration::from_secs(2));
        assert_eq!(
            result.err().unwrap().error.code,
            if cancelled { ErrorCode::Cancelled } else { ErrorCode::TimedOut }
        );
        release.send(()).unwrap();
        runtime.block_on(blocker).unwrap();
        runtime.shutdown_timeout(Duration::from_secs(5));
        assert_eq!(http.calls.load(Ordering::SeqCst), 0);
        assert_eq!(std::fs::read(f.0.join(".claude/.credentials.json")).unwrap(), original);
    }
}

#[tokio::test]
async fn force_refresh_is_forwarded_for_an_unexpired_rejected_token() {
    let f = Fixture::new();
    f.write();
    let path = f.0.join(".claude/.credentials.json");
    let mut value: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
    value["claudeAiOauth"]["expiresAt"] = serde_json::json!(9999999999999u64);
    std::fs::write(&path, value.to_string()).unwrap();
    let mut options = f.options();
    options.force_refresh = Some(true);
    let request = NativeClaudeCredentialRequest::new(options).unwrap();
    let http = Http::new();
    let token =
        acquire(&request.options, &http, &request.cancel, request.begin().unwrap()).await.unwrap();
    assert_eq!(token.access_token.expose(), "new-access");
    assert_eq!(http.calls.load(Ordering::SeqCst), 1);
}
