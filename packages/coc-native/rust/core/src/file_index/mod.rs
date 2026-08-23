//! An in-memory, gitignore-aware index of one repository's file paths, with
//! fuzzy top-N path search over it. Backs the dashboard's quick-open dialog.

pub mod index;
pub mod score;
pub mod walk;

pub use index::{Hit, IndexState};
pub use walk::WalkOptions;
