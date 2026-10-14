//! Permanent single-entry deletion with a no-follow preflight and per-entry revalidation.

use std::collections::HashMap;
use std::fmt;
use std::fs::{self, Metadata};
use std::path::{Path, PathBuf};

use super::RepoFilesError;

#[derive(Debug)]
pub struct DeleteEntryError {
    pub cause: RepoFilesError,
    pub removed_entries: usize,
}

impl fmt::Display for DeleteEntryError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if self.removed_entries > 0 {
            write!(
                f,
                "Deletion partially completed ({} entries removed); no rollback: {}",
                self.removed_entries, self.cause
            )
        } else {
            self.cause.fmt(f)
        }
    }
}

impl std::error::Error for DeleteEntryError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        Some(&self.cause)
    }
}

fn invalid(message: &str) -> RepoFilesError {
    RepoFilesError::InvalidArg(message.to_owned())
}

fn protected(name: &std::ffi::OsStr) -> bool {
    name.to_str().is_some_and(|name| name.eq_ignore_ascii_case(".git"))
}

fn relative_target(root: &Path, relative: &str) -> Result<PathBuf, RepoFilesError> {
    if relative.is_empty() || relative == "." {
        return Err(invalid("Cannot delete the workspace root"));
    }
    let mut target = root.to_path_buf();
    for component in relative.split(['/', '\\']) {
        if component.is_empty()
            || component == "."
            || component == ".."
            || component.contains([':', '\0'])
            || component.ends_with(['.', ' '])
        {
            return Err(invalid("Deletion requires a workspace-relative path without traversal"));
        }
        if protected(component.as_ref()) {
            return Err(invalid("Cannot delete Git metadata"));
        }
        target.push(component);
    }
    Ok(target)
}

fn metadata(path: &Path) -> Result<Metadata, RepoFilesError> {
    fs::symlink_metadata(path).map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            RepoFilesError::PathMissing(
                path.file_name().unwrap_or_default().to_string_lossy().into(),
            )
        } else {
            error.into()
        }
    })
}

fn validate_type(metadata: &Metadata) -> Result<(), RepoFilesError> {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        // Unknown reparse-point kinds must not become traversable directories.
        if metadata.file_attributes() & 0x400 != 0 && !metadata.file_type().is_symlink() {
            return Err(invalid("Cannot delete an unsupported filesystem reparse point"));
        }
    }
    if metadata.is_dir() || metadata.is_file() || metadata.file_type().is_symlink() {
        Ok(())
    } else {
        Err(invalid("Cannot delete an unsupported filesystem entry"))
    }
}

fn same_entry(before: &Metadata, current: &Metadata) -> bool {
    if before.file_type() != current.file_type() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if before.dev() != current.dev() || before.ino() != current.ino() {
            return false;
        }
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if before.creation_time() != current.creation_time()
            || before.file_attributes() != current.file_attributes()
        {
            return false;
        }
    }
    // Removing children changes a directory's timestamps and length.
    before.is_dir()
        || (before.len() == current.len()
            && matches!(
                (before.modified(), current.modified()),
                (Ok(before), Ok(current)) if before == current
            ))
}

struct Entry {
    path: PathBuf,
    metadata: Metadata,
}

struct DeletePlan {
    configured_root: PathBuf,
    root: PathBuf,
    directories: HashMap<PathBuf, Metadata>,
    entries: Vec<Entry>,
}

