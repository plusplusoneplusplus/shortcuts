use auth_sdk::{
    microsoft::{
        AzureCliOptions, AzureCliSelection, Dependencies, MicrosoftOAuthSignIn,
        MicrosoftTokenProvider, MicrosoftTokenSource, OAuthOptions, ProviderOptions,
    },
    Account, AuthError, ErrorCode, Refresh,
};
use clap::{Arg, ArgAction, ArgMatches, Command};
use std::{io::Write, path::PathBuf, sync::Arc, time::Duration};
use tokio_util::sync::CancellationToken;

type Result<T> = std::result::Result<T, Box<dyn std::error::Error>>;

fn required(name: &'static str) -> Arg {
    Arg::new(name).long(name).required(true)
}

fn oauth(command: Command, pinned: bool) -> Command {
    command
        .arg(required("namespace"))
        .arg(required("authority"))
        .arg(required("client-id"))
        .arg(required("scope").action(ArgAction::Append))
        .arg(required("target"))
        .arg(Arg::new("resource").long("resource"))
        .arg(required("coordination-directory").value_parser(clap::value_parser!(PathBuf)))
        .arg(Arg::new("account-id").long("account-id").required(pinned))
}

fn policy(command: Command) -> Command {
    command
        .arg(required("refresh").value_parser(["auto", "never"]))
        .arg(
            Arg::new("expiry-margin-seconds")
                .long("expiry-margin-seconds")
                .default_value("60")
                .value_parser(clap::value_parser!(u64).range(0..=3600)),
        )
        .arg(Arg::new("force-refresh").long("force-refresh").action(ArgAction::SetTrue))
}

pub fn command() -> Command {
    Command::new("microsoft")
        .about("Microsoft OAuth and explicit Azure CLI token sources")
        .subcommand_required(true)
        .arg(
            Arg::new("timeout-ms")
                .long("timeout-ms")
                .global(true)
                .value_parser(clap::value_parser!(u64).range(100..=900_000))
                .help("Operation timeout; token: 30000, login/sign-in: 300000"),
        )
        .subcommand(
            Command::new("login")
                .about("Sign in using Azure CLI's browser login; no token is printed")
                .arg(Arg::new("tenant").long("tenant").help("Optional tenant UUID"))
                .after_help("Uses the installed Azure CLI registration and account cache. Azure CLI may open a browser and change its selected account. Token commands never log in automatically."),
        )
        .subcommand(
            Command::new("sign-in")
                .about("Explicit cancellable OAuth sign-in; never invoked by token access")
                .subcommand_required(true)
                .subcommand(oauth(
                    Command::new("browser").about("Authorization-code PKCE loopback flow"),
                    false,
                ))
                .subcommand(oauth(Command::new("device").about("Device-code polling flow"), false)),
        )
        .subcommand(
            Command::new("token")
                .visible_alias("get-access-token")
                .about("Get a token for Azure CLI's selected account, or choose an explicit source")
                .args_conflicts_with_subcommands(true)
                .arg(
                    Arg::new("resource")
                        .long("resource")
                        .default_value("https://management.azure.com/")
                        .help("Requested resource (default: Azure Resource Manager)"),
                )
                .subcommand(policy(oauth(Command::new("oauth"), true)))
                .subcommand(policy(
                    Command::new("azure-cli")
                        .arg(required("namespace"))
                        .arg(required("account-id"))
                        .arg(required("tenant-id"))
                        .arg(required("subscription"))
                        .arg(required("resource")),
                )),
        )
}

async fn bounded<T>(
    cancel: &CancellationToken,
    timeout: Duration,
    work: impl std::future::Future<Output = Result<T>>,
) -> Result<T> {
    tokio::select! {
        biased;
        _ = cancel.cancelled() => Err(AuthError::new(ErrorCode::Cancelled).into()),
        result = tokio::time::timeout(timeout, work) => {
            result.unwrap_or_else(|_| Err(AuthError::new(ErrorCode::TimedOut).into()))
        }
    }
}

#[derive(serde::Deserialize)]
struct SelectedAccount {
    id: String,
    #[serde(rename = "tenantId")]
    tenant: String,
    user: SelectedUser,
}

#[derive(serde::Deserialize)]
struct SelectedUser {
    name: String,
    #[serde(rename = "type")]
    kind: String,
}

