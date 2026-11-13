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
    NSBackingStoreType, NSBitmapImageFileType, NSBitmapImageRep, NSDeviceRGBColorSpace, NSEvent,
    NSEventModifierFlags, NSEventType, NSFloatingWindowLevel, NSGraphicsContext, NSImage,
    NSImageCompressionFactor, NSNormalWindowLevel, NSPanel, NSResponder, NSScreen, NSWindow,
    NSWindowCollectionBehavior, NSWindowDelegate, NSWindowDidBecomeKeyNotification,
    NSWindowDidResignKeyNotification, NSWindowNumberListOptions, NSWindowOrderingMode,
    NSWindowStyleMask, NSWorkspace, NSWorkspaceActiveSpaceDidChangeNotification,
    NSWorkspaceDidActivateApplicationNotification,
};
use objc2_core_foundation::CGPoint;
use objc2_core_graphics::{CGEvent, CGScrollEventUnit};
use objc2_foundation::{
    NSDataBase64EncodingOptions, NSDictionary, NSError, NSKeyValueChangeKey,
    NSKeyValueObservingOptions, NSNotification, NSNotificationCenter, NSNumber, NSObject,
    NSObjectNSKeyValueObserverRegistration, NSObjectProtocol, NSOperationQueue, NSPoint,
    NSProcessInfo, NSRect, NSSize, NSString, NSURLRequest, NSURL, NSUUID,
};
use objc2_web_kit::{
    WKContentWorld, WKNavigation, WKNavigationAction, WKNavigationActionPolicy,
    WKNavigationDelegate, WKNavigationType, WKSnapshotConfiguration, WKUIDelegate, WKWebView,
    WKWebViewConfiguration, WKWebsiteDataStore, WKWindowFeatures,
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
    /// Background control: WebKit sees the panel as key (page focus, `document.hasFocus()`)
    /// while AppKit never makes it key, so it takes no keyboard focus from the user.
    focus_emulated: Cell<bool>,
    view_id: OnceCell<String>,
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

        #[unsafe(method(isKeyWindow))]
        fn is_key_window(&self) -> bool {
            self.ivars().focus_emulated.get() || unsafe { msg_send![super(self), isKeyWindow] }
        }

        #[unsafe(method(canBecomeMainWindow))]
        fn can_become_main_window(&self) -> bool {
            false
        }

        // Cmd chords reach the window before the web view; unmatched ones go to the page.
        #[unsafe(method(performKeyEquivalent:))]
        fn perform_key_equivalent(&self, event: &NSEvent) -> bool {
            self.key_event(event) || unsafe { msg_send![super(self), performKeyEquivalent: event] }
        }

        #[unsafe(method(sendEvent:))]
        fn send_event(&self, event: &NSEvent) {
            if self.key_event(event) {
                return;
            }
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

impl BrowserPanel {
    /// AppKit key status, ignoring focus emulation.
    fn really_key(&self) -> bool {
        unsafe { msg_send![super(self), isKeyWindow] }
    }

    fn key_event(&self, event: &NSEvent) -> bool {
        let id = self.ivars().view_id.get();
        let view = id.and_then(|id| VIEWS.with(|views| views.borrow().get(id).cloned()));
        view.is_some_and(|view| view.key_event(event))
    }
}

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
            // Cmd+click on a link opens a tab like WebView2's Ctrl+click.
            let new_tab = main_frame
                && unsafe { action.navigationType() } == WKNavigationType::LinkActivated
                && unsafe { action.modifierFlags() }.contains(NSEventModifierFlags::Command);
            if allowed && new_tab {
                self.with_view(|view| view.new_tab(&url));
                handler.call((WKNavigationActionPolicy::Cancel,));
                return;
            }
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

    unsafe impl WKUIDelegate for NavigationDelegate {
        #[unsafe(method_id(webView:createWebViewWithConfiguration:forNavigationAction:windowFeatures:))]
        fn create_web_view(
            &self,
            _web_view: &WKWebView,
            configuration: &WKWebViewConfiguration,
            action: &WKNavigationAction,
            features: &WKWindowFeatures,
        ) -> Option<Retained<WKWebView>> {
            self.create_web_view_for(configuration, action, features)
        }

        #[unsafe(method(webViewDidClose:))]
        fn did_close(&self, _web_view: &WKWebView) {
            // `window.close()`; only popups close themselves, tabs stay owned by main.
            if let Some(view) = self.view().filter(|view| view.popup) {
                discard(&view);
            }
        }
    }

    unsafe impl NSWindowDelegate for NavigationDelegate {
        #[unsafe(method(windowWillClose:))]
        fn window_will_close(&self, _notification: &NSNotification) {
            // The user closed a popup window with its close button or Cmd+W.
            if let Some(view) = self.view().filter(|view| view.popup) {
                discard(&view);
            }
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

    fn create_web_view_for(
        &self,
        configuration: &WKWebViewConfiguration,
        action: &WKNavigationAction,
        features: &WKWindowFeatures,
    ) -> Option<Retained<WKWebView>> {
        let popup = unsafe {
            protocol::popup_window(
                features.width().is_some() || features.height().is_some(),
                features.x().is_some() || features.y().is_some(),
                features.toolbarsVisibility().map(|visible| visible.boolValue()),
            )
        };
        let url = url_string(unsafe { action.request() }.URL().as_deref());
        let opener = self.view()?;
        if !popup {
            opener.new_tab(&url);
            return None;
        }
        let number = |value: Option<Retained<objc2_foundation::NSNumber>>| {
            value.map(|value| value.doubleValue())
        };
        let (size, position) = unsafe {
            (
                (number(features.width()), number(features.height())),
                (number(features.x()), number(features.y())),
            )
        };
        // WebKit treats None as a blocked window.
        open_popup(&opener, configuration, &url, size, position, main_thread())
    }

    fn view(&self) -> Option<Rc<View>> {
        let view = VIEWS.with(|views| views.borrow().get(&self.ivars().view_id).cloned());
        view.filter(|view| !view.closed.get())
    }

    fn with_view(&self, action: impl FnOnce(&View)) {
        if let Some(view) = self.view() {
            action(&view);
        }
    }
}

fn url_string(url: Option<&NSURL>) -> String {
    url.and_then(|url| url.absoluteString()).map(|url| url.to_string()).unwrap_or_default()
}

struct View {
    id: String,
    /// The tab a popup belongs to; a tab's own id. History and cleanup follow the root.
    root_id: String,
    /// A page-opened window (sign-in and similar) rather than a tab's overlay panel.
    popup: bool,
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
    /// Navigations cut off by `stop`; WebKit can still report their start afterwards.
    stopped: RefCell<Vec<Retained<WKNavigation>>>,
    next_navigation: Cell<u64>,
    /// Last URL main or the page asked for; shown while the document is failed.
    requested: RefCell<String>,
    error: RefCell<Option<(String, String)>>,
    /// Last state sent to main; KVO and delegate callbacks often repeat it.
    pushed: RefCell<Option<serde_json::Value>>,
    tab_shortcuts: Cell<bool>,
    tab_modifier_held: Cell<bool>,
    /// A synthesized left button press is down; moves become drags.
    mouse_pressed: Cell<bool>,
}

thread_local! {
    static DATA_STORE: OnceCell<String> = const { OnceCell::new() };
    static VIEWS: RefCell<HashMap<String, Rc<View>>> = RefCell::new(HashMap::new());
    static NEXT_POPUP: Cell<u64> = const { Cell::new(0) };
    /// Timestamps of recent synthesized key events. WebKit can hand an unhandled key back
    /// to the window; agent keys must never trigger browser chords.
    static SYNTHESIZED_KEYS: RefCell<Vec<f64>> = const { RefCell::new(Vec::new()) };
    static WORLDS: RefCell<HashMap<String, Retained<WKContentWorld>>> = RefCell::new(HashMap::new());
}

fn synthesized_key(event: &NSEvent) -> bool {
    let time = event.timestamp();
    SYNTHESIZED_KEYS.with(|keys| keys.borrow().contains(&time))
}

fn remember_synthesized_key(time: f64) {
    SYNTHESIZED_KEYS.with(|keys| {
        let mut keys = keys.borrow_mut();
        if keys.len() >= 32 {
            keys.remove(0);
        }
        keys.push(time);
    });
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
        // Popups are ordinary windows the user moves; main does not place them.
        if self.popup {
            return;
        }
        let mut placement = self.placement.get();
        placement.parent_on_active_space =
            self.parent_window.get().is_none_or(|window| parent_on_active_space(window, mtm));
        let mode = overlay::panel_mode(&placement, primary_height(mtm));
        match mode {
            PanelMode::Shown(frame) => {
                placement.last_size = Some((frame.width, frame.height));
                self.set_transparent(false);
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
                // A background panel must never keep keyboard focus.
                if self.panel.really_key() {
                    self.panel.orderOut(None);
                }
                self.set_transparent(true);
                self.panel.setFrame_display(ns_rect(frame), true);
                self.panel.orderFrontRegardless();
            }
            PanelMode::Hidden => {
                self.panel.orderOut(None);
                self.set_transparent(false);
            }
        }
        if !matches!(mode, PanelMode::Shown(_)) {
            self.panel.ivars().key_allowed.set(false);
        }
        self.placement.set(placement);
        self.mode.set(mode);
    }

    /// Background panels are invisible, click-through and floating above normal windows,
    /// so nothing occludes them and WebKit keeps rendering at full rate.
    fn set_transparent(&self, transparent: bool) {
        self.panel.setAlphaValue(if transparent { 0.0 } else { 1.0 });
        self.panel.setIgnoresMouseEvents(transparent);
        self.panel.setLevel(if transparent { NSFloatingWindowLevel } else { NSNormalWindowLevel });
    }

    fn state(&self, mtm: MainThreadMarker) -> serde_json::Value {
        let frame = overlay::from_appkit(&frame_of(self.panel.frame()), primary_height(mtm));
        json!({
            "mode": if self.popup { "popup" } else { self.mode.get().name() },
            "visible": self.panel.isVisible(),
            "transparent": self.panel.alphaValue() == 0.0,
            "key": self.panel.really_key(),
            "frame": { "x": frame.x, "y": frame.y, "width": frame.width, "height": frame.height },
            "windowNumber": self.panel.windowNumber(),
            "parentOnActiveSpace": self.placement.get().parent_on_active_space,
        })
    }

    fn close(&self) {
        if self.closed.replace(true) {
            return;
        }
        if self.popup {
            protocol::emit(
                json!({ "event": "popup-closed", "viewId": self.id, "rootId": self.root_id }),
            );
        } else {
            self.close_popups();
        }
        unsafe {
            self.webview.setNavigationDelegate(None);
            self.webview.setUIDelegate(None);
            for key in OBSERVED_KEYS {
                self.webview.removeObserver_forKeyPath(&self.delegate, &NSString::from_str(key));
            }
            self.webview.stopLoading();
        }
        self.panel.orderOut(None);
        self.panel.close();
    }

    fn close_popups(&self) {
        let popups: Vec<_> = VIEWS.with(|views| {
            let views = views.borrow();
            views.values().filter(|view| view.popup && view.root_id == self.id).cloned().collect()
        });
        for popup in popups {
            discard(&popup);
        }
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
        if navigation.is_some_and(|navigation| {
            self.stopped.borrow().iter().any(|known| std::ptr::eq(&**known, navigation))
        }) {
            return;
        }
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
        if self.popup && key == "title" {
            let title =
                unsafe { self.webview.title() }.map(|title| title.to_string()).unwrap_or_default();
            self.panel.setTitle(&NSString::from_str(&protocol::wire_title(&title)));
        }
        self.push();
    }

    /// Records a request before WebKit reports the provisional navigation.
    fn navigate(&self, action: impl FnOnce() -> Option<Retained<WKNavigation>>) {
        self.history.borrow_mut().requested();
        match action() {
            // Known up front, so `stop` can drop its late start callback.
            Some(navigation) => {
                self.navigation_id(Some(&navigation));
            }
            None => self.history.borrow_mut().invalidate(),
        }
        self.push();
    }

    fn stop(&self) {
        self.history.borrow_mut().stop();
        let stopped: Vec<_> =
            self.navigations.borrow_mut().drain(..).map(|(navigation, _)| navigation).collect();
        let mut list = self.stopped.borrow_mut();
        list.extend(stopped);
        let excess = list.len().saturating_sub(16);
        list.drain(..excess);
        drop(list);
        unsafe { self.webview.stopLoading() };
        self.push();
    }

    fn load(&self, url: &str) -> Option<Retained<WKNavigation>> {
        let request = NSURL::URLWithString(&NSString::from_str(url))
            .map(|url| NSURLRequest::requestWithURL(&url))?;
        *self.requested.borrow_mut() = url.to_string();
        *self.error.borrow_mut() = None;
        unsafe { self.webview.loadRequest(&request) }
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
        if let Some(message) =
            protocol::history_message(&self.root_id, &self.id, &url, &title, visit)
        {
            protocol::emit(message);
        }
    }

    fn new_tab(&self, url: &str) {
        if protocol::allowed_url(url, false) {
            protocol::emit(json!({ "event": "new-tab", "viewId": self.id, "url": url }));
        }
    }

    /// Turns browser chords into requests for main; true when the page must not get the key.
    /// Only placed views report, like WebView2, so a hidden view never switches tabs.
    fn key_event(&self, event: &NSEvent) -> bool {
        let kind = event.r#type();
        if self.closed.get()
            || synthesized_key(event)
            || self.placement.get().bounds.is_none()
            || !matches!(kind, NSEventType::KeyDown | NSEventType::FlagsChanged)
        {
            return false;
        }
        let flags = event.modifierFlags();
        let keys = protocol::Modifiers {
            command: flags.contains(NSEventModifierFlags::Command),
            option: flags.contains(NSEventModifierFlags::Option),
            control: flags.contains(NSEventModifierFlags::Control),
            shift: flags.contains(NSEventModifierFlags::Shift),
        };
        let shortcut = if kind == NSEventType::KeyDown {
            let chars =
                event.charactersIgnoringModifiers().map(|c| c.to_string()).unwrap_or_default();
            protocol::shortcut(event.keyCode(), &chars, keys, self.tab_shortcuts.get())
        } else {
            None
        };
        if self.tab_shortcuts.get() && !matches!(shortcut, Some(protocol::Shortcut::Tab(_))) {
            let modifier_change = kind == NSEventType::FlagsChanged;
            if let Some(held) = protocol::tab_modifier_report(
                modifier_change,
                keys.command,
                self.tab_modifier_held.get(),
            ) {
                self.tab_modifier_held.set(held);
                protocol::emit(json!({ "event": "tab-modifier", "viewId": self.id, "held": held }));
            }
        }
        let Some(shortcut) = shortcut else {
            return false;
        };
        if !event.isARepeat() {
            let mut message = json!({ "event": shortcut.event(), "viewId": self.id });
            if let protocol::Shortcut::Tab(digit) = shortcut {
                message["digit"] = json!(digit);
            }
            protocol::emit(message);
        }
        true
    }

    /// A viewport CSS point in the panel's window coordinates.
    fn window_point(&self, x: f64, y: f64) -> NSPoint {
        let zoom = unsafe { self.webview.pageZoom() };
        let mut point = NSPoint::new(x * zoom, y * zoom);
        if !self.webview.isFlipped() {
            point.y = self.webview.bounds().size.height - point.y;
        }
        self.webview.convertPoint_toView(point, None)
    }

    /// Delivers one synthesized event straight to the web view, never through the panel,
    /// so it works while the panel is off-screen and never makes the panel key.
    fn input(&self, input: &protocol::Input, mtm: MainThreadMarker) -> Result<(), &'static str> {
        let time = NSProcessInfo::processInfo().systemUptime();
        let window = self.panel.windowNumber();
        match input {
            protocol::Input::Mouse { action, x, y, click_count, delta_x, delta_y } => {
                if !protocol::allowed_point(*x, *y) {
                    return Err("Invalid input point.");
                }
                let location = self.window_point(*x, *y);
                if *action == protocol::MouseAction::Wheel {
                    return self.wheel(
                        location,
                        delta_x.unwrap_or(0.0),
                        delta_y.unwrap_or(0.0),
                        mtm,
                    );
                }
                let pressed = self.mouse_pressed.get();
                let kind = match action {
                    protocol::MouseAction::Move if pressed => NSEventType::LeftMouseDragged,
                    protocol::MouseAction::Move => NSEventType::MouseMoved,
                    protocol::MouseAction::Down => NSEventType::LeftMouseDown,
                    _ => NSEventType::LeftMouseUp,
                };
                let clicks = click_count.unwrap_or(0).clamp(0, 3) as isize;
                let event = NSEvent::mouseEventWithType_location_modifierFlags_timestamp_windowNumber_context_eventNumber_clickCount_pressure(
                    kind, location, NSEventModifierFlags::empty(), time, window, None, 0, clicks,
                    if kind == NSEventType::LeftMouseDown { 1.0 } else { 0.0 },
                ).ok_or("Input event unavailable.")?;
                match kind {
                    NSEventType::LeftMouseDown => {
                        self.mouse_pressed.set(true);
                        self.webview.mouseDown(&event)
                    }
                    NSEventType::LeftMouseUp => {
                        self.mouse_pressed.set(false);
                        self.webview.mouseUp(&event)
                    }
                    NSEventType::LeftMouseDragged => self.webview.mouseDragged(&event),
                    _ => self.webview.mouseMoved(&event),
                }
            }
            protocol::Input::Key {
                action,
                key,
                code,
                modifiers,
                text,
                unmodified_text,
                commands,
            } => {
                let key = key.as_deref().unwrap_or_default();
                let text = text.as_deref().filter(|text| text.chars().count() <= 16);
                let characters = protocol::key_characters(key, text);
                let unmodified = unmodified_text
                    .as_deref()
                    .filter(|text| !text.is_empty() && text.chars().count() <= 16)
                    .map_or_else(|| characters.clone(), str::to_string);
                let key_code = code
                    .as_deref()
                    .and_then(protocol::mac_key_code)
                    .or_else(|| protocol::mac_key_code(&protocol::letter_code(&characters)?))
                    .unwrap_or(0);
                let flags = modifier_flags(modifiers.unwrap_or(0));
                let make = |kind: NSEventType| {
                    remember_synthesized_key(time);
                    NSEvent::keyEventWithType_location_modifierFlags_timestamp_windowNumber_context_characters_charactersIgnoringModifiers_isARepeat_keyCode(
                        kind, NSPoint::new(0.0, 0.0), flags, time, window, None,
                        &NSString::from_str(&characters), &NSString::from_str(&unmodified), false, key_code,
                    ).ok_or("Input event unavailable.")
                };
                let selectors = commands
                    .iter()
                    .flatten()
                    .map(|command| {
                        protocol::editing_selector(command).ok_or("Unsupported editing command.")
                    })
                    .collect::<Result<Vec<_>, _>>()?;
                if matches!(action, protocol::KeyAction::Down | protocol::KeyAction::Char) {
                    let event = make(NSEventType::KeyDown)?;
                    self.webview.keyDown(&event);
                    for selector in selectors {
                        let selector = objc2::runtime::Sel::register(
                            &std::ffi::CString::new(selector).unwrap(),
                        );
                        if self.webview.respondsToSelector(selector) {
                            let _: *mut AnyObject = unsafe {
                                msg_send![&*self.webview, performSelector: selector, withObject: std::ptr::null::<AnyObject>()]
                            };
                        }
                    }
                }
                if matches!(action, protocol::KeyAction::Up | protocol::KeyAction::Char) {
                    let event = make(NSEventType::KeyUp)?;
                    self.webview.keyUp(&event);
                }
            }
            protocol::Input::Text { text } => {
                if text.chars().count() > protocol::MAX_INPUT_TEXT_CHARS {
                    return Err("Input text is too long.");
                }
                let text = NSString::from_str(text);
                let _: () = unsafe { msg_send![&*self.webview, insertText: &*text] };
            }
        }
        Ok(())
    }

    /// Wheel events have no NSEvent constructor, and one made from a CGEvent has no
    /// window, so its `locationInWindow` is its screen location. Placing the CGEvent at the
    /// window point (in CoreGraphics' flipped screen space) lets WebKit hit-test it there.
    fn wheel(
        &self,
        location: NSPoint,
        delta_x: f64,
        delta_y: f64,
        mtm: MainThreadMarker,
    ) -> Result<(), &'static str> {
        if !delta_x.is_finite()
            || !delta_y.is_finite()
            || delta_x.abs() > 1.0e5
            || delta_y.abs() > 1.0e5
        {
            return Err("Invalid wheel delta.");
        }
        // Positive DOM deltas scroll down/right; CoreGraphics wheel deltas are the reverse.
        let event = CGEvent::new_scroll_wheel_event2(
            None,
            CGScrollEventUnit::Pixel,
            2,
            (-delta_y).round() as i32,
            (-delta_x).round() as i32,
            0,
        )
        .ok_or("Input event unavailable.")?;
        CGEvent::set_location(
            Some(&event),
            CGPoint::new(location.x, primary_height(mtm) - location.y),
        );
        let event = NSEvent::eventWithCGEvent(&event).ok_or("Input event unavailable.")?;
        if event.window(mtm).is_some() {
            return Err("Input event unavailable.");
        }
        self.webview.scrollWheel(&event);
        Ok(())
    }

    /// WebKit re-reads `isKeyWindow` on the key notifications; the panel itself stays non-key.
    fn set_focus_emulation(&self, enabled: bool) {
        let ivars = self.panel.ivars();
        if ivars.focus_emulated.get() == enabled {
            return;
        }
        let really_key = self.panel.really_key();
        ivars.focus_emulated.set(enabled);
        if enabled {
            self.panel.makeFirstResponder(Some(&self.webview));
        }
        if !really_key {
            let name = unsafe {
                if enabled {
                    NSWindowDidBecomeKeyNotification
                } else {
                    NSWindowDidResignKeyNotification
                }
            };
            unsafe {
                NSNotificationCenter::defaultCenter()
                    .postNotificationName_object(name, Some(&*self.panel));
            }
        }
    }

    fn set_tab_shortcuts(&self, enabled: bool) {
        self.tab_shortcuts.set(enabled);
        if !enabled && self.tab_modifier_held.replace(false) {
            protocol::emit(json!({ "event": "tab-modifier", "viewId": self.id, "held": false }));
        }
    }

    fn fail(&self, code: &str, message: &str) {
        // A crashed popup closes like WebView2's; a tab keeps its crash page for recovery.
        if self.popup {
            if let Some(view) = VIEWS.with(|views| views.borrow().get(&self.id).cloned()) {
                discard(&view);
            }
            return;
        }
        self.close_popups();
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
    let panel =
        new_panel(rect, NSWindowStyleMask::Borderless | NSWindowStyleMask::NonactivatingPanel, mtm);
    let webview = unsafe {
        let configuration = WKWebViewConfiguration::new(mtm);
        configuration.setWebsiteDataStore(&WKWebsiteDataStore::dataStoreForIdentifier(&uuid, mtm));
        WKWebView::initWithFrame_configuration(WKWebView::alloc(mtm), rect, &configuration)
    };
    panel.setHasShadow(false);
    panel.setCollectionBehavior(
        NSWindowCollectionBehavior::CanJoinAllSpaces
            | NSWindowCollectionBehavior::FullScreenAuxiliary
            | NSWindowCollectionBehavior::IgnoresCycle
            | NSWindowCollectionBehavior::Transient,
    );
    let view = register_view(id, id, panel, webview, url, mtm);
    view.parent_window.set(parent);
    view.placement.set(Placement {
        bounds,
        parent_shown: command.visible.unwrap_or(false),
        ..Placement::default()
    });
    view.tab_shortcuts.set(command.tab_shortcuts == Some(true));
    unsafe { view.webview.setPageZoom(zoom / 100.0) };
    view.apply(mtm);
    view.navigate(|| view.load(url));
    Ok(())
}

fn new_panel(
    rect: NSRect,
    style: NSWindowStyleMask,
    mtm: MainThreadMarker,
) -> Retained<BrowserPanel> {
    let panel: Retained<BrowserPanel> = unsafe {
        msg_send![
            super(BrowserPanel::alloc(mtm).set_ivars(PanelIvars::default())),
            initWithContentRect: rect,
            styleMask: style,
            backing: NSBackingStoreType::Buffered,
            defer: false,
        ]
    };
    unsafe { panel.setReleasedWhenClosed(false) };
    // Panels hide when their app deactivates; this helper is never the active app.
    panel.setHidesOnDeactivate(false);
    panel
}

/// Wires a new web view to its delegate and registers it. A popup's id differs from
/// its root's; a tab is its own root.
fn register_view(
    id: &str,
    root_id: &str,
    panel: Retained<BrowserPanel>,
    webview: Retained<WKWebView>,
    url: &str,
    mtm: MainThreadMarker,
) -> Rc<View> {
    webview.setAutoresizingMask(
        NSAutoresizingMaskOptions::ViewWidthSizable | NSAutoresizingMaskOptions::ViewHeightSizable,
    );
    panel.setContentView(Some(&webview));
    let delegate = NavigationDelegate::new(id, mtm);
    let view = Rc::new(View {
        id: id.to_string(),
        root_id: root_id.to_string(),
        popup: id != root_id,
        panel,
        webview,
        delegate,
        parent_window: Cell::new(None),
        placement: Cell::new(Placement::default()),
        mode: Cell::new(PanelMode::Hidden),
        closed: Cell::new(false),
        history: RefCell::new(HistoryNavigation::default()),
        navigations: RefCell::new(Vec::new()),
        stopped: RefCell::new(Vec::new()),
        next_navigation: Cell::new(0),
        requested: RefCell::new(url.to_string()),
        error: RefCell::new(None),
        pushed: RefCell::new(None),
        tab_shortcuts: Cell::new(false),
        tab_modifier_held: Cell::new(false),
        mouse_pressed: Cell::new(false),
    });
    let _ = view.panel.ivars().view_id.set(id.to_string());
    VIEWS.with(|views| views.borrow_mut().insert(id.to_string(), view.clone()));
    unsafe {
        view.webview.setNavigationDelegate(Some(ProtocolObject::from_ref(&*view.delegate)));
        view.webview.setUIDelegate(Some(ProtocolObject::from_ref(&*view.delegate)));
        for key in OBSERVED_KEYS {
            view.webview.addObserver_forKeyPath_options_context(
                &view.delegate,
                &NSString::from_str(key),
                NSKeyValueObservingOptions::empty(),
                std::ptr::null_mut(),
            );
        }
    }
    view
}

/// Removes a view the helper closes on its own (popup close, crash, root close).
fn discard(view: &Rc<View>) {
    VIEWS.with(|views| {
        let mut views = views.borrow_mut();
        if views.get(&view.id).is_some_and(|current| Rc::ptr_eq(current, view)) {
            views.remove(&view.id);
        }
    });
    view.close();
}

/// Hosts a page-opened window in a titled window built from WebKit's configuration, so
/// `window.opener` and the shared session keep working. WebKit loads the request itself.
fn open_popup(
    opener: &View,
    configuration: &WKWebViewConfiguration,
    url: &str,
    size: (Option<f64>, Option<f64>),
    position: (Option<f64>, Option<f64>),
    mtm: MainThreadMarker,
) -> Option<Retained<WKWebView>> {
    if opener.error.borrow().as_ref().is_some_and(|(code, _)| code == "runtime-crashed") {
        return None;
    }
    let root = VIEWS.with(|views| views.borrow().get(&opener.root_id).cloned())?;
    if root.closed.get() {
        return None;
    }
    let number = NEXT_POPUP.with(|next| {
        next.set(next.get() + 1);
        next.get()
    });
    let id = format!("{}:popup:{number}", root.id);
    let primary = primary_height(mtm);
    let anchor = if opener.popup || matches!(opener.mode.get(), PanelMode::Shown(_)) {
        opener.panel.frame()
    } else {
        NSScreen::mainScreen(mtm).map_or(opener.panel.frame(), |screen| screen.visibleFrame())
    };
    let bounds =
        overlay::popup_bounds(size, position, &overlay::from_appkit(&frame_of(anchor), primary));
    let content = ns_rect(overlay::to_appkit(&bounds, primary));
    let panel = new_panel(
        content,
        NSWindowStyleMask::Titled
            | NSWindowStyleMask::Closable
            | NSWindowStyleMask::Miniaturizable
            | NSWindowStyleMask::Resizable,
        mtm,
    );
    let webview = unsafe {
        WKWebView::initWithFrame_configuration(WKWebView::alloc(mtm), content, configuration)
    };
    let url = if protocol::allowed_url(url, false) { url } else { "about:blank" };
    let view = register_view(&id, &root.id, panel, webview, url, mtm);
    view.panel.setDelegate(Some(ProtocolObject::from_ref(&*view.delegate)));
    // The initial document is pending until WebKit starts loading it.
    view.history.borrow_mut().requested();
    protocol::emit(json!({ "event": "popup-opened", "viewId": id, "rootId": root.id, "url": url }));
    // A popup the user opened from a focused tab takes focus; one opened by background
    // work only appears, so it never steals the keyboard.
    if opener.panel.really_key() {
        view.panel.ivars().key_allowed.set(true);
        NSApplication::sharedApplication(mtm).activate();
        view.panel.makeKeyAndOrderFront(None);
        view.panel.makeFirstResponder(Some(&view.webview));
        protocol::emit(json!({ "event": "control-focused", "viewId": id }));
    } else {
        view.panel.orderFrontRegardless();
    }
    view.push();
    Some(view.webview.clone())
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
            if !view.popup && !matches!(view.mode.get(), PanelMode::Shown(_)) {
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
        "focus-emulation" => {
            let enabled = command.enabled.ok_or("Focus emulation state is required.")?;
            view.set_focus_emulation(enabled);
            return Ok(None);
        }
        "tab-shortcuts" => {
            let enabled = command.tab_shortcuts.ok_or("Tab shortcut state is required.")?;
            view.set_tab_shortcuts(enabled);
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
                    view.navigate(|| unsafe { webview.goBack() })
                }
                Some("forward") if unsafe { webview.canGoForward() } => {
                    view.navigate(|| unsafe { webview.goForward() })
                }
                Some("back" | "forward") => {}
                Some("stop") => view.stop(),
                Some("reload") => {
                    // A failed or crashed document reloads the URL main last asked for.
                    if view.error.borrow().is_some() {
                        let url = view.requested.borrow().clone();
                        view.navigate(|| view.load(&url));
                    } else {
                        view.navigate(|| unsafe { webview.reload() });
                    }
                }
                _ => return Err("Unsupported navigation action."),
            }
            return Ok(None);
        }
        "evaluate" => {
            let expression = command.expression.as_deref().ok_or("An expression is required.")?;
            let world = content_world(command.world.as_deref(), mtm)?;
            evaluate(view, command.id, expression, &world);
            return Err(DEFERRED);
        }
        "input" => {
            let input = command.input.as_ref().ok_or("Input is required.")?;
            view.input(input, mtm)?;
            return Ok(None);
        }
        "screenshot" => {
            screenshot(view, command, mtm)?;
            return Err(DEFERRED);
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

/// `view_command` error meaning the reply is sent later by a completion handler.
const DEFERRED: &str = "";

fn content_world(
    name: Option<&str>,
    mtm: MainThreadMarker,
) -> Result<Retained<WKContentWorld>, &'static str> {
    Ok(match name {
        None => unsafe { WKContentWorld::defaultClientWorld(mtm) },
        Some("page") => unsafe { WKContentWorld::pageWorld(mtm) },
        // WebKit keeps a named world's globals only while the instance lives, so the
        // helper retains every world it hands out (bounded like the desktop's contexts).
        Some(name) if protocol::allowed_world(name) => WORLDS.with(|worlds| {
            let mut worlds = worlds.borrow_mut();
            if let Some(world) = worlds.get(name) {
                return Ok(world.clone());
            }
            if worlds.len() >= 256 {
                return Err("Content world limit exceeded.");
            }
            let world = unsafe { WKContentWorld::worldWithName(&NSString::from_str(name), mtm) };
            worlds.insert(name.to_string(), world.clone());
            Ok(world)
        })?,
        Some(_) => return Err("Invalid content world."),
    })
}

fn evaluate(view: &View, id: u64, expression: &str, world: &WKContentWorld) {
    let completion = RcBlock::new(move |result: *mut AnyObject, error: *mut NSError| {
        if let Some(error) = unsafe { error.as_ref() } {
            // A page exception carries its own text; localizedDescription is generic.
            let exception = error
                .userInfo()
                .objectForKey(&NSString::from_str("WKJavaScriptExceptionMessage"))
                .and_then(|value| value.downcast::<NSString>().ok())
                .map(|value| value.to_string());
            let message = exception.unwrap_or_else(|| error.localizedDescription().to_string());
            protocol::failure(
                id,
                "evaluation-failed",
                message.chars().take(1024).collect::<String>(),
            );
            return;
        }
        let text = unsafe { result.as_ref() }
            .and_then(|result| result.downcast_ref::<NSString>())
            .map(|text| text.to_string());
        let value = match text {
            Some(text) => serde_json::from_str(&text).unwrap_or(serde_json::Value::Null),
            None => serde_json::Value::Null,
        };
        protocol::reply(id, Some(json!({ "value": value })));
    });
    unsafe {
        view.webview.callAsyncJavaScript_arguments_inFrame_inContentWorld_completionHandler(
            &NSString::from_str(&protocol::evaluation_body(expression)),
            None,
            None,
            world,
            Some(&completion),
        );
    }
}

fn modifier_flags(mask: u32) -> NSEventModifierFlags {
    let mut flags = NSEventModifierFlags::empty();
    for (bit, flag) in [
        (1, NSEventModifierFlags::Option),
        (2, NSEventModifierFlags::Control),
        (4, NSEventModifierFlags::Command),
        (8, NSEventModifierFlags::Shift),
    ] {
        if mask & bit != 0 {
            flags |= flag;
        }
    }
    flags
}

/// Captures a viewport rect with `takeSnapshot` and replies with base64 image data,
/// drawn at the exact device-pixel size times `scale`.
fn screenshot(view: &View, command: &Command, mtm: MainThreadMarker) -> Result<(), &'static str> {
    let rect = command.rect.ok_or("A screenshot area is required.")?;
    let png = match command.format.as_deref() {
        None | Some("png") => true,
        Some("jpeg") => false,
        Some(_) => return Err("Unsupported screenshot format."),
    };
    let quality = command.quality.unwrap_or(75.0);
    if !quality.is_finite() || !(0.0..=100.0).contains(&quality) {
        return Err("Invalid screenshot quality.");
    }
    let zoom = unsafe { view.webview.pageZoom() };
    let device_scale = view.panel.backingScaleFactor() * zoom;
    let (width, height) =
        protocol::screenshot_pixels(&rect, device_scale, command.scale.unwrap_or(1.0))
            .filter(|_| protocol::allowed_point(rect.x, rect.y))
            .ok_or("Invalid screenshot area.")?;
    let configuration = unsafe { WKSnapshotConfiguration::new(mtm) };
    unsafe {
        configuration.setRect(NSRect::new(
            NSPoint::new(rect.x * zoom, rect.y * zoom),
            NSSize::new(rect.width * zoom, rect.height * zoom),
        ));
        configuration.setAfterScreenUpdates(true);
    }
    let id = command.id;
    let completion = RcBlock::new(move |image: *mut NSImage, error: *mut NSError| {
        let encoded = match (unsafe { image.as_ref() }, unsafe { error.as_ref() }) {
            (Some(image), None) => encode_image(image, width, height, png, quality / 100.0),
            _ => None,
        };
        match encoded {
            Some(data) => {
                protocol::emit_capture(json!({ "id": id, "ok": true, "result": { "data": data } }))
            }
            None => protocol::failure(id, "capture-failed", "Browser screenshot failed."),
        }
    });
    unsafe {
        view.webview
            .takeSnapshotWithConfiguration_completionHandler(Some(&configuration), &completion)
    };
    Ok(())
}

