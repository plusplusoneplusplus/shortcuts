use coc_native_core::git::patch::{process_patch, PatchResult};
use coc_native_core::git::patch_store::{
    PatchExecution, PatchKey, PatchScope, PatchSource, PatchStore, PatchStoreError, PatchVersion,
    RemotePatchSource,
};
use std::sync::{atomic::AtomicBool, atomic::Ordering, mpsc, Arc, Barrier};
use std::thread;
use std::time::Duration;

fn scope(root: &std::path::Path) -> PatchScope {
    PatchScope {
        workspace_id: "workspace".into(),
        root: root.into(),
        execution: PatchExecution::Host,
        source: PatchSource::Remote(RemotePatchSource {
            provider: "ado".into(),
            host: "dev.azure.com".into(),
            repository: "org/project/repository".into(),
            source_id: "pr:42".into(),
            iteration: Some("2".into()),
            base_iteration: Some("1".into()),
        }),
    }
}

fn key(version: &str) -> PatchKey {
    PatchKey { version: PatchVersion::Fingerprint(version.into()), variant: "all:context=3".into() }
}

fn patch(text: &str) -> PatchResult {
    process_patch(
        format!("diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-old\n+{text}\n"),
        None,
    )
}

#[test]
fn cancelled_transports_cannot_read_cached_bytes_or_reserve_capacity() {
    let root = tempfile::tempdir().unwrap();
    let identity = scope(root.path());
    let store = PatchStore::open(identity.clone(), 1, 4096).unwrap();
    let raw = patch("cached").content.raw;
    store
        .complete_transport(&identity, store.begin_transport(&identity).unwrap(), raw.clone(), None)
        .unwrap();
    for bytes in [raw.clone(), patch("uncached").content.raw] {
        let ticket = store.begin_transport(&identity).unwrap();
        ticket.request_cancellation.cancel();
        ticket.request_cancellation.cancel();
        assert_eq!(
            store.complete_transport(&identity, ticket, bytes, None),
            Err(PatchStoreError::Cancelled)
        );
    }
    assert_eq!(
        store
            .complete_transport(
                &identity,
                store.begin_transport(&identity).unwrap(),
                raw.clone(),
                None
            )
            .unwrap()
            .content
            .raw,
        raw
    );
    let mut local = identity;
    local.source = PatchSource::Local { kind: "revision".into() };
    let store = PatchStore::open(local.clone(), 1, 4096).unwrap();
    let ticket = store.begin_transport(&local).unwrap();
    ticket.request_cancellation.cancel();
    assert_eq!(
        store.complete_working_tree_transport(&local, ticket, vec![raw], None, false),
        Err(PatchStoreError::Cancelled)
    );
    store
        .complete_working_tree_transport(
            &local,
            store.begin_transport(&local).unwrap(),
            vec![],
            None,
            false,
        )
        .unwrap();
}

