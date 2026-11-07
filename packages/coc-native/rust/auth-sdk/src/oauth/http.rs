use crate::{contracts::fail, AuthError, ErrorCode, Result, Secret};
use async_trait::async_trait;

pub struct HttpResponse {
    pub status: u16,
    pub body: Secret,
}

pub(crate) struct Form(pub Vec<(String, String)>);

impl std::ops::Deref for Form {
    type Target = [(String, String)];
    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

impl Form {
    pub fn push(&mut self, pair: (String, String)) {
        self.0.push(pair);
    }
}

impl Drop for Form {
    fn drop(&mut self) {
        for (_, value) in &mut self.0 {
            zeroize::Zeroize::zeroize(value);
        }
    }
}

/// Trusted transport injection for deterministic tests. Never exposed as a JS URL override.
#[async_trait]
pub trait HttpTransport: Send + Sync {
    /// Form-encoded POST (when `form` is `Some`) or GET (when `None`).
    async fn request(&self, url: &str, form: Option<&[(String, String)]>) -> Result<HttpResponse>;

    /// JSON-body POST. The `body` is an opaque JSON string; the transport sends it
    /// with `Content-Type: application/json`.
    async fn request_json(&self, url: &str, body: &str) -> Result<HttpResponse> {
        // Default: fall back to form-encoded POST with no body.  Real transports
        // override this; the default exists only for backward compatibility with
        // existing test doubles that don't need JSON support.
        let _ = body;
        self.request(url, None).await
    }
}

pub struct ReqwestTransport;

fn build_client() -> Result<reqwest::Client> {
    reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .https_only(true)
        .connect_timeout(std::time::Duration::from_secs(10))
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|_| AuthError::new(ErrorCode::InvalidConfiguration))
}

async fn read_response(mut response: reqwest::Response) -> Result<HttpResponse> {
    let status = response.status().as_u16();
    if (300..400).contains(&status) {
        return fail(ErrorCode::InvalidTokenResponse);
    }
    let mut body = zeroize::Zeroizing::new(Vec::new());
    while let Some(chunk) =
        response.chunk().await.map_err(|_| AuthError::new(ErrorCode::InvalidTokenResponse))?
    {
        if body.len() + chunk.len() > 1024 * 1024 {
            return fail(ErrorCode::InvalidTokenResponse);
        }
        body.extend_from_slice(&chunk);
    }
    let text = String::from_utf8(body.to_vec())
        .map_err(|_| AuthError::new(ErrorCode::InvalidTokenResponse))?;
    Ok(HttpResponse { status, body: Secret::new(text) })
}

#[async_trait]
impl HttpTransport for ReqwestTransport {
    async fn request(&self, url: &str, form: Option<&[(String, String)]>) -> Result<HttpResponse> {
        let client = build_client()?;
        let request =
            if let Some(form) = form { client.post(url).form(form) } else { client.get(url) };
        let response = request.send().await.map_err(|e| {
            AuthError::new(if e.is_timeout() {
                ErrorCode::TimedOut
            } else {
                ErrorCode::InvalidTokenResponse
            })
        })?;
        read_response(response).await
    }

    async fn request_json(&self, url: &str, body: &str) -> Result<HttpResponse> {
        let client = build_client()?;
        let response = client
            .post(url)
            .header("Content-Type", "application/json")
            .body(body.to_owned())
            .send()
            .await
            .map_err(|e| {
                AuthError::new(if e.is_timeout() {
                    ErrorCode::TimedOut
                } else {
                    ErrorCode::InvalidTokenResponse
                })
            })?;
        read_response(response).await
    }
}
