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
    fn annotation_previews_are_pixel_bounded() {
        assert!(annotation_preview_size_allowed(4096, 4096));
        assert!(!annotation_preview_size_allowed(4097, 4096));
        assert!(!annotation_preview_size_allowed(0, 10));
        assert!(!annotation_preview_size_allowed(i64::MAX, 2));
    }
}
