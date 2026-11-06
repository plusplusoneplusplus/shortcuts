#![cfg(all(target_os = "windows", target_arch = "x86_64"))]

use serde_json::{json, Value};
use std::{
    collections::VecDeque,
    fs,
    io::{BufRead, BufReader, Read, Write},
    net::TcpListener,
    path::PathBuf,
    process::{Child, ChildStdin, Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc,
    },
    thread,
    time::{Duration, Instant},
};
use windows::{
    core::w,
    Win32::{
        Foundation::{HWND, POINT},
        Graphics::Gdi::ClientToScreen,
        System::Com::CoCreateGuid,
        UI::WindowsAndMessaging::*,
    },
};

struct Fixture {
    child: Child,
    input: ChildStdin,
    events: mpsc::Receiver<Value>,
    backlog: VecDeque<Value>,
    root: PathBuf,
    window: HWND,
    address: String,
    stop: Arc<AtomicBool>,
    server: Option<thread::JoinHandle<()>>,
    next_id: u64,
    timeout: Duration,
}

impl Fixture {
    fn new() -> Self {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).parent().unwrap().join("target").join(
            format!(
                "webview2-download-fixture-{:032x}",
                unsafe { CoCreateGuid().unwrap() }.to_u128()
            ),
        );
        fs::create_dir_all(&root).unwrap();
        let window = unsafe {
            CreateWindowExW(
                Default::default(),
                w!("STATIC"),
                w!("Native download fixture"),
                WS_OVERLAPPEDWINDOW,
                0,
                0,
                640,
                480,
                None,
                None,
                None,
                None,
            )
            .unwrap()
        };
        let mut origin = POINT::default();
        unsafe {
            let _ = ShowWindow(window, SW_SHOWNOACTIVATE);
            ClientToScreen(window, &mut origin).ok().unwrap();
        }
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = format!("http://{}", listener.local_addr().unwrap());
        listener.set_nonblocking(true).unwrap();
        let stop = Arc::new(AtomicBool::new(false));
        let stopped = stop.clone();
        let server = thread::spawn(move || {
            let mut connections = Vec::new();
            while !stopped.load(Ordering::Relaxed) {
                match listener.accept() {
                    Ok((mut socket, _)) => connections.push(thread::spawn(move || {
                        socket.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
                        let mut request = [0u8; 8192];
                        let Ok(count) = socket.read(&mut request) else { return };
                        let request = String::from_utf8_lossy(&request[..count]);
                        let path = request.split_whitespace().nth(1).unwrap_or("/");
                        let (mime, disposition, body, slow) = match path {
                            "/file" =>                             ("text/plain", "Content-Disposition: attachment; filename=fixture.txt\r\n", vec![42; 32768], false),
                            "/slow" => ("text/plain", "Content-Disposition: attachment; filename=slow.txt\r\n", vec![b's'; 2 * 1024 * 1024], true),
                            "/blob" => ("text/html", "", br#"<script>setTimeout(()=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob(['timestamp,m1,m2,m3,m4,m5,m6,m7,m8\n0,1,2,3,4,5,6,7,8\n'],{type:'text/csv'}));a.download='blob.csv';a.click()},150)</script>"#.to_vec(), false),
                            _ => ("text/html", "", b"<title>Fixture</title>".to_vec(), false),
                        };
                        let offset = request.lines().find_map(|line| {
                            line.to_ascii_lowercase().strip_prefix("range: bytes=")
                                .and_then(|range| range.split('-').next())
                                .and_then(|start| start.parse::<usize>().ok())
                        }).unwrap_or(0).min(body.len());
                        let status = if offset == 0 { "200 OK" } else { "206 Partial Content" };
                        let range = if offset == 0 { String::new() } else {
                            format!("Content-Range: bytes {}-{}/{}\r\n", offset, body.len() - 1, body.len())
                        };
                        let headers = format!("HTTP/1.1 {status}\r\nContent-Type: {mime}\r\n{disposition}{range}Accept-Ranges: bytes\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len() - offset);
                        if socket.write_all(headers.as_bytes()).is_err() { return; }
                        for chunk in body[offset..].chunks(16384) {
                            if socket.write_all(chunk).is_err() { break; }
                            if slow { thread::sleep(Duration::from_millis(40)); }
                        }
                    })),
                    Err(_) => thread::sleep(Duration::from_millis(10)),
                }
            }
            for connection in connections {
                let _ = connection.join();
            }
        });
        let mut child = Command::new(env!("CARGO_BIN_EXE_coc-webview2"))
            .arg(root.join("profile"))
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .unwrap();
        let input = child.stdin.take().unwrap();
        let output = child.stdout.take().unwrap();
        let (tx, events) = mpsc::channel();
        thread::spawn(move || {
            for line in BufReader::new(output).lines().map_while(Result::ok) {
                if let Ok(event) = serde_json::from_str(&line) {
                    if tx.send(event).is_err() {
                        break;
                    }
                }
            }
        });
        let mut fixture = Self {
            child,
            input,
            events,
            backlog: VecDeque::new(),
            root,
            window,
            address,
            stop,
            server: Some(server),
            next_id: 1,
            timeout: Duration::from_secs(30),
        };
        fixture.wait(|event| event["event"] == "ready");
        let command = json!({
            "op": "open", "viewId": "root", "parent": (window.0 as usize).to_string(),
            "url": format!("{}/", fixture.address),
            "bounds": { "x": 0, "y": 0, "width": 640, "height": 480,
                "contentOrigin": { "x": origin.x, "y": origin.y } },
        });
        assert_eq!(fixture.request(command)["ok"], true);
        fixture
    }

    fn send(&mut self, mut command: Value) -> u64 {
        let id = self.next_id;
        self.next_id += 1;
        command["id"] = json!(id);
        writeln!(self.input, "{command}").unwrap();
        self.input.flush().unwrap();
        id
    }

    fn request(&mut self, command: Value) -> Value {
        let id = self.send(command);
        self.wait(|event| event["id"] == id)
    }

    #[track_caller]
    fn wait(&mut self, predicate: impl Fn(&Value) -> bool) -> Value {
        if let Some(index) = self.backlog.iter().position(&predicate) {
            return self.backlog.remove(index).unwrap();
        }
        let deadline = Instant::now() + self.timeout;
        loop {
            unsafe {
                let mut message = MSG::default();
                while PeekMessageW(&mut message, None, 0, 0, PM_REMOVE).as_bool() {
                    let _ = TranslateMessage(&message);
                    DispatchMessageW(&message);
                }
            }
            match self.events.recv_timeout(Duration::from_millis(10)) {
                Ok(event) if predicate(&event) => return event,
                Ok(event) => {
                    self.backlog.push_back(event);
                }
                Err(mpsc::RecvTimeoutError::Timeout) if Instant::now() < deadline => {}
                result => panic!("Native fixture event timed out or disconnected: {result:?}; events: {:?}", self.backlog.iter().map(|event| json!({
                    "event": event["event"], "id": event["id"], "ok": event["ok"],
                    "state": event["state"].as_str(), "reason": event["reason"],
                    "message": event["message"], "received": event["received"], "final": event["final"]
                    , "document": event["state"]["url"].as_str().and_then(|url| url.rsplit('/').next()),
                    "loading": event["state"]["loading"]
                })).collect::<Vec<_>>()),
            }
        }
    }

    fn download(&mut self, path: &str) -> Value {
        assert_eq!(
            self.request(json!({
                "op": "navigate", "viewId": "root", "url": format!("{}{path}", self.address)
            }))["ok"],
            true
        );
        self.wait(|event| event["event"] == "download")
    }

    fn decide(&mut self, transfer: &Value, owner: &str, filename: &str) -> Value {
        self.request(json!({
            "op": "download-decide", "viewId": owner, "downloadId": transfer["downloadId"],
            "action": "approve", "destination": self.root.join(filename).to_str().unwrap()
        }))
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = writeln!(self.input, "{{\"id\":99999,\"op\":\"quit\"}}");
        let _ = self.input.flush();
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            unsafe {
                let mut message = MSG::default();
                while PeekMessageW(&mut message, None, 0, 0, PM_REMOVE).as_bool() {
                    let _ = TranslateMessage(&message);
                    DispatchMessageW(&message);
                }
            }
            if self.child.try_wait().ok().flatten().is_some() {
                break;
            }
            if Instant::now() >= deadline {
                let _ = self.child.kill();
                let _ = self.child.wait();
                break;
            }
            thread::sleep(Duration::from_millis(20));
        }
        self.stop.store(true, Ordering::Relaxed);
        if let Some(server) = self.server.take() {
            let _ = server.join();
        }
        unsafe {
            let _ = DestroyWindow(self.window);
        }
        let deadline = Instant::now() + Duration::from_secs(5);
        while fs::remove_dir_all(&self.root).is_err()
            && self.root.exists()
            && Instant::now() < deadline
        {
            thread::sleep(Duration::from_millis(50));
        }
    }
}

