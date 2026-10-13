use super::*;
use async_trait::async_trait;
use auth_sdk::microsoft::{HttpResponse, HttpTransport};
use std::sync::{atomic::AtomicUsize, Arc, Mutex};

const SUCCESS: &str =
    r#"{"access_token":"access-fixture","token_type":"Bearer","expires_in":3600}"#;

fn options() -> MicrosoftOAuthRefreshOptions {
    MicrosoftOAuthRefreshOptions {
        authority: "https://login.microsoftonline.com/organizations".into(),
        client_id: "33333333-3333-4333-8333-333333333333".into(),
        scopes: vec!["fixture.scope".into(), "offline_access".into()],
        resource: Some("https://resource.example".into()),
    }
}

struct SyntheticHttp {
    status: u16,
    body: String,
    delay: Duration,
    requests: Mutex<Vec<(String, Vec<(String, String)>)>>,
    active: Arc<AtomicUsize>,
}

struct InFlight(Arc<AtomicUsize>);
impl Drop for InFlight {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::AcqRel);
    }
}

#[async_trait]
impl HttpTransport for SyntheticHttp {
    async fn request(
        &self,
        url: &str,
        form: Option<&[(String, String)]>,
    ) -> auth_sdk::Result<HttpResponse> {
        self.requests.lock().unwrap().push((url.into(), form.unwrap().to_vec()));
        self.active.fetch_add(1, Ordering::AcqRel);
        let _in_flight = InFlight(self.active.clone());
        tokio::time::sleep(self.delay).await;
        Ok(HttpResponse { status: self.status, body: Secret::new(self.body.clone()) })
    }
}

fn http(status: u16, body: &str, delay: Duration) -> SyntheticHttp {
    SyntheticHttp {
        status,
        body: body.into(),
        delay,
        requests: Mutex::default(),
        active: Arc::new(AtomicUsize::new(0)),
    }
}

async fn exchange(
    request: &NativeMicrosoftOAuthRefreshRequest,
    http: &dyn HttpTransport,
    refresh: &str,
) -> std::result::Result<OAuthRefreshResponse, OAuthRefreshError> {
    let (refresh, deadline) = request.begin(refresh.into())?;
    let response = exchange_refresh_token(
        http,
        &request.options,
        &refresh,
        &request.cancel,
        tokio::time::Instant::from_std(deadline),
    )
    .await?;
    check(&request.cancel, deadline)?;
    Ok(response)
}

#[tokio::test]
async fn marshals_configuration_and_endpoint_fields_without_identity_or_storage() {
    for rotated in [false, true] {
        let body = if rotated {
            r#"{"access_token":"access-fixture","token_type":"Bearer","expires_in":3600,"scope":"actual.scope","refresh_token":"rotated-fixture","id_token":"unverified-fixture"}"#
        } else {
            SUCCESS
        };
        let http = http(200, body, Duration::ZERO);
        let request = NativeMicrosoftOAuthRefreshRequest::new(options(), None).unwrap();
        let value = MicrosoftOAuthRefreshResponse::from(
            exchange(&request, &http, "refresh-fixture").await.unwrap(),
        );
        assert_eq!(value.access_token, "access-fixture");
        assert_eq!(value.token_type, "Bearer");
        assert_eq!(value.expires_in, 3600);
        assert_eq!(value.scope.as_deref(), rotated.then_some("actual.scope"));
        assert_eq!(value.refresh_token.as_deref(), rotated.then_some("rotated-fixture"));
        assert_eq!(
            *http.requests.lock().unwrap(),
            vec![(
                "https://login.microsoftonline.com/organizations/oauth2/v2.0/token".into(),
                vec![
                    ("grant_type".into(), "refresh_token".into()),
                    ("client_id".into(), "33333333-3333-4333-8333-333333333333".into()),
                    ("refresh_token".into(), "refresh-fixture".into()),
                    ("scope".into(), "fixture.scope offline_access".into()),
                    ("resource".into(), "https://resource.example".into()),
                ],
            )]
        );
    }
}

