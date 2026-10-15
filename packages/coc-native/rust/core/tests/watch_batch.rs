use std::time::{Duration, Instant};

use coc_native_core::watch::{PendingBatch, WatchBatch, MAX_BATCH_PATHS, MAX_BATCH_PATH_BYTES};

fn after(start: Instant, milliseconds: u64) -> Instant {
    start + Duration::from_millis(milliseconds)
}

#[test]
fn idle_subscriptions_do_not_emit_batches() {
    let now = Instant::now();
    let mut pending = PendingBatch::new(7, 300);
    assert_eq!(pending.deadline(), None);
    assert_eq!(pending.drain_ready(after(now, 1000)), None);
}

#[test]
fn merges_and_deduplicates_paths_until_the_trailing_edge() {
    let now = Instant::now();
    let mut pending = PendingBatch::new(7, 300);
    pending.record_path("src/z.md".into(), now);
    pending.record_path("src/a.md".into(), after(now, 100));
    pending.record_path("src/z.md".into(), after(now, 200));
    assert_eq!(pending.deadline(), Some(after(now, 500)));
    assert_eq!(pending.drain_ready(after(now, 499)), None);
    assert_eq!(
        pending.drain_ready(after(now, 500)),
        Some(WatchBatch {
            subscription_id: 7,
            paths: vec!["src/a.md".into(), "src/z.md".into()],
            rescan: false,
        }),
    );
    assert_eq!(pending.deadline(), None);
    assert_eq!(pending.drain_ready(after(now, 1000)), None);
}

#[test]
fn draining_starts_a_fresh_window() {
    let now = Instant::now();
    let mut pending = PendingBatch::new(7, 300);
    pending.record_path("a.md".into(), now);
    assert!(pending.drain_ready(after(now, 300)).is_some());
    pending.record_path("b.md".into(), after(now, 400));
    assert_eq!(pending.drain_ready(after(now, 699)), None);
    assert_eq!(pending.drain_ready(after(now, 700)).unwrap().paths, vec!["b.md"]);
}

#[test]
fn subscriptions_keep_independent_ids_and_debounce_windows() {
    let now = Instant::now();
    let mut notes = PendingBatch::new(1, 300);
    let mut wiki = PendingBatch::new(2, 2000);
    notes.record_path("a.md".into(), now);
    wiki.record_path("a.md".into(), now);
    let notes_batch = notes.drain_ready(after(now, 300)).unwrap();
    assert_eq!(notes_batch.subscription_id, 1);
    assert_eq!(wiki.drain_ready(after(now, 300)), None);
    let wiki_batch = wiki.drain_ready(after(now, 2000)).unwrap();
    assert_eq!(wiki_batch.subscription_id, 2);
    assert_eq!(notes_batch.paths, wiki_batch.paths);
}

#[test]
fn zero_debounce_is_ready_immediately() {
    let now = Instant::now();
    let mut pending = PendingBatch::new(1, 0);
    pending.record_path("a.md".into(), now);
    assert_eq!(pending.drain_ready(now).unwrap().paths, vec!["a.md"]);
}

#[test]
fn rescan_discards_partial_paths_and_absorbs_later_paths() {
    let now = Instant::now();
    let mut pending = PendingBatch::new(7, 300);
    pending.record_path("a.md".into(), now);
    pending.mark_rescan(after(now, 100));
    pending.record_path("b.md".into(), after(now, 200));
    assert_eq!(pending.drain_ready(after(now, 499)), None);
    assert_eq!(
        pending.drain_ready(after(now, 500)),
        Some(WatchBatch { subscription_id: 7, paths: vec![], rescan: true }),
    );
    pending.record_path("c.md".into(), after(now, 600));
    let batch = pending.drain_ready(after(now, 900)).unwrap();
    assert!(!batch.rescan);
    assert_eq!(batch.paths, vec!["c.md"]);
}

#[test]
fn rescan_without_paths_still_emits_a_batch() {
    let now = Instant::now();
    let mut pending = PendingBatch::new(7, 300);
    pending.mark_rescan(now);
    pending.mark_rescan(after(now, 100));
    assert_eq!(pending.drain_ready(after(now, 399)), None);
    let batch = pending.drain_ready(after(now, 400)).unwrap();
    assert!(batch.rescan);
    assert!(batch.paths.is_empty());
    assert_eq!(pending.drain_ready(after(now, 700)), None);
}

#[test]
fn exact_path_limit_and_duplicates_do_not_overflow() {
    let now = Instant::now();
    let mut pending = PendingBatch::new(7, 0);
    for index in 0..MAX_BATCH_PATHS {
        pending.record_path(format!("notes/{index}.md"), now);
    }
    for _ in 0..MAX_BATCH_PATHS {
        pending.record_path("notes/0.md".into(), now);
    }
    let batch = pending.drain_ready(now).unwrap();
    assert!(!batch.rescan);
    assert_eq!(batch.paths.len(), MAX_BATCH_PATHS);
}

#[test]
fn exceeding_the_path_limit_emits_rescan() {
    let now = Instant::now();
    let mut pending = PendingBatch::new(7, 0);
    for index in 0..=MAX_BATCH_PATHS {
        pending.record_path(format!("notes/{index}.md"), now);
    }
    let batch = pending.drain_ready(now).unwrap();
    assert!(batch.rescan);
    assert!(batch.paths.is_empty());
}

#[test]
fn byte_limit_counts_unique_utf8_bytes_and_resets_after_drain() {
    let now = Instant::now();
    let path = "\u{00e9}".repeat(MAX_BATCH_PATH_BYTES / 2);
    let mut pending = PendingBatch::new(7, 0);
    pending.record_path(path.clone(), now);
    pending.record_path(path.clone(), now);
    let batch = pending.drain_ready(now).unwrap();
    assert!(!batch.rescan);
    assert_eq!(batch.paths, vec![path.clone()]);
    pending.record_path(path, now);
    let batch = pending.drain_ready(now).unwrap();
    assert!(!batch.rescan);
}

#[test]
fn exceeding_the_byte_limit_emits_rescan_and_resets_the_budget() {
    let now = Instant::now();
    let mut pending = PendingBatch::new(7, 0);
    pending.record_path("a".repeat(MAX_BATCH_PATH_BYTES), now);
    pending.record_path("b.md".into(), now);
    let batch = pending.drain_ready(now).unwrap();
    assert!(batch.rescan);
    assert!(batch.paths.is_empty());
    pending.record_path("c.md".into(), now);
    let batch = pending.drain_ready(now).unwrap();
    assert!(!batch.rescan);
    assert_eq!(batch.paths, vec!["c.md"]);
}

#[test]
fn a_single_oversized_path_emits_rescan() {
    let now = Instant::now();
    let mut pending = PendingBatch::new(7, 0);
    pending.record_path("a".repeat(MAX_BATCH_PATH_BYTES + 1), now);
    let batch = pending.drain_ready(now).unwrap();
    assert!(batch.rescan);
    assert!(batch.paths.is_empty());
}
