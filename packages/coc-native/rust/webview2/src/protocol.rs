use serde::Deserialize;
use serde_json::Value;
use std::io::{self, Write};

const MAX_TRANSPORT_BYTES: usize = 1_048_576;

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

#[derive(Clone, Copy, Debug, Deserialize)]
pub struct Point {
    pub x: i32,
    pub y: i32,
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Bounds {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
    pub content_origin: Point,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Command {
    pub id: u64,
    pub op: String,
    pub view_id: Option<String>,
    pub parent: Option<String>,
    pub url: Option<String>,
    pub bounds: Option<Bounds>,
    pub action: Option<String>,
    pub cookies: Option<Vec<ImportCookie>>,
    pub page_zoom_percent: Option<f64>,
    pub method: Option<String>,
    pub params: Option<serde_json::Map<String, Value>>,
    pub turn_id: Option<String>,
    pub session_id: Option<String>,
    pub enabled: Option<bool>,
    pub click_once_enabled: Option<bool>,
    /// `open`/`navigation-gate`: hold agent-driven cross-host navigations for site approval.
    pub navigation_gate: Option<bool>,
    /// `navigate`: resume a navigation the gate held after the user approved it.
    pub approved: Option<bool>,
}

pub const CDP_EVENTS: &[&str] = &[
    "Page.frameAttached",
    "Page.frameNavigated",
    "Page.frameDetached",
    "Page.navigatedWithinDocument",
    "Page.lifecycleEvent",
    "Page.frameStartedLoading",
    "Page.frameStoppedLoading",
    "Runtime.executionContextCreated",
    "Runtime.executionContextDestroyed",
    "Runtime.executionContextsCleared",
    "Target.attachedToTarget",
    "Target.detachedFromTarget",
    "Target.targetCrashed",
    "Inspector.detached",
];

pub fn allowed_cdp_session(session: &str) -> bool {
    !session.is_empty()
        && session.len() <= 256
        && session
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'_' | b'-' | b'.' | b':'))
}

#[derive(Default)]
pub struct CdpSessions(std::collections::HashMap<String, Option<String>>);

impl CdpSessions {
    pub fn contains(&self, session: &str) -> bool {
        allowed_cdp_session(session) && self.0.contains_key(session)
    }

    pub fn clear(&mut self) {
        self.0.clear();
    }

    pub fn event(
        &mut self,
        view: &str,
        method: &str,
        json: &str,
        session: Option<&str>,
    ) -> std::result::Result<Option<Value>, &'static str> {
        if !CDP_EVENTS.contains(&method) || session.is_some_and(|id| !self.contains(id)) {
            return Ok(None);
        }
        if json.len() > 900_000 {
            return Err("WebView2 CDP event exceeds the transport limit.");
        }
        let params: serde_json::Map<String, Value> = serde_json::from_str(json)
            .map_err(|_| "WebView2 CDP event params must be a JSON object.")?;
        if method == "Target.attachedToTarget" {
            let Some(id) = params
                .get("sessionId")
                .and_then(Value::as_str)
                .filter(|id| allowed_cdp_session(id))
            else {
                return Err("WebView2 returned an invalid CDP session.");
            };
            if params
                .get("targetInfo")
                .and_then(|target| target.get("type"))
                .and_then(Value::as_str)
                != Some("iframe")
            {
                return Ok(None);
            }
            if session == Some(id) || self.0.contains_key(id) {
                return Ok(None);
            }
            if self.0.len() >= 256 && !self.0.contains_key(id) {
                return Err("WebView2 CDP session limit exceeded.");
            }
            self.0.insert(id.to_string(), session.map(str::to_string));
        } else if method == "Target.detachedFromTarget" {
            if let Some(id) = params.get("sessionId").and_then(Value::as_str) {
                let mut removed = vec![id.to_string()];
                let mut index = 0;
                while index < removed.len() {
                    let parent = removed[index].clone();
                    removed.extend(self.0.iter().filter_map(|(id, owner)| {
                        (owner.as_deref() == Some(&parent)).then(|| id.clone())
                    }));
                    index += 1;
                }
                for id in removed {
                    self.0.remove(&id);
                }
            }
        }
        let mut event = serde_json::json!({ "event": "cdp-event", "viewId": view, "method": method, "params": params });
        if let Some(session) = session {
            event["sessionId"] = Value::String(session.to_string());
        }
        if event.to_string().len() > 1_048_576 {
            return Err("WebView2 CDP event exceeds the framing limit.");
        }
        Ok(Some(event))
    }
}

