use super::*;
use std::{sync::mpsc, thread, time::Duration};

#[test]
fn host_admission_preserves_options_and_binds_only_the_current_request_flags() {
    let root = tempfile::tempdir().unwrap();
    let scope = PatchScope {
        workspace_id: "fixture".into(),
        root: root.path().into(),
        execution: PatchExecution::Host,
        source: PatchSource::Local { kind: "revision".into() },
    };
    let store = PatchStore::open(scope.clone(), 1, 4096).unwrap();
    let other = PatchStore::open(scope.clone(), 1, 4096).unwrap();
    let options = GitCommandOptions {
        timeout_ms: 0,
        max_buffer_bytes: 17,
        cwd: Some(root.path().into()),
        env: vec![("PATCH_FIXTURE".into(), "value".into())],
        success_exit_codes: vec![1],
        cancellation: vec![Arc::new(AtomicBool::new(true))],
    };
    let ticket = store.begin_transport(&scope).unwrap();
    let bound = store.host_options(&ticket, &options).unwrap();
    assert_eq!(bound.timeout_ms, options.timeout_ms);
    assert_eq!(bound.max_buffer_bytes, options.max_buffer_bytes);
    assert_eq!(bound.cwd, options.cwd);
    assert_eq!(bound.env, options.env);
    assert_eq!(bound.success_exit_codes, options.success_exit_codes);
    assert_eq!(bound.cancellation.len(), 2);
    assert!(Arc::ptr_eq(&bound.cancellation[0], &ticket.cancellation));
    assert!(Arc::ptr_eq(&bound.cancellation[1], &ticket.request_cancellation.0));
    assert!(bound.cancellation.iter().all(|flag| !flag.load(Ordering::Acquire)));
    assert!(matches!(other.host_options(&ticket, &options), Err(PatchStoreError::ScopeMismatch)));
    ticket.request_cancellation.cancel();
    assert!(matches!(store.host_options(&ticket, &options), Err(PatchStoreError::Cancelled)));
    assert!(!ticket.cancellation.load(Ordering::Acquire));
    let fresh = store.begin_transport(&scope).unwrap();
    store.refresh(&scope).unwrap();
    assert!(matches!(store.host_options(&fresh, &options), Err(PatchStoreError::Stale)));
    assert!(bound.cancellation[0].load(Ordering::Acquire));
}

#[test]
fn snapshot_finalization_preserves_errors_and_rejects_revocation_during_computation() {
    let root = tempfile::tempdir().unwrap();
    let scope = PatchScope {
        workspace_id: "fixture".into(),
        root: root.path().into(),
        execution: PatchExecution::Host,
        source: PatchSource::Local { kind: "revision".into() },
    };
    for version in [
        PatchVersion::Fingerprint("supplied".into()),
        PatchVersion::Revisions { base: "a".repeat(40), head: "b".repeat(40) },
    ] {
        for action in ["cancel", "refresh", "dispose", "error", "success"] {
            let store = PatchStore::open(scope.clone(), 1, 4096).unwrap();
            let ticket = store.begin_transport(&scope).unwrap();
            let cancellation = ticket.request_cancellation.clone();
            let key = PatchKey { version: version.clone(), variant: "fixture".into() };
            let result = store.read_snapshot(&scope, ticket, key.clone(), Some(1), || {
                match action {
                    "cancel" => cancellation.cancel(),
                    "refresh" => store.refresh(&scope).unwrap(),
                    "dispose" => store.dispose(&scope).unwrap(),
                    "error" => return Err("git fixture: diagnostic".into()),
                    _ => {}
                }
                Ok(process_patch("one\ntwo".into(), None))
            });
            match action {
                "cancel" => assert_eq!(result, Err(PatchStoreError::Cancelled)),
                "refresh" => assert_eq!(result, Err(PatchStoreError::Stale)),
                "dispose" => assert_eq!(result, Err(PatchStoreError::Closed)),
                "error" => {
                    let error = result.unwrap_err();
                    assert_eq!(error, PatchStoreError::Compute("git fixture: diagnostic".into()));
                    assert_eq!(error.to_string(), "git fixture: diagnostic");
                }
                _ => {
                    let limited = result.unwrap();
                    assert!(limited.content.truncated);
                    assert_eq!(limited.content.raw, "one");
                    let complete = store
                        .read_snapshot(
                            &scope,
                            store.begin_transport(&scope).unwrap(),
                            key,
                            None,
                            || panic!("display truncation must retain the complete snapshot"),
                        )
                        .unwrap();
                    assert_eq!(complete.content.raw, "one\ntwo");
                    assert!(!complete.content.truncated);
                }
            }
            assert_eq!(store.state.lock().active, 0);
            if action != "success" {
                assert!(store.state.lock().cache.is_empty());
            }
        }
    }
}

