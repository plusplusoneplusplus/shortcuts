use crate::history::HistoryNavigation;
use crate::overlay::{self, Frame, PanelMode, Placement};
use crate::protocol::{self, Command};
use crate::{profile, protocol::availability};
use block2::RcBlock;
use dispatch2::DispatchQueue;
use objc2::rc::Retained;
use objc2::runtime::{AnyObject, ProtocolObject};
use objc2::{define_class, msg_send, DefinedClass, MainThreadMarker, MainThreadOnly, Message};
use objc2_app_kit::{
    NSApplication, NSApplicationActivationPolicy,
    NSApplicationDidChangeScreenParametersNotification, NSAutoresizingMaskOptions,
    NSBackingStoreType, NSEvent, NSEventType, NSPanel, NSResponder, NSScreen, NSWindow,
    NSWindowCollectionBehavior, NSWindowNumberListOptions, NSWindowOrderingMode, NSWindowStyleMask,
    NSWorkspace, NSWorkspaceActiveSpaceDidChangeNotification,
    NSWorkspaceDidActivateApplicationNotification,
};
use objc2_foundation::{
    NSDictionary, NSError, NSKeyValueChangeKey, NSKeyValueObservingOptions, NSNotificationCenter,
    NSObject, NSObjectNSKeyValueObserverRegistration, NSObjectProtocol, NSOperationQueue, NSPoint,
    NSProcessInfo, NSRect, NSSize, NSString, NSURLRequest, NSURL, NSUUID,
};
use objc2_web_kit::{
    WKNavigation, WKNavigationAction, WKNavigationActionPolicy, WKNavigationDelegate, WKWebView,
    WKWebViewConfiguration, WKWebsiteDataStore,
};
use serde_json::json;
use std::cell::{Cell, OnceCell, RefCell};
use std::collections::HashMap;
use std::ffi::c_void;
use std::io;
use std::path::PathBuf;
use std::rc::Rc;

pub type HostResult<T> = Result<T, Box<dyn std::error::Error>>;

pub fn macos_major() -> u64 {
    NSProcessInfo::processInfo().operatingSystemVersion().majorVersion.max(0) as u64
}

pub fn run() -> HostResult<()> {
    if std::env::args().any(|arg| arg == "--check") {
        protocol::emit(availability(Some(macos_major())));
        return Ok(());
    }
    let check = availability(Some(macos_major()));
    if check["available"] != true {
        protocol::failure(0, "native-unavailable", check["message"].as_str().unwrap_or_default());
        return Ok(());
    }
    let profile_dir = PathBuf::from(std::env::args().nth(1).ok_or("Missing profile directory")?);
    let _lock = match profile::lock(&profile_dir) {
        Ok(lock) => lock,
        Err(error) => {
            protocol::failure(
                0,
                "profile-locked",
                format!("Close the other desktop process using this browser profile, then retry: {error}"),
            );
            return Ok(());
        }
    };
    let data_store =
        profile::data_store_id(&profile_dir, || NSUUID::UUID().UUIDString().to_string())?;
    let mtm = MainThreadMarker::new().ok_or("WKWebView host must start on the main thread")?;
    DATA_STORE.with(|cell| cell.set(data_store)).map_err(|_| "data store already set")?;
    let app = NSApplication::sharedApplication(mtm);
    // An accessory app has no Dock icon or menu bar and never activates on its own.
    app.setActivationPolicy(NSApplicationActivationPolicy::Accessory);
    std::thread::spawn(|| {
        let mut input = io::stdin().lock();
        loop {
            match protocol::read_command(&mut input) {
                Ok(Some(Ok(command))) => {
                    DispatchQueue::main().exec_async(move || dispatch(command))
                }
                Ok(Some(Err(message))) => protocol::failure(0, "invalid", message),
                Ok(None) => break,
                Err(error) => {
                    eprintln!("Browser command input failed: {error}");
                    break;
                }
            }
        }
        // The desktop closed stdin: stop on the main thread like an explicit quit.
        DispatchQueue::main().exec_async(|| std::process::exit(0));
    });
    let _observers = observe_window_environment();
    protocol::emit(json!({ "event": "ready" }));
    app.run();
    Ok(())
}