#[test]
#[ignore = "Requires the installed WebView2 runtime and an interactive Windows desktop"]
fn original_native_downloads_are_owner_bound_one_time_and_outlive_tabs() {
    let mut fixture = Fixture::new();
    let transfer = fixture.download("/file");
    assert_eq!(transfer["viewId"], "root");
    assert_eq!(transfer["filename"], "fixture.txt");
    let download_id = transfer["downloadId"].as_str().unwrap();
    assert_eq!(download_id.len(), 36);
    assert_eq!(download_id.split('-').map(str::len).collect::<Vec<_>>(), [8, 4, 4, 4, 12]);
    assert!(download_id.bytes().all(|byte| byte.is_ascii_hexdigit() || byte == b'-'));
    assert!(!fixture.root.join("approved.txt").exists());
    assert_eq!(
        fixture.request(json!({
            "op": "download-decide", "viewId": "root",
            "downloadId": "00000000-0000-0000-0000-000000000000",
            "action": "approve", "destination": fixture.root.join("forged.txt").to_str().unwrap()
        }))["ok"],
        false
    );
    assert!(!fixture.root.join("forged.txt").exists());
    assert_eq!(fixture.decide(&transfer, "wrong-owner", "approved.txt")["ok"], false);
    let approval = fixture.send(json!({
        "op": "download-decide", "viewId": "root", "downloadId": transfer["downloadId"],
        "action": "approve", "destination": fixture.root.join("approved.txt").to_str().unwrap()
    }));
    // Progress can arrive before the approval acknowledgement.
    let complete = fixture
        .wait(|event| event["downloadId"] == transfer["downloadId"] && event["final"] == true);
    assert_eq!(complete["state"], "completed");
    assert_eq!(complete["received"], 32768);
    assert!(complete.get("destination").is_none());
    assert_eq!(fs::read(fixture.root.join("approved.txt")).unwrap(), vec![42; 32768]);
    assert_eq!(fixture.decide(&transfer, "root", "again.bin")["ok"], false);
    let _ = approval;

    let transfer = fixture.download("/blob");
    assert!(transfer["url"].as_str().unwrap().starts_with("blob:"));
    assert_eq!(transfer["filename"], "blob.csv");
    for (owner, action) in [("wrong-owner", "cancel"), ("root", "pause"), ("root", "resume")] {
        assert_eq!(
            fixture.request(json!({
                "op": "download-action", "viewId": owner,
                "downloadId": transfer["downloadId"], "action": action
            }))["ok"],
            false
        );
    }
    assert_eq!(fixture.request(json!({
        "op": "download-action", "viewId": "root", "downloadId": transfer["downloadId"], "action": "cancel"
    }))["ok"], true);
    assert_eq!(
        fixture
            .wait(|event| event["downloadId"] == transfer["downloadId"] && event["final"] == true)
            ["state"],
        "cancelled"
    );
    // Cancel emits terminal before its command acknowledgement; stale approval is rejected.
    assert_eq!(fixture.decide(&transfer, "root", "cancelled.txt")["ok"], false);
    assert!(!fixture.root.join("cancelled.txt").exists());

    let transfer = fixture.download("/blob");
    fixture.send(json!({
        "op": "download-decide", "viewId": "root", "downloadId": transfer["downloadId"],
        "action": "approve", "destination": fixture.root.join("blob.csv").to_str().unwrap()
    }));
    assert_eq!(
        fixture
            .wait(|event| event["downloadId"] == transfer["downloadId"] && event["final"] == true)
            ["state"],
        "completed"
    );
    assert_eq!(
        fs::read(fixture.root.join("blob.csv")).unwrap(),
        b"timestamp,m1,m2,m3,m4,m5,m6,m7,m8\n0,1,2,3,4,5,6,7,8\n"
    );

    let pending = fixture.download("/file");
    fixture
        .send(json!({"op": "navigate", "viewId": "root", "url": format!("{}/", fixture.address)}));
    assert_eq!(
        fixture
            .wait(|event| event["downloadId"] == pending["downloadId"] && event["final"] == true)
            ["state"],
        "cancelled"
    );
    assert_eq!(fixture.decide(&pending, "root", "navigated.bin")["ok"], false);

    let transfer = fixture.download("/slow");
    assert_eq!(fixture.decide(&transfer, "root", "retained.txt")["ok"], true);
    let closed = fixture.request(json!({"op": "close", "viewId": "root"}));
    assert_eq!(closed["ok"], true, "{closed}");
    // Destroy the original parent too: the hidden controller must have detached.
    unsafe {
        DestroyWindow(fixture.window).unwrap();
    }
    let complete = fixture
        .wait(|event| event["downloadId"] == transfer["downloadId"] && event["final"] == true);
    assert_eq!(complete["state"], "completed");
    assert_eq!(complete["viewId"], "root");
    assert_eq!(fs::read(fixture.root.join("retained.txt")).unwrap(), vec![b's'; 2 * 1024 * 1024]);
}

