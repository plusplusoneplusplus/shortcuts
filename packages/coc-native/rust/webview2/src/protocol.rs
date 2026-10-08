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
    pub cookies: Option<Vec<ImportCookie>>,
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
    }

    #[test]
    fn private_view_ids_allow_the_owner_prefix_and_public_unicode_ids() {
        assert!(allowed_view_id(&format!("123:{}", "\u{754c}".repeat(512))));
        assert!(!allowed_view_id("bad\nid"));
        assert!(!allowed_view_id(""));
        assert!(!allowed_view_id(&"x".repeat(1025)));
    }
}