#[derive(Default)]
struct PanelIvars {
    /// Set by an explicit `focus` or a real user click; cleared when the panel loses key
    /// status or leaves the screen, so ordering a panel in never takes keyboard focus.
    key_allowed: Cell<bool>,
}

define_class!(
    /// Borderless panels refuse key status by default; the browser needs it for typing
    /// after an explicit focus. It never becomes main, so it never activates the helper.
    #[unsafe(super(NSPanel, NSWindow, NSResponder, objc2_foundation::NSObject))]
    #[thread_kind = MainThreadOnly]
    #[name = "CocBrowserPanel"]
    #[ivars = PanelIvars]
    struct BrowserPanel;

    impl BrowserPanel {
        #[unsafe(method(canBecomeKeyWindow))]
        fn can_become_key_window(&self) -> bool {
            self.ivars().key_allowed.get()
        }

        #[unsafe(method(canBecomeMainWindow))]
        fn can_become_main_window(&self) -> bool {
            false
        }

        #[unsafe(method(sendEvent:))]
        fn send_event(&self, event: &NSEvent) {
            if matches!(
                event.r#type(),
                NSEventType::LeftMouseDown | NSEventType::RightMouseDown | NSEventType::OtherMouseDown
            ) {
                self.ivars().key_allowed.set(true);
            }
            unsafe { msg_send![super(self), sendEvent: event] }
        }

        #[unsafe(method(resignKeyWindow))]
        fn resign_key_window(&self) {
            self.ivars().key_allowed.set(false);
            unsafe { msg_send![super(self), resignKeyWindow] }
        }
    }
);

/// Web view properties whose changes refresh the state main renders.
const OBSERVED_KEYS: [&str; 5] = ["URL", "title", "canGoBack", "canGoForward", "loading"];

struct DelegateIvars {
    view_id: String,
}

define_class!(
    /// Navigation delegate and KVO observer for one view. It holds only the view id and
    /// resolves the view per callback, so a closed view's late callbacks are dropped.
    #[unsafe(super(NSObject))]
    #[thread_kind = MainThreadOnly]
    #[name = "CocBrowserNavigationDelegate"]
    #[ivars = DelegateIvars]
    struct NavigationDelegate;

    unsafe impl NSObjectProtocol for NavigationDelegate {}

    unsafe impl WKNavigationDelegate for NavigationDelegate {
        #[unsafe(method(webView:decidePolicyForNavigationAction:decisionHandler:))]
        fn decide_policy(
            &self,
            _web_view: &WKWebView,
            action: &WKNavigationAction,
            handler: &block2::DynBlock<dyn Fn(WKNavigationActionPolicy)>,
        ) {
            // Main-frame documents stay HTTP(S); subframes may use about:/data: documents.
            let main_frame = unsafe { action.targetFrame() }.is_some_and(|frame| unsafe { frame.isMainFrame() });
            let url = url_string(unsafe { action.request() }.URL().as_deref());
            let allowed = !main_frame || protocol::allowed_url(&url, true);
            handler.call((if allowed { WKNavigationActionPolicy::Allow } else { WKNavigationActionPolicy::Cancel },));
        }

        #[unsafe(method(webView:didStartProvisionalNavigation:))]
        fn did_start(&self, _web_view: &WKWebView, navigation: Option<&WKNavigation>) {
            self.with_view(|view| view.started(navigation));
        }

        #[unsafe(method(webView:didReceiveServerRedirectForProvisionalNavigation:))]
        fn did_redirect(&self, _web_view: &WKWebView, navigation: Option<&WKNavigation>) {
            self.with_view(|view| view.started(navigation));
        }

        #[unsafe(method(webView:didCommitNavigation:))]
        fn did_commit(&self, _web_view: &WKWebView, _navigation: Option<&WKNavigation>) {
            self.with_view(|view| {
                view.history.borrow_mut().source_changed(true);
                view.push();
            });
        }

        #[unsafe(method(webView:didFinishNavigation:))]
        fn did_finish(&self, _web_view: &WKWebView, navigation: Option<&WKNavigation>) {
            self.with_view(|view| view.completed(navigation, None));
        }

        #[unsafe(method(webView:didFailProvisionalNavigation:withError:))]
        fn did_fail_provisional(&self, _web_view: &WKWebView, navigation: Option<&WKNavigation>, error: &NSError) {
            self.with_view(|view| view.completed(navigation, Some(error)));
        }

        #[unsafe(method(webView:didFailNavigation:withError:))]
        fn did_fail(&self, _web_view: &WKWebView, navigation: Option<&WKNavigation>, error: &NSError) {
            self.with_view(|view| view.completed(navigation, Some(error)));
        }

        #[unsafe(method(webViewWebContentProcessDidTerminate:))]
        fn did_terminate(&self, _web_view: &WKWebView) {
            self.with_view(|view| view.fail("runtime-crashed", "Browser page crashed. Reload to recover."));
        }
    }

    impl NavigationDelegate {
        #[unsafe(method(observeValueForKeyPath:ofObject:change:context:))]
        fn observe_value(
            &self,
            key_path: Option<&NSString>,
            _object: Option<&AnyObject>,
            _change: Option<&NSDictionary<NSKeyValueChangeKey, AnyObject>>,
            _context: *mut c_void,
        ) {
            let key = key_path.map(|key| key.to_string()).unwrap_or_default();
            self.with_view(|view| view.observed(&key));
        }
    }
);

