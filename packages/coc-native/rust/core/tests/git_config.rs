//! Reading and appending to git's global configuration from Rust.
//!
//! The caller is the `safe.directory` check Git for Windows forces on any
//! repository reached over the WSL UNC share. Two things make it worth its own
//! suite. First, the values are hostile to a shell — the real entries look like
//! `%(prefix)///wsl$/Ubuntu/home/me/repo`, so a `$` and a `%(…)` sigil have to
//! survive the crossing verbatim. Second, membership is decided by exact string
//! equality, so any reshaping of a value on the way back turns "already
//! approved" into "approve it again" and appends a duplicate on every start.
//!
//! Every test points `GIT_CONFIG_GLOBAL` at a temp file through the per-command
//! environment overrides rather than the process's own environment, so the
//! suite never reads or writes the developer's real `~/.gitconfig` and stays
//! safe to run in parallel.

use std::path::Path;
use std::process::Command;

use coc_native_core::git::config::{global_config_add, global_config_get_all};
use coc_native_core::git::{GitCommandOptions, GitErrorKind};
use tempfile::TempDir;

const KEY: &str = "safe.directory";

/// A real `safe.directory` entry, sigils and all.
const WSL_ENTRY: &str = "%(prefix)///wsl$/Ubuntu-24.04/home/me/repo";

/// Options pointing git at `<dir>/gitconfig` as the global config file.
fn global_config_in(dir: &TempDir) -> GitCommandOptions {
    GitCommandOptions {
        env: vec![(
            "GIT_CONFIG_GLOBAL".to_string(),
            dir.path().join("gitconfig").to_string_lossy().into_owned(),
        )],
        ..Default::default()
    }
}

fn write_global_config(dir: &TempDir, contents: &str) {
    std::fs::write(dir.path().join("gitconfig"), contents).expect("temp config should be writable");
}

fn read_global_config(dir: &TempDir) -> String {
    std::fs::read_to_string(dir.path().join("gitconfig")).unwrap_or_default()
}

fn init_repo(dir: &Path) {
    let status = Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(["init", "--quiet"])
        .status()
        .expect("git should be on PATH for these tests");
    assert!(status.success(), "git init failed");
}

#[test]
fn get_all_errors_when_the_global_config_does_not_exist() {
    let dir = TempDir::new().unwrap();

    let error = global_config_get_all(KEY, &global_config_in(&dir)).unwrap_err();

    // git exits 1 for an unset key, and a missing file is an unset key. The
    // caller reads this as "not configured" and appends.
    assert_eq!(error.kind, GitErrorKind::Exit(Some(1)));
}

#[test]
fn get_all_errors_when_the_key_is_unset() {
    let dir = TempDir::new().unwrap();
    write_global_config(&dir, "[user]\n\tname = Someone\n");

    let error = global_config_get_all(KEY, &global_config_in(&dir)).unwrap_err();

    assert_eq!(error.kind, GitErrorKind::Exit(Some(1)));
}

#[test]
fn a_failure_is_rendered_as_the_command_the_caller_asked_for() {
    let dir = TempDir::new().unwrap();

    let error = global_config_get_all(KEY, &global_config_in(&dir)).unwrap_err();

    // No `-C <path>` in the text: there is no repository in this call, and the
    // words are what routes and the UI show.
    assert_eq!(error.to_string(), "git config --global --get-all safe.directory failed: ");
}

#[test]
fn an_added_value_reads_back_verbatim() {
    let dir = TempDir::new().unwrap();
    let options = global_config_in(&dir);

    global_config_add(KEY, WSL_ENTRY, &options).unwrap();

    // `$` and `%(prefix)` are untouched — no shell ever sees the value.
    assert_eq!(global_config_get_all(KEY, &options).unwrap(), vec![WSL_ENTRY.to_string()]);
}