pub fn cdp_arguments(command: &Command) -> Option<(&str, String)> {
    let method = command.method.as_deref()?;
    // A protocol method is Domain.command, not a script or a transport endpoint.
    let (domain, name) = method.split_once('.')?;
    if command.session_id.as_deref().is_some_and(|id| !allowed_cdp_session(id))
        || domain.is_empty()
        || name.is_empty()
        || method.len() > 256
        || !domain.bytes().chain(name.bytes()).all(|c| c.is_ascii_alphanumeric() || c == b'_')
    {
        return None;
    }
    Some((method, serde_json::to_string(&command.params.clone().unwrap_or_default()).ok()?))
}

pub fn cdp_response(id: u64, json: &str) -> std::result::Result<Value, serde_json::Error> {
    // Leave framing overhead below the desktop's 1 MiB per-message boundary.
    if json.len() > 900_000 {
        return Ok(serde_json::json!({
            "id": id, "ok": false, "reason": "invalid",
            "message": "WebView2 CDP result exceeds the transport limit; return a smaller result."
        }));
    }
    let result: Value = serde_json::from_str(json)?;
    Ok(serde_json::json!({ "id": id, "ok": true, "result": result }))
}

pub fn allowed_page_zoom(percent: f64) -> bool {
    percent.is_finite() && (50.0..=200.0).contains(&percent) && (percent - 50.0) % 25.0 == 0.0
}

pub fn allowed_control_turn(turn: Option<&str>) -> bool {
    turn.is_none_or(|id| !id.is_empty() && id.len() <= 512 && !id.chars().any(char::is_control))
}

pub fn control_content_top(height: i32, dpi: i32, active: bool) -> i32 {
    if active {
        (40 * dpi.max(96) / 96).min(height.max(0))
    } else {
        0
    }
}

/// While a control turn drives the view, a new document on another host must wait for site
/// approval. Same-host loads stay on an already-shown site; back/forward and reload are not
/// new pages unless they redirect. Non-HTTP(S) targets are never asked about.
pub fn gate_navigation(current: &str, target: &str, new_document: bool) -> bool {
    if !new_document || !allowed_url(target, false) {
        return false;
    }
    let host = |value: &str| {
        url::Url::parse(value)
            .ok()
            .filter(|url| matches!(url.scheme(), "http" | "https"))
            .and_then(|url| url.host_str().map(str::to_ascii_lowercase))
    };
    host(current).is_none() || host(current) != host(target)
}

#[cfg(test)]
mod navigation_gate_tests {
    use super::*;

    #[test]
    fn gates_new_documents_on_another_host_only() {
        assert!(gate_navigation("about:blank", "https://example.com/", true));
        assert!(gate_navigation("", "https://example.com/", true));
        assert!(gate_navigation("https://google.com/", "https://mail.google.com/", true));
        assert!(gate_navigation("https://a.test/", "http://b.test/form", true));
        assert!(!gate_navigation("https://a.test/x", "https://A.test:8443/y", true));
        assert!(!gate_navigation("https://a.test/", "https://b.test/", false));
        assert!(!gate_navigation("https://a.test/", "about:blank", true));
        assert!(!gate_navigation("https://a.test/", "data:text/html,x", true));
        assert!(!gate_navigation("https://a.test/", "file:///C:/x.html", true));
    }