impl DeletePlan {
    fn prepare(configured_root: &Path, relative: &str) -> Result<Self, RepoFilesError> {
        let root = fs::canonicalize(configured_root)?;
        let target = relative_target(&root, relative)?;
        let mut plan = Self {
            configured_root: configured_root.to_path_buf(),
            root,
            directories: HashMap::new(),
            entries: Vec::new(),
        };
        // Capture every ancestor before inspecting the selected entry.
        let mut parent = target.parent();
        while let Some(directory) = parent {
            let snapshot = metadata(directory)?;
            if !snapshot.is_dir() || snapshot.file_type().is_symlink() {
                return Err(invalid("Cannot delete through a symlinked ancestor"));
            }
            validate_type(&snapshot)?;
            plan.directories.insert(directory.to_path_buf(), snapshot);
            if directory == plan.root {
                break;
            }
            parent = directory.parent();
        }
        let mut pending = vec![(target, None)];
        while let Some((path, snapshot)) = pending.pop() {
            if let Some(snapshot) = snapshot {
                plan.entries.push(Entry { path, metadata: snapshot });
                continue;
            }
            plan.validate_ancestors(&path)?;
            if path.file_name().is_some_and(protected) {
                return Err(invalid("Cannot delete a folder containing Git metadata"));
            }
            let snapshot = metadata(&path)?;
            validate_type(&snapshot)?;
            if snapshot.is_dir() && !snapshot.file_type().is_symlink() {
                plan.directories.insert(path.clone(), snapshot.clone());
                let mut children = fs::read_dir(&path)?
                    .map(|entry| entry.map(|entry| entry.path()))
                    .collect::<Result<Vec<_>, _>>()?;
                children.sort();
                pending.push((path, Some(snapshot)));
                pending.extend(children.into_iter().rev().map(|child| (child, None)));
            } else {
                plan.entries.push(Entry { path, metadata: snapshot });
            }
        }
        Ok(plan)
    }

    fn validate_ancestors(&self, target: &Path) -> Result<(), RepoFilesError> {
        if fs::canonicalize(&self.configured_root)? != self.root {
            return Err(invalid("Workspace root changed during deletion"));
        }
        let mut parent = target.parent();
        while let Some(directory) = parent {
            let snapshot = self
                .directories
                .get(directory)
                .ok_or_else(|| invalid("Deletion escaped the workspace root"))?;
            let current = metadata(directory)?;
            validate_type(&current)?;
            if !same_entry(snapshot, &current) || current.file_type().is_symlink() {
                return Err(invalid("Ancestor changed during deletion"));
            }
            if directory == self.root {
                return Ok(());
            }
            parent = directory.parent();
        }
        Err(RepoFilesError::PathTraversal)
    }

    fn execute(
        self,
        mut before_remove: impl FnMut(usize, &Path),
    ) -> Result<usize, DeleteEntryError> {
        for (removed_entries, entry) in self.entries.iter().enumerate() {
            before_remove(removed_entries, &entry.path);
            let remove = || {
                self.validate_ancestors(&entry.path)?;
                let current = metadata(&entry.path)?;
                if !same_entry(&entry.metadata, &current) {
                    return Err(invalid("Entry changed during deletion"));
                }
                // Never recurse here: newly created children, including .git, stay untouched.
                if current.is_dir() && !current.file_type().is_symlink() {
                    fs::remove_dir(&entry.path)?;
                } else {
                    #[cfg(windows)]
                    {
                        use std::os::windows::fs::FileTypeExt;
                        if current.file_type().is_symlink_dir() {
                            fs::remove_dir(&entry.path)?;
                        } else {
                            fs::remove_file(&entry.path)?;
                        }
                    }
                    #[cfg(not(windows))]
                    fs::remove_file(&entry.path)?;
                }
                Ok::<_, RepoFilesError>(())
            };
            remove().map_err(|cause| DeleteEntryError { cause, removed_entries })?;
        }
        Ok(self.entries.len())
    }
}

