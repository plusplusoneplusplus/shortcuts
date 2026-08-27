//! Native primitives for the CoC server.
//!
//! This crate is the home for any CPU- or filesystem-bound work worth moving
//! out of Node, not for one feature in particular. Each capability is a
//! self-contained module with its own tests, and nothing here depends on Node
//! or N-API, so `cargo test -p coc-native-core` exercises the whole logic layer
//! without a JavaScript runtime. The addon in `../napi` wraps these modules,
//! one thin N-API module per capability.

pub mod content_search;
pub mod git;
pub mod notes_index;
pub mod repo_index;
