//! N-API bindings for the persistent C-family symbol index.

use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use coc_native_core::symbol_index::{ExtractionLimits, Symbol, SymbolStore};
use napi::bindgen_prelude::{AsyncTask, Error, Result, Status, Task};
use napi::Env;
use napi_derive::napi;

#[napi(object)]
pub struct SymbolMatch {
    pub name: String,
    pub kind: String,
    /// Repository-relative path with `/` separators.
    pub path: String,
    /// One-based source line.
    pub line: u32,
    /// One-based UTF-16 source column.
    pub column: u32,
    pub parent: Option<String>,
}

#[napi(object)]
pub struct SymbolSearchOptions {
    /// Match names beginning with the query instead of exact names only.
    pub prefix: Option<bool>,
    /// Maximum matches to return.
    pub limit: Option<u32>,
}

#[napi]
pub struct SymbolIndex {
    root: PathBuf,
    store: Arc<SymbolStore>,
    operation: Arc<Mutex<()>>,
}

fn to_napi_error(context: &str, error: impl std::fmt::Display) -> Error {
    Error::new(Status::GenericFailure, format!("{context}: {error}"))
}

pub struct BuildSymbolIndexTask {
    root: PathBuf,
    database: PathBuf,
}

impl Task for BuildSymbolIndexTask {
    type Output = (PathBuf, SymbolStore);
    type JsValue = SymbolIndex;

    fn compute(&mut self) -> Result<Self::Output> {
        if let Some(parent) = self.database.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| to_napi_error("failed to create symbol index directory", error))?;
        }
        let store = SymbolStore::open(&self.database)
            .map_err(|error| to_napi_error("failed to open symbol index", error))?;
        store
            .sync_repository(&self.root, ExtractionLimits::default())
            .map_err(|error| to_napi_error("failed to build symbol index", error))?;
        Ok((self.root.clone(), store))
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(SymbolIndex {
            root: output.0,
            store: Arc::new(output.1),
            operation: Arc::new(Mutex::new(())),
        })
    }
}

pub struct SearchSymbolsTask {
    store: Arc<SymbolStore>,
    operation: Arc<Mutex<()>>,
    query: String,
    prefix: bool,
    limit: usize,
}

impl Task for SearchSymbolsTask {
    type Output = Vec<Symbol>;
    type JsValue = Vec<SymbolMatch>;

    fn compute(&mut self) -> Result<Self::Output> {
        let _guard = self.operation.lock().unwrap_or_else(|error| error.into_inner());
        self.store
            .search(&self.query, self.prefix, self.limit)
            .map_err(|error| to_napi_error("failed to search symbol index", error))
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output
            .into_iter()
            .map(|symbol| SymbolMatch {
                name: symbol.name,
                kind: symbol.kind,
                path: symbol.path,
                line: symbol.line,
                column: symbol.column,
                parent: symbol.parent,
            })
            .collect())
    }
}

pub struct RefreshSymbolIndexTask {
    root: PathBuf,
    store: Arc<SymbolStore>,
    operation: Arc<Mutex<()>>,
}

impl Task for RefreshSymbolIndexTask {
    type Output = ();
    type JsValue = ();

    fn compute(&mut self) -> Result<Self::Output> {
        let _guard = self.operation.lock().unwrap_or_else(|error| error.into_inner());
        self.store
            .sync_repository(&self.root, ExtractionLimits::default())
            .map(|_| ())
            .map_err(|error| to_napi_error("failed to refresh symbol index", error))
    }

    fn resolve(&mut self, _env: Env, _output: Self::Output) -> Result<Self::JsValue> {
        Ok(())
    }
}

/// Build or incrementally refresh the persistent index for one repository.
#[napi(ts_return_type = "Promise<SymbolIndex>")]
pub fn build_symbol_index(root: String, database: String) -> AsyncTask<BuildSymbolIndexTask> {
    AsyncTask::new(BuildSymbolIndexTask {
        root: PathBuf::from(root),
        database: PathBuf::from(database),
    })
}

#[napi]
impl SymbolIndex {
    /// Search exact names by default, or prefixes when requested.
    #[napi(ts_return_type = "Promise<SymbolMatch[]>")]
    pub fn search(
        &self,
        query: String,
        options: Option<SymbolSearchOptions>,
    ) -> AsyncTask<SearchSymbolsTask> {
        let options = options.unwrap_or(SymbolSearchOptions { prefix: None, limit: None });
        AsyncTask::new(SearchSymbolsTask {
            store: Arc::clone(&self.store),
            operation: Arc::clone(&self.operation),
            query,
            prefix: options.prefix.unwrap_or(false),
            limit: options.limit.unwrap_or(100) as usize,
        })
    }

    /// Incrementally refresh changed files in the persistent index.
    #[napi(ts_return_type = "Promise<void>")]
    pub fn refresh(&self) -> AsyncTask<RefreshSymbolIndexTask> {
        AsyncTask::new(RefreshSymbolIndexTask {
            root: self.root.clone(),
            store: Arc::clone(&self.store),
            operation: Arc::clone(&self.operation),
        })
    }
}
