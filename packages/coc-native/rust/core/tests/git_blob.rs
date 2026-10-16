use coc_native_core::git::{blob::read_blob, GitErrorKind};
use std::path::Path;
use std::process::Command;

fn git(root: &Path, args: &[&str]) -> String {
    let out = Command::new("git").arg("-C").arg(root).args(args).output().unwrap();
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    String::from_utf8(out.stdout).unwrap().trim().to_owned()
}

#[test]
fn index_only_blob_preserves_every_byte_and_obeys_inclusive_cap() {
    let repo = tempfile::tempdir().unwrap();
    git(repo.path(), &["init"]);
    let bytes = b" \t\0\xffhello\r\n\n";
    std::fs::write(repo.path().join("raw"), bytes).unwrap();
    git(repo.path(), &["-c", "core.autocrlf=false", "add", "raw"]);
    let sha = git(repo.path(), &["rev-parse", ":raw"]);
    assert_eq!(read_blob(repo.path(), &sha, bytes.len(), 10_000).unwrap(), bytes);
    assert_eq!(
        read_blob(repo.path(), &sha, bytes.len() - 1, 10_000).unwrap_err().kind,
        GitErrorKind::BlobTooLarge
    );
    assert_eq!(
        read_blob(repo.path(), &sha, 0, 10_000).unwrap_err().kind,
        GitErrorKind::BlobTooLarge
    );
}

#[test]
fn large_blob_stops_at_cap_and_empty_blob_fits_zero() {
    let repo = tempfile::tempdir().unwrap();
    git(repo.path(), &["init"]);
    for (name, bytes) in [("large", vec![b'x'; 2 * 1024 * 1024]), ("empty", vec![])] {
        std::fs::write(repo.path().join(name), bytes).unwrap();
        let sha = git(repo.path(), &["hash-object", "-w", name]);
        let result = read_blob(repo.path(), &sha, 0, 10_000);
        if name == "empty" {
            assert_eq!(result.unwrap(), Vec::<u8>::new());
        } else {
            assert_eq!(result.unwrap_err().kind, GitErrorKind::BlobTooLarge);
        }
    }
}

#[test]
fn missing_sha_remains_a_git_failure_even_with_zero_cap() {
    let repo = tempfile::tempdir().unwrap();
    git(repo.path(), &["init"]);
    let error = read_blob(repo.path(), &"0".repeat(40), 0, 10_000).unwrap_err();
    assert!(matches!(error.kind, GitErrorKind::Exit(_)), "{error:?}");
    assert!(error.to_string().contains("cat-file blob"));
}