fn encode_image(
    image: &NSImage,
    width: usize,
    height: usize,
    png: bool,
    quality: f64,
) -> Option<String> {
    let rep = unsafe {
        NSBitmapImageRep::initWithBitmapDataPlanes_pixelsWide_pixelsHigh_bitsPerSample_samplesPerPixel_hasAlpha_isPlanar_colorSpaceName_bytesPerRow_bitsPerPixel(
            main_thread().alloc::<NSBitmapImageRep>(), std::ptr::null_mut(), width as isize, height as isize,
            8, 4, true, false, NSDeviceRGBColorSpace, 0, 0,
        )
    }?;
    let context = NSGraphicsContext::graphicsContextWithBitmapImageRep(&rep)?;
    NSGraphicsContext::saveGraphicsState_class();
    NSGraphicsContext::setCurrentContext(Some(&context));
    image.drawInRect(NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(width as f64, height as f64)));
    context.flushGraphics();
    NSGraphicsContext::restoreGraphicsState_class();
    let (kind, properties) = if png {
        (NSBitmapImageFileType::PNG, NSDictionary::<NSString, AnyObject>::new())
    } else {
        let factor = NSNumber::new_f64(quality);
        let properties = NSDictionary::from_retained_objects(
            &[unsafe { NSImageCompressionFactor }],
            &[Retained::into_super(Retained::into_super(Retained::into_super(factor)))],
        );
        (NSBitmapImageFileType::JPEG, properties)
    };
    let data = unsafe { rep.representationUsingType_properties(kind, &properties) }?;
    Some(data.base64EncodedStringWithOptions(NSDataBase64EncodingOptions::empty()).to_string())
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
                Err(DEFERRED) => {}
                Err(message) => protocol::failure(command.id, "invalid", message),
            }
        }
    }
}
