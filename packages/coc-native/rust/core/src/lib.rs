//! Path indexing and fuzzy path search for CoC's quick-open dialog.
//!
//! Deliberately free of any Node/N-API dependency so it can be unit-tested with
//! a plain `cargo test`; the addon in `../napi` is a thin wrapper over this.

pub mod index;
pub mod score;
pub mod walk;

pub use index::{Hit, IndexState};
pub use walk::WalkOptions;