#[test]
#[ignore = "Requires the installed WebView2 runtime and an interactive Windows desktop"]
fn replacing_source_revokes_pending_approval_but_preserves_approved_transfer() {
    let mut fixture = Fixture::new();
    let pending = fixture.download("/blob");
    let replacement = json!({
        "op": "open", "viewId": "root",
        "parent": (fixture.window.0 as usize).to_string(),
        "url": format!("{}/", fixture.address),
    });
    assert_eq!(fixture.request(replacement.clone())["ok"], true);
    assert_eq!(
        fixture
            .wait(|event| event["downloadId"] == pending["downloadId"] && event["final"] == true)
            ["state"],
        "cancelled"
    );
    assert_eq!(fixture.decide(&pending, "root", "stale.csv")["ok"], false);
    assert!(!fixture.root.join("stale.csv").exists());
    let approved = fixture.download("/slow");
    assert_eq!(fixture.decide(&approved, "root", "retained.txt")["ok"], true);
    assert_eq!(fixture.request(replacement)["ok"], true);
    let complete = fixture
        .wait(|event| event["downloadId"] == approved["downloadId"] && event["final"] == true);
    assert_eq!(complete["state"], "completed");
    assert_eq!(fs::read(fixture.root.join("retained.txt")).unwrap(), vec![b's'; 2 * 1024 * 1024]);
    let current = fixture.download("/blob");
    assert_ne!(current["downloadId"], pending["downloadId"]);
    assert_ne!(current["downloadId"], approved["downloadId"]);
    assert_eq!(
        fixture.request(json!({
            "op": "download-action", "viewId": "root",
            "downloadId": current["downloadId"], "action": "cancel"
        }))["ok"],
        true
    );
}

