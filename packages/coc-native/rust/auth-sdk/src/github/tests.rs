use super::*;
use serde_json::json;
use std::time::Duration;

fn account(host: &str, login: &str) -> GitHubAccount {
    GitHubAccount { host: host.into(), login: login.into() }
}
fn options(path: PathBuf, account: CopilotAccountSelection) -> GitHubCredentialOptions {
    GitHubCredentialOptions {
        source: GitHubCredentialSource::CopilotCliConfig { config_path: path, account },
        timeout_ms: 10_000,
    }
}
fn read_file(
    path: &std::path::Path,
    selection: &CopilotAccountSelection,
) -> Result<(GitHubAccount, Option<Secret>)> {
    config::read(
        path,
        selection,
        &CancellationToken::new(),
        tokio::time::Instant::now() + Duration::from_secs(10),
    )
}

#[test]
fn host_validation_preserves_exact_selection_and_rejects_url_authority_extras() {
    for host in ["github.com", "GitHub.COM", "https://GitHub.COM", "https://GitHub.COM/"] {
        assert_eq!(normalize_host(host).unwrap(), "github.com");
    }
    for host in [
        "",
        "--host",
        "http://github.com",
        "https://github.com:443",
        "https://github.com:8443",
        "https://fixture@github.com",
        "https://github.com/path",
        "https://github.com?",
        "https://github.com#",
        "github.com/",
        "github.com\\",
        "https://github.com/../",
        "https://github.com//",
        "github.com\n",
        "https://[::1]",
    ] {
        assert_eq!(normalize_host(host).err().unwrap().code, ErrorCode::InvalidConfiguration);
    }
    for login in ["", "fixture login", "fixture:other", "fixture\0other"] {
        assert_eq!(
            account("github.com", login).normalized().err().unwrap().code,
            ErrorCode::InvalidConfiguration
        );
    }
}

#[tokio::test]
async fn jsonc_exact_keys_explicit_selection_and_each_call_reresolves_active_account() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("config.json");
    let stored = json!({
        "lastLoggedInUser": {"host":"https://GitHub.COM","login":"fixture"},
        "copilotTokens": {"https://GitHub.COM:fixture":"gho_exact",
            "github.com:fixture":"gho_wrong", "github.com:other":"gho_other"},
        "url": "https://example.com"
    });
    let text = format!("  // CLI header\r\n{}\n // footer\n", stored);
    std::fs::write(&path, &text).unwrap();
    let selected = options(path.clone(), CopilotAccountSelection::ActiveCliAccount);
    let first = read_credential(selected.clone(), &CancellationToken::new()).await.unwrap();
    assert_eq!(first.account.host, "github.com");
    assert_eq!(first.account.login, "fixture");
    assert_eq!(first.token.expose(), "gho_exact");
    assert_eq!(std::fs::read_to_string(&path).unwrap(), text);
    let pinned = read_credential(
        options(path.clone(), CopilotAccountSelection::Explicit(account("github.com", "other"))),
        &CancellationToken::new(),
    )
    .await
    .unwrap();
    assert_eq!(pinned.token.expose(), "gho_other");
    let mut changed = stored;
    changed["lastLoggedInUser"] = json!({"host":"github.com","login":"other"});
    std::fs::write(&path, changed.to_string()).unwrap();
    let next = read_credential(selected, &CancellationToken::new()).await.unwrap();
    assert_eq!(next.account.login, "other");
    assert_eq!(next.token.expose(), "gho_other");
    assert_eq!(first.token.expose(), "gho_exact");
}

#[tokio::test]
async fn only_absent_null_empty_file_token_allows_exact_os_lookup() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("config.json");
    let selection = CopilotAccountSelection::Explicit(account("https://GitHub.COM", "fixture"));
    for token in
        [ValueToken::Absent, ValueToken::Present(json!(null)), ValueToken::Present(json!(""))]
    {
        let mut value = json!({"copilotTokens":{"github.com:fixture":"gho_wrong"}});
        if let ValueToken::Present(token) = token {
            value["copilotTokens"]["https://GitHub.COM:fixture"] = token;
        }
        std::fs::write(&path, value.to_string()).unwrap();
        let (stored, token) = read_file(&path, &selection).unwrap();
        assert_eq!(stored.host, "https://GitHub.COM");
        assert_eq!(stored.login, "fixture");
        assert!(token.is_none());
    }
    for token in [json!(123), json!({}), json!([]), json!(false)] {
        std::fs::write(
            &path,
            json!({"copilotTokens":{"https://GitHub.COM:fixture":token}}).to_string(),
        )
        .unwrap();
        assert_eq!(
            read_file(&path, &selection).err().unwrap().code,
            ErrorCode::InvalidTokenResponse
        );
    }
    for token in ["ghp_not_for_copilot", "unsupported", " "] {
        std::fs::write(
            &path,
            json!({"copilotTokens":{"https://GitHub.COM:fixture":token}}).to_string(),
        )
        .unwrap();
        assert_eq!(read_file(&path, &selection).unwrap().1.unwrap().expose(), token);
    }
}
enum ValueToken {
    Absent,
    Present(serde_json::Value),
}