#[tokio::test]
async fn preserves_only_safe_status_and_exact_terminal_rejections() {
    for (body, code, rejection) in [
        (r#"{"error":"invalid_grant"}"#, "InteractionRequired", "invalid_grant"),
        (r#"{"error":"interaction_required"}"#, "InteractionRequired", "interaction_required"),
        (r#"{"error":"consent_required"}"#, "InteractionRequired", "consent_required"),
        (r#"{"error":"login_required"}"#, "InteractionRequired", ""),
        (r#"{"error":"invalid_scope"}"#, "InvalidTokenResponse", ""),
        (r#"{"error":"private-fixture"}"#, "InvalidTokenResponse", ""),
        ("private-fixture", "InvalidTokenResponse", ""),
    ] {
        let request = NativeMicrosoftOAuthRefreshRequest::new(options(), None).unwrap();
        let http = http(400, body, Duration::ZERO);
        let reason =
            refresh_error_reason(exchange(&request, &http, "refresh-fixture").await.err().unwrap());
        assert_eq!(
            reason,
            format!("[auth-refresh:{code}:400:{rejection}] Authentication operation failed.")
        );
        assert!(!reason.contains("private-fixture"));
        assert!(!reason.contains("refresh-fixture"));
    }
    let request = NativeMicrosoftOAuthRefreshRequest::new(options(), None).unwrap();
    let reason = refresh_error_reason(
        exchange(&request, &http(200, "private-fixture", Duration::ZERO), "refresh-fixture")
            .await
            .err()
            .unwrap(),
    );
    assert_eq!(reason, "[auth-refresh:InvalidTokenResponse:200:] Authentication operation failed.");
}

#[tokio::test]
async fn invalid_input_never_reaches_transport() {
    assert_eq!(
        NativeMicrosoftOAuthRefreshRequest::new(options(), None).unwrap().timeout,
        Duration::from_secs(30)
    );
    assert_eq!(
        NativeMicrosoftOAuthRefreshRequest::new(options(), Some(900_000)).unwrap().timeout,
        Duration::from_secs(900)
    );
    for timeout in [0, 99, 900_001] {
        assert!(NativeMicrosoftOAuthRefreshRequest::new(options(), Some(timeout)).is_err());
    }
    let mut unsafe_options = options();
    unsafe_options.authority = "https://fixture.example/common".into();
    assert!(NativeMicrosoftOAuthRefreshRequest::new(unsafe_options, None).is_err());
    for refresh in ["", "private\nfixture"] {
        let request = NativeMicrosoftOAuthRefreshRequest::new(options(), None).unwrap();
        let http = http(200, SUCCESS, Duration::ZERO);
        let error = exchange(&request, &http, refresh).await.err().unwrap();
        assert_eq!(error.error.code, ErrorCode::InvalidConfiguration);
        assert!(http.requests.lock().unwrap().is_empty());
    }
}

#[tokio::test]
async fn dispatch_delay_uses_the_original_budget_and_never_starts_http_after_expiry() {
    let request = NativeMicrosoftOAuthRefreshRequest::new(options(), Some(100)).unwrap();
    let (refresh, deadline) = request.begin("refresh-fixture".into()).unwrap();
    tokio::time::sleep(Duration::from_millis(120)).await;
    let http = http(200, SUCCESS, Duration::ZERO);
    let error = exchange_refresh_token(
        &http,
        &request.options,
        &refresh,
        &request.cancel,
        tokio::time::Instant::from_std(deadline),
    )
    .await
    .err()
    .unwrap();
    assert_eq!(error.error.code, ErrorCode::TimedOut);
    assert!(http.requests.lock().unwrap().is_empty());
}

#[tokio::test]
async fn cancellation_and_timeout_drop_native_work_and_are_operation_isolated() {
    for cancelled in [true, false] {
        let request = NativeMicrosoftOAuthRefreshRequest::new(options(), Some(100)).unwrap();
        let http = http(200, SUCCESS, Duration::from_secs(60));
        let (result, _) = tokio::join!(exchange(&request, &http, "refresh-fixture"), async {
            if cancelled {
                tokio::time::sleep(Duration::from_millis(10)).await;
                request.cancel();
            }
        });
        assert_eq!(
            result.err().unwrap().error.code,
            if cancelled { ErrorCode::Cancelled } else { ErrorCode::TimedOut }
        );
        assert_eq!(http.requests.lock().unwrap().len(), 1);
        assert_eq!(http.active.load(Ordering::Acquire), 0);
        let survivor = NativeMicrosoftOAuthRefreshRequest::new(options(), None).unwrap();
        assert!(exchange(&survivor, &self::http(200, SUCCESS, Duration::ZERO), "fixture")
            .await
            .is_ok());
    }
}

#[test]
fn cancellation_is_captured_before_dispatch_and_handles_are_one_shot() {
    let request = NativeMicrosoftOAuthRefreshRequest::new(options(), None).unwrap();
    request.cancel();
    assert_eq!(request.begin("fixture".into()).err().unwrap().code, ErrorCode::Cancelled);
    let request = NativeMicrosoftOAuthRefreshRequest::new(options(), None).unwrap();
    let (_, deadline) = request.begin("fixture".into()).unwrap();
    assert!(check(&request.cancel, deadline).is_ok());
    assert_eq!(
        request.begin("fixture".into()).err().unwrap().code,
        ErrorCode::InvalidConfiguration
    );
    request.cancel();
    assert_eq!(check(&request.cancel, deadline).unwrap_err().code, ErrorCode::Cancelled);
}

#[test]
fn publication_rechecks_deadline_and_drop_cancels_the_operation() {
    let request = NativeMicrosoftOAuthRefreshRequest::new(options(), None).unwrap();
    let cancel = request.cancel.clone();
    assert_eq!(check(&cancel, Instant::now()).unwrap_err().code, ErrorCode::TimedOut);
    drop(request);
    assert!(cancel.is_cancelled());
}
