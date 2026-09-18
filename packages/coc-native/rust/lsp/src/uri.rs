//! `file://` URI conversion.
//!
//! Windows is first class here: `file:///c%3A/src/a.cpp` and
//! `file:///C:/src/a.cpp` both have to become `C:\src\a.cpp`.

use std::path::PathBuf;

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
}
