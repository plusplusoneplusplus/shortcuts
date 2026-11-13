//! WKDownload transfers. A download waits in WebKit's destination callback until main
//! answers with a path from its own Save dialog; the page never picks the destination.
use super::*;
use crate::download::{self, Lifecycle, NativeState, Progress};
use dispatch2::DispatchTime;
use objc2_foundation::{NSData, NSProgressReporting, NSURLResponse};
use objc2_web_kit::{WKDownload, WKDownloadDelegate};
use std::time::{Duration, Instant};

const TICK: Duration = Duration::from_millis(250);

struct DownloadIvars {
    id: String,
}

define_class!(
    /// Delegate for one download; holds only the id, so late callbacks for a retired
    /// download are dropped.
    #[unsafe(super(NSObject))]
    #[thread_kind = MainThreadOnly]
    #[name = "CocBrowserDownloadDelegate"]
    #[ivars = DownloadIvars]
    struct DownloadDelegate;

    unsafe impl NSObjectProtocol for DownloadDelegate {}

    unsafe impl WKDownloadDelegate for DownloadDelegate {
        #[unsafe(method(download:decideDestinationUsingResponse:suggestedFilename:completionHandler:))]
        fn decide_destination(
            &self,
            _download: &WKDownload,
            _response: &NSURLResponse,
            filename: &NSString,
            handler: &block2::DynBlock<dyn Fn(*mut NSURL)>,
        ) {
            destination_requested(&self.ivars().id, &filename.to_string(), handler);
        }

        #[unsafe(method(downloadDidFinish:))]
        fn did_finish(&self, _download: &WKDownload) {
            finished(&self.ivars().id, None);
        }

        #[unsafe(method(download:didFailWithError:resumeData:))]
        fn did_fail(&self, _download: &WKDownload, error: &NSError, _resume: Option<&NSData>) {
            finished(&self.ivars().id, Some(error));
        }
    }
);

impl DownloadDelegate {
    fn new(id: &str, mtm: MainThreadMarker) -> Retained<Self> {
        let this = Self::alloc(mtm).set_ivars(DownloadIvars { id: id.to_string() });
        unsafe { msg_send![super(this), init] }
    }
}

struct Transfer {
    download: Retained<WKDownload>,
    /// WKDownload holds its delegate weakly.
    _delegate: Retained<DownloadDelegate>,
    url: String,
    /// WebKit's destination callback while main asks the user where to save.
    held: Option<RcBlock<dyn Fn(*mut NSURL)>>,
    lifecycle: Lifecycle,
    destination: Option<String>,
    last: Option<Progress>,
}

thread_local! {
    static DOWNLOADS: RefCell<HashMap<String, Transfer>> = RefCell::new(HashMap::new());
    static TICKING: Cell<bool> = const { Cell::new(false) };
}

fn emit_progress(id: &str, owner: &str, progress: Progress) {
    protocol::emit(json!({
        "event": "download-progress", "viewId": owner, "downloadId": id,
        "state": progress.state, "received": progress.received, "total": progress.total,
        "canPause": progress.can_pause, "canResume": progress.can_resume, "final": progress.final_state
    }));
}

/// A view that can still own a new download: open, current and not crashed.
fn live(owner: &str) -> bool {
    VIEWS.with(|views| {
        views.borrow().get(owner).is_some_and(|view| {
            !view.closed.get()
                && !view.error.borrow().as_ref().is_some_and(|(code, _)| code == "runtime-crashed")
        })
    })
}

/// WKDownload has no pause; a transfer runs until it finishes, fails or is cancelled.
fn sample(download: &WKDownload, native: NativeState) -> Progress {
    let progress = download.progress();
    let mut progress = Progress::sample(
        native,
        progress.completedUnitCount(),
        progress.totalUnitCount(),
        false,
        false,
    );
    progress.can_pause = false;
    progress
}

/// Removes the download before calling WebKit, which can call back synchronously.
fn retire(id: &str, mut progress: Progress, cancel: bool) {
    let Some(mut entry) = DOWNLOADS.with(|downloads| downloads.borrow_mut().remove(id)) else {
        return;
    };
    if let Some(held) = entry.held.take() {
        held.call((std::ptr::null_mut(),));
    } else if cancel {
        unsafe { entry.download.cancel(None) };
    }
    progress.can_pause = false;
    progress.can_resume = false;
    emit_progress(id, &entry.lifecycle.owner, progress);
}