#[tokio::test]
async fn bounded_config_rejects_malformed_non_objects_missing_selection_and_invalid_account() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("config.json");
    let selection = CopilotAccountSelection::ActiveCliAccount;
    assert_eq!(read_file(&path, &selection).err().unwrap().code, ErrorCode::StorageFailed);
    for text in [
        "null",
        "[]",
        "\"fixture\"",
        "{}",
        "{\"gho_private\":",
        r#"{"lastLoggedInUser":{"host":"http://github.com","login":"fixture"}}"#,
        r#"{"lastLoggedInUser":{"host":"github.com","login":"invalid login"}}"#,
    ] {
        std::fs::write(&path, text).unwrap();
        let error = read_file(&path, &selection).err().unwrap();
        assert_eq!(error.code, ErrorCode::InvalidTokenResponse);
        assert!(!format!("{error:?} {error}").contains("private"));
    }
    let base = json!({"lastLoggedInUser":{"host":"github.com","login":"fixture"},
        "copilotTokens":{"github.com:fixture":"gho_fixture"}})
    .to_string();
    let exact = format!("{}{}", base, " ".repeat(1024 * 1024 - base.len()));
    std::fs::write(&path, &exact).unwrap();
    assert_eq!(read_file(&path, &selection).unwrap().1.unwrap().expose(), "gho_fixture");
    std::fs::write(&path, format!("{exact} ")).unwrap();
    assert_eq!(read_file(&path, &selection).err().unwrap().code, ErrorCode::InvalidTokenResponse);
    assert!(matches!(
        read_file(dir.path(), &selection).err().unwrap().code,
        ErrorCode::InvalidTokenResponse | ErrorCode::StorageFailed
    ));
}

#[tokio::test]
async fn cancellation_and_invalid_options_do_not_start_acquisition() {
    let cancel = CancellationToken::new();
    cancel.cancel();
    let dir = tempfile::tempdir().unwrap();
    let request = options(dir.path().join("missing"), CopilotAccountSelection::ActiveCliAccount);
    assert_eq!(
        read_credential(request.clone(), &cancel).await.err().unwrap().code,
        ErrorCode::Cancelled
    );
    for timeout_ms in [0, 10_001] {
        assert_eq!(
            GitHubCredentialOptions { timeout_ms, ..request.clone() }
                .validate()
                .err()
                .unwrap()
                .code,
            ErrorCode::InvalidConfiguration
        );
    }
    assert_eq!(
        options("relative.json".into(), CopilotAccountSelection::ActiveCliAccount)
            .validate()
            .err()
            .unwrap()
            .code,
        ErrorCode::InvalidConfiguration
    );
}

#[cfg(target_os = "linux")]
#[tokio::test]
async fn linux_missing_file_token_is_explicitly_unavailable() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("config.json");
    std::fs::write(&path, r#"{"lastLoggedInUser":{"host":"github.com","login":"fixture"}}"#)
        .unwrap();
    assert_eq!(
        read_credential(
            options(path, CopilotAccountSelection::ActiveCliAccount),
            &CancellationToken::new()
        )
        .await
        .err()
        .unwrap()
        .code,
        ErrorCode::StorageUnavailable
    );
}

#[test]
fn gh_argv_and_child_environment_are_explicit() {
    let command = gh_command(&account("GitHub.COM", "fixture"));
    let std = command.as_std();
    assert_eq!(
        std.get_args().map(|a| a.to_str().unwrap()).collect::<Vec<_>>(),
        ["auth", "token", "--hostname", "GitHub.COM", "--user", "fixture"]
    );
    let removals = std
        .get_envs()
        .filter(|(_, value)| value.is_none())
        .map(|(name, _)| name.to_str().unwrap())
        .collect::<Vec<_>>();
    for name in ["GH_TOKEN", "GITHUB_TOKEN", "GH_ENTERPRISE_TOKEN", "GITHUB_ENTERPRISE_TOKEN"] {
        assert!(removals.contains(&name));
    }
}

