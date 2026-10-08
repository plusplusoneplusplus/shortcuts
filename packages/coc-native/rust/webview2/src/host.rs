use crate::protocol::{self, allowed_url, allowed_view_id, Bounds, Command};
use serde_json::json;
use std::{
    cell::{Cell, RefCell},
    collections::HashMap,
    fs::{File, OpenOptions},
    io::{self, BufRead},
    os::windows::fs::OpenOptionsExt,
    path::Path,
    rc::{Rc, Weak},
    sync::mpsc,
};
use webview2_com::{Microsoft::Web::WebView2::Win32::*, *};
use windows::{
    core::*,
    Win32::{
        Foundation::*,
        Graphics::Gdi::{
            GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST,
        },
        System::{Com::*, Threading::*},
        UI::{
            HiDpi::*,
            Input::KeyboardAndMouse::{GetKeyState, SetFocus, VK_CONTROL, VK_MENU, VK_SHIFT},
            WindowsAndMessaging::*,
        },
    },
};

type HostResult<T> = std::result::Result<T, Box<dyn std::error::Error>>;
type Result<T> = windows::core::Result<T>;
type State = Rc<RefCell<Host>>;
thread_local! { static WINDOWS: RefCell<HashMap<usize, Weak<View>>> = RefCell::new(HashMap::new()); }

struct Host {
    environment: Option<ICoreWebView2Environment>,
    views: HashMap<String, Rc<View>>,
    pending: Vec<Command>,
    initializing: bool,
    profile: HSTRING,
    _lock: File,
    next_popup: u64,
}

struct View {
    id: String,
    root_id: String,
    parent: HWND,
    window: HWND,
    controller: ICoreWebView2Controller,
    webview: ICoreWebView2,
    loading: Cell<bool>,
    closed: Cell<bool>,
    requested: RefCell<String>,
    error: RefCell<Option<(String, String)>>,
    bounds: Cell<Option<Bounds>>,
    popup: bool,
    host: Weak<RefCell<Host>>,
    fullscreen_window: Cell<Option<(RECT, isize)>>,
}

impl View {
    fn popup_fullscreen(&self, fullscreen: bool) -> Result<()> {
        unsafe {
            if fullscreen && self.fullscreen_window.get().is_none() {
                let mut bounds = RECT::default();
                GetWindowRect(self.window, &mut bounds)?;
                let style = GetWindowLongPtrW(self.window, GWL_STYLE);
                let mut monitor = MONITORINFO {
                    cbSize: std::mem::size_of::<MONITORINFO>() as u32,
                    ..Default::default()
                };
                if !GetMonitorInfoW(
                    MonitorFromWindow(self.window, MONITOR_DEFAULTTONEAREST),
                    &mut monitor,
                )
                .as_bool()
                {
                    return Err(windows::core::Error::from_thread());
                }
                self.fullscreen_window.set(Some((bounds, style)));
                SetLastError(WIN32_ERROR(0));
                SetWindowLongPtrW(
                    self.window,
                    GWL_STYLE,
                    (style & !(WS_OVERLAPPEDWINDOW.0 as isize)) | WS_POPUP.0 as isize,
                );
                if GetLastError().0 != 0 {
                    return Err(windows::core::Error::from_thread());
                }
                SetWindowPos(
                    self.window,
                    None,
                    monitor.rcMonitor.left,
                    monitor.rcMonitor.top,
                    monitor.rcMonitor.right - monitor.rcMonitor.left,
                    monitor.rcMonitor.bottom - monitor.rcMonitor.top,
                    SWP_FRAMECHANGED | SWP_NOZORDER,
                )?;
            } else if !fullscreen {
                if let Some((bounds, style)) = self.fullscreen_window.take() {
                    SetLastError(WIN32_ERROR(0));
                    SetWindowLongPtrW(self.window, GWL_STYLE, style);
                    if GetLastError().0 != 0 {
                        return Err(windows::core::Error::from_thread());
                    }
                    SetWindowPos(
                        self.window,
                        None,
                        bounds.left,
                        bounds.top,
                        bounds.right - bounds.left,
                        bounds.bottom - bounds.top,
                        SWP_FRAMECHANGED | SWP_NOZORDER,
                    )?;
                }
            }
        }
        Ok(())
    }

    fn snapshot(&self) -> Result<serde_json::Value> {
        let mut url = PWSTR::null();
        let mut title = PWSTR::null();
        let mut back = BOOL(0);
        let mut forward = BOOL(0);
        unsafe {
            self.webview.Source(&mut url)?;
            self.webview.DocumentTitle(&mut title)?;
            self.webview.CanGoBack(&mut back)?;
            self.webview.CanGoForward(&mut forward)?;
        }
        let url = CoTaskMemPWSTR::from(url).to_string();
        let title = CoTaskMemPWSTR::from(title).to_string();
        let error = self.error.borrow();
        let mut state = json!({
            "viewId": self.root_id, "engine": "webview2",
            "url": if error.is_some() || url.is_empty() { self.requested.borrow().clone() } else { url },
            "title": if error.is_some() { String::new() } else { title },
            "canGoBack": back.as_bool(), "canGoForward": forward.as_bool(), "loading": self.loading.get()
        });
        if let Some((code, message)) = error.as_ref() {
            state["errorCode"] = json!(code);
            state["error"] = json!(message);
        }
        Ok(state)
    }