    #[test]
    fn gate_commands_parse() {
        let open: Command = serde_json::from_str(
            r#"{"id":1,"op":"open","viewId":"7:tab:1","url":"https://a.test/","parent":"1","navigationGate":true}"#,
        )
        .unwrap();
        assert_eq!(open.navigation_gate, Some(true));
        let toggle: Command = serde_json::from_str(
            r#"{"id":2,"op":"navigation-gate","viewId":"7:tab:1","navigationGate":false}"#,
        )
        .unwrap();
        assert_eq!(toggle.navigation_gate, Some(false));
        let resume: Command = serde_json::from_str(
            r#"{"id":3,"op":"navigate","viewId":"7:tab:1","url":"https://b.test/","approved":true}"#,
        )
        .unwrap();
        assert_eq!(resume.approved, Some(true));
    }
}

#[cfg(test)]
mod control_chrome_tests {
    use super::*;

    #[test]
    fn trusted_activity_is_explicit_bounded_and_clearable_without_script_or_cdp() {
        let active: Command = serde_json::from_str(
            r#"{"id":1,"op":"control-activity","viewId":"7:tab:1:popup:1","turnId":"turn"}"#,
        )
        .unwrap();
        assert_eq!(active.turn_id.as_deref(), Some("turn"));
        assert!(allowed_control_turn(active.turn_id.as_deref()));
        let clear: Command = serde_json::from_str(
            r#"{"id":2,"op":"control-activity","viewId":"7:tab:1:popup:1","turnId":null}"#,
        )
        .unwrap();
        assert!(allowed_control_turn(clear.turn_id.as_deref()));
        for invalid in ["".to_string(), "x".repeat(513), "line\nbreak".to_string()] {
            assert!(!allowed_control_turn(Some(&invalid)));
        }
    }

    #[test]
    fn popup_content_reserves_trusted_chrome_at_each_dpi_and_restores_the_full_viewport() {
        assert_eq!(control_content_top(560, 96, true), 40);
        assert_eq!(control_content_top(560, 192, true), 80);
        assert_eq!(control_content_top(20, 192, true), 20);
        assert_eq!(control_content_top(0, 192, true), 0);
        assert_eq!(control_content_top(560, 192, false), 0);
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ImportCookie {
    pub url: String,
    pub name: String,
    pub value: String,
    pub domain: Option<String>,
    pub path: String,
    pub secure: bool,
    pub http_only: bool,
    pub same_site: SameSite,
    pub expiration_date: Option<f64>,
}

#[derive(Debug, Deserialize)]
pub enum SameSite {
    #[serde(rename = "lax")]
    Lax,
    #[serde(rename = "strict")]
    Strict,
    #[serde(rename = "no_restriction")]
    None,
}

pub fn close_shortcut(key: u32, key_down: bool, control: bool, alt: bool) -> bool {
    key == u32::from(b'W') && key_down && control && !alt
}

pub fn open_menu_shortcut(key: u32, key_down: bool, control: bool, alt: bool, shift: bool) -> bool {
    key == u32::from(b'T') && key_down && control && !alt && !shift
}

pub fn reopen_closed_shortcut(
    key: u32,
    key_down: bool,
    control: bool,
    alt: bool,
    shift: bool,
) -> bool {
    key == u32::from(b'T') && key_down && control && !alt && shift
}

pub fn focus_address_shortcut(
    key: u32,
    key_down: bool,
    control: bool,
    alt: bool,
    shift: bool,
) -> bool {
    key == u32::from(b'L') && key_down && control && !alt && !shift
}

pub fn allowed_url(value: &str, allow_blank: bool) -> bool {
    if allow_blank && (value.is_empty() || value == "about:blank") {
        return true;
    }
    if value.len() > 8192 || value.chars().any(char::is_control) {
        return false;
    }
    url::Url::parse(value)
        .is_ok_and(|url| matches!(url.scheme(), "http" | "https") && url.host_str().is_some())
}

pub fn allowed_view_id(value: &str) -> bool {
    !value.is_empty()
        && value.encode_utf16().count() <= 1024
        && !value.chars().any(char::is_control)
}

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
            "viewId": view_id, "sourceViewId": source_view_id, "url": url, "title": title.chars().take(4096).collect::<String>()
        })
    })
}

