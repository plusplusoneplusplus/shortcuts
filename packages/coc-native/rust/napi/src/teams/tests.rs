use super::*;
use async_trait::async_trait;
use teams_sdk::{
    auth::{AccessToken, TokenProvider},
    capabilities::Operation,
    Account, Delivery,
};

struct UnusedTokens;
#[async_trait]
impl TokenProvider for UnusedTokens {
    async fn acquire(&self, _: &Account, _: Audience, _: bool) -> teams_sdk::Result<AccessToken> {
        panic!("lifecycle tests must not acquire credentials")
    }
}

fn session() -> Session {
    client(Arc::new(UnusedTokens), Region::Americas).unwrap().session(Account::new(
        TenantId::new("fixture-tenant").unwrap(),
        UserId::new("fixture-user").unwrap(),
    ))
}

fn options(region: &str, timeout_ms: Option<u32>) -> TeamsIc3SessionOptions {
    TeamsIc3SessionOptions {
        region: region.into(),
        expected_tenant_id: None,
        expected_user_id: None,
        timeout_ms,
    }
}

#[test]
fn configuration_requires_region_and_bounded_deadline() {
    for region in ["amer", "emea", "apac"] {
        let config = Configuration::try_from(options(region, None)).unwrap();
        assert_eq!(config.timeout, Duration::from_secs(30));
    }
    for region in ["", "auto", "AMER", " amer", "https://fixture.example"] {
        assert_eq!(
            Configuration::try_from(options(region, None)).err().unwrap().code,
            ErrorCode::Configuration
        );
    }
    for timeout in [0, 99, 30_001, u32::MAX] {
        assert_eq!(
            Configuration::try_from(options("amer", Some(timeout))).err().unwrap().code,
            ErrorCode::Configuration
        );
    }
    for timeout in [100, 30_000] {
        assert!(Configuration::try_from(options("amer", Some(timeout))).is_ok());
    }
    for tenant in [true, false] {
        let mut value = options("amer", None);
        if tenant {
            value.expected_tenant_id = Some(" ".into());
        } else {
            value.expected_user_id = Some("\n".into());
        }
        assert_eq!(Configuration::try_from(value).err().unwrap().code, ErrorCode::Configuration);
    }
}

#[test]
fn session_has_no_write_routes() {
    let session = session();
    for operation in [
        Operation::SelfSend,
        Operation::ChatSend,
        Operation::ChannelSend,
        Operation::ChannelReply,
        Operation::ChannelLike,
    ] {
        assert!(!session.supports(operation));
    }
}

#[test]
fn initialization_is_one_shot_even_when_it_fails() {
    let lifetime = Lifetime::default();
    lifetime.begin(Duration::from_secs(1)).unwrap();
    assert_eq!(
        lifetime.begin(Duration::from_secs(1)).err().unwrap().code,
        ErrorCode::InvalidTarget
    );
    lifetime.close();
    assert_eq!(lifetime.begin(Duration::from_secs(1)).err().unwrap().code, ErrorCode::Closed);
}

#[tokio::test]
async fn close_before_dispatch_does_not_poll_initialization() {
    let lifetime = Lifetime::default();
    let ctx = lifetime.begin(Duration::from_secs(1)).unwrap();
    lifetime.close();
    let result = lifetime.connect(&ctx, async { panic!("must not start credentials") }).await;
    assert_eq!(result.err().unwrap().code, ErrorCode::Closed);
}

#[tokio::test]
async fn close_drops_pending_initialization_without_waiting_for_credentials() {
    let lifetime = Arc::new(Lifetime::default());
    let ctx = lifetime.begin(Duration::from_secs(10)).unwrap();
    let dropped = Arc::new(AtomicBool::new(false));
    struct OnDrop(Arc<AtomicBool>);
    impl Drop for OnDrop {
        fn drop(&mut self) {
            self.0.store(true, Ordering::Release);
        }
    }
    let (started_tx, started_rx) = tokio::sync::oneshot::channel();
    let pending = {
        let lifetime = lifetime.clone();
        let dropped = dropped.clone();
        tokio::spawn(async move {
            lifetime
                .connect(&ctx, async {
                    let _guard = OnDrop(dropped);
                    let _ = started_tx.send(());
                    std::future::pending().await
                })
                .await
        })
    };
    started_rx.await.unwrap();
    lifetime.close();
    assert_eq!(pending.await.unwrap().err().unwrap().code, ErrorCode::Closed);
    assert!(dropped.load(Ordering::Acquire));
}

#[tokio::test]
async fn expired_deadline_does_not_dispatch_or_publish() {
    let lifetime = Lifetime::default();
    let mut ctx = lifetime.begin(Duration::from_secs(1)).unwrap();
    ctx.deadline = tokio::time::Instant::now() - Duration::from_millis(1);
    let result = lifetime.connect(&ctx, async { panic!("must not start credentials") }).await;
    assert_eq!(result.err().unwrap().code, ErrorCode::Timeout);
    let candidate = session();
    assert_eq!(lifetime.publish(&ctx, candidate.clone()).err().unwrap().code, ErrorCode::Timeout);
    assert!(candidate.is_closed());
    assert!(lifetime.session.lock().unwrap().is_none());
}

#[tokio::test]
async fn ready_result_is_revoked_when_initialization_closes_its_owner() {
    let lifetime = Lifetime::default();
    let ctx = lifetime.begin(Duration::from_secs(1)).unwrap();
    let candidate = session();
    let result = lifetime
        .connect(&ctx, async {
            lifetime.close();
            Ok(candidate.clone())
        })
        .await;
    assert_eq!(result.err().unwrap().code, ErrorCode::Closed);
    assert!(candidate.is_closed());
}

#[test]
fn publication_checks_close_and_disposal_releases_pinned_session() {
    let lifetime = Lifetime::default();
    let ctx = lifetime.begin(Duration::from_secs(1)).unwrap();
    let candidate = session();
    let account = lifetime.publish(&ctx, candidate.clone()).unwrap();
    assert_eq!(account.tenant_id, "fixture-tenant");
    assert_eq!(account.user_id, "fixture-user");
    lifetime.close();
    lifetime.close();
    assert!(candidate.is_closed());
    assert!(lifetime.session.lock().unwrap().is_none());
    let late = session();
    assert_eq!(lifetime.publish(&ctx, late.clone()).err().unwrap().code, ErrorCode::Closed);
    assert!(late.is_closed());
    assert!(lifetime.session.lock().unwrap().is_none());
}

#[tokio::test]
async fn failed_credentials_do_not_publish_an_account() {
    let lifetime = Lifetime::default();
    let ctx = lifetime.begin(Duration::from_secs(1)).unwrap();
    let result = lifetime
        .connect(&ctx, async { Err(teams_sdk::Error::new(ErrorCode::Authentication)) })
        .await;
    assert_eq!(result.err().unwrap().code, ErrorCode::Authentication);
    assert!(lifetime.session.lock().unwrap().is_none());
}

#[test]
fn diagnostics_preserve_only_safe_error_fields() {
    let mut failure = teams_sdk::Error::new(ErrorCode::RateLimited);
    failure.delivery = Delivery::Rejected;
    failure.status = Some(429);
    failure.retry_after = Some(Duration::from_secs(2));
    assert_eq!(
        error(failure).reason,
        "[teams-sdk:RateLimited:Rejected:429:2000] Teams operation failed."
    );
}
