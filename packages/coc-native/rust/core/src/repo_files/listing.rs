//! Explorer directory listings and subtree file walks.
//!
//! Listings apply Git ignore rules to directories and ripgrep rules to files.
//! Like `git check-ignore`, an ignored directory that holds tracked files stays
//! listed.
//! Subtree file walks use the file index policy. Names sort with CLDR root
//! collation — the order Node's `localeCompare` gives — never byte order.

use std::cell::RefCell;
use std::cmp::Ordering;
use std::path::Path;

use feruca::{Collator, Locale, Tailoring};

use super::{resolve_in_root, RepoFilesError};
use crate::git::{run_git, GitCommandOptions};
use crate::repo_index::walk::{ignore_builder, to_posix, walk_builder};

/// One row of a directory listing.
#[derive(Clone, Debug, PartialEq, Eq)]
#[cfg_attr(
    feature = "napi",
    napi_derive::napi(object, object_from_js = false, js_name = "RepoTreeEntry")
)]
pub struct TreeEntry {
    pub name: String,
    /// `"dir"` or `"file"`.
    #[cfg_attr(feature = "napi", napi(js_name = "type", ts_type = "'dir' | 'file'"))]
    pub kind: &'static str,
    /// Byte size for files (symlinks report their target); `None` for dirs.
    pub size: Option<i64>,
    /// Repo-relative, `/`-separated.
    pub path: String,
    /// Populated by deep listings when the directory was not truncated.
    pub children: Option<Vec<TreeEntry>>,
}

impl TreeEntry {
    pub fn is_dir(&self) -> bool {
        self.kind == "dir"
    }
}

#[derive(Debug)]
#[cfg_attr(
    feature = "napi",
    napi_derive::napi(object, object_from_js = false, js_name = "RepoTreeListing")
)]
pub struct TreeListing {
    pub entries: Vec<TreeEntry>,
    pub truncated: bool,
}

#[derive(Debug)]
#[cfg_attr(
    feature = "napi",
    napi_derive::napi(object, object_from_js = false, js_name = "RepoFileListing")
)]
pub struct FileListing {
    pub files: Vec<String>,
    pub truncated: bool,
}

thread_local! {
    // Non-ignorable CLDR root matches `localeCompare` under Node's ICU,
    // punctuation included; `collate` needs `&mut` for its scratch buffers.
    static COLLATOR: RefCell<Collator> =
        RefCell::new(Collator::new(Tailoring::Cldr(Locale::Root), false, false));
}

/// `a.localeCompare(b)` for file names.
pub fn locale_compare(a: &str, b: &str) -> Ordering {
    COLLATOR.with(|c| c.borrow_mut().collate(a, b))
}

/// List `relative` to `depth` levels: dirs first, then names in locale order,
/// capped at `max_entries` per directory. Broken symlinks are skipped;
/// `.git` is listed like any other directory. Children of a truncated
/// listing are not filled in.
pub fn list_directory(
    root: &Path,
    relative: &str,
    depth: u32,
    include_ignored: bool,
    max_entries: usize,
) -> Result<TreeListing, RepoFilesError> {
    let abs = resolve_in_root(root, relative)?;
    let root = resolve_in_root(root, "")?;
    match std::fs::metadata(&abs) {
        Err(_) => return Err(RepoFilesError::PathMissing(relative.to_owned())),
        Ok(meta) if !meta.is_dir() => {
            return Err(RepoFilesError::NotADirectory(relative.to_owned()))
        }
        Ok(_) => {}
    }
    let (entries, truncated) = list_level(&root, &abs, depth, include_ignored, max_entries);
    Ok(TreeListing { entries, truncated })
}

