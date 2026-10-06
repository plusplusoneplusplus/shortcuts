use crate::{Error, ErrorCode, Result};
use async_trait::async_trait;
use reqwest::{header::HeaderMap, Method};
use std::time::{Duration, SystemTime};
use url::Url;

pub const MAX_RESPONSE_BYTES: usize = 4 * 1024 * 1024;

/// Trusted transport boundary. Implementations must not log, persist, redirect, or replay
/// requests. An injected transport receives credentials and transient bodies.
pub struct HttpRequest {
    pub method: Method,
    pub url: Url,
    pub headers: HeaderMap,
    pub body: Option<Vec<u8>>,
}
pub struct HttpResponse {
    pub status: u16,
    pub headers: HeaderMap,
    pub body: Vec<u8>,
}
#[async_trait]
pub trait HttpTransport: Send + Sync {
    async fn execute(&self, request: HttpRequest) -> Result<HttpResponse>;
}
pub struct ReqwestTransport {
    client: reqwest::Client,
}
impl ReqwestTransport {
    pub fn new() -> Result<Self> {
        let client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .retry(reqwest::retry::never())
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(30))
            .build()
            .map_err(|_| Error::new(ErrorCode::Configuration))?;
        Ok(Self { client })
    }
}
#[async_trait]
impl HttpTransport for ReqwestTransport {
    async fn execute(&self, request: HttpRequest) -> Result<HttpResponse> {
        let mut builder = self
            .client
            .request(request.method, request.url)
            .headers(request.headers);
        if let Some(body) = request.body {
            builder = builder.body(body);
        }
        let mut response = builder
            .send()
            .await
            .map_err(|_| Error::new(ErrorCode::Network))?;
        let status = response.status().as_u16();
        let headers = response.headers().clone();
        // Error payloads are neither needed nor retained.
        if !(200..300).contains(&status) {
            return Ok(HttpResponse {
                status,
                headers,
                body: vec![],
            });
        }
        if response
            .content_length()
            .is_some_and(|n| n > MAX_RESPONSE_BYTES as u64)
        {
            return Err(Error::new(ErrorCode::Limit));
        }
        let mut body = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|_| Error::new(ErrorCode::Network))?
        {
            if chunk.len() > MAX_RESPONSE_BYTES - body.len() {
                return Err(Error::new(ErrorCode::Limit));
            }
            body.extend_from_slice(&chunk);
        }
        Ok(HttpResponse {
            status,
            headers,
            body,
        })
    }
}
pub(crate) fn retry_after(headers: &HeaderMap) -> Option<Duration> {
    let text = headers.get("retry-after")?.to_str().ok()?.trim();
    text.parse::<u64>()
        .ok()
        .map(Duration::from_secs)
        .or_else(|| {
            httpdate::parse_http_date(text)
                .ok()
                .map(|date| date.duration_since(SystemTime::now()).unwrap_or_default())
        })
}
