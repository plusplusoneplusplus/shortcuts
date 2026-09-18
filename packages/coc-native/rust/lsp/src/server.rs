//! Lifecycle and dispatch for the symbol-index language server.

use std::io::{BufRead, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use coc_native_core::symbol_index::{
    ExtractionLimits, SymbolStore, SyncProgress, SyncProgressPhase,
};
use serde_json::{json, Value};

use crate::framing::read_message;
use crate::transport::Transport;
use crate::uri::uri_to_path;

/// Where the index lands when the host did not name a file. The host always
/// does — `coc-symbols` is prepared with `--database` pointing at
/// `getRepoDataPath(dataDir, repoId, 'symbol-index.sqlite')` — so this only
/// covers a hand-run binary.
const DEFAULT_DATABASE_RELATIVE: &str = ".coc-symbols/symbol-index.sqlite";

/// The `$/progress` token for the index build. One token, reused across syncs:
/// the session on the Node side counts begin/end pairs, and a fresh token per
/// sync would only make it harder to see that they balance.
const INDEX_PROGRESS_TOKEN: &str = "coc-symbols/index";

const METHOD_NOT_FOUND: i64 = -32601;
const INVALID_REQUEST: i64 = -32600;
const SERVER_NOT_INITIALIZED: i64 = -32002;

#[derive(Debug, Default)]
pub struct ServerOptions {
    /// Host path of the SQLite index, supplied by the runtime adapter.
    pub database: Option<PathBuf>,
}

struct Server {
    transport: Transport,
    options: ServerOptions,
    root: Option<PathBuf>,
    store: Option<Arc<SymbolStore>>,
    initialized: bool,
    shutdown_requested: bool,
}

/// Runs the message loop until the stream ends or `exit` arrives. The return
/// value is the process exit code: the specification asks for 0 after a
/// `shutdown` and 1 for an `exit` that skipped it.
pub fn run(
    mut reader: impl BufRead,
    writer: Box<dyn Write + Send>,
    options: ServerOptions,
) -> std::io::Result<i32> {
    let mut server = Server {
        transport: Transport::new(writer),
        options,
        root: None,
        store: None,
        initialized: false,
        shutdown_requested: false,
    };
    while let Some(body) = read_message(&mut reader)? {
        let Ok(message) = serde_json::from_slice::<Value>(&body) else {
            // A body that is not JSON has no id to answer on. Dropping it is
            // the only thing the base protocol allows.
            continue;
        };
        match server.handle(&message) {
            Flow::Continue => {}
            Flow::Exit(code) => return Ok(code),
        }
    }
    // The parent closed the pipe without an `exit`. Treat a completed shutdown
    // as a clean end anyway; anything else is an abnormal loss of the client.
    Ok(if server.shutdown_requested { 0 } else { 1 })
}

enum Flow {
    Continue,
    Exit(i32),
}

impl Server {
    fn handle(&mut self, message: &Value) -> Flow {
        let method = message.get("method").and_then(Value::as_str);
        let id = message.get("id").cloned();
        match (method, id) {
            // A reply to one of our own requests. Nothing here awaits one.
            (None, Some(_)) => Flow::Continue,
            (None, None) => Flow::Continue,
            (Some(method), Some(id)) => self.handle_request(method, id, message),
            (Some(method), None) => self.handle_notification(method, message),
        }
    }

    fn handle_request(&mut self, method: &str, id: Value, message: &Value) -> Flow {
        let params = message.get("params").cloned().unwrap_or(Value::Null);
        match method {
            "initialize" => {
                if self.initialized {
                    self.transport.respond_error(id, INVALID_REQUEST, "already initialized");
                    return Flow::Continue;
                }
                self.initialize(id, &params);
            }
            "shutdown" => {
                self.shutdown_requested = true;
                self.transport.respond(id, Value::Null);
            }
            _ if !self.initialized => {
                self.transport.respond_error(id, SERVER_NOT_INITIALIZED, "server not initialized");
            }
            _ => {
                self.transport.respond_error(
                    id,
                    METHOD_NOT_FOUND,
                    &format!("unsupported request: {method}"),
                );
            }
        }
        Flow::Continue
    }

    fn handle_notification(&mut self, method: &str, _message: &Value) -> Flow {
        match method {
            "initialized" => {
                self.start_index_build();
                Flow::Continue
            }
            "exit" => Flow::Exit(if self.shutdown_requested { 0 } else { 1 }),
            // `$/cancelRequest` and everything else: requests are answered
            // synchronously on this loop, so there is never one to cancel.
            _ => Flow::Continue,
        }
    }

    fn initialize(&mut self, id: Value, params: &Value) {
        self.root = resolve_root(params);
        self.initialized = true;
        let database = self.database_path();
        let mut index_error = None;
        match database.as_deref().map(open_store) {
            Some(Ok(store)) => self.store = Some(Arc::new(store)),
            Some(Err(error)) => index_error = Some(error),
            None => index_error = Some("no workspace root and no --database argument".to_string()),
        }
        self.transport.respond(
            id,
            json!({
                "capabilities": {
                    "textDocumentSync": {
                        "openClose": true,
                        // The index reads files from disk; an unsaved buffer
                        // has nothing it can do with incremental edits.
                        "change": 0,
                        "save": { "includeText": false },
                    },
                },
                "serverInfo": {
                    "name": "coc-symbols",
                    "version": env!("CARGO_PKG_VERSION"),
                },
            }),
        );
        if let Some(error) = index_error {
            self.transport.notify(
                "window/logMessage",
                json!({ "type": 1, "message": format!("symbol index unavailable: {error}") }),
            );
        }
    }

    fn database_path(&self) -> Option<PathBuf> {
        self.options
            .database
            .clone()
            .or_else(|| self.root.as_ref().map(|root| root.join(DEFAULT_DATABASE_RELATIVE)))
    }

    /// Builds the index on a worker thread so the dispatch loop keeps answering
    /// while a cold 30M-line repository is being walked.
    fn start_index_build(&mut self) {
        let (Some(root), Some(store)) = (self.root.clone(), self.store.clone()) else {
            return;
        };
        let transport = self.transport.clone();
        std::thread::spawn(move || {
            transport.request(
                "window/workDoneProgress/create",
                json!({ "token": INDEX_PROGRESS_TOKEN }),
            );
            transport.notify(
                "$/progress",
                json!({
                    "token": INDEX_PROGRESS_TOKEN,
                    "value": {
                        "kind": "begin",
                        "title": "Indexing symbols",
                        "cancellable": false,
                        "percentage": 0,
                    },
                }),
            );
            let result = store.sync_repository_with_progress(
                &root,
                ExtractionLimits::default(),
                |progress| {
                    transport.notify(
                        "$/progress",
                        json!({
                            "token": INDEX_PROGRESS_TOKEN,
                            "value": {
                                "kind": "report",
                                "message": progress_message(progress),
                                "percentage": progress_percentage(progress),
                            },
                        }),
                    );
                },
            );
            let message = match result {
                Ok(stats) => format!(
                    "Indexed {} files ({} parsed, {} unchanged)",
                    stats.scanned, stats.parsed, stats.unchanged
                ),
                Err(error) => format!("Indexing failed: {error}"),
            };
            // The end notification is what returns the Node session from
            // `indexing` to `ready`, so it has to be sent on the failure path
            // too — otherwise a broken index leaves the status stuck forever.
            transport.notify(
                "$/progress",
                json!({
                    "token": INDEX_PROGRESS_TOKEN,
                    "value": { "kind": "end", "message": message },
                }),
            );
        });
    }
}

fn open_store(path: &Path) -> Result<SymbolStore, String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    SymbolStore::open(path).map_err(|error| error.to_string())
}