/// Mirrors `MAX_BROWSER_FAVICON_BYTES` in coc-desktop's browser-favicon.ts.
pub const MAX_FAVICON_BYTES: usize = 64 * 1024;

/// The engine's PNG rendering of the site icon as a bounded data URL. Anything
/// that is empty, oversized or not a PNG leaves the tab on its default icon.
pub fn favicon_data_url(png: &[u8]) -> Option<String> {
    const SIGNATURE: [u8; 8] = [0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a];
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    if png.len() > MAX_FAVICON_BYTES || !png.starts_with(&SIGNATURE) {
        return None;
    }
    let mut url = String::with_capacity(22 + png.len().div_ceil(3) * 4);
    url.push_str("data:image/png;base64,");
    for chunk in png.chunks(3) {
        let bytes = [chunk[0], *chunk.get(1).unwrap_or(&0), *chunk.get(2).unwrap_or(&0)];
        let triple = (u32::from(bytes[0]) << 16) | (u32::from(bytes[1]) << 8) | u32::from(bytes[2]);
        for index in 0..4 {
            url.push(if index <= chunk.len() {
                ALPHABET[(triple >> (18 - 6 * index) & 0x3f) as usize] as char
            } else {
                '='
            });
        }
    }
    Some(url)
}

pub fn emit(value: Value) {
    let stdout = io::stdout();
    let mut output = stdout.lock();
    if writeln!(output, "{value}").and_then(|_| output.flush()).is_err() {
        std::process::exit(1);
    }
}