#[test]
fn working_tree_snapshots_retain_composition_and_reject_revoked_transports() {
    let root = tempfile::tempdir().unwrap();
    let mut identity = scope(root.path());
    identity.source = PatchSource::Local { kind: "revision".into() };
    let store = PatchStore::open(identity.clone(), 8, 1 << 20).unwrap();
    let staged = patch("staged").content.raw;
    let unstaged = patch("disk\n+extra").content.raw;
    let outputs = vec![staged.clone(), unstaged.clone()];
    let read = |outputs: Vec<String>, headings, max_lines| {
        store
            .complete_working_tree_transport(
                &identity,
                store.begin_transport(&identity).unwrap(),
                outputs,
                max_lines,
                headings,
            )
            .unwrap()
    };
    assert!(read(outputs.clone(), false, Some(1)).content.truncated);
    let complete = read(outputs.clone(), false, None);
    assert_eq!(complete.files.len(), 1);
    assert_eq!(complete.summary.additions, 2);
    assert_eq!(complete.files[0].raw, format!("{staged}\n{unstaged}"));
    let mut hash = blake3::Hasher::new();
    for raw in &outputs {
        hash.update(&(raw.len() as u64).to_le_bytes());
        hash.update(raw.as_bytes());
    }
    let cached = store
        .get_or_compute(
            &identity,
            PatchKey {
                version: PatchVersion::Fingerprint(hash.finalize().to_hex().to_string()),
                variant: "working-tree".into(),
            },
            || panic!("complete snapshot must be retained"),
        )
        .unwrap();
    assert_eq!(*cached, complete);
    assert!(read(outputs, true, None).content.raw.contains("# Staged Changes"));
    // The same concatenated bytes in different batch positions are not one version.
    assert!(read(vec![staged.clone(), String::new()], true, None)
        .content
        .raw
        .starts_with("# Staged"));
    assert!(read(vec![String::new(), staged], true, None).content.raw.starts_with("# Unstaged"));
    assert!(read(vec![patch("fresh").content.raw], false, None).content.raw.contains("+fresh"));
    let ticket = store.begin_transport(&identity).unwrap();
    store.refresh(&identity).unwrap();
    assert_eq!(
        store.complete_working_tree_transport(&identity, ticket, vec![], None, false),
        Err(PatchStoreError::Stale)
    );
    let ticket = store.begin_transport(&identity).unwrap();
    store.dispose(&identity).unwrap();
    assert_eq!(
        store.complete_working_tree_transport(&identity, ticket, vec![], None, false),
        Err(PatchStoreError::Closed)
    );
    let remote = scope(root.path());
    let remote_store = PatchStore::open(remote.clone(), 8, 4096).unwrap();
    assert_eq!(
        remote_store.complete_working_tree_transport(
            &remote,
            remote_store.begin_transport(&remote).unwrap(),
            vec![],
            None,
            false
        ),
        Err(PatchStoreError::InvalidIdentity)
    );
}

#[test]
fn transport_tickets_bind_exact_handles_scopes_and_generations() {
    let root = tempfile::tempdir().unwrap();
    let mut identity = scope(root.path());
    identity.execution = PatchExecution::Wsl { distro: "Ubuntu".into() };
    identity.root = "/repo".into();
    let store = PatchStore::open(identity.clone(), 4, 4096).unwrap();
    let other = PatchStore::open(identity.clone(), 4, 4096).unwrap();
    let raw = patch("transport").content.raw;
    let ticket = store.begin_transport(&identity).unwrap();
    assert_eq!(
        other.complete_transport(&identity, ticket, raw.clone(), None),
        Err(PatchStoreError::ScopeMismatch)
    );
    let mut wrong = identity.clone();
    wrong.workspace_id = "other".into();
    assert!(matches!(store.begin_transport(&wrong), Err(PatchStoreError::ScopeMismatch)));
    let ticket = store.begin_transport(&identity).unwrap();
    assert_eq!(
        store.complete_transport(&wrong, ticket, raw.clone(), None),
        Err(PatchStoreError::ScopeMismatch)
    );
    let ticket = store.begin_transport(&identity).unwrap();
    store.refresh(&identity).unwrap();
    assert_eq!(
        store.complete_transport(&identity, ticket, raw.clone(), None),
        Err(PatchStoreError::Stale)
    );
    let ticket = store.begin_transport(&identity).unwrap();
    store.dispose(&identity).unwrap();
    assert_eq!(
        store.complete_transport(&identity, ticket, raw, None),
        Err(PatchStoreError::Closed)
    );
    assert!(matches!(store.begin_transport(&identity), Err(PatchStoreError::Closed)));
}

#[test]
fn supplied_bytes_share_complete_snapshots_and_fingerprint_changes_stay_fresh() {
    let root = tempfile::tempdir().unwrap();
    let identity = scope(root.path());
    let store = PatchStore::open(identity.clone(), 1, 4096).unwrap();
    let raw = patch("first").content.raw;
    let first = store
        .complete_transport(
            &identity,
            store.begin_transport(&identity).unwrap(),
            raw.clone(),
            Some(1),
        )
        .unwrap();
    assert!(first.content.truncated);
    let fingerprint = |raw: &str| PatchKey {
        version: PatchVersion::Fingerprint(blake3::hash(raw.as_bytes()).to_hex().to_string()),
        variant: "supplied".into(),
    };
    let retained = store
        .get_or_compute(&identity, fingerprint(&raw), || {
            panic!("complete snapshot must be retained")
        })
        .unwrap();
    assert_eq!(retained.content.raw, raw);
    assert!(!retained.content.truncated);
    let changed = patch("changed").content.raw;
    let result = store
        .complete_transport(
            &identity,
            store.begin_transport(&identity).unwrap(),
            changed.clone(),
            None,
        )
        .unwrap();
    assert_eq!(result.content.raw, changed);
    let recomputed =
        store.get_or_compute(&identity, fingerprint(&raw), || Ok(patch("evicted"))).unwrap();
    assert!(recomputed.content.raw.contains("+evicted"));
    // Dropping a request never reserves a worker or a bounded computation slot.
    drop(store.begin_transport(&identity).unwrap());
    store
        .complete_transport(
            &identity,
            store.begin_transport(&identity).unwrap(),
            String::new(),
            None,
        )
        .unwrap();
}