#[test]
fn add_creates_the_global_config_file_when_it_is_missing() {
    let dir = TempDir::new().unwrap();
    let options = global_config_in(&dir);

    global_config_add(KEY, WSL_ENTRY, &options).unwrap();

    assert!(read_global_config(&dir).contains("directory ="));
}

#[test]
fn add_extends_the_list_instead_of_replacing_it() {
    let dir = TempDir::new().unwrap();
    let options = global_config_in(&dir);

    global_config_add(KEY, "/first/repo", &options).unwrap();
    global_config_add(KEY, "/second/repo", &options).unwrap();

    // Every repository the user has already approved has to survive the next
    // one being approved, which is why this is `--add` and not a set.
    assert_eq!(
        global_config_get_all(KEY, &options).unwrap(),
        vec!["/first/repo".to_string(), "/second/repo".to_string()],
    );
}

#[test]
fn add_does_not_deduplicate() {
    let dir = TempDir::new().unwrap();
    let options = global_config_in(&dir);

    global_config_add(KEY, WSL_ENTRY, &options).unwrap();
    global_config_add(KEY, WSL_ENTRY, &options).unwrap();

    // git appends unconditionally. This is exactly why the caller reads the
    // list first rather than adding on every start.
    assert_eq!(global_config_get_all(KEY, &options).unwrap().len(), 2);
}

#[test]
fn a_value_holding_spaces_survives_the_round_trip() {
    let dir = TempDir::new().unwrap();
    let options = global_config_in(&dir);
    let padded = "%(prefix)///wsl$/Ubuntu/home/me/my repo";

    global_config_add(KEY, padded, &options).unwrap();

    assert_eq!(global_config_get_all(KEY, &options).unwrap(), vec![padded.to_string()]);
}

#[test]
fn values_are_trimmed_and_blank_lines_dropped() {
    let dir = TempDir::new().unwrap();
    // A quoted value keeps its padding through git; membership is decided by
    // exact equality, so an untrimmed answer would never match and the caller
    // would append a duplicate every time.
    write_global_config(&dir, "[safe]\n\tdirectory = \"  /padded/repo  \"\n");

    assert_eq!(
        global_config_get_all(KEY, &global_config_in(&dir)).unwrap(),
        vec!["/padded/repo".to_string()],
    );
}

#[test]
fn multiple_values_come_back_in_git_order() {
    let dir = TempDir::new().unwrap();
    write_global_config(&dir, "[safe]\n\tdirectory = /a\n\tdirectory = /b\n\tdirectory = /c\n");

    assert_eq!(
        global_config_get_all(KEY, &global_config_in(&dir)).unwrap(),
        vec!["/a".to_string(), "/b".to_string(), "/c".to_string()],
    );
}

#[test]
fn the_write_lands_in_the_global_file_even_when_run_from_inside_a_repository() {
    let repo = TempDir::new().unwrap();
    init_repo(repo.path());
    let dir = TempDir::new().unwrap();
    let mut options = global_config_in(&dir);
    options.cwd = Some(repo.path().to_path_buf());

    global_config_add(KEY, WSL_ENTRY, &options).unwrap();

    assert!(read_global_config(&dir).contains(WSL_ENTRY));
    let local = Command::new("git")
        .arg("-C")
        .arg(repo.path())
        .args(["config", "--local", "--get-all", KEY])
        .output()
        .expect("git should be on PATH for these tests");
    // No `-C` and no `--local`: the repository the process happens to sit in
    // must not collect the entry, because it is Git for Windows' *global* list
    // that decides whether the repo can be opened at all.
    assert!(!local.status.success(), "the entry leaked into the repository config");
}

#[test]
fn a_read_of_another_key_is_unaffected_by_the_safe_directory_list() {
    let dir = TempDir::new().unwrap();
    let options = global_config_in(&dir);
    global_config_add(KEY, WSL_ENTRY, &options).unwrap();

    let error = global_config_get_all("core.editor", &options).unwrap_err();

    assert_eq!(error.kind, GitErrorKind::Exit(Some(1)));
}