pub fn success(id: u64) {
    emit(serde_json::json!({ "id": id, "ok": true }));
}
pub fn failure(id: u64, reason: &str, message: impl std::fmt::Display) {
    emit(
        serde_json::json!({ "id": id, "ok": false, "reason": reason, "message": message.to_string() }),
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn favicons_are_bounded_png_data_urls() {
        let png = [0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a];
        assert_eq!(favicon_data_url(&png).unwrap(), "data:image/png;base64,iVBORw0KGgo=");
        let mut padded = png.to_vec();
        padded.push(0xff);
        assert_eq!(favicon_data_url(&padded).unwrap(), "data:image/png;base64,iVBORw0KGgr/");
        padded.push(0x00);
        assert_eq!(favicon_data_url(&padded).unwrap(), "data:image/png;base64,iVBORw0KGgr/AA==");
        assert_eq!(favicon_data_url(&[]), None);
        assert_eq!(favicon_data_url(b"<svg onload=alert(1)>"), None);
        let mut large = png.to_vec();
        large.resize(MAX_FAVICON_BYTES, 0);
        assert!(favicon_data_url(&large).is_some());
        large.push(0);
        assert_eq!(favicon_data_url(&large), None);
    }

    fn command_line(expression: &str) -> String {
        serde_json::json!({
            "id": 7, "op": "cdp", "viewId": "owned", "method": "Runtime.evaluate",
            "params": { "expression": expression }
        })
        .to_string()
            + "\n"
    }

    #[test]
    fn native_transport_accepts_serializer_commands_above_32k_through_the_exact_1mib_boundary() {
        for expression in [
            "x".repeat(65_536),
            "\u{754c}".repeat(50_000),
            "x".repeat(MAX_TRANSPORT_BYTES - command_line("").len()),
        ] {
            let line = command_line(&expression);
            assert!(line.len() > 32_768 && line.len() <= MAX_TRANSPORT_BYTES);
            let mut input = io::BufReader::with_capacity(127, io::Cursor::new(line));
            let command = read_command(&mut input).unwrap().unwrap().unwrap();
            assert_eq!(command.id, 7);
            assert_eq!(command.params.unwrap()["expression"], expression);
            assert!(read_command(&mut input).unwrap().is_none());
        }
    }

    #[test]
    fn native_transport_bounds_and_drains_oversized_utf8_frames_before_the_next_command() {
        for expression in ["x".repeat(MAX_TRANSPORT_BYTES), "\u{754c}".repeat(400_000)] {
            let oversized = command_line(&expression);
            assert!(oversized.len() > MAX_TRANSPORT_BYTES);
            let mut input =
                io::BufReader::with_capacity(113, io::Cursor::new(oversized + &command_line("42")));
            assert_eq!(
                read_command(&mut input).unwrap().unwrap().unwrap_err(),
                "Browser command exceeds the transport limit."
            );
            let command = read_command(&mut input).unwrap().unwrap().unwrap();
            assert_eq!(command.params.unwrap()["expression"], "42");
            assert!(read_command(&mut input).unwrap().is_none());
        }
    }

    #[test]
    fn native_transport_rejects_malformed_frames_without_echoing_data_and_accepts_final_eof_frame()
    {
        let mut input = io::Cursor::new(format!("invalid\n{}", command_line("42").trim_end()));
        assert_eq!(
            read_command(&mut input).unwrap().unwrap().unwrap_err(),
            "Invalid browser command."
        );
        assert_eq!(read_command(&mut input).unwrap().unwrap().unwrap().id, 7);
        assert!(read_command(&mut input).unwrap().is_none());
        let mut input = io::Cursor::new(vec![0xff, b'\n']);
        assert!(read_command(&mut input).unwrap().unwrap().is_err());
    }

    #[test]
    fn frame_transport_accepts_typed_session_commands_and_only_minimal_event_names() {
        let command: Command = serde_json::from_str(
            r#"{"id":1,"op":"cdp","viewId":"owned","method":"Runtime.enable","sessionId":"child-session"}"#
        ).unwrap();
        assert_eq!(command.session_id.as_deref(), Some("child-session"));
        assert!(cdp_arguments(&command).is_some());
        let subscription: Command = serde_json::from_str(
            r#"{"id":2,"op":"cdp-subscribe","viewId":"owned","method":"Page.frameAttached","enabled":false}"#
        ).unwrap();
        assert_eq!(subscription.enabled, Some(false));
        assert!(CDP_EVENTS.contains(&subscription.method.as_deref().unwrap()));
        assert!(!CDP_EVENTS.contains(&"Network.requestWillBeSent"));
        for session in ["", "line\nbreak", "space invalid"] {
            let command: Command = serde_json::from_value(serde_json::json!({
                "id":3, "op":"cdp", "method":"Runtime.enable", "sessionId":session
            }))
            .unwrap();
            assert!(cdp_arguments(&command).is_none());
        }
        assert!(!allowed_cdp_session(&"x".repeat(257)));
        assert!(serde_json::from_str::<Command>(
            r#"{"id":1,"op":"cdp-subscribe","enabled":"true"}"#
        )
        .is_err());
    }

    fn attach(sessions: &mut CdpSessions, id: &str, parent: Option<&str>) -> Option<Value> {
        sessions
            .event(
                "owned",
                "Target.attachedToTarget",
                &serde_json::json!({
                    "sessionId": id, "targetInfo": { "type": "iframe" }
                })
                .to_string(),
                parent,
            )
            .unwrap()
    }

    #[test]
    fn frame_events_preserve_owned_root_and_nested_sessions_and_expire_descendants() {
        let mut sessions = CdpSessions::default();
        assert!(sessions
            .event("owned", "Runtime.executionContextsCleared", "{}", Some("foreign"))
            .unwrap()
            .is_none());
        assert!(attach(&mut sessions, "child", None).is_some());
        assert!(attach(&mut sessions, "nested", Some("child")).is_some());
        let event = sessions
            .event(
                "owned",
                "Runtime.executionContextCreated",
                r#"{"context":{"id":42}}"#,
                Some("nested"),
            )
            .unwrap()
            .unwrap();
        assert_eq!(event["viewId"], "owned");
        assert_eq!(event["sessionId"], "nested");
        assert_eq!(event["params"]["context"]["id"], 42);
        let root = sessions.event("owned", "Page.frameAttached", "{}", None).unwrap().unwrap();
        assert!(root.get("sessionId").is_none());
        sessions
            .event("owned", "Target.detachedFromTarget", r#"{"sessionId":"child"}"#, None)
            .unwrap();
        assert!(!sessions.contains("child"));
        assert!(!sessions.contains("nested"));
        assert!(sessions
            .event("owned", "Runtime.executionContextsCleared", "{}", Some("nested"))
            .unwrap()
            .is_none());
        assert!(attach(&mut sessions, "replacement", None).is_some());
        sessions.clear();
        assert!(!sessions.contains("replacement"));
    }

    #[test]
    fn frame_sessions_cannot_be_worker_targets_duplicate_reparented_or_cyclic() {
        let mut sessions = CdpSessions::default();
        assert!(sessions
            .event(
                "owned",
                "Target.attachedToTarget",
                r#"{"sessionId":"worker","targetInfo":{"type":"worker"}}"#,
                None
            )
            .unwrap()
            .is_none());
        assert!(!sessions.contains("worker"));
        assert!(attach(&mut sessions, "child", None).is_some());
        assert!(attach(&mut sessions, "nested", Some("child")).is_some());
        assert!(attach(&mut sessions, "child", Some("nested")).is_none());
        assert!(attach(&mut sessions, "child", Some("child")).is_none());
        assert!(attach(&mut sessions, "foreign", Some("unknown")).is_none());
        sessions
            .event("owned", "Target.detachedFromTarget", r#"{"sessionId":"child"}"#, None)
            .unwrap();
        assert!(!sessions.contains("nested"));
    }

    #[test]
    fn frame_event_and_session_limits_fail_without_publishing_partial_payloads() {
        let mut sessions = CdpSessions::default();
        for i in 0..256 {
            attach(&mut sessions, &format!("s{i}"), None);
        }
        assert!(sessions
            .event(
                "owned",
                "Target.attachedToTarget",
                r#"{"sessionId":"overflow","targetInfo":{"type":"iframe"}}"#,
                None
            )
            .is_err());
        assert!(!sessions.contains("overflow"));
        for params in [
            "[]".to_string(),
            "invalid".to_string(),
            serde_json::json!({"value":"\u{754c}".repeat(300_001)}).to_string(),
        ] {
            assert!(sessions.event("owned", "Page.frameNavigated", &params, None).is_err());
        }
        assert!(sessions
            .event("owned", "Network.requestWillBeSent", "{}", None)
            .unwrap()
            .is_none());
    }

    #[test]
    fn cdp_validates_methods_and_preserves_json_results_and_request_ids() {
        let command: Command = serde_json::from_str(
            r#"{"id":42,"op":"cdp","viewId":"7:tab:1","method":"Runtime.evaluate","params":{"expression":"'quoted\\value'","returnByValue":true}}"#,
        ).unwrap();
        let (method, params) = cdp_arguments(&command).unwrap();
        assert_eq!(method, "Runtime.evaluate");
        assert_eq!(
            serde_json::from_str::<Value>(&params).unwrap(),
            serde_json::json!(command.params)
        );
        for method in
            ["", "Runtime", ".evaluate", "Runtime.", "Runtime.evaluate()", "A.B.C", "A.\nB"]
        {
            let command: Command =
                serde_json::from_value(serde_json::json!({"id":1,"op":"cdp","method":method}))
                    .unwrap();
            assert!(cdp_arguments(&command).is_none());
        }
        assert!(serde_json::from_str::<Command>(
            r#"{"id":1,"op":"cdp","method":"Runtime.evaluate","params":[]}"#
        )
        .is_err());
        assert_eq!(
            cdp_response(42, r#"{"result":{"value":42}}"#).unwrap(),
            serde_json::json!({"id":42,"ok":true,"result":{"result":{"value":42}}})
        );
        assert!(cdp_response(42, "malformed").is_err());
    }

    #[test]
    fn oversized_cdp_results_return_small_correlated_errors() {
        let large = serde_json::json!({ "result": { "value": "x".repeat(1_100_000) } }).to_string();
        let response = cdp_response(42, &large).unwrap();
        assert_eq!(response["id"], 42);
        assert_eq!(response["ok"], false);
        assert_eq!(response["reason"], "invalid");
        assert!(response.to_string().len() < 256);
        assert_eq!(cdp_response(43, r#"{"result":{"value":42}}"#).unwrap()["ok"], true);
        let unicode = serde_json::json!({ "value": "\u{1f600}".repeat(250_000) }).to_string();
        assert_eq!(cdp_response(44, &unicode).unwrap()["ok"], false);
    }

    #[test]
    fn page_owned_history_titles_cannot_exceed_native_framing_limits() {
        let title = "\u{1f600}".repeat(300_000);
        let event =
            history_message("owned-view", "owned-view", "https://fixture.test/", &title, true)
                .unwrap();
        assert_eq!(event["title"].as_str().unwrap().chars().count(), 4096);
        assert!(event.to_string().len() < 20_000);
    }

    #[test]
    fn page_zoom_is_bounded_stepped_and_uses_a_typed_controller_command() {
        for percent in [50.0, 75.0, 100.0, 125.0, 150.0, 175.0, 200.0] {
            assert!(allowed_page_zoom(percent));
        }
        for percent in [f64::NAN, f64::INFINITY, 49.0, 201.0, 101.0] {
            assert!(!allowed_page_zoom(percent));
        }
        let command: Command = serde_json::from_str(
            r#"{"id":1,"op":"page-zoom","viewId":"7:tab:1","pageZoomPercent":125}"#,
        )
        .unwrap();
        assert_eq!(command.page_zoom_percent, Some(125.0));
        assert!(serde_json::from_str::<Command>(
            r#"{"id":1,"op":"page-zoom","pageZoomPercent":"125"}"#,
        )
        .is_err());
    }

    #[test]
    fn imports_cookie_attributes_independently_of_the_current_page() {
        let command: Command = serde_json::from_str(r#"{"id":1,"op":"import-cookies","viewId":"7:tab:1","cookies":[{"url":"https://app.example.com/","name":"session","value":"token","domain":".example.com","path":"/","secure":true,"httpOnly":true,"sameSite":"no_restriction","expirationDate":2000000000}]}"#).unwrap();
        let cookies = command.cookies.unwrap();
        assert_eq!(cookies.len(), 1);
        assert_eq!(cookies[0].url, "https://app.example.com/");
        assert_eq!(cookies[0].domain.as_deref(), Some(".example.com"));
        assert!(cookies[0].http_only);
        assert!(matches!(cookies[0].same_site, SameSite::None));
        assert_eq!(cookies[0].expiration_date, Some(2000000000.0));
        for invalid in [
            r#"{"id":1,"op":"import-cookies","cookies":[{"name":"a"}]}"#,
            r#"{"id":1,"op":"import-cookies","cookies":"a=b"}"#,
            r#"{"id":1,"op":"import-cookies","script":"unsafe"}"#,
        ] {
            assert!(serde_json::from_str::<Command>(invalid).is_err());
        }
    }

    #[test]
    fn close_shortcut_preserves_other_keys_and_modifiers() {
        assert!(close_shortcut(u32::from(b'W'), true, true, false));
        assert!(!close_shortcut(u32::from(b'W'), false, true, false));
        assert!(!close_shortcut(u32::from(b'W'), true, false, false));
        assert!(!close_shortcut(u32::from(b'W'), true, true, true));
        assert!(!close_shortcut(u32::from(b'F'), true, true, false));
    }

    #[test]
    fn open_menu_shortcut_preserves_other_keys_and_modifiers() {
        assert!(open_menu_shortcut(u32::from(b'T'), true, true, false, false));
        for (key, down, control, alt, shift) in [
            (b'W', true, true, false, false),
            (b'T', false, true, false, false),
            (b'T', true, false, false, false),
            (b'T', true, true, true, false),
            (b'T', true, true, false, true),
        ] {
            assert!(!open_menu_shortcut(u32::from(key), down, control, alt, shift));
        }
    }

    #[test]
    fn reopen_closed_shortcut_requires_shift_and_preserves_other_keys() {
        assert!(reopen_closed_shortcut(u32::from(b'T'), true, true, false, true));
        for (key, down, control, alt, shift) in [
            (b'T', true, true, false, false),
            (b'W', true, true, false, true),
            (b'T', false, true, false, true),
            (b'T', true, false, false, true),
            (b'T', true, true, true, true),
        ] {
            assert!(!reopen_closed_shortcut(u32::from(key), down, control, alt, shift));
        }
    }

    #[test]
    fn address_shortcut_preserves_other_keys_and_modifiers() {
        assert!(focus_address_shortcut(u32::from(b'L'), true, true, false, false));
        for (key, down, control, alt, shift) in [
            (b'T', true, true, false, false),
            (b'L', false, true, false, false),
            (b'L', true, false, false, false),
            (b'L', true, true, true, false),
            (b'L', true, true, false, true),
        ] {
            assert!(!focus_address_shortcut(u32::from(key), down, control, alt, shift));
        }
    }

    #[test]
    fn navigation_policy_is_http_only() {
        for url in ["https://example.test/", "http://127.0.0.1:1234/"] {
            assert!(allowed_url(url, false));
        }
        for url in [
            "about:blank",
            "file:///tmp/page.html",
            "javascript:alert(1)",
            "data:text/html,x",
            "example.test",
            "https://exa\nmple.test",
        ] {
            assert!(!allowed_url(url, false));
        }
        assert!(allowed_url("about:blank", true));
        assert!(allowed_url("", true));
        assert!(!allowed_url(&format!("https://example.test/{}", "x".repeat(9000)), false));
    }

    #[test]
    fn rejects_unknown_command_fields_and_malformed_geometry() {
        assert!(
            serde_json::from_str::<Command>(r#"{"id":1,"op":"open","script":"unsafe"}"#).is_err()
        );
        assert!(serde_json::from_str::<Command>(
            r#"{"id":1,"op":"bounds","bounds":{"x":0,"y":0,"width":1e30,"height":1}}"#
        )
        .is_err());
        assert!(serde_json::from_str::<Command>(
            r#"{"id":1,"op":"bounds","bounds":{"x":0,"y":0,"width":300,"height":200}}"#
        )
        .is_err());
    }

    #[test]
    fn bounds_require_a_physical_screen_content_origin() {
        let command: Command = serde_json::from_str(
            r#"{"id":1,"op":"bounds","bounds":{"x":10,"y":111,"width":300,"height":200,"contentOrigin":{"x":-1200,"y":49}}}"#,
        )
        .unwrap();
        let bounds = command.bounds.unwrap();
        assert_eq!((bounds.x, bounds.y), (10, 111));
        assert_eq!((bounds.content_origin.x, bounds.content_origin.y), (-1200, 49));
    }

    #[test]
    fn private_view_ids_allow_the_owner_prefix_and_public_unicode_ids() {
        assert!(allowed_view_id(&format!("123:{}", "\u{754c}".repeat(512))));
        assert!(!allowed_view_id("bad\nid"));
        assert!(!allowed_view_id(""));
        assert!(!allowed_view_id(&"x".repeat(1025)));
    }

    #[test]
    fn history_uses_the_final_document_and_routes_popups_through_their_owner() {
        let url = "http://127.0.0.1:4000/Final?Case=Keep#fragment";
        let message =
            history_message("7:tab:1", "7:tab:1:popup:1", url, "Popup title", true).unwrap();
        assert_eq!(
            message,
            serde_json::json!({
                "event": "visited", "viewId": "7:tab:1", "sourceViewId": "7:tab:1:popup:1", "url": url, "title": "Popup title"
            })
        );
        let message = history_message("7:tab:1", "7:tab:1", url, "Changed title", false).unwrap();
        assert_eq!(message["event"], "title-updated");
        assert_eq!(message["title"], "Changed title");
        assert_eq!(message["sourceViewId"], "7:tab:1");
        for url in ["about:blank", "", "file:///tmp/preview.html", "edge-error://error"] {
            assert!(history_message("7:tab:1", "7:tab:1", url, "Ignored", true).is_none());
            assert!(history_message("7:tab:1", "7:tab:1", url, "Ignored", false).is_none());
        }
    }
}