#[test]
fn validates_identity_and_rejects_every_cross_scope_dimension() {
    let root = tempfile::tempdir().unwrap();
    let identity = scope(root.path());
    let store = PatchStore::open(identity.clone(), 4, 4096).unwrap();
    let mut variants = vec![identity.clone(); 9];
    variants[0].workspace_id = "other".into();
    variants[1].root = root.path().join("clone");
    variants[2].execution = PatchExecution::Wsl { distro: "Ubuntu".into() };
    for (variant, field) in variants[3..].iter_mut().zip(0..6) {
        if let PatchSource::Remote(source) = &mut variant.source {
            match field {
                0 => source.provider = "github".into(),
                1 => source.host = "other.example".into(),
                2 => source.repository = "org/project/other".into(),
                3 => source.iteration = Some("3".into()),
                4 => source.base_iteration = None,
                _ => source.source_id = "pr:43".into(),
            }
        }
    }
    for other in variants {
        let ticket = store.begin_transport(&identity).unwrap();
        assert_eq!(
            store.complete_transport(&other, ticket, patch("wrong scope").content.raw, None),
            Err(PatchStoreError::ScopeMismatch)
        );
        assert_eq!(
            store.get_or_compute(&other, key("v1"), || panic!("wrong scope")),
            Err(PatchStoreError::ScopeMismatch)
        );
        assert_eq!(store.refresh(&other), Err(PatchStoreError::ScopeMismatch));
        assert_eq!(store.dispose(&other), Err(PatchStoreError::ScopeMismatch));
    }
    let mut invalid = identity.clone();
    invalid.workspace_id.clear();
    assert!(matches!(PatchStore::open(invalid, 1, 1), Err(PatchStoreError::InvalidIdentity)));
    invalid = identity.clone();
    invalid.root = "relative".into();
    assert!(matches!(
        PatchStore::open(invalid.clone(), 1, 1),
        Err(PatchStoreError::InvalidIdentity)
    ));
    if let PatchSource::Remote(source) = &mut invalid.source {
        source.host.clear();
    }
    invalid.root = root.path().into();
    assert!(matches!(PatchStore::open(invalid, 1, 1), Err(PatchStoreError::InvalidIdentity)));
    let mut wsl = identity.clone();
    wsl.root = "/home/user/repo".into();
    wsl.execution = PatchExecution::Wsl { distro: "Ubuntu".into() };
    assert!(PatchStore::open(wsl, 1, 1).is_ok());
    let mut revisions = key("unused");
    revisions.version = PatchVersion::Revisions { base: "main".into(), head: "HEAD".into() };
    assert_eq!(
        store.get_or_compute(&identity, revisions, || panic!("mutable refs")),
        Err(PatchStoreError::InvalidIdentity)
    );
}

#[test]
fn remote_sources_require_complete_identity_and_cannot_execute_local_revisions() {
    let root = tempfile::tempdir().unwrap();
    let identity = scope(root.path());
    for field in 0..7 {
        let mut invalid = identity.clone();
        if let PatchSource::Remote(source) = &mut invalid.source {
            match field {
                0 => source.provider = " ".into(),
                1 => source.host.clear(),
                2 => source.repository.clear(),
                3 => source.source_id.clear(),
                4 => source.iteration = Some(" ".into()),
                5 => source.base_iteration = Some(" ".into()),
                _ => source.iteration = None,
            }
        }
        assert!(matches!(
            PatchStore::open(invalid, 1, 4096),
            Err(PatchStoreError::InvalidIdentity)
        ));
    }
    let store = PatchStore::open(identity, 1, 4096).unwrap();
    assert_eq!(
        store
            .revision_patch(
                store.begin_transport(store.scope()).unwrap(),
                "commit",
                "HEAD",
                None,
                None,
                None,
                None,
                &coc_native_core::git::GitCommandOptions::default(),
            )
            .unwrap_err(),
        PatchStoreError::InvalidIdentity
    );
}

