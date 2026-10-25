//! Read-only Teams CLI with explicit credentials or source-pinned Azure CLI authentication.
mod constants;
use async_trait::async_trait;
use constants::*;
use std::{
    io::{self, Write},
    sync::Arc,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use teams_sdk::{
    auth::{AccessToken, Audience, TokenProvider},
    *,
};

type CliResult<T> = std::result::Result<T, Box<dyn std::error::Error>>;

#[derive(Debug, PartialEq, Eq)]
enum Command {
    List,
    View(ChatId),
    Watch(u64),
}

fn cli() -> clap::Command {
    clap::Command::new("teams-cli")
        .version(env!("CARGO_PKG_VERSION"))
        .about("Read-only Teams chat CLI")
        .after_help(AUTH_HELP)
        .subcommand_required(true)
        .arg_required_else_help(true)
        .arg(
            clap::Arg::new("tenant-id")
                .long("tenant-id")
                .global(true)
                .value_name("TENANT_ID")
                .value_parser(clap::builder::ValueParser::new(|value: &str| {
                    TenantId::new(value)
                }))
                .help("Override the environment or Azure CLI tenant"),
        )
        .arg(
            clap::Arg::new("backend")
                .long("backend")
                .global(true)
                .value_parser(["graph", "ic3"])
                .default_value("ic3")
                .help("Select a backend without fallback"),
        )
        .arg(
            clap::Arg::new("region")
                .long("region")
                .global(true)
                .value_parser(["amer", "emea", "apac"])
                .help("IC3 region (default: amer); invalid for Graph"),
        )
        .subcommand(clap::Command::new("list").about("List the first page of chats"))
        .subcommand(
            clap::Command::new("watch")
                .about("Verify IC3 notifications for a bounded period")
                .arg(
                    clap::Arg::new("seconds")
                        .long("seconds")
                        .default_value("60")
                        .value_parser(clap::value_parser!(u64).range(1..=3600))
                        .help("Watch duration in seconds (1-3600)"),
                ),
        )
        .subcommand(
            clap::Command::new("view")
                .about("Read the first page of chat messages")
                .arg(
                    clap::Arg::new("chat-id")
                        .required(true)
                        .value_name("CHAT_ID")
                        .value_parser(clap::builder::ValueParser::new(|value: &str| {
                            ChatId::new(value)
                        })),
                ),
        )
}

struct Options {
    command: Command,
    tenant: Option<TenantId>,
    backend: Backend,
    region: Option<String>,
}

impl Options {
    fn parse(args: &[String]) -> CliResult<Self> {
        let matches = cli().try_get_matches_from(
            std::iter::once("teams-cli".to_owned()).chain(args.iter().cloned()),
        )?;
        let command = match matches.subcommand() {
            Some(("list", _)) => Command::List,
            Some(("watch", watch)) => {
                Command::Watch(*watch.get_one::<u64>("seconds").expect("default duration"))
            }
            Some(("view", view)) => Command::View(
                view.get_one::<ChatId>("chat-id")
                    .expect("required chat ID")
                    .clone(),
            ),
            _ => unreachable!("clap requires a known subcommand"),
        };
        let tenant = matches.get_one::<TenantId>("tenant-id").cloned();
        let backend = if matches.get_one::<String>("backend").map(String::as_str) == Some("graph") {
            Backend::Graph
        } else {
            Backend::Ic3
        };
        let mut region = matches.get_one::<String>("region").cloned();
        if matches!(command, Command::Watch(_)) && backend != Backend::Ic3 {
            return Err(cli()
                .error(
                    clap::error::ErrorKind::ArgumentConflict,
                    "watch requires --backend ic3",
                )
                .into());
        }
        if backend == Backend::Graph && region.is_some() {
            return Err(cli()
                .error(
                    clap::error::ErrorKind::ArgumentConflict,
                    "Graph does not accept --region",
                )
                .into());
        }
        if backend == Backend::Ic3 && region.is_none() {
            region = Some("amer".into());
        }
        if !teams_sdk::capabilities::compiled(backend) {
            return Err(io::Error::other("Selected backend is not compiled; enable graph").into());
        }
        Ok(Self {
            command,
            tenant,
            backend,
            region,
        })
    }

    fn configure(&self, builder: TeamsClientBuilder) -> CliResult<TeamsClientBuilder> {
        if self.backend == Backend::Ic3 {
            let region = match self.region.as_deref() {
                Some("amer") => teams_sdk::ic3::Region::Americas,
                Some("emea") => teams_sdk::ic3::Region::EuropeMiddleEastAfrica,
                Some("apac") => teams_sdk::ic3::Region::AsiaPacific,
                _ => return Err(Error::new(ErrorCode::Configuration).into()),
            };
            return Ok(builder.ic3_region(region));
        }
        Ok(builder)
    }
}

fn read_setting(name: &str) -> CliResult<String> {
    std::env::var(name).map_err(|_| {
        io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("Set {name}; use --help for configuration"),
        )
        .into()
    })
}