#[test]
#[ignore = "Requires the installed WebView2 runtime and an interactive Windows desktop"]
fn excess_native_downloads_are_cancelled_without_crashing_the_host() {
    let mut fixture = Fixture::new();
    for index in 0..9 {
        let view_id = format!("limit-{index}");
        assert_eq!(
            fixture.request(json!({
                "op": "open", "viewId": view_id,
                "parent": (fixture.window.0 as usize).to_string(),
                "url": format!("{}/blob", fixture.address),
            }))["ok"],
            true
        );
        let transfer =
            fixture.wait(|event| event["event"] == "download" && event["viewId"] == view_id);
        if index < 8 {
            assert!(transfer["downloadId"].is_string());
        } else {
            assert_eq!(transfer["reason"], "limit");
            assert!(transfer.get("downloadId").is_none());
        }
    }
    for index in 0..9 {
        assert_eq!(
            fixture.request(json!({ "op": "close", "viewId": format!("limit-{index}") }))["ok"],
            true
        );
    }
    let transfer = fixture.download("/file");
    assert_eq!(fixture.decide(&transfer, "root", "after-limit.txt")["ok"], true);
    let complete = fixture
        .wait(|event| event["downloadId"] == transfer["downloadId"] && event["final"] == true);
    assert_eq!(complete["state"], "completed");
    assert_eq!(fs::read(fixture.root.join("after-limit.txt")).unwrap(), vec![42; 32768]);
}

