use serde::Deserialize;
use serde_json::Value;
use std::io::{self, Write};

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
}

pub fn cdp_arguments(command: &Command) -> Option<(&str, String)> {
    let method = command.method.as_deref()?;
    // A protocol method is Domain.command, not a script or a transport endpoint.
    let (domain, name) = method.split_once('.')?;
    if domain.is_empty()
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

pub fn history_message(view_id: &str, url: &str, title: &str, visit: bool) -> Option<Value> {
    allowed_url(url, false).then(|| {
        serde_json::json!({
            "event": if visit { "visited" } else { "title-updated" },
            "viewId": view_id, "url": url, "title": title.chars().take(4096).collect::<String>()
        })
    })
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
        let event = history_message("owned-view", "https://fixture.test/", &title, true).unwrap();
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
        let message = history_message("7:tab:1", url, "Popup title", true).unwrap();
        assert_eq!(
            message,
            serde_json::json!({
                "event": "visited", "viewId": "7:tab:1", "url": url, "title": "Popup title"
            })
        );
        let message = history_message("7:tab:1", url, "Changed title", false).unwrap();
        assert_eq!(message["event"], "title-updated");
        assert_eq!(message["title"], "Changed title");
        for url in ["about:blank", "", "file:///tmp/preview.html", "edge-error://error"] {
            assert!(history_message("7:tab:1", url, "Ignored", true).is_none());
            assert!(history_message("7:tab:1", url, "Ignored", false).is_none());
        }
    }
}