fn optional_setting(name: &str) -> CliResult<Option<String>> {
    match std::env::var(name) {
        Ok(value) => Ok(Some(value)),
        Err(std::env::VarError::NotPresent) => Ok(None),
        Err(std::env::VarError::NotUnicode(_)) => Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("{name} must be valid Unicode"),
        )
        .into()),
    }
}

struct ApplicationCredentials {
    account: Account,
    audience: Audience,
    secret: String,
    expires_at: SystemTime,
}

impl ApplicationCredentials {
    #[cfg(test)]
    fn load(
        account: Account,
        explicit_token: Option<String>,
        read: impl FnMut(&str) -> CliResult<String>,
    ) -> CliResult<Self> {
        Self::load_for(account, Audience::Graph, explicit_token, read)
    }

    fn load_for(
        account: Account,
        audience: Audience,
        explicit_token: Option<String>,
        mut read: impl FnMut(&str) -> CliResult<String>,
    ) -> CliResult<Self> {
        let expiry_setting = match audience {
            Audience::Graph => GRAPH_TOKEN_EXPIRY_ENV,
            Audience::Ic3 => IC3_TOKEN_EXPIRY_ENV,
            _ => return Err(Error::new(ErrorCode::Unsupported).into()),
        };
        let secret = explicit_token.ok_or_else(|| Error::new(ErrorCode::Configuration))?;
        let expiry = read(expiry_setting)?;
        let mut credentials = Self::from_settings(|name| {
            Ok(match name {
                TENANT_ID_ENV => account.tenant.as_str().to_owned(),
                USER_ID_ENV => account.user.as_str().to_owned(),
                GRAPH_TOKEN_ENV => secret.clone(),
                GRAPH_TOKEN_EXPIRY_ENV => expiry.clone(),
                _ => return Err(Error::new(ErrorCode::Configuration).into()),
            })
        })?;
        credentials.audience = audience;
        Ok(credentials)
    }

    #[cfg(test)]
    fn with_tenant(
        tenant: Option<TenantId>,
        mut read: impl FnMut(&str) -> CliResult<String>,
    ) -> CliResult<Self> {
        Self::from_settings(|name| match (name, tenant.as_ref()) {
            (TENANT_ID_ENV, Some(tenant)) => Ok(tenant.as_str().to_owned()),
            _ => read(name),
        })
    }

    fn from_settings(mut read: impl FnMut(&str) -> CliResult<String>) -> CliResult<Self> {
        let account = Account::new(
            TenantId::new(read(TENANT_ID_ENV)?)?,
            UserId::new(read(USER_ID_ENV)?)?,
        );
        let secret = read(GRAPH_TOKEN_ENV)?;
        if secret.is_empty() || secret.chars().any(|c| c.is_control() || c.is_whitespace()) {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "Backend token must be nonempty and without whitespace",
            )
            .into());
        }
        let seconds = read(GRAPH_TOKEN_EXPIRY_ENV)?.parse::<u64>().map_err(|_| {
            io::Error::new(
                io::ErrorKind::InvalidInput,
                "Backend token expiry must be Unix seconds",
            )
        })?;
        let expires_at = UNIX_EPOCH
            .checked_add(Duration::from_secs(seconds))
            .filter(|expiry| {
                expiry
                    .duration_since(SystemTime::now())
                    .is_ok_and(|remaining| remaining >= Duration::from_secs(30))
            })
            .ok_or_else(|| {
                io::Error::new(
                    io::ErrorKind::InvalidInput,
                    "Supply a token with at least 30 seconds remaining",
                )
            })?;
        Ok(Self {
            account,
            audience: Audience::Graph,
            secret,
            expires_at,
        })
    }
}

#[async_trait]
impl TokenProvider for ApplicationCredentials {
    async fn acquire(
        &self,
        account: &Account,
        audience: Audience,
        force_refresh: bool,
    ) -> Result<AccessToken> {
        if account != &self.account || audience != self.audience || force_refresh {
            return Err(Error::new(ErrorCode::Authentication));
        }
        Ok(AccessToken {
            account: self.account.clone(),
            audience,
            expires_at: self.expires_at,
            secret: self.secret.clone(),
        })
    }
}

async fn run_command(
    session: &Session,
    command: Command,
    backend: Backend,
    output: &mut impl Write,
) -> CliResult<()> {
    let context = OperationContext::default();
    let (count, more) = match command {
        Command::Watch(seconds) => {
            let mut subscription = session.notifications(64)?;
            let result = watch_notifications(&mut subscription, seconds, output).await;
            subscription.close().await?;
            return result;
        }
        Command::List => {
            let page = session.chats(backend, None, &context).await?;
            for chat in &page.items {
                let Conversation::Chat(id) = chat.reference.conversation() else {
                    return Err(Error::new(ErrorCode::Protocol).into());
                };
                writeln!(output, "{}\t{:?}", id.as_str(), chat.kind)?;
            }
            (page.items.len(), page.next.is_some())
        }
        Command::View(id) => {
            let chat = session.conversation(backend, Conversation::Chat(id))?;
            let page = session.history(&chat, None, &context).await?;
            for message in &page.items {
                // Debug-format strings to escape terminal controls in untrusted display content.
                writeln!(
                    output,
                    "{}\t{:?}\t{:?}\t{:?}{}{}",
                    message.metadata.created_at,
                    message.metadata.reference.id().as_str(),
                    message.sender_name.as_deref().unwrap_or("(unknown sender)"),
                    message.text,
                    if message.metadata.deleted {
                        " [deleted]"
                    } else {
                        ""
                    },
                    if message.text_truncated {
                        " [truncated]"
                    } else {
                        ""
                    },
                )?;
            }
            (page.items.len(), page.next.is_some())
        }
    };
    writeln!(output, "Read {count} items; more pages: {more}")?;
    Ok(())
}