impl NavigationDelegate {
    fn new(view_id: &str, mtm: MainThreadMarker) -> Retained<Self> {
        let this = Self::alloc(mtm).set_ivars(DelegateIvars { view_id: view_id.to_string() });
        unsafe { msg_send![super(this), init] }
    }

    fn with_view(&self, action: impl FnOnce(&View)) {
        let view = VIEWS.with(|views| views.borrow().get(&self.ivars().view_id).cloned());
        if let Some(view) = view.filter(|view| !view.closed.get()) {
            action(&view);
        }
    }
}

fn url_string(url: Option<&NSURL>) -> String {
    url.and_then(|url| url.absoluteString()).map(|url| url.to_string()).unwrap_or_default()
}

struct View {
    id: String,
    panel: Retained<BrowserPanel>,
    webview: Retained<WKWebView>,
    delegate: Retained<NavigationDelegate>,
    parent_window: Cell<Option<isize>>,
    placement: Cell<Placement>,
    mode: Cell<PanelMode>,
    closed: Cell<bool>,
    history: RefCell<HistoryNavigation>,
    /// WKNavigation objects in flight, mapped to the ids HistoryNavigation tracks.
    navigations: RefCell<Vec<(Retained<WKNavigation>, u64)>>,
    next_navigation: Cell<u64>,
    /// Last URL main or the page asked for; shown while the document is failed.
    requested: RefCell<String>,
    error: RefCell<Option<(String, String)>>,
    /// Last state sent to main; KVO and delegate callbacks often repeat it.
    pushed: RefCell<Option<serde_json::Value>>,
}

thread_local! {
    static DATA_STORE: OnceCell<String> = const { OnceCell::new() };
    static VIEWS: RefCell<HashMap<String, Rc<View>>> = RefCell::new(HashMap::new());
}

fn main_thread() -> MainThreadMarker {
    MainThreadMarker::new().expect("browser commands run on the main thread")
}

fn primary_height(mtm: MainThreadMarker) -> f64 {
    NSScreen::screens(mtm).firstObject().map_or(0.0, |screen| screen.frame().size.height)
}

/// Window numbers AppKit lists are the visible windows of all apps on the active Space,
/// so a minimized, hidden or other-Space parent is absent.
fn parent_on_active_space(window: isize, mtm: MainThreadMarker) -> bool {
    NSWindow::windowNumbersWithOptions(NSWindowNumberListOptions::AllApplications, mtm)
        .is_some_and(|numbers| numbers.iter().any(|number| number.integerValue() == window))
}

fn ns_rect(frame: Frame) -> NSRect {
    NSRect::new(NSPoint::new(frame.x, frame.y), NSSize::new(frame.width, frame.height))
}

fn frame_of(rect: NSRect) -> Frame {
    Frame { x: rect.origin.x, y: rect.origin.y, width: rect.size.width, height: rect.size.height }
}

