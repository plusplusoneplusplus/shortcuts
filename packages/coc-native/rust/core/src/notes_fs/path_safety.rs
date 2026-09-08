//! Cross-platform, symlink-aware path containment for non-default Notes roots.
//!
//! A line-for-line port of `packages/coc/src/server/notes/notes-path-safety.ts`.
//! The managed default root keeps its broader legacy contract elsewhere; every
//! *external* Notes collection resolves client paths through here before any
//! filesystem access.
//!
//! The error strings are not diagnostics — the server returns them verbatim as
//! the body of a 403, so they are part of the HTTP contract and must not be
//! reworded on this side of the boundary.

use std::ffi::OsString;
use std::fs;
use std::io;
use std::path::{Component, Path, PathBuf, MAIN_SEPARATOR_STR};

/// The status code every containment failure carries. There is only one.
pub const PATH_SAFETY_STATUS_CODE: u16 = 403;

/// Options mirroring the TypeScript helper's second argument.
#[derive(Debug, Clone, Copy, Default)]
pub struct SafePathOptions {
    /// Permit the empty path, meaning the root directory itself.
    pub allow_root: bool,
    /// Reject a path with any symlink between the root and the target.
    /// Used by managed sidecar paths, which must never leave the collection.
    pub reject_symlinks: bool,
}

/// A client path accepted as being inside one selected Notes root.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedSafeNotesPath {
    /// Lexical path used for the filesystem operation.
    pub absolute_path: PathBuf,
    /// Normalized forward-slash path relative to the selected root.
    pub relative_path: String,
}

/// A refusal. `status_code` is always [`PATH_SAFETY_STATUS_CODE`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PathSafetyError {
    pub error: String,
    pub status_code: u16,
}

impl PathSafetyError {
    fn new(message: &str) -> Self {
        Self { error: message.to_string(), status_code: PATH_SAFETY_STATUS_CODE }
    }
}

pub type PathSafetyResult = Result<ResolvedSafeNotesPath, PathSafetyError>;

// ── Lexical helpers ──────────────────────────────────────────────────────────

/// Fold `.` and `..` without touching the filesystem, the way `path.resolve`
/// does. `..` above the root is clamped rather than escaping, which is what
/// Node does too.
fn normalize_lexically(path: &Path) -> PathBuf {
    let mut prefix = PathBuf::new();
    let mut stack: Vec<OsString> = Vec::new();

    for component in path.components() {
        match component {
            Component::Prefix(_) | Component::RootDir => prefix.push(component.as_os_str()),
            Component::CurDir => {}
            Component::ParentDir => {
                stack.pop();
            }
            Component::Normal(segment) => stack.push(segment.to_os_string()),
        }
    }

    let mut resolved = prefix;
    for segment in stack {
        resolved.push(segment);
    }
    resolved
}

/// `path.resolve(input)`: absolute paths are normalized, relative ones are
/// taken against the process working directory, exactly as Node reads them.
pub fn resolve_lexically(path: &Path) -> PathBuf {
    if path.is_absolute() {
        return normalize_lexically(path);
    }
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    normalize_lexically(&cwd.join(path))
}

/// One path component as the comparison sees it. Windows path comparison is
/// case-insensitive, matching the `toLocaleLowerCase('en-US')` the TypeScript
/// applies before comparing.
fn comparison_segment(segment: &std::ffi::OsStr) -> String {
    let rendered = segment.to_string_lossy().into_owned();
    if cfg!(windows) {
        rendered.to_lowercase()
    } else {
        rendered
    }
}

fn comparison_components(path: &Path) -> Vec<String> {
    normalize_lexically(path).components().map(|c| comparison_segment(c.as_os_str())).collect()
}

/// Whether `candidate` is `root` itself or lives beneath it, lexically.
pub fn is_same_or_within_directory(candidate: &Path, root: &Path) -> bool {
    let root_components = comparison_components(root);
    let candidate_components = comparison_components(candidate);
    if candidate_components.len() < root_components.len() {
        return false;
    }
    root_components.iter().zip(candidate_components.iter()).all(|(a, b)| a == b)
}