#[test]
#[ignore = "Requires the installed WebView2 runtime and an interactive Windows desktop"]
fn explicit_pause_resume_uses_the_same_operation_after_the_source_closes() {
    let mut fixture = Fixture::new();
    let transfer = fixture.download("/slow");
    assert_eq!(fixture.decide(&transfer, "root", "paused.txt")["ok"], true);
    fixture.wait(|event| {
        event["downloadId"] == transfer["downloadId"]
            && event["received"].as_i64().is_some_and(|bytes| bytes > 0)
    });
    assert_eq!(fixture.request(json!({
            "op": "download-action", "viewId": "wrong-owner", "downloadId": transfer["downloadId"], "action": "pause"
        }))["ok"], false);
    assert_eq!(fixture.request(json!({
            "op": "download-action", "viewId": "root", "downloadId": transfer["downloadId"], "action": "pause"
        }))["ok"], true);
    let paused = fixture
        .wait(|event| event["downloadId"] == transfer["downloadId"] && event["state"] == "paused");
    assert_eq!(paused["final"], false);
    assert_eq!(paused["canResume"], true);
    assert_eq!(fixture.request(json!({"op": "close", "viewId": "root"}))["ok"], true);
    unsafe {
        DestroyWindow(fixture.window).unwrap();
    }
    assert_eq!(fixture.request(json!({
            "op": "download-action", "viewId": "wrong-owner", "downloadId": transfer["downloadId"], "action": "resume"
        }))["ok"], false);
    assert_eq!(fixture.request(json!({
            "op": "download-action", "viewId": "root", "downloadId": transfer["downloadId"], "action": "resume"
        }))["ok"], true);
    let complete = fixture
        .wait(|event| event["downloadId"] == transfer["downloadId"] && event["final"] == true);
    assert_eq!(complete["state"], "completed");
    assert_eq!(fs::read(fixture.root.join("paused.txt")).unwrap(), vec![b's'; 2 * 1024 * 1024]);
    assert_eq!(fixture.request(json!({
            "op": "download-action", "viewId": "root", "downloadId": transfer["downloadId"], "action": "resume"
        }))["ok"], false);
}

#[test]
#[ignore = "Requires the installed WebView2 runtime; exercises the 60-second STA approval deadline"]
fn pending_approval_expires_without_another_host_command() {
    let mut fixture = Fixture::new();
    let transfer = fixture.download("/blob");
    let started = Instant::now();
    fixture.timeout = Duration::from_secs(70);
    let terminal = fixture
        .wait(|event| event["downloadId"] == transfer["downloadId"] && event["final"] == true);
    assert_eq!(terminal["state"], "cancelled");
    assert!(started.elapsed() >= Duration::from_secs(58));
    assert_eq!(fixture.decide(&transfer, "root", "expired.txt")["ok"], false);
    assert!(!fixture.root.join("expired.txt").exists());
    assert_eq!(fixture.request(json!({"op": "close", "viewId": "root"}))["ok"], true);
}
