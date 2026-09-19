//! LSP base-protocol framing over a byte stream.
//!
//! The Node side of this transport already has an equivalent in
//! `packages/coc/src/server/language-servers/jsonrpc.ts`; the rules here mirror
//! it deliberately. Headers are ASCII and case-insensitive, `Content-Length` is
//! a byte count rather than a character count, and any other header is ignored.

use std::io::{self, BufRead, Write};

/// Refuse a declared length above this instead of allocating for it. A peer
/// that can ask for a gigabyte buffer with eight bytes of header is a denial of
/// service, not a large request.
const MAX_MESSAGE_BYTES: usize = 64 * 1024 * 1024;

/// Reads one framed message, returning `None` at a clean end of stream.
pub fn read_message(reader: &mut impl BufRead) -> io::Result<Option<Vec<u8>>> {
    let mut content_length: Option<usize> = None;
    loop {
        let mut line = String::new();
        if reader.read_line(&mut line)? == 0 {
            // End of stream. A half-read header block is still a clean exit as
            // far as this server is concerned: the parent went away.
            return Ok(None);
        }
        let line = line.trim_end_matches(['\r', '\n']);
        if line.is_empty() {
            break;
        }
        let Some((name, value)) = line.split_once(':') else {
            // Unusable header. Skip it rather than aborting, so one bad line
            // does not take the stream down.
            continue;
        };
        if name.trim().eq_ignore_ascii_case("content-length") {
            content_length = value.trim().parse::<usize>().ok();
        }
    }
    let length = content_length.ok_or_else(|| {
        io::Error::new(io::ErrorKind::InvalidData, "message header carried no Content-Length")
    })?;
    if length > MAX_MESSAGE_BYTES {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            format!("declared Content-Length {length} exceeds {MAX_MESSAGE_BYTES}"),
        ));
    }
    let mut body = vec![0u8; length];
    reader.read_exact(&mut body)?;
    Ok(Some(body))
}

/// Writes one framed message. The header declares the body's *byte* length.
pub fn write_message(writer: &mut impl Write, body: &[u8]) -> io::Result<()> {
    write!(writer, "Content-Length: {}\r\n\r\n", body.len())?;
    writer.write_all(body)?;
    writer.flush()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    fn framed(body: &str) -> Vec<u8> {
        let mut out = Vec::new();
        write_message(&mut out, body.as_bytes()).unwrap();
        out
    }

    #[test]
    fn round_trips_a_message() {
        let mut reader = Cursor::new(framed(r#"{"id":1}"#));
        let message = read_message(&mut reader).unwrap().unwrap();
        assert_eq!(message, br#"{"id":1}"#);
        assert!(read_message(&mut reader).unwrap().is_none());
    }

    #[test]
    fn declares_byte_length_not_character_length() {
        let body = r#"{"name":"é"}"#;
        let bytes = framed(body);
        let header = String::from_utf8_lossy(&bytes[..bytes.len() - body.len()]).to_string();
        assert!(header.contains(&format!("Content-Length: {}", body.len())));
        let mut reader = Cursor::new(bytes);
        assert_eq!(read_message(&mut reader).unwrap().unwrap(), body.as_bytes());
    }

    #[test]
    fn tolerates_header_casing_and_unknown_headers() {
        let mut raw = b"content-length: 8\r\nX-Other: 1\r\n\r\n".to_vec();
        raw.extend_from_slice(br#"{"id":1}"#);
        let mut reader = Cursor::new(raw);
        assert_eq!(read_message(&mut reader).unwrap().unwrap(), br#"{"id":1}"#);
    }

    #[test]
    fn reads_two_messages_from_one_stream() {
        let mut raw = framed(r#"{"id":1}"#);
        raw.extend(framed(r#"{"id":2}"#));
        let mut reader = Cursor::new(raw);
        assert_eq!(read_message(&mut reader).unwrap().unwrap(), br#"{"id":1}"#);
        assert_eq!(read_message(&mut reader).unwrap().unwrap(), br#"{"id":2}"#);
        assert!(read_message(&mut reader).unwrap().is_none());
    }

    #[test]
    fn refuses_a_length_above_the_cap() {
        let raw = format!("Content-Length: {}\r\n\r\n", MAX_MESSAGE_BYTES + 1);
        let mut reader = Cursor::new(raw.into_bytes());
        let error = read_message(&mut reader).unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::InvalidData);
    }

    #[test]
    fn refuses_a_header_block_without_a_length() {
        let mut reader = Cursor::new(b"X-Other: 1\r\n\r\n".to_vec());
        let error = read_message(&mut reader).unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::InvalidData);
    }
}
