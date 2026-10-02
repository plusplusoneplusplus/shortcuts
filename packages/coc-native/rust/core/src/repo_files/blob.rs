//! Blob read/write: the MIME map, the 1 MiB read cap and NUL-probe binary
//! detection the Explorer's file viewer depends on.

use std::fs;
use std::path::Path;

use base64::Engine;

use super::{resolve_in_root, RepoFilesError};

/// Largest file `read_blob` returns.
pub const MAX_BLOB_SIZE: u64 = 1024 * 1024;

/// A file is binary when a NUL byte appears in its first 8 KiB.
const BINARY_PROBE_SIZE: usize = 8192;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BlobEncoding {
    Utf8,
    Base64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Blob {
    pub content: String,
    pub encoding: BlobEncoding,
    pub mime_type: &'static str,
}

const MIME_MAP: &[(&str, &str)] = &[
    ("js", "application/javascript"),
    ("mjs", "application/javascript"),
    ("cjs", "application/javascript"),
    ("ts", "application/typescript"),
    ("tsx", "application/typescript"),
    ("jsx", "application/javascript"),
    ("json", "application/json"),
    ("html", "text/html"),
    ("htm", "text/html"),
    ("css", "text/css"),
    ("md", "text/markdown"),
    ("markdown", "text/markdown"),
    ("txt", "text/plain"),
    ("xml", "application/xml"),
    ("yaml", "application/x-yaml"),
    ("yml", "application/x-yaml"),
    ("toml", "application/toml"),
    ("sh", "application/x-sh"),
    ("bash", "application/x-sh"),
    ("py", "text/x-python"),
    ("rb", "text/x-ruby"),
    ("go", "text/x-go"),
    ("rs", "text/x-rust"),
    ("java", "text/x-java"),
    ("c", "text/x-c"),
    ("cpp", "text/x-c++"),
    ("h", "text/x-c"),
    ("hpp", "text/x-c++"),
    ("cs", "text/x-csharp"),
    ("swift", "text/x-swift"),
    ("kt", "text/x-kotlin"),
    ("scala", "text/x-scala"),
    ("php", "text/x-php"),
    ("sql", "application/sql"),
    ("graphql", "application/graphql"),
    ("svg", "image/svg+xml"),
    ("png", "image/png"),
    ("jpg", "image/jpeg"),
    ("jpeg", "image/jpeg"),
    ("gif", "image/gif"),
    ("webp", "image/webp"),
    ("ico", "image/x-icon"),
    ("pdf", "application/pdf"),
    ("zip", "application/zip"),
    ("gz", "application/gzip"),
    ("tar", "application/x-tar"),
    ("wasm", "application/wasm"),
    ("woff", "font/woff"),
    ("woff2", "font/woff2"),
    ("ttf", "font/ttf"),
    ("eot", "application/vnd.ms-fontobject"),
    ("env", "text/plain"),
    ("log", "text/plain"),
    ("csv", "text/csv"),
    ("lock", "text/plain"),
];

/// MIME type by lower-cased extension. Like Node's `path.extname`, a dotfile
/// such as `.env` has no extension.
pub fn mime_type(path: &Path) -> &'static str {
    let ext = path.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
    MIME_MAP.iter().find(|(key, _)| *key == ext).map_or("application/octet-stream", |(_, m)| m)
}

/// Read a file as UTF-8 text, or as base64 when it looks binary. Invalid UTF-8
/// is replaced with U+FFFD, as `buffer.toString('utf-8')` does.
pub fn read_blob(root: &Path, relative: &str) -> Result<Blob, RepoFilesError> {
    let path = resolve_in_root(root, relative)?;
    let metadata =
        fs::metadata(&path).map_err(|_| RepoFilesError::NotFound(relative.to_owned()))?;
    if !metadata.is_file() {
        return Err(RepoFilesError::NotAFile(relative.to_owned()));
    }
    if metadata.len() > MAX_BLOB_SIZE {
        return Err(RepoFilesError::TooLarge(relative.to_owned()));
    }
    let bytes = fs::read(&path)?;
    let mime_type = mime_type(&path);
    if is_binary(&bytes) {
        let content = base64::engine::general_purpose::STANDARD.encode(&bytes);
        return Ok(Blob { content, encoding: BlobEncoding::Base64, mime_type });
    }
    let content = String::from_utf8_lossy(&bytes).into_owned();
    Ok(Blob { content, encoding: BlobEncoding::Utf8, mime_type })
}

/// A NUL byte in the first 8 KiB marks a file as binary.
pub(super) fn is_binary(bytes: &[u8]) -> bool {
    bytes.iter().take(BINARY_PROBE_SIZE).any(|&b| b == 0)
}

/// Write text to a file, creating missing parent directories. Not atomic: the
/// file is written in place, as it always has been.
pub fn write_blob(root: &Path, relative: &str, content: &str) -> Result<(), RepoFilesError> {
    let path = resolve_in_root(root, relative)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(&path, content)?;
    Ok(())
}
