use crate::oauth::{HttpTransport, OAuthRefreshError, OAuthRefreshRejection};
use crate::{AuthError, ErrorCode, Secret};
use serde::{Deserialize, Serialize};
use tokio_util::sync::CancellationToken;

/// Default Claude OAuth token endpoint (production).
pub const TOKEN_ENDPOINT: &str = "https://platform.claude.com/v1/oauth/token";

/// Default client ID registered for Claude Code.
pub const DEFAULT_CLIENT_ID: &str = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";

/// Default scopes used when none are explicitly provided.
pub const DEFAULT_SCOPES: &[&str] = &[
    "user:profile",
    "user:inference",
    "user:sessions:claude_code",
    "user:mcp_servers",
    "user:file_upload",
];

/// Margin before `expiresAt` at which the token is considered expired (5 min).
pub const EXPIRY_MARGIN_MS: u64 = 300_000;

/// Options for a Claude OAuth token refresh.
pub struct ClaudeRefreshOptions<'a> {
    /// Token endpoint URL. Defaults to [`TOKEN_ENDPOINT`].
    pub token_endpoint: &'a str,
    /// Client ID. Defaults to [`DEFAULT_CLIENT_ID`].
    pub client_id: &'a str,
    /// Scopes to request. Defaults to [`DEFAULT_SCOPES`].
    pub scopes: &'a [String],
}

impl Default for ClaudeRefreshOptions<'_> {
    fn default() -> Self {
        Self {
            token_endpoint: TOKEN_ENDPOINT,
            client_id: DEFAULT_CLIENT_ID,
            scopes: &[],
        }
    }
}

/// Successful refresh response from Claude's token endpoint.
pub struct ClaudeRefreshResponse {
    pub access_token: Secret,
    /// Rotated refresh token. Claude uses rotating refresh tokens — each refresh
    /// returns a new one and invalidates the previous.
    pub refresh_token: Secret,
    /// Absolute expiry in epoch milliseconds.
    pub expires_at: u64,
    /// Scopes granted by the server (parsed from the space-separated `scope` field).
    pub scopes: Vec<String>,
}

/// JSON request body sent to the token endpoint.
#[derive(Serialize)]
struct RefreshRequest<'a> {
    grant_type: &'static str,
    refresh_token: &'a str,
    client_id: &'a str,
    scope: String,
}

/// JSON response from the token endpoint on success.
#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    #[serde(default)]
    refresh_token: Option<String>,
    expires_in: u64,
    #[serde(default)]
    scope: Option<String>,
}

/// JSON response from the token endpoint on error.
#[derive(Deserialize)]
struct ErrorResponse {
    error: String,
}

/// Refreshes a Claude OAuth access token using the rotating refresh token.
///
/// This sends a JSON POST to the Claude token endpoint, matching the exact
/// protocol used by the Claude Code CLI. The response includes a **rotated
/// refresh token** — the caller must persist it before using the new access
/// token, because the previous refresh token is invalidated.
///
/// # Coordination
///
/// Claude uses rotating refresh tokens. If two processes refresh concurrently
/// with the same refresh token, only one wins — the other's refresh token is
/// invalidated by the server. The caller is responsible for external
/// coordination (e.g. file locking) to prevent races.
pub async fn refresh_token(
    http: &dyn HttpTransport,
    options: &ClaudeRefreshOptions<'_>,
    refresh: &Secret,
    cancel: &CancellationToken,
    deadline: tokio::time::Instant,
) -> std::result::Result<ClaudeRefreshResponse, OAuthRefreshError> {
    crate::contracts::checkpoint(cancel, deadline)?;

    if refresh.expose().is_empty()
        || refresh.expose().len() > 1024 * 1024
        || refresh.expose().chars().any(char::is_control)
    {
        return Err(AuthError::new(ErrorCode::InvalidConfiguration).into());
    }

    let scopes: Vec<&str> = if options.scopes.is_empty() {
        DEFAULT_SCOPES.to_vec()
    } else {
        options.scopes.iter().map(|s| s.as_str()).collect()
    };

    let request_body = RefreshRequest {
        grant_type: "refresh_token",
        refresh_token: refresh.expose(),
        client_id: options.client_id,
        scope: scopes.join(" "),
    };
    let json = serde_json::to_string(&request_body)
        .map_err(|_| OAuthRefreshError::from(AuthError::new(ErrorCode::InvalidConfiguration)))?;

    let output = tokio::select! {
        biased;
        _ = cancel.cancelled() => Err(AuthError::new(ErrorCode::Cancelled)),
        output = tokio::time::timeout_at(
            deadline,
            http.request_json(options.token_endpoint, &json),
        ) => output.unwrap_or_else(|_| Err(AuthError::new(ErrorCode::TimedOut))),
    };
    crate::contracts::checkpoint(cancel, deadline)?;
    let output = output?;

    if output.status != 200 {
        return Err(parse_error_response(output.body.expose(), output.status));
    }

    let response: TokenResponse = serde_json::from_str(output.body.expose())
        .map_err(|_| OAuthRefreshError::from(AuthError::new(ErrorCode::InvalidTokenResponse))
            .with_status(output.status))?;

    validate_response(&response, refresh, output.status)?;

    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;

    Ok(ClaudeRefreshResponse {
        access_token: Secret::new(response.access_token),
        refresh_token: Secret::new(
            response.refresh_token.unwrap_or_else(|| refresh.expose().to_owned()),
        ),
        expires_at: now_ms + response.expires_in * 1000,
        scopes: response.scope
            .as_deref()
            .unwrap_or("")
            .split_whitespace()
            .map(str::to_owned)
            .collect(),
    })
}

