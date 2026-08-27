//! Reading remotes through `gix` instead of spawning `git remote get-url`.
//!
//! The risk this suite exists to cover is not the branching — that is a dozen
//! lines — it is *round-trip fidelity*. `gix` parses a remote URL into a
//! structured value and this module renders it back to a string, while the
//! TypeScript it replaces handed back whatever bytes `git remote get-url`
//! printed. Callers hash that string and persist the hash, so a URL that comes
//! back even slightly reshaped silently splits one repository into two.
//!
//! So every URL form is asserted twice: against the literal that was
//! configured, and differentially against what the real `git remote get-url`
//! prints for the same repository.

use std::path::Path;
use std::process::Command;

use coc_native_core::git::remote::{detect_remote_url, remote_names, remote_url};
use tempfile::TempDir;

fn git(repo: &Path, values: &[&str]) {
    let status = Command::new("git")
        .arg("-C")
        .arg(repo)
        .args(values)
        .status()
        .expect("git should be on PATH for these tests");
    assert!(status.success(), "git {values:?} failed");
}

/// Run git and hand back its trimmed stdout, or `None` when it exits non-zero.
///
/// The `None` is the point: `git remote get-url` is how the TypeScript decided
/// a remote was missing, so the differential assertions need the failure as a
/// value rather than a panic.
fn git_stdout_opt(repo: &Path, values: &[&str]) -> Option<String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(repo)
        .args(values)
        .output()
        .expect("git should be on PATH for these tests");
    if !output.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&output.stdout).trim_end_matches(['\n', '\r']).to_string())
}

/// A repository with no remotes and one commit.
fn repo() -> TempDir {
    let dir = TempDir::new().expect("temp dir");
    git(dir.path(), &["init", "--initial-branch=main"]);
    git(dir.path(), &["config", "user.email", "ralph@example.com"]);
    git(dir.path(), &["config", "user.name", "Ralph"]);
    git(dir.path(), &["config", "commit.gpgsign", "false"]);
    std::fs::write(dir.path().join("a.txt"), "one\n").expect("file should be writable");
    git(dir.path(), &["add", "-A"]);
    git(dir.path(), &["commit", "-m", "first"]);
    dir
}

/// A repository whose `origin` points at `url`.
fn repo_with_origin(url: &str) -> TempDir {
    let dir = repo();
    git(dir.path(), &["remote", "add", "origin", url]);
    dir
}

/// Every URL form a caller can end up persisting a hash of.
///
/// The scp-like SSH shorthand, the explicit `ssh://`, embedded credentials and
/// a bare local path are each a different branch of `gix`'s URL parser, and
/// each renders back through a different path.
const URL_FORMS: &[&str] = &[
    "https://github.com/owner/repo.git",
    "https://github.com/owner/repo",
    "https://user:token@github.com/owner/repo.git",
    "http://internal.example.com/owner/repo.git",
    "git@github.com:owner/repo.git",
    "git@github.com:owner/repo",
    "ssh://git@github.com/owner/repo.git",
    "ssh://git@ssh.dev.azure.com/v3/org/project/repo",
    "git://github.com/owner/repo.git",
    "https://dev.azure.com/org/My%20Project/_git/Repo",
    "https://Org.visualstudio.com/Project/_git/Repo",
    "/srv/git/repo.git",
    "file:///srv/git/repo.git",
];

#[test]
fn reads_the_origin_url_back_exactly_as_configured() {
    for url in URL_FORMS {
        let dir = repo_with_origin(url);
        assert_eq!(
            remote_url(dir.path(), "origin").expect("repository opens"),
            Some((*url).to_string()),
            "round trip changed {url}",
        );
    }
}

#[test]
fn matches_git_remote_get_url_for_every_url_form() {
    for url in URL_FORMS {
        let dir = repo_with_origin(url);
        let expected = git_stdout_opt(dir.path(), &["remote", "get-url", "origin"]);
        assert_eq!(
            remote_url(dir.path(), "origin").expect("repository opens"),
            expected,
            "gix and git disagree about {url}",
        );
    }
}

#[test]
fn expands_an_insteadof_rewrite_the_way_get_url_does() {
    let dir = repo_with_origin("git@github.com:owner/repo.git");
    git(dir.path(), &["config", "url.https://github.com/.insteadOf", "git@github.com:"]);

    let expected = git_stdout_opt(dir.path(), &["remote", "get-url", "origin"]);
    assert_eq!(expected.as_deref(), Some("https://github.com/owner/repo.git"));
    assert_eq!(remote_url(dir.path(), "origin").expect("repository opens"), expected);
}

#[test]
fn reports_a_missing_remote_as_none_rather_than_an_error() {
    let dir = repo();
    assert_eq!(remote_url(dir.path(), "origin").expect("repository opens"), None);
    assert_eq!(git_stdout_opt(dir.path(), &["remote", "get-url", "origin"]), None);
}

#[test]
fn reports_a_remote_that_is_not_the_one_asked_for_as_none() {
    let dir = repo_with_origin("https://github.com/owner/repo.git");
    assert_eq!(remote_url(dir.path(), "upstream").expect("repository opens"), None);
}