fn level_entries<'a>(
    root: &'a Path,
    dir: &'a Path,
    include_ignored: bool,
    directories: bool,
) -> impl Iterator<Item = TreeEntry> + 'a {
    let mut builder = ignore_builder(dir, include_ignored);
    builder.ignore(!include_ignored && !directories);
    builder.max_depth(Some(1));
    builder.build().filter_map(Result::ok).filter(|entry| entry.depth() == 1).filter_map(
        move |entry| {
            // `follow_links` makes metadata describe the symlink target.
            let meta = entry.metadata().ok()?;
            if meta.is_dir() != directories {
                return None;
            }
            Some(TreeEntry {
                name: entry.file_name().to_string_lossy().into_owned(),
                kind: if meta.is_dir() { "dir" } else { "file" },
                size: (!meta.is_dir()).then_some(meta.len() as i64),
                path: to_posix(entry.path().strip_prefix(root).ok()?),
                children: None,
            })
        },
    )
}

fn list_level(
    root: &Path,
    dir: &Path,
    depth: u32,
    include_ignored: bool,
    max_entries: usize,
) -> (Vec<TreeEntry>, bool) {
    let mut entries: Vec<_> = level_entries(root, dir, include_ignored, true).collect();
    if !include_ignored {
        let ignored: Vec<_> = level_entries(root, dir, true, true)
            .filter(|all| !entries.iter().any(|kept| kept.path == all.path))
            .collect();
        entries.extend(with_tracked_files(root, ignored));
    }
    entries.extend(level_entries(root, dir, include_ignored, false));
    entries
        .sort_by(|a, b| b.is_dir().cmp(&a.is_dir()).then_with(|| locale_compare(&a.name, &b.name)));
    let truncated = entries.len() > max_entries;
    entries.truncate(max_entries);
    if depth > 1 && !truncated {
        for entry in entries.iter_mut().filter(|e| e.is_dir()) {
            let child = root.join(&entry.path);
            entry.children =
                Some(list_level(root, &child, depth - 1, include_ignored, max_entries).0);
        }
    }
    (entries, truncated)
}

/// The ignored directories Git still tracks files under. Outside a Git repo,
/// or if Git fails, there are none.
fn with_tracked_files(root: &Path, ignored: Vec<TreeEntry>) -> Vec<TreeEntry> {
    if ignored.is_empty() {
        return ignored;
    }
    let mut args: Vec<String> = ["ls-files", "-z", "--cached", "--"].map(str::to_owned).into();
    args.extend(ignored.iter().map(|dir| format!(":(literal){}/", dir.path)));
    let options = GitCommandOptions {
        timeout_ms: 15_000,
        max_buffer_bytes: 64 * 1024 * 1024,
        ..Default::default()
    };
    let Ok(stdout) = run_git(root, &args, &options) else { return Vec::new() };
    let tracked: Vec<&str> = stdout.split('\0').filter(|path| !path.is_empty()).collect();
    ignored
        .into_iter()
        .filter(|dir| {
            let prefix = format!("{}/", dir.path);
            tracked.iter().any(|path| path.starts_with(&prefix))
        })
        .collect()
}

/// Every file under `relative`, depth-first with each directory's entries in
/// locale order, `.git` excluded, stopping at `max_entries`. A missing or
/// unreadable start yields an empty list. `truncated` is set once the cap is
/// reached, even if nothing was left out.
pub fn list_files(
    root: &Path,
    relative: &str,
    include_ignored: bool,
    max_entries: usize,
) -> Result<FileListing, RepoFilesError> {
    let abs = resolve_in_root(root, relative)?;
    let root = resolve_in_root(root, "")?;
    if !abs.is_dir() {
        return Ok(FileListing { files: Vec::new(), truncated: false });
    }
    let mut builder = walk_builder(&abs, include_ignored);
    builder.sort_by_file_name(|a, b| locale_compare(&a.to_string_lossy(), &b.to_string_lossy()));
    let files: Vec<String> = builder
        .build()
        .filter_map(Result::ok)
        .filter(|entry| entry.file_type().is_some_and(|t| t.is_file()))
        .filter_map(|entry| Some(to_posix(entry.path().strip_prefix(&root).ok()?)))
        .take(max_entries)
        .collect();
    let truncated = files.len() >= max_entries;
    Ok(FileListing { files, truncated })
}