fn validate_response(
    response: &TokenResponse,
    original_refresh: &Secret,
    status: u16,
) -> std::result::Result<(), OAuthRefreshError> {
    let err = || {
        OAuthRefreshError::from(AuthError::new(ErrorCode::InvalidTokenResponse))
            .with_status(status)
    };

    if response.access_token.is_empty()
        || response.access_token.len() > 1024 * 1024
        || response.access_token.chars().any(char::is_whitespace)
    {
        return Err(err());
    }
    if response.expires_in == 0 || response.expires_in > 604_800 {
        return Err(err());
    }
    if let Some(ref rt) = response.refresh_token {
        if rt.is_empty() || rt.len() > 1024 * 1024 || rt.chars().any(char::is_control) {
            return Err(err());
        }
    }
    // Warn-worthy but not fatal: if no new refresh token, reuse the old one.
    // Claude always rotates, but a missing field shouldn't crash.
    let _ = original_refresh;
    Ok(())
}

fn parse_error_response(body: &str, status: u16) -> OAuthRefreshError {
    let rejection = serde_json::from_str::<ErrorResponse>(body)
        .ok()
        .and_then(|e| match e.error.as_str() {
            "invalid_grant" => Some(OAuthRefreshRejection::InvalidGrant),
            "interaction_required" => Some(OAuthRefreshRejection::InteractionRequired),
            "consent_required" => Some(OAuthRefreshRejection::ConsentRequired),
            _ => None,
        });

    let code = serde_json::from_str::<ErrorResponse>(body)
        .ok()
        .map(|e| match e.error.as_str() {
            "invalid_grant" | "interaction_required" | "login_required" | "consent_required" => {
                ErrorCode::InteractionRequired
            }
            "access_denied" | "authorization_declined" => ErrorCode::AccessDenied,
            "expired_token" => ErrorCode::TokenExpired,
            _ => ErrorCode::InvalidTokenResponse,
        })
        .unwrap_or(ErrorCode::InvalidTokenResponse);

    OAuthRefreshError {
        error: AuthError::new(code),
        status: Some(status),
        rejection,
    }
}

