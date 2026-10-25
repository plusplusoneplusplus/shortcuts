use napi::{bindgen_prelude::PromiseRaw, Env, Error, Result};
use napi_derive::napi;
use std::{
    future::Future,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};
use teams_sdk::{
    auth::Audience, azure_cli::AzureCliCredentials, capabilities::Routes, ic3::Region,
    CancellationToken, ErrorCode, OperationContext, Session, TeamsClient, TenantId, UserId,
};

fn error(value: teams_sdk::Error) -> Error {
    Error::from_reason(format!(
        "[teams-sdk:{:?}:{:?}:{}:{}] Teams operation failed.",
        value.code,
        value.delivery,
        value.status.map(|status| status.to_string()).unwrap_or_default(),
        value.retry_after.map(|delay| delay.as_millis().to_string()).unwrap_or_default(),
    ))
}

#[napi(object)]
pub struct TeamsIc3SessionOptions {
    pub region: String,
    pub expected_tenant_id: Option<String>,
    pub expected_user_id: Option<String>,
    pub timeout_ms: Option<u32>,
}

#[napi(object)]
pub struct TeamsIc3Account {
    pub tenant_id: String,
    pub user_id: String,
}

struct Configuration {
    region: Region,
    tenant: Option<TenantId>,
    user: Option<UserId>,
    timeout: Duration,
}

impl TryFrom<TeamsIc3SessionOptions> for Configuration {
    type Error = teams_sdk::Error;

    fn try_from(value: TeamsIc3SessionOptions) -> teams_sdk::Result<Self> {
        let invalid = || teams_sdk::Error::new(ErrorCode::Configuration);
        let region = match value.region.as_str() {
            "amer" => Region::Americas,
            "emea" => Region::EuropeMiddleEastAfrica,
            "apac" => Region::AsiaPacific,
            _ => return Err(invalid()),
        };
        let timeout = value.timeout_ms.unwrap_or(30_000);
        if !(100..=30_000).contains(&timeout) {
            return Err(invalid());
        }
        Ok(Self {
            region,
            tenant: value
                .expected_tenant_id
                .map(TenantId::new)
                .transpose()
                .map_err(|_| invalid())?,
            user: value.expected_user_id.map(UserId::new).transpose().map_err(|_| invalid())?,
            timeout: Duration::from_millis(timeout as u64),
        })
    }
}

#[derive(Default)]
struct Lifetime {
    started: AtomicBool,
    cancellation: CancellationToken,
    session: Mutex<Option<Session>>,
}

impl Lifetime {
    fn check(&self, ctx: &OperationContext) -> teams_sdk::Result<()> {
        if self.cancellation.is_cancelled() {
            return Err(teams_sdk::Error::new(ErrorCode::Closed));
        }
        if tokio::time::Instant::now() >= ctx.deadline {
            return Err(teams_sdk::Error::new(ErrorCode::Timeout));
        }
        Ok(())
    }

    fn begin(&self, timeout: Duration) -> teams_sdk::Result<OperationContext> {
        let mut ctx = OperationContext::with_timeout(timeout);
        ctx.cancellation = self.cancellation.clone();
        self.check(&ctx)?;
        if self.started.swap(true, Ordering::AcqRel) {
            return Err(teams_sdk::Error::new(ErrorCode::InvalidTarget));
        }
        Ok(ctx)
    }

    async fn connect(
        &self,
        ctx: &OperationContext,
        future: impl Future<Output = teams_sdk::Result<Session>>,
    ) -> teams_sdk::Result<Session> {
        self.check(ctx)?;
        let result = tokio::select! {
            biased;
            _ = self.cancellation.cancelled() => Err(teams_sdk::Error::new(ErrorCode::Closed)),
            _ = tokio::time::sleep_until(ctx.deadline) => Err(teams_sdk::Error::new(ErrorCode::Timeout)),
            result = future => result,
        };
        if let Err(failure) = self.check(ctx) {
            if let Ok(session) = result {
                session.close();
            }
            return Err(failure);
        }
        result
    }

    fn publish(
        &self,
        ctx: &OperationContext,
        session: Session,
    ) -> teams_sdk::Result<TeamsIc3Account> {
        let mut current = self.session.lock().map_err(|_| {
            session.close();
            teams_sdk::Error::new(ErrorCode::Closed)
        })?;
        if let Err(failure) = self.check(ctx) {
            session.close();
            return Err(failure);
        }
        let account = session.account();
        let result = TeamsIc3Account {
            tenant_id: account.tenant.as_str().to_owned(),
            user_id: account.user.as_str().to_owned(),
        };
        *current = Some(session);
        Ok(result)
    }

    fn close(&self) {
        self.cancellation.cancel();
        if let Some(session) = self.session.lock().unwrap_or_else(|e| e.into_inner()).take() {
            session.close();
        }
    }
}

fn client(
    tokens: Arc<dyn teams_sdk::auth::TokenProvider>,
    region: Region,
) -> teams_sdk::Result<TeamsClient> {
    TeamsClient::builder(tokens)
        .ic3_region(region)
        .routes(Routes {
            self_send: None,
            chat_send: None,
            channel_send: None,
            channel_reply: None,
            channel_like: None,
        })
        .build()
}

/// Account-pinned IC3 access; connection alone does not establish live authorization.
#[napi]
pub struct NativeTeamsIc3Session {
    configuration: Configuration,
    lifetime: Arc<Lifetime>,
}

#[napi]
impl NativeTeamsIc3Session {
    #[napi(constructor)]
    pub fn new(options: TeamsIc3SessionOptions) -> Result<Self> {
        Ok(Self { configuration: options.try_into().map_err(error)?, lifetime: Arc::default() })
    }

    /// One initialization attempt per handle. A failed attempt requires a new handle.
    #[napi]
    pub fn connect<'env>(&self, env: &'env Env) -> Result<PromiseRaw<'env, TeamsIc3Account>> {
        let ctx = self.lifetime.begin(self.configuration.timeout).map_err(error)?;
        let tenant = self.configuration.tenant.clone();
        let user = self.configuration.user.clone();
        let region = self.configuration.region;
        let lifetime = self.lifetime.clone();
        let publish = lifetime.clone();
        let publication_ctx = ctx.clone();
        env.spawn_future_with_callback(
            async move {
                lifetime
                    .connect(&ctx, async {
                        let credentials =
                            AzureCliCredentials::new(tenant, user, Audience::Ic3, &ctx).await?;
                        let account = credentials.account().clone();
                        Ok(client(Arc::new(credentials), region)?.session(account))
                    })
                    .await
                    .map_err(error)
            },
            move |_, session| publish.publish(&publication_ctx, session).map_err(error),
        )
    }

    #[napi]
    pub fn dispose(&self) {
        self.lifetime.close();
    }

    #[napi]
    pub fn begin_read(&self) -> Result<reads::NativeTeamsIc3Read> {
        reads::NativeTeamsIc3Read::new(self.lifetime.clone(), self.configuration.timeout)
            .map_err(error)
    }
}

impl Drop for NativeTeamsIc3Session {
    fn drop(&mut self) {
        self.lifetime.close();
    }
}

#[cfg(test)]
mod tests;

mod reads;