    fn push(&self) {
        if self.closed.get() || self.popup {
            return;
        }
        match self.snapshot() {
            Ok(state) => {
                protocol::emit(json!({ "event": "state", "viewId": self.id, "state": state }))
            }
            Err(error) => self.fail("runtime-crashed", error.to_string()),
        }
    }

    fn fail(&self, code: &str, message: String) {
        if self.closed.get() {
            return;
        }
        self.loading.set(false);
        *self.error.borrow_mut() = Some((code.to_string(), message.clone()));
        protocol::emit(json!({ "event": "state", "viewId": self.root_id, "state": {
            "viewId": self.root_id, "engine": "webview2", "url": self.requested.borrow().clone(), "title": "",
            "canGoBack": false, "canGoForward": false, "loading": false, "error": message, "errorCode": code
        }}));
    }

    fn layout(&self, bounds: Option<Bounds>) -> Result<()> {
        self.bounds.set(bounds);
        unsafe {
            let visible = bounds.is_some();
            if let Some(bounds) = bounds {
                let scale = GetDpiForWindow(self.parent) as f64 / 96.0;
                let scaled = |value: i32| (value as f64 * scale.max(1.0)).round() as i32;
                let width = scaled(bounds.width).max(1);
                let height = scaled(bounds.height).max(1);
                position_browser_window(
                    self.window,
                    scaled(bounds.x),
                    scaled(bounds.y),
                    width,
                    height,
                )?;
                self.controller.SetBounds(RECT {
                    left: 0,
                    top: 0,
                    right: width,
                    bottom: height,
                })?;
                self.controller.NotifyParentWindowPositionChanged()?;
            }
            self.controller.SetIsVisible(visible)?;
            let _ = ShowWindow(self.window, if visible { SW_SHOW } else { SW_HIDE });
        }
        Ok(())
    }

    fn close(&self) -> Result<()> {
        if self.closed.replace(true) {
            return Ok(());
        }
        if let Some(host) = self.host.upgrade() {
            host.borrow_mut().views.remove(&self.id);
        }
        WINDOWS.with(|windows| windows.borrow_mut().remove(&(self.window.0 as usize)));
        unsafe {
            self.controller.Close()?;
            if IsWindow(Some(self.window)).as_bool() {
                DestroyWindow(self.window)?;
            }
        }
        Ok(())
    }
}

unsafe fn position_browser_window(
    window: HWND,
    x: i32,
    y: i32,
    width: i32,
    height: i32,
) -> Result<()> {
    // Electron's renderer is a sibling HWND and otherwise covers the native view.
    SetWindowPos(window, Some(HWND_TOP), x, y, width, height, SWP_NOACTIVATE)
}

impl Drop for View {
    fn drop(&mut self) {
        if let Err(error) = self.close() {
            eprintln!("WebView2 controller cleanup failed: {error}");
        }
    }
}

#[cfg(test)]
mod layout_tests {
    use super::*;

    struct TestWindow(HWND);

    impl TestWindow {
        unsafe fn new(parent: Option<HWND>, width: i32, height: i32) -> Self {
            Self(
                CreateWindowExW(
                    Default::default(),
                    w!("STATIC"),
                    w!(""),
                    if parent.is_some() { WS_CHILD } else { WS_POPUP },
                    0,
                    0,
                    width,
                    height,
                    parent,
                    None,
                    None,
                    None,
                )
                .unwrap(),
            )
        }
    }

    impl Drop for TestWindow {
        fn drop(&mut self) {
            unsafe { DestroyWindow(self.0).unwrap() };
        }
    }

    #[test]
    fn browser_layout_raises_above_renderer_without_activating_or_unhiding() {
        unsafe {
            let parent = TestWindow::new(None, 640, 480);
            let browser = TestWindow::new(Some(parent.0), 1, 1);
            let renderer = TestWindow::new(Some(parent.0), 640, 480);
            SetWindowPos(
                renderer.0,
                Some(HWND_TOP),
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
            )
            .unwrap();
            assert_eq!(GetWindow(parent.0, GW_CHILD).unwrap(), renderer.0);
            let active = GetForegroundWindow();

            position_browser_window(browser.0, 50, 60, 300, 200).unwrap();
            assert_eq!(GetWindow(parent.0, GW_CHILD).unwrap(), browser.0);
            assert_eq!(GetForegroundWindow(), active);
            assert_eq!(GetWindowLongPtrW(browser.0, GWL_STYLE) & WS_VISIBLE.0 as isize, 0);
            let mut rect = RECT::default();
            GetClientRect(browser.0, &mut rect).unwrap();
            assert_eq!((rect.right, rect.bottom), (300, 200));

            // Restoring a tab repairs stacking after Electron raises its surface.
            SetWindowPos(
                renderer.0,
                Some(HWND_TOP),
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
            )
            .unwrap();
            position_browser_window(browser.0, 50, 60, 400, 250).unwrap();
            assert_eq!(GetWindow(parent.0, GW_CHILD).unwrap(), browser.0);
            assert_eq!(GetForegroundWindow(), active);
        }
    }
}

