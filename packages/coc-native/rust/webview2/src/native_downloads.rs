use super::*;
use crate::download::{self, Lifecycle, NativeState, Progress};
use std::time::Instant;

#[cfg(test)]
#[path = "deferral_tests.rs"]
mod deferral_tests;

pub(super) type Downloads = Rc<RefCell<HashMap<String, Transfer>>>;

struct Held {
    args: ICoreWebView2DownloadStartingEventArgs,
    deferral: Option<ICoreWebView2Deferral>,
}

impl Held {
    unsafe fn approve(mut self, path: &str) -> Result<()> {
        self.args.SetResultFilePath(&HSTRING::from(path))?;
        self.args.SetHandled(true)?;
        self.args.SetCancel(false)?;
        let result = self.deferral.take().unwrap().Complete();
        if result.is_err() {
            let _ = self.args.SetCancel(true);
        }
        result
    }
}

impl Drop for Held {
    fn drop(&mut self) {
        if let Some(deferral) = self.deferral.take() {
            unsafe {
                let _ = self.args.SetCancel(true);
                let _ = self.args.SetHandled(true);
                if deferral.Complete().is_err() {
                    safe_error();
                }
            }
        }
    }
}

pub(super) struct Transfer {
    view: Rc<View>,
    operation: ICoreWebView2DownloadOperation,
    held: Option<Held>,
    lifecycle: Lifecycle,
    bytes_token: Option<i64>,
    state_token: Option<i64>,
}

impl Drop for Transfer {
    fn drop(&mut self) {
        // Callbacks hold only a weak registry, never the operation or controller.
        unsafe {
            let results = [
                self.bytes_token
                    .take()
                    .map(|token| self.operation.remove_BytesReceivedChanged(token)),
                self.state_token.take().map(|token| self.operation.remove_StateChanged(token)),
            ];
            if complete_cleanup(results.into_iter().flatten()).is_err() {
                safe_error();
            }
        }
    }
}

fn safe_error() {
    // Main terminates the helper when a native operation cannot be safely retired.
    protocol::failure(0, "runtime-crashed", "The native download could not be managed safely.");
}

fn emit_progress(id: &str, owner: &str, progress: Progress) {
    protocol::emit(json!({
        "event": "download-progress", "viewId": owner, "downloadId": id,
        "state": progress.state, "received": progress.received, "total": progress.total,
        "canPause": progress.can_pause, "canResume": progress.can_resume, "final": progress.final_state
    }));
}

unsafe fn read_progress(
    operation: &ICoreWebView2DownloadOperation,
    paused: bool,
) -> Result<Progress> {
    let mut state = COREWEBVIEW2_DOWNLOAD_STATE_IN_PROGRESS;
    let mut reason = COREWEBVIEW2_DOWNLOAD_INTERRUPT_REASON_NONE;
    let (mut received, mut total, mut can_resume) = (0, 0, BOOL(0));
    operation.State(&mut state)?;
    operation.BytesReceived(&mut received)?;
    operation.TotalBytesToReceive(&mut total)?;
    operation.CanResume(&mut can_resume)?;
    let native = if state == COREWEBVIEW2_DOWNLOAD_STATE_COMPLETED {
        NativeState::Completed
    } else if state == COREWEBVIEW2_DOWNLOAD_STATE_IN_PROGRESS {
        NativeState::InProgress
    } else if state == COREWEBVIEW2_DOWNLOAD_STATE_INTERRUPTED {
        operation.InterruptReason(&mut reason)?;
        NativeState::Interrupted {
            user_cancelled: reason == COREWEBVIEW2_DOWNLOAD_INTERRUPT_REASON_USER_CANCELED,
            user_paused: reason == COREWEBVIEW2_DOWNLOAD_INTERRUPT_REASON_USER_PAUSED,
        }
    } else {
        NativeState::Failed
    };
    Ok(Progress::sample(native, received, total, paused, can_resume.as_bool()))
}

pub(super) fn retains(downloads: &Downloads, view: &View) -> bool {
    downloads
        .borrow()
        .values()
        .any(|entry| std::ptr::eq(entry.view.as_ref(), view) && !entry.lifecycle.pending())
}

fn release_view(downloads: &Downloads, view: &Rc<View>) {
    if view.closed.get() && !view.closing.get() && !retains(downloads, view) {
        if view.dispose_controller().is_err() {
            safe_error();
        }
    }
}

fn retire(downloads: &Downloads, id: &str, progress: Progress, cancel: bool) {
    let entry = downloads.borrow_mut().remove(id);
    if let Some(mut entry) = entry {
        let view = entry.view.clone();
        // Remove authority before COM calls, which can synchronously invoke callbacks.
        if cancel && unsafe { entry.operation.Cancel() }.is_err() {
            safe_error();
        }
        drop(entry.held.take());
        emit_progress(id, &entry.lifecycle.owner, progress);
        drop(entry);
        release_view(downloads, &view);
    }
}