#[test]
fn concurrent_initialization_computes_once_and_shares_snapshot() {
    let root = tempfile::tempdir().unwrap();
    let identity = scope(root.path());
    let store = Arc::new(PatchStore::open(identity.clone(), 4, 4096).unwrap());
    let barrier = Arc::new(Barrier::new(9));
    let calls = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let threads: Vec<_> = (0..8)
        .map(|_| {
            let (store, identity, barrier, calls) =
                (store.clone(), identity.clone(), barrier.clone(), calls.clone());
            thread::spawn(move || {
                barrier.wait();
                store
                    .get_or_compute(&identity, key("v1"), || {
                        calls.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                        Ok(patch("current"))
                    })
                    .unwrap()
            })
        })
        .collect();
    barrier.wait();
    let results: Vec<_> = threads.into_iter().map(|t| t.join().unwrap()).collect();
    assert_eq!(calls.load(std::sync::atomic::Ordering::SeqCst), 1);
    assert!(results.iter().all(|r| Arc::ptr_eq(r, &results[0])));
}

#[test]
fn versions_variants_and_independent_clones_never_alias() {
    let root = tempfile::tempdir().unwrap();
    let identity = scope(root.path());
    let store = PatchStore::open(identity.clone(), 4, 4096).unwrap();
    let mut revisions = key("unused");
    revisions.version = PatchVersion::Revisions { base: "a".repeat(40), head: "b".repeat(40) };
    let original =
        store.get_or_compute(&identity, revisions.clone(), || Ok(patch("first"))).unwrap();
    if let PatchVersion::Revisions { base, .. } = &mut revisions.version {
        *base = "c".repeat(40);
    }
    let changed =
        store.get_or_compute(&identity, revisions.clone(), || Ok(patch("base moved"))).unwrap();
    assert_ne!(original, changed);
    if let PatchVersion::Revisions { head, .. } = &mut revisions.version {
        *head = "d".repeat(64);
    }
    assert_ne!(
        changed,
        store.get_or_compute(&identity, revisions.clone(), || Ok(patch("head moved"))).unwrap()
    );
    revisions.variant = "file=x:context=0".into();
    assert_ne!(
        changed,
        store.get_or_compute(&identity, revisions, || Ok(patch("context"))).unwrap()
    );
    let clone_root = tempfile::tempdir().unwrap();
    let clone_identity = scope(clone_root.path());
    let clone_store = PatchStore::open(clone_identity.clone(), 4, 4096).unwrap();
    let left = store.get_or_compute(&identity, key("snapshot"), || Ok(patch("left"))).unwrap();
    let right = clone_store
        .get_or_compute(&clone_identity, key("snapshot"), || Ok(patch("right")))
        .unwrap();
    assert_ne!(left, right);
}

