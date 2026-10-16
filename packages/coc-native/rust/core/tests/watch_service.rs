use coc_native_core::watch::{WatchBatch, WatchFilter, WatchService, WatchSubscription};
use std::path::Path;
use std::sync::mpsc::{self, Receiver};
use std::time::{Duration, Instant};

fn directory() -> tempfile::TempDir {
    tempfile::Builder::new().prefix("watch-service-").tempdir_in(".").unwrap()
}

fn service() -> (WatchService, Receiver<WatchBatch>) {
    let (sender, receiver) = mpsc::channel();
    (
        WatchService::new(move |batch| {
            let _ = sender.send(batch);
        }),
        receiver,
    )
}

fn options(root: &Path, workspace: &str) -> WatchSubscription {
    WatchSubscription {
        root: root.to_path_buf(),
        workspace_id: workspace.into(),
        recursive: true,
        filter: WatchFilter::default(),
        debounce_ms: 100,
    }
}

fn receive(receiver: &Receiver<WatchBatch>, predicate: impl Fn(&WatchBatch) -> bool) -> WatchBatch {
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        let batch = receiver
            .recv_timeout(deadline.saturating_duration_since(Instant::now()))
            .expect("native watcher did not deliver the expected batch");
        if predicate(&batch) {
            return batch;
        }
    }
}

/// FSEvents can report setup changes made just before a stream started, which
/// correctly widens the first window into a rescan. Before asserting exact
/// deliveries, wait until a probe arrives as an ordinary path batch for every
/// subscription; any earlier backend event has been delivered by then.
fn settle(receiver: &Receiver<WatchBatch>, root: &Path, extension: &str, ids: &[u32]) {
    let deadline = Instant::now() + Duration::from_secs(10);
    for attempt in 0.. {
        let probe = format!("settle-{attempt}.{extension}");
        std::fs::write(root.join(&probe), "probe").unwrap();
        let mut outcomes = std::collections::HashMap::new();
        while outcomes.len() < ids.len() {
            let batch = receiver
                .recv_timeout(deadline.saturating_duration_since(Instant::now()))
                .expect("native watcher did not settle");
            if ids.contains(&batch.subscription_id)
                && !outcomes.contains_key(&batch.subscription_id)
                && (batch.rescan || batch.paths.contains(&probe))
            {
                outcomes.insert(batch.subscription_id, batch.rescan);
            }
        }
        if outcomes.values().all(|rescan| !rescan) {
            return;
        }
    }
}

#[test]
fn shares_canonical_roots_and_removes_only_the_requested_workspace() {
    let root = directory();
    let (service, receiver) = service();
    let first = service.subscribe(options(root.path(), "first")).unwrap();
    let second = service.subscribe(options(&root.path().join("."), "second")).unwrap();
    assert_eq!(service.root_count().unwrap(), 1);
    settle(&receiver, root.path(), "md", &[first, second]);
    std::fs::write(root.path().join("initial.md"), "initial").unwrap();
    let mut ids = std::collections::BTreeSet::new();
    while ids.len() < 2 {
        let batch = receive(&receiver, |batch| batch.paths.contains(&"initial.md".into()));
        ids.insert(batch.subscription_id);
    }
    assert_eq!(ids, [first, second].into_iter().collect());
    service.unwatch_workspace("first").unwrap();
    assert_eq!(service.root_count().unwrap(), 1);
    std::fs::write(root.path().join("remaining.md"), "remaining").unwrap();
    let batch = receive(&receiver, |batch| batch.paths.contains(&"remaining.md".into()));
    assert_eq!(batch.subscription_id, second);
    service.unsubscribe(second).unwrap();
    assert_eq!(service.root_count().unwrap(), 0);
    service.dispose().unwrap();
    service.dispose().unwrap();
    assert!(service.subscribe(options(root.path(), "disposed")).is_err());
}

