//! Lifecycle: the handshake, the index-build progress, and the exit codes.

mod harness;

use harness::{initialize, Server};
use serde_json::{json, Value};

#[test]
fn completes_the_lifecycle_and_reports_index_progress() {
    let workspace = tempfile::tempdir().unwrap();
    let root = workspace.path().join("repo");
    std::fs::create_dir_all(&root).unwrap();
    std::fs::write(root.join("a.cpp"), "int answer() { return 42; }\n").unwrap();
    let database = workspace.path().join("data").join("symbol-index.sqlite");

    let mut server = Server::start(&root, &database);
    let response = initialize(&mut server, &root);
    assert_eq!(response["result"]["serverInfo"]["name"], json!("coc-symbols"));
    assert_eq!(response["result"]["capabilities"]["textDocumentSync"]["openClose"], json!(true));

    server.send(json!({ "jsonrpc": "2.0", "method": "initialized", "params": {} }));

    let begin = server.receive_matching(|message| {
        message.get("method") == Some(&json!("$/progress"))
            && message["params"]["value"]["kind"] == json!("begin")
    });
    assert_eq!(begin["params"]["token"], json!("coc-symbols/index"));
    let end = server.receive_matching(|message| {
        message.get("method") == Some(&json!("$/progress"))
            && message["params"]["value"]["kind"] == json!("end")
    });
    assert!(
        end["params"]["value"]["message"].as_str().unwrap().contains("Indexed"),
        "unexpected end message: {end}"
    );
    assert!(database.exists(), "the index file is created under the path the host named");

    server.send(json!({ "jsonrpc": "2.0", "id": 2, "method": "shutdown" }));
    let shutdown = server.receive_matching(|message| message.get("id") == Some(&json!(2)));
    assert_eq!(shutdown["result"], Value::Null);

    server.send(json!({ "jsonrpc": "2.0", "method": "exit" }));
    let status = server.child.wait().expect("the server exits");
    assert_eq!(status.code(), Some(0), "exit after shutdown is a clean exit");
}

#[test]
fn exit_without_shutdown_is_an_error_exit() {
    let workspace = tempfile::tempdir().unwrap();
    let database = workspace.path().join("symbol-index.sqlite");
    let mut server = Server::start(workspace.path(), &database);
    initialize(&mut server, workspace.path());
    server.send(json!({ "jsonrpc": "2.0", "method": "exit" }));
    let status = server.child.wait().expect("the server exits");
    assert_eq!(status.code(), Some(1));
}

#[test]
fn answers_an_unsupported_request_with_method_not_found() {
    let workspace = tempfile::tempdir().unwrap();
    let database = workspace.path().join("symbol-index.sqlite");
    let mut server = Server::start(workspace.path(), &database);
    initialize(&mut server, workspace.path());
    server.send(json!({
        "jsonrpc": "2.0",
        "id": 7,
        "method": "textDocument/hover",
        "params": {},
    }));
    let response = server.receive_matching(|message| message.get("id") == Some(&json!(7)));
    assert_eq!(response["error"]["code"], json!(-32601));

    server.send(json!({ "jsonrpc": "2.0", "id": 8, "method": "shutdown" }));
    server.receive_matching(|message| message.get("id") == Some(&json!(8)));
    server.send(json!({ "jsonrpc": "2.0", "method": "exit" }));
    assert_eq!(server.child.wait().unwrap().code(), Some(0));
}

#[test]
fn a_request_before_initialize_is_refused() {
    let workspace = tempfile::tempdir().unwrap();
    let database = workspace.path().join("symbol-index.sqlite");
    let mut server = Server::start(workspace.path(), &database);
    server.send(json!({
        "jsonrpc": "2.0",
        "id": 3,
        "method": "textDocument/definition",
        "params": {},
    }));
    let response = server.receive_matching(|message| message.get("id") == Some(&json!(3)));
    assert_eq!(response["error"]["code"], json!(-32002));
    drop(server.stdin);
    server.child.wait().unwrap();
}
