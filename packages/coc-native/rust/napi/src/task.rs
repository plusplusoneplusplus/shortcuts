//! One generic `Task` for every "run this on a libuv worker, resolve with the
//! result" binding, so a binding is a closure rather than a struct plus impl.

use napi::bindgen_prelude::{AsyncTask, Result, Task, ToNapiValue, TypeName};
use napi::Env;

type Job<T> = Box<dyn FnOnce() -> Result<T> + Send>;

/// A boxed closure run once on a worker; its value resolves the promise as is.
pub struct Blocking<T>(Option<Job<T>>);

impl<T: ToNapiValue + TypeName + Send + 'static> Task for Blocking<T> {
    type Output = T;
    type JsValue = T;

    fn compute(&mut self) -> Result<T> {
        (self.0.take().expect("a Blocking task computes once"))()
    }

    fn resolve(&mut self, _env: Env, output: T) -> Result<T> {
        Ok(output)
    }
}

/// Run `job` off the event loop and resolve with what it returns.
pub fn blocking<T, F>(job: F) -> AsyncTask<Blocking<T>>
where
    T: ToNapiValue + TypeName + Send + 'static,
    F: FnOnce() -> Result<T> + Send + 'static,
{
    AsyncTask::new(Blocking(Some(Box::new(job))))
}
