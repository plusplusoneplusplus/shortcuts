use async_trait::async_trait;
use auth_sdk::{
    microsoft::{
        exchange_refresh_token, HttpResponse, HttpTransport, OAuthRefreshOptions,
        OAuthRefreshRejection,
    },
    AuthError, ErrorCode, Result, Secret,
};
use std::{sync::Mutex, time::Duration};
use tokio::time::Instant;
use tokio_util::sync::CancellationToken;

const CLIENT: &str = "33333333-3333-4333-8333-333333333333";
const SUCCESS: &str =
    r#"{"access_token":"opaque-fixture","token_type":"Bearer","expires_in":3600}"#;

type CapturedRequest = (String, Vec<(String, String)>);

struct SyntheticHttp {
    requests: Mutex<Vec<CapturedRequest>>,
    status: u16,
    body: Secret,
    delay: Duration,
    failure: Option<ErrorCode>,
}

impl SyntheticHttp {
    fn new(status: u16, body: &str) -> Self {
        Self {
            requests: Mutex::default(),
            status,
            body: Secret::new(body.into()),
            delay: Duration::ZERO,
            failure: None,
        }
    }
}

#[async_trait]
impl HttpTransport for SyntheticHttp {
    async fn request(&self, url: &str, form: Option<&[(String, String)]>) -> Result<HttpResponse> {
        self.requests.lock().unwrap().push((url.into(), form.unwrap().to_vec()));
        tokio::time::sleep(self.delay).await;
        if let Some(code) = self.failure {
            return Err(AuthError::new(code));
        }
        Ok(HttpResponse { status: self.status, body: self.body.clone() })
    }
}

fn options() -> OAuthRefreshOptions {
    OAuthRefreshOptions {
        authority: "https://login.microsoftonline.com/organizations".into(),
        client_id: CLIENT.into(),
        scopes: vec!["https://resource.example/read".into(), "offline_access".into()],
        resource: None,
    }
}

#[tokio::test]
async fn caller_owned_refresh_uses_one_exact_post_and_returns_only_reported_fields() {
    for rotated in [false, true] {
        let mut body: serde_json::Value = serde_json::from_str(SUCCESS).unwrap();
        if rotated {
            body["refresh_token"] = "rotated-fixture".into();
            body["scope"] = "actual.granted offline_access".into();
            body["id_token"] = "unverified-fixture".into();
        }
        let http = SyntheticHttp::new(200, &body.to_string());
        let refresh = Secret::new("caller-owned-fixture".into());
        let mut config = options();
        if rotated {
            config.resource = Some("https://resource.example".into());
        }
        let response = exchange_refresh_token(
            &http,
            &config,
            &refresh,
            &CancellationToken::new(),
            Instant::now() + Duration::from_secs(1),
        )
        .await
        .unwrap();
        assert_eq!(response.access_token.expose(), "opaque-fixture");
        assert_eq!(response.token_type, "Bearer");
        assert_eq!(response.expires_in, 3600);
        assert_eq!(refresh.expose(), "caller-owned-fixture");
        assert_eq!(
            response.refresh_token.as_ref().map(Secret::expose),
            rotated.then_some("rotated-fixture")
        );
        assert_eq!(response.scope.as_deref(), rotated.then_some("actual.granted offline_access"));
        assert_eq!(
            response.id_token.as_ref().map(Secret::expose),
            rotated.then_some("unverified-fixture")
        );
        let mut expected = vec![
            ("grant_type".into(), "refresh_token".into()),
            ("client_id".into(), CLIENT.into()),
            ("refresh_token".into(), "caller-owned-fixture".into()),
            ("scope".into(), "https://resource.example/read offline_access".into()),
        ];
        if rotated {
            expected.push(("resource".into(), "https://resource.example".into()));
        }
        assert_eq!(
            *http.requests.lock().unwrap(),
            vec![(
                "https://login.microsoftonline.com/organizations/oauth2/v2.0/token".into(),
                expected
            )]
        );
    }
}