fn cancel_with_state(downloads: &Downloads, id: &str, state: &'static str) {
    let snapshot = downloads
        .borrow()
        .get(id)
        .map(|entry| (entry.operation.clone(), entry.lifecycle.explicitly_paused));
    if let Some((operation, paused)) = snapshot {
        let mut progress = unsafe { read_progress(&operation, paused) }
            .unwrap_or_else(|_| Progress::sample(NativeState::Failed, 0, 0, false, false));
        progress.state = state;
        progress.can_pause = false;
        progress.can_resume = false;
        progress.final_state = true;
        retire(downloads, id, progress, true);
    }
}

fn sample(downloads: &Downloads, id: &str) {
    let snapshot = downloads.borrow().get(id).map(|entry| {
        (
            entry.operation.clone(),
            entry.lifecycle.owner.clone(),
            entry.lifecycle.explicitly_paused,
            entry.lifecycle.pending(),
            entry.lifecycle.resuming,
        )
    });
    let Some((operation, owner, paused, pending, resuming)) = snapshot else { return };
    match unsafe { read_progress(&operation, paused) } {
        Ok(progress) if progress.final_state => retire(downloads, id, progress, false),
        Ok(mut progress) => {
            if !downloads.borrow().contains_key(id) {
                return;
            }
            if resuming && progress.state == "downloading" {
                if let Some(entry) = downloads.borrow_mut().get_mut(id) {
                    entry.lifecycle.resuming = false;
                    entry.lifecycle.explicitly_paused = false;
                }

                progress.can_pause = true;
            } else if resuming {
                progress.can_resume = false;
            }
            if !pending {
                emit_progress(id, &owner, progress);
            }
        }
        Err(_) => {
            safe_error();
            cancel_with_state(downloads, id, "failed");
        }
    }
}

pub(super) fn tick(downloads: &Downloads) {
    let now = Instant::now();
    let expired: Vec<_> = downloads
        .borrow()
        .iter()
        .filter(|(_, entry)| entry.lifecycle.expired(now))
        .map(|(id, _)| id.clone())
        .collect();
    for id in expired {
        cancel_with_state(downloads, &id, "cancelled");
    }
    let active: Vec<_> = downloads
        .borrow()
        .iter()
        .filter(|(_, entry)| !entry.lifecycle.pending())
        .map(|(id, _)| id.clone())
        .collect();
    for id in active {
        sample(downloads, &id);
    }
}

pub(super) fn cancel_view(downloads: &Downloads, view: &View, pending_only: bool) {
    let ids: Vec<_> = downloads
        .borrow()
        .iter()
        .filter(|(_, entry)| {
            std::ptr::eq(entry.view.as_ref(), view) && (!pending_only || entry.lifecycle.pending())
        })
        .map(|(id, _)| id.clone())
        .collect();
    for id in ids {
        cancel_with_state(downloads, &id, if pending_only { "cancelled" } else { "failed" });
    }
}

pub(super) fn cancel_all(downloads: &Downloads) {
    settle_all(downloads, "cancelled");
}

pub(super) fn fail_all(downloads: &Downloads) {
    settle_all(downloads, "failed");
}

fn settle_all(downloads: &Downloads, state: &'static str) {
    let ids: Vec<_> = downloads.borrow().keys().cloned().collect();
    for id in ids {
        cancel_with_state(downloads, &id, state);
    }
}

pub(super) fn live(view: &Rc<View>) -> bool {
    !view.closed.get()
        && (!view.popup || view.announced.get())
        && !view.error.borrow().as_ref().is_some_and(|(code, _)| code == "runtime-crashed")
        && view.host.upgrade().is_some_and(|host| {
            host.borrow().views.get(&view.id).is_some_and(|current| Rc::ptr_eq(current, view))
        })
}

fn sampler(
    downloads: &Downloads,
    id: &str,
) -> EventClosure<Option<ICoreWebView2DownloadOperation>, Option<IUnknown>> {
    let weak = Rc::downgrade(downloads);
    let id = id.to_string();
    Box::new(move |_, _| {
        if let Some(downloads) = weak.upgrade() {
            sample(&downloads, &id);
        }
        Ok(())
    })
}

