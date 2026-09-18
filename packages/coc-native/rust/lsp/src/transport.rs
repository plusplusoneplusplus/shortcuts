//! The write half of the connection, shared between the dispatch loop and the
//! background indexer.
//!
//! Framed messages must not interleave, so every writer goes through one mutex.
//! Everything here is infallible from the caller's point of view: once the
//! parent has closed its end there is nothing useful to do about a write error
//! except keep unwinding toward exit.

use std::io::Write;
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::{Arc, Mutex};

use serde_json::{json, Value};

use crate::framing::write_message;

#[derive(Clone)]
pub struct Transport {
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    next_request_id: Arc<AtomicI64>,
}

impl Transport {
    pub fn new(writer: Box<dyn Write + Send>) -> Self {
        Self {
            writer: Arc::new(Mutex::new(writer)),
            // Server-to-client ids live in their own space; starting high keeps
            // them visually distinct from the client's in a log.
            next_request_id: Arc::new(AtomicI64::new(1)),
        }
    }

    pub fn respond(&self, id: Value, result: Value) {
        self.send(json!({ "jsonrpc": "2.0", "id": id, "result": result }));
    }

    pub fn respond_error(&self, id: Value, code: i64, message: &str) {
        self.send(json!({
            "jsonrpc": "2.0",
            "id": id,
            "error": { "code": code, "message": message },
        }));
    }

    pub fn notify(&self, method: &str, params: Value) {
        self.send(json!({ "jsonrpc": "2.0", "method": method, "params": params }));
    }

    /// Sends a server-to-client request. The reply is not awaited: the only one
    /// this server sends is `window/workDoneProgress/create`, whose answer
    /// changes nothing it does.
    pub fn request(&self, method: &str, params: Value) {
        let id = self.next_request_id.fetch_add(1, Ordering::Relaxed);
        self.send(json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params }));
    }

    fn send(&self, message: Value) {
        let body = match serde_json::to_vec(&message) {
            Ok(body) => body,
            Err(_) => return,
        };
        let mut writer = self.writer.lock().unwrap_or_else(|error| error.into_inner());
        let _ = write_message(&mut *writer, &body);
    }
}