#[test]
fn lru_entry_and_byte_caps_evict_and_oversized_results_are_not_retained() {
    let root = tempfile::tempdir().unwrap();
    let identity = scope(root.path());
    let store = PatchStore::open(identity.clone(), 2, 4096).unwrap();
    for version in ["a", "b"] {
        store.get_or_compute(&identity, key(version), || Ok(patch(version))).unwrap();
    }
    store.get_or_compute(&identity, key("a"), || panic!("cache hit")).unwrap();
    store.get_or_compute(&identity, key("c"), || Ok(patch("c"))).unwrap();
    store.get_or_compute(&identity, key("a"), || panic!("recent entry survives")).unwrap();
    assert!(store.get_or_compute(&identity, key("b"), || Err("evicted".into())).is_err());
    let bounded = PatchStore::open(identity.clone(), 10, 12000).unwrap();
    let allocated = || {
        let mut result = patch("small");
        result.content.raw.reserve(8192);
        Ok(result)
    };
    bounded.get_or_compute(&identity, key("a"), allocated).unwrap();
    bounded.get_or_compute(&identity, key("a"), || panic!("fits byte cap")).unwrap();
    bounded.get_or_compute(&identity, key("b"), allocated).unwrap();
    assert!(bounded.get_or_compute(&identity, key("a"), || Err("byte eviction".into())).is_err());
    let oversized = PatchStore::open(identity.clone(), 1, 1).unwrap();
    oversized.get_or_compute(&identity, key("large"), || Ok(patch("large"))).unwrap();
    assert!(oversized
        .get_or_compute(&identity, key("large"), || Err("not retained".into()))
        .is_err());
    let reserved = PatchStore::open(identity.clone(), 1, 4096).unwrap();
    reserved
        .get_or_compute(&identity, key("reserved"), || {
            let mut result = patch("small");
            result.content.raw.reserve(8192);
            Ok(result)
        })
        .unwrap();
    assert!(reserved
        .get_or_compute(&identity, key("reserved"), || Err("allocated bytes".into()))
        .is_err());
    reserved
        .get_or_compute(&identity, key("truncated"), || {
            Ok(process_patch(patch("small").content.raw, Some(1)))
        })
        .unwrap();
    assert!(reserved
        .get_or_compute(&identity, key("truncated"), || Err("incomplete snapshot".into()))
        .is_err());
}

#[test]
fn refresh_and_disposal_reject_late_results_without_overwriting_new_generation() {
    for dispose in [false, true] {
        let root = tempfile::tempdir().unwrap();
        let identity = scope(root.path());
        let store = Arc::new(PatchStore::open(identity.clone(), 2, 4096).unwrap());
        let (started_tx, started_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let (worker_store, worker_scope) = (store.clone(), identity.clone());
        let worker = thread::spawn(move || {
            worker_store.get_or_compute(&worker_scope, key("v1"), || {
                started_tx.send(()).unwrap();
                release_rx.recv_timeout(Duration::from_secs(5)).unwrap();
                Ok(patch("stale"))
            })
        });
        started_rx.recv_timeout(Duration::from_secs(5)).unwrap();
        let expected = if dispose {
            store.dispose(&identity).unwrap();
            store.dispose(&identity).unwrap();
            assert_eq!(store.refresh(&identity), Err(PatchStoreError::Closed));
            PatchStoreError::Closed
        } else {
            store.refresh(&identity).unwrap();
            store.get_or_compute(&identity, key("v1"), || Ok(patch("fresh"))).unwrap();
            PatchStoreError::Stale
        };
        release_tx.send(()).unwrap();
        assert_eq!(worker.join().unwrap(), Err(expected.clone()));
        let result = store.get_or_compute(&identity, key("v1"), || panic!("late result installed"));
        if dispose {
            assert_eq!(result, Err(expected));
        } else {
            assert_eq!(result.unwrap().content.raw, patch("fresh").content.raw);
        }
    }
}

#[test]
fn refresh_does_not_release_running_work_capacity_and_failures_allow_retry() {
    let root = tempfile::tempdir().unwrap();
    let identity = scope(root.path());
    let store = Arc::new(PatchStore::open(identity.clone(), 1, 4096).unwrap());
    let (started_tx, started_rx) = mpsc::channel();
    let (release_tx, release_rx) = mpsc::channel();
    let (worker_store, worker_scope) = (store.clone(), identity.clone());
    let worker = thread::spawn(move || {
        worker_store.get_or_compute(&worker_scope, key("v1"), || {
            started_tx.send(()).unwrap();
            release_rx.recv_timeout(Duration::from_secs(5)).unwrap();
            Err("transport failed".into())
        })
    });
    started_rx.recv_timeout(Duration::from_secs(5)).unwrap();
    for _ in 0..3 {
        store.refresh(&identity).unwrap();
        assert_eq!(
            store.get_or_compute(&identity, key("v2"), || panic!("capacity")),
            Err(PatchStoreError::Capacity)
        );
    }
    release_tx.send(()).unwrap();
    assert_eq!(worker.join().unwrap(), Err(PatchStoreError::Stale));
    assert_eq!(
        store.get_or_compute(&identity, key("v1"), || Err("failed".into())),
        Err(PatchStoreError::Compute("failed".into()))
    );
    assert_eq!(
        store.get_or_compute(&identity, key("v1"), || panic!("failed worker")),
        Err(PatchStoreError::Compute("patch computation panicked".into()))
    );
    store.get_or_compute(&identity, key("v1"), || Ok(patch("retry"))).unwrap();
}

fn git(root: &std::path::Path, args: &[&str]) -> String {
    let output = std::process::Command::new("git").arg("-C").arg(root).args(args).output().unwrap();
    assert!(output.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&output.stderr));
    String::from_utf8(output.stdout).unwrap().trim().to_owned()
}