pub(super) unsafe fn starting(
    downloads: &Downloads,
    view: Rc<View>,
    args: &ICoreWebView2DownloadStartingEventArgs,
    operation: ICoreWebView2DownloadOperation,
    uri: &str,
) -> Result<()> {
    let unsupported = || {
        protocol::emit(json!({
            "event": "download", "viewId": view.id, "url": download::bounded_uri(uri),
            "reason": "unsupported"
        }))
    };
    if !live(&view) {
        return Ok(());
    }
    if !download::allowed_uri(uri) {
        unsupported();
        return Ok(());
    }
    tick(downloads);
    let capacity = {
        let entries = downloads.borrow();
        download::has_capacity(
            entries.values().filter(|entry| entry.lifecycle.pending()).count(),
            entries.len(),
        )
    };
    if !capacity {
        protocol::emit(json!({
            "event": "download", "viewId": view.id, "url": download::bounded_uri(uri),
            "reason": "limit"
        }));
        return Ok(());
    }
    let id = format!("{:?}", CoCreateGuid()?).to_ascii_lowercase();
    let mut path = PWSTR::null();
    args.ResultFilePath(&mut path)?;
    let filename = download::proposed_filename(&CoTaskMemPWSTR::from(path).to_string());
    let held = Held { args: args.clone(), deferral: Some(args.GetDeferral()?) };
    let mut entry = Transfer {
        lifecycle: Lifecycle::new(&view.id, Instant::now()),
        view: view.clone(),
        operation: operation.clone(),
        held: Some(held),
        bytes_token: None,
        state_token: None,
    };
    let subscribe = (|| {
        let mut token = 0;
        operation.add_BytesReceivedChanged(
            &BytesReceivedChangedEventHandler::create(sampler(downloads, &id)),
            &mut token,
        )?;
        entry.bytes_token = Some(token);
        operation.add_StateChanged(
            &StateChangedEventHandler::create(sampler(downloads, &id)),
            &mut token,
        )?;
        entry.state_token = Some(token);
        Ok::<_, windows::core::Error>(())
    })();
    downloads.borrow_mut().insert(id.clone(), entry);
    protocol::emit(json!({
        "event": "download", "viewId": view.id, "downloadId": id,
        "url": uri, "filename": filename
    }));
    if subscribe.is_err() {
        safe_error();
        cancel_with_state(downloads, &id, "failed");
    }
    Ok(())
}

pub(super) fn command(downloads: &Downloads, command: &Command) -> Result<()> {
    tick(downloads);
    let invalid = || windows::core::Error::from(E_INVALIDARG);
    let (Some(id), Some(owner), Some(action)) =
        (command.download_id.as_deref(), command.view_id.as_deref(), command.action.as_deref())
    else {
        return Err(invalid());
    };
    if command.op == "download-decide" {
        let valid = downloads.borrow().get(id).is_some_and(|entry| {
            entry.lifecycle.may_decide(owner, live(&entry.view), Instant::now())
        });
        if !valid {
            return Err(invalid());
        }
        if action == "cancel" && command.destination.is_none() {
            cancel_with_state(downloads, id, "cancelled");
            return Ok(());
        }
        if action != "approve" {
            return Err(invalid());
        }
        let destination =
            command.destination.as_deref().filter(|path| download::allowed_destination(path));
        let Some(destination) = destination else {
            cancel_with_state(downloads, id, "failed");
            return Err(invalid());
        };
        let held = {
            let mut entries = downloads.borrow_mut();
            let entry = entries.get_mut(id).ok_or_else(invalid)?;
            entry.lifecycle.deadline = None;
            entry.held.take().ok_or_else(invalid)?
        };
        if unsafe { held.approve(destination) }.is_err() {
            cancel_with_state(downloads, id, "failed");
            return Err(invalid());
        }
        sample(downloads, id);
        return Ok(());
    }
    if command.destination.is_some() {
        return Err(invalid());
    }
    let (operation, paused) = downloads
        .borrow()
        .get(id)
        .filter(|entry| entry.lifecycle.owner == owner)
        .map(|entry| (entry.operation.clone(), entry.lifecycle.explicitly_paused))
        .ok_or_else(invalid)?;
    if action == "cancel" {
        cancel_with_state(downloads, id, "cancelled");
        return Ok(());
    }
    let progress = unsafe { read_progress(&operation, paused) }?;
    if !downloads
        .borrow()
        .get(id)
        .is_some_and(|entry| entry.lifecycle.may_action(owner, action, progress))
    {
        return Err(invalid());
    }
    let result = match action {
        "pause" => {
            downloads.borrow_mut().get_mut(id).unwrap().lifecycle.explicitly_paused = true;
            unsafe { operation.Pause() }
        }
        "resume" => {
            downloads.borrow_mut().get_mut(id).unwrap().lifecycle.resuming = true;
            unsafe { operation.Resume() }
        }
        _ => return Err(invalid()),
    };
    if result.is_err() {
        cancel_with_state(downloads, id, "failed");
        return Err(invalid());
    }
    sample(downloads, id);
    Ok(())
}
