//! N-API addon exposing CoC's native capabilities to Node.
//!
//! One module per capability, each registering its own classes and functions:
//! adding a capability means adding a module here and nothing else. Every
//! method that touches the filesystem or scans a large in-memory structure
//! returns a real promise backed by an `AsyncTask`, so the work happens on a
//! libuv worker and the Node event loop is never blocked.
//!
//! The logic lives in `coc-native-core`; everything here is marshalling.

#![deny(clippy::all)]
// `cargo clippy --workspace --all-targets` builds this cdylib as a test crate,
// where the N-API proc macro's exported entry points look unused to rustc.
#![cfg_attr(test, allow(dead_code))]

mod file_index;
mod notes_index;
