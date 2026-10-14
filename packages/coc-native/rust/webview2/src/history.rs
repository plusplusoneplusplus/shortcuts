/// Per-controller navigation bookkeeping, independent of state snapshots and placement.
#[derive(Default)]
pub struct HistoryNavigation {
    pending: Option<u64>,
    document_ready: bool,
    loading: bool,
}

impl HistoryNavigation {
    /// Reserve readiness before WebView2 asynchronously emits NavigationStarting.
    pub fn requested(&mut self) {
        self.pending = None;
        self.loading = true;
    }

    pub fn loading(&self) -> bool {
        self.loading
    }

    pub fn started(&mut self, id: u64) {
        self.loading = true;
        self.pending = Some(id);
        self.document_ready = false;
    }

    /// None means a superseded, stopped or already-consumed navigation.
    pub fn completed(&mut self, id: u64, success: bool) -> Option<bool> {
        if self.pending != Some(id) {
            return None;
        }
        self.pending = None;
        self.loading = false;
        self.document_ready = success;
        Some(success)
    }

    pub fn source_changed(&mut self, new_document: bool) -> bool {
        if new_document {
            self.document_ready = false;
            return false;
        }
        // Fragment and same-document history navigation have no NavigationStarting.
        if self.document_ready && self.pending.is_none() {
            self.loading = false;
        }
        self.document_ready
    }

    pub fn title_changed(&self) -> bool {
        self.document_ready && !self.loading
    }

    pub fn stop(&mut self) {
        if self.loading {
            self.invalidate();
        }
    }

    pub fn invalidate(&mut self) {
        self.loading = false;
        self.pending = None;
        self.document_ready = false;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn requested_document_stays_loading_before_start_and_through_redirects() {
        let mut history = HistoryNavigation::default();
        history.requested(); // Initial open acknowledged before NavigationStarting.
        assert!(history.loading());
        assert!(!history.title_changed());
        assert!(!history.source_changed(false)); // Initial blank document.
        assert!(history.loading());
        assert_eq!(history.completed(0, true), None);
        assert!(history.loading());
        history.started(1);
        history.started(1); // Redirect.
        assert!(!history.source_changed(true));
        assert!(history.loading());
        assert_eq!(history.completed(1, true), Some(true));
        assert!(!history.loading());
        assert!(history.title_changed());
    }

    #[test]
    fn request_revokes_old_completions_before_the_next_start_event() {
        let mut history = HistoryNavigation::default();
        history.started(1);
        history.requested(); // Navigate/reload/back/forward accepted asynchronously.
        for success in [true, false] {
            assert_eq!(history.completed(1, success), None);
            assert!(history.loading());
        }
        history.started(2);
        assert_eq!(history.completed(2, false), Some(false));
        assert!(!history.loading());
        assert!(!history.title_changed());
    }

    #[test]
    fn stop_and_dispatch_failure_retire_requests_without_start_events() {
        let mut history = HistoryNavigation::default();
        history.requested();
        history.stop();
        assert!(!history.loading());
        assert!(!history.title_changed());
        history.requested();
        history.invalidate(); // Synchronous dispatch failure or crash.
        assert!(!history.loading());
        assert_eq!(history.completed(1, true), None);
    }

    #[test]
    fn same_document_navigation_settles_on_source_change_without_a_start_event() {
        let mut history = HistoryNavigation::default();
        history.started(1);
        history.completed(1, true);
        history.requested();
        assert!(history.loading());
        assert!(!history.title_changed());
        assert!(history.source_changed(false));
        assert!(!history.loading());
        assert!(history.title_changed());
        history.requested();
        assert!(!history.source_changed(true)); // A different document cannot settle it.
        assert!(history.loading());
    }

    #[test]
    fn successful_documents_reload_and_back_forward_count_once_per_navigation() {
        let mut history = HistoryNavigation::default();
        for id in 1..=4 {
            history.started(id);
            assert!(!history.source_changed(true));
            assert!(!history.title_changed());
            assert_eq!(history.completed(id, true), Some(true));
            assert_eq!(history.completed(id, true), None);
            assert!(history.title_changed());
        }
    }

    #[test]
    fn redirects_reuse_navigation_id_and_fold_initial_same_document_changes() {
        let mut history = HistoryNavigation::default();
        history.started(1);
        history.started(1); // Redirect.
        assert!(!history.source_changed(true));
        assert!(!history.source_changed(false)); // pushState before load finishes.
        assert_eq!(history.completed(1, true), Some(true));
        assert!(history.source_changed(false)); // Committed pushState/fragment/back.
        assert!(history.title_changed());
        assert_eq!(history.completed(1, true), None);
    }

    #[test]
    fn failed_cancelled_and_stopped_documents_cannot_supply_visits_or_titles() {
        let mut history = HistoryNavigation::default();
        history.started(1);
        assert_eq!(history.completed(1, false), Some(false));
        assert!(!history.source_changed(false));
        assert!(!history.title_changed());
        history.started(2);
        history.stop();
        assert_eq!(history.completed(2, true), None);
        assert!(!history.title_changed());
        history.started(3);
        assert_eq!(history.completed(3, true), Some(true));
        history.stop(); // Stop on an already-loaded page leaves its document usable.
        assert!(history.source_changed(false));
    }

    #[test]
    fn overlapping_navigation_rejects_old_failures_and_successes() {
        let mut history = HistoryNavigation::default();
        history.started(1);
        history.started(2);
        assert_eq!(history.completed(1, false), None);
        assert_eq!(history.completed(1, true), None);
        assert!(!history.source_changed(false));
        assert_eq!(history.completed(2, true), Some(true));
        assert_eq!(history.completed(1, false), None);
        assert!(history.title_changed());
    }

    #[test]
    fn crash_invalidates_pending_and_loaded_documents_until_a_new_success() {
        let mut history = HistoryNavigation::default();
        history.started(1);
        history.completed(1, true);
        history.invalidate();
        assert!(!history.source_changed(false));
        assert!(!history.title_changed());
        history.started(2);
        history.invalidate();
        assert_eq!(history.completed(2, true), None);
        history.started(3);
        assert_eq!(history.completed(3, true), Some(true));
    }

    #[test]
    fn popup_documents_have_independent_navigation_lifecycles() {
        let mut tab = HistoryNavigation::default();
        let mut popup = HistoryNavigation::default();
        tab.started(1);
        tab.completed(1, true);
        popup.started(1);
        assert!(tab.title_changed());
        assert!(!popup.title_changed());
        popup.completed(1, true);
        popup.invalidate();
        assert!(tab.source_changed(false));
        assert!(!popup.source_changed(false));
    }
}