impl View {
    fn apply(&self, mtm: MainThreadMarker) {
        let mut placement = self.placement.get();
        placement.parent_on_active_space =
            self.parent_window.get().is_none_or(|window| parent_on_active_space(window, mtm));
        let mode = overlay::panel_mode(&placement, primary_height(mtm));
        match mode {
            PanelMode::Shown(frame) => {
                placement.last_size = Some((frame.width, frame.height));
                self.panel.setFrame_display(ns_rect(frame), true);
                // Ordering relative to the parent keeps other apps' windows above both.
                match self.parent_window.get() {
                    Some(parent) => {
                        self.panel.orderWindow_relativeTo(NSWindowOrderingMode::Above, parent)
                    }
                    None => self.panel.orderFrontRegardless(),
                }
            }
            PanelMode::Background(frame) => {
                // An off-screen panel must never keep keyboard focus.
                if self.panel.isKeyWindow() {
                    self.panel.orderOut(None);
                }
                self.panel.setFrame_display(ns_rect(frame), true);
                if !self.panel.isVisible() {
                    self.panel.orderWindow_relativeTo(NSWindowOrderingMode::Below, 0);
                }
            }
            PanelMode::Hidden => self.panel.orderOut(None),
        }
        if !matches!(mode, PanelMode::Shown(_)) {
            self.panel.ivars().key_allowed.set(false);
        }
        self.placement.set(placement);
        self.mode.set(mode);
    }

    fn state(&self, mtm: MainThreadMarker) -> serde_json::Value {
        let frame = overlay::from_appkit(&frame_of(self.panel.frame()), primary_height(mtm));
        json!({
            "mode": self.mode.get().name(),
            "visible": self.panel.isVisible(),
            "key": self.panel.isKeyWindow(),
            "frame": { "x": frame.x, "y": frame.y, "width": frame.width, "height": frame.height },
            "windowNumber": self.panel.windowNumber(),
            "parentOnActiveSpace": self.placement.get().parent_on_active_space,
        })
    }

    fn close(&self) {
        if self.closed.replace(true) {
            return;
        }
        unsafe {
            self.webview.setNavigationDelegate(None);
            for key in OBSERVED_KEYS {
                self.webview.removeObserver_forKeyPath(&self.delegate, &NSString::from_str(key));
            }
            self.webview.stopLoading();
        }
        self.panel.orderOut(None);
        self.panel.close();
    }

    fn navigation_id(&self, navigation: Option<&WKNavigation>) -> u64 {
        let mut navigations = self.navigations.borrow_mut();
        if let Some(navigation) = navigation {
            if let Some((_, id)) =
                navigations.iter().find(|(known, _)| std::ptr::eq(&**known, navigation))
            {
                return *id;
            }
        }
        let id = self.next_navigation.get() + 1;
        self.next_navigation.set(id);
        if let Some(navigation) = navigation {
            // Superseded navigations may never complete; keep the list bounded.
            if navigations.len() >= 16 {
                navigations.remove(0);
            }
            navigations.push((navigation.retain(), id));
        }
        id
    }

    fn started(&self, navigation: Option<&WKNavigation>) {
        let id = self.navigation_id(navigation);
        self.history.borrow_mut().started(id);
        let url = url_string(unsafe { self.webview.URL() }.as_deref());
        if protocol::allowed_url(&url, true) {
            *self.requested.borrow_mut() = url;
        }
        *self.error.borrow_mut() = None;
        self.push();
    }

    fn completed(&self, navigation: Option<&WKNavigation>, error: Option<&NSError>) {
        let Some(navigation) = navigation else {
            self.push();
            return;
        };
        let id = {
            let mut navigations = self.navigations.borrow_mut();
            let Some(index) =
                navigations.iter().position(|(known, _)| std::ptr::eq(&**known, navigation))
            else {
                drop(navigations);
                self.push();
                return;
            };
            navigations.remove(index).1
        };
        let visit = self.history.borrow_mut().completed(id, error.is_none());
        let Some(visit) = visit else {
            self.push();
            return;
        };
        if let Some(error) = error {
            let message = protocol::navigation_error(
                &error.domain().to_string(),
                error.code() as i64,
                &error.localizedDescription().to_string(),
            );
            if let Some(message) = message {
                *self.error.borrow_mut() = Some(("navigation-failed".into(), message));
            }
        }
        if visit {
            self.push_history(true);
        }
        self.push();
    }

    fn observed(&self, key: &str) {
        match key {
            // Fragment, pushState and same-document back/forward have no delegate callbacks.
            "URL"
                if self.navigations.borrow().is_empty() && !unsafe { self.webview.isLoading() } =>
            {
                if self.history.borrow_mut().source_changed(false) {
                    self.push_history(true);
                }
            }
            "title" if self.history.borrow().title_changed() => self.push_history(false),
            _ => {}
        }
        self.push();
    }

