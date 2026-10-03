//! Git's eligible working-tree paths for tracked content search. Host commands
//! run through the shared Git runner; WSL supplies only the prepared ls-files
//! output, so selection and parsing stay here without invoking host Git.

use std::collections::HashSet;
use std::io;
use std::path::{Path, MAIN_SEPARATOR};

use super::RepoFilesError;
use crate::content_search::ContentSearchOptions;
use crate::git::{run_git, GitCommandOptions};

/// The command and resource limits the workspace execution adapter needs.
#[derive(Debug)]
#[cfg_attr(feature = "napi", napi_derive::napi(object, object_from_js = false))]
pub struct ContentCandidateCommand {
    pub args: Vec<String>,
    pub timeout_ms: u32,
    pub max_buffer: u32,
}

pub fn prepare_content_candidates(include_untracked: bool) -> ContentCandidateCommand {
    let mut args = vec!["ls-files", "-z", "--cached"];
    if include_untracked {
        args.extend(["--others", "--exclude-standard"]);
    }
    ContentCandidateCommand {
        args: args.into_iter().map(str::to_owned).collect(),
        timeout_ms: 15_000,
        max_buffer: 64 * 1024 * 1024,
    }
}

fn paths(stdout: &str) -> Vec<String> {
    stdout
        .split('\0')
        .filter(|file| !file.is_empty())
        .map(|file| file.replace(MAIN_SEPARATOR, "/"))
        .collect()
}

/// `wsl_output` is the result of executing `prepare_content_candidates` through
/// the workspace adapter. `Some("")` means no eligible files, not host fallback.
/// Candidates are never cached: Git reads the current index and working tree.
pub fn tracked_content_candidates(
    root: &Path,
    query: &str,
    options: &ContentSearchOptions,
    include_untracked: bool,
    wsl_output: Option<&str>,
) -> Result<Vec<String>, RepoFilesError> {
    if let Some(stdout) = wsl_output {
        return Ok(paths(stdout));
    }
    let command = prepare_content_candidates(include_untracked);
    let limits = GitCommandOptions {
        timeout_ms: command.timeout_ms.into(),
        max_buffer_bytes: command.max_buffer as usize,
        ..Default::default()
    };
    let stdout = run_git(root, &command.args, &limits)
        .map_err(|error| RepoFilesError::TrackedUnavailable(error.to_string()))?;
    if query.is_empty() || query.contains(['\0', '\n', '\r']) || include_untracked || options.regex
    {
        return Ok(paths(&stdout));
    }
    let mut args = vec!["grep", "-l", "-z", "-F"];
    if !options.case_sensitive {
        args.push("-i");
    }
    args.extend(["--", query]);
    // Exit 1 means no matching files, rather than an unavailable search.
    let grep_limits = GitCommandOptions { success_exit_codes: vec![1], ..limits.clone() };
    let stdout =
        run_git(root, &args.into_iter().map(str::to_owned).collect::<Vec<_>>(), &grep_limits)
            .map_err(io::Error::other)?;
    let mut files = paths(&stdout);
    let stage = run_git(
        root,
        &["ls-files".into(), "--stage".into(), "-z".into(), "--cached".into()],
        &limits,
    )
    .map_err(io::Error::other)?;
    // Git grep skips symlink targets; the native matcher must still see them.
    let mut seen: HashSet<String> = files.iter().cloned().collect();
    for entry in stage.split('\0').filter(|entry| entry.starts_with("120000 ")) {
        if let Some((_, path)) = entry.split_once('\t') {
            let path = path.replace(MAIN_SEPARATOR, "/");
            if seen.insert(path.clone()) {
                files.push(path);
            }
        }
    }
    Ok(files)
}