async fn selected_token(
    resource: String,
    timeout: Duration,
    cancel: &CancellationToken,
    dependencies: Arc<Dependencies>,
) -> Result<auth_sdk::Token> {
    if resource.is_empty()
        || resource.len() > 2048
        || resource.starts_with('-')
        || !resource.bytes().all(|c| c.is_ascii_alphanumeric() || b"-._:/@".contains(&c))
    {
        return Err(AuthError::new(ErrorCode::InvalidConfiguration).into());
    }
    bounded(cancel, timeout, async {
        let output = dependencies
            .cli
            .run(&[
                "account".into(),
                "show".into(),
                "--output".into(),
                "json".into(),
                "--only-show-errors".into(),
            ])
            .await?;
        if !output.success {
            return Err(AuthError::new(ErrorCode::LoginRequired).into());
        }
        let selected: SelectedAccount = serde_json::from_str(output.stdout.expose())
            .map_err(|_| AuthError::new(ErrorCode::InvalidTokenResponse))?;
        if selected.user.kind != "user" {
            return Err(AuthError::new(ErrorCode::AccountMismatch).into());
        }
        let mut options = ProviderOptions::new(
            MicrosoftTokenSource::AzureCli(AzureCliOptions {
                namespace: "auth-cli:selected-account".into(),
                selection: AzureCliSelection::Explicit {
                    account: Account { id: selected.user.name, tenant: selected.tenant },
                    subscription: selected.id,
                },
                resource,
            }),
            Refresh::Auto,
        );
        options.timeout = timeout;
        // The SDK verifies this exact selection before and after token acquisition.
        // A concurrent Azure CLI account switch cannot silently substitute identity.
        let provider = MicrosoftTokenProvider::with_dependencies(options, dependencies)?;
        let result = provider.get_token(false, cancel).await;
        provider.dispose();
        Ok(result?)
    })
    .await
}

async fn login(
    args: &ArgMatches,
    timeout: Duration,
    cancel: &CancellationToken,
    dependencies: &Dependencies,
) -> Result<()> {
    let mut arguments =
        vec!["login".into(), "--output".into(), "none".into(), "--only-show-errors".into()];
    if let Some(tenant) = args.get_one::<String>("tenant") {
        let valid = tenant.len() == 36
            && tenant.bytes().enumerate().all(|(i, c)| {
                if [8, 13, 18, 23].contains(&i) {
                    c == b'-'
                } else {
                    c.is_ascii_hexdigit()
                }
            });
        if !valid {
            return Err(AuthError::new(ErrorCode::InvalidConfiguration).into());
        }
        arguments.extend(["--tenant".into(), tenant.clone()]);
    }
    eprintln!("Signing in with Azure CLI. Complete authentication in the browser.");
    bounded(cancel, timeout, async {
        let output = dependencies.cli.run(&arguments).await?;
        if !output.success {
            return Err(AuthError::new(ErrorCode::LoginRequired).into());
        }
        Ok(())
    })
    .await
}

fn text(matches: &ArgMatches, name: &str) -> String {
    matches.get_one::<String>(name).expect("required argument").clone()
}

fn oauth_options(matches: &ArgMatches) -> OAuthOptions {
    OAuthOptions {
        namespace: text(matches, "namespace"),
        authority: text(matches, "authority"),
        client_id: text(matches, "client-id"),
        scopes: matches.get_many::<String>("scope").expect("required scopes").cloned().collect(),
        target: text(matches, "target"),
        resource: matches.get_one::<String>("resource").cloned(),
        coordination_dir: matches
            .get_one::<PathBuf>("coordination-directory")
            .expect("required directory")
            .clone(),
    }
}

fn oauth_account(options: &OAuthOptions, id: String) -> Account {
    Account {
        id,
        tenant: options
            .authority
            .trim_end_matches('/')
            .rsplit('/')
            .next()
            .unwrap_or_default()
            .into(),
    }
}

