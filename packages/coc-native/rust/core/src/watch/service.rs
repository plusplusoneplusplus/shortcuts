use super::{PendingBatch, WatchBatch};
use ignore::gitignore::{Gitignore, GitignoreBuilder};
use notify::{Config, Event, EventKind, PollWatcher, RecursiveMode, Watcher};
use std::collections::HashMap;
use std::fmt;
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, SyncSender};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

const HEALTH_INTERVAL: Duration = Duration::from_millis(100);
const RAW_CAPACITY: usize = 1024;
const MAX_IGNORE_CACHE_DIRS: usize = 4096;

#[derive(Clone, Debug, Default)]
pub struct WatchFilter {
    pub ignore_dirs: Vec<String>,
    pub extensions: Vec<String>,
    pub respect_gitignore: bool,
}

#[derive(Clone, Debug)]
pub struct WatchSubscription {
    pub workspace_id: String,
    pub root: PathBuf,
    pub recursive: bool,
    pub filter: WatchFilter,
    pub debounce_ms: u32,
}

#[derive(Debug)]
pub struct WatchError(pub String);

impl fmt::Display for WatchError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(f)
    }
}

impl std::error::Error for WatchError {}

impl From<notify::Error> for WatchError {
    fn from(error: notify::Error) -> Self {
        Self(error.to_string())
    }
}

type Reply<T> = SyncSender<Result<T, WatchError>>;
enum Command {
    Subscribe(WatchSubscription, Reply<u32>),
    Unsubscribe(u32, Reply<()>),
    Workspace(String, Reply<()>),
    Count(Reply<usize>),
    Stop(Reply<()>),
}

struct Subscription {
    options: WatchSubscription,
    root_key: String,
    pending: PendingBatch,
    ignores: HashMap<PathBuf, Gitignore>,
}

struct Root {
    path: PathBuf,
    recursive: bool,
    watcher: Option<Box<dyn Watcher + Send>>,
    identity: Option<String>,
}

type ArmBackend = dyn Fn(
        &str,
        &Root,
        &SyncSender<RawEvent>,
        &Arc<AtomicBool>,
    ) -> Result<Box<dyn Watcher + Send>, WatchError>
    + Send;

/// Owns watcher lifetimes and serializes subscription changes with delivery.
pub struct WatchService {
    sender: SyncSender<Command>,
    worker: Mutex<Option<JoinHandle<()>>>,
    worker_id: thread::ThreadId,
}

impl WatchService {
    pub fn new(callback: impl Fn(WatchBatch) + Send + Sync + 'static) -> Self {
        Self::with_backend(callback, Box::new(arm))
    }

    fn with_backend(
        callback: impl Fn(WatchBatch) + Send + Sync + 'static,
        backend: Box<ArmBackend>,
    ) -> Self {
        let (sender, receiver) = mpsc::sync_channel(64);
        let worker = thread::spawn(move || run(receiver, callback, backend));
        let worker_id = worker.thread().id();
        Self { sender, worker: Mutex::new(Some(worker)), worker_id }
    }

    fn request<T>(&self, command: impl FnOnce(Reply<T>) -> Command) -> Result<T, WatchError> {
        if thread::current().id() == self.worker_id {
            return Err(WatchError(
                "Watch callbacks cannot synchronously call the watch service".into(),
            ));
        }
        let (sender, receiver) = mpsc::sync_channel(1);
        self.sender
            .send(command(sender))
            .map_err(|_| WatchError("Watch service is disposed".into()))?;
        receiver.recv().map_err(|_| WatchError("Watch worker stopped".into()))?
    }

    pub fn subscribe(&self, options: WatchSubscription) -> Result<u32, WatchError> {
        self.request(|reply| Command::Subscribe(options, reply))
    }

    pub fn unsubscribe(&self, id: u32) -> Result<(), WatchError> {
        self.request(|reply| Command::Unsubscribe(id, reply))
    }

    pub fn unwatch_workspace(&self, workspace_id: &str) -> Result<(), WatchError> {
        self.request(|reply| Command::Workspace(workspace_id.into(), reply))
    }

    pub fn root_count(&self) -> Result<usize, WatchError> {
        self.request(Command::Count)
    }

