//! One generic `Task` for every "run this on a libuv worker, resolve with the
//! result" binding, so a binding is a closure rather than a struct plus impl.

use napi::bindgen_prelude::{Error, Result, Task, ToNapiValue, TypeName};
use napi::Env;

type Job<T> = Box<dyn FnOnce() -> Result<T> + Send>;

/// A boxed closure run once on a worker; its value resolves the promise as is.
pub struct Blocking<T> {
    job: Option<Job<T>>,
    on_error: Option<Box<dyn FnOnce(Env, Error) -> Error + Send>>,
}

impl<T> Blocking<T> {
    pub fn new(job: impl FnOnce() -> Result<T> + Send + 'static) -> Self {
        Self { job: Some(Box::new(job)), on_error: None }
    }

    /// Map worker errors on the Node thread, where runtime diagnostics are available.
    pub fn map_error(mut self, mapper: impl FnOnce(Env, Error) -> Error + Send + 'static) -> Self {
        self.on_error = Some(Box::new(mapper));
        self
    }
}

impl<T: ToNapiValue + TypeName + Send + 'static> Task for Blocking<T> {
    type Output = T;
    type JsValue = T;

    fn compute(&mut self) -> Result<T> {
        (self.job.take().expect("a Blocking task computes once"))()
    }

    fn reject(&mut self, env: Env, error: Error) -> Result<T> {
        Err(match self.on_error.take() {
            Some(mapper) => mapper(env, error),
            None => error,
        })
    }

    fn resolve(&mut self, _env: Env, output: T) -> Result<T> {
        Ok(output)
    }
}
