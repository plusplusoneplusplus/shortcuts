//! Parallel, gitignore-aware repository walk.
//!
//! Uses `ignore::WalkBuilder` — ripgrep's own walker — so the resulting list
//! matches `rg --files --hidden` without the subprocess, the stdout pipe, the
//! string split, or the 50 MB `maxBuffer` cliff that the Node path hits.

use std::io;
use std::path::Path;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use ignore::{WalkBuilder, WalkState};

/// How to walk a repository root.
#[derive(Clone, Copy, Debug, Default)]
pub struct WalkOptions {
    /// Include files excluded by `.gitignore` / `.ignore` (maps to `showIgnored`).
    pub include_ignored: bool,
    /// Safety cap on collected paths. `None` means unlimited.
    pub max_entries: Option<usize>,
}

/// Appends a worker's local buffer to the shared sink when the worker's
/// visitor closure is dropped, so the walk locks once per thread rather than
/// once per file.
struct Flusher {
    buf: Vec<String>,
    sink: Arc<Mutex<Vec<String>>>,
}

impl Drop for Flusher {
    fn drop(&mut self) {
        if self.buf.is_empty() {
            return;
        }
        let mut sink = self.sink.lock().unwrap_or_else(|e| e.into_inner());
        sink.append(&mut self.buf);
    }
}

fn thread_count() -> usize {
    std::thread::available_parallelism().map(|n| n.get()).unwrap_or(1)
}

/// Walk `root`, returning repo-relative `/`-separated file paths sorted
/// lexicographically, plus whether the list was capped.
///
/// Sorting is not free, but it makes both `files()` slices and search tie-breaks
/// deterministic across platforms — `rg`'s output order is not.
pub fn walk(root: &Path, options: &WalkOptions) -> io::Result<(Vec<String>, bool)> {
    let metadata = std::fs::metadata(root)?;
    if !metadata.is_dir() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("not a directory: {}", root.display()),
        ));
    }

    let sink: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
    let seen = Arc::new(AtomicUsize::new(0));
    // Collect one past the cap so `truncated` can be decided exactly.
    let stop_at = options.max_entries.map(|m| m.saturating_add(1));

    let mut builder = WalkBuilder::new(root);
    builder
        // `.hidden(false)` means "do not skip hidden entries" — matches `--hidden`.
        .hidden(false)
        // The JS walk stats symlinks and follows symlinked directories; the
        // `ignore` crate detects cycles while doing the same.
        .follow_links(true)
        .threads(thread_count())
        .git_ignore(!options.include_ignored)
        .git_global(!options.include_ignored)
        .git_exclude(!options.include_ignored)
        .ignore(!options.include_ignored)
        .parents(!options.include_ignored);

    // `.git` is never a useful quick-open target and walking the object database
    // is the most expensive part of the walk, so skip it unconditionally. Note
    // this deliberately differs from `rg --no-ignore`, which does descend into
    // `.git`; the TS walk and the rg fallback apply the same exclusion.
    builder.filter_entry(|entry| {
        !(entry.file_name() == ".git" && entry.file_type().is_some_and(|t| t.is_dir()))
    });

    let root = root.to_path_buf();
    builder.build_parallel().run(|| {
        let mut flusher = Flusher { buf: Vec::new(), sink: Arc::clone(&sink) };
        let seen = Arc::clone(&seen);
        let root = root.clone();
        Box::new(move |result| {
            let entry = match result {
                Ok(entry) => entry,
                // Unreadable directories and broken symlinks are skipped, as in
                // the JS walk, rather than failing the whole build.
                Err(_) => return WalkState::Continue,
            };
            if !entry.file_type().is_some_and(|t| t.is_file()) {
                return WalkState::Continue;
            }
            if let Some(stop_at) = stop_at {
                if seen.fetch_add(1, Ordering::Relaxed) >= stop_at {
                    return WalkState::Quit;
                }
            }
            let relative = match entry.path().strip_prefix(&root) {
                Ok(rel) => rel,
                Err(_) => return WalkState::Continue,
            };
            flusher.buf.push(to_posix(relative));
            WalkState::Continue
        })
    });

    let mut files = Arc::try_unwrap(sink)
        .map(|m| m.into_inner().unwrap_or_else(|e| e.into_inner()))
        .unwrap_or_else(|arc| arc.lock().unwrap_or_else(|e| e.into_inner()).clone());
    files.sort_unstable();

    let truncated = match options.max_entries {
        Some(max) => files.len() > max,
        None => false,
    };
    if let Some(max) = options.max_entries {
        files.truncate(max);
    }
    Ok((files, truncated))
}

/// Repo-relative path as the rest of the stack expects it: `/`-separated,
/// regardless of the host platform's separator.
fn to_posix(path: &Path) -> String {
    let raw = path.to_string_lossy();
    if std::path::MAIN_SEPARATOR == '/' {
        raw.into_owned()
    } else {
        raw.replace(std::path::MAIN_SEPARATOR, "/")
    }
}
