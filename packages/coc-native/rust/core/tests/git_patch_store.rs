use coc_native_core::git::patch::{process_patch, PatchResult};
use coc_native_core::git::patch_store::{
    PatchExecution, PatchKey, PatchScope, PatchSource, PatchStore, PatchStoreError, PatchVersion,
};
use std::sync::{mpsc, Arc, Barrier};
use std::thread;
use std::time::Duration;

fn scope(root: &std::path::Path) -> PatchScope {
    PatchScope {
        workspace_id: "workspace".into(),
        root: root.into(),
        execution: PatchExecution::Host,
        source: PatchSource::Remote {
            provider: "ado".into(),
            host: "dev.azure.com".into(),
            repository: "org/project/repository".into(),
            iteration: Some("2".into()),
            base_iteration: Some("1".into()),
        },
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
    let mut variants = vec![identity.clone(); 8];
    variants[0].workspace_id = "other".into();
    variants[1].root = root.path().join("clone");
    variants[2].execution = PatchExecution::Wsl { distro: "Ubuntu".into() };
    for (variant, field) in variants[3..].iter_mut().zip(0..5) {
        if let PatchSource::Remote { provider, host, repository, iteration, base_iteration } =
            &mut variant.source
        {
            match field {
                0 => *provider = "github".into(),
                1 => *host = "other.example".into(),
                2 => *repository = "org/project/other".into(),
                3 => *iteration = Some("3".into()),
                _ => *base_iteration = None,
            }
        }
    }
    for other in variants {
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
    if let PatchSource::Remote { host, .. } = &mut invalid.source {
        host.clear();
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
    let range =
        |max| store.revision_patch("range", "HEAD~1", Some("HEAD"), None, None, max, &options);

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

    let added = store.revision_patch("commit", &initial, None, None, None, None, &options).unwrap();
    assert_eq!(added.files[0].status, "added");
    let shown = store.revision_patch("show", "HEAD", None, None, Some(0), None, &options).unwrap();
    assert!(shown.content.raw.contains("@@ -2,0 +3 @@"));
    let error = store.revision_patch("range", "missing", Some("HEAD"), None, None, None, &options);
    assert!(error.unwrap_err().starts_with("git --literal-pathspecs diff"));
    assert!(store.revision_patch("range", "HEAD", None, None, None, None, &options).is_err());

    store.dispose(store.scope()).unwrap();
    let closed = store.revision_patch("commit", "HEAD", None, None, None, None, &options);
    assert_eq!(closed.unwrap_err(), "patch store: Closed");
    identity.execution = PatchExecution::Wsl { distro: "Ubuntu".into() };
    identity.root = "/home/user/repo".into();
    let wsl = PatchStore::open(identity, 8, 1 << 20).unwrap();
    let rejected = wsl.revision_patch("commit", "HEAD", None, None, None, None, &options);
    assert_eq!(rejected.unwrap_err(), "patch store: InvalidIdentity");
}
