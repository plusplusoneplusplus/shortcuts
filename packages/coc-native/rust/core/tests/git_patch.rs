use std::path::Path;
use std::process::Command;

use coc_native_core::git::patch::parse_patch;

fn git(root: &Path, args: &[&str]) -> String {
    let output = Command::new("git").arg("-C").arg(root).args(args).output().expect("git on PATH");
    assert!(output.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&output.stderr));
    String::from_utf8(output.stdout).expect("UTF-8 output")
}

#[test]
fn preserves_raw_chunks_order_and_js_line_accounting() {
    let first = "diff --git a/z b/z\n--- a/z\n+++ b/z\n@@ -1 +1 @@\n-old\r\n+new\r\n";
    let second = "diff --git a/a b/a\nnew file mode 100644\n";
    let files = parse_patch(&format!("commit metadata\n\n{first}{second}"));
    assert_eq!(files.len(), 2);
    assert_eq!(files[0].path, "z");
    assert_eq!(files[0].raw, first);
    assert_eq!(files[0].total_lines, first.split('\n').count() as i64);
    assert_eq!((files[0].additions, files[0].deletions), (1, 1));
    assert_eq!(files[1].path, "a");
    assert_eq!(files[1].raw, second);
    assert!(!files[1].is_binary);
    assert!(parse_patch("").is_empty());
    assert!(parse_patch("  \ncommit metadata\n").is_empty());
}

#[test]
fn counts_header_like_hunk_content_and_does_not_infer_status_from_it() {
    let files = parse_patch("diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1,2 +1,2 @@\n--- /dev/null\n+++ /dev/null\n-old\n+new\n\\ No newline at end of file");
    assert_eq!(files[0].status, "modified");
    assert_eq!((files[0].additions, files[0].deletions), (2, 2));
    assert!(!files[0].is_binary);
}

#[test]
fn decodes_git_quoting_and_utf8_octal_bytes() {
    let patch = r#"diff --git "a/caf\303\251\t\"\\.txt" "b/caf\303\251\t\"\\.txt"
new file mode 100644
--- /dev/null
+++ "b/caf\303\251\t\"\\.txt"
@@ -0,0 +1 @@
+hello
"#;
    let files = parse_patch(patch);
    assert_eq!(files[0].path, "café\t\"\\.txt");
    assert_eq!(files[0].status, "added");
    assert_eq!(files[0].additions, 1);
    let high_bytes = parse_patch(
        r#"diff --git "a/\360\237\230\200" "b/\360\237\230\200"
old mode 100644
new mode 100755
"#,
    );
    assert_eq!(high_bytes[0].path, "😀");
    for bad in ["\"a/unfinished", "\"a/\\999\" \"b/x\"", "\"a/\\3\" \"b/x\""] {
        assert!(parse_patch(&format!("diff --git {bad}\n")).is_empty());
    }
}

#[test]
fn handles_spaces_separators_renames_and_copies() {
    let files = parse_patch(
        "diff --git a/space b/inside b/space b/inside\nold mode 100644\nnew mode 100755\n",
    );
    assert_eq!(files[0].path, "space b/inside");
    assert!(!files[0].is_binary);
    for (operation, status) in [("rename", "renamed"), ("copy", "copied")] {
        let patch = format!("diff --git a/old name b/new name\nsimilarity index 100%\n{operation} from old name\n{operation} to new name\n");
        let files = parse_patch(&patch);
        assert_eq!(files[0].status, status);
        assert_eq!(files[0].original_path.as_deref(), Some("old name"));
        assert_eq!(files[0].path, "new name");
        assert!(!files[0].is_binary);
    }
    let files = parse_patch(
        "diff --git \"a/old\\tname\" b/new name\nrename from \"old\\tname\"\nrename to new name\n",
    );
    assert_eq!(files[0].original_path.as_deref(), Some("old\tname"));
    assert_eq!(files[0].path, "new name");
    let files = parse_patch("diff --git a/old b/name \"b/new\\tname\"\nrename from old b/name\nrename to \"new\\tname\"\n");
    assert_eq!(files[0].original_path.as_deref(), Some("old b/name"));
    assert_eq!(files[0].path, "new\tname");
}

#[test]
fn handles_multiple_hunks_without_a_trailing_newline() {
    let raw = "diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-old\n+new\n@@ -10 +10,2 @@\n keep\n+more";
    let files = parse_patch(raw);
    assert_eq!((files[0].additions, files[0].deletions), (2, 1));
    assert_eq!(files[0].raw, raw);
    assert_eq!(files[0].total_lines, 9);
}