fn runtime_available() -> bool {
    let mut version = PWSTR::null();
    let result = unsafe { GetAvailableCoreWebView2BrowserVersionString(None, &mut version) };
    let version = CoTaskMemPWSTR::from(version);
    result.is_ok() && !version.to_string().is_empty()
}

pub fn run() -> HostResult<()> {
    if std::env::args().any(|arg| arg == "--check") {
        protocol::emit(if runtime_available() {
            json!({ "available": true })
        } else {
            json!({ "available": false, "reason": "missing-runtime", "message": "Install the Microsoft Edge WebView2 Runtime, then retry. No runtime is installed automatically." })
        });
        return Ok(());
    }
    if !runtime_available() {
        protocol::failure(
            0,
            "missing-runtime",
            "Install the Microsoft Edge WebView2 Runtime, then retry.",
        );
        return Ok(());
    }
    let profile = std::env::args().nth(1).ok_or("Missing profile directory")?;
    std::fs::create_dir_all(&profile)?;
    // A Windows share-mode lock is released by the OS even after a host crash.
    let lock = match OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .share_mode(0)
        .open(Path::new(&profile).join(".coc-profile-lock"))
    {
        Ok(lock) => lock,
        Err(error) => {
            protocol::failure(0, "profile-locked", format!("Close the other desktop process using this browser profile, then retry: {error}"));
            return Ok(());
        }
    };
    unsafe {
        SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2)?;
        CoInitializeEx(None, COINIT_APARTMENTTHREADED).ok()?;
        let class = WNDCLASSW {
            lpfnWndProc: Some(window_proc),
            lpszClassName: w!("CoCBrowserHost"),
            ..Default::default()
        };
        if RegisterClassW(&class) == 0 {
            return Err(windows::core::Error::from_thread().into());
        }
    }
    let state = Rc::new(RefCell::new(Host {
        environment: None,
        views: HashMap::new(),
        pending: Vec::new(),
        initializing: false,
        profile: HSTRING::from(profile),
        _lock: lock,
        next_popup: 0,
    }));
    let thread_id = unsafe { GetCurrentThreadId() };
    let mut msg = MSG::default();
    unsafe {
        let _ = PeekMessageW(&mut msg, None, 0, 0, PM_NOREMOVE);
    }
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        for line in io::stdin().lock().lines() {
            match line {
                Ok(line) if line.len() <= 32768 => match serde_json::from_str::<Command>(&line) {
                    Ok(command) => {
                        if tx.send(command).is_err() {
                            break;
                        }
                        unsafe {
                            if PostThreadMessageW(thread_id, WM_APP, WPARAM(0), LPARAM(0)).is_err()
                            {
                                break;
                            }
                        }
                    }
                    Err(error) => {
                        protocol::failure(0, "invalid", format!("Invalid browser command: {error}"))
                    }
                },
                Ok(_) => protocol::failure(0, "invalid", "Browser command is too large."),
                Err(error) => {
                    eprintln!("Browser command input failed: {error}");
                    break;
                }
            }
        }
        unsafe {
            let _ = PostThreadMessageW(thread_id, WM_QUIT, WPARAM(0), LPARAM(0));
        }
    });
    protocol::emit(json!({ "event": "ready" }));
    loop {
        let result = unsafe { GetMessageW(&mut msg, None, 0, 0) }.0;
        if result == -1 {
            return Err(windows::core::Error::from_thread().into());
        }
        if result == 0 {
            break;
        }
        if msg.message == WM_APP {
            while let Ok(command) = rx.try_recv() {
                dispatch(&state, command);
            }
        } else {
            unsafe {
                let _ = TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
        }
    }
    let views = std::mem::take(&mut state.borrow_mut().views);
    for view in views.values() {
        view.close()?;
    }
    drop(views);
    state.borrow_mut().environment = None;
    unsafe {
        CoUninitialize();
    }
    Ok(())
}

