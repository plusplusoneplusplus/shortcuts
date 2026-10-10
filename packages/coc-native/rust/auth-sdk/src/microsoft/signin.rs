use super::{
    config::timeout_valid, coordination::CredentialLock, identity, oauth,
    provider::default_dependencies, Dependencies, OAuthOptions,
};
use crate::{
    contracts::{bounded, fail, Lifetime},
    Account, AuthError, ErrorCode, Result, Secret, Token,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use rand::RngCore;
use sha2::{Digest, Sha256};
use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, OnceLock,
    },
    time::Duration,
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
};
use tokio_util::sync::CancellationToken;
use url::Url;

#[derive(Clone)]
pub struct SignInInstructions {
    pub authorization_url: Option<String>,
    pub user_code: Option<String>,
    pub verification_uri: Option<String>,
    pub expires_at: u64,
}

pub struct SignInResult {
    pub account: Account,
    pub token: Token,
}

enum Flow {
    Browser {
        listener: TcpListener,
        redirect: String,
        state: Secret,
        verifier: Secret,
        nonce: Secret,
        metadata: identity::Metadata,
    },
    Device {
        device: Secret,
        interval: Duration,
        expires_at: u64,
        metadata: identity::Metadata,
    },
}

enum State {
    New,
    Starting,
    Ready(Box<Flow>),
    Waiting,
    Finished,
}

pub struct MicrosoftOAuthSignIn {
    options: OAuthOptions,
    expected: Option<Account>,
    timeout: Duration,
    dependencies: Arc<Dependencies>,
    life: Arc<Lifetime>,
    cancel: CancellationToken,
    state: Arc<Mutex<State>>,
    timed_out: Arc<AtomicBool>,
    deadline: OnceLock<tokio::time::Instant>,
}

fn random_secret() -> Result<Secret> {
    let mut bytes = zeroize::Zeroizing::new([0u8; 32]);
    rand::rngs::OsRng
        .try_fill_bytes(&mut *bytes)
        .map_err(|_| AuthError::new(ErrorCode::InvalidConfiguration))?;
    Ok(Secret::new(URL_SAFE_NO_PAD.encode(*bytes)))
}

impl MicrosoftOAuthSignIn {
    /// Validation only. No discovery, credential reads, callback listeners or login.
    pub fn new(
        options: OAuthOptions,
        expected: Option<Account>,
        timeout: Duration,
    ) -> Result<Self> {
        Self::with_dependencies(options, expected, timeout, default_dependencies())
    }

    pub fn with_dependencies(
        options: OAuthOptions,
        expected: Option<Account>,
        timeout: Duration,
        dependencies: Arc<Dependencies>,
    ) -> Result<Self> {
        options.validate()?;
        if !timeout_valid(timeout) || expected.as_ref().is_some_and(|a| !options.account_valid(a)) {
            return fail(ErrorCode::InvalidConfiguration);
        }
        Ok(Self {
            options,
            expected,
            timeout,
            dependencies,
            life: Lifetime::new(),
            cancel: CancellationToken::new(),
            state: Arc::new(Mutex::new(State::New)),
            timed_out: Arc::new(AtomicBool::new(false)),
            deadline: OnceLock::new(),
        })
    }

