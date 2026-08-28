//! Diffing two contents that are already in memory, with no repository involved.
//!
//! This is the last git child process the move had left to take, and it is the
//! odd one out in two ways.
//!
//! It is not a *read* of a repository, so `gix` is not the answer: what the
//! caller wants back is git's own unified-diff rendering — hunk headers,
//! context width, `\ No newline at end of file`, binary detection — and
//! reimplementing that would be a new implementation of a format rather than a
//! faster route to the same bytes. So it shells out, from Rust.
//!
//! And it is the one command whose ordinary answer is a non-zero exit:
//! `git diff --no-index` reports "the two files differ" as exit code 1, which
//! every other command in this module would render as a failure. That is what
//! [`super::GitCommandOptions::success_exit_codes`] exists for.
//!
//! The whole dance crosses the boundary once. The two contents are already in
//! Node's memory, and the TypeScript this replaces spent an `fs.mkdtemp`, two
//! `fs.writeFile`s, a `spawn` and an `fs.rm` — five round trips — to get them
//! in front of git. Here the temp directory is a RAII guard, so the cleanup the
//! TypeScript wrote as a `finally` happens on every path out including an early
//! `?`, and the header rewrite comes along rather than making a sixth trip.

use std::path::Path;
use std::process::Command;

use super::{run_command, GitCommandOptions, GitError, GitErrorKind};

/// The exit code `git diff` uses for "the inputs differ", which for
/// `--no-index` is the answer rather than a failure.
const DIFFERENCES_FOUND: i32 = 1;

/// The command, minus the two paths.
///
/// `--no-ext-diff` keeps a user's configured external diff driver out of the
/// way, `--no-prefix` drops the `a/`/`b/` git would otherwise invent for two
/// temp files, and `--` stops a path that begins with a dash being read as an
/// option.
const FLAGS: [&str; 5] = ["diff", "--no-ext-diff", "--no-index", "--no-prefix", "--"];

/// Render `git diff --no-index` of `before` against `after`, with the headers
/// relabelled.
///
/// The labels are the caller's own strings — `a/<path>`, `b/<path>` or
/// `/dev/null` — and are never built here, for the same reason no path in this
/// crate is: what a diff header should say about a file is a decision the
/// caller has already made.
///
/// One trailing line ending is lost, as it is for everything that crosses this
/// boundary. For a diff that is invisible, and here it is provably so: the one
/// caller pushes the result through `.trimEnd()` before it joins the parts.
///
/// The temp files are written under the system temp directory rather than
/// beside the originals — nothing here touches the repository, and the diff is
/// display metadata about content the caller is holding either way.
pub fn diff_no_index(
    before: &str,
    after: &str,
    before_label: &str,
    after_label: &str,
    options: &GitCommandOptions,
) -> Result<String, GitError> {
    // Dropped at every exit from this function, `?` included — the RAII form of
    // the `finally { fs.rm(...) }` the TypeScript needed.
    let dir = tempfile::Builder::new().prefix("codex-file-diff-").tempdir().map_err(setup_error)?;
    let before_path = dir.path().join("before");
    let after_path = dir.path().join("after");
    std::fs::write(&before_path, before).map_err(setup_error)?;
    std::fs::write(&after_path, after).map_err(setup_error)?;

    let mut command = Command::new("git");
    command.args(FLAGS).arg(&before_path).arg(&after_path);

    // The caller's timeout and buffer cap stand; which exit codes mean success
    // does not, because that belongs to the command.
    let mut options = options.clone();
    options.success_exit_codes = vec![DIFFERENCES_FOUND];

    let rendered = run_command(command, &display_args(&before_path, &after_path), &options)?;
    Ok(rewrite_no_index_headers(&rendered, before_label, after_label))
}

/// Point the first `diff --git`, `---` and `+++` lines at the labels the caller
/// chose, leaving every later line alone.
///
/// git names the temp files it was handed, which say nothing to a reader, so
/// the three header lines are rewritten to name the file the diff is actually
/// about. Only the *first* of each is touched: a `---` further down is content
/// removed from the file, not a header, and rewriting it would corrupt the
/// hunk.
///
/// Lines are split on `\r?\n` and rejoined with `\n`, which is what the
/// TypeScript did — so a `\r` that git printed as part of a CRLF file's content
/// is dropped from every line but the last. Ported rather than fixed: the
/// result is display metadata, and the alternative changes what the one caller
/// has always shown.
pub fn rewrite_no_index_headers(diff: &str, before_label: &str, after_label: &str) -> String {
    let mut rewrote_diff_header = false;
    let mut rewrote_before_header = false;
    let mut rewrote_after_header = false;

    let parts: Vec<&str> = diff.split('\n').collect();
    let last = parts.len().saturating_sub(1);
    let mut lines: Vec<String> = Vec::with_capacity(parts.len());

    for (index, part) in parts.into_iter().enumerate() {
        // Only a piece that had a `\n` after it can have ended a `\r\n`; the
        // final piece did not, so a lone trailing `\r` there is content.
        let line = if index == last { part } else { part.strip_suffix('\r').unwrap_or(part) };

        if !rewrote_diff_header && line.starts_with("diff --git ") {
            rewrote_diff_header = true;
            lines.push(format!("diff --git {before_label} {after_label}"));
        } else if !rewrote_before_header && line.starts_with("--- ") {
            rewrote_before_header = true;
            lines.push(format!("--- {before_label}"));
        } else if !rewrote_after_header && line.starts_with("+++ ") {
            rewrote_after_header = true;
            lines.push(format!("+++ {after_label}"));
        } else {
            lines.push(line.to_string());
        }
    }

    lines.join("\n")
}

/// The command as the error text should spell it.
///
/// Rendered lossily on purpose: git itself is handed the paths as `OsStr`, so a
/// temp directory whose bytes are not UTF-8 still names the right files and
/// only the message a human reads is approximate.
fn display_args(before_path: &Path, after_path: &Path) -> Vec<String> {
    let mut args: Vec<String> = FLAGS.iter().map(|flag| (*flag).to_string()).collect();
    args.push(before_path.to_string_lossy().into_owned());
    args.push(after_path.to_string_lossy().into_owned());
    args
}

/// A failure before git was reached, wearing the same words as one after.
///
/// The temp files could not be created, so the arguments have no paths to name
/// yet — the error says which command could not be set up, and carries the I/O
/// failure as its stderr.
fn setup_error(error: std::io::Error) -> GitError {
    let args: Vec<String> = FLAGS.iter().map(|flag| (*flag).to_string()).collect();
    GitError::from_parts(GitErrorKind::Spawn, &args, error.to_string())
}
