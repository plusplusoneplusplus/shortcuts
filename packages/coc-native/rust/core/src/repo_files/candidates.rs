//! Git's eligible working-tree paths for tracked content search. Host commands
//! run through the shared Git runner; WSL supplies only the prepared ls-files
//! output, so selection and parsing stay here without invoking host Git.

use std::collections::HashSet;
use std::io;
use std::path::{Path, MAIN_SEPARATOR};

use super::RepoFilesError;
use crate::content_search::ContentSearchOptions;
use crate::git::{run_git, GitCommandOptions, GitError, GitErrorKind};

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
    if query.is_empty() || query.contains(['\0', '\n', '\r']) || include_untracked || options.regex
    {
        let stdout = run_git(root, &command.args, &limits)
            .map_err(|error| RepoFilesError::TrackedUnavailable(candidate_error(error, &limits)))?;
        return Ok(paths(&stdout));
    }
    // One staged enumeration validates the repository and supplies symlinks.
    // The plain ls-files output is unused when grep selects the regular files.
    let stage_args = ["ls-files".into(), "--stage".into(), "-z".into(), "--cached".into()];
    let mut args = vec!["grep", "-l", "-z", "-F"];
    if !options.case_sensitive {
        args.push("-i");
    }
    args.extend(["--", query]);
    // Exit 1 means no matching files, rather than an unavailable search.
    let mut grep_limits =
        GitCommandOptions { timeout_ms: 60_000, success_exit_codes: vec![1], ..limits.clone() };
    let mut args = args.into_iter().map(str::to_owned).collect::<Vec<_>>();
    let exclusions = directory_exclusion_pathspecs(options);
    if !exclusions.is_empty() {
        for variable in [
            "GIT_LITERAL_PATHSPECS",
            "GIT_GLOB_PATHSPECS",
            "GIT_NOGLOB_PATHSPECS",
            "GIT_ICASE_PATHSPECS",
        ] {
            grep_limits.env.push((variable.into(), "0".into()));
        }
        args.extend(exclusions);
    }
    // Only the small index enumeration overlaps grep; there is still one
    // content-reading Git process per search and no shared query state.
    let (stage, stdout) = std::thread::scope(|scope| {
        let grep = scope.spawn(|| run_git(root, &args, &grep_limits));
        let stage = run_git(root, &stage_args, &limits);
        (stage, grep.join().expect("Git candidate worker panicked"))
    });
    let stage = stage
        .map_err(|error| RepoFilesError::TrackedUnavailable(candidate_error(error, &limits)))?;
    let stdout = stdout.map_err(|error| io::Error::other(candidate_error(error, &grep_limits)))?;
    let mut files = paths(&stdout);
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

fn directory_exclusion_pathspecs(options: &ContentSearchOptions) -> Vec<String> {
    // Git pathspecs and native override globs differ. Only translate literal
    // root-relative directory/** rules; keep mixed/negated rules and scoped
    // queries entirely with the native matcher so rule ordering stays intact.
    if options.path.as_deref().is_some_and(|path| !path.is_empty()) {
        return Vec::new();
    }
    let mut pathspecs = Vec::new();
    for glob in &options.exclude {
        let Some(directory) = glob.strip_prefix('/').unwrap_or(glob).strip_suffix("/**") else {
            return Vec::new();
        };
        if !directory.split('/').all(|part| {
            !part.is_empty()
                && part != "."
                && part != ".."
                && part.bytes().all(|byte| byte.is_ascii_alphanumeric() || b"._-".contains(&byte))
        }) {
            return Vec::new();
        }
        pathspecs.push(format!(":(top,glob,exclude){directory}/**"));
    }
    pathspecs
}

fn candidate_error(error: GitError, limits: &GitCommandOptions) -> String {
    let detail = match error.kind {
        GitErrorKind::Timeout => format!("timed out after {} ms", limits.timeout_ms),
        GitErrorKind::MaxBuffer | GitErrorKind::BlobTooLarge => {
            format!("output exceeded {} bytes", limits.max_buffer_bytes)
        }
        GitErrorKind::Spawn => "could not start or wait for Git".to_owned(),
        GitErrorKind::Exit(Some(code)) => format!("exit code {code}"),
        GitErrorKind::Exit(None) => "terminated without an exit code".to_owned(),
        GitErrorKind::Cancelled => "cancelled".to_owned(),
        GitErrorKind::Repository => "could not read repository".to_owned(),
    };
    if error.stderr.is_empty() {
        format!("{error}{detail}")
    } else {
        format!("{error} ({detail})")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_equivalent_literal_directory_exclusions_are_pushed_to_git() {
        let mut options = ContentSearchOptions {
            exclude: vec!["src/data/**".into(), "/build-output/**".into()],
            ..Default::default()
        };
        assert_eq!(
            directory_exclusion_pathspecs(&options),
            [":(top,glob,exclude)src/data/**", ":(top,glob,exclude)build-output/**"]
        );
        for glob in [
            "**/data/**",
            "*.txt",
            "!src/data/keep.txt",
            "src/*/**",
            "src/[ab]/**",
            "src/{a,b}/**",
            "./src/data/**",
            "../data/**",
            "src//data/**",
            "src\\data/**",
            "src/data/**/",
            "src/space name/**",
            "src/data",
        ] {
            options.exclude = vec!["src/data/**".into(), glob.into()];
            assert!(directory_exclusion_pathspecs(&options).is_empty(), "{glob}");
        }
        options.exclude = vec!["src/data/**".into()];
        options.path = Some("src".into());
        assert!(directory_exclusion_pathspecs(&options).is_empty());
    }

    #[test]
    fn blank_git_failures_report_the_failure_kind_and_resource_limit() {
        let limits =
            GitCommandOptions { timeout_ms: 60_000, max_buffer_bytes: 1024, ..Default::default() };
        for (kind, detail) in [
            (GitErrorKind::Timeout, "timed out after 60000 ms"),
            (GitErrorKind::MaxBuffer, "output exceeded 1024 bytes"),
            (GitErrorKind::Spawn, "could not start or wait for Git"),
            (GitErrorKind::Exit(Some(2)), "exit code 2"),
            (GitErrorKind::Exit(None), "terminated without an exit code"),
            (GitErrorKind::Cancelled, "cancelled"),
            (GitErrorKind::Repository, "could not read repository"),
        ] {
            let error = GitError::from_parts(kind, &["grep".into()], "");
            assert_eq!(candidate_error(error, &limits), format!("git grep failed: {detail}"));
        }
        let error = GitError::from_parts(
            GitErrorKind::Exit(Some(2)),
            &["grep".into()],
            "fatal: bad pattern",
        );
        assert_eq!(
            candidate_error(error, &limits),
            "git grep failed: fatal: bad pattern (exit code 2)"
        );
    }
}
