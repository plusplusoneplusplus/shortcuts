//! Contract tests for `repo_files` path containment and blob I/O — the shapes
//! and error messages the `/api/repos/:id/blob` routes depend on.

use std::fs;
use std::path::Path;

use coc_native_core::repo_files::{
    mime_type, read_blob, resolve_in_root, write_blob, RepoFilesError, MAX_BLOB_SIZE,
};

fn repo() -> tempfile::TempDir {
    tempfile::tempdir().expect("tempdir")
}

#[test]
fn leading_separators_are_repo_relative() {
    let dir = repo();
    let root = dir.path();
    for spelling in ["/src/a.ts", "\\src/a.ts", "//src/a.ts", "src/./a.ts", "src/x/../a.ts"] {
        let resolved = resolve_in_root(root, spelling).expect(spelling);
        assert!(resolved.ends_with(Path::new("src").join("a.ts")), "{spelling}");
    }
    for spelling in ["", "/", ".", "\\"] {
        assert_eq!(resolve_in_root(root, spelling).unwrap(), root, "{spelling:?}");
    }
}

#[test]
fn lexical_traversal_is_rejected() {
    let dir = repo();
    for spelling in ["..", "../x", "src/../../x", "/../x"] {
        let err = resolve_in_root(dir.path(), spelling).unwrap_err();
        assert!(matches!(err, RepoFilesError::PathTraversal), "{spelling}");
        assert_eq!(err.to_string(), "Path traversal detected: path escapes repo root");
    }
    // A sibling whose name merely starts with the root's name is still outside.
    let name = dir.path().file_name().unwrap().to_string_lossy().into_owned();
    assert!(resolve_in_root(dir.path(), &format!("../{name}-evil/x")).is_err());
}

#[test]
fn reads_text_with_mime_and_lossy_utf8() {
    let dir = repo();
    fs::write(dir.path().join("a.TS"), b"const x = 1;\n\xff\n").unwrap();
    let blob = read_blob(dir.path(), "a.TS").unwrap();
    assert_eq!(blob.encoding, "utf-8");
    assert_eq!(blob.mime_type, "application/typescript");
    assert_eq!(blob.content, "const x = 1;\n\u{fffd}\n");
}

#[test]
fn nul_in_first_8k_is_binary_base64() {
    let dir = repo();
    fs::write(dir.path().join("img.png"), [0x89, b'P', 0, 1]).unwrap();
    let blob = read_blob(dir.path(), "img.png").unwrap();
    assert_eq!(blob.encoding, "base64");
    assert_eq!(blob.content, "iVAAAQ==");
    assert_eq!(blob.mime_type, "image/png");

    // A NUL past the probe window does not make the file binary.
    let mut late = vec![b'a'; 8192];
    late.push(0);
    fs::write(dir.path().join("late.bin"), &late).unwrap();
    assert_eq!(read_blob(dir.path(), "late.bin").unwrap().encoding, "utf-8");
}

#[test]
fn read_errors_keep_route_messages() {
    let dir = repo();
    fs::create_dir(dir.path().join("sub")).unwrap();
    fs::write(dir.path().join("big.txt"), vec![b'a'; MAX_BLOB_SIZE as usize + 1]).unwrap();
    fs::write(dir.path().join("cap.txt"), vec![b'a'; MAX_BLOB_SIZE as usize]).unwrap();

    assert_eq!(
        read_blob(dir.path(), "nope.txt").unwrap_err().to_string(),
        "File not found: nope.txt"
    );
    assert_eq!(read_blob(dir.path(), "sub").unwrap_err().to_string(), "Not a file: sub");
    assert_eq!(
        read_blob(dir.path(), "big.txt").unwrap_err().to_string(),
        "File exceeds maximum size of 1048576 bytes: big.txt"
    );
    assert!(read_blob(dir.path(), "cap.txt").is_ok());
    assert!(matches!(read_blob(dir.path(), "../x").unwrap_err(), RepoFilesError::PathTraversal));
}

#[test]
fn mime_follows_node_extname() {
    assert_eq!(mime_type(Path::new("x/.env")), "application/octet-stream");
    assert_eq!(mime_type(Path::new("prod.env")), "text/plain");
    assert_eq!(mime_type(Path::new("README.MD")), "text/markdown");
    assert_eq!(mime_type(Path::new("Makefile")), "application/octet-stream");
    assert_eq!(mime_type(Path::new("file.")), "application/octet-stream");
}

#[test]
fn write_creates_parents_and_overwrites() {
    let dir = repo();
    write_blob(dir.path(), "/deep/new/a.txt", "héllo").unwrap();
    assert_eq!(fs::read_to_string(dir.path().join("deep/new/a.txt")).unwrap(), "héllo");
    write_blob(dir.path(), "deep/new/a.txt", "").unwrap();
    assert_eq!(fs::read(dir.path().join("deep/new/a.txt")).unwrap(), b"");
    assert!(matches!(
        write_blob(dir.path(), "../escape.txt", "x").unwrap_err(),
        RepoFilesError::PathTraversal
    ));
    assert!(matches!(write_blob(dir.path(), "deep", "x").unwrap_err(), RepoFilesError::Io(_)));
}

#[cfg(unix)]
#[test]
fn symlinks_inside_the_root_are_followed() {
    let dir = repo();
    fs::write(dir.path().join("target.md"), "# hi").unwrap();
    std::os::unix::fs::symlink("target.md", dir.path().join("link.md")).unwrap();
    assert_eq!(read_blob(dir.path(), "link.md").unwrap().content, "# hi");
}