async fn watch_notifications(
    subscription: &mut teams_sdk::notifications::Notifications,
    seconds: u64,
    output: &mut impl Write,
) -> CliResult<()> {
    use teams_sdk::notifications::{ChangeHint, NotificationState};
    let deadline = tokio::time::Instant::now() + Duration::from_secs(seconds);
    let mut registered = false;
    let mut previous = None;
    let mut tick = tokio::time::interval(Duration::from_millis(100));
    loop {
        let status = subscription.status();
        let snapshot = (status.state, status.error.as_ref().map(|error| error.code));
        if previous != Some(snapshot) {
            writeln!(output, "Status: {:?}; error: {:?}", snapshot.0, snapshot.1)?;
            output.flush()?;
            previous = Some(snapshot);
        }
        registered |= status.state == NotificationState::Registered;
        if status.state == NotificationState::Stopped {
            return Err(status
                .error
                .unwrap_or_else(|| Error::new(ErrorCode::Network))
                .into());
        }
        tokio::select! {
            biased;
            _ = tokio::time::sleep_until(deadline) => break,
            hint = subscription.next() => {
                match hint {
                    Some(ChangeHint::Changed { conversation, root }) => {
                        writeln!(output, "Changed: chat={:?}; message={:?}",
                            conversation.as_str(), root.as_ref().map(MessageId::as_str))?;
                    }
                    Some(ChangeHint::Reconcile(reason)) => {
                        writeln!(output, "Reconcile: {reason:?} (read history to reconcile)")?;
                    }
                    None => {
                        return Err(subscription.status().error
                            .unwrap_or_else(|| Error::new(ErrorCode::Network)).into());
                    }
                }
                output.flush()?;
            }
            _ = tick.tick() => {}
        }
    }
    if !registered {
        return Err(
            io::Error::other("Watch ended without successful notification registration").into(),
        );
    }
    let status = subscription.status();
    if status.state != NotificationState::Registered {
        if let Some(error) = status.error {
            return Err(error.into());
        }
        return Err(
            io::Error::other("Watch ended without an active notification registration").into(),
        );
    }
    writeln!(
        output,
        "Watch complete; registration verified (change hints are not message history)"
    )?;
    Ok(())
}

async fn execute() -> CliResult<()> {
    let options = Options::parse(&std::env::args().skip(1).collect::<Vec<_>>())?;
    let tenant = match options.tenant.clone() {
        Some(tenant) => Some(tenant),
        None => optional_setting(TENANT_ID_ENV)?
            .map(TenantId::new)
            .transpose()?,
    };
    let user = optional_setting(USER_ID_ENV)?
        .map(UserId::new)
        .transpose()?;
    let (audience, token_setting) = match options.backend {
        Backend::Graph => (Audience::Graph, GRAPH_TOKEN_ENV),
        Backend::Ic3 => (Audience::Ic3, IC3_TOKEN_ENV),
        _ => return Err(Error::new(ErrorCode::Unsupported).into()),
    };
    let (account, credentials): (_, Arc<dyn TokenProvider>) =
        if let Some(secret) = optional_setting(token_setting)? {
            let account = Account::new(
                tenant.ok_or_else(|| io::Error::other("Explicit tokens require a tenant ID"))?,
                user.ok_or_else(|| io::Error::other("Explicit tokens require TEAMS_USER_ID"))?,
            );
            let credentials = ApplicationCredentials::load_for(
                account.clone(),
                audience,
                Some(secret),
                read_setting,
            )?;
            (account, Arc::new(credentials))
        } else {
            let credentials = azure_cli::AzureCliCredentials::new(
                tenant,
                user,
                audience,
                &OperationContext::default(),
            )
            .await?;
            (credentials.account().clone(), Arc::new(credentials))
        };
    let client = options
        .configure(TeamsClient::builder(credentials))?
        .build()?;
    let session = client.session(account);
    let result = run_command(
        &session,
        options.command,
        options.backend,
        &mut io::stdout().lock(),
    )
    .await;
    session.close();
    result
}

