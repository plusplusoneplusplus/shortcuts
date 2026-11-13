use serde::Deserialize;
use serde_json::Value;
use std::io::{self, Write};
use std::sync::atomic::{AtomicBool, Ordering};

/// Same per-frame boundary as the WebView2 helper and `webview2-process.ts`.
pub const MAX_TRANSPORT_BYTES: usize = 1_048_576;
/// Correlated annotation captures may exceed the frame limit, matching the desktop's
/// `capture-annotation` result limit. Nothing else may.
pub const MAX_CAPTURE_REPLY_BYTES: usize = 28_000_000;
pub const MAX_ANNOTATION_PNG_BYTES: usize = 20 * 1024 * 1024;
pub const MAX_ANNOTATION_PIXELS: u64 = 16 * 1024 * 1024;
/// Mirrors `MAX_BROWSER_FAVICON_BYTES` in coc-desktop's browser-favicon.ts.
pub const MAX_FAVICON_BYTES: usize = 64 * 1024;

static OUTPUT_FAILED: AtomicBool = AtomicBool::new(false);

pub fn output_failed() -> bool {
    OUTPUT_FAILED.load(Ordering::Relaxed)
}

pub fn read_command(
    input: &mut impl io::BufRead,
) -> io::Result<Option<std::result::Result<Command, &'static str>>> {
    let mut line = Vec::new();
    let mut bytes = 0usize;
    let mut oversized = false;
    loop {
        let buffer = input.fill_buf()?;
        if buffer.is_empty() {
            if bytes == 0 {
                return Ok(None);
            }
            break;
        }
        let end = buffer.iter().position(|&byte| byte == b'\n');
        let length = end.map_or(buffer.len(), |end| end + 1);
        bytes = bytes.saturating_add(length);
        oversized |= bytes > MAX_TRANSPORT_BYTES;
        if !oversized {
            line.extend_from_slice(&buffer[..length]);
        }
        input.consume(length);
        if end.is_some() {
            break;
        }
    }
    if oversized {
        return Ok(Some(Err("Browser command exceeds the transport limit.")));
    }
    Ok(Some(serde_json::from_slice(&line).map_err(|_| "Invalid browser command.")))
}

/// Screen bounds in Electron DIP coordinates (top-left origin), as main supplies them.
#[derive(Clone, Copy, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Bounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Command {
    pub id: u64,
    pub op: String,
    pub view_id: Option<String>,
    pub url: Option<String>,
    pub bounds: Option<Bounds>,
    pub visible: Option<bool>,
    /// `open`/`parent`: AppKit window number of the Electron window the panel follows.
    pub parent_window: Option<i64>,
    /// `background`: keep the page rendering off-screen while control runs.
    pub enabled: Option<bool>,
    /// `nav`: back, forward, reload or stop.
    pub action: Option<String>,
    /// `open`/`page-zoom`: page zoom in percent, 50–200 in 25 steps like WebView2.
    pub page_zoom_percent: Option<f64>,
    /// `open`/`tab-shortcuts`: route Cmd+1–9 and Cmd hold to main for tab switching.
    pub tab_shortcuts: Option<bool>,
    /// `evaluate`: JavaScript expression run in the helper's isolated content world.
    pub expression: Option<String>,
}

pub fn allowed_view_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 256
        && value
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'_' | b'-' | b':' | b'.'))
}

pub fn allowed_url(value: &str, allow_blank: bool) -> bool {
    if allow_blank && value == "about:blank" {
        return true;
    }
    value.len() <= 8192
        && url::Url::parse(value).is_ok_and(|url| matches!(url.scheme(), "http" | "https"))
}

pub fn annotation_preview_size_allowed(width: i64, height: i64) -> bool {
    width > 0
        && height > 0
        && width.checked_mul(height).is_some_and(|pixels| pixels <= MAX_ANNOTATION_PIXELS as i64)
}

pub fn allowed_page_zoom(percent: f64) -> bool {
    percent.is_finite() && (50.0..=200.0).contains(&percent) && (percent - 50.0) % 25.0 == 0.0
}

pub fn wire_title(title: &str) -> String {
    title.chars().take(4096).collect()
}