    fn state(&self) -> Result<std::sync::MutexGuard<'_, State>> {
        self.state.lock().map_err(|_| AuthError::new(ErrorCode::Disposed))
    }

    fn start(&self) -> Result<()> {
        self.life.check()?;
        self.check_cancel()?;
        let mut state = self.state()?;
        if !matches!(*state, State::New) {
            return fail(ErrorCode::InvalidConfiguration);
        }
        *state = State::Starting;
        let _ = self.deadline.set(tokio::time::Instant::now() + self.timeout);
        let state = Arc::downgrade(&self.state);
        let timed_out = self.timed_out.clone();
        let cancel = self.cancel.clone();
        let timeout = self.timeout;
        // Explicit sign-in owns a deadline even if the caller never invokes wait().
        tokio::spawn(async move {
            tokio::select! {
                _ = cancel.cancelled() => {}
                _ = tokio::time::sleep(timeout) => {
                    if let Some(state) = state.upgrade() {
                        if let Ok(mut state) = state.lock() {
                            if !matches!(*state, State::Finished) {
                                timed_out.store(true, Ordering::Release);
                                cancel.cancel();
                                *state = State::Finished;
                            }
                        }
                    }
                }
            }
        });
        Ok(())
    }

    fn check_cancel(&self) -> Result<()> {
        if self.timed_out.load(Ordering::Acquire) {
            return fail(ErrorCode::TimedOut);
        }
        if self.cancel.is_cancelled() {
            return fail(ErrorCode::Cancelled);
        }
        Ok(())
    }

    fn result<T>(&self, result: Result<T>) -> Result<T> {
        if result.is_err() && self.timed_out.load(Ordering::Acquire) {
            return fail(ErrorCode::TimedOut);
        }
        result
    }

    pub async fn begin_browser(&self) -> Result<SignInInstructions> {
        self.start()?;
        let result = bounded(&self.life, &self.cancel, self.timeout, async {
            let metadata =
                identity::metadata(self.dependencies.http.as_ref(), &self.options).await?;
            let listener = TcpListener::bind(("127.0.0.1", 0))
                .await
                .map_err(|_| AuthError::new(ErrorCode::InvalidConfiguration))?;
            let address = listener
                .local_addr()
                .map_err(|_| AuthError::new(ErrorCode::InvalidConfiguration))?;
            let redirect = format!("http://127.0.0.1:{}/callback", address.port());
            let verifier = random_secret()?;
            let state = random_secret()?;
            let nonce = random_secret()?;
            let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.expose().as_bytes()));
            let mut url = Url::parse(&metadata.authorize)
                .map_err(|_| AuthError::new(ErrorCode::IdentityVerificationFailed))?;
            url.query_pairs_mut().extend_pairs([
                ("client_id", self.options.client_id.as_str()),
                ("response_type", "code"),
                ("redirect_uri", redirect.as_str()),
                ("scope", &self.options.scopes.join(" ")),
                ("state", state.expose()),
                ("nonce", nonce.expose()),
                ("code_challenge", &challenge),
                ("code_challenge_method", "S256"),
                ("response_mode", "query"),
            ]);
            if let Some(resource) = &self.options.resource {
                url.query_pairs_mut().append_pair("resource", resource);
            }
            let instructions = SignInInstructions {
                authorization_url: Some(url.into()),
                user_code: None,
                verification_uri: None,
                expires_at: self
                    .dependencies
                    .clock
                    .now_ms()
                    .saturating_add(self.timeout.as_millis() as u64),
            };
            self.life.publish(|| {
                self.check_cancel()?;
                *self.state()? = State::Ready(Box::new(Flow::Browser {
                    listener,
                    redirect,
                    state,
                    verifier,
                    nonce,
                    metadata,
                }));
                Ok(())
            })?;
            Ok(instructions)
        })
        .await;
        if result.is_err() {
            *self.state()? = State::Finished;
        }
        self.result(result)
    }

    pub async fn begin_device(&self) -> Result<SignInInstructions> {
        self.start()?;
        let result = bounded(&self.life, &self.cancel, self.timeout, async {
            let metadata =
                identity::metadata(self.dependencies.http.as_ref(), &self.options).await?;
            let mut form = super::http::Form(vec![
                ("client_id".into(), self.options.client_id.clone()),
                ("scope".into(), self.options.scopes.join(" ")),
            ]);
            if let Some(resource) = &self.options.resource {
                form.push(("resource".into(), resource.clone()));
            }
            let output = self.dependencies.http.request(&metadata.device, Some(&form)).await?;
            if output.status != 200 {
                return fail(ErrorCode::InteractionRequired);
            }
            #[derive(serde::Deserialize)]
            struct Device {
                device_code: Secret,
                user_code: String,
                verification_uri: String,
                expires_in: u64,
                #[serde(default = "default_interval")]
                interval: u64,
            }
            fn default_interval() -> u64 {
                5
            }
            let device: Device = serde_json::from_str(output.body.expose())
                .map_err(|_| AuthError::new(ErrorCode::InvalidTokenResponse))?;
            let uri = Url::parse(&device.verification_uri)
                .map_err(|_| AuthError::new(ErrorCode::InvalidTokenResponse))?;
            if uri.scheme() != "https"
                || !uri.username().is_empty()
                || uri.password().is_some()
                || uri.port().is_some()
                || ![
                    "microsoft.com",
                    "www.microsoft.com",
                    "login.microsoftonline.com",
                    "login.microsoftonline.us",
                    "login.chinacloudapi.cn",
                ]
                .contains(&uri.host_str().unwrap_or_default())
                || device.device_code.expose().is_empty()
                || !super::config::text(&device.user_code, 256)
                || !(1..=900).contains(&device.expires_in)
                || !(1..=60).contains(&device.interval)
            {
                return fail(ErrorCode::InvalidTokenResponse);
            }
            let expires_at =
                self.dependencies.clock.now_ms().saturating_add(device.expires_in * 1000);
            let instructions = SignInInstructions {
                authorization_url: None,
                user_code: Some(device.user_code),
                verification_uri: Some(device.verification_uri),
                expires_at,
            };
            self.life.publish(|| {
                self.check_cancel()?;
                *self.state()? = State::Ready(Box::new(Flow::Device {
                    device: device.device_code,
                    interval: Duration::from_secs(device.interval),
                    expires_at,
                    metadata,
                }));
                Ok(())
            })?;
            Ok(instructions)
        })
        .await;
        if result.is_err() {
            *self.state()? = State::Finished;
        }
        self.result(result)
    }

    pub async fn wait(&self) -> Result<SignInResult> {
        self.life.check()?;
        self.check_cancel()?;
        let flow = {
            let mut state = self.state()?;
            if !matches!(*state, State::Ready(_)) {
                return fail(ErrorCode::InvalidConfiguration);
            }
            match std::mem::replace(&mut *state, State::Waiting) {
                State::Ready(flow) => flow,
                _ => unreachable!(),
            }
        };
        let result = bounded(&self.life, &self.cancel, self.timeout, async {
            let (response, metadata, nonce) = match *flow {
                Flow::Browser { listener, redirect, state, verifier, nonce, metadata } => {
                    let code = callback(listener, state.expose()).await?;
                    let mut form = super::http::Form(vec![
                        ("client_id".into(), self.options.client_id.clone()),
                        ("grant_type".into(), "authorization_code".into()),
                        ("code".into(), code.expose().to_owned()),
                        ("redirect_uri".into(), redirect),
                        ("code_verifier".into(), verifier.expose().to_owned()),
                        ("scope".into(), self.options.scopes.join(" ")),
                    ]);
                    if let Some(resource) = &self.options.resource {
                        form.push(("resource".into(), resource.clone()));
                    }
                    let output = self.dependencies.http.request(&metadata.token, Some(&form)).await;
                    let output = output?;
                    (oauth::response(output.body.expose(), output.status)?, metadata, Some(nonce))
                }
                Flow::Device { device, mut interval, expires_at, metadata } => loop {
                    tokio::time::sleep(interval).await;
                    if self.dependencies.clock.now_ms() >= expires_at {
                        return fail(ErrorCode::TokenExpired);
                    }
                    let mut form = super::http::Form(vec![
                        ("client_id".into(), self.options.client_id.clone()),
                        (
                            "grant_type".into(),
                            "urn:ietf:params:oauth:grant-type:device_code".into(),
                        ),
                        ("device_code".into(), device.expose().to_owned()),
                    ]);
                    if let Some(resource) = &self.options.resource {
                        form.push(("resource".into(), resource.clone()));
                    }
                    let output = self.dependencies.http.request(&metadata.token, Some(&form)).await;
                    let output = output?;
                    if output.status == 200 {
                        break (
                            oauth::response(output.body.expose(), output.status)?,
                            metadata,
                            None,
                        );
                    }
                    #[derive(serde::Deserialize)]
                    struct Pending {
                        error: String,
                    }
                    let pending: Pending = serde_json::from_str(output.body.expose())
                        .map_err(|_| AuthError::new(ErrorCode::InvalidTokenResponse))?;
                    match pending.error.as_str() {
                        "authorization_pending" => {}
                        "slow_down" => {
                            interval += Duration::from_secs(5);
                        }
                        _ => {
                            return Err(oauth::response(output.body.expose(), output.status)
                                .err()
                                .unwrap_or_else(|| {
                                    AuthError::new(ErrorCode::InvalidTokenResponse)
                                }));
                        }
                    }
                },
            };
            let id = response
                .id_token
                .as_ref()
                .ok_or_else(|| AuthError::new(ErrorCode::IdentityVerificationFailed))?;
            let account = identity::verify(
                self.dependencies.http.as_ref(),
                &self.options,
                &metadata,
                id.expose(),
                nonce.as_ref().map(Secret::expose),
                self.dependencies.clock.as_ref(),
            )
            .await?;
            if self.expected.as_ref().is_some_and(|a| !oauth::account_matches(&account, a)) {
                return fail(ErrorCode::AccountMismatch);
            }
            let refresh = response
                .refresh_token
                .as_ref()
                .ok_or_else(|| AuthError::new(ErrorCode::InvalidTokenResponse))?;
            let key = self.options.credential_key(&account);
            let _lock = CredentialLock::acquire(&self.options.coordination_dir, &key).await?;
            self.check_cancel()?;
            oauth::persist(
                self.dependencies.store.as_ref(),
                &key,
                &account,
                refresh,
                &self.life,
                &self.cancel,
                *self
                    .deadline
                    .get()
                    .ok_or_else(|| AuthError::new(ErrorCode::InvalidConfiguration))?,
            )?;
            let token = oauth::token(
                response,
                &self.options,
                account.clone(),
                self.dependencies.clock.now_ms(),
            )?;
            Ok(SignInResult { account, token })
        })
        .await;
        *self.state()? = State::Finished;
        self.result(result)
    }

    pub fn cancel(&self) {
        self.cancel.cancel();
        if let Ok(mut state) = self.state.lock() {
            *state = State::Finished;
        }
    }

    pub fn dispose(&self) {
        self.life.dispose();
        self.cancel();
    }
}

