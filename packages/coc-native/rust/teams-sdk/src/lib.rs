//! Standalone Teams access. Message bodies are transient and never logged or cached.
//! Tokens come from a trusted, account-aware provider; this crate does not validate JWT signatures.
pub mod auth;
pub mod capabilities;
pub mod client;
mod constants;
pub mod error;
pub mod http;
pub mod ic3;
pub mod mcp;
pub mod models;
mod normalize;
pub mod notifications;
pub mod session;

pub use client::{TeamsClient, TeamsClientBuilder};
pub use error::{Delivery, Error, ErrorCode, Result};
pub use models::*;
pub use session::{OperationContext, Session};
pub use tokio_util::sync::CancellationToken;