fn cancel_with_state(id: &str, state: &'static str) {
    let progress = DOWNLOADS.with(|downloads| {
        downloads.borrow().get(id).map(|entry| sample(&entry.download, NativeState::Failed))
    });
    if let Some(mut progress) = progress {
        progress.state = state;
        progress.final_state = true;
        retire(id, progress, true);
    }
}

fn schedule_tick() {
    if TICKING.with(|ticking| ticking.replace(true)) {
        return;
    }
    let when = DispatchTime::try_from(TICK).unwrap_or(DispatchTime::NOW);
    let _ = DispatchQueue::main().after(when, || {
        TICKING.with(|ticking| ticking.set(false));
        tick();
    });
}

/// Expires unanswered approvals and reports running transfers' progress when it changes.
fn tick() {
    let now = Instant::now();
    let (expired, active): (Vec<_>, Vec<_>) = DOWNLOADS.with(|downloads| {
        let downloads = downloads.borrow();
        (
            downloads
                .iter()
                .filter(|(_, entry)| entry.lifecycle.expired(now))
                .map(|(id, _)| id.clone())
                .collect(),
            downloads
                .iter()
                .filter(|(_, entry)| !entry.lifecycle.pending())
                .map(|(id, _)| id.clone())
                .collect(),
        )
    });
    for id in expired {
        cancel_with_state(&id, "cancelled");
    }
    for id in active {
        let changed = DOWNLOADS.with(|downloads| {
            let mut downloads = downloads.borrow_mut();
            let entry = downloads.get_mut(&id)?;
            let progress = sample(&entry.download, NativeState::InProgress);
            (entry.last != Some(progress)).then(|| {
                entry.last = Some(progress);
                (entry.lifecycle.owner.clone(), progress)
            })
        });
        if let Some((owner, progress)) = changed {
            emit_progress(&id, &owner, progress);
        }
    }
    if DOWNLOADS.with(|downloads| !downloads.borrow().is_empty()) {
        schedule_tick();
    }
}

/// A navigation became a download: admit it or tell main why it was refused.
pub(super) fn begin(view: &View, download: &WKDownload, mtm: MainThreadMarker) {
    let url = unsafe { download.originalRequest() }
        .and_then(|request| request.URL())
        .map(|url| url_string(Some(&url)))
        .unwrap_or_default();
    let refuse = |reason: &str| {
        unsafe { download.cancel(None) };
        protocol::emit(json!({
            "event": "download", "viewId": view.id, "url": download::bounded_uri(&url),
            "reason": reason
        }));
    };
    if !live(&view.id) {
        unsafe { download.cancel(None) };
        return;
    }
    if !download::allowed_uri(&url) {
        refuse("unsupported");
        return;
    }
    tick();
    let capacity = DOWNLOADS.with(|downloads| {
        let downloads = downloads.borrow();
        download::has_capacity(
            downloads.values().filter(|entry| entry.lifecycle.pending()).count(),
            downloads.len(),
        )
    });
    if !capacity {
        refuse("limit");
        return;
    }
    let id = NSUUID::UUID().UUIDString().to_string().to_ascii_lowercase();
    let delegate = DownloadDelegate::new(&id, mtm);
    unsafe { download.setDelegate(Some(ProtocolObject::from_ref(&*delegate))) };
    let entry = Transfer {
        download: download.retain(),
        _delegate: delegate,
        url,
        held: None,
        lifecycle: Lifecycle::new(&view.id, Instant::now()),
        destination: None,
        last: None,
    };
    DOWNLOADS.with(|downloads| downloads.borrow_mut().insert(id, entry));
    schedule_tick();
}

/// WebKit asks where to save: hold its callback and ask main for a destination.
fn destination_requested(id: &str, filename: &str, handler: &block2::DynBlock<dyn Fn(*mut NSURL)>) {
    let request = DOWNLOADS.with(|downloads| {
        let mut downloads = downloads.borrow_mut();
        let entry = downloads
            .get_mut(id)
            .filter(|entry| entry.held.is_none() && entry.lifecycle.pending())?;
        entry.held = Some(handler.copy());
        Some((entry.lifecycle.owner.clone(), entry.url.clone()))
    });
    let Some((owner, url)) = request else {
        handler.call((std::ptr::null_mut(),));
        return;
    };
    if !live(&owner) {
        cancel_with_state(id, "cancelled");
        return;
    }
    protocol::emit(json!({
        "event": "download", "viewId": owner, "downloadId": id,
        "url": url, "filename": download::proposed_filename(filename)
    }));
}

