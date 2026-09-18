//! Navigation: definition, document symbols and workspace symbols answered out
//! of a real index the server built for itself.

mod harness;

use harness::{file_uri, index, initialize, request, Server};
use serde_json::{json, Value};

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
fn references_list_call_sites_with_and_without_the_declaration() {
    let directory = workspace();
    let root = directory.path();
    let mut server = Server::start(root, &root.join("index.sqlite"));
    initialize(&mut server, root);
    index(&mut server);

    let position = json!({
        "textDocument": { "uri": file_uri(&root.join("src/compute.cpp")) },
        "position": { "line": 0, "character": 4 },
    });
    let mut with_declaration = position.clone();
    with_declaration["context"] = json!({ "includeDeclaration": true });
    let included = request(&mut server, 20, "textDocument/references", with_declaration);
    let locations = included.as_array().expect("an array of locations");
    // The call site in the other translation unit is the point of the exercise.
    assert!(
        locations.iter().any(|location| location["uri"]
            .as_str()
            .unwrap()
            .ends_with("/src/main.cpp")
            && location["range"]["start"] == json!({ "line": 1, "character": 20 })),
        "the cross-TU call site is missing: {included}"
    );
    assert!(
        locations
            .iter()
            .any(|location| location["uri"].as_str().unwrap().ends_with("/src/compute.cpp")),
        "the declaration was asked for: {included}"
    );
    // Each position appears once even though the definition and occurrence
    // tables are queried separately.
    let positions: Vec<Value> = locations
        .iter()
        .map(|location| json!([location["uri"], location["range"]["start"]]))
        .collect();
    let mut unique = positions.clone();
    unique.dedup();
    assert_eq!(unique.len(), positions.len(), "duplicate locations in {included}");

    let mut without_declaration = position;
    without_declaration["context"] = json!({ "includeDeclaration": false });
    let excluded = request(&mut server, 21, "textDocument/references", without_declaration);
    assert!(
        excluded
            .as_array()
            .expect("an array")
            .iter()
            .all(|location| !location["uri"].as_str().unwrap().ends_with("/src/compute.cpp")),
        "the declaration was excluded: {excluded}"
    );

    // A position on nothing is an empty array, never an error.
    let nothing = request(
        &mut server,
        22,
        "textDocument/references",
        json!({
            "textDocument": { "uri": "file:///nowhere/absent.cpp" },
            "position": { "line": 0, "character": 0 },
        }),
    );
    assert_eq!(nothing, json!([]));
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
