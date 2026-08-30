//! Reading and writing git's *global* configuration.
//!
//! Only one caller needs this today: Git for Windows refuses to open a
//! repository reached over the WSL UNC share unless the path is listed in the
//! global `safe.directory`, so forge checks the list and appends to it before
//! the first command against such a repo. Both of those were `execFile` calls
//! that bypassed the git runner entirely — the sync one blocking Node's event
//! loop while git started, parsed a config file and exited.
//!
//! Deciding *what* the entry should say stays in TypeScript: it is built out of
//! WSL UNC path parsing, which is the one thing this crate is deliberately kept
//! ignorant of. What moves here is the two child processes.
//!
//! These go through `run_git_global` rather than `run_git`, because `--global`
//! reads and writes the user's own config file and has no repository to be
//! pointed at with `-C`.

use super::{run_git_global, GitCommandOptions, GitError};

/// Every value configured for `key` in the global config file, in git's order.
///
/// A multi-valued key is the normal case here — `safe.directory` accumulates
/// one line per repository — so this is `--get-all`, and the answer is a list
/// even when it holds one entry.
///
/// Errors rather than answering "no values" when the key is unset, because that
/// is what git does: `--get-all` exits 1 for an unset key and for a global
/// config file that does not exist yet, and the two are indistinguishable from
/// the outside. The caller reads either as "not configured".
pub fn global_config_get_all(
    key: &str,
    options: &GitCommandOptions,
) -> Result<Vec<String>, GitError> {
    let args = ["config", "--global", "--get-all", key].map(String::from);
    Ok(parse_config_values(&run_git_global(&args, options)?))
}

/// Append `value` to `key` in the global config file.
///
/// `--add` rather than the plain set, so an existing list is extended instead
/// of collapsed to a single entry — replacing it would drop every other
/// repository the user has already approved.
///
/// No shell is involved, so a value holding spaces or a `%(prefix)` sigil
/// crosses to git exactly as spelled.
pub fn global_config_add(
    key: &str,
    value: &str,
    options: &GitCommandOptions,
) -> Result<(), GitError> {
    let args = ["config", "--global", "--add", key, value].map(String::from);
    run_git_global(&args, options).map(|_| ())
}

/// Split `git config --get-all` output into one value per line.
///
/// Blank lines are dropped and each value is trimmed, matching the TypeScript
/// this replaces. That trimming is not cosmetic: the caller decides whether an
/// entry is already present by exact string equality, so a stray `\r` from a
/// Windows-written config file would answer "not configured" forever and append
/// a duplicate on every start.
fn parse_config_values(text: &str) -> Vec<String> {
    text.lines().map(str::trim).filter(|line| !line.is_empty()).map(str::to_string).collect()
}
