//! Native watch transport: one unreferenced wakeup and bounded batches per subscription.

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Instant;

use coc_native_core::watch::{
    PendingBatch, WatchBatch, WatchError, WatchFilter, WatchService, WatchSubscription,
};
use napi::bindgen_prelude::Function;
use napi::threadsafe_function::ThreadsafeFunctionCallMode;
use napi::{Env, Error, Result, Status};
use napi_derive::napi;

#[napi(object)]
pub struct NativeWatchSubscriptionOptions {
    pub workspace_id: String,
    pub root: String,
    pub recursive: bool,
    pub ignore_dirs: Vec<String>,
    pub extensions: Vec<String>,
    pub respect_gitignore: bool,
    pub debounce_ms: u32,
}

#[derive(Default)]
struct Delivery {
    disposed: bool,
    scheduled: bool,
    subscribing: bool,
    active: BTreeMap<u32, String>,
    pending: BTreeMap<u32, PendingBatch>,
}

impl Delivery {
    fn enqueue(&mut self, batch: WatchBatch) -> bool {
        if self.disposed || (!self.subscribing && !self.active.contains_key(&batch.subscription_id))
        {
            return false;
        }
        let now = Instant::now();
        let pending = self
            .pending
            .entry(batch.subscription_id)
            .or_insert_with(|| PendingBatch::new(batch.subscription_id, 0));
        if batch.rescan {
            pending.mark_rescan(now);
        } else {
            for path in batch.paths {
                pending.record_path(path, now);
            }
        }
        !std::mem::replace(&mut self.scheduled, true)
    }

    fn drain(&mut self) -> Vec<WatchBatch> {
        self.scheduled = false;
        let now = Instant::now();
        std::mem::take(&mut self.pending)
            .into_values()
            .filter_map(|mut pending| pending.drain_ready(now))
            .collect()
    }

    fn prune_pending(&mut self) {
        self.pending.retain(|id, _| self.active.contains_key(id));
    }
}

#[napi]
pub struct NativeWatchService {
    service: Option<WatchService>,
    delivery: Arc<Mutex<Delivery>>,
}

#[napi]
impl NativeWatchService {
    #[napi(constructor)]
    pub fn new(env: Env, on_batch: Function<'_, WatchBatch, ()>) -> Result<Self> {
        let delivery = Arc::new(Mutex::new(Delivery::default()));
        let callback = on_batch.create_ref()?;
        let callback_delivery = Arc::clone(&delivery);
        let trampoline =
            env.create_function_from_closure::<(), (), _>("deliverWatchBatches", move |ctx| {
                let batches = callback_delivery.lock().unwrap().drain();
                for batch in batches {
                    let state = callback_delivery.lock().unwrap();
                    if state.disposed || !state.active.contains_key(&batch.subscription_id) {
                        continue;
                    }
                    drop(state);
                    callback.borrow_back(ctx.env)?.call(batch)?;
                }
                Ok(())
            })?;
        let wakeup = trampoline
            .build_threadsafe_function::<()>()
            .callee_handled::<false>()
            .weak::<true>()
            .max_queue_size::<1>()
            .build()?;
        let worker_delivery = Arc::clone(&delivery);
        let service = WatchService::new(move |batch| {
            if !worker_delivery.lock().unwrap().enqueue(batch) {
                return;
            }
            let status = wakeup.call((), ThreadsafeFunctionCallMode::NonBlocking);
            if status != Status::Ok && status != Status::Closing {
                let mut delivery = worker_delivery.lock().unwrap();
                let now = Instant::now();
                for pending in delivery.pending.values_mut() {
                    pending.mark_rescan(now);
                }
                // A full queue already contains the wakeup that drains these
                // rescans. Other failures allow the next batch to retry.
                if status != Status::QueueFull {
                    delivery.scheduled = false;
                }
                eprintln!("[native-watch] callback wakeup failed: {status}");
            }
        });
        Ok(Self { service: Some(service), delivery })
    }

    #[napi]
    pub fn subscribe(&self, options: NativeWatchSubscriptionOptions) -> Result<u32> {
        let service = self
            .service
            .as_ref()
            .ok_or_else(|| Error::new(Status::Closing, "Native watch service disposed"))?;
        // Core requests wait for its worker, which can concurrently enqueue a
        // batch. Never hold the delivery lock while waiting for that worker.
        self.delivery.lock().unwrap().subscribing = true;
        let workspace_id = options.workspace_id;
        let result = service.subscribe(WatchSubscription {
            workspace_id: workspace_id.clone(),
            root: PathBuf::from(options.root),
            recursive: options.recursive,
            filter: WatchFilter {
                ignore_dirs: options.ignore_dirs,
                extensions: options.extensions,
                respect_gitignore: options.respect_gitignore,
            },
            debounce_ms: options.debounce_ms,
        });
        let mut delivery = self.delivery.lock().unwrap();
        delivery.subscribing = false;
        if let Ok(id) = result.as_ref() {
            delivery.active.insert(*id, workspace_id);
        }
        delivery.prune_pending();
        result.map_err(watch_error)
    }