/// History is recorded by main from these; titles never create entries (`visit` false).
pub fn history_message(
    view_id: &str,
    source_view_id: &str,
    url: &str,
    title: &str,
    visit: bool,
) -> Option<Value> {
    allowed_url(url, false).then(|| {
        serde_json::json!({
            "event": if visit { "visited" } else { "title-updated" },
            "viewId": view_id, "sourceViewId": source_view_id, "url": url, "title": wire_title(title)
        })
    })
}

/// Browser chords the helper turns into requests for main instead of passing to the page.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Shortcut {
    Tab(u32),
    Close,
    OpenMenu,
    ReopenClosed,
    FocusAddress,
}

impl Shortcut {
    pub fn event(self) -> &'static str {
        match self {
            Shortcut::Tab(_) => "tab-shortcut-requested",
            Shortcut::Close => "close-requested",
            Shortcut::OpenMenu => "open-menu-requested",
            Shortcut::ReopenClosed => "reopen-closed-requested",
            Shortcut::FocusAddress => "focus-address-requested",
        }
    }
}

#[derive(Debug, Clone, Copy, Default)]
pub struct Modifiers {
    pub command: bool,
    pub option: bool,
    pub control: bool,
    pub shift: bool,
}

/// macOS virtual key codes of the top-row digits 1–9 (kVK_ANSI_1…kVK_ANSI_9).
const DIGIT_KEY_CODES: [u16; 9] = [18, 19, 20, 21, 23, 22, 26, 28, 25];

/// Maps a key-down to a browser chord, mirroring the WebView2 Ctrl chords with Cmd.
/// Digits match by key code so non-US layouts keep Cmd+1–9; letters match by character.
/// Option and Control always leave the key with the page.
pub fn shortcut(
    key_code: u16,
    chars: &str,
    keys: Modifiers,
    tab_shortcuts: bool,
) -> Option<Shortcut> {
    if !keys.command || keys.option || keys.control {
        return None;
    }
    if let Some(index) = DIGIT_KEY_CODES.iter().position(|code| *code == key_code) {
        return (tab_shortcuts && !keys.shift).then_some(Shortcut::Tab(index as u32 + 1));
    }
    match (chars.to_ascii_lowercase().as_str(), keys.shift) {
        ("w", _) => Some(Shortcut::Close),
        ("t", false) => Some(Shortcut::OpenMenu),
        ("t", true) => Some(Shortcut::ReopenClosed),
        ("l", false) => Some(Shortcut::FocusAddress),
        _ => None,
    }
}

/// The next Cmd-hold report: Cmd changing state on a modifier change, or another key
/// cancelling a reported hold.
pub fn tab_modifier_report(modifier_change: bool, command: bool, held: bool) -> Option<bool> {
    if modifier_change {
        return (command != held).then_some(command);
    }
    held.then_some(false)
}

/// `window.open`/`target=_blank` requests with size, position or hidden toolbars are
/// popups (sign-in windows); anything else opens as a tab in main.
pub fn popup_window(has_size: bool, has_position: bool, toolbars: Option<bool>) -> bool {
    has_size || has_position || toolbars == Some(false)
}

/// Wraps an expression so its awaited result comes back as JSON text (null for
/// `undefined`), which keeps the reply independent of WebKit's object bridging.
pub fn evaluation_body(expression: &str) -> String {
    format!(
        "const value = await (0, eval)({});\nreturn value === undefined ? null : JSON.stringify(value);",
        serde_json::to_string(expression).unwrap_or_default()
    )
}

/// Error text for a failed main-frame load, or None when the load was cancelled
/// (stop, a superseding navigation) or handed to a download, which are not page errors.
pub fn navigation_error(domain: &str, code: i64, description: &str) -> Option<String> {
    let cancelled = (domain == "NSURLErrorDomain" && code == -999)
        || (domain == "WebKitErrorDomain" && code == 102);
    (!cancelled).then(|| {
        let description = description.chars().take(512).collect::<String>();
        if description.is_empty() {
            format!("Navigation failed ({domain} {code})")
        } else {
            format!("Navigation failed: {description}")
        }
    })
}