#[test]
fn workflows_templates_and_wiki_subscriptions_share_one_root_and_preserve_path_case() {
    let root = directory();
    std::fs::create_dir_all(root.path().join(".vscode/workflows")).unwrap();
    let (service, receiver) = service();
    let mut workflows = options(root.path(), "workspace");
    workflows.debounce_ms = 20;
    let workflows_id = service.subscribe(workflows).unwrap();
    let mut templates = options(&root.path().join("."), "workspace");
    templates.debounce_ms = 40;
    let templates_id = service.subscribe(templates).unwrap();
    // Canonical paths and caller aliases must agree, including macOS temp roots
    // reached through a symlink and Windows casing aliases.
    let canonical = root.path().canonicalize().unwrap();
    let mut wiki = options(&canonical, "workspace");
    wiki.debounce_ms = 60;
    wiki.filter = WatchFilter {
        extensions: vec!["md".into()],
        ignore_dirs: vec!["node_modules".into()],
        respect_gitignore: true,
    };
    let wiki_id = service.subscribe(wiki).unwrap();
    assert_eq!(service.root_count().unwrap(), 1);
    settle(&receiver, root.path(), "md", &[workflows_id, templates_id, wiki_id]);
    std::fs::write(root.path().join(".vscode/workflows/task.yaml"), "name: task").unwrap();
    std::fs::write(root.path().join("MixedCase.md"), "wiki").unwrap();
    let mut delivered = std::collections::BTreeSet::new();
    while delivered.len() < 3 {
        let batch = receive(&receiver, |batch| batch.paths.contains(&"MixedCase.md".into()));
        assert!(!batch.rescan);
        if batch.subscription_id == wiki_id {
            assert_eq!(batch.paths, ["MixedCase.md"]);
        } else {
            assert!([workflows_id, templates_id].contains(&batch.subscription_id));
            assert!(batch.paths.contains(&".vscode/workflows/task.yaml".into()));
        }
        delivered.insert(batch.subscription_id);
    }
    service.unwatch_workspace("workspace").unwrap();
    assert_eq!(service.root_count().unwrap(), 0);
}

#[test]
fn filters_extensions_ignored_directories_and_nested_gitignore_rules() {
    let root = directory();
    for dir in ["src", "build", "src/cache", ".git/info"] {
        std::fs::create_dir_all(root.path().join(dir)).unwrap();
    }
    std::fs::write(root.path().join(".gitignore"), "generated.md\n").unwrap();
    std::fs::write(root.path().join("src/.gitignore"), "private.md\n").unwrap();
    std::fs::write(root.path().join(".git/info/exclude"), "excluded.md\n").unwrap();
    let (service, receiver) = service();
    let mut subscription = options(root.path(), "filters");
    subscription.filter = WatchFilter {
        ignore_dirs: vec!["build".into(), "cache".into()],
        extensions: vec![".md".into()],
        respect_gitignore: true,
    };
    let id = service.subscribe(subscription).unwrap();
    settle(&receiver, root.path(), "md", &[id]);
    for path in [
        "build/out.md",
        "src/cache/out.md",
        "src/private.md",
        "generated.md",
        "excluded.md",
        ".git/hidden.md",
        "src/wrong.txt",
        "src/kept.MD",
    ] {
        std::fs::write(root.path().join(path), "content").unwrap();
    }
    let batch = receive(&receiver, |batch| batch.paths.contains(&"src/kept.MD".into()));
    assert!(!batch.rescan);
    assert_eq!(batch.paths, ["src/kept.MD"]);
}

#[test]
fn gitignore_changes_emit_rescan_and_refresh_nested_rules() {
    let root = directory();
    std::fs::create_dir(root.path().join("src")).unwrap();
    std::fs::write(root.path().join("src/.gitignore"), "ignored.md\n").unwrap();
    let (service, receiver) = service();
    let mut subscription = options(root.path(), "rules");
    subscription.filter.respect_gitignore = true;
    let id = service.subscribe(subscription).unwrap();
    settle(&receiver, root.path(), "md", &[id]);
    std::fs::write(root.path().join("src/kept.md"), "prime cached rules").unwrap();
    receive(&receiver, |batch| batch.paths.contains(&"src/kept.md".into()));
    std::fs::write(root.path().join("src/.gitignore"), "").unwrap();
    receive(&receiver, |batch| batch.rescan);
    std::fs::write(root.path().join("src/ignored.md"), "now included").unwrap();
    receive(&receiver, |batch| batch.paths.contains(&"src/ignored.md".into()));
}

