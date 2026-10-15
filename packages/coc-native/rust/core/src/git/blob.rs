//! Bounded, byte-exact reads of object IDs, including uncommitted index blobs.

use super::{run_command_bytes, GitCommandOptions, GitError};
use std::path::Path;
use std::process::Command;

pub fn read_blob(
    repo_root: &Path,
    sha: &str,
    max_bytes: usize,
    timeout_ms: u64,
) -> Result<Vec<u8>, GitError> {
    let args = vec!["cat-file".into(), "blob".into(), sha.into()];
    let mut command = Command::new("git");
    command.arg("-C").arg(repo_root).args(&args);
    let options = GitCommandOptions {
        max_buffer_bytes: max_bytes,
        timeout_ms,
        ..GitCommandOptions::default()
    };
    run_command_bytes(command, &args, &options, true)
}