/// `path.relative(from, to)`, lexically. Used to hand a path that was built by
/// string concatenation (the autosave `.tmp` sibling) back to
/// [`resolve_safe_notes_path`], which only accepts root-relative input; a
/// result that climbs out with `..` is exactly what that check must reject.
pub fn lexical_relative(from: &Path, to: &Path) -> PathBuf {
    let from_components: Vec<OsString> =
        resolve_lexically(from).components().map(|c| c.as_os_str().to_os_string()).collect();
    let to_components: Vec<OsString> =
        resolve_lexically(to).components().map(|c| c.as_os_str().to_os_string()).collect();

    let mut shared = 0;
    while shared < from_components.len()
        && shared < to_components.len()
        && comparison_segment(&from_components[shared])
            == comparison_segment(&to_components[shared])
    {
        shared += 1;
    }

    let mut relative = PathBuf::new();
    for _ in shared..from_components.len() {
        relative.push("..");
    }
    for component in &to_components[shared..] {
        relative.push(component);
    }
    relative
}

/// `path.isAbsolute` as Node reads it, applied to the raw client string.
///
/// Rust's `Path::is_absolute` is stricter on Windows — it wants a drive prefix,
/// so it calls `\notes\a.md` relative where Node calls it absolute. The
/// content routes branch on this, and the two answers must agree.
pub fn is_absolute_request(requested: &str) -> bool {
    if cfg!(windows) {
        let bytes = requested.as_bytes();
        if matches!(bytes.first(), Some(b'/') | Some(b'\\')) {
            return true;
        }
        return bytes.len() >= 3
            && bytes[0].is_ascii_alphabetic()
            && bytes[1] == b':'
            && matches!(bytes[2], b'/' | b'\\');
    }
    requested.starts_with('/')
}

/// The forward-slash path of `target` relative to `root`, for a `target` already
/// known to be inside it.
fn relative_forward_slash(root: &Path, target: &Path) -> String {
    let skip = normalize_lexically(root).components().count();
    normalize_lexically(target)
        .components()
        .skip(skip)
        .map(|c| c.as_os_str().to_string_lossy().into_owned())
        .collect::<Vec<_>>()
        .join("/")
}

// ── Filesystem helpers ───────────────────────────────────────────────────────

fn is_missing_path_error(error: &io::Error) -> bool {
    matches!(error.kind(), io::ErrorKind::NotFound | io::ErrorKind::NotADirectory)
}

/// The one non-containment failure `canonicalize_potential_path` reports.
/// Every caller collapses it into the same generic 403, but keeping it distinct
/// makes the dangling-symlink rule testable on its own.
#[derive(Debug)]
pub enum CanonicalizeError {
    DanglingSymlink,
    Io(io::Error),
}

/// Resolve symlinks in the existing prefix of a path while preserving missing
/// trailing components. A dangling symlink is rejected instead of being treated
/// as a normal missing component — otherwise a link pointing outside the root
/// would be accepted as "a file that is not there yet".
pub fn canonicalize_potential_path(path: &Path) -> Result<PathBuf, CanonicalizeError> {
    let mut missing_segments: Vec<OsString> = Vec::new();
    let mut current = resolve_lexically(path);

    loop {
        match fs::canonicalize(&current) {
            Ok(canonical) => {
                let mut resolved = canonical;
                for segment in missing_segments.iter().rev() {
                    resolved.push(segment);
                }
                return Ok(normalize_lexically(&resolved));
            }
            Err(error) => {
                if !is_missing_path_error(&error) {
                    return Err(CanonicalizeError::Io(error));
                }

                match fs::symlink_metadata(&current) {
                    Ok(metadata) if metadata.file_type().is_symlink() => {
                        return Err(CanonicalizeError::DanglingSymlink);
                    }
                    Ok(_) => {}
                    Err(lstat_error) => {
                        if !is_missing_path_error(&lstat_error) {
                            return Err(CanonicalizeError::Io(lstat_error));
                        }
                    }
                }

                let (parent, basename) = match (current.parent(), current.file_name()) {
                    (Some(parent), Some(name)) if parent != current => {
                        (parent.to_path_buf(), name.to_os_string())
                    }
                    _ => return Err(CanonicalizeError::Io(error)),
                };
                missing_segments.push(basename);
                current = parent;
            }
        }
    }
}

