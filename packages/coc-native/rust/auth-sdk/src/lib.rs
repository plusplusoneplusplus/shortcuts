//! Source-pinned authentication. Access tokens live only in memory.
//! See the crate README for lifecycle, storage and registration constraints.

mod contracts;
pub mod github;
pub mod microsoft;
pub mod oauth;
mod process;
mod storage;

pub use contracts::*;
pub use storage::{AuthSdkCredentialStore, CredentialStore, OsCredentialStore};
