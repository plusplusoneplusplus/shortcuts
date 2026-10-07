//! Blob read/write: the MIME map, the text/binary read caps and NUL-probe binary
//! detection the Explorer's file viewer depends on.

use std::fs;
use std::io::Read;
use std::path::Path;

use base64::Engine;

use super::{resolve_in_root, RepoFilesError};

/// Binary/image read cap (also used by content replacement).
pub const MAX_BLOB_SIZE: u64 = 1024 * 1024;

/// Explorer source-text read cap in UTF-8 bytes.
pub const MAX_TEXT_BLOB_SIZE: u64 = 10 * 1024 * 1024;

/// A file is binary when a NUL byte appears in its first 8 KiB.
const BINARY_PROBE_SIZE: usize = 8192;

/// File content as the blob route returns it.
#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(
    feature = "napi",
    napi_derive::napi(object, object_from_js = false, js_name = "RepoBlob")
)]
pub struct Blob {
    /// UTF-8 text, or base64 when the file looks binary.
    pub content: String,
    #[cfg_attr(feature = "napi", napi(ts_type = "'utf-8' | 'base64'"))]
    pub encoding: &'static str,
    pub mime_type: &'static str,
}

/// MIME type by lower-cased extension. Like Node's `path.extname`, a dotfile
/// such as `.env` has no extension. Aliases share one mapping per MIME type.
pub fn mime_type(path: &Path) -> &'static str {
    let ext = path.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
    match ext.as_str() {
        "js" | "mjs" | "cjs" | "jsx" => "application/javascript",
        "ts" | "tsx" => "application/typescript",
        "json" => "application/json",
        "html" | "htm" => "text/html",
        "css" => "text/css",
        "md" | "markdown" => "text/markdown",
        "txt" | "env" | "log" | "lock" => "text/plain",
        "xml" => "application/xml",
        "yaml" | "yml" => "application/x-yaml",
        "toml" => "application/toml",
        "sh" | "bash" => "application/x-sh",
        "py" => "text/x-python",
        "rb" => "text/x-ruby",
        "go" => "text/x-go",
        "rs" => "text/x-rust",
        "java" => "text/x-java",
        "c" | "h" => "text/x-c",
        "cpp" | "hpp" => "text/x-c++",
        "cs" => "text/x-csharp",
        "swift" => "text/x-swift",
        "kt" => "text/x-kotlin",
        "scala" => "text/x-scala",
        "php" => "text/x-php",
        "sql" => "application/sql",
        "graphql" => "application/graphql",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "ico" => "image/x-icon",
        "pdf" => "application/pdf",
        "zip" => "application/zip",
        "gz" => "application/gzip",
        "tar" => "application/x-tar",
        "wasm" => "application/wasm",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "ttf" => "font/ttf",
        "eot" => "application/vnd.ms-fontobject",
        "csv" => "text/csv",
        _ => "application/octet-stream",
    }
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
    let mime_type = mime_type(&path);
    let mut file = fs::File::open(&path)?;
    let mut bytes = Vec::new();
    (&mut file).take(BINARY_PROBE_SIZE as u64).read_to_end(&mut bytes)?;
    let binary = is_binary(&bytes);
    // Image previews retain their existing cap, including text-based SVGs.
    let limit =
        if binary || mime_type.starts_with("image/") { MAX_BLOB_SIZE } else { MAX_TEXT_BLOB_SIZE };
    let too_large = || {
        if limit == MAX_BLOB_SIZE {
            RepoFilesError::TooLarge(relative.to_owned())
        } else {
            RepoFilesError::TextTooLarge(relative.to_owned())
        }
    };
    if metadata.len() > limit {
        return Err(too_large());
    }
    // Bound the read even if the file grows after stat.
    file.take(limit + 1 - bytes.len() as u64).read_to_end(&mut bytes)?;
    if bytes.len() as u64 > limit {
        return Err(too_large());
    }
    if binary {
        let content = base64::engine::general_purpose::STANDARD.encode(&bytes);
        return Ok(Blob { content, encoding: "base64", mime_type });
    }
    let content = String::from_utf8_lossy(&bytes).into_owned();
    Ok(Blob { content, encoding: "utf-8", mime_type })
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