#[test]
fn classifies_only_explicit_binary_markers_as_binary() {
    let patch = "diff --git a/binary b/binary\nnew file mode 100644\nBinary files /dev/null and b/binary differ\ndiff --git a/empty b/empty\nnew file mode 100644\ndiff --git a/deleted b/deleted\ndeleted file mode 100644\ndiff --git a/mode b/mode\nold mode 100644\nnew mode 100755\ndiff --git a/encoded b/encoded\nGIT binary patch\nliteral 1\nabc\n";
    let files = parse_patch(patch);
    assert_eq!(files.len(), 5);
    assert!(files[0].is_binary);
    assert_eq!(files[0].status, "added");
    assert!(!files[1].is_binary);
    assert_eq!(files[1].status, "added");
    assert!(!files[2].is_binary);
    assert_eq!(files[2].status, "deleted");
    assert!(!files[3].is_binary);
    assert!(files[4].is_binary);
}

#[test]
fn real_git_fixture_covers_quoted_paths_binary_empty_rename_and_mode() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    git(root, &["init", "--initial-branch=main"]);
    git(root, &["config", "user.name", "Patch Test"]);
    git(root, &["config", "user.email", "patch@example.com"]);
    git(root, &["config", "commit.gpgsign", "false"]);
    git(root, &["config", "core.autocrlf", "false"]);
    for (name, content) in [("café.txt", "old\n"), ("old name", "rename\n"), ("delete", "gone\n")]
    {
        std::fs::write(root.join(name), content).unwrap();
    }
    git(root, &["add", "-A"]);
    git(root, &["commit", "-m", "initial"]);
    std::fs::write(root.join("café.txt"), "++ new\n").unwrap();
    std::fs::rename(root.join("old name"), root.join("new name")).unwrap();
    std::fs::remove_file(root.join("delete")).unwrap();
    std::fs::write(root.join("empty"), "").unwrap();
    std::fs::write(root.join("binary"), [0, 1, 2]).unwrap();
    git(root, &["add", "-A"]);
    // Set the index mode directly so this fixture works on Windows too.
    git(root, &["update-index", "--chmod=+x", "new name"]);
    let raw = git(root, &["-c", "core.quotePath=true", "diff", "--cached", "--no-ext-diff", "-M"]);
    let files = parse_patch(&raw);
    assert_eq!(files.len(), 5, "{raw}");
    let find = |path: &str| files.iter().find(|f| f.path == path).unwrap();
    assert_eq!((find("café.txt").additions, find("café.txt").deletions), (1, 1));
    assert_eq!(find("new name").status, "renamed");
    assert_eq!(find("new name").original_path.as_deref(), Some("old name"));
    assert!(!find("new name").is_binary);
    assert_eq!(find("delete").status, "deleted");
    assert!(!find("delete").is_binary);
    assert_eq!(find("empty").status, "added");
    assert!(!find("empty").is_binary);
    assert!(find("binary").is_binary);
    assert_eq!(files.iter().map(|f| f.raw.as_str()).collect::<String>(), raw);
    for file in &files {
        assert_eq!(file.total_lines, file.raw.split('\n').count() as i64);
    }
    // Disabling quoting must preserve the same literal paths and metadata.
    let unquoted = parse_patch(&git(
        root,
        &["-c", "core.quotePath=false", "diff", "--cached", "--no-ext-diff", "-M"],
    ));
    assert_eq!(
        files.iter().map(|f| &f.path).collect::<Vec<_>>(),
        unquoted.iter().map(|f| &f.path).collect::<Vec<_>>()
    );
}

#[test]
fn crlf_headers_decode_quoted_paths_without_changing_raw_text() {
    let raw = "diff --git \"a/caf\\303\\251\" \"b/caf\\303\\251\"\r\n--- \"a/caf\\303\\251\"\r\n+++ \"b/caf\\303\\251\"\r\n@@ -1 +1 @@\r\n-old\r\n+new\r\n";
    let files = parse_patch(raw);
    assert_eq!(files.len(), 1);
    assert_eq!(files[0].path, "café");
    assert_eq!(files[0].raw, raw);
    assert_eq!((files[0].additions, files[0].deletions), (1, 1));
}