    /// Records a request before WebKit reports the provisional navigation.
    fn navigate(&self, action: impl FnOnce() -> bool) {
        self.history.borrow_mut().requested();
        if !action() {
            self.history.borrow_mut().invalidate();
        }
        self.push();
    }

    fn load(&self, url: &str) -> bool {
        let Some(request) = NSURL::URLWithString(&NSString::from_str(url))
            .map(|url| NSURLRequest::requestWithURL(&url))
        else {
            return false;
        };
        *self.requested.borrow_mut() = url.to_string();
        *self.error.borrow_mut() = None;
        unsafe { self.webview.loadRequest(&request) }.is_some()
    }

    fn snapshot(&self) -> serde_json::Value {
        let url = url_string(unsafe { self.webview.URL() }.as_deref());
        let title =
            unsafe { self.webview.title() }.map(|title| title.to_string()).unwrap_or_default();
        let error = self.error.borrow();
        let mut state = json!({
            "viewId": self.id, "engine": "wkwebview",
            "url": if error.is_some() || !protocol::allowed_url(&url, false) { self.requested.borrow().clone() } else { url },
            "title": if error.is_some() { String::new() } else { protocol::wire_title(&title) },
            "canGoBack": unsafe { self.webview.canGoBack() },
            "canGoForward": unsafe { self.webview.canGoForward() },
            "loading": self.history.borrow().loading(),
        });
        if let Some((code, message)) = error.as_ref() {
            state["errorCode"] = json!(code);
            state["error"] = json!(message);
        }
        state
    }

    fn push(&self) {
        if self.closed.get() {
            return;
        }
        let state = self.snapshot();
        if self.pushed.borrow().as_ref() != Some(&state) {
            protocol::emit(json!({ "event": "state", "viewId": self.id, "state": state.clone() }));
            *self.pushed.borrow_mut() = Some(state);
        }
    }

    fn push_history(&self, visit: bool) {
        let url = url_string(unsafe { self.webview.URL() }.as_deref());
        let title =
            unsafe { self.webview.title() }.map(|title| title.to_string()).unwrap_or_default();
        if let Some(message) = protocol::history_message(&self.id, &self.id, &url, &title, visit) {
            protocol::emit(message);
        }
    }

    fn fail(&self, code: &str, message: &str) {
        self.history.borrow_mut().invalidate();
        self.navigations.borrow_mut().clear();
        *self.error.borrow_mut() = Some((code.to_string(), message.to_string()));
        let state = json!({
            "viewId": self.id, "engine": "wkwebview", "url": self.requested.borrow().clone(), "title": "",
            "canGoBack": false, "canGoForward": false, "loading": false, "error": message, "errorCode": code
        });
        protocol::emit(json!({ "event": "state", "viewId": self.id, "state": state.clone() }));
        *self.pushed.borrow_mut() = Some(state);
    }
}

fn reapply_all() {
    let mtm = main_thread();
    let views: Vec<_> = VIEWS.with(|views| views.borrow().values().cloned().collect());
    for view in views {
        view.apply(mtm);
    }
}

/// Space switches, app activation (which can raise the parent above its panel) and
/// display changes all re-place every panel against its parent.
fn observe_window_environment() -> Vec<Retained<ProtocolObject<dyn NSObjectProtocol>>> {
    let block = RcBlock::new(|_| DispatchQueue::main().exec_async(reapply_all));
    let workspace = NSWorkspace::sharedWorkspace().notificationCenter();
    let default = NSNotificationCenter::defaultCenter();
    let queue = NSOperationQueue::mainQueue();
    unsafe {
        [
            (&workspace, NSWorkspaceActiveSpaceDidChangeNotification),
            (&workspace, NSWorkspaceDidActivateApplicationNotification),
            (&default, NSApplicationDidChangeScreenParametersNotification),
        ]
        .into_iter()
        .map(|(center, name)| {
            center.addObserverForName_object_queue_usingBlock(
                Some(name),
                None,
                Some(&queue),
                &block,
            )
        })
        .collect()
    }
}