/// Whether any component between `root` and `target` is a symlink. A missing
/// component ends the walk with `false`: there is nothing there to point away.
pub fn has_symlink_below_root(root: &Path, target: &Path) -> io::Result<bool> {
    let relative = relative_forward_slash(root, target);
    let mut current = root.to_path_buf();
    for segment in relative.split('/').filter(|s| !s.is_empty()) {
        current.push(segment);
        match fs::symlink_metadata(&current) {
            Ok(metadata) => {
                if metadata.file_type().is_symlink() {
                    return Ok(true);
                }
            }
            Err(error) => {
                if is_missing_path_error(&error) {
                    return Ok(false);
                }
                return Err(error);
            }
        }
    }
    Ok(false)
}

// ── Normalization ────────────────────────────────────────────────────────────

/// Turn a client path into a relative platform path, or refuse it.
///
/// Both slash styles are separators on every platform, so a Windows-style path
/// cannot smuggle a `..` past a POSIX server.
pub fn normalize_relative_notes_path(requested_path: &str) -> Result<String, PathSafetyError> {
    if requested_path.contains('\0') {
        return Err(PathSafetyError::new("Access denied: path contains an invalid null byte"));
    }

    let slash_path = requested_path.replace('\\', "/");
    if slash_path.starts_with('/') || has_drive_letter_prefix(requested_path) {
        return Err(PathSafetyError::new(
            "Access denied: absolute paths are not allowed for this Notes collection",
        ));
    }

    let segments: Vec<&str> = slash_path.split('/').collect();
    if segments.contains(&"..") {
        return Err(PathSafetyError::new(
            "Access denied: parent directory references are not allowed",
        ));
    }

    Ok(segments
        .into_iter()
        .filter(|segment| !segment.is_empty() && *segment != ".")
        .collect::<Vec<_>>()
        .join(MAIN_SEPARATOR_STR))
}

/// `path.win32.isAbsolute` plus the `/^[A-Za-z]:/` guard beside it: `C:\x`,
/// `c:/x` and the drive-relative `c:x` are all refused.
fn has_drive_letter_prefix(requested_path: &str) -> bool {
    let bytes = requested_path.as_bytes();
    bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':'
}

// ── The resolver ─────────────────────────────────────────────────────────────

/// Resolve a client path under one selected non-default Notes root.
///
/// Existing symlinks are resolved for the containment check, including symlinks
/// in the parent of a not-yet-created target.
pub fn resolve_safe_notes_path(
    notes_root: &Path,
    requested_path: &str,
    options: SafePathOptions,
) -> PathSafetyResult {
    let normalized = normalize_relative_notes_path(requested_path)?;
    if normalized.is_empty() && !options.allow_root {
        return Err(PathSafetyError::new(
            "Access denied: path must identify an entry within the Notes collection",
        ));
    }

    let lexical_root = resolve_lexically(notes_root);
    let absolute_path = if normalized.is_empty() {
        lexical_root.clone()
    } else {
        normalize_lexically(&lexical_root.join(&normalized))
    };

    if !is_same_or_within_directory(&absolute_path, &lexical_root) {
        return Err(PathSafetyError::new(
            "Access denied: path is outside the selected Notes collection",
        ));
    }

    if options.reject_symlinks {
        match has_symlink_below_root(&lexical_root, &absolute_path) {
            Ok(true) => {
                return Err(PathSafetyError::new(
                    "Access denied: symbolic links are not allowed in this managed Notes path",
                ));
            }
            Ok(false) => {}
            Err(_) => return Err(unresolvable()),
        }
    }

    let canonical_root = match canonicalize_potential_path(&lexical_root) {
        Ok(path) => path,
        Err(_) => return Err(unresolvable()),
    };
    let canonical_target = match canonicalize_potential_path(&absolute_path) {
        Ok(path) => path,
        Err(_) => return Err(unresolvable()),
    };
    if !is_same_or_within_directory(&canonical_target, &canonical_root) {
        return Err(PathSafetyError::new(
            "Access denied: path escapes the selected Notes collection through a symbolic link",
        ));
    }

    let relative_path = relative_forward_slash(&lexical_root, &absolute_path);
    Ok(ResolvedSafeNotesPath { absolute_path, relative_path })
}

fn unresolvable() -> PathSafetyError {
    PathSafetyError::new(
        "Access denied: path could not be safely resolved within the selected Notes collection",
    )
}
