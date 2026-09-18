//! Navigation: definition, document symbols and workspace symbols answered out
//! of a real index the server built for itself.

mod harness;

use std::path::Path;

use harness::{initialize, Server};
use serde_json::{json, Value};

/// Sends `initialized` and waits for the index build to finish, so the queries
/// that follow run against a populated store rather than racing it.
fn index(server: &mut Server) {
    server.send(json!({ "jsonrpc": "2.0", "method": "initialized", "params": {} }));
    server.receive_matching(|message| {
        message.get("method") == Some(&json!("$/progress"))
            && message["params"]["value"]["kind"] == json!("end")
    });
}

fn request(server: &mut Server, id: i64, method: &str, params: Value) -> Value {
    server.send(json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params }));
    let response = server.receive_matching(|message| message.get("id") == Some(&json!(id)));
    response["result"].clone()
}

fn file_uri(path: &Path) -> String {
    format!("file://{}", path.to_string_lossy().replace('\\', "/"))
}

/// A tiny two-file repository: the definition of `compute` lives in one
/// translation unit and the call site in another, which is the cross-TU case
/// the index exists to answer.
fn workspace() -> tempfile::TempDir {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path();
    std::fs::create_dir_all(root.join("src")).unwrap();
    std::fs::write(root.join("src/compute.cpp"), "int compute(int value) { return value * 2; }\n")
        .unwrap();
    std::fs::write(
        root.join("src/main.cpp"),
        "int compute(int value);\nint main() { return compute(21); }\n",
    )
    .unwrap();
    directory
}

#[test]
fn a_definition_crosses_translation_units() {
    let directory = workspace();
    let root = directory.path();
    let database = root.join(".index").join("symbol-index.sqlite");
    let mut server = Server::start(root, &database);
    initialize(&mut server, root);
    index(&mut server);

    // Line 1, character 22: inside `compute` in `return compute(21);`.
    let result = request(
        &mut server,
        10,
        "textDocument/definition",
        json!({
            "textDocument": { "uri": file_uri(&root.join("src/main.cpp")) },
            "position": { "line": 1, "character": 22 },
        }),
    );
    let locations = result.as_array().expect("an array of locations");
    assert!(!locations.is_empty(), "the index answers the call site: {result}");
    // The definition outranks the prototype, so it is first.
    assert!(
        locations[0]["uri"].as_str().unwrap().ends_with("/src/compute.cpp"),
        "unexpected first location: {}",
        locations[0]
    );
    assert_eq!(locations[0]["range"]["start"], json!({ "line": 0, "character": 4 }));
    assert_eq!(locations[0]["range"]["end"], json!({ "line": 0, "character": 11 }));
    // The prototype in the other file is still offered, as a second candidate.
    assert!(locations
        .iter()
        .any(|location| location["uri"].as_str().unwrap().ends_with("/src/main.cpp")));
    server.shutdown(99);
}

#[test]
fn a_position_on_nothing_answers_an_empty_array() {
    let directory = workspace();
    let root = directory.path();
    let mut server = Server::start(root, &root.join("index.sqlite"));
    initialize(&mut server, root);
    index(&mut server);

    let whitespace = request(
        &mut server,
        11,
        "textDocument/definition",
        json!({
            "textDocument": { "uri": file_uri(&root.join("src/main.cpp")) },
            "position": { "line": 1, "character": 3 },
        }),
    );
    assert_eq!(whitespace, json!([]));

    let outside = request(
        &mut server,
        12,
        "textDocument/definition",
        json!({
            "textDocument": { "uri": "file:///nowhere/absent.cpp" },
            "position": { "line": 0, "character": 0 },
        }),
    );
    assert_eq!(outside, json!([]));
    server.shutdown(99);
}

#[test]
fn document_symbols_come_back_flat_with_locations() {
    let directory = workspace();
    let root = directory.path();
    let mut server = Server::start(root, &root.join("index.sqlite"));
    initialize(&mut server, root);
    index(&mut server);

    let result = request(
        &mut server,
        13,
        "textDocument/documentSymbol",
        json!({ "textDocument": { "uri": file_uri(&root.join("src/compute.cpp")) } }),
    );
    let symbols = result.as_array().expect("an array of symbols");
    let compute = symbols
        .iter()
        .find(|symbol| symbol["name"] == json!("compute"))
        .unwrap_or_else(|| panic!("no `compute` in {result}"));
    assert_eq!(compute["kind"], json!(12));
    assert!(compute["location"]["uri"].as_str().unwrap().ends_with("/src/compute.cpp"));
    assert_eq!(compute["location"]["range"]["start"]["line"], json!(0));

    // A document the index never saw is not an error, just an empty outline.
    let unknown = request(
        &mut server,
        14,
        "textDocument/documentSymbol",
        json!({ "textDocument": { "uri": "file:///elsewhere/other.cpp" } }),
    );
    assert_eq!(unknown, json!([]));
    server.shutdown(99);
}

#[test]
fn a_workspace_query_matches_a_prefix_and_an_empty_one_matches_nothing() {
    let directory = workspace();
    let root = directory.path();
    let mut server = Server::start(root, &root.join("index.sqlite"));
    initialize(&mut server, root);
    index(&mut server);

    let matched = request(&mut server, 15, "workspace/symbol", json!({ "query": "comp" }));
    let symbols = matched.as_array().expect("an array of symbols");
    assert!(
        symbols.iter().all(|symbol| symbol["name"].as_str().unwrap().starts_with("comp")),
        "a prefix query answered with something else: {matched}"
    );
    assert!(!symbols.is_empty(), "`comp` matches `compute`: {matched}");

    assert_eq!(request(&mut server, 16, "workspace/symbol", json!({ "query": "" })), json!([]));
    assert_eq!(request(&mut server, 17, "workspace/symbol", json!({})), json!([]));
    server.shutdown(99);
}
