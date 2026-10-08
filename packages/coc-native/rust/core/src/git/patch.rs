//! Shared unified-patch processing for host Git, supplied WSL output and remote data.
//! Parsing preserves raw bytes and source order; presentation sorting belongs to callers.

use super::status::ChangeStatus;
use super::{run_git, GitCommandOptions, GitError};
use std::path::Path;

#[cfg_attr(feature = "napi", napi_derive::napi(object, object_from_js = false))]
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PatchFile {
    pub path: String,
    pub original_path: Option<String>,
    pub status: String,
    pub additions: u32,
    pub deletions: u32,
    pub is_binary: bool,
    pub raw: String,
    pub total_lines: i64,
}

/// Split at actual file headers, retaining every newline inside each patch.
/// Preamble text (for example `git show` commit metadata) is not a file patch.
pub fn parse_patch(raw: &str) -> Vec<PatchFile> {
    let mut starts = Vec::new();
    let mut offset = 0;
    for line in raw.split_inclusive('\n') {
        if line.starts_with("diff --git ") {
            starts.push(offset);
        }
        offset += line.len();
    }
    starts.push(raw.len());
    starts.windows(2).filter_map(|pair| parse_file(&raw[pair[0]..pair[1]])).collect()
}

fn parse_file(raw: &str) -> Option<PatchFile> {
    let mut lines = raw.split('\n').map(|line| line.strip_suffix('\r').unwrap_or(line));
    let (mut before, mut after) = header_paths(lines.next()?.strip_prefix("diff --git ")?)?;
    let mut status = ChangeStatus::Modified;
    let mut additions = 0;
    let mut deletions = 0;
    let mut is_binary = false;
    let mut in_hunk = false;
    for line in lines {
        if line.starts_with("@@ ") {
            in_hunk = true;
        } else if in_hunk {
            match line.as_bytes().first() {
                Some(b'+') => additions += 1,
                Some(b'-') => deletions += 1,
                _ => {}
            }
        } else if line.starts_with("new file mode ") || line == "--- /dev/null" {
            status = ChangeStatus::Added;
        } else if line.starts_with("deleted file mode ") || line == "+++ /dev/null" {
            status = ChangeStatus::Deleted;
        } else if let Some(path) = line.strip_prefix("rename from ") {
            status = ChangeStatus::Renamed;
            before = decode_path(path)?;
        } else if let Some(path) = line.strip_prefix("copy from ") {
            status = ChangeStatus::Copied;
            before = decode_path(path)?;
        } else if let Some(path) =
            line.strip_prefix("rename to ").or_else(|| line.strip_prefix("copy to "))
        {
            after = decode_path(path)?;
        } else if let Some(path) = line.strip_prefix("--- a/") {
            before = path.strip_suffix('\t').unwrap_or(path).to_string();
        } else if let Some(path) = line.strip_prefix("+++ b/") {
            after = path.strip_suffix('\t').unwrap_or(path).to_string();
        } else if line.starts_with("Binary files ") || line == "GIT binary patch" {
            is_binary = true;
        }
    }
    let original_path = matches!(status, ChangeStatus::Renamed | ChangeStatus::Copied)
        .then_some(before)
        .filter(|path| *path != after);
    Some(PatchFile {
        path: after,
        original_path,
        status: status.as_str().to_string(),
        additions,
        deletions,
        is_binary,
        raw: raw.to_string(),
        total_lines: raw.split('\n').count() as i64,
    })
}

fn header_paths(header: &str) -> Option<(String, String)> {
    let (before, after) = if header.starts_with('"') {
        let (before, rest) = quoted_path(header)?;
        (before, decode_path(rest.strip_prefix(' ')?)?)
    } else {
        // Unquoted Git paths may contain spaces, including the apparent separator.
        // An unchanged path has a unique split where both prefixed names agree.
        let split = header
            .match_indices(" b/")
            .find(|(i, _)| header[..*i].strip_prefix("a/") == header[*i + 1..].strip_prefix("b/"))
            .map(|(i, _)| i)
            .or_else(|| header.rfind(" \"b/"))
            .or_else(|| header.rfind(" b/"))?;
        (decode_path(&header[..split])?, decode_path(&header[split + 1..])?)
    };
    Some((before.strip_prefix("a/")?.to_string(), after.strip_prefix("b/")?.to_string()))
}

