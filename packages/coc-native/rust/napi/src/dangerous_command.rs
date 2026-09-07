//! N-API binding for the dangerous-command guard.
//!
//! Synchronous, unlike every other capability here: matching is a handful of
//! anchored regexes over a command line, so an `AsyncTask` would cost more in
//! marshalling than the work itself. Nothing here touches the filesystem.

use coc_native_core::dangerous_command::match_command;
use napi_derive::napi;

/// The verdict on one shell command.
#[napi(object)]
pub struct DangerousCommandVerdict {
    /// True when a built-in rule matched. The other fields are present only
    /// then.
    pub matched: bool,
    /// Stable rule identifier — what an approve-for-session decision remembers.
    pub rule_id: Option<String>,
    /// Human-readable reason, shown in the approval prompt.
    pub description: Option<String>,
    /// The `;`/`&&`/`||`/`|`/newline-separated segment that matched, or the
    /// whole command for a rule defined by the pipe itself.
    pub matched_segment: Option<String>,
}

/// Screen one shell command against the built-in disallow list.
///
/// A disallow list only: an unmatched command is reported as `matched: false`
/// and is not thereby asserted to be safe. Quoting is not parsed — see the
/// core module for what that costs and why it is the trade taken.
#[napi]
pub fn match_dangerous_command(command: String) -> DangerousCommandVerdict {
    match match_command(&command) {
        Some(hit) => DangerousCommandVerdict {
            matched: true,
            rule_id: Some(hit.rule_id),
            description: Some(hit.description),
            matched_segment: Some(hit.matched_segment),
        },
        None => DangerousCommandVerdict {
            matched: false,
            rule_id: None,
            description: None,
            matched_segment: None,
        },
    }
}