fn dispatch(state: &State, command: Command) {
    if command.op == "quit" {
        protocol::success(command.id);
        unsafe {
            PostQuitMessage(0);
        }
        return;
    }
    if command.op == "open" || command.op == "clear" {
        if command.op == "open"
            && (!command.url.as_deref().is_some_and(|url| allowed_url(url, false))
                || command.view_id.as_ref().is_none_or(|id| !allowed_view_id(id)))
        {
            protocol::failure(
                command.id,
                "invalid",
                "A browser view id and HTTP(S) URL are required.",
            );
            return;
        }
        if state.borrow().environment.is_some() {
            start_controller(state, command, None);
        } else {
            state.borrow_mut().pending.push(command);
            if !state.borrow().initializing {
                start_environment(state);
            }
        }
        return;
    }
    let view = command.view_id.as_ref().and_then(|id| state.borrow().views.get(id).cloned());
    if command.op == "close" {
        let id = command.view_id.as_deref().unwrap_or_default();
        // Cancel queued startup without creating a late native controller.
        let mut host = state.borrow_mut();
        let pending = std::mem::take(&mut host.pending);
        for pending in pending {
            if pending.view_id.as_deref() == Some(id) {
                protocol::failure(pending.id, "not-found", "Browser tab closed during startup.");
            } else {
                host.pending.push(pending);
            }
        }
        let removed: Vec<_> =
            host.views.values().filter(|view| view.root_id == id).cloned().collect();
        for view in &removed {
            host.views.remove(&view.id);
        }
        drop(host);
        for view in removed {
            if let Err(error) = view.close() {
                protocol::failure(command.id, "runtime-crashed", error);
                return;
            }
        }
        protocol::success(command.id);
        return;
    }
    let Some(view) = view else {
        protocol::failure(command.id, "not-found", "Browser view not found.");
        return;
    };
    if command.op == "import-cookies" {
        let result = import_cookies(&view, command.cookies.as_deref().unwrap_or_default());
        match result {
            Ok(()) => protocol::success(command.id),
            Err(_) => protocol::failure(
                command.id,
                "invalid",
                "Cookie import failed. Some cookies may have been added.",
            ),
        }
        return;
    }
    let result = unsafe {
        match command.op.as_str() {
            "navigate" => {
                if let Some(url) = command.url.filter(|url| allowed_url(url, false)) {
                    *view.requested.borrow_mut() = url.clone();
                    *view.error.borrow_mut() = None;
                    view.webview.Navigate(&HSTRING::from(url))
                } else {
                    Err(windows::core::Error::from(E_INVALIDARG))
                }
            }
            "nav" => match command.action.as_deref() {
                Some("back") => {
                    let mut available = BOOL(0);
                    view.webview.CanGoBack(&mut available).and_then(|_| {
                        if available.as_bool() {
                            view.webview.GoBack()
                        } else {
                            Ok(())
                        }
                    })
                }
                Some("forward") => {
                    let mut available = BOOL(0);
                    view.webview.CanGoForward(&mut available).and_then(|_| {
                        if available.as_bool() {
                            view.webview.GoForward()
                        } else {
                            Ok(())
                        }
                    })
                }
                Some("stop") => {
                    view.loading.set(false);
                    let result = view.webview.Stop();
                    view.push();
                    result
                }
                Some("reload") => {
                    if view.error.borrow().is_some() {
                        view.webview.Navigate(&HSTRING::from(view.requested.borrow().as_str()))
                    } else {
                        view.webview.Reload()
                    }
                }
                _ => Err(windows::core::Error::from(E_INVALIDARG)),
            },
            "bounds" => {
                view.layout(command.bounds.filter(|bounds| bounds.width > 0 && bounds.height > 0))
            }
            "focus" => view.controller.MoveFocus(COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC),
            "focus-host" => SetFocus(Some(view.parent)).map(|_| ()),
            _ => Err(windows::core::Error::from(E_INVALIDARG)),
        }
    };
    match result {
        Ok(()) => protocol::success(command.id),
        Err(error) => {
            view.fail("runtime-crashed", error.to_string());
            protocol::failure(command.id, "runtime-crashed", error);
        }
    }
}

fn import_cookies(view: &View, cookies: &[protocol::ImportCookie]) -> Result<()> {
    if cookies.is_empty() || cookies.len() > 200 {
        return Err(windows::core::Error::from(E_INVALIDARG));
    }
    unsafe {
        let manager = view.webview.cast::<ICoreWebView2_2>()?.CookieManager()?;
        // Prepare the whole batch before modifying the shared profile.
        let mut prepared = Vec::with_capacity(cookies.len());
        for item in cookies {
            let url =
                url::Url::parse(&item.url).map_err(|_| windows::core::Error::from(E_INVALIDARG))?;
            let domain = item
                .domain
                .as_deref()
                .or_else(|| url.host_str())
                .ok_or_else(|| windows::core::Error::from(E_INVALIDARG))?;
            let cookie = manager.CreateCookie(
                &HSTRING::from(&item.name),
                &HSTRING::from(&item.value),
                &HSTRING::from(domain),
                &HSTRING::from(&item.path),
            )?;
            cookie.SetIsSecure(item.secure)?;
            cookie.SetIsHttpOnly(item.http_only)?;
            cookie.SetSameSite(match item.same_site {
                protocol::SameSite::Lax => COREWEBVIEW2_COOKIE_SAME_SITE_KIND_LAX,
                protocol::SameSite::Strict => COREWEBVIEW2_COOKIE_SAME_SITE_KIND_STRICT,
                protocol::SameSite::None => COREWEBVIEW2_COOKIE_SAME_SITE_KIND_NONE,
            })?;
            if let Some(expiry) = item.expiration_date {
                cookie.SetExpires(expiry)?;
            }
            prepared.push(cookie);
        }
        for cookie in prepared {
            manager.AddOrUpdateCookie(&cookie)?;
        }
    }
    Ok(())
}

fn browser_environment_options() -> ICoreWebView2EnvironmentOptions {
    let options = CoreWebView2EnvironmentOptions::default();
    unsafe {
        options.set_allow_single_sign_on_using_os_primary_account(true);
    }
    options.into()
}

#[cfg(test)]
mod sso_tests {
    use super::*;

    #[test]
    fn windows_account_sso_is_enabled_by_default() {
        let options = browser_environment_options();
        let mut enabled = BOOL(0);
        unsafe { options.AllowSingleSignOnUsingOSPrimaryAccount(&mut enabled).unwrap() };
        assert!(enabled.as_bool());
    }
}

