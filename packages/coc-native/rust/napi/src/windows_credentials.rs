use napi::bindgen_prelude::{AsyncTask, Error};
use napi_derive::napi;

use crate::task::Blocking;

/// Read the UTF-8 blob of one exact Windows generic credential.
#[napi(ts_return_type = "Promise<string | null>")]
pub fn read_windows_credential(target: String) -> AsyncTask<Blocking<Option<String>>> {
    AsyncTask::new(Blocking::new(move || {
        coc_native_core::windows_credentials::read(&target).map_err(Error::from_reason)
    }))
}