impl Drop for MicrosoftOAuthSignIn {
    fn drop(&mut self) {
        self.dispose();
    }
}

async fn callback(listener: TcpListener, expected_state: &str) -> Result<Secret> {
    loop {
        let (mut stream, peer) =
            listener.accept().await.map_err(|_| AuthError::new(ErrorCode::InvalidTokenResponse))?;
        if !peer.ip().is_loopback() {
            continue;
        }
        let request = tokio::time::timeout(Duration::from_secs(5), async {
            let mut bytes = zeroize::Zeroizing::new(Vec::new());
            while bytes.len() < 8192 {
                let byte = stream
                    .read_u8()
                    .await
                    .map_err(|_| AuthError::new(ErrorCode::InvalidTokenResponse))?;
                bytes.push(byte);
                if bytes.ends_with(b"\r\n\r\n") {
                    return Ok(bytes);
                }
            }
            fail(ErrorCode::InvalidTokenResponse)
        })
        .await
        .map_err(|_| AuthError::new(ErrorCode::TimedOut))??;
        let request = std::str::from_utf8(&request)
            .map_err(|_| AuthError::new(ErrorCode::InvalidTokenResponse))?;
        let first = request.lines().next().unwrap_or_default();
        let mut pieces = first.split_whitespace();
        if pieces.next() != Some("GET") {
            return fail(ErrorCode::InvalidTokenResponse);
        }
        let path = pieces.next().ok_or_else(|| AuthError::new(ErrorCode::InvalidTokenResponse))?;
        let url = Url::parse(&format!("http://127.0.0.1{path}"))
            .map_err(|_| AuthError::new(ErrorCode::InvalidTokenResponse))?;
        if url.path() != "/callback" {
            continue;
        }
        let pairs: Vec<_> = url.query_pairs().collect();
        let states: Vec<_> = pairs.iter().filter(|(k, _)| k == "state").collect();
        if states.len() != 1 || states[0].1 != expected_state {
            return fail(ErrorCode::IdentityVerificationFailed);
        }
        if pairs.iter().any(|(k, _)| k == "error") {
            return fail(ErrorCode::AccessDenied);
        }
        let codes: Vec<_> = pairs.iter().filter(|(k, _)| k == "code").collect();
        if codes.len() != 1 || codes[0].1.is_empty() {
            return fail(ErrorCode::InvalidTokenResponse);
        }
        let code = Secret::new(codes[0].1.to_string());
        stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 25\r\nConnection: close\r\n\r\nAuthentication received.\n").await
            .map_err(|_| AuthError::new(ErrorCode::InvalidTokenResponse))?;
        return Ok(code);
    }
}