    pub fn dispose(&self) -> Result<(), WatchError> {
        if thread::current().id() == self.worker_id {
            return Err(WatchError(
                "Watch callbacks cannot synchronously dispose the watch service".into(),
            ));
        }
        let mut worker = self.worker.lock().unwrap_or_else(|error| error.into_inner());
        if let Some(handle) = worker.take() {
            let result = self.request(Command::Stop);
            handle.join().map_err(|_| WatchError("Watch worker panicked".into()))?;
            result?;
        }
        Ok(())
    }

    pub fn shutdown(&self) -> Result<(), WatchError> {
        self.dispose()
    }
}

impl Drop for WatchService {
    fn drop(&mut self) {
        if let Err(error) = self.dispose() {
            eprintln!("Disposing native watch service: {error}");
        }
    }
}

fn canonical_root(path: &Path) -> Result<PathBuf, WatchError> {
    let absolute = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir().map_err(|error| WatchError(error.to_string()))?.join(path)
    };
    let mut ancestor = absolute.as_path();
    let mut suffix = Vec::new();
    loop {
        match ancestor.canonicalize() {
            Ok(mut root) => {
                for part in suffix.iter().rev() {
                    root.push(part);
                }
                let mut normalized = PathBuf::new();
                for component in root.components() {
                    match component {
                        Component::CurDir => {}
                        Component::ParentDir => {
                            normalized.pop();
                        }
                        component => normalized.push(component.as_os_str()),
                    }
                }
                return Ok(normalized);
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                suffix.push(
                    ancestor
                        .file_name()
                        .ok_or_else(|| WatchError(error.to_string()))?
                        .to_os_string(),
                );
                ancestor = ancestor.parent().ok_or_else(|| WatchError(error.to_string()))?;
            }
            Err(error) => return Err(WatchError(error.to_string())),
        }
    }
}

fn root_key(path: &Path) -> String {
    #[cfg(windows)]
    {
        windows_path(path).to_lowercase()
    }
    #[cfg(not(windows))]
    {
        path.to_string_lossy().into_owned()
    }
}

#[cfg(windows)]
fn windows_path(path: &Path) -> String {
    let text = path.to_string_lossy().replace('\\', "/");
    if let Some(unc) = text.strip_prefix("//?/UNC/") {
        format!("//{unc}")
    } else {
        text.strip_prefix("//?/").unwrap_or(&text).to_owned()
    }
}

fn relative_path(path: &Path, root: &Path) -> Option<PathBuf> {
    if let Ok(relative) = path.strip_prefix(root) {
        return Some(relative.to_path_buf());
    }
    #[cfg(windows)]
    {
        let path = windows_path(path);
        let root = windows_path(root);
        let path: Vec<_> = path.split('/').collect();
        let root: Vec<_> = root.split('/').collect();
        if path.len() >= root.len()
            && path
                .iter()
                .zip(&root)
                .all(|(left, right)| left.to_lowercase() == right.to_lowercase())
        {
            return Some(path[root.len()..].iter().collect());
        }
    }
    None
}

fn identity(path: &Path) -> Result<Option<String>, WatchError> {
    match path.metadata() {
        Ok(metadata) if metadata.is_dir() => {
            #[cfg(unix)]
            {
                use std::os::unix::fs::MetadataExt;
                Ok(Some(format!("{}:{}", metadata.dev(), metadata.ino())))
            }
            #[cfg(not(unix))]
            {
                Ok(Some(format!("{:?}", metadata.created())))
            }
        }
        Ok(_) => Err(WatchError(format!("Watch root is not a directory: {}", path.display()))),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(WatchError(format!("Inspecting watch root {}: {error}", path.display()))),
    }
}

type RawEvent = (String, notify::Result<Event>);

fn enqueue_raw(
    sender: &SyncSender<RawEvent>,
    overflow: &AtomicBool,
    key: &str,
    event: notify::Result<Event>,
) {
    if event.as_ref().is_ok_and(|event| {
        event.paths.len() > super::MAX_BATCH_PATHS
            || event.paths.iter().map(|path| path.as_os_str().len()).sum::<usize>()
                > super::MAX_BATCH_PATH_BYTES
    }) {
        overflow.store(true, Ordering::Release);
        return;
    }
    if sender.try_send((key.to_owned(), event)).is_err() {
        overflow.store(true, Ordering::Release);
    }
}