fn progress_message(progress: SyncProgress) -> String {
    match progress.phase {
        SyncProgressPhase::Scanning => format!("Scanning files ({})", progress.processed),
        SyncProgressPhase::Indexing => {
            format!("Parsing {} of {}", progress.processed, progress.total)
        }
        SyncProgressPhase::Complete => "Finishing".to_string(),
    }
}

fn progress_percentage(progress: SyncProgress) -> u32 {
    match progress.phase {
        // The walk has no total until it finishes, so scanning owns the first
        // tenth of the bar and parsing owns the rest.
        SyncProgressPhase::Scanning => 5,
        SyncProgressPhase::Indexing if progress.total > 0 => {
            10 + (progress.processed.min(progress.total) * 90 / progress.total) as u32
        }
        SyncProgressPhase::Indexing => 10,
        SyncProgressPhase::Complete => 100,
    }
}

/// `rootUri` wins over the deprecated `rootPath`, and a single workspace folder
/// wins over both — that is the order the specification lists them in.
fn resolve_root(params: &Value) -> Option<PathBuf> {
    let folder = params
        .get("workspaceFolders")
        .and_then(Value::as_array)
        .and_then(|folders| folders.first())
        .and_then(|folder| folder.get("uri"))
        .and_then(Value::as_str)
        .and_then(uri_to_path);
    folder
        .or_else(|| params.get("rootUri").and_then(Value::as_str).and_then(uri_to_path))
        .or_else(|| params.get("rootPath").and_then(Value::as_str).map(PathBuf::from))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prefers_a_workspace_folder_over_root_uri() {
        let params = json!({
            "rootUri": "file:///other",
            "workspaceFolders": [{ "uri": "file:///repo", "name": "repo" }],
        });
        assert_eq!(resolve_root(&params), Some(PathBuf::from("/repo")));
    }

    #[test]
    fn falls_back_to_root_uri_then_root_path() {
        assert_eq!(
            resolve_root(&json!({ "rootUri": "file:///repo" })),
            Some(PathBuf::from("/repo"))
        );
        assert_eq!(resolve_root(&json!({ "rootPath": "/repo" })), Some(PathBuf::from("/repo")));
        assert_eq!(resolve_root(&json!({})), None);
    }

    #[test]
    fn parsing_progress_spans_the_bar_above_the_scan() {
        let scanning = SyncProgress { phase: SyncProgressPhase::Scanning, processed: 10, total: 0 };
        assert_eq!(progress_percentage(scanning), 5);
        let half = SyncProgress { phase: SyncProgressPhase::Indexing, processed: 5, total: 10 };
        assert_eq!(progress_percentage(half), 55);
        let done = SyncProgress { phase: SyncProgressPhase::Complete, processed: 10, total: 10 };
        assert_eq!(progress_percentage(done), 100);
    }

    #[test]
    fn an_empty_change_set_does_not_divide_by_zero() {
        let none = SyncProgress { phase: SyncProgressPhase::Indexing, processed: 0, total: 0 };
        assert_eq!(progress_percentage(none), 10);
    }
}
