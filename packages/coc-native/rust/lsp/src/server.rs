//! Lifecycle and dispatch for the symbol-index language server.

use std::collections::HashSet;
use std::io::{BufRead, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use coc_native_core::symbol_index::{
    is_c_family_path, ExtractionLimits, SymbolStore, SyncProgress, SyncProgressPhase,
};
use serde_json::{json, Value};

use crate::framing::read_message;
use crate::fuzzy;
use crate::indexer::Indexer;
use crate::locations::{
    symbol_information, symbol_information_matched, symbol_location, LineCache,
};
use crate::positions::word_at;
use crate::transport::Transport;
use crate::uri::uri_to_path;
use crate::watcher::FileWatcher;

/// Where the index lands when the host did not name a file. The host always
/// does — `coc-symbols` is prepared with `--database` pointing at
/// `getRepoDataPath(dataDir, repoId, 'symbol-index.sqlite')` — so this only
/// covers a hand-run binary.
const DEFAULT_DATABASE_RELATIVE: &str = ".coc-symbols/symbol-index.sqlite";

/// The `$/progress` token for the index build. One token, reused across syncs:
/// the session on the Node side counts begin/end pairs, and a fresh token per
/// sync would only make it harder to see that they balance.
const INDEX_PROGRESS_TOKEN: &str = "coc-symbols/index";

/// How many stored symbols one lookup may answer with. The index is fuzzy by
/// design — every `read` in the tree shares a name — so the cap is what keeps a
/// common token from turning into a list nobody can use, and the store already
/// orders definitions ahead of prototypes.
const DEFINITION_RESULT_LIMIT: usize = 100;

/// `textDocument/references` lists call sites, so it is capped looser than a jump: a reader
/// scrolls a reference list, and truncating a widely called function at a hundred would hide
/// most of what they asked for.
const REFERENCE_RESULT_LIMIT: usize = 500;

/// `workspace/symbol` is a palette query. It is capped harder than a
/// definition: the caller is typing and only ever reads the top. The cap is
/// applied AFTER ranking — capping the SQL would hand the scorer an arbitrary
/// slice of the table and silently drop the best matches.
const WORKSPACE_SYMBOL_LIMIT: usize = 200;

/// How many rows the fuzzy pass may pull out of SQLite before ranking. Large
/// enough that the best match is almost always inside it, small enough that a
/// one-letter query on a 30M-line repository does not serialise the index.
const WORKSPACE_SYMBOL_CANDIDATES: usize = 2_000;

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
    /// Serial re-index queue for saved files. Present whenever a store opened.
    indexer: Option<Indexer>,
    /// Kept alive for the session; dropping it stops the recursive watch.
    watcher: Option<FileWatcher>,
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
        indexer: None,
        watcher: None,
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
            "textDocument/definition" => {
                let result = self.definition(&params);
                self.transport.respond(id, result);
            }
            "textDocument/references" => {
                let result = self.references(&params);
                self.transport.respond(id, result);
            }
            "textDocument/documentSymbol" => {
                let result = self.document_symbol(&params);
                self.transport.respond(id, result);
            }
            "workspace/symbol" => {
                let result = self.workspace_symbol(&params);
                self.transport.respond(id, result);
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

    fn handle_notification(&mut self, method: &str, message: &Value) -> Flow {
        match method {
            "initialized" => {
                self.start_index_build();
                Flow::Continue
            }
            "textDocument/didSave" => {
                self.reindex_saved_document(message.get("params").unwrap_or(&Value::Null));
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
            Some(Ok(store)) => {
                let store = Arc::new(store);
                if let Some(root) = self.root.clone() {
                    let indexer =
                        Indexer::start(root.clone(), store.clone(), self.transport.clone());
                    // The watcher shares the indexer's queue, so a change the
                    // editor also reported as a save is parsed once. It starts
                    // here rather than at `initialized` so nothing written
                    // between the two is missed.
                    self.watcher =
                        crate::watcher::start(root, indexer.queue(), self.transport.clone());
                    self.indexer = Some(indexer);
                }
                self.store = Some(store);
            }
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
                    "definitionProvider": true,
                    "referencesProvider": true,
                    "documentSymbolProvider": true,
                    "workspaceSymbolProvider": true,
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

    /// `textDocument/definition` — the identifier under the cursor, looked up
    /// by name.
    ///
    /// The buffer is read from disk rather than from a synced copy: the index
    /// itself only ever sees saved files, so answering an unsaved edit out of
    /// an in-memory buffer would point at symbols this store has never indexed.
    /// An empty array, not `null`, is the answer to everything it cannot
    /// resolve — Monaco treats the two alike and the array keeps one shape.
    fn definition(&self, params: &Value) -> Value {
        let (Some(store), Some(root)) = (self.store.as_ref(), self.root.as_ref()) else {
            return json!([]);
        };
        let Some(word) = self.word_under_cursor(params) else {
            return json!([]);
        };
        let Ok(symbols) = store.search(&word, false, DEFINITION_RESULT_LIMIT) else {
            return json!([]);
        };
        let mut cache = LineCache::new();
        Value::Array(
            symbols.iter().map(|symbol| symbol_location(&mut cache, root, symbol)).collect(),
        )
    }

    /// `textDocument/references` — the filtered occurrences of the identifier under the cursor.
    ///
    /// The store keeps call sites and type usages, matched on the bare name, so this is fuzzy in
    /// exactly the way definition lookup is. `context.includeDeclaration` defaults to true per
    /// the specification, and the declarations come from the definition table; positions that
    /// appear in both tables are emitted once.
    fn references(&self, params: &Value) -> Value {
        let (Some(store), Some(root)) = (self.store.as_ref(), self.root.as_ref()) else {
            return json!([]);
        };
        let Some(word) = self.word_under_cursor(params) else {
            return json!([]);
        };
        let include_declaration = params
            .get("context")
            .and_then(|context| context.get("includeDeclaration"))
            .and_then(Value::as_bool)
            .unwrap_or(true);
        let declarations = if include_declaration {
            store.search(&word, false, DEFINITION_RESULT_LIMIT).unwrap_or_default()
        } else {
            Vec::new()
        };
        let Ok(occurrences) = store.occurrences(&word, REFERENCE_RESULT_LIMIT) else {
            return json!([]);
        };
        let mut seen = HashSet::new();
        let mut cache = LineCache::new();
        Value::Array(
            declarations
                .iter()
                .chain(occurrences.iter())
                .filter(|symbol| seen.insert((symbol.path.clone(), symbol.line, symbol.column)))
                .map(|symbol| symbol_location(&mut cache, root, symbol))
                .collect(),
        )
    }

    /// `textDocument/didSave` — queue the saved file for a targeted re-index.
    ///
    /// The store is keyed on repository-relative paths, so a document outside the root has no
    /// row to update and is ignored rather than guessed at. Non-C-family saves are dropped here
    /// instead of in the store: every save in the editor arrives on this notification, and
    /// handing the worker a `.ts` file only to have it decide there is nothing to parse would
    /// wake the queue on every keystroke-adjacent write in the tree.
    fn reindex_saved_document(&self, params: &Value) {
        let (Some(indexer), Some(root)) = (self.indexer.as_ref(), self.root.as_ref()) else {
            return;
        };
        let Some(relative) = document_path(params).and_then(|path| relative_path(root, &path))
        else {
            return;
        };
        if !is_c_family_path(&relative) {
            return;
        }
        indexer.submit(relative);
    }

    /// The identifier at a request's position, read from disk for the reason [`Self::definition`]
    /// documents.
    fn word_under_cursor(&self, params: &Value) -> Option<String> {
        let path = document_path(params)?;
        let (line, character) = document_position(params)?;
        let source = std::fs::read_to_string(&path).ok()?;
        word_at(&source, line, character)
    }

    /// `textDocument/documentSymbol` — everything the index stored for one file.
    fn document_symbol(&self, params: &Value) -> Value {
        let (Some(store), Some(root)) = (self.store.as_ref(), self.root.as_ref()) else {
            return json!([]);
        };
        let Some(relative) = document_path(params).and_then(|path| relative_path(root, &path))
        else {
            return json!([]);
        };
        let Ok(symbols) = store.symbols_for_file(&relative) else {
            return json!([]);
        };
        let mut cache = LineCache::new();
        Value::Array(
            symbols.iter().map(|symbol| symbol_information(&mut cache, root, symbol)).collect(),
        )
    }

    /// `workspace/symbol` — a camel-case-aware query across the whole index.
    ///
    /// Two sources feed one ranking. The prefix index is the fast path and
    /// still wins on score; the `LIKE` pass adds the subsequence matches a
    /// prefix cannot see (`fwc` → `findWorkspaceConfig`). Both are merged,
    /// deduplicated on their location, scored, and only then truncated.
    fn workspace_symbol(&self, params: &Value) -> Value {
        let (Some(store), Some(root)) = (self.store.as_ref(), self.root.as_ref()) else {
            return json!([]);
        };
        let query = params.get("query").and_then(Value::as_str).unwrap_or("");
        // An empty query means "everything", and answering it would serialise
        // millions of rows on the design-target repository. Clients send it
        // when a palette first opens; nothing is the right answer.
        if query.is_empty() {
            return json!([]);
        }
        let Ok(prefixed) = store.search(query, true, WORKSPACE_SYMBOL_LIMIT) else {
            return json!([]);
        };
        let fuzzy_matches =
            store.search_subsequence(query, WORKSPACE_SYMBOL_CANDIDATES).unwrap_or_default();

        let mut seen = HashSet::new();
        let mut ranked: Vec<(i32, Vec<u32>, _)> = prefixed
            .into_iter()
            .chain(fuzzy_matches)
            .filter(|symbol| {
                seen.insert((symbol.path.clone(), symbol.line, symbol.column, symbol.name.clone()))
            })
            .filter_map(|symbol| {
                let matched = fuzzy::score(query, &symbol.name)?;
                Some((matched.score, matched.indices, symbol))
            })
            .collect();
        ranked.sort_by(|a, b| {
            b.0.cmp(&a.0)
                .then_with(|| a.2.name.cmp(&b.2.name))
                .then_with(|| a.2.path.cmp(&b.2.path))
                .then_with(|| a.2.line.cmp(&b.2.line))
                .then_with(|| a.2.column.cmp(&b.2.column))
        });
        ranked.truncate(WORKSPACE_SYMBOL_LIMIT);

        let mut cache = LineCache::new();
        Value::Array(
            ranked
                .iter()
                .map(|(_, indices, symbol)| {
                    symbol_information_matched(&mut cache, root, symbol, indices)
                })
                .collect(),
        )
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

/// The host path of `params.textDocument.uri`, for a `file://` URI only.
fn document_path(params: &Value) -> Option<PathBuf> {
    params.get("textDocument")?.get("uri")?.as_str().and_then(uri_to_path)
}

/// The zero-based line and UTF-16 character of `params.position`.
fn document_position(params: &Value) -> Option<(u32, u32)> {
    let position = params.get("position")?;
    let line = position.get("line")?.as_u64()?;
    let character = position.get("character")?.as_u64()?;
    Some((u32::try_from(line).ok()?, u32::try_from(character).ok()?))
}

/// The index keys files by repository-relative, forward-slashed path. A
/// document outside the root has no such key, and gets no answer rather than a
/// path that would collide with an unrelated file inside it.
fn relative_path(root: &Path, path: &Path) -> Option<String> {
    let relative = path.strip_prefix(root).ok()?;
    let text = relative.to_string_lossy().replace('\\', "/");
    if text.is_empty() {
        None
    } else {
        Some(text)
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