fn start_environment(state: &State) {
    state.borrow_mut().initializing = true;
    let profile = state.borrow().profile.clone();
    let options = browser_environment_options();
    let callback_state = state.clone();
    let result = unsafe {
        CreateCoreWebView2EnvironmentWithOptions(
            None,
            &profile,
            &options,
            &CreateCoreWebView2EnvironmentCompletedHandler::create(Box::new(
                move |result, environment| {
                    callback_state.borrow_mut().initializing = false;
                    let pending = std::mem::take(&mut callback_state.borrow_mut().pending);
                    match result.and_then(|_| {
                        environment.ok_or_else(|| windows::core::Error::from(E_POINTER))
                    }) {
                        Ok(environment) => {
                            callback_state.borrow_mut().environment = Some(environment);
                            for command in pending {
                                start_controller(&callback_state, command, None);
                            }
                        }
                        Err(error) => {
                            for command in pending {
                                protocol::failure(command.id, "startup-failed", &error);
                            }
                        }
                    }
                    Ok(())
                },
            )),
        )
    };
    if let Err(error) = result {
        state.borrow_mut().initializing = false;
        for command in std::mem::take(&mut state.borrow_mut().pending) {
            protocol::failure(command.id, "startup-failed", &error);
        }
    }
}

type PopupRequest = (ICoreWebView2NewWindowRequestedEventArgs, ICoreWebView2Deferral, String);

fn startup_failure(
    state: &State,
    popup: &Option<PopupRequest>,
    id: u64,
    reason: &str,
    message: impl std::fmt::Display,
) {
    if let Some((_, deferral, root)) = popup {
        let opener = state.borrow().views.get(root).cloned();
        if let Some(opener) = opener {
            opener.fail("startup-failed", format!("Could not open the sign-in popup: {message}"));
        }
        if let Err(error) = unsafe { deferral.Complete() } {
            eprintln!("WebView2 popup deferral cleanup failed: {error}");
        }
    } else {
        protocol::failure(id, reason, message);
    }
}

fn start_controller(state: &State, command: Command, popup: Option<PopupRequest>) {
    let id = command.view_id.clone().unwrap_or_else(|| format!("clear-{}", command.id));
    let parent = command
        .parent
        .as_ref()
        .and_then(|value| value.parse::<usize>().ok())
        .map(|value| HWND(value as *mut _));
    if command.op != "clear"
        && parent.is_none_or(|parent| !unsafe { IsWindow(Some(parent)) }.as_bool())
    {
        startup_failure(state, &popup, command.id, "no-window", "Desktop window is closed.");
        return;
    }
    let parent = parent.unwrap_or_default();
    let is_popup = popup.is_some();
    let style = if is_popup {
        WS_OVERLAPPEDWINDOW
    } else if parent.0.is_null() {
        WS_POPUP
    } else {
        WS_CHILD | WS_CLIPSIBLINGS | WS_CLIPCHILDREN
    };
    let mut frame = RECT { left: 0, top: 0, right: 480, bottom: 560 };
    if let Some((args, _, _)) = popup.as_ref() {
        let geometry = unsafe { popup_geometry(parent, args) };
        match geometry {
            Ok(bounds) => frame = bounds,
            Err(error) => {
                startup_failure(state, &popup, command.id, "startup-failed", error);
                return;
            }
        }
    }
    let window = match unsafe {
        CreateWindowExW(
            Default::default(),
            w!("CoCBrowserHost"),
            w!("Browser"),
            style,
            frame.left,
            frame.top,
            frame.right - frame.left,
            frame.bottom - frame.top,
            if parent.0.is_null() { None } else { Some(parent) },
            None,
            None,
            None,
        )
    } {
        Ok(window) => window,
        Err(error) => {
            startup_failure(state, &popup, command.id, "startup-failed", error);
            return;
        }
    };
    let environment = state.borrow().environment.clone().unwrap();
    let callback_state = state.clone();
    let immediate_popup = popup.clone();
    let response_id = command.id;
    let result = unsafe {
        environment.CreateCoreWebView2Controller(
            window,
            &CreateCoreWebView2ControllerCompletedHandler::create(Box::new(
                move |result, controller| {
                    let result = result.and_then(|_| {
                        controller.ok_or_else(|| windows::core::Error::from(E_POINTER))
                    });
                    let result = result.and_then(|controller| {
                        let webview = controller.CoreWebView2()?;
                        let root_id = popup
                            .as_ref()
                            .map(|(_, _, root)| root.clone())
                            .unwrap_or_else(|| id.clone());
                        let view = Rc::new(View {
                            id: id.clone(),
                            root_id,
                            parent,
                            window,
                            controller,
                            webview,
                            loading: Cell::new(false),
                            closed: Cell::new(false),
                            requested: RefCell::new(command.url.clone().unwrap_or_default()),
                            error: RefCell::new(None),
                            bounds: Cell::new(None),
                            popup: is_popup,
                            host: Rc::downgrade(&callback_state),
                            fullscreen_window: Cell::new(None),
                        });
                        view.controller.SetIsVisible(false)?;
                        view.webview.Settings()?.SetIsWebMessageEnabled(false)?;
                        view.webview.Settings()?.SetAreDevToolsEnabled(false)?;
                        if command.op == "clear" {
                            clear_profile(view, response_id)?;
                            return Ok(());
                        }
                        if is_popup && !callback_state.borrow().views.contains_key(&view.root_id) {
                            view.close()?;
                            return Err(windows::core::Error::from(E_ABORT));
                        }
                        wire_view(&view, &callback_state)?;
                        WINDOWS.with(|windows| {
                            windows.borrow_mut().insert(window.0 as usize, Rc::downgrade(&view))
                        });
                        callback_state.borrow_mut().views.insert(id.clone(), view.clone());
                        if let Some((args, deferral, _)) = popup.as_ref() {
                            let _ = ShowWindow(window, SW_SHOW);
                            let mut client = RECT::default();
                            GetClientRect(window, &mut client)?;
                            view.controller.SetBounds(client)?;
                            view.controller.SetIsVisible(true)?;
                            view.controller
                                .MoveFocus(COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC)?;
                            args.SetNewWindow(&view.webview)?;
                            args.SetHandled(true)?;
                            deferral.Complete()?;
                        } else {
                            view.webview.Navigate(&HSTRING::from(
                                command.url.as_deref().unwrap_or_default(),
                            ))?;
                            protocol::success(response_id);
                            view.push();
                        }
                        Ok(())
                    });
                    if let Err(error) = result {
                        let partial = callback_state.borrow_mut().views.remove(&id);
                        if let Some(partial) = partial {
                            if let Err(cleanup) = partial.close() {
                                eprintln!("WebView2 partial startup cleanup failed: {cleanup}");
                            }
                        }
                        if IsWindow(Some(window)).as_bool() {
                            let _ = DestroyWindow(window);
                        }
                        startup_failure(
                            &callback_state,
                            &popup,
                            response_id,
                            "startup-failed",
                            error,
                        );
                    }
                    Ok(())
                },
            )),
        )
    };
    if let Err(error) = result {
        unsafe {
            let _ = DestroyWindow(window);
        }
        startup_failure(state, &immediate_popup, response_id, "startup-failed", error);
    }
}

