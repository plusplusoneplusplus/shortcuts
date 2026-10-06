use std::fmt;
use std::time::Duration;

pub type Result<T> = std::result::Result<T, Error>;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Delivery {
    NotAttempted,
    Rejected,
    Unknown,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ErrorCode {
    Configuration,
    Unsupported,
    InvalidTarget,
    Authentication,
    Permission,
    NotFound,
    RateLimited,
    Rejected,
    Protocol,
    UnsafeCursor,
    Limit,
    Cancelled,
    Closed,
    Timeout,
    Network,
}

/// Deliberately contains no provider strings, URLs, identifiers, or error sources.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Error {
    pub code: ErrorCode,
    pub delivery: Delivery,
    pub status: Option<u16>,
    pub retry_after: Option<Duration>,
}

impl Error {
    pub fn new(code: ErrorCode) -> Self {
        Self {
            code,
            delivery: Delivery::NotAttempted,
            status: None,
            retry_after: None,
        }
    }
    pub(crate) fn delivery(mut self, delivery: Delivery) -> Self {
        self.delivery = delivery;
        self
    }
    pub(crate) fn http(status: u16, retry_after: Option<Duration>, write: bool) -> Self {
        let code = match status {
            401 => ErrorCode::Authentication,
            403 => ErrorCode::Permission,
            404 => ErrorCode::NotFound,
            429 => ErrorCode::RateLimited,
            408 | 504 => ErrorCode::Timeout,
            400..=499 => ErrorCode::Rejected,
            _ => ErrorCode::Network,
        };
        Self {
            code,
            status: Some(status),
            retry_after,
            delivery: if !write {
                Delivery::NotAttempted
            } else if (400..500).contains(&status) && status != 408 {
                Delivery::Rejected
            } else {
                Delivery::Unknown
            },
        }
    }
}
impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "Teams operation failed: {:?} ({:?})",
            self.code, self.delivery
        )
    }
}
impl std::error::Error for Error {}