fn parent_window(command: &Command) -> Result<Option<isize>, &'static str> {
    match command.parent_window {
        None => Ok(None),
        Some(window) if window > 0 => {
            isize::try_from(window).map(Some).map_err(|_| "Invalid parent window.")
        }
        Some(_) => Err("Invalid parent window."),
    }
}

fn checked_bounds(command: &Command) -> Result<Option<protocol::Bounds>, &'static str> {
    match command.bounds {
        Some(bounds) if !overlay::valid_bounds(&bounds) => Err("Invalid browser view bounds."),
        bounds => Ok(bounds),
    }
}

fn open(command: &Command, mtm: MainThreadMarker) -> Result<(), &'static str> {
    let id = command.view_id.as_deref().filter(|id| protocol::allowed_view_id(id));
    let url = command.url.as_deref().filter(|url| protocol::allowed_url(url, true));
    let (Some(id), Some(url)) = (id, url) else {
        return Err("A browser view id and HTTP(S) URL are required.");
    };
    if VIEWS.with(|views| views.borrow().contains_key(id)) {
        return Err("Browser view already exists.");
    }
    let parent = parent_window(command)?;
    let bounds = checked_bounds(command)?;
    let store_id =
        DATA_STORE.with(|cell| cell.get().cloned()).ok_or("Browser profile unavailable.")?;
    let uuid = NSUUID::from_string(&NSString::from_str(&store_id))
        .ok_or("Browser profile unavailable.")?;
    let zoom = match command.page_zoom_percent {
        Some(percent) if !protocol::allowed_page_zoom(percent) => return Err("Invalid page zoom."),
        percent => percent.unwrap_or(100.0),
    };
    let rect = NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(1024.0, 768.0));
    let panel: Retained<BrowserPanel> = unsafe {
        msg_send![
            super(BrowserPanel::alloc(mtm).set_ivars(PanelIvars::default())),
            initWithContentRect: rect,
            styleMask: NSWindowStyleMask::Borderless | NSWindowStyleMask::NonactivatingPanel,
            backing: NSBackingStoreType::Buffered,
            defer: false,
        ]
    };
    let webview = unsafe {
        let configuration = WKWebViewConfiguration::new(mtm);
        configuration.setWebsiteDataStore(&WKWebsiteDataStore::dataStoreForIdentifier(&uuid, mtm));
        WKWebView::initWithFrame_configuration(WKWebView::alloc(mtm), rect, &configuration)
    };
    unsafe { panel.setReleasedWhenClosed(false) };
    // Panels hide when their app deactivates; this helper is never the active app.
    panel.setHidesOnDeactivate(false);
    panel.setHasShadow(false);
    panel.setCollectionBehavior(
        NSWindowCollectionBehavior::CanJoinAllSpaces
            | NSWindowCollectionBehavior::FullScreenAuxiliary
            | NSWindowCollectionBehavior::IgnoresCycle
            | NSWindowCollectionBehavior::Transient,
    );
    webview.setAutoresizingMask(
        NSAutoresizingMaskOptions::ViewWidthSizable | NSAutoresizingMaskOptions::ViewHeightSizable,
    );
    panel.setContentView(Some(&webview));
    let delegate = NavigationDelegate::new(id, mtm);
    let view = Rc::new(View {
        id: id.to_string(),
        panel,
        webview,
        delegate,
        parent_window: Cell::new(parent),
        placement: Cell::new(Placement {
            bounds,
            parent_shown: command.visible.unwrap_or(false),
            ..Placement::default()
        }),
        mode: Cell::new(PanelMode::Hidden),
        closed: Cell::new(false),
        history: RefCell::new(HistoryNavigation::default()),
        navigations: RefCell::new(Vec::new()),
        next_navigation: Cell::new(0),
        requested: RefCell::new(url.to_string()),
        error: RefCell::new(None),
        pushed: RefCell::new(None),
    });
    VIEWS.with(|views| views.borrow_mut().insert(id.to_string(), view.clone()));
    unsafe {
        view.webview.setPageZoom(zoom / 100.0);
        view.webview.setNavigationDelegate(Some(ProtocolObject::from_ref(&*view.delegate)));
        for key in OBSERVED_KEYS {
            view.webview.addObserver_forKeyPath_options_context(
                &view.delegate,
                &NSString::from_str(key),
                NSKeyValueObservingOptions::empty(),
                std::ptr::null_mut(),
            );
        }
    }
    view.apply(mtm);
    view.navigate(|| view.load(url));
    Ok(())
}

