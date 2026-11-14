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
    /// `evaluate`: JavaScript expression run in a content world (helper's own by default).
    pub expression: Option<String>,
    /// `evaluate`: `page` for the page's own world or a named isolated world.
    pub world: Option<String>,
    /// `evaluate`: frame id from `frame-navigated`; absent means the top-level frame.
    pub frame: Option<String>,
    /// `input`: one synthesized event for the web view.
    pub input: Option<Input>,
    /// `screenshot`: viewport rect in CSS pixels.
    pub rect: Option<Bounds>,
    /// `screenshot`: output size multiplier of the device pixel size, 0–1.
    pub scale: Option<f64>,
    /// `screenshot`: png or jpeg.
    pub format: Option<String>,
    /// `screenshot`: JPEG quality 0–100.
    pub quality: Option<f64>,
    /// `open`/`navigation-gate`: hold agent-driven cross-host navigations for site approval.
    pub navigation_gate: Option<bool>,
    /// `navigation-decision`: the held navigation main answers.
    pub gate_id: Option<u64>,
    /// `navigation-decision`: let the held navigation load or cancel it.
    pub allow: Option<bool>,
    /// `import-profile-cookies`: cookies added to the profile's data store.
    pub cookies: Option<Vec<ImportCookie>>,
    /// `download-decide`/`download-action`: the helper's id for a held or running download.
    pub download_id: Option<String>,
    /// `download-decide` approve: absolute path from main's native Save dialog.
    pub destination: Option<String>,
    /// `control-activity`: the control turn driving a popup, or null when it ends.
    pub turn_id: Option<String>,
}

/// Same shape as WebView2's import (`BrowserImportCookie` in coc-desktop).
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

#[derive(Debug, Deserialize, PartialEq, Eq)]
pub enum SameSite {
    #[serde(rename = "lax")]
    Lax,
    #[serde(rename = "strict")]
    Strict,
    #[serde(rename = "no_restriction")]
    None,
}

/// Most cookies one import may add; matches the WebView2 helper.
pub const MAX_IMPORT_COOKIES: usize = 200;

/// The cookie domain to store: the given domain, else the URL's host (host-only).
/// Rejects batches main should never send so nothing is added from a bad batch.
pub fn import_cookie_domain(cookie: &ImportCookie) -> Option<String> {
    let url = url::Url::parse(&cookie.url).ok()?;
    if !matches!(url.scheme(), "http" | "https")
        || cookie.name.is_empty()
        || !cookie.path.starts_with('/')
        || cookie.expiration_date.is_some_and(|expiry| !expiry.is_finite())
    {
        return None;
    }
    let domain = cookie.domain.clone().or_else(|| url.host_str().map(str::to_string))?;
    (!domain.is_empty()).then_some(domain)
}

