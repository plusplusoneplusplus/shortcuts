//! Index ownership for changes CoC never saw: a branch switch, a `git pull`, a
//! file written by another tool. No `didSave` arrives for any of them, so the
//! filesystem watcher is the only thing that keeps the store honest.

mod harness;

use harness::{file_uri, index, initialize, request, Server};
use serde_json::json;

/// The worker logs once per targeted sync, which is the only moment the store
/// is guaranteed to hold the change.
fn reindex_log(server: &mut Server) -> String {
    let message = server.receive_matching(|message| {
        message.get("method") == Some(&json!("window/logMessage"))
            && message["params"]["message"]
                .as_str()
                .is_some_and(|text| text.starts_with("Reindexed"))
    });
    message["params"]["message"].as_str().unwrap().to_string()
}

fn symbol_names(server: &mut Server, id: i64, path: &std::path::Path) -> Vec<String> {
    let symbols = request(
        server,
        id,
        "textDocument/documentSymbol",
        json!({ "textDocument": { "uri": file_uri(path) } }),
    );
    symbols
        .as_array()
        .unwrap()
        .iter()
        .map(|symbol| symbol["name"].as_str().unwrap().to_string())
        .collect()
}

#[test]
fn a_file_written_behind_the_editor_is_indexed() {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path();
    std::fs::write(root.join("existing.c"), "int existing(void) { return 0; }\n").unwrap();
    let mut server = Server::start(root, &root.join(".index").join("symbol-index.sqlite"));
    initialize(&mut server, root);
    index(&mut server);

    // No `textDocument/didSave` follows: this is what a `git pull` looks like
    // from inside the server.
    let pulled = root.join("pulled.c");
    std::fs::write(&pulled, "int pulled_in(void) { return 7; }\n").unwrap();
    let log = reindex_log(&mut server);
    assert!(log.contains("1 parsed"), "unexpected log: {log}");
    assert_eq!(symbol_names(&mut server, 20, &pulled), vec!["pulled_in".to_string()]);

    // And a deletion behind the editor's back drops the rows again.
    std::fs::remove_file(&pulled).unwrap();
    let log = reindex_log(&mut server);
    assert!(log.contains("1 removed"), "unexpected log: {log}");
    assert!(symbol_names(&mut server, 21, &pulled).is_empty(), "the deleted file kept its rows");
    server.shutdown(30);
}

/// Generated sources under an ignored build directory churn constantly and are
/// not part of the file set the cold build indexes. Queueing them would both
/// waste the worker and leave rows the next full sync deletes.
#[test]
fn an_ignored_file_never_reaches_the_queue() {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path();
    std::fs::write(root.join(".gitignore"), "build/\n").unwrap();
    std::fs::create_dir_all(root.join("build")).unwrap();
    std::fs::write(root.join("existing.c"), "int existing(void) { return 0; }\n").unwrap();
    let mut server = Server::start(root, &root.join(".index").join("symbol-index.sqlite"));
    initialize(&mut server, root);
    index(&mut server);

    let generated = root.join("build").join("generated.c");
    std::fs::write(&generated, "int generated_symbol(void) { return 1; }\n").unwrap();
    let tracked = root.join("tracked.c");
    std::fs::write(&tracked, "int tracked_symbol(void) { return 2; }\n").unwrap();

    // The first log is the only log: had the generated file been queued it
    // would have produced one ahead of this one.
    let log = reindex_log(&mut server);
    assert!(log.starts_with("Reindexed 1 saved file(s)"), "unexpected log: {log}");
    assert_eq!(symbol_names(&mut server, 20, &tracked), vec!["tracked_symbol".to_string()]);
    assert!(symbol_names(&mut server, 21, &generated).is_empty(), "an ignored file was indexed");
    server.shutdown(30);
}