fn arm(
    key: &str,
    root: &Root,
    sender: &SyncSender<RawEvent>,
    overflow: &Arc<AtomicBool>,
) -> Result<Box<dyn Watcher + Send>, WatchError> {
    let key = key.to_owned();
    let sender = sender.clone();
    let overflow = overflow.clone();
    let handler = move |event: notify::Result<Event>| {
        enqueue_raw(&sender, &overflow, &key, event);
    };
    // UNC shares do not reliably expose remote change notifications.
    let path_text = root.path.to_string_lossy();
    let unc = path_text.starts_with(r"\\?\UNC\")
        || (path_text.starts_with(r"\\") && !path_text.starts_with(r"\\?\"));
    let mut watcher: Box<dyn Watcher + Send> = if cfg!(windows) && unc {
        Box::new(PollWatcher::new(
            handler,
            Config::default().with_poll_interval(Duration::from_secs(1)),
        )?)
    } else {
        Box::new(notify::recommended_watcher(handler)?)
    };
    watcher.watch(
        &root.path,
        if root.recursive { RecursiveMode::Recursive } else { RecursiveMode::NonRecursive },
    )?;
    Ok(watcher)
}

fn run(receiver: Receiver<Command>, callback: impl Fn(WatchBatch), backend: Box<ArmBackend>) {
    let (raw_sender, raw_receiver) = mpsc::sync_channel(RAW_CAPACITY);
    let overflow = Arc::new(AtomicBool::new(false));
    let mut roots: HashMap<String, Root> = HashMap::new();
    let mut subscriptions: HashMap<u32, Subscription> = HashMap::new();
    let mut next_id = 1u32;
    let mut health = Instant::now() + HEALTH_INTERVAL;
    loop {
        let now = Instant::now();
        let deadline = subscriptions
            .values()
            .filter_map(|subscription| subscription.pending.deadline())
            .min()
            .unwrap_or(health)
            .min(health);
        match receiver.recv_timeout(deadline.saturating_duration_since(now)) {
            Ok(Command::Subscribe(mut options, reply)) => {
                let result = (|| {
                    options.root = canonical_root(&options.root)?;
                    let current_identity = identity(&options.root)?;
                    let key = root_key(&options.root);
                    let needs_rescan;
                    if let Some(root) = roots.get_mut(&key) {
                        if (options.recursive || options.filter.respect_gitignore)
                            && !root.recursive
                        {
                            root.watcher = None;
                            root.recursive = true;
                            if root.identity.is_some() {
                                match backend(&key, root, &raw_sender, &overflow) {
                                    Ok(watcher) => root.watcher = Some(watcher),
                                    Err(error) => {
                                        eprintln!("Upgrading native watch for {key}: {error}");
                                    }
                                }
                            }
                            for subscription in subscriptions.values_mut() {
                                if subscription.root_key == key {
                                    subscription.ignores.clear();
                                    subscription.pending.require_rescan(Instant::now());
                                }
                            }
                        }
                        needs_rescan = root.identity.is_some() && root.watcher.is_none();
                    } else {
                        let mut root = Root {
                            identity: current_identity,
                            path: options.root.clone(),
                            // Even shallow deliveries need changes to
                            // .git/info/exclude to invalidate their ignore cache.
                            recursive: options.recursive || options.filter.respect_gitignore,
                            watcher: None,
                        };
                        if root.identity.is_some() {
                            match backend(&key, &root, &raw_sender, &overflow) {
                                Ok(watcher) => root.watcher = Some(watcher),
                                Err(error) => {
                                    eprintln!("Starting native watch for {key}: {error}");
                                }
                            }
                        }
                        needs_rescan = root.identity.is_some() && root.watcher.is_none();
                        roots.insert(key.clone(), root);
                    }
                    let id = next_id;
                    next_id = next_id
                        .checked_add(1)
                        .ok_or_else(|| WatchError("Subscription ID exhausted".into()))?;
                    let mut pending = PendingBatch::new(id, options.debounce_ms);
                    if needs_rescan {
                        pending.require_rescan(Instant::now());
                    }
                    subscriptions.insert(
                        id,
                        Subscription { pending, options, root_key: key, ignores: HashMap::new() },
                    );
                    Ok(id)
                })();
                let _ = reply.send(result);
            }
            Ok(Command::Unsubscribe(id, reply)) => {
                subscriptions.remove(&id);
                prune(&mut roots, &subscriptions);
                let _ = reply.send(Ok(()));
            }
            Ok(Command::Workspace(workspace, reply)) => {
                subscriptions
                    .retain(|_, subscription| subscription.options.workspace_id != workspace);
                prune(&mut roots, &subscriptions);
                let _ = reply.send(Ok(()));
            }
            Ok(Command::Count(reply)) => {
                let _ = reply.send(Ok(roots.len()));
            }
            Ok(Command::Stop(reply)) => {
                roots.clear();
                let _ = reply.send(Ok(()));
                break;
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
            Err(mpsc::RecvTimeoutError::Timeout) => {}
        }
        // Bound the work per pass too: a hot root cannot starve commands/health.
        for (key, event) in raw_receiver.try_iter().take(RAW_CAPACITY) {
            let now = Instant::now();
            match event {
                Ok(event) => {
                    for subscription in subscriptions.values_mut().filter(|s| s.root_key == key) {
                        process_event(subscription, &event, now);
                    }
                    if event.paths.iter().any(|path| {
                        roots.get(&key).is_some_and(|root| {
                            relative_path(path, &root.path)
                                .is_some_and(|relative| relative.as_os_str().is_empty())
                        })
                    }) && matches!(event.kind, EventKind::Remove(_))
                    {
                        if let Some(root) = roots.get_mut(&key) {
                            root.watcher = None;
                            root.identity = None;
                        }
                    }
                }
                Err(error) => {
                    eprintln!("Native watch error for {key}: {error}");
                    if let Some(root) = roots.get_mut(&key) {
                        root.watcher = None;
                    }
                    for subscription in subscriptions.values_mut().filter(|s| s.root_key == key) {
                        subscription.ignores.clear();
                        subscription.pending.require_rescan(now);
                    }
                }
            }
        }
        if overflow.swap(false, Ordering::AcqRel) {
            for subscription in subscriptions.values_mut() {
                subscription.ignores.clear();
                subscription.pending.require_rescan(Instant::now());
            }
        }
        let now = Instant::now();
        if now >= health {
            // A missing path can later become a symlink/junction to an already
            // watched real root. Merge before arming to retain one OS watcher.
            let migrations: Vec<_> = roots
                .iter()
                .filter_map(|(key, root)| {
                    let canonical = canonical_root(&root.path).ok()?;
                    (root_key(&canonical) != *key).then(|| (key.clone(), canonical))
                })
                .collect();
            for (old_key, canonical) in migrations {
                let Some(mut old) = roots.remove(&old_key) else { continue };
                old.watcher = None;
                let key = root_key(&canonical);
                for subscription in subscriptions.values_mut().filter(|s| s.root_key == old_key) {
                    subscription.root_key = key.clone();
                    subscription.options.root = canonical.clone();
                    subscription.ignores.clear();
                    subscription.pending.require_rescan(now);
                }
                if let Some(existing) = roots.get_mut(&key) {
                    if old.recursive && !existing.recursive {
                        existing.watcher = None;
                        existing.recursive = true;
                    }
                } else {
                    old.path = canonical;
                    old.identity = None;
                    roots.insert(key, old);
                }
            }
            for (key, root) in &mut roots {
                match identity(&root.path) {
                    Ok(current) => {
                        if current != root.identity || (current.is_some() && root.watcher.is_none())
                        {
                            root.watcher = None;
                            root.identity = current;
                            if root.identity.is_some() {
                                match backend(key, root, &raw_sender, &overflow) {
                                    Ok(watcher) => root.watcher = Some(watcher),
                                    Err(error) => {
                                        eprintln!("Rearming native watch for {key}: {error}")
                                    }
                                }
                            }
                            for subscription in
                                subscriptions.values_mut().filter(|s| s.root_key == *key)
                            {
                                subscription.ignores.clear();
                                subscription.pending.require_rescan(now);
                            }
                        }
                    }
                    Err(error) => {
                        eprintln!("{error}");
                        for subscription in
                            subscriptions.values_mut().filter(|s| s.root_key == *key)
                        {
                            subscription.ignores.clear();
                            subscription.pending.require_rescan(now);
                        }
                    }
                }
            }
            health = now + HEALTH_INTERVAL;
        }
        for subscription in subscriptions.values_mut() {
            if let Some(batch) = subscription.pending.drain_ready(Instant::now()) {
                callback(batch);
            }
        }
    }
}

fn prune(roots: &mut HashMap<String, Root>, subscriptions: &HashMap<u32, Subscription>) {
    roots.retain(|key, _| subscriptions.values().any(|subscription| &subscription.root_key == key));
}

fn process_event(subscription: &mut Subscription, event: &Event, now: Instant) {
    if event.need_rescan() {
        subscription.ignores.clear();
        subscription.pending.require_rescan(now);
        return;
    }
    if !matches!(event.kind, EventKind::Create(_) | EventKind::Modify(_) | EventKind::Remove(_)) {
        return;
    }
    for path in &event.paths {
        let Some(relative) = relative_path(path, &subscription.options.root) else { continue };
        let text = relative.to_string_lossy().replace('\\', "/");
        if text.is_empty() {
            subscription.ignores.clear();
            subscription.pending.require_rescan(now);
            continue;
        }
        let exclude_change =
            subscription.options.filter.respect_gitignore && text == ".git/info/exclude";
        if !exclude_change && !accept_explicit_path(&subscription.options, &relative) {
            continue;
        }
        if subscription.options.filter.respect_gitignore
            && ((relative.file_name().is_some_and(|name| name == ".gitignore")
                && (subscription.options.recursive || relative.components().count() == 1))
                || exclude_change)
        {
            subscription.ignores.clear();
            subscription.pending.require_rescan(now);
            continue;
        }
        if !subscription.options.recursive && relative.components().count() > 1 {
            continue;
        }
        let directory_event = path.is_dir()
            || matches!(
                event.kind,
                EventKind::Create(notify::event::CreateKind::Folder)
                    | EventKind::Remove(notify::event::RemoveKind::Folder)
                    | EventKind::Remove(notify::event::RemoveKind::Any)
                    | EventKind::Remove(notify::event::RemoveKind::Other)
                    | EventKind::Modify(notify::event::ModifyKind::Name(_))
            );
        if directory_event {
            subscription.ignores.clear();
        }
        if !accept_path(
            &subscription.options,
            &relative,
            directory_event,
            &mut subscription.ignores,
        ) {
            continue;
        }
        if directory_event
            || (matches!(event.kind, EventKind::Remove(_)) && path.extension().is_none())
        {
            subscription.pending.require_rescan(now);
        } else {
            subscription.pending.record_path(text, now);
        }
    }
}

fn accept_path(
    options: &WatchSubscription,
    relative: &Path,
    directory_event: bool,
    ignores: &mut HashMap<PathBuf, Gitignore>,
) -> bool {
    if !accept_explicit_path(options, relative)
        || (!options.recursive && relative.components().count() > 1)
    {
        return false;
    }
    let absolute = options.root.join(relative);
    if options.filter.respect_gitignore && gitignored(&options.root, &absolute, ignores) {
        return false;
    }
    if directory_event {
        return true;
    }
    options.filter.extensions.is_empty()
        || relative.extension().is_some_and(|extension| {
            options.filter.extensions.iter().any(|allowed| {
                extension.to_string_lossy().eq_ignore_ascii_case(allowed.trim_start_matches('.'))
            })
        })
        // Unknown removed directories must invalidate their indexed descendants.
        || (!absolute.exists() && relative.extension().is_none())
}

fn accept_explicit_path(options: &WatchSubscription, relative: &Path) -> bool {
    let text = relative.to_string_lossy().replace('\\', "/");
    let segments: Vec<_> = text.split('/').collect();
    if segments.iter().any(|segment| {
        *segment == ".git" || (cfg!(windows) && segment.eq_ignore_ascii_case(".git"))
    }) {
        return false;
    }
    for ignored in &options.filter.ignore_dirs {
        let ignored = ignored.replace('\\', "/");
        let ignored = ignored.trim_matches('/');
        if !ignored.is_empty()
            && (segments.contains(&ignored)
                || text == ignored
                || text.starts_with(&format!("{ignored}/")))
        {
            return false;
        }
    }
    true
}

fn gitignored(root: &Path, path: &Path, cache: &mut HashMap<PathBuf, Gitignore>) -> bool {
    let mut directories = vec![root.to_path_buf()];
    let relative = path.strip_prefix(root).unwrap_or(path);
    let mut directory = root.to_path_buf();
    if let Some(parent) = relative.parent() {
        for component in parent.components() {
            directory.push(component);
            directories.push(directory.clone());
        }
    }
    if cache.len().saturating_add(directories.len()) > MAX_IGNORE_CACHE_DIRS {
        cache.clear();
    }
    for directory in &directories {
        cache.entry(directory.clone()).or_insert_with(|| {
            let mut builder = GitignoreBuilder::new(directory);
            if directory == root {
                let exclude = root.join(".git/info/exclude");
                if exclude.exists() {
                    if let Some(error) = builder.add(exclude) {
                        eprintln!("Reading native watch exclusions: {error}");
                    }
                }
            }
            let gitignore = directory.join(".gitignore");
            if gitignore.exists() {
                if let Some(error) = builder.add(&gitignore) {
                    eprintln!("Reading native watch ignore rules: {error}");
                }
            }
            builder.build().unwrap_or_else(|error| {
                eprintln!("Building native watch ignore rules: {error}");
                Gitignore::empty()
            })
        });
    }
    for (index, directory) in directories.iter().enumerate().skip(1) {
        // An ignored directory is never traversed, so its own negations cannot
        // re-include files. File rules, unlike directory rules, may be overridden
        // by a deeper .gitignore.
        for ancestor in directories[..index].iter().rev() {
            let matched = cache[ancestor].matched_path_or_any_parents(directory, true);
            if !matched.is_none() {
                if matched.is_ignore() {
                    return true;
                }
                break;
            }
        }
    }
    for directory in directories.iter().rev() {
        let matched = cache[directory].matched_path_or_any_parents(path, path.is_dir());
        if !matched.is_none() {
            return matched.is_ignore();
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicUsize;

    fn subscription(root: &Path, recursive: bool, debounce_ms: u32) -> WatchSubscription {
        WatchSubscription {
            root: root.to_path_buf(),
            workspace_id: "test".into(),
            recursive,
            filter: WatchFilter::default(),
            debounce_ms,
        }
    }

    #[test]
    fn ignored_gitignore_control_events_cannot_bypass_explicit_directory_filters() {
        let now = Instant::now();
        let mut options = subscription(Path::new("root"), true, 0);
        options.filter = WatchFilter {
            ignore_dirs: vec!["node_modules".into(), ".git".into()],
            extensions: vec!["md".into()],
            respect_gitignore: true,
        };
        let mut subscription = Subscription {
            options,
            root_key: "root".into(),
            pending: PendingBatch::new(1, 0),
            ignores: HashMap::new(),
        };
        for path in
            ["node_modules/.gitignore", "nested/node_modules/.gitignore", ".git/hooks/.gitignore"]
        {
            let event = Event::new(EventKind::Modify(notify::event::ModifyKind::Any))
                .add_path(PathBuf::from("root").join(path));
            process_event(&mut subscription, &event, now);
            assert_eq!(subscription.pending.deadline(), None, "{path}");
        }
        for path in [".gitignore", "src/.gitignore", ".git/info/exclude"] {
            let event = Event::new(EventKind::Modify(notify::event::ModifyKind::Any))
                .add_path(PathBuf::from("root").join(path));
            process_event(&mut subscription, &event, now);
            assert!(
                subscription.pending.drain_ready(now).is_some_and(|batch| batch.rescan),
                "{path}"
            );
        }
    }

    #[test]
    fn initial_backend_failure_registers_rescans_retries_and_recovers() {
        let root = tempfile::Builder::new().prefix("watch-arm-failure-").tempdir_in(".").unwrap();
        let failing = Arc::new(AtomicBool::new(true));
        let attempts = Arc::new(AtomicUsize::new(0));
        let backend_failing = failing.clone();
        let backend_attempts = attempts.clone();
        let (sender, receiver) = mpsc::channel();
        let service = WatchService::with_backend(
            move |batch| {
                let _ = sender.send(batch);
            },
            Box::new(move |key, root, sender, overflow| {
                backend_attempts.fetch_add(1, Ordering::AcqRel);
                if backend_failing.load(Ordering::Acquire) {
                    Err(WatchError("injected backend registration failure".into()))
                } else {
                    arm(key, root, sender, overflow)
                }
            }),
        );
        let id = service.subscribe(subscription(root.path(), true, 300)).unwrap();
        assert_eq!(service.root_count().unwrap(), 1);
        let batch = receiver.recv_timeout(Duration::from_secs(5)).unwrap();
        assert_eq!(batch, WatchBatch { subscription_id: id, paths: vec![], rescan: true });
        assert!(attempts.load(Ordering::Acquire) >= 2, "health must retry the failed backend");
        failing.store(false, Ordering::Release);
        assert!(receiver.recv_timeout(Duration::from_secs(5)).unwrap().rescan);
        std::fs::write(root.path().join("recovered.md"), "recovered").unwrap();
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            let batch =
                receiver.recv_timeout(deadline.saturating_duration_since(Instant::now())).unwrap();
            if batch.paths.contains(&"recovered.md".into()) {
                break;
            }
        }
        service.dispose().unwrap();
    }

    #[test]
    fn failed_recursive_upgrade_registers_new_subscription_and_invalidates_existing_one() {
        let root =
            tempfile::Builder::new().prefix("watch-upgrade-failure-").tempdir_in(".").unwrap();
        let attempts = AtomicUsize::new(0);
        let (sender, receiver) = mpsc::channel();
        let service = WatchService::with_backend(
            move |batch| {
                let _ = sender.send(batch);
            },
            Box::new(move |key, root, sender, overflow| {
                if attempts.fetch_add(1, Ordering::AcqRel) == 0 {
                    arm(key, root, sender, overflow)
                } else {
                    Err(WatchError("injected recursive upgrade failure".into()))
                }
            }),
        );
        let first = service.subscribe(subscription(root.path(), false, 0)).unwrap();
        let second = service.subscribe(subscription(root.path(), true, 0)).unwrap();
        assert_eq!(service.root_count().unwrap(), 1);
        let mut ids = std::collections::BTreeSet::new();
        while ids.len() < 2 {
            let batch = receiver.recv_timeout(Duration::from_secs(5)).unwrap();
            assert!(batch.rescan);
            assert!(batch.paths.is_empty());
            ids.insert(batch.subscription_id);
        }
        assert_eq!(ids, [first, second].into_iter().collect());
        service.unsubscribe(second).unwrap();
        assert_eq!(service.root_count().unwrap(), 1);
        service.dispose().unwrap();
    }

    #[test]
    fn bounded_ingress_escalates_saturation_and_oversized_events() {
        let (sender, receiver) = mpsc::sync_channel(1);
        let overflow = AtomicBool::new(false);
        enqueue_raw(&sender, &overflow, "root", Ok(Event::new(EventKind::Any)));
        assert!(!overflow.load(Ordering::Acquire));
        enqueue_raw(&sender, &overflow, "root", Ok(Event::new(EventKind::Any)));
        assert!(overflow.swap(false, Ordering::AcqRel));
        let _ = receiver.recv().unwrap();
        let mut oversized = Event::new(EventKind::Any);
        oversized.paths = vec![PathBuf::from("a"); super::super::MAX_BATCH_PATHS + 1];
        enqueue_raw(&sender, &overflow, "root", Ok(oversized));
        assert!(overflow.swap(false, Ordering::AcqRel));
        let oversized = Event::new(EventKind::Any)
            .add_path(PathBuf::from("a".repeat(super::super::MAX_BATCH_PATH_BYTES + 1)));
        enqueue_raw(&sender, &overflow, "root", Ok(oversized));
        assert!(overflow.load(Ordering::Acquire));
        assert!(receiver.try_recv().is_err());
    }

    #[test]
    fn backend_rescan_flag_discards_partial_paths() {
        let now = Instant::now();
        let mut subscription = Subscription {
            options: WatchSubscription {
                root: PathBuf::from("root"),
                workspace_id: "test".into(),
                recursive: true,
                filter: WatchFilter::default(),
                debounce_ms: 0,
            },
            root_key: "root".into(),
            pending: PendingBatch::new(1, 0),
            ignores: HashMap::new(),
        };
        subscription.ignores.insert(PathBuf::from("root"), Gitignore::empty());
        subscription.pending.record_path("partial.md".into(), now);
        let mut event = Event::new(EventKind::Other);
        event.attrs.set_flag(notify::event::Flag::Rescan);
        process_event(&mut subscription, &event, now);
        assert!(subscription.ignores.is_empty());
        assert_eq!(
            subscription.pending.drain_ready(now),
            Some(WatchBatch { subscription_id: 1, paths: vec![], rescan: true })
        );
        // Some backends cannot distinguish a removed directory from a file.
        subscription.options.filter.extensions = vec!["md".into()];
        let event = Event::new(EventKind::Remove(notify::event::RemoveKind::Any))
            .add_path(PathBuf::from("root/removed.generated"));
        process_event(&mut subscription, &event, now);
        assert!(subscription.pending.drain_ready(now).unwrap().rescan);
    }
}