fn decode_path(path: &str) -> Option<String> {
    if path.starts_with('"') {
        let (decoded, rest) = quoted_path(path)?;
        rest.is_empty().then_some(decoded)
    } else {
        Some(path.to_string())
    }
}

/// Decode Git's C quoting, including octal-escaped UTF-8 bytes. Malformed
/// quoting drops the file rather than assigning its patch to a fabricated path.
fn quoted_path(path: &str) -> Option<(String, &str)> {
    let bytes = path.as_bytes();
    let mut decoded = Vec::new();
    let mut i = 1;
    while i < bytes.len() {
        match bytes[i] {
            b'"' => return Some((String::from_utf8_lossy(&decoded).into_owned(), &path[i + 1..])),
            b'\\' => {
                i += 1;
                let byte = *bytes.get(i)?;
                decoded.push(match byte {
                    b'a' => 7,
                    b'b' => 8,
                    b't' => b'\t',
                    b'n' => b'\n',
                    b'v' => 11,
                    b'f' => 12,
                    b'r' => b'\r',
                    b'\\' | b'"' => byte,
                    b'0'..=b'3' => {
                        let second = *bytes.get(i + 1)?;
                        let third = *bytes.get(i + 2)?;
                        if !(b'0'..=b'7').contains(&second) || !(b'0'..=b'7').contains(&third) {
                            return None;
                        }
                        i += 2;
                        (byte - b'0') * 64 + (second - b'0') * 8 + (third - b'0')
                    }
                    _ => return None,
                });
            }
            byte => decoded.push(byte),
        }
        i += 1;
    }
    None
}

#[cfg_attr(feature = "napi", napi_derive::napi(object, object_from_js = false))]
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PatchContent {
    pub raw: String,
    pub truncated: bool,
    pub total_lines: i64,
}

#[cfg_attr(feature = "napi", napi_derive::napi(object, object_from_js = false))]
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PatchSummary {
    pub files_changed: u32,
    pub additions: u32,
    pub deletions: u32,
}

#[cfg_attr(feature = "napi", napi_derive::napi(object, object_from_js = false))]
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PatchResult {
    pub files: Vec<PatchFile>,
    pub content: PatchContent,
    pub summary: PatchSummary,
}

/// Process complete supplied bytes before truncating the display content.
/// An empty patch has zero lines, matching the public JavaScript contract.
pub fn process_patch(raw: String, max_lines: Option<i64>) -> PatchResult {
    let files = parse_patch(&raw);
    let summary = PatchSummary {
        files_changed: files.len() as u32,
        additions: files.iter().map(|file| file.additions).sum(),
        deletions: files.iter().map(|file| file.deletions).sum(),
    };
    let total_lines = if raw.is_empty() { 0 } else { raw.split('\n').count() as i64 };
    let truncated = max_lines.is_some_and(|limit| limit <= 0 || total_lines > limit);
    let raw = if truncated {
        raw.split('\n').take(max_lines.unwrap_or(0).max(0) as usize).collect::<Vec<_>>().join("\n")
    } else {
        raw
    };
    PatchResult { files, content: PatchContent { raw, truncated, total_lines }, summary }
}

/// One shared command plan for host execution and the TypeScript WSL transport.
/// Three-dot comparison preserves branch-range semantics. Literal pathspecs
/// prevent file names containing Git glob/magic syntax selecting other files.
pub fn range_patch_args(
    base: &str,
    head: &str,
    path: Option<&str>,
    context_lines: Option<u32>,
) -> Vec<String> {
    let mut args = vec![
        "--literal-pathspecs".into(),
        "diff".into(),
        "-M".into(),
        "-C".into(),
        "--no-color".into(),
        "--src-prefix=a/".into(),
        "--dst-prefix=b/".into(),
    ];
    if let Some(context) = context_lines {
        args.push(format!("-U{context}"));
    }
    args.push("--end-of-options".into());
    args.push(format!("{base}...{head}"));
    // Always terminate revision arguments, even for the combined patch.
    args.push("--".into());
    if let Some(path) = path {
        args.push(path.into());
    }
    args
}

pub fn range_patch(
    root: &Path,
    base: &str,
    head: &str,
    path: Option<&str>,
    context_lines: Option<u32>,
    max_lines: Option<i64>,
) -> Result<PatchResult, GitError> {
    let raw = run_git(
        root,
        &range_patch_args(base, head, path, context_lines),
        &GitCommandOptions::default(),
    )?;
    Ok(process_patch(raw, max_lines))
}
