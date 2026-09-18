//! Drives the real binary over real pipes. The unit tests cover the pieces;
//! this is the only evidence that the shipped executable speaks the protocol.

use std::io::{BufRead, BufReader, Read, Write};
use std::path::Path;
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};

use serde_json::{json, Value};

struct Server {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
}

impl Server {
    fn start(root: &Path, database: &Path) -> Self {
        let mut child = Command::new(env!("CARGO_BIN_EXE_coc-symbols-lsp"))
            .arg("--stdio")
            .arg("--database")
            .arg(database)
            .current_dir(root)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .expect("binary starts");
        let stdin = child.stdin.take().expect("stdin");
        let stdout = BufReader::new(child.stdout.take().expect("stdout"));
        Self { child, stdin, stdout }
    }

    fn send(&mut self, message: Value) {
        let body = serde_json::to_vec(&message).unwrap();
        write!(self.stdin, "Content-Length: {}\r\n\r\n", body.len()).unwrap();
        self.stdin.write_all(&body).unwrap();
        self.stdin.flush().unwrap();
    }

    fn receive(&mut self) -> Value {
        let mut length = None;
        loop {
            let mut line = String::new();
            let read = self.stdout.read_line(&mut line).expect("header line");
            assert!(read > 0, "server closed the stream mid-handshake");
            let line = line.trim_end_matches(['\r', '\n']).to_string();
            if line.is_empty() {
                break;
            }
            if let Some((name, value)) = line.split_once(':') {
                if name.trim().eq_ignore_ascii_case("content-length") {
                    length = value.trim().parse::<usize>().ok();
                }
            }
        }
        let mut body = vec![0u8; length.expect("Content-Length")];
        self.stdout.read_exact(&mut body).expect("body");
        serde_json::from_slice(&body).expect("json body")
    }

    /// Reads until a message the predicate accepts, so an interleaved
    /// `$/progress` or log never breaks a test waiting on a response.
    fn receive_matching(&mut self, predicate: impl Fn(&Value) -> bool) -> Value {
        for _ in 0..200 {
            let message = self.receive();
            if predicate(&message) {
                return message;
            }
        }
        panic!("no matching message arrived");
    }
}

fn initialize(server: &mut Server, root: &Path) -> Value {
    let root_uri = format!("file://{}", root.to_string_lossy().replace('\\', "/"));
    server.send(json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": { "processId": Value::Null, "rootUri": root_uri, "capabilities": {} },
    }));
    server.receive_matching(|message| message.get("id") == Some(&json!(1)))
}

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