#[test]
fn reads_a_non_origin_remote_by_name() {
    let dir = repo_with_origin("https://github.com/owner/repo.git");
    git(dir.path(), &["remote", "add", "upstream", "https://github.com/other/repo.git"]);

    assert_eq!(
        remote_url(dir.path(), "upstream").expect("repository opens"),
        Some("https://github.com/other/repo.git".to_string()),
    );
}

#[test]
fn fails_when_the_path_is_not_a_repository() {
    let dir = TempDir::new().expect("temp dir");
    let error = remote_url(dir.path(), "origin").expect_err("a bare directory is not a repository");
    assert!(
        error.to_string().starts_with("git remote get-url origin failed: "),
        "unexpected error text: {error}",
    );
}

#[test]
fn discovers_the_repository_from_a_subdirectory() {
    let dir = repo_with_origin("https://github.com/owner/repo.git");
    let nested = dir.path().join("src").join("deep");
    std::fs::create_dir_all(&nested).expect("nested directory should be creatable");

    assert_eq!(
        remote_url(&nested, "origin").expect("discovery finds the containing repository"),
        Some("https://github.com/owner/repo.git".to_string()),
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// git remote
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn lists_no_remote_names_for_a_repository_without_remotes() {
    let dir = repo();
    assert_eq!(remote_names(dir.path()).expect("repository opens"), Vec::<String>::new());
}

#[test]
fn lists_remote_names_in_the_order_git_prints_them() {
    let dir = repo();
    for name in ["zeta", "origin", "alpha"] {
        git(dir.path(), &["remote", "add", name, &format!("https://example.com/{name}.git")]);
    }

    let expected: Vec<String> = git_stdout_opt(dir.path(), &["remote"])
        .expect("git remote succeeds")
        .lines()
        .map(str::to_string)
        .collect();
    assert_eq!(expected, vec!["alpha", "origin", "zeta"]);
    assert_eq!(remote_names(dir.path()).expect("repository opens"), expected);
}

// ─────────────────────────────────────────────────────────────────────────────
// the primary-remote lookup
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn prefers_origin_when_it_is_configured() {
    let dir = repo_with_origin("https://github.com/owner/repo.git");
    git(dir.path(), &["remote", "add", "alpha", "https://example.com/alpha.git"]);

    assert_eq!(
        detect_remote_url(dir.path()).expect("repository opens"),
        Some("https://github.com/owner/repo.git".to_string()),
    );
}

#[test]
fn falls_back_to_the_first_remote_by_name_when_origin_is_absent() {
    let dir = repo();
    git(dir.path(), &["remote", "add", "zeta", "https://example.com/zeta.git"]);
    git(dir.path(), &["remote", "add", "alpha", "https://example.com/alpha.git"]);

    assert_eq!(
        detect_remote_url(dir.path()).expect("repository opens"),
        Some("https://example.com/alpha.git".to_string()),
    );
}

#[test]
fn reports_no_url_for_a_repository_without_remotes() {
    let dir = repo();
    assert_eq!(detect_remote_url(dir.path()).expect("repository opens"), None);
}

#[test]
fn fails_the_primary_lookup_when_the_path_is_not_a_repository() {
    let dir = TempDir::new().expect("temp dir");
    let error = detect_remote_url(dir.path()).expect_err("a bare directory is not a repository");
    assert!(
        error.to_string().starts_with("git remote get-url origin failed: "),
        "unexpected error text: {error}",
    );
}

#[test]
fn keeps_the_scp_like_ssh_shorthand_intact_through_the_primary_lookup() {
    let dir = repo_with_origin("git@github.com:owner/repo.git");
    assert_eq!(
        detect_remote_url(dir.path()).expect("repository opens"),
        Some("git@github.com:owner/repo.git".to_string()),
    );
}

#[test]
fn keeps_the_configured_host_casing_that_gix_would_normalise_away() {
    // `gix` lowercases a host when it renders a parsed URL back to bytes. The
    // sidebar groups clones by a key built from this string with its casing
    // intact, so the raw value is what has to come back.
    let dir = repo_with_origin("https://Org.visualstudio.com/Project/_git/Repo");
    assert_eq!(
        remote_url(dir.path(), "origin").expect("repository opens"),
        Some("https://Org.visualstudio.com/Project/_git/Repo".to_string()),
    );
}

#[test]
fn renders_the_resolved_url_when_a_remote_carries_more_than_one() {
    // git's fetch URL is the first of several; the config snapshot resolves to
    // the last. They disagree, so the raw value is not safe to hand back and
    // the resolved one is rendered instead — which is what `get-url` prints.
    let dir = repo_with_origin("https://github.com/owner/first.git");
    git(
        dir.path(),
        &["remote", "set-url", "--add", "origin", "https://github.com/owner/second.git"],
    );

    let expected = git_stdout_opt(dir.path(), &["remote", "get-url", "origin"]);
    assert_eq!(expected.as_deref(), Some("https://github.com/owner/first.git"));
    assert_eq!(remote_url(dir.path(), "origin").expect("repository opens"), expected);
}