pub async fn run(
    matches: &ArgMatches,
    show: bool,
    cancel: &CancellationToken,
    writer: &mut impl Write,
    dependencies: Arc<Dependencies>,
) -> Result<()> {
    let timeout = matches.get_one::<u64>("timeout-ms").copied();
    match matches.subcommand() {
        Some(("login", args)) => {
            login(args, Duration::from_millis(timeout.unwrap_or(300_000)), cancel, &dependencies)
                .await?;
            crate::output::login(writer)?;
        }
        Some(("token", token)) if token.subcommand().is_none() => {
            let result = selected_token(
                text(token, "resource"),
                Duration::from_millis(timeout.unwrap_or(30_000)),
                cancel,
                dependencies,
            )
            .await?;
            crate::output::token(writer, &result, show)?;
        }
        Some(("token", token)) => {
            let (source_name, args) = token.subcommand().expect("required source");
            let source = match source_name {
                "oauth" => {
                    let options = oauth_options(args);
                    let account = oauth_account(&options, text(args, "account-id"));
                    MicrosoftTokenSource::OAuth { options, account }
                }
                "azure-cli" => MicrosoftTokenSource::AzureCli(AzureCliOptions {
                    namespace: text(args, "namespace"),
                    selection: AzureCliSelection::Explicit {
                        account: Account {
                            id: text(args, "account-id"),
                            tenant: text(args, "tenant-id"),
                        },
                        subscription: text(args, "subscription"),
                    },
                    resource: text(args, "resource"),
                }),
                _ => unreachable!("clap validates sources"),
            };
            let refresh = match args.get_one::<String>("refresh").map(String::as_str) {
                Some("auto") => Refresh::Auto,
                Some("never") => Refresh::Never,
                _ => unreachable!("clap validates policy"),
            };
            let mut options = ProviderOptions::new(source, refresh);
            options.timeout = Duration::from_millis(timeout.unwrap_or(30_000));
            options.expiry_margin_seconds =
                *args.get_one::<u64>("expiry-margin-seconds").expect("default margin");
            let provider = MicrosoftTokenProvider::with_dependencies(options, dependencies)?;
            let result = provider.get_token(args.get_flag("force-refresh"), cancel).await;
            provider.dispose();
            crate::output::token(writer, &result?, show)?;
        }
        Some(("sign-in", sign_in)) => {
            let (flow, args) = sign_in.subcommand().expect("required flow");
            let options = oauth_options(args);
            let expected =
                args.get_one::<String>("account-id").map(|id| oauth_account(&options, id.clone()));
            let handle = MicrosoftOAuthSignIn::with_dependencies(
                options,
                expected,
                Duration::from_millis(timeout.unwrap_or(300_000)),
                dependencies,
            )?;
            let work = async {
                let instructions = match flow {
                    "browser" => handle.begin_browser().await?,
                    "device" => handle.begin_device().await?,
                    _ => unreachable!("clap validates flows"),
                };
                crate::output::instructions(writer, &instructions, show)?;
                let result = handle.wait().await?;
                crate::output::token(writer, &result.token, show)?;
                Ok(())
            };
            let result: Result<()> = tokio::select! {
                biased;
                _ = cancel.cancelled() => Err(auth_sdk::AuthError::new(auth_sdk::ErrorCode::Cancelled).into()),
                result = work => result,
            };
            handle.dispose();
            result?;
        }
        _ => unreachable!("clap validates commands"),
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use async_trait::async_trait;
    use auth_sdk::{
        microsoft::{CliOutput, CliRunner, HttpResponse, HttpTransport},
        AuthError, CredentialStore, ErrorCode, Secret, SystemClock,
    };
    use std::sync::Mutex;

    struct SelectionCli {
        calls: Mutex<Vec<Vec<String>>>,
        mode: &'static str,
    }

    #[async_trait]
    impl CliRunner for SelectionCli {
        async fn run(&self, args: &[String]) -> auth_sdk::Result<CliOutput> {
            self.calls.lock().unwrap().push(args.to_vec());
            let body = if args[0] == "login" {
                "PRIVATE_LOGIN_OUTPUT".to_owned()
            } else if args[1] == "show" {
                if self.mode == "malformed" {
                    "PRIVATE_BAD_ACCOUNT".to_owned()
                } else {
                    serde_json::json!({
                        "id": "44444444-4444-4444-8444-444444444444",
                        "tenantId": "11111111-1111-4111-8111-111111111111",
                        "user": {
                            "name": if self.mode == "switch" && args.contains(&"--subscription".into()) { "other-fixture" } else { "fixture-account" },
                            "type": if self.mode == "service" { "servicePrincipal" } else { "user" },
                        },
                    }).to_string()
                }
            } else {
                serde_json::json!({
                    "accessToken": "abcdefghPRIVATEijklmnop", "tokenType": "Bearer",
                    "tenant": "11111111-1111-4111-8111-111111111111",
                    "subscription": "44444444-4444-4444-8444-444444444444",
                    "expires_on": 4_000_000_000u64,
                })
                .to_string()
            };
            Ok(CliOutput { success: self.mode != "failed", stdout: Secret::new(body) })
        }
    }

    #[tokio::test]
    async fn convenience_pins_selection_and_keeps_sdk_validation() {
        for (mode, expected) in [
            ("valid", None),
            ("malformed", Some(ErrorCode::InvalidTokenResponse)),
            ("service", Some(ErrorCode::AccountMismatch)),
            ("switch", Some(ErrorCode::AccountMismatch)),
            ("failed", Some(ErrorCode::LoginRequired)),
        ] {
            let runner = Arc::new(SelectionCli { calls: Mutex::new(Vec::new()), mode });
            let dependencies =
                Arc::new(Dependencies { cli: runner.clone(), ..Dependencies::default() });
            let result = selected_token(
                "https://resource.example".into(),
                Duration::from_secs(1),
                &CancellationToken::new(),
                dependencies,
            )
            .await;
            if let Some(expected) = expected {
                let error = result.err().expect("selection rejected");
                assert_eq!(error.downcast_ref::<AuthError>().unwrap().code, expected);
                assert!(!error.to_string().contains("PRIVATE"));
            } else {
                assert_eq!(result.unwrap().account.id, "fixture-account");
                let calls = runner.calls.lock().unwrap();
                assert_eq!(calls.len(), 4);
                assert_eq!(calls[0], ["account", "show", "--output", "json", "--only-show-errors"]);
                assert_eq!(calls[1][3], "44444444-4444-4444-8444-444444444444");
                assert!(!calls[2].iter().any(|arg| arg == "--tenant"));
                assert_eq!(calls[2][5], "https://resource.example");
                assert_eq!(calls[1], calls[3]);
            }
            assert!(runner.calls.lock().unwrap().iter().all(|call| call[0] == "account"));
        }
    }

    #[tokio::test]
    async fn convenience_login_is_explicit_and_does_not_emit_provider_output() {
        let matches = crate::cli()
            .try_get_matches_from([
                "auth-cli",
                "microsoft",
                "login",
                "--tenant",
                "11111111-1111-4111-8111-111111111111",
            ])
            .unwrap();
        let runner = Arc::new(SelectionCli { calls: Mutex::new(Vec::new()), mode: "valid" });
        let dependencies =
            Arc::new(Dependencies { cli: runner.clone(), ..Dependencies::default() });
        let mut output = Vec::new();
        run(
            matches.subcommand_matches("microsoft").unwrap(),
            true,
            &CancellationToken::new(),
            &mut output,
            dependencies,
        )
        .await
        .unwrap();
        assert_eq!(
            runner.calls.lock().unwrap()[0],
            [
                "login",
                "--output",
                "none",
                "--only-show-errors",
                "--tenant",
                "11111111-1111-4111-8111-111111111111",
            ]
        );
        assert!(!String::from_utf8(output).unwrap().contains("PRIVATE"));
    }

    #[tokio::test]
    async fn convenience_bounds_selection_and_login_and_rejects_invalid_input_without_cli() {
        let empty_calls = Arc::new(SelectionCli { calls: Mutex::new(Vec::new()), mode: "valid" });
        let dependencies =
            Arc::new(Dependencies { cli: empty_calls.clone(), ..Dependencies::default() });
        let error = selected_token(
            "https://resource.example/&unsafe".into(),
            Duration::from_secs(1),
            &CancellationToken::new(),
            dependencies.clone(),
        )
        .await
        .err()
        .unwrap();
        assert_eq!(
            error.downcast_ref::<AuthError>().unwrap().code,
            ErrorCode::InvalidConfiguration
        );
        let matches = crate::cli()
            .try_get_matches_from(["auth-cli", "microsoft", "login", "--tenant", "unsafe&argument"])
            .unwrap();
        let error = run(
            matches.subcommand_matches("microsoft").unwrap(),
            false,
            &CancellationToken::new(),
            &mut Vec::new(),
            dependencies,
        )
        .await
        .unwrap_err();
        assert_eq!(
            error.downcast_ref::<AuthError>().unwrap().code,
            ErrorCode::InvalidConfiguration
        );
        assert!(empty_calls.calls.lock().unwrap().is_empty());
        for command in ["login", "token"] {
            let matches = crate::cli()
                .try_get_matches_from(["auth-cli", "microsoft", command, "--timeout-ms", "100"])
                .unwrap();
            for cancelled in [false, true] {
                let cancel = CancellationToken::new();
                if cancelled {
                    cancel.cancel();
                }
                let mut output = Vec::new();
                let error = run(
                    matches.subcommand_matches("microsoft").unwrap(),
                    false,
                    &cancel,
                    &mut output,
                    dependencies_for_hang(),
                )
                .await
                .unwrap_err();
                assert_eq!(
                    error.downcast_ref::<AuthError>().unwrap().code,
                    if cancelled { ErrorCode::Cancelled } else { ErrorCode::TimedOut }
                );
                assert!(output.is_empty());
            }
        }
    }

    fn dependencies_for_hang() -> Arc<Dependencies> {
        Arc::new(Dependencies { cli: Arc::new(HangingCli), ..Dependencies::default() })
    }

    const AUTHORITY: &str =
        "https://login.microsoftonline.com/11111111-1111-4111-8111-111111111111";

    struct EmptyStore;
    impl CredentialStore for EmptyStore {
        fn read(&self, _: &str) -> auth_sdk::Result<Option<Secret>> {
            Ok(None)
        }
        fn write(&self, _: &str, _: &Secret) -> auth_sdk::Result<()> {
            panic!("unexpected credential write")
        }
        fn delete(&self, _: &str) -> auth_sdk::Result<()> {
            panic!("unexpected credential deletion")
        }
    }

    struct FakeHttp(Mutex<Vec<String>>);
    #[async_trait]
    impl HttpTransport for FakeHttp {
        async fn request(
            &self,
            url: &str,
            _: Option<&[(String, String)]>,
        ) -> auth_sdk::Result<HttpResponse> {
            self.0.lock().unwrap().push(url.into());
            let body = if url.ends_with("openid-configuration") {
                serde_json::json!({
                    "issuer": format!("{AUTHORITY}/v2.0"),
                    "authorization_endpoint": format!("{AUTHORITY}/oauth2/v2.0/authorize"),
                    "token_endpoint": format!("{AUTHORITY}/oauth2/v2.0/token"),
                    "jwks_uri": "https://login.microsoftonline.com/common/discovery/v2.0/keys",
                })
            } else if url.ends_with("devicecode") {
                serde_json::json!({
                    "device_code": "PRIVATE_DEVICE_CODE", "user_code": "PRIVATE",
                    "verification_uri": "https://microsoft.com/devicelogin",
                    "expires_in": 60, "interval": 1,
                })
            } else {
                serde_json::json!({"error": "access_denied", "error_description": "PRIVATE"})
            };
            Ok(HttpResponse {
                status: if url.ends_with("/token") { 400 } else { 200 },
                body: Secret::new(body.to_string()),
            })
        }
    }

    struct HangingCli;
    #[async_trait]
    impl CliRunner for HangingCli {
        async fn run(&self, _: &[String]) -> auth_sdk::Result<CliOutput> {
            std::future::pending().await
        }
    }

    fn dependencies(http: Arc<FakeHttp>) -> Arc<Dependencies> {
        Arc::new(Dependencies {
            clock: Arc::new(SystemClock),
            store: Arc::new(EmptyStore),
            http,
            cli: Arc::new(HangingCli),
        })
    }

    fn args(flow: &str, root: &std::path::Path) -> ArgMatches {
        let mut values = vec![
            "auth-cli",
            "microsoft",
            "sign-in",
            flow,
            "--namespace",
            "fixture",
            "--authority",
            AUTHORITY,
            "--client-id",
            "33333333-3333-4333-8333-333333333333",
            "--scope",
            "openid",
            "--scope",
            "offline_access",
            "--target",
            "fixture",
            "--coordination-directory",
        ]
        .into_iter()
        .map(str::to_owned)
        .collect::<Vec<_>>();
        values.push(root.to_str().unwrap().into());
        crate::cli().try_get_matches_from(values).unwrap()
    }

    struct CancelWriter {
        bytes: Vec<u8>,
        cancel: CancellationToken,
    }
    impl Write for CancelWriter {
        fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
            self.bytes.extend_from_slice(bytes);
            Ok(bytes.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            self.cancel.cancel();
            Ok(())
        }
    }

    #[tokio::test]
    async fn browser_and_device_start_with_injected_transport_and_cancel_cleanly() {
        for flow in ["browser", "device"] {
            let root = tempfile::tempdir().unwrap();
            let matches = args(flow, root.path());
            let cancel = CancellationToken::new();
            let http = Arc::new(FakeHttp(Mutex::new(Vec::new())));
            let mut writer = CancelWriter { bytes: Vec::new(), cancel: cancel.clone() };
            let error = run(
                matches.subcommand_matches("microsoft").unwrap(),
                false,
                &cancel,
                &mut writer,
                dependencies(http.clone()),
            )
            .await
            .unwrap_err();
            assert_eq!(error.downcast_ref::<AuthError>().unwrap().code, ErrorCode::Cancelled);
            let text = String::from_utf8(writer.bytes).unwrap();
            assert!(!text.contains("PRIVATE"));
            assert!(text.contains("signInInstructions"));
            assert!(!http.0.lock().unwrap().iter().any(|url| url.ends_with("/token")));
        }
    }

    #[tokio::test]
    async fn device_polls_and_reports_sanitized_denial() {
        let root = tempfile::tempdir().unwrap();
        let matches = args("device", root.path());
        let mut output = Vec::new();
        let error = run(
            matches.subcommand_matches("microsoft").unwrap(),
            true,
            &CancellationToken::new(),
            &mut output,
            dependencies(Arc::new(FakeHttp(Mutex::new(Vec::new())))),
        )
        .await
        .unwrap_err();
        assert_eq!(error.downcast_ref::<AuthError>().unwrap().code, ErrorCode::AccessDenied);
        assert!(!error.to_string().contains("PRIVATE"));
        assert_eq!(String::from_utf8(output).unwrap().lines().count(), 1);
    }

    #[tokio::test]
    async fn azure_cli_timeout_and_pre_cancel_are_bounded() {
        let matches = crate::cli()
            .try_get_matches_from([
                "auth-cli",
                "microsoft",
                "token",
                "azure-cli",
                "--namespace",
                "fixture",
                "--account-id",
                "fixture-account",
                "--tenant-id",
                "11111111-1111-4111-8111-111111111111",
                "--subscription",
                "44444444-4444-4444-8444-444444444444",
                "--resource",
                "https://resource.example",
                "--refresh",
                "auto",
                "--timeout-ms",
                "100",
            ])
            .unwrap();
        for cancelled in [false, true] {
            let cancel = CancellationToken::new();
            if cancelled {
                cancel.cancel();
            }
            let mut output = Vec::new();
            let error = tokio::time::timeout(
                Duration::from_secs(2),
                run(
                    matches.subcommand_matches("microsoft").unwrap(),
                    false,
                    &cancel,
                    &mut output,
                    dependencies(Arc::new(FakeHttp(Mutex::new(Vec::new())))),
                ),
            )
            .await
            .unwrap()
            .unwrap_err();
            assert_eq!(
                error.downcast_ref::<AuthError>().unwrap().code,
                if cancelled { ErrorCode::Cancelled } else { ErrorCode::TimedOut },
            );
            assert!(output.is_empty());
        }
    }

    #[tokio::test]
    async fn oauth_token_without_credentials_never_starts_sign_in() {
        let root = tempfile::tempdir().unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(root.path(), std::fs::Permissions::from_mode(0o700)).unwrap();
        }
        let mut values = vec![
            "auth-cli",
            "microsoft",
            "token",
            "oauth",
            "--namespace",
            "fixture",
            "--authority",
            AUTHORITY,
            "--client-id",
            "33333333-3333-4333-8333-333333333333",
            "--scope",
            "openid",
            "--scope",
            "offline_access",
            "--target",
            "fixture",
            "--account-id",
            "22222222-2222-4222-8222-222222222222",
            "--refresh",
            "never",
            "--coordination-directory",
        ]
        .into_iter()
        .map(str::to_owned)
        .collect::<Vec<_>>();
        values.push(root.path().to_str().unwrap().into());
        let matches = crate::cli().try_get_matches_from(values).unwrap();
        let http = Arc::new(FakeHttp(Mutex::new(Vec::new())));
        let mut output = Vec::new();
        let error = run(
            matches.subcommand_matches("microsoft").unwrap(),
            false,
            &CancellationToken::new(),
            &mut output,
            dependencies(http.clone()),
        )
        .await
        .unwrap_err();
        assert_eq!(error.downcast_ref::<AuthError>().unwrap().code, ErrorCode::InteractionRequired);
        assert!(http.0.lock().unwrap().is_empty());
        assert!(output.is_empty());
    }
}