#[test]
#[ignore = "subprocess fixture invoked by Git"]
fn blocking_patch_git_helper() {
    let root = std::env::var_os("PATCH_HELPER_ROOT").expect("isolated fixture root");
    let root = std::path::PathBuf::from(root);
    std::fs::write(root.join("started"), "ready").unwrap();
    let deadline = std::time::Instant::now() + Duration::from_secs(10);
    while !root.join("release").exists() && std::time::Instant::now() < deadline {
        thread::sleep(Duration::from_millis(5));
    }
    std::fs::write(root.join("finished"), "done").unwrap();
}

struct BlockingGit {
    root: tempfile::TempDir,
    command: String,
}

impl BlockingGit {
    fn new() -> Self {
        let root = tempfile::tempdir().unwrap();
        let exe = std::env::current_exe().unwrap().to_string_lossy().replace('\\', "/");
        // Git's command shell invokes only this test; appended diff arguments
        // belong to the shell function, not the Rust test harness.
        let command = format!(
            "f() {{ '{}' --ignored --exact blocking_patch_git_helper --nocapture; }}; f",
            exe.replace('\'', "'\\''")
        );
        git(root.path(), &["init", "--initial-branch=main"]);
        Self { root, command }
    }

    fn wait_for(&self, name: &str) {
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        while !self.root.path().join(name).exists() {
            assert!(std::time::Instant::now() < deadline, "helper did not reach {name}");
            thread::sleep(Duration::from_millis(5));
        }
    }
}

impl Drop for BlockingGit {
    fn drop(&mut self) {
        std::fs::write(self.root.path().join("release"), "").unwrap();
        if self.root.path().join("started").exists() {
            self.wait_for("finished");
        }
    }
}

#[test]
fn runner_cancellation_rejects_before_spawn_and_kills_running_git_without_a_timeout() {
    use coc_native_core::git::{run_git, GitCommandOptions, GitErrorKind};
    let fixture = BlockingGit::new();
    let cancellation = Arc::new(AtomicBool::new(true));
    let options = GitCommandOptions {
        cancellation: vec![Arc::new(AtomicBool::new(false)), cancellation.clone()],
        timeout_ms: 0,
        env: vec![("PATCH_HELPER_ROOT".into(), fixture.root.path().to_string_lossy().into_owned())],
        ..Default::default()
    };
    let args = vec!["-c".into(), format!("alias.block=!{}", fixture.command), "block".into()];
    let error = run_git(fixture.root.path(), &args, &options).unwrap_err();
    assert_eq!(error.kind, GitErrorKind::Cancelled);
    assert!(!fixture.root.path().join("started").exists());
    cancellation.store(false, Ordering::Release);
    let root = fixture.root.path().to_owned();
    let (tx, rx) = mpsc::channel();
    let worker = thread::spawn(move || tx.send(run_git(&root, &args, &options)).unwrap());
    fixture.wait_for("started");
    cancellation.store(true, Ordering::Release);
    let error =
        rx.recv_timeout(Duration::from_secs(2)).expect("Git must be killed promptly").unwrap_err();
    assert_eq!(error.kind, GitErrorKind::Cancelled);
    assert_eq!(error.stderr, "patch scope cancelled");
    worker.join().unwrap();
}