/// Serializes a reply, enforcing the frame limit. Only a correlated capture reply may
/// use the larger capture budget; anything else oversized becomes a small correlated
/// `invalid` error so the desktop never has to discard an unbounded frame.
pub fn encode_reply(reply: &Value, capture: bool) -> String {
    let encoded = reply.to_string();
    let limit = if capture && reply.get("id").and_then(Value::as_u64).is_some_and(|id| id > 0) {
        MAX_CAPTURE_REPLY_BYTES
    } else {
        MAX_TRANSPORT_BYTES - 1
    };
    if encoded.len() <= limit {
        return encoded;
    }
    match reply.get("id").and_then(Value::as_u64) {
        Some(id) => serde_json::json!({
            "id": id, "ok": false, "reason": "invalid",
            "message": "WKWebView result exceeds the transport limit; return a smaller result."
        })
        .to_string(),
        None => serde_json::json!({
            "id": 0, "ok": false, "reason": "runtime-crashed",
            "message": "WKWebView event exceeds the transport limit."
        })
        .to_string(),
    }
}

fn write_line(line: &str) {
    if output_failed() {
        return;
    }
    let stdout = io::stdout();
    let mut output = stdout.lock();
    if writeln!(output, "{line}").and_then(|_| output.flush()).is_err() {
        // Let the run loop cancel pending work before exiting.
        OUTPUT_FAILED.store(true, Ordering::Relaxed);
    }
}

pub fn emit(value: Value) {
    write_line(&encode_reply(&value, false));
}

pub fn emit_capture(value: Value) {
    write_line(&encode_reply(&value, true));
}

/// Correlated replies serialize `id` first; the desktop reads it from the frame prefix.
pub fn reply(id: u64, result: Option<Value>) {
    let mut line = format!("{{\"id\":{id},\"ok\":true");
    if let Some(result) = result {
        line.push_str(",\"result\":");
        line.push_str(&result.to_string());
    }
    line.push('}');
    if line.len() >= MAX_TRANSPORT_BYTES {
        failure(
            id,
            "invalid",
            "WKWebView result exceeds the transport limit; return a smaller result.",
        );
        return;
    }
    write_line(&line);
}

pub fn success(id: u64) {
    reply(id, None);
}

pub fn failure(id: u64, reason: &str, message: impl std::fmt::Display) {
    let message = serde_json::to_string(&message.to_string()).unwrap_or_else(|_| "\"\"".into());
    let reason = serde_json::to_string(reason).unwrap_or_else(|_| "\"invalid\"".into());
    write_line(&format!("{{\"id\":{id},\"ok\":false,\"reason\":{reason},\"message\":{message}}}"));
}

