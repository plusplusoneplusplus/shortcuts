use std::time::{Duration, Instant};

pub const MAX_PENDING: usize = 8;
pub const MAX_ACTIVE: usize = 20;
pub const PENDING_TTL: Duration = Duration::from_secs(60);
pub const MAX_URI_BYTES: usize = 16_384;

pub fn allowed_uri(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= MAX_URI_BYTES
        && !value.chars().any(char::is_control)
        && url::Url::parse(value).is_ok_and(|url| {
            matches!(url.scheme(), "http" | "https") && url.host_str().is_some()
                || url.scheme() == "blob" && !url.path().is_empty()
        })
}

pub fn bounded_uri(value: &str) -> String {
    let mut end = value.len().min(MAX_URI_BYTES);
    while !value.is_char_boundary(end) {
        end -= 1;
    }
    value[..end].to_string()
}

pub fn proposed_filename(value: &str) -> String {
    value.rsplit(['\\', '/']).next().unwrap_or_default().chars().take(255).collect()
}

/// The desktop main process supplies the native dialog's path, never a page or renderer.
pub fn allowed_destination(value: &str) -> bool {
    if value.is_empty()
        || value.len() > 32_000
        || value
            .chars()
            .any(|c| c.is_control() || matches!(c, '/' | '<' | '>' | '"' | '|' | '?' | '*'))
        || value.starts_with(r"\\.\")
        || value.starts_with(r"\\?\")
    {
        return false;
    }
    let bytes = value.as_bytes();
    let tail = if bytes.len() >= 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && bytes[2] == b'\\'
    {
        &value[3..]
    } else if let Some(unc) = value.strip_prefix(r"\\") {
        let mut parts = unc.splitn(3, '\\');
        let (Some(server), Some(share), Some(tail)) = (parts.next(), parts.next(), parts.next())
        else {
            return false;
        };
        if !valid_component(server) || !valid_component(share) {
            return false;
        }
        tail
    } else {
        return false;
    };
    !tail.is_empty() && tail.split('\\').all(valid_component)
}

fn valid_component(value: &str) -> bool {
    if value.is_empty()
        || value == "."
        || value == ".."
        || value.ends_with(['.', ' '])
        || value.contains(':')
    {
        return false;
    }
    let stem = value.split('.').next().unwrap_or_default().trim_end().to_ascii_uppercase();
    !matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL" | "CONIN$" | "CONOUT$")
        && !(stem.len() == 4
            && (stem.starts_with("COM") || stem.starts_with("LPT"))
            && matches!(stem.as_bytes()[3], b'1'..=b'9'))
        && !["COM¹", "COM²", "COM³", "LPT¹", "LPT²", "LPT³"].contains(&stem.as_str())
}

pub fn has_capacity(pending: usize, active: usize) -> bool {
    pending < MAX_PENDING && active < MAX_ACTIVE
}

pub struct Lifecycle {
    pub owner: String,
    pub deadline: Option<Instant>,
    pub explicitly_paused: bool,
    pub resuming: bool,
}

impl Lifecycle {
    pub fn new(owner: &str, now: Instant) -> Self {
        Self {
            owner: owner.to_string(),
            deadline: Some(now + PENDING_TTL),
            explicitly_paused: false,
            resuming: false,
        }
    }

    pub fn pending(&self) -> bool {
        self.deadline.is_some()
    }

    pub fn expired(&self, now: Instant) -> bool {
        self.deadline.is_some_and(|deadline| now >= deadline)
    }

    pub fn may_decide(&self, owner: &str, live: bool, now: Instant) -> bool {
        self.owner == owner && live && self.pending() && !self.expired(now)
    }

    pub fn may_action(&self, owner: &str, action: &str, state: Progress) -> bool {
        self.owner == owner
            && !self.pending()
            && match action {
                "pause" => state.can_pause,
                "resume" => self.explicitly_paused && !self.resuming && state.can_resume,
                _ => false,
            }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Progress {
    pub state: &'static str,
    pub received: i64,
    pub total: i64,
    pub can_pause: bool,
    pub can_resume: bool,
    pub final_state: bool,
}

#[derive(Clone, Copy)]
pub enum NativeState {
    InProgress,
    Completed,
    Interrupted { user_cancelled: bool, user_paused: bool },
    Failed,
}

impl Progress {
    pub fn sample(
        native: NativeState,
        received: i64,
        total: i64,
        paused: bool,
        can_resume: bool,
    ) -> Self {
        let state = match native {
            NativeState::InProgress => "downloading",
            NativeState::Completed => "completed",
            NativeState::Interrupted { user_cancelled: true, .. } => "cancelled",
            NativeState::Interrupted { user_paused: true, .. } if paused => "paused",
            NativeState::Interrupted { .. } => "interrupted",
            NativeState::Failed => "failed",
        };
        Self {
            state,
            received: received.max(0),
            total: total.max(0),
            can_pause: state == "downloading" && !paused,
            can_resume: state == "paused" && can_resume,
            final_state: !matches!(state, "downloading" | "paused"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn browser_native_uri_policy_does_not_expand_navigation() {
        for uri in [
            "https://example.test/file",
            "http://example.test/file",
            "blob:https://example.test/id",
            "blob:null/id",
        ] {
            assert!(allowed_uri(uri));
        }
        for uri in [
            "file:///C:/file",
            "data:text/plain,x",
            "javascript:x",
            "ftp://example.test/file",
            "about:blank",
            "blob:",
            "https://example.test/\0",
        ] {
            assert!(!allowed_uri(uri));
        }
        assert!(!crate::protocol::allowed_url("blob:https://example.test/id", true));
        assert!(!allowed_uri(&format!("https://example.test/{}", "x".repeat(MAX_URI_BYTES))));
        assert!(bounded_uri(&"🦀".repeat(MAX_URI_BYTES)).len() <= MAX_URI_BYTES);
    }

    #[test]
    fn dialog_destinations_are_strict_windows_absolute_paths() {
        for path in [r"C:\Downloads\file.zip", r"z:\file", r"\\server\share\dir\file.zip"] {
            assert!(allowed_destination(path), "{path}");
        }
        for path in [
            r"C:file",
            r"\file",
            "file",
            r"C:\",
            r"\\server\share",
            r"\\?\C:\file",
            r"\\.\C:\file",
            r"\??\C:\file",
            r"C:\..\file",
            r"C:\a\.\file",
            r"C:\a\\file",
            r"C:\file:stream",
            r"C:\NUL.txt",
            r"C:\con",
            r"C:\COM1.log",
            r"C:\file.",
            r"C:\file ",
            "C:\\a\0file",
            "C:/a/file",
            r"\\?\UNC\server\share\file",
        ] {
            assert!(!allowed_destination(path), "{path}");
        }
    }

    #[test]
    fn wire_filename_is_only_a_bounded_basename() {
        assert_eq!(proposed_filename(r"C:\private\download.zip"), "download.zip");
        assert_eq!(proposed_filename("/private/file.txt"), "file.txt");
        assert_eq!(proposed_filename(&"🦀".repeat(300)).chars().count(), 255);
    }

    #[test]
    fn approval_is_live_owner_bound_single_use_and_expires_at_deadline() {
        let now = Instant::now();
        let mut lifecycle = Lifecycle::new("popup", now);
        assert!(!lifecycle.may_decide("root", true, now));
        assert!(!lifecycle.may_decide("popup", false, now));
        assert!(lifecycle.may_decide("popup", true, now + PENDING_TTL - Duration::from_millis(1)));
        assert!(!lifecycle.may_decide("popup", true, now + PENDING_TTL));
        lifecycle.deadline = None;
        assert!(!lifecycle.may_decide("popup", true, now));
    }

    #[test]
    fn admission_counts_pending_in_the_active_limit() {
        assert!(has_capacity(MAX_PENDING - 1, MAX_ACTIVE - 1));
        assert!(!has_capacity(MAX_PENDING, MAX_PENDING));
        assert!(!has_capacity(0, MAX_ACTIVE));
    }

    #[test]
    fn only_native_completion_is_complete_and_interruptions_do_not_resume() {
        let now = Instant::now();
        let mut lifecycle = Lifecycle::new("tab", now);
        let active = Progress::sample(NativeState::InProgress, 4, 10, false, true);
        assert_eq!(active.state, "downloading");
        assert!(!active.final_state);
        assert!(!lifecycle.may_action("tab", "pause", active));
        lifecycle.deadline = None;
        assert!(lifecycle.may_action("tab", "pause", active));
        assert!(!lifecycle.may_action("other", "pause", active));
        lifecycle.explicitly_paused = true;
        let paused = Progress::sample(
            NativeState::Interrupted { user_cancelled: false, user_paused: true },
            4,
            10,
            true,
            true,
        );
        assert!(lifecycle.may_action("tab", "resume", paused));
        assert!(!lifecycle.may_action("other", "resume", paused));
        let interrupted = Progress::sample(
            NativeState::Interrupted { user_cancelled: false, user_paused: false },
            4,
            10,
            true,
            true,
        );
        assert_eq!(interrupted.state, "interrupted");
        assert!(interrupted.final_state);
        assert!(!lifecycle.may_action("tab", "resume", interrupted));
        let cancelled = Progress::sample(
            NativeState::Interrupted { user_cancelled: true, user_paused: false },
            4,
            10,
            false,
            true,
        );
        assert_eq!(cancelled.state, "cancelled");
        let completed = Progress::sample(NativeState::Completed, 10, 10, false, false);
        assert_eq!(completed.state, "completed");
        assert!(completed.final_state);
        assert!(!lifecycle.may_action("tab", "pause", completed));
        assert!(!lifecycle.may_action("tab", "resume", completed));
        assert_eq!(Progress::sample(NativeState::Failed, -1, -1, false, false).total, 0);
    }

    #[test]
    fn pause_and_resume_require_approved_owner_and_native_capability() {
        let mut lifecycle = Lifecycle::new("tab", Instant::now());
        let active = Progress::sample(NativeState::InProgress, 4, 10, false, true);
        let paused = Progress::sample(
            NativeState::Interrupted { user_cancelled: false, user_paused: true },
            4,
            10,
            true,
            true,
        );
        lifecycle.explicitly_paused = true;
        assert!(!lifecycle.may_action("tab", "pause", active));
        assert!(!lifecycle.may_action("tab", "resume", paused));
        lifecycle.deadline = None;
        assert!(lifecycle.may_action("tab", "resume", paused));
        assert!(!lifecycle.may_action("other", "resume", paused));
        assert!(!lifecycle.may_action("tab", "pause", paused));
        assert!(!lifecycle.may_action("tab", "resume", active));
        assert!(!lifecycle.may_action("tab", "retry", active));
        lifecycle.resuming = true;
        assert!(!lifecycle.may_action("tab", "resume", paused));
        lifecycle.resuming = false;
        lifecycle.explicitly_paused = false;
        assert!(!lifecycle.may_action("tab", "resume", paused));
        assert!(lifecycle.may_action("tab", "pause", active));
        assert!(!lifecycle.may_action("other", "pause", active));
    }

    #[test]
    fn managed_commands_parse_without_exposing_paths_in_progress() {
        for op in ["download-decide", "download-action"] {
            let command: crate::protocol::Command = serde_json::from_value(serde_json::json!({
                "id": 1, "op": op, "viewId": "popup", "downloadId": "opaque",
                "action": "cancel"
            }))
            .unwrap();
            assert_eq!(command.download_id.as_deref(), Some("opaque"));
        }
        let command: crate::protocol::Command = serde_json::from_value(serde_json::json!({
            "id": 2, "op": "download-decide", "viewId": "tab", "downloadId": "opaque",
            "action": "approve", "destination": r"C:\Downloads\file.zip"
        }))
        .unwrap();
        assert!(allowed_destination(command.destination.as_deref().unwrap()));
    }
}
