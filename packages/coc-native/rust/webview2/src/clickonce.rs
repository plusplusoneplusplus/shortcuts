use serde::Deserialize;
use std::io::{self, Read};

pub fn valid_url(value: &str) -> bool {
    value.encode_utf16().count() <= 2048
        && !value.chars().any(|c| c.is_whitespace() || c.is_control() || c == '\\')
        && url::Url::parse(value).is_ok_and(|url| {
            value.get(..8).is_some_and(|prefix| prefix.eq_ignore_ascii_case("https://"))
                && value.as_bytes().get(8).is_some_and(|byte| !matches!(byte, b'/' | b'?' | b'#'))
                && url.scheme() == "https"
                && url.host_str().is_some()
                && url.username().is_empty()
                && url.password().is_none()
                && url.fragment().is_none()
        })
}

pub fn deployment_url(value: &str) -> bool {
    valid_url(value)
        && url::Url::parse(value)
            .is_ok_and(|url| url.path().to_ascii_lowercase().ends_with(".application"))
}

pub fn deployment_download(value: &str, mime: &str) -> bool {
    valid_url(value)
        && (deployment_url(value)
            || mime
                .split(';')
                .next()
                .unwrap_or("")
                .trim()
                .eq_ignore_ascii_case("application/x-ms-application"))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Activation {
    url: String,
}

fn activation_status(code: i32) -> &'static str {
    match code as u32 {
        0 => "accepted",
        0x800704c7 | 0x80004004 => "cancelled",
        _ => "activation-failed",
    }
}

pub fn run(check: bool) {
    let status = if check {
        native::activate(None)
    } else {
        let mut input = String::new();
        match io::stdin().take(16_385).read_to_string(&mut input) {
            Ok(_) if input.len() <= 16_384 => match serde_json::from_str::<Activation>(&input) {
                Ok(request) if valid_url(&request.url) => native::activate(Some(&request.url)),
                _ => "invalid",
            },
            _ => "invalid",
        }
    };
    crate::protocol::emit(serde_json::json!({ "status": status }));
}

#[cfg(all(target_os = "windows", target_arch = "x86_64"))]
mod native {
    use windows::{
        core::{w, HRESULT, PCSTR},
        Win32::{
            Foundation::FreeLibrary,
            System::LibraryLoader::{GetProcAddress, LoadLibraryExW, LOAD_LIBRARY_SEARCH_SYSTEM32},
        },
    };

    pub fn activate(url: Option<&str>) -> &'static str {
        // Documented ClickOnce unmanaged API; never resolve DLLs from the working directory.
        unsafe {
            let library = match LoadLibraryExW(w!("dfshim.dll"), None, LOAD_LIBRARY_SEARCH_SYSTEM32)
            {
                Ok(library) => library,
                Err(error) => {
                    return match error.code().0 as u32 {
                        0x80070002 | 0x8007007e => "missing-handler",
                        _ => "activation-failed",
                    }
                }
            };
            let result = match GetProcAddress(library, PCSTR(c"LaunchApplication".as_ptr().cast()))
            {
                Some(address) => {
                    if let Some(url) = url {
                        let wide: Vec<u16> = url.encode_utf16().chain(Some(0)).collect();
                        let launch: unsafe extern "system" fn(
                            *const u16,
                            *mut std::ffi::c_void,
                            u32,
                        ) -> HRESULT = std::mem::transmute(address);
                        super::activation_status(launch(wide.as_ptr(), std::ptr::null_mut(), 0).0)
                    } else {
                        "available"
                    }
                }
                None => "missing-handler",
            };
            let _ = FreeLibrary(library);
            result
        }
    }
}

#[cfg(not(all(target_os = "windows", target_arch = "x86_64")))]
mod native {
    pub fn activate(_: Option<&str>) -> &'static str {
        "unsupported-platform"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reports_only_s_ok_as_acceptance_and_distinguishes_cancellation() {
        assert_eq!(activation_status(0), "accepted");
        assert_eq!(activation_status(0x800704c7u32 as i32), "cancelled");
        assert_eq!(activation_status(0x80004004u32 as i32), "cancelled");
        assert_eq!(activation_status(0x80004005u32 as i32), "activation-failed");
        assert_eq!(activation_status(1), "activation-failed");
    }

    #[test]
    fn recognizes_only_https_deployments_or_the_deployment_mime() {
        assert!(deployment_url("https://fixture.test/App.APPLICATION?value=a%2Fb&value=two"));
        assert!(deployment_download(
            "https://fixture.test/deploy?id=synthetic",
            "Application/X-MS-Application; charset=utf-8"
        ));
        assert!(!deployment_download("https://fixture.test/report.pdf", "application/pdf"));
        for value in [
            "http://fixture.test/app.application",
            "file:///app.application",
            "https://user:password@fixture.test/app.application",
            "https://fixture.test/app.application#fragment",
            "https://fixture.test\\app.application",
            "https://fixture.test/app.application\n",
        ] {
            assert!(!deployment_url(value));
        }
        assert!(!valid_url(&format!("https://fixture.test/{}", "a".repeat(2048))));
        let prefix = "https://fixture.test/app.application?value=";
        assert!(valid_url(&format!("{prefix}{}", "a".repeat(2048 - prefix.len()))));
        assert!(!valid_url("https:///fixture.test/app.application"));
    }
}
