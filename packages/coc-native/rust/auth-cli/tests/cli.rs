use std::{fs, process::Command};
use tempfile::TempDir;

const TENANT: &str = "11111111-1111-4111-8111-111111111111";
const SUBSCRIPTION: &str = "44444444-4444-4444-8444-444444444444";
const SECRET: &str = "abcdefghPRIVATE_TOKEN_MIDDLEijklmnop";

fn binary() -> Command {
    Command::new(env!("CARGO_BIN_EXE_auth-cli"))
}

fn token_args(command: &mut Command) -> &mut Command {
    command.args([
        "microsoft",
        "token",
        "azure-cli",
        "--namespace",
        "isolated-cli-fixture",
        "--account-id",
        "fixture-account",
        "--tenant-id",
        TENANT,
        "--subscription",
        SUBSCRIPTION,
        "--resource",
        "https://resource.example",
        "--refresh",
        "never",
    ])
}

fn fake_cli(mode: &str) -> TempDir {
    let root = tempfile::tempdir().unwrap();
    let account = serde_json::json!({
        "id": SUBSCRIPTION, "tenantId": TENANT,
        "user": { "name": if mode == "mismatch" { "other-fixture" } else { "fixture-account" }, "type": "user" },
    }).to_string();
    let token = if mode == "malformed" {
        "PRIVATE_INVALID_OUTPUT".into()
    } else {
        serde_json::json!({
            "accessToken": SECRET, "tokenType": "Bearer",
            "tenant": TENANT, "subscription": SUBSCRIPTION,
            "expires_on": 4_000_000_000u64,
        })
        .to_string()
    };
    #[cfg(windows)]
    fs::write(root.path().join("az.cmd"), format!(
        "@echo off\r\nif \"%~1\"==\"login\" (\r\necho PRIVATE_LOGIN_OUTPUT\r\nexit /b 0\r\n)\r\nif \"%~2\"==\"show\" (\r\necho {account}\r\n) else (\r\necho {token}\r\n)\r\nexit /b 0\r\n"
    )).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let path = root.path().join("az");
        fs::write(&path, format!(
            "#!/bin/sh\nif [ \"$1\" = \"login\" ]; then\nprintf PRIVATE_LOGIN_OUTPUT\nexit 0\nfi\nif [ \"$2\" = \"show\" ]; then\nprintf '%s\\n' '{account}'\nelse\nprintf '%s\\n' '{token}'\nfi\n"
        )).unwrap();
        fs::set_permissions(path, fs::Permissions::from_mode(0o700)).unwrap();
    }
    root
}

#[test]
fn real_binary_help_version_and_vendor_dispatch() {
    for args in [
        vec!["--help"],
        vec!["--version"],
        vec!["microsoft", "--help"],
        vec!["microsoft", "login", "--help"],
        vec!["microsoft", "token", "--help"],
        vec!["microsoft", "sign-in", "--help"],
        vec!["microsoft", "sign-in", "browser", "--help"],
        vec!["microsoft", "sign-in", "device", "--help"],
        vec!["microsoft", "token", "oauth", "--help"],
    ] {
        assert!(binary().args(args).output().unwrap().status.success());
    }
    assert!(!binary().args(["unknown-vendor", "token"]).output().unwrap().status.success());
    let output = binary().args(["--help"]).output().unwrap();
    assert!(String::from_utf8(output.stdout).unwrap().contains("--show-secrets"));
}

#[test]
fn simple_login_and_resource_only_token_commands() {
    let root = fake_cli("valid");
    let output = binary().args(["microsoft", "login"]).env("PATH", root.path()).output().unwrap();
    assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
    let value: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(value["event"], "login");
    assert!(!String::from_utf8(output.stdout).unwrap().contains("PRIVATE"));
    for name in ["token", "get-access-token"] {
        for show in [false, true] {
            let mut command = binary();
            command
                .args(["microsoft", name, "--resource", "https://resource.example"])
                .env("PATH", root.path());
            if show {
                command.arg("--show-secrets");
            }
            let output = command.output().unwrap();
            assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
            let value: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
            assert_eq!(
                value["accessToken"],
                if show { SECRET } else { "abcdefgh...[redacted]...ijklmnop" }
            );
            assert_eq!(value["target"], "https://resource.example");
        }
    }
    let output = binary().args(["microsoft", "token"]).env("PATH", root.path()).output().unwrap();
    assert!(output.status.success());
    let value: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(value["target"], "https://management.azure.com/");
}

#[test]
fn fake_cli_token_is_masked_unless_explicitly_requested() {
    let root = fake_cli("valid");
    for show in [false, true] {
        let mut command = binary();
        token_args(&mut command).env("PATH", root.path());
        if show {
            command.arg("--show-secrets");
        }
        let output = command.output().unwrap();
        assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
        let value: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
        assert_eq!(
            value["accessToken"],
            if show { SECRET } else { "abcdefgh...[redacted]...ijklmnop" }
        );
        assert_eq!(value["account"]["id"], "fixture-account");
        assert_eq!(value["source"], "azure-cli");
        assert!(value.get("grantedScopes").is_none());
        assert_eq!(String::from_utf8(output.stderr).unwrap().contains("WARNING"), show);
    }
}

#[test]
fn safe_errors_and_never_forced_refresh() {
    for (mode, error) in [("malformed", "InvalidTokenResponse"), ("mismatch", "AccountMismatch")] {
        let root = fake_cli(mode);
        let output = token_args(&mut binary()).env("PATH", root.path()).output().unwrap();
        assert!(!output.status.success());
        assert!(output.stdout.is_empty());
        let stderr = String::from_utf8(output.stderr).unwrap();
        assert!(stderr.contains(error));
        assert!(!stderr.contains("PRIVATE"));
    }
    let empty = tempfile::tempdir().unwrap();
    for (extra, error) in [(vec![], "CliUnavailable"), (vec!["--force-refresh"], "RefreshDisabled")]
    {
        let output =
            token_args(&mut binary()).args(extra).env("PATH", empty.path()).output().unwrap();
        assert!(!output.status.success());
        assert!(output.stdout.is_empty());
        assert!(String::from_utf8(output.stderr).unwrap().contains(error));
    }
}

#[test]
fn configuration_and_cross_source_arguments_fail_before_acquisition() {
    let output = token_args(&mut binary()).args(["--authority", "PRIVATE_INPUT"]).output().unwrap();
    assert!(!output.status.success());
    let output = token_args(&mut binary()).args(["--timeout-ms", "1"]).output().unwrap();
    assert!(!output.status.success());
    let output = binary()
        .args([
            "microsoft",
            "sign-in",
            "device",
            "--namespace",
            "fixture",
            "--authority",
            "https://untrusted.example/tenant",
            "--client-id",
            "33333333-3333-4333-8333-333333333333",
            "--scope",
            "openid",
            "--scope",
            "profile",
            "--scope",
            "offline_access",
            "--target",
            "fixture",
            "--coordination-directory",
        ])
        .arg(tempfile::tempdir().unwrap().path())
        .output()
        .unwrap();
    assert!(!output.status.success());
    assert!(output.stdout.is_empty());
    let stderr = String::from_utf8(output.stderr).unwrap();
    assert!(stderr.contains("InvalidConfiguration"));
    assert!(!stderr.contains("untrusted.example"));
}