fn view_command(
    view: &View,
    command: &Command,
    mtm: MainThreadMarker,
) -> Result<Option<serde_json::Value>, &'static str> {
    match command.op.as_str() {
        "bounds" => {
            let bounds = checked_bounds(command)?;
            view.placement.set(Placement { bounds, ..view.placement.get() });
        }
        "parent" => {
            let visible = command.visible.ok_or("Parent visibility is required.")?;
            if command.parent_window.is_some() {
                view.parent_window.set(parent_window(command)?);
            }
            view.placement.set(Placement { parent_shown: visible, ..view.placement.get() });
        }
        "background" => {
            let enabled = command.enabled.ok_or("Background state is required.")?;
            view.placement.set(Placement { background: enabled, ..view.placement.get() });
        }
        "focus" => {
            view.apply(mtm);
            if !matches!(view.mode.get(), PanelMode::Shown(_)) {
                return Err("Browser view is not visible.");
            }
            // Explicit focus is the only path that activates the helper and makes the
            // panel key; background work never calls it.
            view.panel.ivars().key_allowed.set(true);
            NSApplication::sharedApplication(mtm).activate();
            view.panel.makeKeyAndOrderFront(None);
            view.panel.makeFirstResponder(Some(&view.webview));
            return Ok(None);
        }
        "view-state" => {
            view.apply(mtm);
            let mut state = view.state(mtm);
            state["page"] = view.snapshot();
            return Ok(Some(state));
        }
        "navigate" => {
            let url = command
                .url
                .as_deref()
                .filter(|url| protocol::allowed_url(url, false))
                .ok_or("An HTTP(S) URL is required.")?;
            view.navigate(|| view.load(url));
            return Ok(None);
        }
        "nav" => {
            let webview = &view.webview;
            match command.action.as_deref() {
                Some("back") if unsafe { webview.canGoBack() } => {
                    view.navigate(|| unsafe { webview.goBack() }.is_some())
                }
                Some("forward") if unsafe { webview.canGoForward() } => {
                    view.navigate(|| unsafe { webview.goForward() }.is_some())
                }
                Some("back" | "forward") => {}
                Some("stop") => {
                    view.history.borrow_mut().stop();
                    view.navigations.borrow_mut().clear();
                    unsafe { webview.stopLoading() };
                    view.push();
                }
                Some("reload") => {
                    // A failed or crashed document reloads the URL main last asked for.
                    if view.error.borrow().is_some() {
                        let url = view.requested.borrow().clone();
                        view.navigate(|| view.load(&url));
                    } else {
                        view.navigate(|| unsafe { webview.reload() }.is_some());
                    }
                }
                _ => return Err("Unsupported navigation action."),
            }
            return Ok(None);
        }
        "page-zoom" => {
            let percent = command
                .page_zoom_percent
                .filter(|percent| protocol::allowed_page_zoom(*percent))
                .ok_or("Invalid page zoom.")?;
            unsafe { view.webview.setPageZoom(percent / 100.0) };
            return Ok(None);
        }
        _ => return Err("Unsupported WKWebView command."),
    }
    view.apply(mtm);
    Ok(None)
}

fn dispatch(command: Command) {
    if protocol::output_failed() {
        std::process::exit(1);
    }
    match command.op.as_str() {
        "quit" => {
            protocol::success(command.id);
            std::process::exit(0);
        }
        "open" => match open(&command, main_thread()) {
            Ok(()) => protocol::success(command.id),
            Err(message) => protocol::failure(command.id, "invalid", message),
        },
        "close" => {
            let id = command.view_id.as_deref().unwrap_or_default();
            if let Some(view) = VIEWS.with(|views| views.borrow_mut().remove(id)) {
                view.close();
            }
            protocol::success(command.id);
        }
        _ => {
            let id = command.view_id.as_deref().unwrap_or_default();
            let Some(view) = VIEWS.with(|views| views.borrow().get(id).cloned()) else {
                protocol::failure(command.id, "not-found", "Browser view not found.");
                return;
            };
            match view_command(&view, &command, main_thread()) {
                Ok(result) => protocol::reply(command.id, result),
                Err(message) => protocol::failure(command.id, "invalid", message),
            }
        }
    }
}
