use super::*;

#[derive(Default)]
struct Calls {
    cancelled: Cell<bool>,
    handled: Cell<bool>,
    completed: Cell<usize>,
    order: RefCell<Vec<&'static str>>,
    fail: Cell<Option<&'static str>>,
}

#[implement(ICoreWebView2Deferral)]
struct Deferral(Rc<Calls>);

impl ICoreWebView2Deferral_Impl for Deferral_Impl {
    fn Complete(&self) -> Result<()> {
        self.0.completed.set(self.0.completed.get() + 1);
        self.0.order.borrow_mut().push("complete");
        if self.0.fail.get() == Some("complete") {
            Err(windows::core::Error::from(E_FAIL))
        } else {
            Ok(())
        }
    }
}

#[implement(ICoreWebView2DownloadStartingEventArgs)]
struct Args {
    calls: Rc<Calls>,
    deferral: ICoreWebView2Deferral,
}

impl ICoreWebView2DownloadStartingEventArgs_Impl for Args_Impl {
    fn DownloadOperation(&self) -> Result<ICoreWebView2DownloadOperation> {
        Err(windows::core::Error::from(E_NOTIMPL))
    }
    fn Cancel(&self, value: *mut BOOL) -> Result<()> {
        unsafe {
            *value = self.calls.cancelled.get().into();
        }
        Ok(())
    }
    fn SetCancel(&self, value: BOOL) -> Result<()> {
        self.calls.order.borrow_mut().push(if value.as_bool() { "cancel" } else { "approve" });
        if !value.as_bool() && self.calls.fail.get() == Some("approve") {
            return Err(windows::core::Error::from(E_FAIL));
        }
        self.calls.cancelled.set(value.as_bool());
        Ok(())
    }
    fn ResultFilePath(&self, _: *mut PWSTR) -> Result<()> {
        Err(windows::core::Error::from(E_NOTIMPL))
    }
    fn SetResultFilePath(&self, _: &PCWSTR) -> Result<()> {
        self.calls.order.borrow_mut().push("path");
        if self.calls.fail.get() == Some("path") {
            Err(windows::core::Error::from(E_FAIL))
        } else {
            Ok(())
        }
    }
    fn Handled(&self, value: *mut BOOL) -> Result<()> {
        unsafe {
            *value = self.calls.handled.get().into();
        }
        Ok(())
    }
    fn SetHandled(&self, value: BOOL) -> Result<()> {
        self.calls.order.borrow_mut().push("handled");
        self.calls.handled.set(value.as_bool());
        Ok(())
    }
    fn GetDeferral(&self) -> Result<ICoreWebView2Deferral> {
        Ok(self.deferral.clone())
    }
}

fn held(fail: Option<&'static str>) -> (Held, Rc<Calls>) {
    let calls = Rc::new(Calls::default());
    calls.cancelled.set(true);
    calls.fail.set(fail);
    let deferral: ICoreWebView2Deferral = Deferral(calls.clone()).into();
    let args: ICoreWebView2DownloadStartingEventArgs =
        Args { calls: calls.clone(), deferral: deferral.clone() }.into();
    (Held { args, deferral: Some(deferral) }, calls)
}

#[test]
fn approval_sets_original_args_path_before_uncancelling_and_completes_once() {
    let (held, calls) = held(None);
    unsafe { held.approve(r"C:\Downloads\fixture.txt") }.unwrap();
    assert!(!calls.cancelled.get());
    assert!(calls.handled.get());
    assert_eq!(calls.completed.get(), 1);
    assert_eq!(*calls.order.borrow(), ["path", "handled", "approve", "complete"]);
}

#[test]
fn abandoning_or_timing_out_a_deferral_cancels_and_completes_once() {
    let (held, calls) = held(None);
    drop(held);
    assert!(calls.cancelled.get());
    assert!(calls.handled.get());
    assert_eq!(calls.completed.get(), 1);
    assert_eq!(*calls.order.borrow(), ["cancel", "handled", "complete"]);
}

#[test]
fn approval_setup_failure_stays_cancelled_and_settles_the_original_deferral() {
    for step in ["path", "approve"] {
        let (held, calls) = held(Some(step));
        assert!(unsafe { held.approve(r"C:\Downloads\fixture.txt") }.is_err());
        assert!(calls.cancelled.get());
        assert_eq!(calls.completed.get(), 1);
    }
}

#[test]
fn failed_completion_is_not_replayed_by_drop() {
    let (held, calls) = held(Some("complete"));
    assert!(unsafe { held.approve(r"C:\Downloads\fixture.txt") }.is_err());
    assert!(calls.cancelled.get());
    assert_eq!(calls.completed.get(), 1);
}
