use coc_native_core::git::{
    patch::parse_patch,
    remote_patch::{build_remote_patch, RemotePatchInput},
};

fn file(before: &str, after: &str) -> RemotePatchInput {
    RemotePatchInput {
        path: "/same.txt".into(),
        original_path: None,
        before: before.into(),
        after: after.into(),
        before_exists: true,
        after_exists: true,
        before_mode: None,
        after_mode: None,
        is_binary: None,
    }
}

#[test]
fn existence_is_not_inferred_from_content() {
    let edited = build_remote_patch(vec![file("", "text\n"), file("text\n", "")]).unwrap();
    assert!(!edited.contains("/dev/null"));
    assert!(parse_patch(&edited).iter().all(|f| f.status == "modified"));
    let mut added = file("", "");
    added.before_exists = false;
    let mut deleted = file("", "");
    deleted.after_exists = false;
    let entries = parse_patch(&build_remote_patch(vec![added, deleted]).unwrap());
    assert_eq!(entries.len(), 2);
    assert_eq!(entries[0].status, "added");
    assert_eq!(entries[1].status, "deleted");
    assert!(!entries[0].is_binary);
}

#[test]
fn quoted_rename_and_binary_metadata_survive_processing() {
    let mut renamed = file("same\n", "same\n");
    renamed.path = "/café\tnew.txt".into();
    renamed.original_path = Some("/old\nname.txt".into());
    renamed.after_mode = Some("100755".into());
    let binary = file("before\0", "after\0");
    let patch = build_remote_patch(vec![renamed, binary]).unwrap();
    let entries = parse_patch(&patch);
    assert_eq!(entries[0].path, "café\tnew.txt");
    assert_eq!(entries[0].original_path.as_deref(), Some("old\nname.txt"));
    assert_eq!(entries[0].status, "renamed");
    assert!(!entries[0].is_binary);
    assert!(patch.contains("old mode 100644\nnew mode 100755"));
    assert!(entries[1].is_binary);
    assert!(patch.contains("Binary files a/same.txt and b/same.txt differ"));
}

#[test]
fn git_rendering_keeps_crlf_and_no_newline_markers() {
    let patch = build_remote_patch(vec![file("old\r\nlast", "new\r\nlast")]).unwrap();
    assert!(patch.contains("-old\r\n+new\r\n"));
    assert!(patch.contains("\\ No newline at end of file"));
    let entry = &parse_patch(&patch)[0];
    assert_eq!((entry.additions, entry.deletions), (1, 1));
}