/// `--check` result for a macOS major version; WKWebView hosting requires macOS 14+.
pub fn availability(macos_major: Option<u64>) -> Value {
    match macos_major {
        Some(major) if major >= 14 => serde_json::json!({ "available": true }),
        _ => serde_json::json!({
            "available": false, "reason": "unsupported-platform",
            "message": "WKWebView requires macOS 14 or later. Select Electron in Desktop Preferences."
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn read(input: &[u8]) -> Option<std::result::Result<Command, &'static str>> {
        read_command(&mut io::BufReader::with_capacity(64, input)).unwrap()
    }

    #[test]
    fn commands_are_strict_json_lines() {
        let command = read(
            br#"{"id":7,"op":"open","viewId":"view-1","url":"https://example.test/"}
"#,
        )
        .unwrap()
        .unwrap();
        assert_eq!((command.id, command.op.as_str()), (7, "open"));
        assert_eq!(command.view_id.as_deref(), Some("view-1"));
        assert_eq!(
            read(b"{\"id\":1,\"op\":\"quit\",\"script\":\"x\"}\n").unwrap().unwrap_err(),
            "Invalid browser command."
        );
        assert_eq!(read(b"{invalid\n").unwrap().unwrap_err(), "Invalid browser command.");
        assert!(read(b"").is_none());
        let bounds = read(br#"{"id":2,"op":"bounds","viewId":"v","bounds":{"x":1.5,"y":2,"width":300,"height":200}}"#)
            .unwrap()
            .unwrap();
        assert_eq!(bounds.bounds, Some(Bounds { x: 1.5, y: 2.0, width: 300.0, height: 200.0 }));
    }

    #[test]
    fn oversized_commands_are_rejected_and_the_stream_resyncs() {
        let mut input = format!(
            "{{\"id\":1,\"op\":\"open\",\"url\":\"{}\"}}\n",
            "x".repeat(MAX_TRANSPORT_BYTES)
        );
        input.push_str("{\"id\":2,\"op\":\"quit\"}\n");
        let mut reader = io::BufReader::with_capacity(4096, input.as_bytes());
        assert_eq!(
            read_command(&mut reader).unwrap().unwrap().unwrap_err(),
            "Browser command exceeds the transport limit."
        );
        assert_eq!(read_command(&mut reader).unwrap().unwrap().unwrap().id, 2);
        assert!(read_command(&mut reader).unwrap().is_none());
    }

    #[test]
    fn replies_stay_within_frame_limits_except_correlated_captures() {
        let large = serde_json::json!({ "id": 9, "ok": true, "result": "x".repeat(2 * MAX_TRANSPORT_BYTES) });
        let rejected: Value = serde_json::from_str(&encode_reply(&large, false)).unwrap();
        assert_eq!((rejected["id"].as_u64(), rejected["ok"].as_bool()), (Some(9), Some(false)));
        assert_eq!(rejected["reason"], "invalid");
        assert!(encode_reply(&large, true).len() > MAX_TRANSPORT_BYTES);
        let too_large = serde_json::json!({ "id": 9, "ok": true, "result": "x".repeat(MAX_CAPTURE_REPLY_BYTES) });
        assert!(encode_reply(&too_large, true).len() < 256);
        let uncorrelated =
            serde_json::json!({ "event": "state", "title": "x".repeat(2 * MAX_TRANSPORT_BYTES) });
        assert!(encode_reply(&uncorrelated, true).len() < 256);
        assert_eq!(
            serde_json::from_str::<Value>(&encode_reply(&uncorrelated, true)).unwrap()["id"],
            0
        );
        let small = serde_json::json!({ "id": 3, "ok": true });
        assert_eq!(encode_reply(&small, false), small.to_string());
    }

    #[test]
    fn shortcuts_mirror_the_webview2_chords_with_command() {
        let command = Modifiers { command: true, ..Modifiers::default() };
        let shift = Modifiers { shift: true, ..command };
        assert_eq!(shortcut(13, "w", command, false), Some(Shortcut::Close));
        assert_eq!(shortcut(13, "W", shift, false), Some(Shortcut::Close));
        assert_eq!(shortcut(17, "t", command, false), Some(Shortcut::OpenMenu));
        assert_eq!(shortcut(17, "T", shift, false), Some(Shortcut::ReopenClosed));
        assert_eq!(shortcut(37, "l", command, false), Some(Shortcut::FocusAddress));
        assert_eq!(shortcut(37, "L", shift, false), None);
        assert_eq!(shortcut(8, "c", command, true), None);
        for keys in [
            Modifiers::default(),
            Modifiers { option: true, ..command },
            Modifiers { control: true, ..command },
        ] {
            assert_eq!(shortcut(13, "w", keys, true), None);
            assert_eq!(shortcut(18, "1", keys, true), None);
        }
        assert_eq!(Shortcut::FocusAddress.event(), "focus-address-requested");
    }

    #[test]
    fn tab_digits_follow_key_codes_and_the_tab_shortcut_setting() {
        let command = Modifiers { command: true, ..Modifiers::default() };
        for (digit, code) in DIGIT_KEY_CODES.iter().enumerate() {
            assert_eq!(shortcut(*code, "&", command, true), Some(Shortcut::Tab(digit as u32 + 1)));
            assert_eq!(shortcut(*code, "1", command, false), None);
        }
        assert_eq!(shortcut(29, "0", command, true), None);
        assert_eq!(shortcut(18, "!", Modifiers { shift: true, ..command }, true), None);
        assert_eq!(Shortcut::Tab(3).event(), "tab-shortcut-requested");
    }

    #[test]
    fn tab_modifier_reports_changes_and_cancels_on_other_keys() {
        assert_eq!(tab_modifier_report(true, true, false), Some(true));
        assert_eq!(tab_modifier_report(true, true, true), None);
        assert_eq!(tab_modifier_report(true, false, true), Some(false));
        assert_eq!(tab_modifier_report(true, false, false), None);
        assert_eq!(tab_modifier_report(false, true, true), Some(false));
        assert_eq!(tab_modifier_report(false, true, false), None);
    }

    #[test]
    fn evaluation_body_quotes_the_expression() {
        let body = evaluation_body("document.title + \"\\n\"");
        assert!(
            body.starts_with("const value = await (0, eval)(\"document.title + \\\"\\\\n\\\"\");")
        );
        assert!(body.ends_with("return value === undefined ? null : JSON.stringify(value);"));
    }

    #[test]
    fn popup_windows_need_size_position_or_hidden_toolbars() {
        assert!(!popup_window(false, false, None));
        assert!(!popup_window(false, false, Some(true)));
        assert!(popup_window(true, false, None));
        assert!(popup_window(false, true, None));
        assert!(popup_window(false, false, Some(false)));
    }

    #[test]
    fn availability_requires_macos_14() {
        assert_eq!(availability(Some(14)), serde_json::json!({ "available": true }));
        assert_eq!(availability(Some(26))["available"], true);
        for version in [Some(13), Some(10), None] {
            let result = availability(version);
            assert_eq!(result["available"], false);
            assert_eq!(result["reason"], "unsupported-platform");
        }
    }

    #[test]
    fn view_ids_and_urls_are_bounded() {
        assert!(allowed_view_id("browser-view:1.a_b"));
        for id in ["", "a b", "x/y", &"x".repeat(257)] {
            assert!(!allowed_view_id(id));
        }
        assert!(allowed_url("https://example.test/a?b#c", false));
        assert!(allowed_url("about:blank", true));
        for url in
            ["about:blank", "file:///etc/passwd", "javascript:alert(1)", "coc://x", "not a url"]
        {
            assert!(!allowed_url(url, false), "{url}");
        }
        assert!(!allowed_url(&format!("https://example.test/{}", "x".repeat(8192)), false));
    }

    #[test]
    fn page_zoom_matches_webview2_steps() {
        for percent in [50.0, 75.0, 100.0, 125.0, 200.0] {
            assert!(allowed_page_zoom(percent));
        }
        for percent in [f64::NAN, f64::INFINITY, 49.0, 201.0, 101.0] {
            assert!(!allowed_page_zoom(percent));
        }
        let command = read(br#"{"id":1,"op":"page-zoom","viewId":"v","pageZoomPercent":125}"#)
            .unwrap()
            .unwrap();
        assert_eq!(command.page_zoom_percent, Some(125.0));
        let nav = read(br#"{"id":2,"op":"nav","viewId":"v","action":"back"}"#).unwrap().unwrap();
        assert_eq!(nav.action.as_deref(), Some("back"));
    }

    #[test]
    fn history_messages_carry_only_http_documents_and_bounded_titles() {
        let visit =
            history_message("tab", "popup", "https://example.test/", "Title", true).unwrap();
        assert_eq!(visit["event"], "visited");
        assert_eq!(
            (visit["viewId"].as_str(), visit["sourceViewId"].as_str()),
            (Some("tab"), Some("popup"))
        );
        let title =
            history_message("tab", "tab", "http://x.test/", &"t".repeat(5000), false).unwrap();
        assert_eq!(title["event"], "title-updated");
        assert_eq!(title["title"].as_str().unwrap().chars().count(), 4096);
        for url in ["about:blank", "file:///x", "data:text/html,x"] {
            assert!(history_message("tab", "tab", url, "", true).is_none());
        }
    }

    #[test]
    fn cancelled_and_download_handoff_loads_are_not_page_errors() {
        assert_eq!(navigation_error("NSURLErrorDomain", -999, "cancelled"), None);
        assert_eq!(navigation_error("WebKitErrorDomain", 102, "interrupted"), None);
        assert_eq!(
            navigation_error("NSURLErrorDomain", -1004, "Could not connect to the server.")
                .unwrap(),
            "Navigation failed: Could not connect to the server."
        );
        assert_eq!(navigation_error("X", 7, "").unwrap(), "Navigation failed (X 7)");
    }

    #[test]
    fn annotation_previews_are_pixel_bounded() {
        assert!(annotation_preview_size_allowed(4096, 4096));
        assert!(!annotation_preview_size_allowed(4097, 4096));
        assert!(!annotation_preview_size_allowed(0, 10));
        assert!(!annotation_preview_size_allowed(i64::MAX, 2));
    }
}