/// RFC 6265 domain and path matching for counting the cookies a URL would send.
/// `domain` uses NSHTTPCookie's form: a leading dot means the domain and its subdomains.
pub fn cookie_matches(url: &url::Url, domain: &str, path: &str, secure: bool) -> bool {
    let Some(host) = url.host_str().map(str::to_ascii_lowercase) else {
        return false;
    };
    if secure && url.scheme() != "https" {
        return false;
    }
    let domain = domain.to_ascii_lowercase();
    let domain_match = match domain.strip_prefix('.') {
        Some(base) => host == base || host.ends_with(&format!(".{base}")),
        None => host == domain,
    };
    let request_path = url.path();
    let path_match = request_path == path
        || (request_path.starts_with(path)
            && (path.ends_with('/') || request_path[path.len()..].starts_with('/')));
    domain_match && path_match
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum MouseAction {
    Move,
    Down,
    Up,
    Wheel,
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum KeyAction {
    Down,
    Up,
    Char,
}

/// Synthesized input in CSS pixels of the viewport, mirroring the desktop's
/// `BrowserControlMouseInput`/`BrowserControlKeyInput`.
#[derive(Debug, Clone, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Input {
    #[serde(rename_all = "camelCase")]
    Mouse {
        #[serde(rename = "type")]
        action: MouseAction,
        x: f64,
        y: f64,
        click_count: Option<i64>,
        delta_x: Option<f64>,
        delta_y: Option<f64>,
    },
    #[serde(rename_all = "camelCase")]
    Key {
        #[serde(rename = "type")]
        action: KeyAction,
        key: Option<String>,
        code: Option<String>,
        /// Bit mask: 1 Alt, 2 Control, 4 Meta, 8 Shift.
        modifiers: Option<u32>,
        text: Option<String>,
        unmodified_text: Option<String>,
        commands: Option<Vec<String>>,
    },
    Text {
        text: String,
    },
}

pub const MAX_INPUT_TEXT_CHARS: usize = 65_536;

pub fn allowed_point(x: f64, y: f64) -> bool {
    x.is_finite() && y.is_finite() && (-1.0e6..=1.0e6).contains(&x) && (-1.0e6..=1.0e6).contains(&y)
}

/// Mac virtual key code (kVK_*) of a DOM `code`; unknown codes map to none.
pub fn mac_key_code(code: &str) -> Option<u16> {
    const LETTERS: [u16; 26] = [
        0, 11, 8, 2, 14, 3, 5, 4, 34, 38, 40, 37, 46, 45, 31, 35, 12, 15, 1, 17, 32, 9, 13, 7, 16,
        6,
    ];
    const DIGITS: [u16; 10] = [29, 18, 19, 20, 21, 23, 22, 26, 28, 25];
    const FUNCTION: [u16; 12] = [122, 120, 99, 118, 96, 97, 98, 100, 101, 109, 103, 111];
    if let Some(letter) = code.strip_prefix("Key").filter(|rest| rest.len() == 1) {
        let byte = letter.as_bytes()[0];
        return byte.is_ascii_uppercase().then(|| LETTERS[(byte - b'A') as usize]);
    }
    if let Some(digit) = code.strip_prefix("Digit").and_then(|rest| rest.parse::<usize>().ok()) {
        return DIGITS.get(digit).copied();
    }
    if let Some(number) = code.strip_prefix('F').and_then(|rest| rest.parse::<usize>().ok()) {
        return number.checked_sub(1).and_then(|index| FUNCTION.get(index)).copied();
    }
    Some(match code {
        "Enter" => 36,
        "Tab" => 48,
        "Space" => 49,
        "Backspace" => 51,
        "Escape" => 53,
        "Delete" => 117,
        "Home" => 115,
        "End" => 119,
        "PageUp" => 116,
        "PageDown" => 121,
        "ArrowLeft" => 123,
        "ArrowRight" => 124,
        "ArrowDown" => 125,
        "ArrowUp" => 126,
        "Minus" => 27,
        "Equal" => 24,
        "BracketLeft" => 33,
        "BracketRight" => 30,
        "Backslash" => 42,
        "Semicolon" => 41,
        "Quote" => 39,
        "Comma" => 43,
        "Period" => 47,
        "Slash" => 44,
        "Backquote" => 50,
        _ => return None,
    })
}

/// The DOM `code` of a single typed letter or digit, for `char` input without a code.
pub fn letter_code(characters: &str) -> Option<String> {
    let mut chars = characters.chars();
    let first = chars.next().filter(|_| chars.next().is_none())?;
    if first.is_ascii_alphabetic() {
        Some(format!("Key{}", first.to_ascii_uppercase()))
    } else if first.is_ascii_digit() {
        Some(format!("Digit{first}"))
    } else {
        None
    }
}

/// Named isolated worlds; `page` is reserved for the page's own world.
pub fn allowed_world(name: &str) -> bool {
    name != "page"
        && !name.is_empty()
        && name.len() <= 128
        && name.bytes().all(|c| c.is_ascii_alphanumeric() || matches!(c, b'_' | b'-' | b'.' | b':'))
}

/// AppKit `characters` for a key event: the typed text, or the control/function
/// character AppKit reports for a named key.
pub fn key_characters(key: &str, text: Option<&str>) -> String {
    if let Some(text) = text.filter(|text| !text.is_empty()) {
        return text.to_string();
    }
    let function = |offset: u32| char::from_u32(0xF700 + offset).unwrap().to_string();
    match key {
        "Enter" => "\r".into(),
        "Tab" => "\t".into(),
        "Backspace" => "\u{7f}".into(),
        "Escape" => "\u{1b}".into(),
        " " => " ".into(),
        "ArrowUp" => function(0),
        "ArrowDown" => function(1),
        "ArrowLeft" => function(2),
        "ArrowRight" => function(3),
        "Delete" => function(0x28),
        "Home" => function(0x29),
        "End" => function(0x2B),
        "PageUp" => function(0x2C),
        "PageDown" => function(0x2D),
        _ => match key.strip_prefix('F').and_then(|rest| rest.parse::<u32>().ok()) {
            Some(number @ 1..=12) => function(3 + number),
            _ if key.chars().count() == 1 => key.to_string(),
            _ => String::new(),
        },
    }
}

/// Editing commands a key may perform (`commands`), as responder selectors.
pub fn editing_selector(command: &str) -> Option<String> {
    const ALLOWED: [&str; 8] =
        ["selectAll", "copy", "cut", "paste", "undo", "redo", "deleteBackward", "deleteForward"];
    ALLOWED.contains(&command).then(|| format!("{command}:"))
}

/// Validated screenshot output size in pixels for a viewport rect.
pub fn screenshot_pixels(rect: &Bounds, device_scale: f64, scale: f64) -> Option<(usize, usize)> {
    let valid = |value: f64| value.is_finite() && value > 0.0;
    if !valid(rect.width)
        || !valid(rect.height)
        || !valid(device_scale)
        || !valid(scale)
        || scale > 1.0
    {
        return None;
    }
    let width = (rect.width * device_scale * scale).round().max(1.0);
    let height = (rect.height * device_scale * scale).round().max(1.0);
    let pixels = width * height;
    (width <= 16384.0 && height <= 16384.0 && pixels <= MAX_ANNOTATION_PIXELS as f64)
        .then_some((width as usize, height as usize))
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

/// Same rule as WebView2: a turn id main can show and send back in `control-stop`.
pub fn allowed_control_turn(turn: Option<&str>) -> bool {
    turn.is_none_or(|id| !id.is_empty() && id.len() <= 512 && !id.chars().any(char::is_control))
}

/// Height in points of the popup's "AI controlling" bar above its page; never taller
/// than the window content.
pub fn control_bar_height(content_height: f64, active: bool) -> f64 {
    if active {
        40.0_f64.min(content_height.max(0.0))
    } else {
        0.0
    }
}

/// While a control turn drives the view, a new document on another host must wait for site
/// approval. Same-host loads stay on an already-shown site; back/forward and reload are not
/// new pages unless they redirect. Non-HTTP(S) targets are never asked about. Same rule as
/// the WebView2 helper.
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

/// Exact origins approved for one view's active control lease, never shared across views.
#[derive(Default)]
pub struct NavigationApprovals(std::collections::HashSet<String>);

impl NavigationApprovals {
    fn origin(value: &str) -> Option<String> {
        url::Url::parse(value)
            .ok()
            .filter(|url| matches!(url.scheme(), "http" | "https"))
            .map(|url| url.origin().ascii_serialization())
    }

    pub fn allow(&mut self, value: &str) {
        if let Some(origin) = Self::origin(value) {
            if self.0.len() < 256 {
                self.0.insert(origin);
            }
        }
    }

    pub fn contains(&self, value: &str) -> bool {
        Self::origin(value).is_some_and(|origin| self.0.contains(&origin))
    }

    pub fn clear(&mut self) {
        self.0.clear();
    }
}

pub fn annotation_preview_size_allowed(width: i64, height: i64) -> bool {
    width > 0
        && height > 0
        && width.checked_mul(height).is_some_and(|pixels| pixels <= MAX_ANNOTATION_PIXELS as i64)
}

/// Base64 PNG data as a `data:` URL when the decoded PNG fits the annotation limit.
pub fn annotation_data_url(base64: &str) -> Option<String> {
    let padding = base64.bytes().rev().take_while(|byte| *byte == b'=').count();
    let decoded = (base64.len() / 4 * 3).checked_sub(padding)?;
    (!base64.is_empty() && base64.len().is_multiple_of(4) && decoded <= MAX_ANNOTATION_PNG_BYTES)
        .then(|| format!("data:image/png;base64,{base64}"))
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

/// A failed load rejected the server certificate (bad date, untrusted, unknown root,
/// not yet valid, client certificate rejected or required). A plain TLS failure
/// (-1200) is a connection error, as it is for Chromium.
pub fn certificate_error(domain: &str, code: i64) -> bool {
    domain == "NSURLErrorDomain" && (-1206..=-1201).contains(&code)
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

/// Main supplies the destination from its native Save dialog, never a page or renderer:
/// an absolute path of plain components.
pub fn allowed_download_destination(value: &str) -> bool {
    value.len() <= 1024
        && !value.chars().any(char::is_control)
        && value.strip_prefix('/').is_some_and(|tail| {
            tail.split('/')
                .all(|part| !part.is_empty() && part != "." && part != ".." && part.len() <= 255)
        })
}

/// WebKit saves a response it cannot show, or one the server marks as an attachment.
pub fn download_response(can_show: bool, disposition: Option<&str>) -> bool {
    !can_show
        || disposition.is_some_and(|value| {
            value.split(';').next().unwrap_or_default().trim().eq_ignore_ascii_case("attachment")
        })
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

    #[test]
    fn control_activity_turns_and_bar_height() {
        let command =
            read(b"{\"id\":1,\"op\":\"control-activity\",\"viewId\":\"7:tab:1:popup:1\",\"turnId\":\"turn\"}\n")
                .unwrap()
                .unwrap();
        assert_eq!(command.turn_id.as_deref(), Some("turn"));
        let command =
            read(b"{\"id\":2,\"op\":\"control-activity\",\"viewId\":\"7:tab:1:popup:1\",\"turnId\":null}\n")
                .unwrap()
                .unwrap();
        assert!(command.turn_id.is_none());
        assert!(allowed_control_turn(None));
        assert!(allowed_control_turn(Some("turn-1")));
        assert!(!allowed_control_turn(Some("")));
        assert!(!allowed_control_turn(Some("a\nb")));
        assert!(!allowed_control_turn(Some(&"x".repeat(513))));
        assert_eq!(control_bar_height(600.0, true), 40.0);
        assert_eq!(control_bar_height(600.0, false), 0.0);
        assert_eq!(control_bar_height(25.0, true), 25.0);
        assert_eq!(control_bar_height(-1.0, true), 0.0);
    }

    #[test]
    fn import_cookies_parse_and_validate() {
        let command = read(br#"{"id":1,"op":"import-profile-cookies","cookies":[{"url":"https://app.example.com/","name":"session","value":"token","domain":".example.com","path":"/","secure":true,"httpOnly":true,"sameSite":"no_restriction","expirationDate":2000000000}]}
"#).unwrap().unwrap();
        let cookies = command.cookies.unwrap();
        assert_eq!(cookies[0].same_site, SameSite::None);
        assert_eq!(import_cookie_domain(&cookies[0]).as_deref(), Some(".example.com"));
        for invalid in [
            r#"{"id":1,"op":"import-profile-cookies","cookies":[{"name":"a"}]}"#,
            r#"{"id":1,"op":"import-profile-cookies","cookies":"a=b"}"#,
            r#"{"id":1,"op":"import-profile-cookies","script":"unsafe"}"#,
        ] {
            assert!(read(format!("{invalid}\n").as_bytes()).unwrap().is_err(), "{invalid}");
        }
        let cookie = |url: &str, path: &str, domain: Option<&str>| ImportCookie {
            url: url.into(),
            name: "a".into(),
            value: "b".into(),
            domain: domain.map(str::to_string),
            path: path.into(),
            secure: false,
            http_only: false,
            same_site: SameSite::Lax,
            expiration_date: None,
        };
        assert_eq!(
            import_cookie_domain(&cookie("http://host.test:8080/x", "/", None)).as_deref(),
            Some("host.test")
        );
        assert!(import_cookie_domain(&cookie("file:///tmp/a", "/", None)).is_none());
        assert!(import_cookie_domain(&cookie("https://host.test/", "x", None)).is_none());
        assert!(import_cookie_domain(&cookie("https://host.test/", "/", Some(""))).is_none());
    }

    #[test]
    fn cookies_match_like_a_browser_sends_them() {
        let url = |value: &str| url::Url::parse(value).unwrap();
        let page = url("https://app.example.com/docs/page");
        assert!(cookie_matches(&page, ".example.com", "/", true));
        assert!(cookie_matches(&page, ".app.example.com", "/docs", false));
        assert!(cookie_matches(&page, "APP.example.com", "/docs/", false));
        assert!(!cookie_matches(&page, "example.com", "/", false), "host-only");
        assert!(!cookie_matches(&page, ".other.com", "/", false));
        assert!(!cookie_matches(&page, ".ample.com", "/", false));
        assert!(!cookie_matches(&page, ".example.com", "/doc", false), "partial segment");
        assert!(!cookie_matches(&page, ".example.com", "/admin", false));
        assert!(!cookie_matches(&url("http://app.example.com/"), ".example.com", "/", true));
        assert!(cookie_matches(&url("http://app.example.com/"), ".example.com", "/", false));
    }

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
    fn only_server_certificate_failures_are_certificate_errors() {
        assert!(certificate_error("NSURLErrorDomain", -1202));
        assert!(certificate_error("NSURLErrorDomain", -1201));
        assert!(certificate_error("NSURLErrorDomain", -1206));
        assert!(!certificate_error("NSURLErrorDomain", -1200));
        assert!(!certificate_error("NSURLErrorDomain", -1004));
        assert!(!certificate_error("WebKitErrorDomain", -1202));
    }

    #[test]
    fn annotation_previews_are_pixel_bounded() {
        assert!(annotation_preview_size_allowed(4096, 4096));
        assert!(!annotation_preview_size_allowed(4097, 4096));
        assert!(!annotation_preview_size_allowed(0, 10));
        assert!(!annotation_preview_size_allowed(i64::MAX, 2));
    }

    #[test]
    fn annotation_data_urls_are_byte_bounded_base64() {
        assert_eq!(annotation_data_url("iVBO").as_deref(), Some("data:image/png;base64,iVBO"));
        assert!(annotation_data_url("").is_none());
        assert!(annotation_data_url("iVB").is_none());
        let limit = MAX_ANNOTATION_PNG_BYTES / 3 * 4;
        assert!(annotation_data_url(&"A".repeat(limit)).is_some());
        // `limit` chars decode to MAX - 2 bytes; each padded tail adds one or two more.
        assert!(annotation_data_url(&format!("{}AAA=", "A".repeat(limit))).is_some());
        assert!(annotation_data_url(&format!("{}AAAA", "A".repeat(limit))).is_none());
    }

    #[test]
    fn input_commands_parse_tagged_mouse_key_and_text_events() {
        let command = read(
            br#"{"id":1,"op":"input","viewId":"v","input":{"kind":"mouse","type":"down","x":10,"y":20.5,"clickCount":1}}
"#,
        )
        .unwrap()
        .unwrap();
        assert_eq!(
            command.input,
            Some(Input::Mouse {
                action: MouseAction::Down,
                x: 10.0,
                y: 20.5,
                click_count: Some(1),
                delta_x: None,
                delta_y: None
            })
        );
        let command = read(
            br#"{"id":2,"op":"input","viewId":"v","input":{"kind":"key","type":"down","key":"a","code":"KeyA","modifiers":4,"commands":["selectAll"]}}
"#,
        )
        .unwrap()
        .unwrap();
        assert!(matches!(
            command.input,
            Some(Input::Key { action: KeyAction::Down, modifiers: Some(4), .. })
        ));
        let command = read(
            br#"{"id":3,"op":"input","viewId":"v","input":{"kind":"text","text":"hi"}}
"#,
        )
        .unwrap()
        .unwrap();
        assert_eq!(command.input, Some(Input::Text { text: "hi".into() }));
        for invalid in [
            &br#"{"id":4,"op":"input","input":{"kind":"mouse","type":"drag","x":1,"y":1}}
"#[..],
            &br#"{"id":5,"op":"input","input":{"kind":"touch"}}
"#[..],
        ] {
            assert!(read(invalid).unwrap().is_err());
        }
    }

    #[test]
    fn keys_map_to_mac_key_codes_and_appkit_characters() {
        assert_eq!(mac_key_code("KeyA"), Some(0));
        assert_eq!(mac_key_code("KeyZ"), Some(6));
        assert_eq!(mac_key_code("Digit1"), Some(18));
        assert_eq!(mac_key_code("Digit0"), Some(29));
        assert_eq!(mac_key_code("F12"), Some(111));
        assert_eq!(mac_key_code("Enter"), Some(36));
        assert_eq!(mac_key_code("ArrowDown"), Some(125));
        assert_eq!(mac_key_code("Keya"), None);
        assert_eq!(mac_key_code("F13"), None);
        assert_eq!(mac_key_code("Unknown"), None);
        assert_eq!(key_characters("a", Some("A")), "A");
        assert_eq!(key_characters("Enter", None), "\r");
        assert_eq!(key_characters("Backspace", None), "\u{7f}");
        assert_eq!(key_characters("ArrowUp", None), "\u{f700}");
        assert_eq!(key_characters("Home", None), "\u{f729}");
        assert_eq!(key_characters("F1", None), "\u{f704}");
        assert_eq!(key_characters("Shift", None), "");
        assert_eq!(letter_code("q").as_deref(), Some("KeyQ"));
        assert_eq!(letter_code("7").as_deref(), Some("Digit7"));
        assert_eq!(letter_code("ab"), None);
        assert_eq!(editing_selector("selectAll").as_deref(), Some("selectAll:"));
        assert_eq!(editing_selector("terminate"), None);
    }

    #[test]
    fn worlds_points_and_screenshot_sizes_are_bounded() {
        assert!(allowed_world("coc-annotation:1"));
        assert!(!allowed_world("page"));
        assert!(!allowed_world(""));
        assert!(!allowed_world("has space"));
        assert!(allowed_point(-10.0, 5.0));
        assert!(!allowed_point(f64::NAN, 0.0));
        assert!(!allowed_point(2.0e6, 0.0));
        let rect = Bounds { x: 0.0, y: 0.0, width: 100.0, height: 50.0 };
        assert_eq!(screenshot_pixels(&rect, 2.0, 1.0), Some((200, 100)));
        assert_eq!(screenshot_pixels(&rect, 2.0, 0.5), Some((100, 50)));
        assert_eq!(screenshot_pixels(&rect, 2.0, 0.001), Some((1, 1)));
        assert_eq!(screenshot_pixels(&rect, 2.0, 1.5), None);
        assert_eq!(screenshot_pixels(&Bounds { width: 0.0, ..rect }, 2.0, 1.0), None);
        let huge = Bounds { x: 0.0, y: 0.0, width: 8000.0, height: 8000.0 };
        assert_eq!(screenshot_pixels(&huge, 1.0, 1.0), None);
    }

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
    }

    #[test]
    fn navigation_approvals_match_exact_origins_and_stay_bounded() {
        let mut approvals = NavigationApprovals::default();
        approvals.allow("https://portal.test/start?query=value");
        assert!(approvals.contains("https://PORTAL.test:443/return"));
        for target in [
            "http://portal.test/",
            "https://portal.test:8443/",
            "https://child.portal.test/",
            "about:blank",
        ] {
            assert!(!approvals.contains(target));
        }
        approvals.allow("about:blank");
        for index in 0..300 {
            approvals.allow(&format!("https://site{index}.test/"));
        }
        assert!(approvals.contains("https://site254.test/"));
        assert!(!approvals.contains("https://site255.test/"));
        approvals.clear();
        assert!(!approvals.contains("https://portal.test/"));
    }

    #[test]
    fn gate_commands_parse() {
        let open: Command = serde_json::from_str(
            r#"{"id":1,"op":"open","viewId":"7:tab:1","url":"https://a.test/","navigationGate":true}"#,
        )
        .unwrap();
        assert_eq!(open.navigation_gate, Some(true));
        let decision: Command = serde_json::from_str(
            r#"{"id":2,"op":"navigation-decision","viewId":"7:tab:1","gateId":3,"allow":false}"#,
        )
        .unwrap();
        assert_eq!((decision.gate_id, decision.allow), (Some(3), Some(false)));
    }

    #[test]
    fn download_destinations_are_plain_absolute_paths() {
        for path in ["/Users/me/Downloads/file.zip", "/tmp/a b/file", "/f"] {
            assert!(allowed_download_destination(path), "{path}");
        }
        let long = format!("/{}", "a".repeat(256));
        for path in [
            "",
            "/",
            "relative/file",
            "~/file",
            "/a/../file",
            "/a/./file",
            "/a//file",
            "/a/file/",
            "/a/\0file",
            "/a/\nfile",
            long.as_str(),
        ] {
            assert!(!allowed_download_destination(path), "{path:?}");
        }
        assert!(!allowed_download_destination(&format!("/{}", "a/".repeat(600))));
    }

    #[test]
    fn responses_download_when_unshowable_or_attachments() {
        assert!(download_response(false, None));
        assert!(download_response(true, Some("attachment")));
        assert!(download_response(true, Some(" Attachment ; filename=\"a.txt\"")));
        assert!(!download_response(true, Some("inline; filename=a.txt")));
        assert!(!download_response(true, Some("attachments")));
        assert!(!download_response(true, None));
    }
}