#[test]
fn workspace_removal_releases_exclusive_roots_but_retains_shared_roots() {
    let first = directory();
    let second = directory();
    let (service, receiver) = service();
    service.subscribe(options(first.path(), "removed")).unwrap();
    service.subscribe(options(second.path(), "removed")).unwrap();
    let retained = service.subscribe(options(first.path(), "retained")).unwrap();
    assert_eq!(service.root_count().unwrap(), 2);
    service.unwatch_workspace("removed").unwrap();
    assert_eq!(service.root_count().unwrap(), 1);
    settle(&receiver, first.path(), "md", &[retained]);
    std::fs::write(first.path().join("retained.md"), "retained").unwrap();
    let batch = receive(&receiver, |batch| batch.paths.contains(&"retained.md".into()));
    assert_eq!(batch.subscription_id, retained);
    service.unwatch_workspace("retained").unwrap();
    assert_eq!(service.root_count().unwrap(), 0);
}

#[test]
fn nested_negations_override_file_rules_but_not_ignored_parent_directories() {
    let root = directory();
    for path in ["src/deeper", "ignored"] {
        std::fs::create_dir_all(root.path().join(path)).unwrap();
    }
    std::fs::write(root.path().join(".gitignore"), "*.md\nignored/\n").unwrap();
    std::fs::write(root.path().join("src/deeper/.gitignore"), "!kept.md\n").unwrap();
    std::fs::write(root.path().join("ignored/.gitignore"), "!blocked.md\n").unwrap();
    let (service, receiver) = service();
    let mut subscription = options(root.path(), "negations");
    subscription.filter.respect_gitignore = true;
    let id = service.subscribe(subscription).unwrap();
    // The root ignores every Markdown file.
    settle(&receiver, root.path(), "txt", &[id]);
    std::fs::write(root.path().join("ignored/blocked.md"), "ignored parent").unwrap();
    std::fs::write(root.path().join("src/deeper/kept.md"), "nested override").unwrap();
    let batch = receive(&receiver, |batch| batch.paths.contains(&"src/deeper/kept.md".into()));
    assert_eq!(batch.paths, ["src/deeper/kept.md"]);
}

#[test]
fn shallow_gitignore_subscribers_refresh_excludes_and_root_rules_take_precedence() {
    let root = directory();
    std::fs::create_dir_all(root.path().join(".git/info")).unwrap();
    std::fs::write(root.path().join(".git/info/exclude"), "kept.md\nblocked.md\n").unwrap();
    std::fs::write(root.path().join(".gitignore"), "!kept.md\n").unwrap();
    let (service, receiver) = service();
    let mut subscription = options(root.path(), "shallow-excludes");
    subscription.recursive = false;
    subscription.filter.respect_gitignore = true;
    let id = service.subscribe(subscription).unwrap();
    settle(&receiver, root.path(), "md", &[id]);
    std::fs::write(root.path().join("blocked.md"), "ignored").unwrap();
    std::fs::write(root.path().join("kept.md"), "root rule wins").unwrap();
    let batch = receive(&receiver, |batch| batch.paths.contains(&"kept.md".into()));
    assert_eq!(batch.paths, ["kept.md"]);
    std::fs::write(root.path().join(".git/info/exclude"), "").unwrap();
    receive(&receiver, |batch| batch.rescan);
    std::fs::write(root.path().join("blocked.md"), "now included").unwrap();
    receive(&receiver, |batch| batch.paths.contains(&"blocked.md".into()));
}

#[test]
fn removing_a_directory_with_an_unmatched_extension_still_requires_rescan() {
    let root = directory();
    std::fs::create_dir(root.path().join("nested.generated")).unwrap();
    std::fs::write(root.path().join("nested.generated/old.md"), "old").unwrap();
    let (service, receiver) = service();
    let mut subscription = options(root.path(), "directory-removal");
    subscription.filter.extensions = vec!["md".into()];
    service.subscribe(subscription).unwrap();
    std::fs::remove_dir_all(root.path().join("nested.generated")).unwrap();
    receive(&receiver, |batch| batch.rescan);
}

