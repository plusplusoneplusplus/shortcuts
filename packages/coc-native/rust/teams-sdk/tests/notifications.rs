use async_trait::async_trait;
use serde_json::json;
use std::{
    collections::VecDeque,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, Mutex,
    },
    time::{Duration, SystemTime},
};
use teams_sdk::{
    auth::{AccessToken, Audience, TokenProvider},
    http::{HttpRequest, HttpResponse, HttpTransport},
    ic3::Region,
    notifications::{
        ChangeHint, NotificationConnector, NotificationSocket, NotificationState, ReconcileReason,
    },
    *,
};
use url::Url;

struct Credentials;
#[async_trait]
impl TokenProvider for Credentials {
    async fn acquire(
        &self,
        account: &Account,
        audience: Audience,
        refresh: bool,
    ) -> Result<AccessToken> {
        if refresh {
            return Err(Error::new(ErrorCode::Authentication));
        }
        Ok(AccessToken {
            account: account.clone(),
            audience,
            secret: "synthetic".into(),
            expires_at: SystemTime::now() + Duration::from_secs(3600),
        })
    }
}
struct Registrar(AtomicUsize);
#[async_trait]
impl HttpTransport for Registrar {
    async fn execute(&self, request: HttpRequest) -> Result<HttpResponse> {
        assert_eq!(
            request.url.as_str(),
            "https://teams.cloud.microsoft/registrar/prod/V2/registrations"
        );
        let payload: serde_json::Value =
            serde_json::from_slice(request.body.as_ref().unwrap()).unwrap();
        assert_eq!(payload["clientDescription"]["appId"], "TeamsCDLWebWorker");
        assert_eq!(
            payload["clientDescription"]["templateKey"],
            "TeamsCDLWebWorker_2.6"
        );
        assert_eq!(
            payload["clientDescription"]["platformUIVersion"],
            "1415/26043019216"
        );
        self.0.fetch_add(1, Ordering::SeqCst);
        Ok(HttpResponse {
            status: 204,
            headers: Default::default(),
            body: vec![],
        })
    }
}
struct Connector {
    scripts: Mutex<VecDeque<Vec<String>>>,
    connections: AtomicUsize,
    sends: Arc<Mutex<Vec<String>>>,
    drops: Arc<AtomicUsize>,
}
struct Socket {
    frames: VecDeque<String>,
    sends: Arc<Mutex<Vec<String>>>,
    drops: Arc<AtomicUsize>,
}
impl Drop for Socket {
    fn drop(&mut self) {
        self.drops.fetch_add(1, Ordering::SeqCst);
    }
}
#[async_trait]
impl NotificationSocket for Socket {
    async fn send(&mut self, frame: String) -> Result<()> {
        self.sends.lock().unwrap().push(frame);
        Ok(())
    }
    async fn receive(&mut self) -> Result<Option<String>> {
        if let Some(frame) = self.frames.pop_front() {
            Ok(Some(frame))
        } else {
            std::future::pending().await
        }
    }
}
#[async_trait]
impl NotificationConnector for Connector {
    async fn connect(&self, url: Url) -> Result<Box<dyn NotificationSocket>> {
        assert_eq!(url.scheme(), "wss");
        assert_eq!(url.host_str(), Some("go.trouter.teams.microsoft.com"));
        assert_eq!(url.path(), "/v4/c/");
        let tc = url.query_pairs().find(|(key, _)| key == "tc").unwrap().1;
        let client: serde_json::Value = serde_json::from_str(&tc).unwrap();
        assert_eq!(client["cv"], "2026.16.01.1");
        assert_eq!(client["ua"], "TeamsCDL");
        assert_eq!(client["v"], "1415/26043019216");
        self.connections.fetch_add(1, Ordering::SeqCst);
        let frames = self
            .scripts
            .lock()
            .unwrap()
            .pop_front()
            .unwrap_or_default()
            .into();
        Ok(Box::new(Socket {
            frames,
            sends: self.sends.clone(),
            drops: self.drops.clone(),
        }))
    }
}
fn connected() -> String {
    format!(
        "5:1+::{}",
        json!({"name":"trouter.connected","args":[{"surl":"https://go.trouter.teams.microsoft.com/forwarding"}]})
    )
}
fn changed(id: &str) -> String {
    format!(
        "3:::{}",
        json!({"id":1,"body":{"type":"EventMessage","resourceType":"NewMessage",
        "resource":{"to":id,"content":"never-forwarded","properties":{}}}})
    )
}
fn fixture(scripts: Vec<Vec<String>>) -> (TeamsClient, Session, Arc<Connector>, Arc<Registrar>) {
    let registrar = Arc::new(Registrar(AtomicUsize::new(0)));
    let client = TeamsClient::builder(Arc::new(Credentials))
        .transport(registrar.clone())
        .ic3_region(Region::Americas)
        .build()
        .unwrap();
    let session = client.session(Account::new(
        TenantId::new("tenant").unwrap(),
        UserId::new("account").unwrap(),
    ));
    let connector = Arc::new(Connector {
        scripts: Mutex::new(scripts.into()),
        connections: AtomicUsize::new(0),
        sends: Arc::new(Mutex::new(vec![])),
        drops: Arc::new(AtomicUsize::new(0)),
    });
    (client, session, connector, registrar)
}
#[tokio::test(start_paused = true)]
async fn lifecycle_registers_acks_gaps_and_revokes_old_generation() {
    let (client, session, connector, registrar) = fixture(vec![
        vec![connected(), "2::".into(), changed("first"), "0::".into()],
        vec![connected(), changed("second")],
        vec![connected(), changed("third")],
    ]);
    let mut subscription = session
        .notifications_with_connector(64, connector.clone())
        .unwrap();
    let mut changed_ids = vec![];
    let mut disconnected = false;
    for _ in 0..10 {
        match subscription.next().await.unwrap() {
            ChangeHint::Changed { conversation, .. } => {
                changed_ids.push(conversation.as_str().to_owned());
                if changed_ids.len() == 2 {
                    break;
                }
            }
            ChangeHint::Reconcile(ReconcileReason::Disconnected) => disconnected = true,
            _ => {}
        }
    }
    assert_eq!(changed_ids, vec!["first", "second"]);
    assert!(disconnected);
    assert_eq!(registrar.0.load(Ordering::SeqCst), 2);
    assert!(connector.sends.lock().unwrap().iter().any(|s| s == "2::"));
    assert!(!connector
        .sends
        .lock()
        .unwrap()
        .join("")
        .contains("never-forwarded"));
    let next = client.reconnect(&session, session.account().clone());
    assert!(subscription.next().await.is_none());
    subscription.close().await.unwrap();
    assert_eq!(subscription.status().state, NotificationState::Stopped);
    assert_eq!(connector.drops.load(Ordering::SeqCst), 2);
    let mut fresh = next
        .notifications_with_connector(64, connector.clone())
        .unwrap();
    loop {
        if let Some(ChangeHint::Changed { conversation, .. }) = fresh.next().await {
            assert_eq!(conversation.as_str(), "third");
            break;
        }
    }
    fresh.close().await.unwrap();
    assert_eq!(connector.drops.load(Ordering::SeqCst), 3);
}
#[tokio::test]
async fn cancellation_before_start_never_connects() {
    let (_, session, connector, registrar) = fixture(vec![vec![connected()]]);
    let mut subscription = session
        .notifications_with_connector(2, connector.clone())
        .unwrap();
    session.close();
    subscription.close().await.unwrap();
    assert_eq!(connector.connections.load(Ordering::SeqCst), 0);
    assert_eq!(registrar.0.load(Ordering::SeqCst), 0);
    assert!(subscription.next().await.is_none());
}

#[tokio::test(start_paused = true)]
async fn protocol_disconnect_reuses_valid_token_and_registers_again() {
    let (_, session, connector, registrar) = fixture(vec![
        vec![connected(), "5:::invalid-json".into()],
        vec![connected(), changed("recovered")],
    ]);
    let mut subscription = session
        .notifications_with_connector(64, connector.clone())
        .unwrap();
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            if let ChangeHint::Changed { conversation, .. } = subscription.next().await.unwrap() {
                assert_eq!(conversation.as_str(), "recovered");
                break;
            }
        }
    })
    .await
    .unwrap();
    assert_eq!(connector.connections.load(Ordering::SeqCst), 2);
    assert_eq!(registrar.0.load(Ordering::SeqCst), 2);
    assert_eq!(subscription.status().state, NotificationState::Registered);
    subscription.close().await.unwrap();
}