unsafe fn popup_geometry(
    parent: HWND,
    args: &ICoreWebView2NewWindowRequestedEventArgs,
) -> Result<RECT> {
    let features = args.WindowFeatures()?;
    let mut has_size = BOOL(0);
    let mut has_position = BOOL(0);
    features.HasSize(&mut has_size)?;
    features.HasPosition(&mut has_position)?;
    let scale = (GetDpiForWindow(parent) as f64 / 96.0).max(1.0);
    let scaled = |value: u32| (value.min(8192) as f64 * scale).round() as i32;
    let (mut width, mut height) = (480, 560);
    if has_size.as_bool() {
        let (mut requested_width, mut requested_height) = (0, 0);
        features.Width(&mut requested_width)?;
        features.Height(&mut requested_height)?;
        if requested_width > 0 {
            width = scaled(requested_width).max(100);
        }
        if requested_height > 0 {
            height = scaled(requested_height).max(100);
        }
    }
    let mut owner = RECT::default();
    GetWindowRect(parent, &mut owner)?;
    let (mut left, mut top) = (
        owner.left + (owner.right - owner.left - width) / 2,
        owner.top + (owner.bottom - owner.top - height) / 2,
    );
    if has_position.as_bool() {
        let (mut requested_left, mut requested_top) = (0, 0);
        features.Left(&mut requested_left)?;
        features.Top(&mut requested_top)?;
        left = scaled(requested_left);
        top = scaled(requested_top);
    }
    Ok(RECT { left, top, right: left + width, bottom: top + height })
}

fn clear_profile(view: Rc<View>, id: u64) -> Result<()> {
    unsafe {
        let profile =
            view.webview.cast::<ICoreWebView2_13>()?.Profile()?.cast::<ICoreWebView2Profile2>()?;
        profile.ClearBrowsingDataAll(&ClearBrowsingDataCompletedHandler::create(Box::new(
            move |result| {
                let result = result.and_then(|_| view.close());
                match result {
                    Ok(()) => protocol::success(id),
                    Err(error) => protocol::failure(id, "cleanup-failed", error),
                }
                Ok(())
            },
        )))?;
    }
    Ok(())
}

