use async_trait::async_trait;
use auth_sdk::microsoft::{
    AzureCliOptions, AzureCliSelection, CliRunner, Dependencies, MicrosoftTokenProvider,
    MicrosoftTokenSource, ProviderOptions,
};
use std::{
    sync::Arc,
    time::{Duration, UNIX_EPOCH},
};
use teams_sdk::{
    auth::{AccessToken, Audience, TokenProvider},
    Account, CancellationToken, Error, ErrorCode, Result, TenantId, UserId,
};

/// The CLI username and Teams object ID are separate identities. Only trusted CLI
/// signed-in-user evidence binds them, bracketed by SDK active-account checks.
pub(crate) struct AzureCredentials {
    provider: MicrosoftTokenProvider,
    runner: Arc<dyn CliRunner>,
    pub(crate) account: Account,
    audience: Audience,
    resource: String,
}

fn authentication(_: impl std::fmt::Display) -> Error {
    Error::new(ErrorCode::Authentication)
}

impl AzureCredentials {
    pub(crate) async fn new(
        tenant: Option<TenantId>,
        user: Option<UserId>,
        audience: Audience,
        dependencies: Arc<Dependencies>,
    ) -> Result<Self> {
        if !matches!(audience, Audience::Graph | Audience::Ic3) {
            return Err(Error::new(ErrorCode::Unsupported));
        }
        let resource = audience.resource(&Account::new(
            TenantId::new("unused")?,
            UserId::new("unused")?,
        ));
        let provider = MicrosoftTokenProvider::with_dependencies(
            ProviderOptions::new(
                MicrosoftTokenSource::AzureCli(AzureCliOptions {
                    namespace: "teams-cli".into(),
                    resource: resource.clone(),
                    selection: AzureCliSelection::ActiveAccount,
                }),
                auth_sdk::Refresh::Auto,
            ),
            dependencies.clone(),
        )
        .map_err(authentication)?;
        let cancel = CancellationToken::new();
        let token = provider
            .get_token(false, &cancel)
            .await
            .map_err(authentication)?;
        if tenant
            .as_ref()
            .is_some_and(|t| !t.as_str().eq_ignore_ascii_case(&token.account.tenant))
        {
            return Err(Error::new(ErrorCode::Authentication));
        }
        let object_id = Self::object_id(dependencies.cli.as_ref()).await?;
        if user
            .as_ref()
            .is_some_and(|u| !u.as_str().eq_ignore_ascii_case(object_id.as_str()))
        {
            return Err(Error::new(ErrorCode::Authentication));
        }
        provider
            .get_token(false, &cancel)
            .await
            .map_err(authentication)?;
        Ok(Self {
            provider,
            runner: dependencies.cli.clone(),
            account: Account::new(TenantId::new(token.account.tenant)?, object_id),
            audience,
            resource,
        })
    }

    async fn object_id(runner: &dyn CliRunner) -> Result<UserId> {
        let output = tokio::time::timeout(
            Duration::from_secs(30),
            runner.run(
                &[
                    "ad",
                    "signed-in-user",
                    "show",
                    "--query",
                    "id",
                    "--output",
                    "tsv",
                    "--only-show-errors",
                ]
                .map(String::from),
            ),
        )
        .await
        .map_err(authentication)?
        .map_err(authentication)?;
        if !output.success {
            return Err(Error::new(ErrorCode::Authentication));
        }
        let value = output.stdout.expose().trim();
        uuid::Uuid::parse_str(value).map_err(authentication)?;
        UserId::new(value)
    }
}