/// Delete one file, symlink or complete folder. Preflight failures remove nothing;
/// execution failures expose the removed count and never imply rollback.
pub fn delete_entry(root: &Path, relative: &str) -> Result<usize, DeleteEntryError> {
    DeletePlan::prepare(root, relative)
        .map_err(|cause| DeleteEntryError { cause, removed_entries: 0 })?
        .execute(|_, _| {})
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn changed_file_is_retained() {
        let root = tempfile::tempdir().unwrap();
        let file = root.path().join("file");
        fs::write(&file, "before").unwrap();
        let plan = DeletePlan::prepare(root.path(), "file").unwrap();
        let error =
            plan.execute(|_, _| fs::write(&file, "different content").unwrap()).unwrap_err();
        assert_eq!(error.removed_entries, 0);
        assert!(error.to_string().contains("Entry changed"));
        assert_eq!(fs::read_to_string(file).unwrap(), "different content");
    }

    #[test]
    fn new_git_metadata_is_not_removed_and_partial_failure_is_explicit() {
        let root = tempfile::tempdir().unwrap();
        let folder = root.path().join("folder");
        fs::create_dir(&folder).unwrap();
        fs::write(folder.join("file"), "content").unwrap();
        let plan = DeletePlan::prepare(root.path(), "folder").unwrap();
        let error = plan
            .execute(|removed, _| {
                if removed == 1 {
                    fs::write(folder.join(".git"), "gitdir: protected").unwrap();
                }
            })
            .unwrap_err();
        assert_eq!(error.removed_entries, 1);
        assert!(error.to_string().contains("partially completed"));
        assert!(error.to_string().contains("no rollback"));
        assert!(!folder.join("file").exists());
        assert_eq!(fs::read_to_string(folder.join(".git")).unwrap(), "gitdir: protected");
    }

    #[test]
    fn failure_after_one_removal_keeps_remaining_files() {
        let root = tempfile::tempdir().unwrap();
        let folder = root.path().join("folder");
        fs::create_dir(&folder).unwrap();
        fs::write(folder.join("a"), "a").unwrap();
        fs::write(folder.join("b"), "b").unwrap();
        let plan = DeletePlan::prepare(root.path(), "folder").unwrap();
        let error = plan
            .execute(|removed, path| {
                if removed == 1 {
                    fs::write(path, "changed").unwrap();
                }
            })
            .unwrap_err();
        assert_eq!(error.removed_entries, 1);
        assert!(!folder.join("a").exists());
        assert_eq!(fs::read_to_string(folder.join("b")).unwrap(), "changed");
        assert!(folder.is_dir());
    }

    #[cfg(any(unix, windows))]
    #[test]
    fn swapped_ancestor_cannot_delete_an_external_file() {
        let root = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let folder = root.path().join("folder");
        fs::create_dir(&folder).unwrap();
        fs::write(folder.join("file"), "original").unwrap();
        fs::write(outside.path().join("file"), "external").unwrap();
        let plan = DeletePlan::prepare(root.path(), "folder/file").unwrap();
        let error = plan
            .execute(|_, _| {
                fs::rename(&folder, root.path().join("original")).unwrap();
                #[cfg(unix)]
                std::os::unix::fs::symlink(outside.path(), &folder).unwrap();
                #[cfg(windows)]
                std::os::windows::fs::symlink_dir(outside.path(), &folder).unwrap();
            })
            .unwrap_err();
        assert_eq!(error.removed_entries, 0);
        assert!(error.to_string().contains("Ancestor changed"));
        assert_eq!(fs::read_to_string(outside.path().join("file")).unwrap(), "external");
        assert_eq!(fs::read_to_string(root.path().join("original/file")).unwrap(), "original");
    }

    #[test]
    fn newly_created_child_is_not_included_in_the_confirmed_deletion() {
        let root = tempfile::tempdir().unwrap();
        let folder = root.path().join("folder");
        fs::create_dir(&folder).unwrap();
        let plan = DeletePlan::prepare(root.path(), "folder").unwrap();
        let error = plan
            .execute(|_, _| fs::write(folder.join("new-file"), "must survive").unwrap())
            .unwrap_err();
        assert_eq!(error.removed_entries, 0);
        assert_eq!(fs::read_to_string(folder.join("new-file")).unwrap(), "must survive");
    }
}
