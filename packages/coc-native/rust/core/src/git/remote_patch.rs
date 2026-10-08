//! Construct provider patches from explicit file existence and supplied content.
use super::{diff::render_no_index, GitCommandOptions, GitError};

#[cfg_attr(feature = "napi", napi_derive::napi(object))]
#[derive(Debug, Clone)]
pub struct RemotePatchInput {
    pub path: String,
    pub original_path: Option<String>,
    pub before: String,
    pub after: String,
    pub before_exists: bool,
    pub after_exists: bool,
    pub before_mode: Option<String>,
    pub after_mode: Option<String>,
    pub is_binary: Option<bool>,
}

pub fn build_remote_patch(files: Vec<RemotePatchInput>) -> Result<String, GitError> {
    let mut patches = Vec::new();
    for file in files {
        let path = file.path.strip_prefix('/').unwrap_or(&file.path);
        let original = file.original_path.as_deref().unwrap_or(&file.path);
        let original = original.strip_prefix('/').unwrap_or(original);
        let renamed = original != path;
        let before_mode = file.before_mode.as_deref().unwrap_or("100644");
        let after_mode = file.after_mode.as_deref().unwrap_or("100644");
        if file.before_exists == file.after_exists
            && file.before == file.after
            && !renamed
            && before_mode == after_mode
            && file.is_binary != Some(true)
        {
            continue;
        }
        let old = quote_path(&format!("a/{original}"));
        let new = quote_path(&format!("b/{path}"));
        let mut patch = format!("diff --git {old} {new}\n");
        if !file.before_exists {
            patch.push_str(&format!("new file mode {after_mode}\n"));
        } else if !file.after_exists {
            patch.push_str(&format!("deleted file mode {before_mode}\n"));
        } else {
            if before_mode != after_mode {
                patch.push_str(&format!("old mode {before_mode}\nnew mode {after_mode}\n"));
            }
            if renamed {
                patch.push_str(&format!(
                    "rename from {}\nrename to {}\n",
                    quote_path(original),
                    quote_path(path)
                ));
            }
        }
        let old = if file.before_exists { old.as_str() } else { "/dev/null" };
        let new = if file.after_exists { new.as_str() } else { "/dev/null" };
        let rendered = if file.is_binary == Some(true) {
            String::new()
        } else {
            render_no_index(&file.before, &file.after, &GitCommandOptions::default())?
        };
        if file.is_binary == Some(true) || rendered.lines().any(|l| l.starts_with("Binary files "))
        {
            patch.push_str(&format!("Binary files {old} and {new} differ\n"));
        } else if let Some(hunk) = rendered.find("\n@@ ") {
            patch.push_str(&format!("--- {old}\n+++ {new}\n{}\n", &rendered[hunk + 1..]));
        }
        patches.push(patch);
    }
    Ok(patches.join("\n"))
}

/// Git C quoting operates on UTF-8 bytes; octal escapes avoid JSON-only escapes.
fn quote_path(path: &str) -> String {
    if path.bytes().all(|b| (b' '..=b'~').contains(&b) && b != b'"' && b != b'\\') {
        return path.to_string();
    }
    let mut quoted = String::from("\"");
    for byte in path.bytes() {
        match byte {
            b'"' | b'\\' => {
                quoted.push('\\');
                quoted.push(byte as char);
            }
            b' '..=b'~' => quoted.push(byte as char),
            _ => quoted.push_str(&format!("\\{byte:03o}")),
        }
    }
    quoted.push('"');
    quoted
}