#[async_trait]
impl TokenProvider for AzureCredentials {
    async fn acquire(
        &self,
        account: &Account,
        audience: Audience,
        force_refresh: bool,
    ) -> Result<AccessToken> {
        if account != &self.account || audience != self.audience {
            return Err(Error::new(ErrorCode::Authentication));
        }
        let cancel = CancellationToken::new();
        let token = self
            .provider
            .get_token(force_refresh, &cancel)
            .await
            .map_err(authentication)?;
        if token.source != "azure-cli"
            || token.target != self.resource
            || !token
                .account
                .tenant
                .eq_ignore_ascii_case(self.account.tenant.as_str())
            || !Self::object_id(self.runner.as_ref())
                .await?
                .as_str()
                .eq_ignore_ascii_case(self.account.user.as_str())
        {
            return Err(Error::new(ErrorCode::Authentication));
        }
        let token = self
            .provider
            .get_token(false, &cancel)
            .await
            .map_err(authentication)?;
        Ok(AccessToken {
            account: self.account.clone(),
            audience,
            expires_at: UNIX_EPOCH
                .checked_add(Duration::from_millis(token.expires_at))
                .ok_or_else(|| Error::new(ErrorCode::Authentication))?,
            secret: token.access_token.expose().to_owned(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use auth_sdk::microsoft::{CliOutput, HttpResponse, HttpTransport};
    use auth_sdk::{Clock, CredentialStore, Secret};
    use std::sync::{
        atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering},
        Mutex,
    };

    const TENANT: &str = "00000000-0000-0000-0000-000000000001";
    const OBJECT: &str = "00000000-0000-0000-0000-000000000002";
    const SUBSCRIPTION: &str = "00000000-0000-0000-0000-000000000003";
    const OTHER: &str = "00000000-0000-0000-0000-000000000004";
    const CLI_USER: &str = "synthetic@example.invalid";

    struct Fake {
        now: AtomicU64,
        acquisitions: AtomicUsize,
        calls: Mutex<Vec<Vec<String>>>,
        username: Mutex<String>,
        tenant: Mutex<String>,
        subscription: Mutex<String>,
        object: Mutex<String>,
        switch_on_identity: AtomicBool,
        token_override: Mutex<Option<serde_json::Value>>,
        malformed: AtomicBool,
        denied: AtomicBool,
        hang: Mutex<Option<String>>,
        pending: AtomicUsize,
    }
    impl Fake {
        fn new() -> Arc<Self> {
            Arc::new(Self {
                now: AtomicU64::new(auth_sdk::SystemClock.now_ms()),
                acquisitions: AtomicUsize::new(0),
                calls: Mutex::default(),
                username: Mutex::new(CLI_USER.into()),
                tenant: Mutex::new(TENANT.into()),
                subscription: Mutex::new(SUBSCRIPTION.into()),
                object: Mutex::new(OBJECT.into()),
                switch_on_identity: AtomicBool::new(false),
                token_override: Mutex::default(),
                malformed: AtomicBool::new(false),
                denied: AtomicBool::new(false),
                hang: Mutex::default(),
                pending: AtomicUsize::new(0),
            })
        }
        fn dependencies(self: &Arc<Self>) -> Arc<Dependencies> {
            Arc::new(Dependencies {
                clock: self.clone(),
                store: self.clone(),
                http: self.clone(),
                cli: self.clone(),
            })
        }
        async fn credentials(self: &Arc<Self>, audience: Audience) -> AzureCredentials {
            AzureCredentials::new(None, None, audience, self.dependencies())
                .await
                .unwrap()
        }
    }
    impl Clock for Fake {
        fn now_ms(&self) -> u64 {
            self.now.load(Ordering::SeqCst)
        }
    }
    impl CredentialStore for Fake {
        fn read(&self, _: &str) -> auth_sdk::Result<Option<Secret>> {
            panic!("CLI cannot read OAuth storage")
        }
        fn write(&self, _: &str, _: &Secret) -> auth_sdk::Result<()> {
            panic!("CLI cannot write storage")
        }
        fn delete(&self, _: &str) -> auth_sdk::Result<()> {
            panic!("CLI cannot delete storage")
        }
    }
    #[async_trait]
    impl HttpTransport for Fake {
        async fn request(
            &self,
            _: &str,
            _: Option<&[(String, String)]>,
        ) -> auth_sdk::Result<HttpResponse> {
            panic!("CLI cannot use OAuth HTTP")
        }
    }
    struct Pending<'a>(&'a AtomicUsize);
    impl Drop for Pending<'_> {
        fn drop(&mut self) {
            self.0.fetch_sub(1, Ordering::SeqCst);
        }
    }
    #[async_trait]
    impl CliRunner for Fake {
        async fn run(&self, args: &[String]) -> auth_sdk::Result<CliOutput> {
            self.calls.lock().unwrap().push(args.to_vec());
            let hang = self
                .hang
                .lock()
                .unwrap()
                .as_ref()
                .is_some_and(|command| args[1] == *command);
            if hang {
                self.pending.fetch_add(1, Ordering::SeqCst);
                let _pending = Pending(&self.pending);
                std::future::pending::<()>().await;
            }
            let stdout = match args[1].as_str() {
                "show" => serde_json::json!({
                    "id": *self.subscription.lock().unwrap(), "tenantId": *self.tenant.lock().unwrap(),
                    "user": { "name": *self.username.lock().unwrap(), "type": "user" },
                })
                .to_string(),
                "signed-in-user" => {
                    if self.switch_on_identity.load(Ordering::SeqCst) {
                        *self.subscription.lock().unwrap() = OTHER.into();
                    }
                    self.object.lock().unwrap().clone()
                },
                "get-access-token" => {
                    assert!(!args.iter().any(|arg| arg == "--tenant"));
                    assert_eq!(args[2], "--subscription");
                    assert_eq!(args[3], SUBSCRIPTION);
                    let sequence = self.acquisitions.fetch_add(1, Ordering::SeqCst) + 1;
                    if self.malformed.load(Ordering::SeqCst) {
                        "malformed synthetic-secret".into()
                    } else {
                                let token = self.token_override.lock().unwrap().clone().unwrap_or_else(|| serde_json::json!({
                                    "accessToken": format!("synthetic-token-{sequence}"), "tokenType": "Bearer",
                                    "tenant": TENANT, "subscription": SUBSCRIPTION,
                                    "expires_on": self.now_ms()/1000 + 3600,
                                }));
                                token.to_string()
                    }
                }
                _ => panic!("unexpected CLI command"),
            };
            Ok(CliOutput {
                success: !self.denied.load(Ordering::SeqCst),
                stdout: Secret::new(stdout),
            })
        }
    }

    #[tokio::test]
    async fn identity_is_object_id_not_cli_username_and_resources_are_pinned() {
        for (audience, resource) in [
            (Audience::Graph, "https://graph.microsoft.com"),
            (Audience::Ic3, "https://ic3.teams.office.com"),
        ] {
            let fake = Fake::new();
            let credentials = fake.credentials(audience).await;
            assert_eq!(credentials.account.user.as_str(), OBJECT);
            assert_ne!(credentials.account.user.as_str(), CLI_USER);
            let token = credentials
                .acquire(&credentials.account, audience, false)
                .await
                .unwrap();
            assert_eq!(token.secret, "synthetic-token-1");
            assert_eq!(fake.acquisitions.load(Ordering::SeqCst), 1);
            for call in fake
                .calls
                .lock()
                .unwrap()
                .iter()
                .filter(|args| args[1] == "get-access-token")
            {
                assert_eq!(call[4], "--resource");
                assert_eq!(call[5], resource);
            }
            let calls = fake.calls.lock().unwrap().len();
            let other = Account::new(TenantId::new(TENANT).unwrap(), UserId::new(OTHER).unwrap());
            assert!(credentials.acquire(&other, audience, false).await.is_err());
            assert!(credentials
                .acquire(&credentials.account, Audience::TeamsMcp, true)
                .await
                .is_err());
            assert_eq!(fake.calls.lock().unwrap().len(), calls);
        }
    }

    #[tokio::test]
    async fn forced_and_expiry_refresh_acquire_from_the_same_source() {
        let fake = Fake::new();
        let credentials = fake.credentials(Audience::Ic3).await;
        let token = credentials
            .acquire(&credentials.account, Audience::Ic3, true)
            .await
            .unwrap();
        assert_eq!(token.secret, "synthetic-token-2");
        fake.now.fetch_add(3_600_000, Ordering::SeqCst);
        let token = credentials
            .acquire(&credentials.account, Audience::Ic3, false)
            .await
            .unwrap();
        assert_eq!(token.secret, "synthetic-token-3");
    }

    #[tokio::test]
    async fn explicit_identity_constraints_and_invalid_identity_evidence_fail_closed() {
        for (tenant, user, object) in [
            (Some(OTHER), None, OBJECT),
            (None, Some(OTHER), OBJECT),
            (None, None, ""),
            (None, None, CLI_USER),
            (None, None, "malformed synthetic-secret"),
        ] {
            let fake = Fake::new();
            *fake.object.lock().unwrap() = object.into();
            let error = AzureCredentials::new(
                tenant.map(|t| TenantId::new(t).unwrap()),
                user.map(|u| UserId::new(u).unwrap()),
                Audience::Graph,
                fake.dependencies(),
            )
            .await
            .err()
            .unwrap();
            assert_eq!(error.code, ErrorCode::Authentication);
            assert!(!error.to_string().contains("synthetic-secret"));
        }
        let fake = Fake::new();
        let credentials = AzureCredentials::new(
            Some(TenantId::new(TENANT.to_uppercase()).unwrap()),
            Some(UserId::new(OBJECT.to_uppercase()).unwrap()),
            Audience::Graph,
            fake.dependencies(),
        )
        .await
        .unwrap();
        assert_eq!(credentials.account.user.as_str(), OBJECT);
    }

    #[tokio::test]
    async fn cached_and_forced_requests_reject_identity_changes_and_cli_errors() {
        for force in [false, true] {
            for change in [
                "username",
                "object",
                "tenant",
                "subscription",
                "identity-race",
                "denied",
                "malformed",
            ] {
                let fake = Fake::new();
                let credentials = fake.credentials(Audience::Ic3).await;
                match change {
                    "username" => *fake.username.lock().unwrap() = "other@example.invalid".into(),
                    "object" => *fake.object.lock().unwrap() = OTHER.into(),
                    "tenant" => *fake.tenant.lock().unwrap() = OTHER.into(),
                    "subscription" => *fake.subscription.lock().unwrap() = OTHER.into(),
                    "identity-race" => fake.switch_on_identity.store(true, Ordering::SeqCst),
                    "denied" => fake.denied.store(true, Ordering::SeqCst),
                    _ => fake.malformed.store(true, Ordering::SeqCst),
                }

                // A malformed token response is observed only when renewal is requested.
                if change == "malformed" && !force {
                    continue;
                }
                let error = credentials
                    .acquire(&credentials.account, Audience::Ic3, force)
                    .await
                    .err()
                    .unwrap();
                assert_eq!(error.code, ErrorCode::Authentication);
                assert!(!error.to_string().contains("synthetic"));
            }
        }
    }

    #[tokio::test]
    async fn initial_identity_race_and_invalid_token_metadata_fail_without_fallback() {
        let fake = Fake::new();
        fake.switch_on_identity.store(true, Ordering::SeqCst);
        assert!(
            AzureCredentials::new(None, None, Audience::Ic3, fake.dependencies())
                .await
                .is_err()
        );
        for (field, value) in [
            ("tenant", serde_json::json!(OTHER)),
            ("subscription", serde_json::json!(OTHER)),
            ("tokenType", serde_json::json!("Other")),
            ("accessToken", serde_json::Value::Null),
            ("accessToken", serde_json::json!("")),
            ("accessToken", serde_json::json!("synthetic token")),
            ("expires_on", serde_json::Value::Null),
            ("expires_on", serde_json::json!("invalid")),
            ("expires_on", serde_json::json!(0)),
            ("expires_on", serde_json::json!(u64::MAX)),
        ] {
            let fake = Fake::new();
            let mut token = serde_json::json!({
                "accessToken": "synthetic-secret", "tokenType": "Bearer",
                "tenant": TENANT, "subscription": SUBSCRIPTION,
                "expires_on": fake.now_ms()/1000 + 3600,
            });
            token[field] = value;
            *fake.token_override.lock().unwrap() = Some(token);
            let error = AzureCredentials::new(None, None, Audience::Ic3, fake.dependencies())
                .await
                .err()
                .unwrap();
            assert_eq!(error.code, ErrorCode::Authentication);
            assert!(!error.to_string().contains("synthetic-secret"));
            assert_eq!(fake.acquisitions.load(Ordering::SeqCst), 1);
        }
    }

    #[tokio::test]
    async fn dropping_initial_refresh_and_identity_work_cancels_io_and_allows_retry() {
        let fake = Fake::new();
        *fake.hang.lock().unwrap() = Some("get-access-token".into());
        assert!(tokio::time::timeout(
            Duration::from_millis(20),
            AzureCredentials::new(None, None, Audience::Ic3, fake.dependencies()),
        )
        .await
        .is_err());
        assert_eq!(fake.pending.load(Ordering::SeqCst), 0);
        *fake.hang.lock().unwrap() = None;
        let credentials = fake.credentials(Audience::Ic3).await;
        for command in ["get-access-token", "signed-in-user"] {
            *fake.hang.lock().unwrap() = Some(command.into());
            assert!(tokio::time::timeout(
                Duration::from_millis(20),
                credentials.acquire(&credentials.account, Audience::Ic3, true),
            )
            .await
            .is_err());
            assert_eq!(fake.pending.load(Ordering::SeqCst), 0);
            *fake.hang.lock().unwrap() = None;
            assert!(credentials
                .acquire(&credentials.account, Audience::Ic3, true)
                .await
                .is_ok());
        }
    }

    #[cfg(feature = "graph")]
    #[tokio::test]
    async fn teams_read_401_forces_one_sdk_renewal_and_403_does_not() {
        use teams_sdk::{Backend, OperationContext, TeamsClient};
        struct TeamsHttp {
            first_status: u16,
            calls: AtomicUsize,
        }
        #[async_trait]
        impl teams_sdk::http::HttpTransport for TeamsHttp {
            async fn execute(
                &self,
                request: teams_sdk::http::HttpRequest,
            ) -> Result<teams_sdk::http::HttpResponse> {
                let index = self.calls.fetch_add(1, Ordering::SeqCst);
                let expected = format!("Bearer synthetic-token-{}", index + 1);
                assert!(request.headers.iter().any(|(name, value)| name
                    .as_str()
                    .eq_ignore_ascii_case("authorization")
                    && value == expected.as_str()));
                Ok(teams_sdk::http::HttpResponse {
                    status: if index == 0 { self.first_status } else { 200 },
                    headers: Default::default(),
                    body: br#"{"value":[]}"#.to_vec(),
                })
            }
        }
        for status in [401, 403] {
            let fake = Fake::new();
            let credentials = fake.credentials(Audience::Graph).await;
            let account = credentials.account.clone();
            let http = Arc::new(TeamsHttp {
                first_status: status,
                calls: AtomicUsize::new(0),
            });
            let client = TeamsClient::builder(Arc::new(credentials))
                .transport(http.clone())
                .build()
                .unwrap();
            let session = client.session(account);
            let result = session
                .chats(Backend::Graph, None, &OperationContext::default())
                .await;
            assert_eq!(result.is_ok(), status == 401);
            assert_eq!(
                fake.acquisitions.load(Ordering::SeqCst),
                if status == 401 { 2 } else { 1 }
            );
            assert_eq!(
                http.calls.load(Ordering::SeqCst),
                if status == 401 { 2 } else { 1 }
            );
            session.close();
        }
    }
}