#[tokio::test]
async fn microsoft_refresh_configuration_is_validated_before_transport() {
    for authority in [
        "http://login.microsoftonline.com/common",
        "https://attacker.example/common",
        "https://login.microsoftonline.com/common?secret=fixture",
        "https://login.microsoftonline.com/common#fragment",
        "https://login.microsoftonline.com/common/oauth2/v2.0/token",
        "https://login.microsoftonline.com:8443/common",
        "https://user:password@login.microsoftonline.com/common",
    ] {
        let mut config = options();
        config.authority = authority.into();
        assert_eq!(config.validate().unwrap_err().code, ErrorCode::InvalidConfiguration);
    }
    for mutate in 0..5 {
        let mut config = options();
        match mutate {
            0 => config.client_id = "invalid".into(),
            1 => config.scopes.clear(),
            2 => config.scopes = vec!["scope with spaces".into()],
            3 => config.scopes = vec!["scope".into(); 65],
            _ => config.resource = Some("invalid\nresource".into()),
        }
        let http = SyntheticHttp::new(200, SUCCESS);
        let error = exchange_refresh_token(
            &http,
            &config,
            &Secret::new("fixture".into()),
            &CancellationToken::new(),
            Instant::now() + Duration::from_secs(1),
        )
        .await
        .err()
        .unwrap();
        assert_eq!(error.error.code, ErrorCode::InvalidConfiguration);
        assert!(http.requests.lock().unwrap().is_empty());
    }
    for secret in ["", "invalid\nrefresh"] {
        let http = SyntheticHttp::new(200, SUCCESS);
        let error = exchange_refresh_token(
            &http,
            &options(),
            &Secret::new(secret.into()),
            &CancellationToken::new(),
            Instant::now() + Duration::from_secs(1),
        )
        .await
        .err()
        .unwrap();
        assert_eq!(error.error.code, ErrorCode::InvalidConfiguration);
        assert!(http.requests.lock().unwrap().is_empty());
    }
    for host in ["login.microsoftonline.com", "login.microsoftonline.us", "login.chinacloudapi.cn"]
    {
        for tenant in ["common", "organizations", "consumers", CLIENT] {
            let mut config = options();
            config.authority = format!("https://{host}/{tenant}/");
            let http = SyntheticHttp::new(200, SUCCESS);
            exchange_refresh_token(
                &http,
                &config,
                &Secret::new("fixture".into()),
                &CancellationToken::new(),
                Instant::now() + Duration::from_secs(1),
            )
            .await
            .unwrap();
            assert_eq!(
                http.requests.lock().unwrap()[0].0,
                format!("https://{host}/{tenant}/oauth2/v2.0/token")
            );
        }
    }
}