#[test]
fn host_patch_revocation_stops_git_and_old_dispatches_cannot_enter_a_new_generation() {
    use coc_native_core::git::GitCommandOptions;
    for action in ["cancel", "refresh", "dispose"] {
        let fixture = BlockingGit::new();
        let root = fixture.root.path();
        for (key, value) in [
            ("user.name", "Test"),
            ("user.email", "test@example.com"),
            ("commit.gpgsign", "false"),
            ("core.autocrlf", "false"),
            ("diff.block.textconv", fixture.command.as_str()),
        ] {
            git(root, &["config", key, value]);
        }
        std::fs::write(root.join(".gitattributes"), "*.txt diff=block\n").unwrap();
        std::fs::write(root.join("same.txt"), "one\n").unwrap();
        git(root, &["add", "."]);
        git(root, &["commit", "-qm", "initial"]);
        let mut identity = scope(root);
        identity.source = PatchSource::Local { kind: "revision".into() };
        let store = Arc::new(PatchStore::open(identity.clone(), 8, 1 << 20).unwrap());
        let ticket = store.begin_transport(&identity).unwrap();
        let cancellation = ticket.request_cancellation.clone();
        let queued = store.begin_transport(&identity).unwrap();
        let options = GitCommandOptions {
            timeout_ms: 0,
            env: vec![("PATCH_HELPER_ROOT".into(), root.to_string_lossy().into_owned())],
            ..Default::default()
        };
        let (tx, rx) = mpsc::channel();
        let owner = store.clone();
        let worker = thread::spawn(move || {
            tx.send(owner.revision_patch(
                ticket,
                "show",
                "HEAD",
                None,
                Some("same.txt"),
                None,
                None,
                &options,
            ))
            .unwrap();
        });
        fixture.wait_for("started");
        match action {
            "cancel" => {
                cancellation.cancel();
                queued.request_cancellation.cancel();
            }
            "dispose" => store.dispose(&identity).unwrap(),
            _ => store.refresh(&identity).unwrap(),
        }
        let expected = match action {
            "cancel" => PatchStoreError::Cancelled,
            "dispose" => PatchStoreError::Closed,
            _ => PatchStoreError::Stale,
        };
        assert_eq!(
            rx.recv_timeout(Duration::from_secs(2)).expect("revoked Git must stop").unwrap_err(),
            expected
        );
        worker.join().unwrap();
        // Includes invalid-ref fallback, which must not bypass lifecycle checks.
        assert_eq!(
            store
                .revision_patch(
                    queued,
                    "show",
                    "missing",
                    None,
                    None,
                    None,
                    None,
                    &GitCommandOptions::default()
                )
                .unwrap_err(),
            expected
        );
        if action != "dispose" {
            git(root, &["config", "--unset", "diff.block.textconv"]);
            let fresh = store
                .revision_patch(
                    store.begin_transport(&identity).unwrap(),
                    "show",
                    "HEAD",
                    None,
                    Some("same.txt"),
                    None,
                    None,
                    &GitCommandOptions::default(),
                )
                .unwrap();
            assert!(fresh.content.raw.contains("+one"));
        }
    }
}

#[test]
fn working_tree_dispatch_checks_revocation_before_git_for_both_lifecycle_actions() {
    let root = tempfile::tempdir().unwrap();
    for closed in [false, true] {
        let mut identity = scope(root.path());
        identity.source = PatchSource::Local { kind: "revision".into() };
        let store = PatchStore::open(identity.clone(), 8, 4096).unwrap();
        let ticket = store.begin_transport(&identity).unwrap();
        if closed {
            store.dispose(&identity).unwrap();
        } else {
            store.refresh(&identity).unwrap();
        }
        assert_eq!(
            store.working_tree_patch(ticket, "all", None, None, None, false).unwrap_err(),
            if closed { PatchStoreError::Closed } else { PatchStoreError::Stale }
        );
    }
}

