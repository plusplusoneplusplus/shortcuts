//! Scoped, bounded patch snapshots. Callers resolve refs or fingerprint supplied
//! bytes before requesting a version; mutable names alone are never cache keys.

use super::commit::validate_ref;
use super::patch::{
    commit_patch, comparison_patch, process_patch, process_working_tree_patch, range_patch,
    show_patch, truncate_patch, working_tree_patch_outputs, PatchResult,
};
use super::{GitCommandOptions, GitError, GitErrorKind};
use parking_lot::{Condvar, Mutex};
use std::collections::{HashMap, VecDeque};
use std::path::PathBuf;
use std::sync::Arc;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PatchExecution {
    Host,
    Wsl { distro: String },
}

#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "napi", napi_derive::napi(object))]
pub struct RemotePatchSource {
    pub provider: String,
    pub host: String,
    /// Provider-qualified organization/project/repository identity.
    pub repository: String,
    /// Pull request or supplied snapshot source identity, without credentials.
    pub source_id: String,
    pub iteration: Option<String>,
    pub base_iteration: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PatchSource {
    Local { kind: String },
    Remote(RemotePatchSource),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PatchScope {
    pub workspace_id: String,
    pub root: PathBuf,
    pub execution: PatchExecution,
    pub source: PatchSource,
}

impl PatchScope {
    fn valid(&self) -> bool {
        !self.workspace_id.trim().is_empty()
            && match &self.execution {
                PatchExecution::Host => self.root.is_absolute(),
                // A WSL root is a Linux path, including on a Windows host.
                PatchExecution::Wsl { distro } => {
                    !distro.trim().is_empty() && self.root.to_string_lossy().starts_with('/')
                }
            }
            && match &self.source {
                PatchSource::Local { kind } => !kind.trim().is_empty(),
                PatchSource::Remote(source) => {
                    [&source.provider, &source.host, &source.repository, &source.source_id]
                        .iter()
                        .all(|v| !v.trim().is_empty())
                        && [&source.iteration, &source.base_iteration]
                            .iter()
                            .all(|v| v.as_ref().is_none_or(|v| !v.trim().is_empty()))
                        && (source.base_iteration.is_none() || source.iteration.is_some())
                }
            }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum PatchVersion {
    Revisions { base: String, head: String },
    Fingerprint(String),
}

/// Variant includes patch operation, path, context and composition options.
/// Display truncation can be applied after retrieving a complete snapshot.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct PatchKey {
    pub version: PatchVersion,
    pub variant: String,
}

impl PatchKey {
    fn valid(&self) -> bool {
        !self.variant.trim().is_empty()
            && match &self.version {
                PatchVersion::Revisions { base, head } => [base, head].iter().all(|v| {
                    matches!(v.len(), 40 | 64) && v.bytes().all(|c| c.is_ascii_hexdigit())
                }),
                PatchVersion::Fingerprint(value) => !value.trim().is_empty(),
            }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PatchStoreError {
    InvalidIdentity,
    ScopeMismatch,
    Closed,
    Stale,
    Capacity,
    Compute(String),
}

type Outcome = Result<Arc<PatchResult>, PatchStoreError>;

#[derive(Default)]
struct Flight {
    result: Mutex<Option<Outcome>>,
    ready: Condvar,
}

impl Flight {
    fn finish(&self, result: Outcome) {
        let mut slot = self.result.lock();
        if slot.is_none() {
            *slot = Some(result);
            self.ready.notify_all();
        }
    }

    fn wait(&self) -> Outcome {
        let mut slot = self.result.lock();
        while slot.is_none() {
            self.ready.wait(&mut slot);
        }
        slot.as_ref().unwrap().clone()
    }
}

#[derive(Default)]
struct State {
    generation: u64,
    closed: bool,
    cache: VecDeque<(PatchKey, Arc<PatchResult>, usize)>,
    bytes: usize,
    pending: HashMap<PatchKey, Arc<Flight>>,
    active: usize,
}

/// Each handle owns one exact workspace/root/execution/source scope. Work runs
/// outside the state lock; concurrent identical requests share one completion.
/// Running computations and retained snapshot allocations are bounded independently.
pub struct PatchStore {
    identity: Arc<()>,
    scope: PatchScope,
    max_entries: usize,
    max_bytes: usize,
    state: Mutex<State>,
}

/// Captured before external I/O, consumed once when its bytes arrive. It holds
/// no worker or cache capacity while TypeScript performs authenticated/WSL I/O.
pub struct PatchTransport {
    identity: Arc<()>,
    generation: u64,
}

impl PatchStore {
    pub fn open(
        scope: PatchScope,
        max_entries: usize,
        max_bytes: usize,
    ) -> Result<Self, PatchStoreError> {
        if !scope.valid() || max_entries == 0 {
            return Err(PatchStoreError::InvalidIdentity);
        }
        Ok(Self {
            identity: Arc::new(()),
            scope,
            max_entries,
            max_bytes,
            state: Mutex::new(State::default()),
        })
    }

    fn check(&self, scope: &PatchScope, state: &State) -> Result<(), PatchStoreError> {
        if scope != &self.scope {
            Err(PatchStoreError::ScopeMismatch)
        } else if state.closed {
            Err(PatchStoreError::Closed)
        } else {
            Ok(())
        }
    }

    pub fn get_or_compute(
        &self,
        scope: &PatchScope,
        key: PatchKey,
        compute: impl FnOnce() -> Result<PatchResult, String>,
    ) -> Outcome {
        self.compute(scope, key, None, compute)
    }

    fn compute(
        &self,
        scope: &PatchScope,
        key: PatchKey,
        generation: Option<u64>,
        compute: impl FnOnce() -> Result<PatchResult, String>,
    ) -> Outcome {
        let (flight, owner) = {
            let mut state = self.state.lock();
            self.check(scope, &state)?;
            if generation.is_some_and(|generation| generation != state.generation) {
                return Err(PatchStoreError::Stale);
            }
            if !key.valid() {
                return Err(PatchStoreError::InvalidIdentity);
            }
            if let Some(index) = state.cache.iter().position(|entry| entry.0 == key) {
                let entry = state.cache.remove(index).unwrap();
                let result = entry.1.clone();
                state.cache.push_back(entry);
                return Ok(result);
            }
            if let Some(flight) = state.pending.get(&key) {
                (flight.clone(), false)
            } else {
                if state.active >= self.max_entries {
                    return Err(PatchStoreError::Capacity);
                }
                let flight = Arc::new(Flight::default());
                state.pending.insert(key.clone(), flight.clone());
                state.active += 1;
                (flight, true)
            }
        };
        if owner {
            // A panic cannot strand waiters or permanently consume capacity.
            let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(compute))
                .unwrap_or_else(|_| Err("patch computation panicked".into()))
                .map(Arc::new)
                .map_err(PatchStoreError::Compute);
            let mut state = self.state.lock();
            state.active -= 1;
            // Refresh/disposal remove the old flight. Pointer identity is the
            // generation token: an older completion cannot replace a new one.
            if state.pending.get(&key).is_some_and(|current| Arc::ptr_eq(current, &flight)) {
                state.pending.remove(&key);
                if let Ok(value) = &result {
                    let bytes = retained_bytes(&key, value);
                    if !value.content.truncated && bytes <= self.max_bytes {
                        while state.cache.len() >= self.max_entries
                            || state.bytes > self.max_bytes - bytes
                        {
                            state.bytes -= state.cache.pop_front().unwrap().2;
                        }
                        state.bytes += bytes;
                        state.cache.push_back((key, value.clone(), bytes));
                    }
                }
                flight.finish(result);
            }
        }
        flight.wait()
    }

    pub fn scope(&self) -> &PatchScope {
        &self.scope
    }

    pub fn begin_transport(&self, scope: &PatchScope) -> Result<PatchTransport, PatchStoreError> {
        let state = self.state.lock();
        self.check(scope, &state)?;
        Ok(PatchTransport { identity: self.identity.clone(), generation: state.generation })
    }

    /// Hash and parse supplied bytes on the worker, using the same bounded
    /// snapshot store as host revisions. Never trust mutable transport ref names.
    pub fn complete_transport(
        &self,
        scope: &PatchScope,
        ticket: PatchTransport,
        raw: String,
        max_lines: Option<i64>,
    ) -> Result<PatchResult, PatchStoreError> {
        let fingerprint = blake3::hash(raw.as_bytes()).to_hex().to_string();
        self.complete_snapshot(scope, ticket, fingerprint, "supplied", max_lines, || {
            process_patch(raw, None)
        })
    }

    pub fn complete_working_tree_transport(
        &self,
        scope: &PatchScope,
        ticket: PatchTransport,
        outputs: Vec<String>,
        max_lines: Option<i64>,
        headings: bool,
    ) -> Result<PatchResult, PatchStoreError> {
        if !matches!(scope.source, PatchSource::Local { .. }) {
            return Err(PatchStoreError::InvalidIdentity);
        }
        let mut hash = blake3::Hasher::new();
        // Length framing preserves staged/unstaged boundaries, including empty outputs.
        for raw in &outputs {
            hash.update(&(raw.len() as u64).to_le_bytes());
            hash.update(raw.as_bytes());
        }
        self.complete_snapshot(
            scope,
            ticket,
            hash.finalize().to_hex().to_string(),
            if headings { "pending" } else { "working-tree" },
            max_lines,
            || process_working_tree_patch(outputs, None, headings),
        )
    }

    #[allow(clippy::too_many_arguments)]
    fn complete_snapshot(
        &self,
        scope: &PatchScope,
        ticket: PatchTransport,
        fingerprint: String,
        variant: &str,
        max_lines: Option<i64>,
        process: impl FnOnce() -> PatchResult,
    ) -> Result<PatchResult, PatchStoreError> {
        if !Arc::ptr_eq(&self.identity, &ticket.identity) {
            return Err(PatchStoreError::ScopeMismatch);
        }
        let key =
            PatchKey { version: PatchVersion::Fingerprint(fingerprint), variant: variant.into() };
        let result = self.compute(scope, key, Some(ticket.generation), || Ok(process()))?;
        Ok(truncate_patch(&result, max_lines))
    }

    #[allow(clippy::too_many_arguments)]
    pub fn working_tree_patch(
        &self,
        ticket: PatchTransport,
        scope: &str,
        path: Option<&str>,
        context: Option<u32>,
        max_lines: Option<i64>,
        headings: bool,
    ) -> Result<PatchResult, String> {
        if self.scope.execution != PatchExecution::Host
            || !matches!(self.scope.source, PatchSource::Local { .. })
        {
            return Err(format!("patch store: {:?}", PatchStoreError::InvalidIdentity));
        }
        let outputs = working_tree_patch_outputs(&self.scope.root, scope, path, context)
            .map_err(|error| error.to_string())?;
        self.complete_working_tree_transport(&self.scope, ticket, outputs, max_lines, headings)
            .map_err(|error| format!("patch store: {error:?}"))
    }

    /// Host commit (`commit`/`show`) or two-revision (`range`/`comparison`)
    /// patches. Refs resolve to object IDs and Git runs on those IDs, so a
    /// moving ref cannot publish into another version. Names that do not
    /// resolve run uncached to keep Git's own error text.
    #[allow(clippy::too_many_arguments)]
    pub fn revision_patch(
        &self,
        mode: &str,
        base: &str,
        head: Option<&str>,
        path: Option<&str>,
        context: Option<u32>,
        max_lines: Option<i64>,
        options: &GitCommandOptions,
    ) -> Result<PatchResult, String> {
        if self.scope.execution != PatchExecution::Host
            || !matches!(self.scope.source, PatchSource::Local { .. })
        {
            return Err(format!("patch store: {:?}", PatchStoreError::InvalidIdentity));
        }
        let root = &self.scope.root;
        let run = |base: &str, head: Option<&str>, max_lines| match (mode, head) {
            ("commit", None) => commit_patch(root, base, path, context, max_lines),
            ("show", None) => show_patch(root, base, path, context, max_lines),
            ("range", Some(head)) => range_patch(root, base, head, path, context, max_lines),
            ("comparison", Some(head)) => {
                comparison_patch(root, base, head, path, context, max_lines, options)
            }
            _ => Err(GitError::from_parts(GitErrorKind::Repository, &[], "invalid patch mode")),
        };
        let resolve = |rev: &str| validate_ref(root, rev).ok().flatten();
        let resolved = match head {
            None => resolve(base).map(|sha| (sha.clone(), sha)),
            Some(head) => resolve(base).zip(resolve(head)),
        };
        let Some((base_sha, head_sha)) = resolved else {
            return run(base, head, max_lines).map_err(|error| error.to_string());
        };
        let key = PatchKey {
            version: PatchVersion::Revisions { base: base_sha.clone(), head: head_sha.clone() },
            variant: format!("{mode}\0{path:?}\0{context:?}"),
        };
        let result = self
            .get_or_compute(&self.scope, key, || {
                run(&base_sha, head.map(|_| head_sha.as_str()), None).map_err(|e| e.to_string())
            })
            .map_err(|error| match error {
                PatchStoreError::Compute(message) => message,
                other => format!("patch store: {other:?}"),
            })?;
        Ok(truncate_patch(&result, max_lines))
    }

    pub fn refresh(&self, scope: &PatchScope) -> Result<(), PatchStoreError> {
        let mut state = self.state.lock();
        self.check(scope, &state)?;
        Self::clear(&mut state, PatchStoreError::Stale);
        Ok(())
    }

    pub fn dispose(&self, scope: &PatchScope) -> Result<(), PatchStoreError> {
        let mut state = self.state.lock();
        if scope != &self.scope {
            return Err(PatchStoreError::ScopeMismatch);
        }
        state.closed = true;
        Self::clear(&mut state, PatchStoreError::Closed);
        Ok(())
    }

    fn clear(state: &mut State, error: PatchStoreError) {
        state.generation += 1;
        state.cache.clear();
        state.bytes = 0;
        for (_, flight) in state.pending.drain() {
            flight.finish(Err(error.clone()));
        }
    }
}

fn retained_bytes(key: &PatchKey, value: &PatchResult) -> usize {
    let version = match &key.version {
        PatchVersion::Revisions { base, head } => base.capacity() + head.capacity(),
        PatchVersion::Fingerprint(value) => value.capacity(),
    };
    version
        + std::mem::size_of::<PatchKey>()
        + std::mem::size_of::<PatchResult>()
        + key.variant.capacity()
        + value.content.raw.capacity()
        + value.files.capacity() * std::mem::size_of::<super::patch::PatchFile>()
        + value
            .files
            .iter()
            .map(|f| {
                f.path.capacity()
                    + f.original_path.as_ref().map_or(0, String::capacity)
                    + f.status.capacity()
                    + f.raw.capacity()
            })
            .sum::<usize>()
}
