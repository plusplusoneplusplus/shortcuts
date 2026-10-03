//! Compiled as a private unit-test module so synchronization stays out of the
//! production API.

#[cfg(test)]
mod tests {
    use crate::repo_files::{write_blob, RepoIndexes};
    use std::sync::{mpsc, Arc};
    use std::thread;
    use std::time::Duration;

    #[test]
    fn write_invalidation_waits_for_the_old_scan_then_rewalks_both_variants() {
        for ignored in [false, true] {
            let dir = tempfile::tempdir().unwrap();
            write_blob(dir.path(), "first.ts", "first").unwrap();
            let indexes = RepoIndexes::new(dir.path().to_path_buf(), Duration::ZERO);
            let held = indexes.index(ignored).unwrap();
            let original = held.snapshot();
            let variant = &indexes.variants[usize::from(ignored)];
            let (scanned, scan_done) = mpsc::channel();
            let (release, resume) = mpsc::channel();
            *variant.after_refresh.lock() = Some(Box::new(move || {
                scanned.send(()).unwrap();
                resume.recv_timeout(Duration::from_secs(5)).unwrap();
            }));

            // TTL expiry returns the old index and starts a background scan.
            indexes.index(ignored).unwrap();
            scan_done.recv_timeout(Duration::from_secs(5)).unwrap();
            assert!(variant.refresh.try_lock().is_none(), "the scan still owns the writer");
            assert_eq!(held.snapshot().files(0, 10), ["first.ts"]);
            write_blob(dir.path(), "written.ts", "written").unwrap();
            let (started, attempting) = mpsc::channel();
            let (finished, completion) = mpsc::channel();
            let writer = Arc::clone(&indexes);
            let pending = thread::spawn(move || {
                started.send(()).unwrap();
                finished.send(writer.invalidate()).unwrap();
            });
            attempting.recv_timeout(Duration::from_secs(5)).unwrap();
            let early = completion.recv_timeout(Duration::from_millis(100));
            // Always release the paused worker before assertions, even if a
            // regression lets invalidation finish without waiting for it.
            release.send(()).unwrap();
            pending.join().unwrap();
            assert!(matches!(early, Err(mpsc::RecvTimeoutError::Timeout)));
            assert!(completion.recv_timeout(Duration::from_secs(5)).unwrap());
            assert_eq!(held.snapshot().files(0, 10), ["first.ts", "written.ts"]);
            assert_eq!(original.files(0, 10), ["first.ts"], "held snapshots stay immutable");
        }
    }
}