#[test]
fn revision_patches_pin_moved_refs_retain_complete_snapshots_and_keep_git_errors() {
    use coc_native_core::git::GitCommandOptions;
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    git(root, &["init", "--initial-branch=main"]);
    for (key, value) in [("user.name", "T"), ("user.email", "t@e.x"), ("commit.gpgsign", "false")] {
        git(root, &["config", key, value]);
    }
    let commit = |text: &str| {
        std::fs::write(root.join("a.txt"), text).unwrap();
        git(root, &["add", "."]);
        git(root, &["commit", "-qm", text]);
        git(root, &["rev-parse", "HEAD"])
    };
    let initial = commit("one\n");
    commit("one\ntwo\n");
    let mut identity = scope(root);
    identity.source = PatchSource::Local { kind: "revision".into() };
    let store = PatchStore::open(identity.clone(), 8, 1 << 20).unwrap();
    let options = GitCommandOptions::default();
    let range = |max| {
        store.revision_patch(
            store.begin_transport(&identity).unwrap(),
            "range",
            "HEAD~1",
            Some("HEAD"),
            None,
            None,
            max,
            &options,
        )
    };

    // Truncation applies per request; the retained snapshot stays complete.
    let truncated = range(Some(1)).unwrap();
    assert!(truncated.content.truncated);
    assert_eq!(truncated.content.raw, "diff --git a/a.txt b/a.txt");
    let full = range(None).unwrap();
    assert!(!full.content.truncated && full.content.raw.contains("+two"));
    assert_eq!(full.content.total_lines, truncated.content.total_lines);

    // A moved ref resolves to a new version rather than reusing the old one.
    commit("one\ntwo\nthree\n");
    let moved = range(None).unwrap();
    assert!(moved.content.raw.contains("+three") && !moved.content.raw.contains("+two"));

    let added = store
        .revision_patch(
            store.begin_transport(&identity).unwrap(),
            "commit",
            &initial,
            None,
            None,
            None,
            None,
            &options,
        )
        .unwrap();
    assert_eq!(added.files[0].status, "added");
    let shown = store
        .revision_patch(
            store.begin_transport(&identity).unwrap(),
            "show",
            "HEAD",
            None,
            None,
            Some(0),
            None,
            &options,
        )
        .unwrap();
    assert!(shown.content.raw.contains("@@ -2,0 +3 @@"));
    let error = store.revision_patch(
        store.begin_transport(&identity).unwrap(),
        "range",
        "missing",
        Some("HEAD"),
        None,
        None,
        None,
        &options,
    );
    assert!(error.unwrap_err().to_string().starts_with("git --literal-pathspecs diff"));
    assert!(store
        .revision_patch(
            store.begin_transport(&identity).unwrap(),
            "range",
            "HEAD",
            None,
            None,
            None,
            None,
            &options
        )
        .is_err());

    // All host modes use the same bounded runner, including uncached failures.
    let limited = PatchStore::open(identity.clone(), 8, 1 << 20).unwrap();
    let limits = GitCommandOptions { max_buffer_bytes: 1, ..Default::default() };
    for (mode, base, head) in [
        ("commit", "HEAD", None),
        ("show", "HEAD", None),
        ("range", "HEAD~1", Some("HEAD")),
        ("comparison", "HEAD~1", Some("HEAD")),
    ] {
        assert!(limited
            .revision_patch(
                limited.begin_transport(&identity).unwrap(),
                mode,
                base,
                head,
                None,
                None,
                None,
                &limits
            )
            .unwrap_err()
            .to_string()
            .starts_with("git "));
        assert!(limited
            .revision_patch(
                limited.begin_transport(&identity).unwrap(),
                mode,
                base,
                head,
                None,
                None,
                None,
                &options
            )
            .unwrap()
            .content
            .raw
            .contains("+three"));
    }

    let ticket = store.begin_transport(&identity).unwrap();
    store.dispose(store.scope()).unwrap();
    let closed = store.revision_patch(ticket, "commit", "HEAD", None, None, None, None, &options);
    assert_eq!(closed.unwrap_err(), PatchStoreError::Closed);
    identity.execution = PatchExecution::Wsl { distro: "Ubuntu".into() };
    identity.root = "/home/user/repo".into();
    let wsl = PatchStore::open(identity, 8, 1 << 20).unwrap();
    let rejected = wsl.revision_patch(
        wsl.begin_transport(wsl.scope()).unwrap(),
        "commit",
        "HEAD",
        None,
        None,
        None,
        None,
        &options,
    );
    assert_eq!(rejected.unwrap_err(), PatchStoreError::InvalidIdentity);
}
