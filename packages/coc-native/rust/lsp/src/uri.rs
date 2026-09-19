//! `file://` URI conversion.
//!
//! Windows is first class here: `file:///c%3A/src/a.cpp` and
//! `file:///C:/src/a.cpp` both have to become `C:\src\a.cpp`.

use std::path::{Path, PathBuf};

pub fn uri_to_path(uri: &str) -> Option<PathBuf> {
    let rest = uri.strip_prefix("file://")?;
    // `file://host/share` is a UNC path; `file:///x` and `file:/x` are local.
    let (authority, path) = match rest.find('/') {
        Some(0) => ("", rest),
        Some(index) => (&rest[..index], &rest[index..]),
        None => return None,
    };
    let decoded = percent_decode(path)?;
    if !authority.is_empty() {
        return Some(PathBuf::from(format!("//{authority}{decoded}")));
    }
    // A Windows path arrives as `/C:/src`; the leading slash is URI syntax, not
    // part of the path.
    let trimmed = decoded.strip_prefix('/').unwrap_or(&decoded);
    let mut chars = trimmed.chars();
    let looks_like_drive = matches!(chars.next(), Some(letter) if letter.is_ascii_alphabetic())
        && chars.next() == Some(':');
    if looks_like_drive {
        let mut drive = trimmed.to_string();
        drive.replace_range(..1, &trimmed[..1].to_ascii_uppercase());
        return Some(PathBuf::from(drive.replace('/', std::path::MAIN_SEPARATOR_STR)));
    }
    Some(PathBuf::from(decoded))
}

/// The `file://` URI for an absolute host path.
///
/// Windows drives come back out the way they went in: `C:\src\a.cpp` becomes
/// `file:///C:/src/a.cpp`, and a UNC `\\host\share` becomes `file://host/share`.
pub fn path_to_uri(path: &Path) -> String {
    let text = path.to_string_lossy().replace('\\', "/");
    if let Some(unc) = text.strip_prefix("//") {
        return format!("file://{}", encode_path(unc));
    }
    if text.starts_with('/') {
        return format!("file://{}", encode_path(&text));
    }
    // A drive-letter path, or a relative one the caller failed to absolutise;
    // either way the URI needs the root slash the path does not carry.
    format!("file:///{}", encode_path(&text))
}

/// Percent-encodes everything outside the unreserved set, leaving `/` and the
/// `:` of a drive letter alone so the result stays readable.
fn encode_path(path: &str) -> String {
    let mut out = String::with_capacity(path.len());
    for byte in path.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' | b'/' | b':' => {
                out.push(byte as char)
            }
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

fn percent_decode(text: &str) -> Option<String> {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            let hex = text.get(index + 1..index + 3)?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            index += 3;
        } else {
            out.push(bytes[index]);
            index += 1;
        }
    }
    String::from_utf8(out).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_percent_escapes_in_a_posix_path() {
        assert_eq!(uri_to_path("file:///src/a%20b%23c.cpp"), Some(PathBuf::from("/src/a b#c.cpp")));
    }

    #[test]
    fn reads_an_encoded_windows_drive() {
        assert_eq!(
            uri_to_path("file:///c%3A/src/a.cpp"),
            Some(PathBuf::from(format!("C:{sep}src{sep}a.cpp", sep = std::path::MAIN_SEPARATOR)))
        );
        assert_eq!(
            uri_to_path("file:///C:/src/a.cpp"),
            Some(PathBuf::from(format!("C:{sep}src{sep}a.cpp", sep = std::path::MAIN_SEPARATOR)))
        );
    }

    #[test]
    fn refuses_another_scheme() {
        assert_eq!(uri_to_path("coc-file://workspace/a.cpp"), None);
        assert_eq!(uri_to_path("untitled:Untitled-1"), None);
    }

    #[test]
    fn round_trips_a_posix_path_with_spaces() {
        let uri = path_to_uri(Path::new("/src/a b#c.cpp"));
        assert_eq!(uri, "file:///src/a%20b%23c.cpp");
        assert_eq!(uri_to_path(&uri), Some(PathBuf::from("/src/a b#c.cpp")));
    }

    #[test]
    fn writes_a_windows_drive_and_a_unc_share() {
        assert_eq!(path_to_uri(Path::new(r"C:\src\a.cpp")), "file:///C:/src/a.cpp");
        assert_eq!(path_to_uri(Path::new(r"\\host\share\a.cpp")), "file://host/share/a.cpp");
    }
}