#[test]
fn cancelled_owner_releases_capacity_without_retention_or_poisoning_waiters() {
    let root = tempfile::tempdir().unwrap();
    let scope = PatchScope {
        workspace_id: "fixture".into(),
        root: root.path().into(),
        execution: PatchExecution::Host,
        source: PatchSource::Local { kind: "revision".into() },
    };
    let store = Arc::new(PatchStore::open(scope.clone(), 1, 4096).unwrap());
    let ticket = store.begin_transport(&scope).unwrap();
    let cancellation = ticket.request_cancellation.clone();
    let key = PatchKey {
        version: PatchVersion::Fingerprint("fixture".into()),
        variant: "supplied".into(),
    };
    let (started_tx, started_rx) = mpsc::channel();
    let (release_tx, release_rx) = mpsc::channel();
    let (worker_store, worker_scope, worker_key) = (store.clone(), scope.clone(), key.clone());
    let owner = thread::spawn(move || {
        worker_store.compute(
            &worker_scope,
            worker_key,
            Some(ticket.generation),
            Some(&ticket.request_cancellation),
            || {
                started_tx.send(()).unwrap();
                release_rx.recv_timeout(Duration::from_secs(5)).unwrap();
                Ok(process_patch("fixture".into(), None))
            },
        )
    });
    started_rx.recv_timeout(Duration::from_secs(5)).unwrap();
    let flight = store.state.lock().pending[&key].clone();
    cancellation.cancel();
    assert_eq!(flight.wait(Some(&cancellation)), Err(PatchStoreError::Cancelled));
    let wait_ticket = store.begin_transport(&scope).unwrap();
    let waiting = wait_ticket.request_cancellation.clone();
    let (wait_tx, wait_rx) = mpsc::channel();
    let (waiter_store, waiter_scope, waiter_key) = (store.clone(), scope.clone(), key.clone());
    let waiter = thread::spawn(move || {
        wait_tx
            .send(waiter_store.compute(
                &waiter_scope,
                waiter_key,
                Some(wait_ticket.generation),
                Some(&wait_ticket.request_cancellation),
                || panic!("waiter must share the executing owner"),
            ))
            .unwrap();
    });
    let deadline = std::time::Instant::now() + Duration::from_secs(2);
    while Arc::strong_count(&flight) < 4 {
        assert!(std::time::Instant::now() < deadline, "waiter did not join the flight");
        thread::sleep(Duration::from_millis(1));
    }

    waiting.cancel();
    // Cancelling a waiter must finish even while the owner is blocked.
    assert_eq!(
        wait_rx.recv_timeout(Duration::from_secs(2)).unwrap(),
        Err(PatchStoreError::Cancelled)
    );
    waiter.join().unwrap();
    let independent = thread::spawn(move || flight.wait(Some(&PatchCancellation::default())));
    assert_eq!(
        store.get_or_compute(
            &scope,
            PatchKey { variant: "other".into(), ..key.clone() },
            || panic!("cancel cannot release executing capacity"),
        ),
        Err(PatchStoreError::Capacity)
    );
    release_tx.send(()).unwrap();
    assert_eq!(owner.join().unwrap(), Err(PatchStoreError::Cancelled));
    assert_eq!(independent.join().unwrap().unwrap().content.raw, "fixture");
    assert_eq!(
        store.get_or_compute(&scope, key.clone(), || Err("not retained".into())),
        Err(PatchStoreError::Compute("not retained".into()))
    );
    store.get_or_compute(&scope, key, || Ok(process_patch("retry".into(), None))).unwrap();
}

#[test]
fn live_waiter_retries_a_cancelled_host_owner_without_poisoning_the_shared_key() {
    let root = tempfile::tempdir().unwrap();
    let scope = PatchScope {
        workspace_id: "fixture".into(),
        root: root.path().into(),
        execution: PatchExecution::Host,
        source: PatchSource::Local { kind: "revision".into() },
    };
    let store = Arc::new(PatchStore::open(scope.clone(), 1, 4096).unwrap());
    let key =
        PatchKey { version: PatchVersion::Fingerprint("host".into()), variant: "show".into() };
    let ticket = store.begin_transport(&scope).unwrap();
    let cancellation = ticket.request_cancellation.clone();
    let (started_tx, started_rx) = mpsc::channel();
    let (release_tx, release_rx) = mpsc::channel();
    let (owner_store, owner_scope, owner_key) = (store.clone(), scope.clone(), key.clone());
    let owner = thread::spawn(move || {
        owner_store.compute(
            &owner_scope,
            owner_key,
            Some(ticket.generation),
            Some(&ticket.request_cancellation),
            || {
                started_tx.send(()).unwrap();
                release_rx.recv_timeout(Duration::from_secs(5)).unwrap();
                Err("cancelled Git child".into())
            },
        )
    });
    started_rx.recv_timeout(Duration::from_secs(5)).unwrap();
    let flight = store.state.lock().pending[&key].clone();
    let waiter_ticket = store.begin_transport(&scope).unwrap();
    let (waiter_store, waiter_scope, waiter_key) = (store.clone(), scope.clone(), key.clone());
    let waiter = thread::spawn(move || {
        waiter_store.compute(
            &waiter_scope,
            waiter_key,
            Some(waiter_ticket.generation),
            Some(&waiter_ticket.request_cancellation),
            || Ok(process_patch("independent".into(), None)),
        )
    });
    let deadline = std::time::Instant::now() + Duration::from_secs(2);
    while Arc::strong_count(&flight) < 4 {
        assert!(std::time::Instant::now() < deadline, "waiter did not join");
        thread::sleep(Duration::from_millis(1));
    }
    cancellation.cancel();
    release_tx.send(()).unwrap();
    assert_eq!(owner.join().unwrap(), Err(PatchStoreError::Cancelled));
    assert_eq!(waiter.join().unwrap().unwrap().content.raw, "independent");
    assert_eq!(
        store
            .get_or_compute(&scope, key, || panic!("retry snapshot must be retained"))
            .unwrap()
            .content
            .raw,
        "independent",
    );
}