/// Returns `true` when the token's `expiresAt` (epoch ms) is within
/// [`EXPIRY_MARGIN_MS`] of the current time.
pub fn is_expired(expires_at: u64) -> bool {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;
    now + EXPIRY_MARGIN_MS >= expires_at
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::oauth::HttpResponse;
    use async_trait::async_trait;
    use std::sync::Mutex;

    fn unwrap_err(
        result: std::result::Result<ClaudeRefreshResponse, OAuthRefreshError>,
    ) -> OAuthRefreshError {
        match result {
            Err(e) => e,
            Ok(_) => panic!("expected Err, got Ok"),
        }
    }

    struct FakeTransport {
        responses: Mutex<Vec<(u16, String)>>,
        captured_bodies: Mutex<Vec<String>>,
    }

    impl FakeTransport {
        fn new(responses: Vec<(u16, String)>) -> Self {
            Self {
                responses: Mutex::new(responses),
                captured_bodies: Mutex::new(Vec::new()),
            }
        }

        fn captured(&self) -> Vec<String> {
            self.captured_bodies.lock().unwrap().clone()
        }
    }

    #[async_trait]
    impl HttpTransport for FakeTransport {
        async fn request(
            &self,
            _url: &str,
            _form: Option<&[(String, String)]>,
        ) -> crate::Result<HttpResponse> {
            unreachable!("Claude refresh uses request_json, not request");
        }

        async fn request_json(
            &self,
            _url: &str,
            body: &str,
        ) -> crate::Result<HttpResponse> {
            self.captured_bodies.lock().unwrap().push(body.to_owned());
            let (status, body) = self.responses.lock().unwrap().remove(0);
            Ok(HttpResponse { status, body: Secret::new(body) })
        }
    }

    fn cancel_and_deadline() -> (CancellationToken, tokio::time::Instant) {
        (
            CancellationToken::new(),
            tokio::time::Instant::now() + std::time::Duration::from_secs(30),
        )
    }

    #[tokio::test]
    async fn successful_refresh_returns_rotated_token() {
        let transport = FakeTransport::new(vec![(
            200,
            serde_json::json!({
                "access_token": "new-access",
                "refresh_token": "new-refresh",
                "expires_in": 28800,
                "scope": "user:profile user:inference"
            })
            .to_string(),
        )]);
        let (cancel, deadline) = cancel_and_deadline();
        let options = ClaudeRefreshOptions::default();
        let refresh = Secret::new("old-refresh".to_owned());

        let result = refresh_token(&transport, &options, &refresh, &cancel, deadline)
            .await
            .unwrap();

        assert_eq!(result.access_token.expose(), "new-access");
        assert_eq!(result.refresh_token.expose(), "new-refresh");
        assert!(result.expires_at > 0);
        assert_eq!(result.scopes, vec!["user:profile", "user:inference"]);
    }

    #[tokio::test]
    async fn request_body_uses_json_format() {
        let transport = FakeTransport::new(vec![(
            200,
            serde_json::json!({
                "access_token": "tok",
                "refresh_token": "rt",
                "expires_in": 3600,
            })
            .to_string(),
        )]);
        let (cancel, deadline) = cancel_and_deadline();
        let options = ClaudeRefreshOptions {
            token_endpoint: "https://example.com/token",
            client_id: "test-client",
            scopes: &[],
        };
        let refresh = Secret::new("my-refresh".to_owned());

        let _ = refresh_token(&transport, &options, &refresh, &cancel, deadline).await;

        let bodies = transport.captured();
        assert_eq!(bodies.len(), 1);
        let parsed: serde_json::Value = serde_json::from_str(&bodies[0]).unwrap();
        assert_eq!(parsed["grant_type"], "refresh_token");
        assert_eq!(parsed["refresh_token"], "my-refresh");
        assert_eq!(parsed["client_id"], "test-client");
        assert!(parsed["scope"].as_str().unwrap().contains("user:inference"));
    }

    #[tokio::test]
    async fn default_scopes_when_none_provided() {
        let transport = FakeTransport::new(vec![(
            200,
            serde_json::json!({
                "access_token": "tok",
                "refresh_token": "rt",
                "expires_in": 3600,
            })
            .to_string(),
        )]);
        let (cancel, deadline) = cancel_and_deadline();
        let options = ClaudeRefreshOptions::default();
        let refresh = Secret::new("rt".to_owned());

        let _ = refresh_token(&transport, &options, &refresh, &cancel, deadline).await;

        let body: serde_json::Value =
            serde_json::from_str(&transport.captured()[0]).unwrap();
        let scope = body["scope"].as_str().unwrap();
        for s in DEFAULT_SCOPES {
            assert!(scope.contains(s), "missing scope: {s}");
        }
    }

    #[tokio::test]
    async fn explicit_scopes_override_defaults() {
        let transport = FakeTransport::new(vec![(
            200,
            serde_json::json!({
                "access_token": "tok",
                "refresh_token": "rt",
                "expires_in": 3600,
            })
            .to_string(),
        )]);
        let (cancel, deadline) = cancel_and_deadline();
        let scopes = vec!["user:inference".to_owned()];
        let options = ClaudeRefreshOptions {
            scopes: &scopes,
            ..Default::default()
        };
        let refresh = Secret::new("rt".to_owned());

        let _ = refresh_token(&transport, &options, &refresh, &cancel, deadline).await;

        let body: serde_json::Value =
            serde_json::from_str(&transport.captured()[0]).unwrap();
        assert_eq!(body["scope"], "user:inference");
    }

    #[tokio::test]
    async fn missing_rotated_refresh_reuses_original() {
        let transport = FakeTransport::new(vec![(
            200,
            serde_json::json!({
                "access_token": "tok",
                "expires_in": 3600,
            })
            .to_string(),
        )]);
        let (cancel, deadline) = cancel_and_deadline();
        let options = ClaudeRefreshOptions::default();
        let refresh = Secret::new("keep-me".to_owned());

        let result = refresh_token(&transport, &options, &refresh, &cancel, deadline)
            .await
            .unwrap();

        assert_eq!(result.refresh_token.expose(), "keep-me");
    }

    #[tokio::test]
    async fn invalid_grant_returns_rejection() {
        let transport = FakeTransport::new(vec![(
            401,
            serde_json::json!({"error": "invalid_grant"}).to_string(),
        )]);
        let (cancel, deadline) = cancel_and_deadline();
        let options = ClaudeRefreshOptions::default();
        let refresh = Secret::new("expired".to_owned());

        let err = unwrap_err(
            refresh_token(&transport, &options, &refresh, &cancel, deadline).await,
        );

        assert_eq!(err.rejection, Some(OAuthRefreshRejection::InvalidGrant));
        assert_eq!(err.status, Some(401));
        assert_eq!(err.error.code, ErrorCode::InteractionRequired);
    }

    #[tokio::test]
    async fn unknown_error_returns_invalid_token_response() {
        let transport = FakeTransport::new(vec![(
            400,
            serde_json::json!({"error": "something_unexpected"}).to_string(),
        )]);
        let (cancel, deadline) = cancel_and_deadline();
        let options = ClaudeRefreshOptions::default();
        let refresh = Secret::new("rt".to_owned());

        let err = unwrap_err(
            refresh_token(&transport, &options, &refresh, &cancel, deadline).await,
        );

        assert_eq!(err.rejection, None);
        assert_eq!(err.error.code, ErrorCode::InvalidTokenResponse);
    }

    #[tokio::test]
    async fn empty_refresh_token_rejected() {
        let transport = FakeTransport::new(vec![]);
        let (cancel, deadline) = cancel_and_deadline();
        let options = ClaudeRefreshOptions::default();
        let refresh = Secret::new(String::new());

        let err = unwrap_err(
            refresh_token(&transport, &options, &refresh, &cancel, deadline).await,
        );

        assert_eq!(err.error.code, ErrorCode::InvalidConfiguration);
    }

    #[tokio::test]
    async fn empty_access_token_in_response_rejected() {
        let transport = FakeTransport::new(vec![(
            200,
            serde_json::json!({
                "access_token": "",
                "refresh_token": "rt",
                "expires_in": 3600,
            })
            .to_string(),
        )]);
        let (cancel, deadline) = cancel_and_deadline();
        let options = ClaudeRefreshOptions::default();
        let refresh = Secret::new("rt".to_owned());

        let err = unwrap_err(
            refresh_token(&transport, &options, &refresh, &cancel, deadline).await,
        );

        assert_eq!(err.error.code, ErrorCode::InvalidTokenResponse);
    }

    #[tokio::test]
    async fn zero_expires_in_rejected() {
        let transport = FakeTransport::new(vec![(
            200,
            serde_json::json!({
                "access_token": "tok",
                "refresh_token": "rt",
                "expires_in": 0,
            })
            .to_string(),
        )]);
        let (cancel, deadline) = cancel_and_deadline();
        let options = ClaudeRefreshOptions::default();
        let refresh = Secret::new("rt".to_owned());

        let err = unwrap_err(
            refresh_token(&transport, &options, &refresh, &cancel, deadline).await,
        );

        assert_eq!(err.error.code, ErrorCode::InvalidTokenResponse);
    }

    #[test]
    fn is_expired_returns_true_within_margin() {
        let now_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;

        assert!(is_expired(now_ms)); // at exactly now
        assert!(is_expired(now_ms + EXPIRY_MARGIN_MS)); // at margin boundary
        assert!(is_expired(now_ms + EXPIRY_MARGIN_MS - 1)); // just inside margin
        assert!(!is_expired(now_ms + EXPIRY_MARGIN_MS + 60_000)); // well outside margin
    }

    #[test]
    fn is_expired_past_time_is_expired() {
        assert!(is_expired(0));
        assert!(is_expired(1));
    }
}
