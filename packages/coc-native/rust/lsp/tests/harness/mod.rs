//! A real `coc-symbols-lsp` child process over real pipes, shared by the
//! integration tests. The unit tests cover the pieces; these are the only
//! evidence that the shipped executable speaks the protocol.

// Each integration test binary compiles this module separately, so whatever
// one of them does not use looks dead from inside that binary.
#![allow(dead_code)]

use std::io::{BufRead, BufReader, Read, Write};
use std::path::Path;
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};

use serde_json::{json, Value};

pub struct Server {
    pub child: Child,
    pub stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
}

impl Server {
    pub fn start(root: &Path, database: &Path) -> Self {
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

    pub fn send(&mut self, message: Value) {
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

    /// Ends the session the way a well-behaved client does, and checks the
    /// server agreed it was clean. Tests that do not call this leave the child
    /// running until its stdin closes, which reports an abnormal exit.
    pub fn shutdown(&mut self, id: i64) {
        self.send(json!({ "jsonrpc": "2.0", "id": id, "method": "shutdown" }));
        self.receive_matching(|message| message.get("id") == Some(&json!(id)));
        self.send(json!({ "jsonrpc": "2.0", "method": "exit" }));
        assert_eq!(self.child.wait().expect("the server exits").code(), Some(0));
    }

    /// Reads until a message the predicate accepts, so an interleaved
    /// `$/progress` or log never breaks a test waiting on a response.
    pub fn receive_matching(&mut self, predicate: impl Fn(&Value) -> bool) -> Value {
        for _ in 0..200 {
            let message = self.receive();
            if predicate(&message) {
                return message;
            }
        }
        panic!("no matching message arrived");
    }
}

pub fn initialize(server: &mut Server, root: &Path) -> Value {
    let root_uri = format!("file://{}", root.to_string_lossy().replace('\\', "/"));
    server.send(json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": { "processId": Value::Null, "rootUri": root_uri, "capabilities": {} },
    }));
    server.receive_matching(|message| message.get("id") == Some(&json!(1)))
}