#[test]
fn recursive_upgrade_keeps_nonrecursive_delivery_shallow() {
    let root = directory();
    std::fs::create_dir(root.path().join("nested")).unwrap();
    let (service, receiver) = service();
    let mut shallow = options(root.path(), "shallow");
    shallow.recursive = false;
    let shallow_id = service.subscribe(shallow).unwrap();
    let recursive_id = service.subscribe(options(root.path(), "deep")).unwrap();
    assert_eq!(service.root_count().unwrap(), 1);
    receive(&receiver, |batch| batch.subscription_id == shallow_id && batch.rescan);
    settle(&receiver, root.path(), "md", &[shallow_id, recursive_id]);
    std::fs::write(root.path().join("nested/deep.md"), "deep").unwrap();
    std::fs::write(root.path().join("top.md"), "top").unwrap();
    let mut ids = std::collections::BTreeSet::new();
    while ids.len() < 2 {
        let batch = receive(&receiver, |batch| batch.paths.contains(&"top.md".into()));
        if batch.subscription_id == shallow_id {
            assert_eq!(batch.paths, ["top.md"]);
        } else {
            assert_eq!(batch.subscription_id, recursive_id);
            assert!(batch.paths.contains(&"nested/deep.md".into()));
        }
        ids.insert(batch.subscription_id);
    }
}

#[test]
fn a_missing_root_is_rearmed_after_creation_and_after_recreation() {
    let parent = directory();
    let root = parent.path().join("missing");
    let (service, receiver) = service();
    service.subscribe(options(&root, "lifetime")).unwrap();
    assert_eq!(service.root_count().unwrap(), 1);
    std::fs::create_dir(&root).unwrap();
    receive(&receiver, |batch| batch.rescan);
    std::fs::write(root.join("created.md"), "created").unwrap();
    receive(&receiver, |batch| batch.paths.contains(&"created.md".into()));
    std::fs::remove_dir_all(&root).unwrap();
    receive(&receiver, |batch| batch.rescan);
    std::fs::create_dir(&root).unwrap();
    receive(&receiver, |batch| batch.rescan);
    std::fs::write(root.join("recreated.md"), "recreated").unwrap();
    receive(&receiver, |batch| batch.paths.contains(&"recreated.md".into()));
}

#[test]
fn directories_renamed_into_the_root_require_a_full_rescan() {
    let parent = directory();
    let root = parent.path().join("root");
    let outside = parent.path().join("outside");
    std::fs::create_dir(&root).unwrap();
    std::fs::create_dir(&outside).unwrap();
    std::fs::write(outside.join("already.md"), "present before move").unwrap();
    let (service, receiver) = service();
    let mut subscription = options(&root, "rename");
    subscription.filter.extensions = vec!["md".into()];
    service.subscribe(subscription).unwrap();
    std::fs::rename(&outside, root.join("moved")).unwrap();
    receive(&receiver, |batch| batch.rescan);
}

#[test]
fn invalid_roots_preserve_diagnostic_errors_without_leaking_roots() {
    let root = directory();
    let file = root.path().join("file");
    std::fs::write(&file, "not a directory").unwrap();
    let (service, _) = service();
    let error = service.subscribe(options(&file, "invalid")).unwrap_err();
    assert!(error.to_string().contains("not a directory"));
    assert_eq!(service.root_count().unwrap(), 0);
}

#[cfg(unix)]
#[test]
fn symlink_aliases_and_future_symlink_roots_share_one_watcher() {
    let parent = directory();
    let real = parent.path().join("real");
    let alias = parent.path().join("alias");
    std::fs::create_dir(&real).unwrap();
    let (service, receiver) = service();
    let real_id = service.subscribe(options(&real, "real")).unwrap();
    let alias_id = service.subscribe(options(&alias, "alias")).unwrap();
    assert_eq!(service.root_count().unwrap(), 2);
    std::os::unix::fs::symlink("real", &alias).unwrap();
    receive(&receiver, |batch| batch.subscription_id == alias_id && batch.rescan);
    assert_eq!(service.root_count().unwrap(), 1);
    let third = service.subscribe(options(&alias, "third")).unwrap();
    assert_eq!(service.root_count().unwrap(), 1);
    std::fs::write(real.join("shared.md"), "shared").unwrap();
    let mut ids = std::collections::BTreeSet::new();
    while ids.len() < 3 {
        ids.insert(
            receive(&receiver, |batch| batch.paths.contains(&"shared.md".into())).subscription_id,
        );
    }
    assert_eq!(ids, [real_id, alias_id, third].into_iter().collect());
}

#[cfg(windows)]
#[test]
fn windows_case_aliases_share_one_root() {
    let root = directory();
    let canonical = root.path().canonicalize().unwrap();
    let (service, _) = service();
    service.subscribe(options(&canonical, "first")).unwrap();
    service
        .subscribe(options(Path::new(&canonical.to_string_lossy().to_uppercase()), "second"))
        .unwrap();
    assert_eq!(service.root_count().unwrap(), 1);
}