fn finished(id: &str, error: Option<&NSError>) {
    let result = DOWNLOADS.with(|downloads| {
        downloads.borrow().get(id).map(|entry| {
            let native = match error {
                None => NativeState::Completed,
                Some(error)
                    if error.domain().to_string() == "NSURLErrorDomain" && error.code() == -999 =>
                {
                    NativeState::Interrupted { user_cancelled: true, user_paused: false }
                }
                Some(_) => NativeState::Failed,
            };
            (sample(&entry.download, native), entry.destination.clone())
        })
    });
    let Some((mut progress, destination)) = result else { return };
    if progress.state == "completed" {
        // Report the saved size; the network counts can differ for encoded responses.
        match destination.and_then(|path| std::fs::metadata(path).ok()) {
            Some(metadata) => {
                let size = i64::try_from(metadata.len()).unwrap_or(i64::MAX);
                progress.received = size;
                progress.total = size;
            }
            None => progress.state = "failed",
        }
    }
    retire(id, progress, false);
}

/// Pending approvals end with their view (closed, crashed or navigating away);
/// approved transfers keep running like a browser's.
pub(super) fn cancel_view(owner: &str) {
    let ids: Vec<_> = DOWNLOADS.with(|downloads| {
        downloads
            .borrow()
            .iter()
            .filter(|(_, entry)| entry.lifecycle.owner == owner && entry.lifecycle.pending())
            .map(|(id, _)| id.clone())
            .collect()
    });
    for id in ids {
        cancel_with_state(&id, "cancelled");
    }
}

/// Main accepted the file once in its Save dialog; replacing an existing file is the
/// user's choice there. Anything but a regular file is never removed.
fn prepare_destination(path: &str) -> bool {
    match std::fs::symlink_metadata(path) {
        Ok(metadata) if metadata.is_file() => std::fs::remove_file(path).is_ok(),
        Ok(_) => false,
        Err(error) => error.kind() == std::io::ErrorKind::NotFound,
    }
}

pub(super) fn command(command: &Command) -> Result<(), &'static str> {
    tick();
    let (Some(id), Some(owner), Some(action)) =
        (command.download_id.as_deref(), command.view_id.as_deref(), command.action.as_deref())
    else {
        return Err("Download id, view id and action are required.");
    };
    if command.op == "download-decide" {
        let valid = DOWNLOADS.with(|downloads| {
            downloads
                .borrow()
                .get(id)
                .is_some_and(|entry| entry.lifecycle.may_decide(owner, live(owner), Instant::now()))
        });
        if !valid {
            return Err("Download is not waiting for a decision.");
        }
        if action == "cancel" && command.destination.is_none() {
            cancel_with_state(id, "cancelled");
            return Ok(());
        }
        if action != "approve" {
            return Err("Unknown download decision.");
        }
        let Some(destination) = command
            .destination
            .as_deref()
            .filter(|path| protocol::allowed_download_destination(path))
        else {
            cancel_with_state(id, "failed");
            return Err("Invalid download destination.");
        };
        let held = DOWNLOADS.with(|downloads| {
            let mut downloads = downloads.borrow_mut();
            let entry = downloads.get_mut(id)?;
            let held = entry.held.take()?;
            entry.lifecycle.deadline = None;
            entry.destination = Some(destination.to_string());
            Some(held)
        });
        let Some(held) = held else {
            return Err("Download is not waiting for a destination.");
        };
        if !prepare_destination(destination) {
            held.call((std::ptr::null_mut(),));
            cancel_with_state(id, "failed");
            return Err("The download destination could not be replaced.");
        }
        let url = NSURL::fileURLWithPath(&NSString::from_str(destination));
        held.call((Retained::as_ptr(&url) as *mut NSURL,));
        tick();
        return Ok(());
    }
    if command.destination.is_some() {
        return Err("Download actions take no destination.");
    }
    let owned = DOWNLOADS.with(|downloads| {
        downloads
            .borrow()
            .get(id)
            .is_some_and(|entry| entry.lifecycle.owner == owner && !entry.lifecycle.pending())
    });
    if !owned {
        return Err("Download not found.");
    }
    match action {
        "cancel" => {
            cancel_with_state(id, "cancelled");
            Ok(())
        }
        _ => Err("WebKit downloads can only be cancelled."),
    }
}