#[tokio::main]
async fn main() -> std::process::ExitCode {
    let result = tokio::select! {
        biased;
        signal = tokio::signal::ctrl_c() => {
            Err(io::Error::other(if signal.is_ok() { "Cancelled" } else { "Cannot listen for cancellation" }).into())
        },
        result = execute() => result,
    };
    match result {
        Ok(()) => std::process::ExitCode::SUCCESS,
        Err(error) => {
            if let Some(error) = error.downcast_ref::<clap::Error>() {
                if error.print().is_err() {
                    return std::process::ExitCode::FAILURE;
                }
                return std::process::ExitCode::from(error.exit_code() as u8);
            }
            eprintln!("{error}");
            std::process::ExitCode::FAILURE
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn watch_defaults_and_duration_are_parsed() {
        for (args, seconds) in [
            (vec!["watch"], 60),
            (vec!["watch", "--seconds=1"], 1),
            (vec!["watch", "--seconds", "3600"], 3600),
        ] {
            let options =
                Options::parse(&args.into_iter().map(String::from).collect::<Vec<_>>()).unwrap();
            assert_eq!(options.command, Command::Watch(seconds));
            assert_eq!(options.backend, Backend::Ic3);
        }
    }

    #[tokio::test]
    async fn watch_verifies_registration_without_forwarding_bodies() {
        use teams_sdk::{
            http::{HttpRequest, HttpResponse, HttpTransport},
            notifications::{NotificationConnector, NotificationSocket},
        };
        struct Registrar;
        #[async_trait]
        impl HttpTransport for Registrar {
            async fn execute(&self, _: HttpRequest) -> Result<HttpResponse> {
                Ok(HttpResponse {
                    status: 204,
                    headers: Default::default(),
                    body: vec![],
                })
            }
        }
        struct Connector {
            disconnect: bool,
        }
        struct Socket(std::collections::VecDeque<String>);
        #[async_trait]
        impl NotificationConnector for Connector {
            async fn connect(&self, url: reqwest::Url) -> Result<Box<dyn NotificationSocket>> {
                assert_eq!(url.host_str(), Some("go.trouter.teams.microsoft.com"));
                let mut frames: std::collections::VecDeque<String> = [
                    "5:1+::{\"name\":\"trouter.connected\",\"args\":[{\"surl\":\"https://go.trouter.teams.microsoft.com/forwarding\"}]}".into(),
                    "3:::{\"id\":1,\"body\":{\"type\":\"EventMessage\",\"resourceType\":\"NewMessage\",\"resource\":{\"to\":\"chat\",\"content\":\"private-body\",\"properties\":{}}}}".into(),
                    "3:::{\"id\":2,\"body\":{\"type\":\"EventMessage\",\"resourceType\":\"NewMessage\",\"resource\":{\"to\":\"48:notes\",\"content\":\"private-self-body\",\"properties\":{}}}}".into(),
                ].into();
                if self.disconnect {
                    frames.push_back("5:::invalid-json".into());
                }
                Ok(Box::new(Socket(frames)))
            }
        }
        #[async_trait]
        impl NotificationSocket for Socket {
            async fn send(&mut self, _: String) -> Result<()> {
                Ok(())
            }
            async fn receive(&mut self) -> Result<Option<String>> {
                if let Some(frame) = self.0.pop_front() {
                    Ok(Some(frame))
                } else {
                    std::future::pending().await
                }
            }
        }
        let credentials = ApplicationCredentials {
            account: Account::new(
                TenantId::new("tenant").unwrap(),
                UserId::new("user").unwrap(),
            ),
            audience: Audience::Ic3,
            secret: "synthetic".into(),
            expires_at: SystemTime::now() + Duration::from_secs(3600),
        };
        let account = credentials.account.clone();
        let session = TeamsClient::builder(Arc::new(credentials))
            .transport(Arc::new(Registrar))
            .ic3_region(teams_sdk::ic3::Region::Americas)
            .build()
            .unwrap()
            .session(account);
        let mut subscription = session
            .notifications_with_connector(64, Arc::new(Connector { disconnect: false }))
            .unwrap();
        let mut output = Vec::new();
        watch_notifications(&mut subscription, 1, &mut output)
            .await
            .unwrap();
        subscription.close().await.unwrap();
        let text = String::from_utf8(output).unwrap();
        assert!(text.contains("Registered"));
        assert!(text.contains("Changed: chat=\"chat\""));
        assert!(text.contains("Changed: chat=\"48:notes\""));
        assert!(text.contains("registration verified"));
        assert!(!text.contains("private-body"));
        assert!(!text.contains("private-self-body"));
        assert!(!text.contains("synthetic"));
        let mut subscription = session
            .notifications_with_connector(64, Arc::new(Connector { disconnect: true }))
            .unwrap();
        let mut output = Vec::new();
        let error = watch_notifications(&mut subscription, 1, &mut output)
            .await
            .unwrap_err();
        assert!(!error.to_string().is_empty());
        assert!(!String::from_utf8(output)
            .unwrap()
            .contains("Watch complete"));
        subscription.close().await.unwrap();
        session.close();
    }

    #[tokio::test]
    async fn watch_fails_if_registration_never_completes() {
        use teams_sdk::notifications::{NotificationConnector, NotificationSocket};
        struct Connector;
        #[async_trait]
        impl NotificationConnector for Connector {
            async fn connect(&self, _: reqwest::Url) -> Result<Box<dyn NotificationSocket>> {
                std::future::pending().await
            }
        }
        let credentials = ApplicationCredentials {
            account: Account::new(
                TenantId::new("tenant").unwrap(),
                UserId::new("user").unwrap(),
            ),
            audience: Audience::Ic3,
            secret: "synthetic".into(),
            expires_at: SystemTime::now() + Duration::from_secs(3600),
        };
        let account = credentials.account.clone();
        let session = TeamsClient::builder(Arc::new(credentials))
            .ic3_region(teams_sdk::ic3::Region::Americas)
            .build()
            .unwrap()
            .session(account);
        let mut subscription = session
            .notifications_with_connector(64, Arc::new(Connector))
            .unwrap();
        let error = watch_notifications(&mut subscription, 1, &mut Vec::new())
            .await
            .unwrap_err();
        assert!(error
            .to_string()
            .contains("without successful notification registration"));
        subscription.close().await.unwrap();
        session.close();
    }

    fn options(args: &[&str]) -> CliResult<Options> {
        Options::parse(&args.iter().map(|arg| arg.to_string()).collect::<Vec<_>>())
    }

    #[test]
    fn backend_options_validate_region_duplicates_and_missing_features() {
        assert!(options(&["list"]).is_ok());
        for args in [
            vec!["list"],
            vec!["view", "example-chat"],
            vec!["list", "--backend", "ic3"],
            vec!["--backend", "ic3", "view", "example-chat"],
        ] {
            let parsed = options(&args).unwrap();
            assert_eq!(parsed.backend, Backend::Ic3);
            assert_eq!(parsed.region.as_deref(), Some("amer"));
        }
        let graph = options(&["list", "--backend", "graph"]);
        assert_eq!(graph.is_ok(), cfg!(feature = "graph"));
        if let Ok(parsed) = graph {
            assert_eq!(parsed.backend, Backend::Graph);
            assert!(parsed.region.is_none());
        }
        for region in ["amer", "emea", "apac"] {
            for args in [
                vec!["--backend", "ic3", "--region", region, "list"],
                vec!["list", "--region", region],
                vec![
                    "view",
                    "example-chat",
                    "--region",
                    region,
                    "--backend",
                    "ic3",
                ],
            ] {
                let parsed = options(&args).unwrap();
                assert_eq!(parsed.backend, Backend::Ic3);
                assert_eq!(parsed.region.as_deref(), Some(region));
            }
        }
        for args in [
            vec!["list", "--backend"],
            vec!["list", "--backend", "unknown"],
            vec!["list", "--backend", "ic3", "--region", "unknown"],
            vec!["list", "--backend", "graph", "--region", "amer"],
            vec!["list", "--region"],
            vec![
                "list",
                "--backend",
                "ic3",
                "--backend",
                "graph",
                "--region",
                "amer",
            ],
            vec![
                "list",
                "--backend",
                "ic3",
                "--region",
                "amer",
                "--region",
                "emea",
            ],
        ] {
            assert!(options(&args).is_err());
        }
        for args in [
            vec!["teams-cli", "--help"],
            vec!["teams-cli", "--backend", "ic3", "--help"],
        ] {
            assert_eq!(
                cli().try_get_matches_from(args).unwrap_err().kind(),
                clap::error::ErrorKind::DisplayHelp
            );
        }
    }

    #[tokio::test]
    async fn ic3_credentials_use_only_ic3_resource_expiry_and_audience() {
        let credentials = ApplicationCredentials::load_for(
            azure_account(),
            Audience::Ic3,
            Some("synthetic-ic3-token".into()),
            |name| {
                assert_eq!(name, "TEAMS_IC3_TOKEN_EXPIRES_AT");
                settings("TEAMS_GRAPH_TOKEN_EXPIRES_AT")
            },
        )
        .unwrap();
        assert!(credentials
            .acquire(&credentials.account, Audience::Graph, false)
            .await
            .is_err());
        assert!(credentials
            .acquire(&credentials.account, Audience::Ic3, true)
            .await
            .is_err());
        let token = credentials
            .acquire(&credentials.account, Audience::Ic3, false)
            .await
            .unwrap();
        assert_eq!(token.secret, "synthetic-ic3-token");

        assert!(
            ApplicationCredentials::load_for(azure_account(), Audience::Ic3, None, settings,)
                .is_err()
        );
    }

    #[tokio::test]
    async fn ic3_list_and_view_use_region_pinned_reads_without_graph_fallback() {
        use serde_json::json;
        use std::{collections::VecDeque, sync::Mutex};
        use teams_sdk::http::{HttpRequest, HttpResponse, HttpTransport};

        struct Mock {
            region: String,
            replies: Mutex<VecDeque<serde_json::Value>>,
            paths: Mutex<Vec<String>>,
            status: u16,
        }
        #[async_trait]
        impl HttpTransport for Mock {
            async fn execute(&self, request: HttpRequest) -> Result<HttpResponse> {
                assert_eq!(request.method, reqwest::Method::GET);
                assert_eq!(request.url.host_str(), Some("teams.cloud.microsoft"));
                assert!(request.url.path().starts_with(&format!(
                    "/api/chatsvc/{}/v1/users/ME/conversations",
                    self.region
                )));
                self.paths
                    .lock()
                    .unwrap()
                    .push(request.url.path().to_owned());
                Ok(HttpResponse {
                    status: self.status,
                    headers: reqwest::header::HeaderMap::new(),
                    body: serde_json::to_vec(&self.replies.lock().unwrap().pop_front().unwrap())
                        .unwrap(),
                })
            }
        }

        for region in ["amer", "emea", "apac"] {
            for (command, replies) in [
                (
                    Command::List,
                    vec![json!({"conversations": [
                        {"id":"chat","threadProperties":{"threadType":"chat","productThreadType":"OneToOneChat"}}
                    ]})],
                ),
                (
                    Command::View(ChatId::new("chat").unwrap()),
                    vec![
                        json!({"id":"chat","threadProperties":{"threadType":"chat","productThreadType":"OneToOneChat"}}),
                        json!({"messages":[{
                            "id":"example-message","conversationid":"chat","version":"1767229200000",
                            "originalarrivaltime":"2026-01-01T00:00:00Z","messagetype":"Text",
                            "from":"8:orgid:example-sender","content":"Hello\n\u{1b}[2J","properties":{"mentions":"[]"}
                        }]}),
                    ],
                ),
            ] {
                let expected_count = replies.len();
                let credentials = ApplicationCredentials::load_for(
                    azure_account(),
                    Audience::Ic3,
                    Some("synthetic-ic3-token".into()),
                    |_| settings("TEAMS_GRAPH_TOKEN_EXPIRES_AT"),
                )
                .unwrap();
                let account = credentials.account.clone();
                let mock = Arc::new(Mock {
                    region: region.into(),
                    replies: Mutex::new(replies.into()),
                    paths: Mutex::new(Vec::new()),
                    status: 200,
                });
                let config = if region == "amer" {
                    options(&["list"])
                } else {
                    options(&["list", "--backend", "ic3", "--region", region])
                }
                .unwrap();
                let client = config
                    .configure(TeamsClient::builder(Arc::new(credentials)).transport(mock.clone()))
                    .unwrap()
                    .build()
                    .unwrap();
                let session = client.session(account);
                let mut output = Vec::new();
                run_command(&session, command, Backend::Ic3, &mut output)
                    .await
                    .unwrap();
                session.close();
                let output = String::from_utf8(output).unwrap();
                assert!(output.contains("Read 1 items; more pages: false"));
                assert!(!output.contains('\u{1b}'));
                let paths = mock.paths.lock().unwrap();
                assert_eq!(paths.len(), expected_count);
                if expected_count == 2 {
                    assert!(paths[0].ends_with("/chat"));
                    assert!(paths[1].ends_with("/chat/messages"));
                    assert!(output.contains("Hello\\n\\u{1b}[2J"));
                } else {
                    assert!(output.contains("chat\tOneOnOne"));
                }
            }
        }

        let credentials = ApplicationCredentials::load_for(
            azure_account(),
            Audience::Ic3,
            Some("synthetic-ic3-token".into()),
            |_| settings("TEAMS_GRAPH_TOKEN_EXPIRES_AT"),
        )
        .unwrap();
        let account = credentials.account.clone();
        let mock = Arc::new(Mock {
            region: "amer".into(),
            replies: Mutex::new(vec![json!({})].into()),
            paths: Mutex::new(Vec::new()),
            status: 403,
        });
        let client = options(&["list", "--backend", "ic3", "--region", "amer"])
            .unwrap()
            .configure(TeamsClient::builder(Arc::new(credentials)).transport(mock.clone()))
            .unwrap()
            .build()
            .unwrap();
        let session = client.session(account);
        assert!(
            run_command(&session, Command::List, Backend::Ic3, &mut Vec::new())
                .await
                .is_err()
        );
        assert_eq!(mock.paths.lock().unwrap().len(), 1);
        session.close();
    }

    fn settings(name: &str) -> CliResult<String> {
        Ok(match name {
            "TEAMS_TENANT_ID" => "example-tenant".into(),
            "TEAMS_USER_ID" => "example-user".into(),
            "TEAMS_GRAPH_TOKEN" => "synthetic-token".into(),
            "TEAMS_GRAPH_TOKEN_EXPIRES_AT" => {
                (SystemTime::now().duration_since(UNIX_EPOCH)?.as_secs() + 3600).to_string()
            }
            _ => panic!("unexpected setting"),
        })
    }

    fn azure_account() -> Account {
        Account::new(
            TenantId::new("00000000-0000-0000-0000-000000000001").unwrap(),
            UserId::new("00000000-0000-0000-0000-000000000002").unwrap(),
        )
    }

    #[test]
    fn explicit_token_takes_priority_and_requires_its_own_expiry() {
        let credentials =
            ApplicationCredentials::load(azure_account(), Some("explicit-token".into()), settings)
                .unwrap();
        assert_eq!(credentials.secret, "explicit-token");
        assert!(ApplicationCredentials::load(
            azure_account(),
            Some("explicit-token".into()),
            |_| Err(io::Error::other("missing expiry").into()),
        )
        .is_err());
        assert!(
            ApplicationCredentials::load(azure_account(), Some(String::new()), settings,).is_err()
        );
    }

    #[test]
    fn commands_and_help() {
        cli().debug_assert();
        let parsed = cli()
            .try_get_matches_from([
                "teams-cli",
                "--tenant-id=argument-tenant",
                "view",
                "example-chat",
                "--backend=graph",
            ])
            .unwrap();
        assert_eq!(
            parsed.get_one::<TenantId>("tenant-id").unwrap().as_str(),
            "argument-tenant"
        );
        assert_eq!(parsed.get_one::<String>("backend").unwrap(), "graph");
        for help in ["--help", "-h"] {
            assert_eq!(
                cli()
                    .try_get_matches_from(["teams-cli", help])
                    .unwrap_err()
                    .kind(),
                clap::error::ErrorKind::DisplayHelp
            );
        }
        assert_eq!(
            cli()
                .try_get_matches_from(["teams-cli", "list"])
                .unwrap()
                .subcommand_name(),
            Some("list")
        );
        assert_eq!(
            cli()
                .try_get_matches_from(["teams-cli", "view", "example-chat"])
                .unwrap()
                .subcommand_matches("view")
                .unwrap()
                .get_one::<ChatId>("chat-id"),
            Some(&ChatId::new("example-chat").unwrap())
        );
        for args in [
            vec![],
            vec!["unknown"],
            vec!["view"],
            vec!["list", "extra"],
            vec!["view", "chat", "extra"],
            vec!["view", ""],
            vec!["view", ".."],
            vec!["view", "chat\n"],
        ] {
            assert!(cli()
                .try_get_matches_from(std::iter::once("teams-cli").chain(args))
                .is_err());
        }
    }

    #[test]
    fn tenant_argument_works_before_or_after_both_commands() {
        for args in [
            vec!["--tenant-id", "argument-tenant", "list"],
            vec!["list", "--tenant-id", "argument-tenant"],
            vec!["--tenant-id", "argument-tenant", "view", "example-chat"],
            vec!["view", "example-chat", "--tenant-id", "argument-tenant"],
        ] {
            let args = args.into_iter().map(String::from).collect::<Vec<_>>();
            let parsed = cli()
                .try_get_matches_from(
                    std::iter::once("teams-cli".to_owned()).chain(args.iter().cloned()),
                )
                .unwrap();
            assert_eq!(
                parsed.get_one::<TenantId>("tenant-id").unwrap().as_str(),
                "argument-tenant"
            );
            assert_eq!(
                parsed.subcommand_name().unwrap(),
                if args.iter().any(|arg| arg == "view") {
                    "view"
                } else {
                    "list"
                }
            );
        }
        assert!(cli()
            .try_get_matches_from(["teams-cli", "list"])
            .unwrap()
            .get_one::<TenantId>("tenant-id")
            .is_none());
    }

    #[test]
    fn tenant_argument_rejects_missing_duplicate_and_invalid_values() {
        for args in [
            vec!["list", "--tenant-id"],
            vec!["--tenant-id", "--help"],
            vec!["list", "--tenant-id", ""],
            vec!["list", "--tenant-id", ".."],
            vec!["list", "--tenant-id", "tenant\n"],
            vec!["list", "--tenant-id", "one", "--tenant-id", "two"],
            vec!["list", "--unknown", "tenant"],
        ] {
            let args = args.into_iter().map(String::from).collect::<Vec<_>>();
            assert!(cli()
                .try_get_matches_from(std::iter::once("teams-cli".to_owned()).chain(args))
                .is_err());
        }
    }

    #[test]
    fn argument_tenant_overrides_environment_and_does_not_require_it() {
        for missing in [false, true] {
            let credentials = ApplicationCredentials::with_tenant(
                Some(TenantId::new("argument-tenant").unwrap()),
                |name| {
                    if name == "TEAMS_TENANT_ID" && missing {
                        panic!("tenant environment must not be read when overridden");
                    }
                    settings(name)
                },
            )
            .unwrap();
            assert_eq!(credentials.account.tenant.as_str(), "argument-tenant");
        }
        let credentials = ApplicationCredentials::with_tenant(None, settings).unwrap();
        assert_eq!(credentials.account.tenant.as_str(), "example-tenant");
        assert!(ApplicationCredentials::with_tenant(None, |name| {
            if name == "TEAMS_TENANT_ID" {
                Err(io::Error::new(io::ErrorKind::InvalidInput, "missing tenant").into())
            } else {
                settings(name)
            }
        })
        .is_err());
    }

    #[test]
    fn credentials_require_valid_expiry_and_all_settings() {
        for missing in [
            "TEAMS_TENANT_ID",
            "TEAMS_USER_ID",
            "TEAMS_GRAPH_TOKEN",
            "TEAMS_GRAPH_TOKEN_EXPIRES_AT",
        ] {
            assert!(ApplicationCredentials::from_settings(|name| {
                if name == missing {
                    Err(io::Error::new(io::ErrorKind::InvalidInput, "missing setting").into())
                } else {
                    settings(name)
                }
            })
            .is_err());
        }
        for (key, value) in [
            ("TEAMS_GRAPH_TOKEN", ""),
            ("TEAMS_GRAPH_TOKEN", "synthetic token"),
            ("TEAMS_GRAPH_TOKEN_EXPIRES_AT", "invalid"),
            ("TEAMS_GRAPH_TOKEN_EXPIRES_AT", "0"),
            ("TEAMS_GRAPH_TOKEN_EXPIRES_AT", "18446744073709551615"),
            ("TEAMS_USER_ID", ""),
        ] {
            assert!(ApplicationCredentials::from_settings(|name| {
                if name == key {
                    Ok(value.into())
                } else {
                    settings(name)
                }
            })
            .is_err());
        }
    }

    #[tokio::test]
    async fn credentials_are_account_and_audience_pinned_and_cannot_refresh() {
        let credentials = ApplicationCredentials::from_settings(settings).unwrap();
        let token = credentials
            .acquire(&credentials.account, Audience::Graph, false)
            .await
            .unwrap();
        assert_eq!(token.secret, "synthetic-token");
        let other = Account::new(
            credentials.account.tenant.clone(),
            UserId::new("other-user").unwrap(),
        );
        for (account, audience, refresh) in [
            (&other, Audience::Graph, false),
            (&credentials.account, Audience::TeamsMcp, false),
            (&credentials.account, Audience::Ic3, false),
            (&credentials.account, Audience::Graph, true),
        ] {
            assert_eq!(
                credentials
                    .acquire(account, audience, refresh)
                    .await
                    .err()
                    .unwrap()
                    .code,
                ErrorCode::Authentication
            );
        }
    }

    #[cfg(feature = "graph")]
    mod graph {
        use super::*;
        use reqwest::header::HeaderMap;
        use serde_json::{json, Value};
        use teams_sdk::http::{HttpRequest, HttpResponse, HttpTransport};

        struct Mock {
            path: &'static str,
            status: u16,
            body: Value,
        }

        #[async_trait]
        impl HttpTransport for Mock {
            async fn execute(&self, request: HttpRequest) -> Result<HttpResponse> {
                assert_eq!(request.method, reqwest::Method::GET);
                assert_eq!(request.url.path(), self.path);
                Ok(HttpResponse {
                    status: self.status,
                    headers: HeaderMap::new(),
                    body: serde_json::to_vec(&self.body).unwrap(),
                })
            }
        }

        async fn run(
            command: Command,
            path: &'static str,
            status: u16,
            body: Value,
        ) -> CliResult<String> {
            let credentials = ApplicationCredentials::from_settings(settings)?;
            let account = credentials.account.clone();
            let client = TeamsClient::builder(Arc::new(credentials))
                .transport(Arc::new(Mock { path, status, body }))
                .build()?;
            let session = client.session(account);
            let mut output = Vec::new();
            let result = run_command(&session, command, Backend::Graph, &mut output).await;
            session.close();
            result?;
            Ok(String::from_utf8(output)?)
        }

        #[tokio::test]
        async fn list_prints_usable_ids_and_reports_more_pages() {
            let output = run(
                Command::List,
                "/v1.0/me/chats",
                200,
                json!({
                    "value": [{"id": "example-chat", "chatType": "group"}],
                    "@odata.nextLink": "https://graph.microsoft.com/v1.0/me/chats?$skiptoken=next"
                }),
            )
            .await
            .unwrap();
            assert!(output.contains("example-chat\tGroup"));
            assert!(output.contains("Read 1 items; more pages: true"));
            assert!(!output.contains("synthetic-token"));
            let empty = run(Command::List, "/v1.0/me/chats", 200, json!({"value": []}))
                .await
                .unwrap();
            assert!(empty.contains("Read 0 items; more pages: false"));
        }

        #[tokio::test]
        async fn view_reads_history_and_escapes_untrusted_terminal_controls() {
            let output = run(
                Command::View(ChatId::new("example-chat").unwrap()),
                "/v1.0/chats/example-chat/messages",
                200,
                json!({"value": [{
                    "id": "example-message",
                    "createdDateTime": "2026-01-01T00:00:00Z",
                    "lastModifiedDateTime": "2026-01-01T00:00:00Z",
                    "from": {"user": {"id": "example-sender", "displayName": "Example\u{1b}[2J"}},
                    "body": {"contentType": "text", "content": "Hello\n\u{1b}[2J"},
                    "mentions": []
                }]}),
            )
            .await
            .unwrap();
            assert!(output.contains("example-message"));
            assert!(output.contains("Hello\\n\\u{1b}[2J"));
            assert!(!output.contains('\u{1b}'));
            assert!(output.contains("more pages: false"));
        }

        #[tokio::test]
        async fn graph_failures_are_not_success_shaped_or_token_bearing() {
            for status in [401, 403, 404] {
                let error = run(Command::List, "/v1.0/me/chats", status, json!({}))
                    .await
                    .err()
                    .unwrap()
                    .to_string();
                assert!(error.contains("Teams operation failed"));
                assert!(!error.contains("synthetic-token"));
            }
        }
    }
}
