use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use tokio_util::sync::CancellationToken;
use zeroize::Zeroizing;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ErrorCode {
    InvalidConfiguration,
    CliUnavailable,
    LoginRequired,
    InteractionRequired,
    AccountMismatch,
    TokenExpired,
    RefreshDisabled,
    StorageUnavailable,
    StorageLocked,
    StorageDenied,
    StorageFailed,
    CoordinationUnavailable,
    InvalidTokenResponse,
    IdentityVerificationFailed,
    AccessDenied,
    TimedOut,
    Cancelled,
    Disposed,
}

/// Diagnostics contain only SDK-defined codes, never provider payloads or secrets.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AuthError {
    pub code: ErrorCode,
}

impl AuthError {
    pub fn new(code: ErrorCode) -> Self {
        Self { code }
    }
}

impl std::fmt::Display for AuthError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "Authentication failed: {:?}.", self.code)
    }
}

impl std::error::Error for AuthError {}
pub type Result<T> = std::result::Result<T, AuthError>;

pub(crate) fn fail<T>(code: ErrorCode) -> Result<T> {
    Err(AuthError::new(code))
}

/// Deliberately has neither Debug nor Serialize. Clones are independently zeroized.
#[derive(Clone)]
pub struct Secret(Zeroizing<String>);

impl Secret {
    pub fn new(value: String) -> Self {
        Self(Zeroizing::new(value))
    }

    pub fn expose(&self) -> &str {
        &self.0
    }
}

impl<'de> serde::Deserialize<'de> for Secret {
    fn deserialize<D: serde::Deserializer<'de>>(
        deserializer: D,
    ) -> std::result::Result<Self, D::Error> {
        <String as serde::Deserialize>::deserialize(deserializer).map(Secret::new)
    }
}

#[derive(Clone, Debug, Eq, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct Account {
    pub id: String,
    pub tenant: String,
}

#[derive(Clone)]
pub struct Token {
    pub access_token: Secret,
    pub token_type: String,
    pub expires_at: u64,
    pub source: String,
    pub target: String,
    pub account: Account,
    pub granted_scopes: Option<Vec<String>>,
}

impl Token {
    pub fn valid(&self, now: u64, margin_seconds: u64) -> bool {
        self.expires_at > now.saturating_add(margin_seconds.saturating_mul(1000))
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Refresh {
    Auto,
    Never,
}

pub trait Clock: Send + Sync {
    fn now_ms(&self) -> u64;
}

pub struct SystemClock;

impl Clock for SystemClock {
    fn now_ms(&self) -> u64 {
        SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64
    }
}

/// Disposal and durable writes linearize under the same lock.
pub(crate) struct Lifetime {
    disposed: AtomicBool,
    commit: Mutex<()>,
    pub cancel: CancellationToken,
}

impl Lifetime {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            disposed: AtomicBool::new(false),
            commit: Mutex::new(()),
            cancel: CancellationToken::new(),
        })
    }

    pub fn check(&self) -> Result<()> {
        if self.disposed.load(Ordering::Acquire) {
            fail(ErrorCode::Disposed)
        } else {
            Ok(())
        }
    }

    pub fn publish<T>(&self, f: impl FnOnce() -> Result<T>) -> Result<T> {
        let _guard = self.commit.lock().map_err(|_| AuthError::new(ErrorCode::Disposed))?;
        self.check()?;
        f()
    }

    pub fn dispose(&self) {
        let _guard = self.commit.lock().unwrap_or_else(|e| e.into_inner());
        self.disposed.store(true, Ordering::Release);
        self.cancel.cancel();
    }
}

pub(crate) async fn bounded<T>(
    life: &Lifetime,
    cancel: &CancellationToken,
    timeout: Duration,
    work: impl std::future::Future<Output = Result<T>>,
) -> Result<T> {
    life.check()?;
    let deadline = tokio::time::Instant::now() + timeout;
    let result = tokio::select! {
        biased;
        _ = life.cancel.cancelled() => fail(ErrorCode::Disposed),
        _ = cancel.cancelled() => fail(ErrorCode::Cancelled),
        result = tokio::time::timeout(timeout, work) => result.unwrap_or_else(|_| fail(ErrorCode::TimedOut)),
    };
    life.check()?;
    checkpoint(cancel, deadline)?;
    result
}

pub(crate) fn checkpoint(cancel: &CancellationToken, deadline: tokio::time::Instant) -> Result<()> {
    if cancel.is_cancelled() {
        return fail(ErrorCode::Cancelled);
    }
    if tokio::time::Instant::now() >= deadline {
        return fail(ErrorCode::TimedOut);
    }
    Ok(())
}