#[tokio::test]
async fn malformed_success_and_failure_responses_have_safe_diagnostics() {
    for (status, body) in [
        (200, "not-json"),
        (200, "{}"),
        (200, r#"{"access_token":"","token_type":"Bearer","expires_in":3600}"#),
        (200, r#"{"access_token":"white space","token_type":"Bearer","expires_in":3600}"#),
        (200, r#"{"access_token":"opaque","token_type":"Other","expires_in":3600}"#),
        (200, r#"{"access_token":"opaque","token_type":"Bearer","expires_in":0}"#),
        (200, r#"{"access_token":"opaque","token_type":"Bearer","expires_in":604801}"#),
        (200, r#"{"access_token":"opaque","token_type":"Bearer","expires_in":-1}"#),
        (200, r#"{"access_token":"opaque","token_type":"Bearer","expires_in":1.5}"#),
        (
            200,
            r#"{"access_token":"opaque","token_type":"Bearer","expires_in":3600,"scope":"bad\nscope"}"#,
        ),
        (
            200,
            r#"{"access_token":"opaque","token_type":"Bearer","expires_in":3600,"refresh_token":""}"#,
        ),
        (
            200,
            r#"{"access_token":"opaque","token_type":"Bearer","expires_in":3600,"refresh_token":"bad\nrefresh"}"#,
        ),
        (200, r#"{"access_token":"opaque","token_type":"Bearer","expires_in":3600,"id_token":42}"#),
        (400, "private-fixture-body"),
        (400, r#"{"error":42,"error_description":"private-fixture-body"}"#),
        (302, "{}"),
    ] {
        let http = SyntheticHttp::new(status, body);
        let error = exchange_refresh_token(
            &http,
            &options(),
            &Secret::new("fixture".into()),
            &CancellationToken::new(),
            Instant::now() + Duration::from_secs(1),
        )
        .await
        .err()
        .unwrap();
        assert_eq!(error.error.code, ErrorCode::InvalidTokenResponse);
        assert_eq!(error.status, Some(status));
        assert_eq!(error.rejection, None);
        assert!(!format!("{error:?} {error}").contains("private-fixture"));
    }
}

#[tokio::test]
async fn exact_rejections_preserve_native_codes_without_leaking_provider_strings() {
    for (name, code, rejection) in [
        (
            "invalid_grant",
            ErrorCode::InteractionRequired,
            Some(OAuthRefreshRejection::InvalidGrant),
        ),
        (
            "interaction_required",
            ErrorCode::InteractionRequired,
            Some(OAuthRefreshRejection::InteractionRequired),
        ),
        (
            "consent_required",
            ErrorCode::InteractionRequired,
            Some(OAuthRefreshRejection::ConsentRequired),
        ),
        ("login_required", ErrorCode::InteractionRequired, None),
        ("access_denied", ErrorCode::AccessDenied, None),
        ("authorization_declined", ErrorCode::AccessDenied, None),
        ("expired_token", ErrorCode::TokenExpired, None),
        ("invalid_scope", ErrorCode::InvalidTokenResponse, None),
        ("invalid_request", ErrorCode::InvalidTokenResponse, None),
        ("private-fixture-unknown", ErrorCode::InvalidTokenResponse, None),
    ] {
        for status in [400, 401, 500] {
            let body = serde_json::json!({"error":name,"error_description":"private-fixture-body"});
            let http = SyntheticHttp::new(status, &body.to_string());
            let error = exchange_refresh_token(
                &http,
                &options(),
                &Secret::new("fixture".into()),
                &CancellationToken::new(),
                Instant::now() + Duration::from_secs(1),
            )
            .await
            .err()
            .unwrap();
            assert_eq!(error.error.code, code);
            assert_eq!(error.status, Some(status));
            assert_eq!(error.rejection, rejection);
            assert!(!format!("{error:?} {error}").contains("private-fixture"));
        }
    }
}

#[tokio::test(start_paused = true)]
async fn cancellation_deadlines_and_transport_errors_never_return_tokens() {
    for before in [false, true] {
        for cancelled in [false, true] {
            let mut http = SyntheticHttp::new(200, SUCCESS);
            http.delay = Duration::from_secs(10);
            let cancel = CancellationToken::new();
            let deadline =
                Instant::now() + if before { Duration::ZERO } else { Duration::from_secs(1) };
            if before && cancelled {
                cancel.cancel();
            }
            let config = options();
            let refresh = Secret::new("fixture".into());
            let (result, _) = tokio::join!(
                exchange_refresh_token(&http, &config, &refresh, &cancel, deadline),
                async {
                    if !before && cancelled {
                        tokio::time::sleep(Duration::from_millis(10)).await;
                        cancel.cancel();
                    }
                },
            );
            let error = result.err().unwrap();
            assert_eq!(
                error.error.code,
                if cancelled { ErrorCode::Cancelled } else { ErrorCode::TimedOut }
            );
            assert_eq!(error.status, None);
            assert_eq!(http.requests.lock().unwrap().len(), usize::from(!before));
            tokio::time::sleep(Duration::from_secs(20)).await;
            assert_eq!(http.requests.lock().unwrap().len(), usize::from(!before));
        }
    }
    let mut http = SyntheticHttp::new(200, SUCCESS);
    http.failure = Some(ErrorCode::TimedOut);
    let error = exchange_refresh_token(
        &http,
        &options(),
        &Secret::new("fixture".into()),
        &CancellationToken::new(),
        Instant::now() + Duration::from_secs(1),
    )
    .await
    .err()
    .unwrap();
    assert_eq!(error.error.code, ErrorCode::TimedOut);
    assert_eq!(error.status, None);
    assert_eq!(error.rejection, None);
}
