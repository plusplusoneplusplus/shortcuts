//! Scoped, bounded patch snapshots. Callers resolve refs or fingerprint supplied
//! bytes before requesting a version; mutable names alone are never cache keys.

use super::patch::PatchResult;
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
pub enum PatchSource {
    Local {
        kind: String,
    },
    Remote {
        provider: String,
        host: String,
        repository: String,
        iteration: Option<String>,
        base_iteration: Option<String>,
    },
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
                PatchSource::Remote { provider, host, repository, iteration, base_iteration } => {
                    [provider, host, repository].iter().all(|v| !v.trim().is_empty())
                        && [iteration, base_iteration]
                            .iter()
                            .all(|v| v.as_ref().is_none_or(|v| !v.trim().is_empty()))
                        && (base_iteration.is_none() || iteration.is_some())
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
    scope: PatchScope,
    max_entries: usize,
    max_bytes: usize,
    state: Mutex<State>,
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
        Ok(Self { scope, max_entries, max_bytes, state: Mutex::new(State::default()) })
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
        let (flight, owner) = {
            let mut state = self.state.lock();
            self.check(scope, &state)?;
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