#[test]
fn processes_summary_before_display_truncation() {
    use coc_native_core::git::patch::process_patch;
    let raw = "diff --git a/x b/x\n@@ -1 +1 @@\n-old\n+new\n";
    let result = process_patch(raw.into(), Some(2));
    assert_eq!(result.content.raw, "diff --git a/x b/x\n@@ -1 +1 @@");
    assert_eq!(result.content.total_lines, 5);
    assert!(result.content.truncated);
    assert_eq!(result.files[0].raw, raw);
    assert_eq!(
        (result.summary.files_changed, result.summary.additions, result.summary.deletions),
        (1, 1, 1)
    );
    for limit in [0, -1] {
        assert_eq!(process_patch(raw.into(), Some(limit)).content.raw, "");
    }
    assert_eq!(process_patch("".into(), None).content.total_lines, 0);
    assert!(!process_patch(raw.into(), Some(5)).content.truncated);
}

#[test]
fn range_plan_keeps_context_revision_boundary_and_literal_path() {
    use coc_native_core::git::patch::range_patch_args;
    assert_eq!(
        range_patch_args("base", "head", Some("[abc].txt"), Some(0)),
        [
            "--literal-pathspecs",
            "diff",
            "-M",
            "-C",
            "--no-color",
            "--src-prefix=a/",
            "--dst-prefix=b/",
            "-U0",
            "--end-of-options",
            "base...head",
            "--",
            "[abc].txt"
        ]
    );
    assert_eq!(
        range_patch_args("base", "head", None, None),
        [
            "--literal-pathspecs",
            "diff",
            "-M",
            "-C",
            "--no-color",
            "--src-prefix=a/",
            "--dst-prefix=b/",
            "--end-of-options",
            "base...head",
            "--"
        ]
    );
}

#[test]
fn commit_planning_matches_root_and_first_parent_without_switching_branches() {
    use coc_native_core::git::patch::{commit_patch, commit_patch_args, show_patch};
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    git(root, &["init", "--initial-branch=main"]);
    git(root, &["config", "user.name", "Test"]);
    git(root, &["config", "user.email", "test@example.com"]);
    git(root, &["config", "commit.gpgsign", "false"]);
    git(root, &["config", "core.autocrlf", "false"]);
    std::fs::write(root.join("same.txt"), "before\n").unwrap();
    git(root, &["add", "."]);
    git(root, &["commit", "-m", "root"]);
    let initial = git(root, &["rev-parse", "HEAD"]).trim().to_owned();
    let root_patch = commit_patch(root, &initial, None, None, None).unwrap();
    assert_eq!(root_patch.files[0].status, "added");
    assert_eq!(root_patch.summary.additions, 1);
    std::fs::write(root.join("same.txt"), "after\n").unwrap();
    git(root, &["add", "."]);
    git(root, &["commit", "-m", "ordinary"]);
    let head = git(root, &["rev-parse", "HEAD"]).trim().to_owned();
    let side =
        git(root, &["commit-tree", "HEAD^{tree}", "-p", &initial, "-m", "side"]).trim().to_owned();
    let merge =
        git(root, &["commit-tree", "HEAD^{tree}", "-p", &initial, "-p", &side, "-m", "merge"])
            .trim()
            .to_owned();
    for commit in [&head, &merge] {
        let result = commit_patch(root, commit, None, None, None).unwrap();
        let expected = git(root, &["diff", "-M", "-C", &initial, commit]);
        assert_eq!(result.content.raw, expected.trim_end_matches(['\r', '\n']));
        assert_eq!((result.summary.additions, result.summary.deletions), (1, 1));
    }
    for commit in [&initial, &head, &merge] {
        let result = show_patch(root, commit, None, None, None).unwrap();
        let expected = git(root, &["show", "--format=", "--patch", "-M", "-C", commit]);
        assert_eq!(result.content.raw, expected.trim_end_matches(['\r', '\n']));
    }
    // git-show route semantics remain distinct: this merge's combined patch is empty.
    assert!(git(root, &["show", "--format=", "--patch", &merge]).is_empty());
    let args = commit_patch_args("--output=oops", Some("[ab].txt"), Some(0));
    assert!(args.contains(&"--literal-pathspecs".into()));
    assert!(args.contains(&"-U0".into()));
    assert_eq!(args.last().unwrap(), "[ab].txt");
    assert!(commit_patch(root, "--output=oops", None, None, None).is_err());
    assert!(!root.join("oops").exists());
}