fn wire_view(view: &Rc<View>, state: &State) -> Result<()> {
    let weak = Rc::downgrade(view);
    let mut token = 0;
    unsafe {
        view.webview.add_NavigationStarting(
            &NavigationStartingEventHandler::create(Box::new(move |_, args| {
                let (Some(view), Some(args)) = (weak.upgrade(), args) else {
                    return Ok(());
                };
                if view.closed.get() {
                    args.SetCancel(true)?;
                    return Ok(());
                }
                let mut url = PWSTR::null();
                args.Uri(&mut url)?;
                let url = CoTaskMemPWSTR::from(url).to_string();
                if !allowed_url(&url, true) {
                    args.SetCancel(true)?;
                    return Ok(());
                }
                *view.requested.borrow_mut() = url;
                *view.error.borrow_mut() = None;
                view.loading.set(true);
                view.push();
                Ok(())
            })),
            &mut token,
        )?;
        let weak = Rc::downgrade(view);
        view.webview.add_NavigationCompleted(
            &NavigationCompletedEventHandler::create(Box::new(move |_, args| {
                let (Some(view), Some(args)) = (weak.upgrade(), args) else {
                    return Ok(());
                };
                if view.closed.get() {
                    return Ok(());
                }
                view.loading.set(false);
                let mut success = BOOL(0);
                args.IsSuccess(&mut success)?;
                if !success.as_bool() {
                    let mut status = COREWEBVIEW2_WEB_ERROR_STATUS_UNKNOWN;
                    args.WebErrorStatus(&mut status)?;
                    if status != COREWEBVIEW2_WEB_ERROR_STATUS_OPERATION_CANCELED {
                        *view.error.borrow_mut() = Some((
                            "navigation-failed".into(),
                            format!("Navigation failed ({})", status.0),
                        ));
                    }
                }
                view.push();
                Ok(())
            })),
            &mut token,
        )?;
        let weak = Rc::downgrade(view);
        view.webview.add_SourceChanged(
            &SourceChangedEventHandler::create(Box::new(move |_, _| {
                if let Some(view) = weak.upgrade() {
                    view.push();
                }
                Ok(())
            })),
            &mut token,
        )?;
        let weak = Rc::downgrade(view);
        view.webview.add_HistoryChanged(
            &HistoryChangedEventHandler::create(Box::new(move |_, _| {
                if let Some(view) = weak.upgrade() {
                    view.push();
                }
                Ok(())
            })),
            &mut token,
        )?;
        let weak = Rc::downgrade(view);
        view.webview.add_DocumentTitleChanged(
            &DocumentTitleChangedEventHandler::create(Box::new(move |_, _| {
                if let Some(view) = weak.upgrade() {
                    if view.popup {
                        let mut title = PWSTR::null();
                        view.webview.DocumentTitle(&mut title)?;
                        let title = CoTaskMemPWSTR::from(title);
                        SetWindowTextW(view.window, *title.as_ref().as_pcwstr())?;
                    } else {
                        view.push();
                    }
                }
                Ok(())
            })),
            &mut token,
        )?;
        view.webview.add_PermissionRequested(
            &PermissionRequestedEventHandler::create(Box::new(|_, args| {
                if let Some(args) = args {
                    args.SetState(COREWEBVIEW2_PERMISSION_STATE_DENY)?;
                }
                // Clipboard write and fullscreen use the normal secure-context/gesture rules.
                Ok(())
            })),
            &mut token,
        )?;
        let weak = Rc::downgrade(view);
        view.webview.add_ProcessFailed(&ProcessFailedEventHandler::create(Box::new(move |_, args| {
            if let Some(view) = weak.upgrade() {
                let mut kind = COREWEBVIEW2_PROCESS_FAILED_KIND_BROWSER_PROCESS_EXITED;
                if let Some(args) = args { args.ProcessFailedKind(&mut kind)?; }
                view.fail("runtime-crashed", format!("WebView2 process failed ({}). Retry or select Electron in Desktop Preferences.", kind.0));
            }
            Ok(())
        })), &mut token)?;
        let weak = Rc::downgrade(view);
        view.webview.cast::<ICoreWebView2_4>()?.add_DownloadStarting(
            &DownloadStartingEventHandler::create(Box::new(move |_, args| {
                let (Some(view), Some(args)) = (weak.upgrade(), args) else {
                    return Ok(());
                };
                args.SetCancel(true)?;
                args.SetHandled(true)?;
                let mut url = PWSTR::null();
                args.DownloadOperation()?.Uri(&mut url)?;
                let url = CoTaskMemPWSTR::from(url).to_string();
                if !view.closed.get() {
                    protocol::emit(
                        json!({ "event": "download", "viewId": view.root_id, "url": url }),
                    );
                }
                Ok(())
            })),
            &mut token,
        )?;
        let weak = Rc::downgrade(view);
        view.controller.add_AcceleratorKeyPressed(
            &AcceleratorKeyPressedEventHandler::create(Box::new(move |_, args| {
                let (Some(view), Some(args)) = (weak.upgrade(), args) else {
                    return Ok(());
                };
                if view.closed.get() || view.popup || view.bounds.get().is_none() {
                    return Ok(());
                }
                let mut kind = COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN;
                let mut key = 0;
                args.KeyEventKind(&mut kind)?;
                args.VirtualKey(&mut key)?;
                let open_menu = protocol::open_menu_shortcut(
                    key,
                    kind == COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN,
                    GetKeyState(VK_CONTROL.0 as i32) < 0,
                    GetKeyState(VK_MENU.0 as i32) < 0,
                    GetKeyState(VK_SHIFT.0 as i32) < 0,
                );
                let focus_address = protocol::focus_address_shortcut(
                    key,
                    kind == COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN,
                    GetKeyState(VK_CONTROL.0 as i32) < 0,
                    GetKeyState(VK_MENU.0 as i32) < 0,
                    GetKeyState(VK_SHIFT.0 as i32) < 0,
                );
                if !open_menu && !focus_address && !protocol::close_shortcut(
                    key,
                    kind == COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN,
                    GetKeyState(VK_CONTROL.0 as i32) < 0,
                    GetKeyState(VK_MENU.0 as i32) < 0,
                ) {
                    return Ok(());
                }
                args.SetHandled(true)?;
                let mut status = COREWEBVIEW2_PHYSICAL_KEY_STATUS::default();
                args.PhysicalKeyStatus(&mut status)?;
                if !status.WasKeyDown.as_bool() {
                    protocol::emit(json!({ "event": if focus_address { "focus-address-requested" } else if open_menu { "open-menu-requested" } else { "close-requested" }, "viewId": view.id }));
                }
                Ok(())
            })),
            &mut token,
        )?;
        let weak = Rc::downgrade(view);
        view.controller.add_MoveFocusRequested(
            &MoveFocusRequestedEventHandler::create(Box::new(move |_, args| {
                if let Some(view) = weak.upgrade() {
                    if view.closed.get() || view.popup {
                        return Ok(());
                    }
                    if let Some(args) = args {
                        args.SetHandled(true)?;
                    }
                    protocol::emit(json!({ "event": "focus-host", "viewId": view.root_id }));
                }
                Ok(())
            })),
            &mut token,
        )?;
        let weak = Rc::downgrade(view);
        view.webview.add_ContainsFullScreenElementChanged(&ContainsFullScreenElementChangedEventHandler::create(Box::new(move |_, _| {
            if let Some(view) = weak.upgrade() {
                if view.closed.get() { return Ok(()); }
                let mut fullscreen = BOOL(0);
                view.webview.ContainsFullScreenElement(&mut fullscreen)?;
                if view.popup { return view.popup_fullscreen(fullscreen.as_bool()); }
                protocol::emit(json!({ "event": "fullscreen", "viewId": view.root_id, "fullscreen": fullscreen.as_bool() }));
            }
            Ok(())
        })), &mut token)?;
        let weak = Rc::downgrade(view);
        let callback_state = Rc::downgrade(state);
        view.webview.add_NewWindowRequested(
            &NewWindowRequestedEventHandler::create(Box::new(move |_, args| {
                let (Some(view), Some(args)) = (weak.upgrade(), args) else {
                    return Ok(());
                };
                let Some(callback_state) = callback_state.upgrade() else {
                    return Ok(());
                };
                args.SetHandled(true)?;
                if view.closed.get() {
                    return Ok(());
                }
                let mut url = PWSTR::null();
                args.Uri(&mut url)?;
                let url = CoTaskMemPWSTR::from(url).to_string();
                let features = args.WindowFeatures()?;
                let mut size = BOOL(0);
                let mut position = BOOL(0);
                let mut toolbar = BOOL(0);
                features.HasSize(&mut size)?;
                features.HasPosition(&mut position)?;
                features.ShouldDisplayToolbar(&mut toolbar)?;
                let popup = size.as_bool() || position.as_bool() || !toolbar.as_bool();
                if !allowed_url(&url, popup) {
                    return Ok(());
                }
                if !popup {
                    protocol::emit(
                        json!({ "event": "new-tab", "viewId": view.root_id, "url": url }),
                    );
                    return Ok(());
                }
                let deferral = args.GetDeferral()?;
                let mut host = callback_state.borrow_mut();
                host.next_popup += 1;
                let id = format!("{}:popup:{}", view.root_id, host.next_popup);
                drop(host);
                let command = Command {
                    id: 0,
                    op: "open".into(),
                    view_id: Some(id),
                    parent: Some((view.parent.0 as usize).to_string()),
                    url: Some(url),
                    bounds: None,
                    action: None,
                    cookies: None,
                };
                start_controller(
                    &callback_state,
                    command,
                    Some((args, deferral, view.root_id.clone())),
                );
                Ok(())
            })),
            &mut token,
        )?;
        let weak = Rc::downgrade(view);
        view.webview.add_WindowCloseRequested(
            &WindowCloseRequestedEventHandler::create(Box::new(move |_, _| {
                if let Some(view) = weak.upgrade() {
                    if view.popup {
                        view.close()?;
                    }
                }
                Ok(())
            })),
            &mut token,
        )?;
    }
    Ok(())
}

extern "system" fn window_proc(
    window: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    let view =
        WINDOWS.with(|windows| windows.borrow().get(&(window.0 as usize)).and_then(Weak::upgrade));
    if let Some(view) = view {
        let result = unsafe {
            match message {
                WM_CLOSE => view.close(),
                WM_SETFOCUS => {
                    view.controller.MoveFocus(COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC)
                }
                WM_SIZE if view.popup => {
                    let mut rect = RECT::default();
                    GetClientRect(window, &mut rect).and_then(|_| view.controller.SetBounds(rect))
                }
                WM_DPICHANGED => view.layout(view.bounds.get()),
                _ => return DefWindowProcW(window, message, wparam, lparam),
            }
        };
        if let Err(error) = result {
            view.fail("runtime-crashed", error.to_string());
        }
        LRESULT(0)
    } else {
        unsafe { DefWindowProcW(window, message, wparam, lparam) }
    }
}
