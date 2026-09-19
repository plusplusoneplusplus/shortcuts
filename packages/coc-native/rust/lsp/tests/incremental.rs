//! Incremental index ownership: what a `textDocument/didSave` does to the store
//! between cold builds.

mod harness;

use harness::{file_uri, index, initialize, request, Server};
use serde_json::json;

/// Waits for the worker's `window/logMessage`, which is sent once per targeted
/// sync — the only point at which the store is guaranteed to have the save in it.
fn reindex_log(server: &mut Server) -> String {
    let message = server.receive_matching(|message| {
        message.get("method") == Some(&json!("window/logMessage"))
            && message["params"]["message"]
                .as_str()
                .is_some_and(|text| text.starts_with("Reindexed"))
    });
    message["params"]["message"].as_str().unwrap().to_string()
}

fn workspace() -> tempfile::TempDir {
    let directory = tempfile::tempdir().unwrap();
    std::fs::write(directory.path().join("edited.c"), "int before(void) { return 0; }\n").unwrap();
    directory
}

#[test]
fn a_save_reindexes_only_the_saved_file() {
    let directory = workspace();
    let root = directory.path();
    let mut server = Server::start(root, &root.join(".index").join("symbol-index.sqlite"));
    initialize(&mut server, root);
    index(&mut server);

    let edited = root.join("edited.c");
    std::fs::write(&edited, "int after(void) { return 1; }\n").unwrap();
    server.send(json!({
        "jsonrpc": "2.0",
        "method": "textDocument/didSave",
        "params": { "textDocument": { "uri": file_uri(&edited) } },
    }));
    let log = reindex_log(&mut server);
    assert!(log.starts_with("Reindexed 1 saved file(s): 1 parsed"), "unexpected log: {log}");

    let symbols = request(
        &mut server,
        20,
        "textDocument/documentSymbol",
        json!({ "textDocument": { "uri": file_uri(&edited) } }),
    );
    let names: Vec<&str> =
        symbols.as_array().unwrap().iter().map(|s| s["name"].as_str().unwrap()).collect();
    assert_eq!(names, vec!["after"], "the stale symbol survived the save");
    server.shutdown(30);
}

#[test]
fn a_deleted_file_loses_its_rows_on_save() {
    let directory = workspace();
    let root = directory.path();
    let mut server = Server::start(root, &root.join(".index").join("symbol-index.sqlite"));
    initialize(&mut server, root);
    index(&mut server);

    let edited = root.join("edited.c");
    std::fs::remove_file(&edited).unwrap();
    server.send(json!({
        "jsonrpc": "2.0",
        "method": "textDocument/didSave",
        "params": { "textDocument": { "uri": file_uri(&edited) } },
    }));
    let log = reindex_log(&mut server);
    assert!(log.contains("1 removed"), "unexpected log: {log}");

    let symbols = request(
        &mut server,
        20,
        "textDocument/documentSymbol",
        json!({ "textDocument": { "uri": file_uri(&edited) } }),
    );
    assert_eq!(symbols, json!([]));
    server.shutdown(30);
}

/// Every save in the editor arrives on this notification, including the ones for
/// files the index would never hold. Those must not reach the worker at all.
#[test]
fn a_save_outside_the_index_does_not_queue_work() {
    let directory = workspace();
    let root = directory.path();
    std::fs::write(root.join("notes.ts"), "export const x = 1;\n").unwrap();
    let mut server = Server::start(root, &root.join(".index").join("symbol-index.sqlite"));
    initialize(&mut server, root);
    index(&mut server);

    for name in ["notes.ts", "edited.c"] {
        server.send(json!({
            "jsonrpc": "2.0",
            "method": "textDocument/didSave",
            "params": { "textDocument": { "uri": file_uri(&root.join(name)) } },
        }));
    }
    // The first log to arrive is the only log: had `notes.ts` been queued it
    // would have produced one of its own ahead of this.
    let log = reindex_log(&mut server);
    assert!(log.starts_with("Reindexed 1 saved file(s)"), "unexpected log: {log}");

    let outside = request(
        &mut server,
        20,
        "textDocument/documentSymbol",
        json!({ "textDocument": { "uri": file_uri(&root.join("notes.ts")) } }),
    );
    assert_eq!(outside, json!([]));
    server.shutdown(30);
}
