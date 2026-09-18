//! The third source of index updates: changes CoC never saw.
//!
//! `initialize` walks the whole tree and `textDocument/didSave` covers edits
//! made in the editor, but a repository also moves underneath both — a branch
//! switch, a `git pull`, a file written by a build script or by another editor.
//! Without a watcher the index silently describes a tree that no longer exists
//! until the next cold start.
//!
//! Events feed the same serial queue the save path uses, so a file that a save
//! and the watcher both report is still parsed once, and a burst (a checkout
//! touching thousands of files) collapses into as few targeted syncs as the
//! worker can keep up with.

use std::path::{Path, PathBuf};

use coc_native_core::symbol_index::is_c_family_path;
use ignore::gitignore::{Gitignore, GitignoreBuilder};
use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde_json::json;

use crate::indexer::IndexQueue;
use crate::transport::Transport;

const LOG_WARNING: i64 = 2;

/// Holds the platform watcher alive. Dropping it stops the watch, so the server
/// keeps one for the whole session.
pub struct FileWatcher {
    _inner: RecommendedWatcher,
}

/// Starts watching `root` recursively. A platform that refuses to watch — too
/// many inotify watches, a root that vanished — is logged and otherwise
/// ignored: the index stays correct for saves and cold builds, which is
/// strictly better than failing the session over a background convenience.
pub fn start(root: PathBuf, queue: IndexQueue, transport: Transport) -> Option<FileWatcher> {
    let filter = PathFilter::new(&root);
    let warn = transport.clone();
    let result = notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
        let Ok(event) = event else {
            return;
        };
        if !is_content_change(&event.kind) {
            return;
        }
        for path in &event.paths {
            if let Some(relative) = filter.relative(path) {
                queue.submit(relative);
            }
        }
    })
    .and_then(|mut watcher| {
        watcher.watch(&root, RecursiveMode::Recursive)?;
        Ok(watcher)
    });
    match result {
        Ok(watcher) => Some(FileWatcher { _inner: watcher }),
        Err(error) => {
            warn.notify(
                "window/logMessage",
                json!({
                    "type": LOG_WARNING,
                    "message": format!("Watching the workspace for changes failed: {error}"),
                }),
            );
            None
        }
    }
}

/// Reads, permission changes and the backend's own bookkeeping cannot change
/// what a file declares. Only creates, writes and removals can.
fn is_content_change(kind: &EventKind) -> bool {
    matches!(kind, EventKind::Create(_) | EventKind::Modify(_) | EventKind::Remove(_))
}

/// Decides which watched paths are worth a targeted sync.
///
/// The repository's own ignore rules are consulted so the watcher indexes the
/// same file set the cold build does — otherwise a gitignored build directory
/// regenerating C sources would both churn the queue and leave rows behind that
/// the next full sync deletes. Only the root `.gitignore` and `.git/info/exclude`
/// are read, not nested `.gitignore` files: loading those needs a walk, and the
/// cost of missing one is a single wasted targeted sync of a file the next cold
/// build drops again.
struct PathFilter {
    root: PathBuf,
    ignores: Gitignore,
}

impl PathFilter {
    fn new(root: &Path) -> Self {
        let mut builder = GitignoreBuilder::new(root);
        builder.add(root.join(".gitignore"));
        builder.add(root.join(".git/info/exclude"));
        // A malformed rule is the only error here, and it drops just that rule.
        let ignores = builder.build().unwrap_or_else(|_| Gitignore::empty());
        Self { root: root.to_path_buf(), ignores }
    }

    /// The repository-relative, forward-slashed key the store uses, or `None`
    /// when the path is not something the index holds rows for.
    fn relative(&self, path: &Path) -> Option<String> {
        let relative = path.strip_prefix(&self.root).ok()?;
        let text = relative.to_string_lossy().replace('\\', "/");
        if text.is_empty() || !is_c_family_path(&text) {
            return None;
        }
        // The object database churns constantly and holds no source; the cold
        // build skips it unconditionally, so this does too.
        if text.split('/').any(|segment| segment == ".git") {
            return None;
        }
        // A removal cannot be stat'd, so the directory hint is always false:
        // everything reaching here has a C-family file extension.
        if self.ignores.matched_path_or_any_parents(&text, false).is_ignore() {
            return None;
        }
        Some(text)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use notify::event::{AccessKind, CreateKind, ModifyKind, RemoveKind};

    fn filter(root: &Path) -> PathFilter {
        PathFilter::new(root)
    }

    #[test]
    fn keeps_c_family_files_inside_the_root() {
        let root = tempfile::tempdir().expect("tempdir");
        let filter = filter(root.path());
        assert_eq!(
            filter.relative(&root.path().join("src/main.c")),
            Some("src/main.c".to_string())
        );
        assert_eq!(
            filter.relative(&root.path().join("include/api.hpp")),
            Some("include/api.hpp".to_string())
        );
    }

    #[test]
    fn drops_non_c_family_paths_and_anything_outside_the_root() {
        let root = tempfile::tempdir().expect("tempdir");
        let filter = filter(root.path());
        assert_eq!(filter.relative(&root.path().join("notes.md")), None);
        assert_eq!(filter.relative(&root.path().join("src")), None);
        assert_eq!(filter.relative(root.path()), None);
        assert_eq!(filter.relative(Path::new("/elsewhere/main.c")), None);
    }

    #[test]
    fn drops_the_object_database() {
        let root = tempfile::tempdir().expect("tempdir");
        let filter = filter(root.path());
        assert_eq!(filter.relative(&root.path().join(".git/hooks/pre-commit.c")), None);
    }

    #[test]
    fn honours_the_root_ignore_rules() {
        let root = tempfile::tempdir().expect("tempdir");
        std::fs::write(root.path().join(".gitignore"), "build/\ngenerated.c\n").expect("gitignore");
        std::fs::create_dir_all(root.path().join(".git/info")).expect("git dir");
        std::fs::write(root.path().join(".git/info/exclude"), "scratch/\n").expect("exclude");
        let filter = filter(root.path());
        assert_eq!(filter.relative(&root.path().join("build/out.c")), None);
        assert_eq!(filter.relative(&root.path().join("src/generated.c")), None);
        assert_eq!(filter.relative(&root.path().join("scratch/try.c")), None);
        assert_eq!(
            filter.relative(&root.path().join("src/kept.c")),
            Some("src/kept.c".to_string())
        );
    }

    #[test]
    fn only_content_changing_events_reach_the_queue() {
        assert!(is_content_change(&EventKind::Create(CreateKind::File)));
        assert!(is_content_change(&EventKind::Modify(ModifyKind::Any)));
        assert!(is_content_change(&EventKind::Remove(RemoveKind::File)));
        assert!(!is_content_change(&EventKind::Access(AccessKind::Read)));
        assert!(!is_content_change(&EventKind::Other));
    }
}