    #[napi]
    pub fn unsubscribe(&self, id: u32) -> Result<()> {
        {
            let mut delivery = self.delivery.lock().unwrap();
            delivery.active.remove(&id);
            delivery.pending.remove(&id);
        }
        if let Some(service) = &self.service {
            service.unsubscribe(id).map_err(watch_error)?;
        }
        Ok(())
    }

    #[napi]
    pub fn unwatch_workspace(&self, workspace_id: String) -> Result<()> {
        {
            let mut delivery = self.delivery.lock().unwrap();
            delivery.active.retain(|_, workspace| workspace != &workspace_id);
            delivery.prune_pending();
        }
        if let Some(service) = &self.service {
            service.unwatch_workspace(&workspace_id).map_err(watch_error)?;
        }
        Ok(())
    }

    #[napi]
    pub fn dispose(&mut self) -> Result<()> {
        {
            let mut delivery = self.delivery.lock().unwrap();
            delivery.disposed = true;
            delivery.active.clear();
            delivery.pending.clear();
        }
        if let Some(service) = self.service.take() {
            service.dispose().map_err(watch_error)?;
        }
        Ok(())
    }
}

impl Drop for NativeWatchService {
    fn drop(&mut self) {
        if let Err(error) = self.dispose() {
            eprintln!("[native-watch] shutdown failed: {error}");
        }
    }
}

fn watch_error(error: WatchError) -> Error {
    Error::new(Status::GenericFailure, error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use coc_native_core::watch::{MAX_BATCH_PATHS, MAX_BATCH_PATH_BYTES};

    fn delivery() -> Delivery {
        let mut delivery = Delivery::default();
        delivery.active.insert(1, "workspace-a".into());
        delivery.active.insert(2, "workspace-b".into());
        delivery
    }

    fn batch(subscription_id: u32, paths: &[&str], rescan: bool) -> WatchBatch {
        WatchBatch {
            subscription_id,
            paths: paths.iter().map(|path| (*path).into()).collect(),
            rescan,
        }
    }

    #[test]
    fn coalesces_one_wakeup_and_keeps_subscriptions_separate() {
        let mut delivery = delivery();
        assert!(delivery.enqueue(batch(1, &["b.md", "a.md"], false)));
        assert!(!delivery.enqueue(batch(1, &["a.md"], false)));
        assert!(!delivery.enqueue(batch(2, &["other.md"], false)));
        assert_eq!(
            delivery.drain(),
            vec![batch(1, &["a.md", "b.md"], false), batch(2, &["other.md"], false)]
        );
        assert!(delivery.enqueue(batch(1, &["next.md"], false)));
    }

    #[test]
    fn path_and_byte_overflow_require_rescan() {
        for paths in [
            (0..MAX_BATCH_PATHS).map(|index| index.to_string()).collect(),
            vec!["x".repeat(MAX_BATCH_PATH_BYTES)],
        ] {
            let mut delivery = delivery();
            delivery.enqueue(WatchBatch { subscription_id: 1, paths, rescan: false });
            delivery.enqueue(batch(1, &["later.md"], false));
            assert_eq!(delivery.drain(), vec![batch(1, &[], true)]);
        }
    }

    #[test]
    fn explicit_rescan_replaces_partial_paths() {
        let mut delivery = delivery();
        delivery.enqueue(batch(1, &["partial.md"], false));
        delivery.enqueue(batch(1, &[], true));
        assert_eq!(delivery.drain(), vec![batch(1, &[], true)]);
    }

    #[test]
    fn ignores_removed_and_disposed_subscriptions() {
        let mut delivery = delivery();
        delivery.active.remove(&1);
        assert!(!delivery.enqueue(batch(1, &["removed.md"], false)));
        delivery.disposed = true;
        assert!(!delivery.enqueue(batch(2, &["disposed.md"], false)));
        assert!(delivery.drain().is_empty());
    }

    #[test]
    fn retains_initial_batches_until_subscription_registration() {
        let mut delivery = delivery();
        delivery.subscribing = true;
        assert!(delivery.enqueue(batch(3, &["initial.md"], false)));
        delivery.active.insert(3, "workspace-c".into());
        delivery.subscribing = false;
        delivery.prune_pending();
        assert_eq!(delivery.drain(), vec![batch(3, &["initial.md"], false)]);
    }

    #[test]
    fn prunes_pending_batches_when_a_subscription_is_removed() {
        let mut delivery = delivery();
        delivery.enqueue(batch(1, &["removed.md"], false));
        delivery.enqueue(batch(2, &["retained.md"], false));
        delivery.active.remove(&1);
        delivery.prune_pending();
        assert_eq!(delivery.drain(), vec![batch(2, &["retained.md"], false)]);
    }
}