#[cfg(target_os = "macos")]
#[tokio::test]
#[ignore = "Explicit isolated CLI Keychain fixture"]
async fn isolated_macos_cli_keychain_fixture() {
    use security_framework::passwords::{delete_generic_password, set_generic_password};
    let login = format!(
        "fixture-{}-{}",
        std::process::id(),
        std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
    );
    let selected = account("https://GitHub.COM", &login);
    let key = format!("{}:{}", selected.host, selected.login);
    struct Cleanup(String);
    impl Drop for Cleanup {
        fn drop(&mut self) {
            let _ = delete_generic_password("copilot-cli", &self.0);
        }
    }
    let _cleanup = Cleanup(key.clone());
    set_generic_password("copilot-cli", &key, b"gho_os_fixture").unwrap();
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("config.json");
    std::fs::write(&path, "{}").unwrap();
    let request = options(path.clone(), CopilotAccountSelection::Explicit(selected));
    assert_eq!(
        read_credential(request.clone(), &CancellationToken::new()).await.unwrap().token.expose(),
        "gho_os_fixture"
    );
    std::fs::write(&path, json!({"copilotTokens":{key:"unsupported_file_fixture"}}).to_string())
        .unwrap();
    assert_eq!(
        read_credential(request, &CancellationToken::new()).await.unwrap().token.expose(),
        "unsupported_file_fixture"
    );
}

fn fixture_command(dir: &std::path::Path, body: &str) -> Command {
    let path = dir.join(if cfg!(windows) { "fixture.cmd" } else { "fixture" });
    std::fs::write(&path, body).unwrap();
    #[cfg(windows)]
    {
        let mut command =
            Command::new(std::env::var_os("COMSPEC").unwrap_or_else(|| "cmd.exe".into()));
        command.args(["/d", "/c"]).arg(path);
        command
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o700)).unwrap();
        Command::new(path)
    }
}

#[tokio::test]
async fn process_exit_output_bounds_and_missing_binary_have_secret_free_errors() {
    let dir = tempfile::tempdir().unwrap();
    for (script, expected) in [
        (
            if cfg!(windows) {
                "@echo off\r\necho gho_private\r\nexit /b 1"
            } else {
                "#!/bin/sh\nprintf gho_private\nexit 1"
            },
            ErrorCode::LoginRequired,
        ),
        (
            if cfg!(windows) {
                "@echo off\r\nfor /l %%i in (1,1,2000) do @echo gho_private"
            } else {
                "#!/bin/sh\ni=0; while [ $i -lt 2000 ]; do printf gho_private; i=$((i+1)); done"
            },
            ErrorCode::InvalidTokenResponse,
        ),
    ] {
        let error = command_token(fixture_command(dir.path(), script)).await.err().unwrap();
        assert_eq!(error.code, expected);
        assert!(!error.to_string().contains("gho_private"));
    }
    let error = command_token(Command::new(dir.path().join("missing"))).await.err().unwrap();
    assert_eq!(error.code, ErrorCode::CliUnavailable);
}

#[tokio::test]
async fn dropped_process_work_kills_descendants_on_cancel_and_timeout() {
    for cancel_operation in [true, false] {
        let dir = tempfile::tempdir().unwrap();
        let marker = dir.path().join("late");
        let script = if cfg!(windows) {
            format!("@echo off\r\n\"%SystemRoot%\\System32\\ping.exe\" -n 3 127.0.0.1 >nul\r\necho late>\"{}\"", marker.display())
        } else {
            format!("#!/bin/sh\n/bin/sleep 1\nprintf late > '{}'", marker.display())
        };
        let work = command_token(fixture_command(dir.path(), &script));
        let cancellation = CancellationToken::new();
        let other = cancellation.clone();
        let trigger = tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(100)).await;
            other.cancel();
        });
        if cancel_operation {
            tokio::select! { biased; _ = cancellation.cancelled() => {}, result = work => panic!("early completion {:?}", result.err().map(|e| e.code)) }
        } else {
            assert!(tokio::time::timeout(Duration::from_millis(100), work).await.is_err());
        }
        trigger.await.unwrap();
        tokio::time::sleep(Duration::from_millis(if cfg!(windows) { 2500 } else { 1200 })).await;
        assert!(!marker.exists());
    }
}
