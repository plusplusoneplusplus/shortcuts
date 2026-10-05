use serde::Deserialize;
use serde_json::Value;
use std::io::{self, Write};

#[derive(Clone, Copy, Debug, Deserialize)]
pub struct Bounds {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
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
}

pub fn close_shortcut(key: u32, key_down: bool, control: bool, alt: bool) -> bool {
    key == u32::from(b'W') && key_down && control && !alt
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
    fn close_shortcut_preserves_other_keys_and_modifiers() {
        assert!(close_shortcut(u32::from(b'W'), true, true, false));
        assert!(!close_shortcut(u32::from(b'W'), false, true, false));
        assert!(!close_shortcut(u32::from(b'W'), true, false, false));
        assert!(!close_shortcut(u32::from(b'W'), true, true, true));
        assert!(!close_shortcut(u32::from(b'F'), true, true, false));
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
    }

    #[test]
    fn private_view_ids_allow_the_owner_prefix_and_public_unicode_ids() {
        assert!(allowed_view_id(&format!("123:{}", "\u{754c}".repeat(512))));
        assert!(!allowed_view_id("bad\nid"));
        assert!(!allowed_view_id(""));
        assert!(!allowed_view_id(&"x".repeat(1025)));
    }
}
