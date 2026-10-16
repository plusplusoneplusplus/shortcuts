//! LSP subscription onto the shared native watch service.

use std::path::PathBuf;

use coc_native_core::watch::{WatchFilter, WatchService, WatchSubscription};
use serde_json::json;

use crate::indexer::IndexQueue;
use crate::transport::Transport;

pub struct FileWatcher {
    _service: WatchService,
}

pub fn start(root: PathBuf, queue: IndexQueue, transport: Transport) -> Option<FileWatcher> {
    let service = WatchService::new(move |batch| {
        if batch.rescan {
            queue.rescan();
        } else {
            for path in batch.paths {
                queue.submit(path);
            }
        }
    });
    let options = WatchSubscription {
        workspace_id: "lsp".into(),
        root,
        recursive: true,
        filter: WatchFilter {
            ignore_dirs: vec![],
            extensions: [
                "c", "cc", "cpp", "cxx", "c++", "h", "hh", "hpp", "hxx", "h++", "inl", "ipp",
                "inc", "tcc", "def", "cu", "cuh", "m", "mm",
            ]
            .into_iter()
            .map(String::from)
            .collect(),
            respect_gitignore: true,
        },
        debounce_ms: 100,
    };
    match service.subscribe(options) {
        Ok(_) => Some(FileWatcher { _service: service }),
        Err(error) => {
            transport.notify(
                "window/logMessage",
                json!({
                    "type": 2,
                    "message": format!("Watching the workspace for changes failed: {error}"),
                }),
            );
            None
        }
    }
}
