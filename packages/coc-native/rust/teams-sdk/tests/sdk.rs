#![cfg_attr(not(feature = "graph"), allow(dead_code, unused_imports))]

use async_trait::async_trait;
use reqwest::{header::HeaderMap, Method};
use serde_json::{json, Value};
use std::{
    collections::VecDeque,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, Mutex,
    },
    time::{Duration, SystemTime},
};
use teams_sdk::capabilities::Routes;
use teams_sdk::{
    auth::{AccessToken, Audience, TokenProvider},
    capabilities::Operation,
    http::{HttpRequest, HttpResponse, HttpTransport},
    *,
};

fn account() -> Account {
    Account::new(
        TenantId::new("00000000-0000-0000-0000-000000000001").unwrap(),
        UserId::new("00000000-0000-0000-0000-000000000002").unwrap(),
    )
}
struct Tokens {
    calls: Mutex<Vec<(Audience, bool)>>,
    wrong_refresh: bool,
    delay: Duration,
}
impl Default for Tokens {
    fn default() -> Self {
        Self {
            calls: Mutex::new(vec![]),
            wrong_refresh: false,
            delay: Duration::ZERO,
        }
    }
}
#[async_trait]
impl TokenProvider for Tokens {
    async fn acquire(
        &self,
        requested: &Account,
        audience: Audience,
        force_refresh: bool,
    ) -> Result<AccessToken> {
        self.calls.lock().unwrap().push((audience, force_refresh));
        tokio::time::sleep(self.delay).await;
        let mut account = requested.clone();
        if force_refresh && self.wrong_refresh {
            account.user = UserId::new("other-account").unwrap();
        }
        Ok(AccessToken {
            account,
            audience,
            expires_at: SystemTime::now() + Duration::from_secs(3600),
            secret: "synthetic-token".to_owned(),
        })
    }
}
struct Record {
    method: Method,
    url: String,
    body: Option<Value>,
    #[allow(dead_code)]
    headers: HeaderMap,
}
enum Step {
    Reply(u16, Value, HeaderMap),
    Raw(u16, Vec<u8>),
    Fail,
    Delay,
    Rpc(Value),
}
struct Mock {
    steps: Mutex<VecDeque<Step>>,
    requests: Mutex<Vec<Record>>,
    completed: AtomicUsize,
}
impl Mock {
    fn new(steps: Vec<Step>) -> Arc<Self> {
        Arc::new(Self {
            steps: Mutex::new(steps.into()),
            requests: Mutex::new(vec![]),
            completed: AtomicUsize::new(0),
        })
    }
    fn count(&self) -> usize {
        self.requests.lock().unwrap().len()
    }
}
#[async_trait]
impl HttpTransport for Mock {
    async fn execute(&self, request: HttpRequest) -> Result<HttpResponse> {
        let body: Option<Value> = request
            .body
            .as_ref()
            .map(|b| serde_json::from_slice(b).unwrap());
        self.requests.lock().unwrap().push(Record {
            method: request.method,
            url: request.url.to_string(),
            body: body.clone(),
            headers: request.headers,
        });
        let step = self
            .steps
            .lock()
            .unwrap()
            .pop_front()
            .expect("unexpected request");
        let response = match step {
            Step::Reply(status, body, headers) => Ok(HttpResponse {
                status,
                headers,
                body: serde_json::to_vec(&body).unwrap(),
            }),
            Step::Raw(status, body) => Ok(HttpResponse {
                status,
                headers: HeaderMap::new(),
                body,
            }),
            Step::Fail => Err(Error::new(ErrorCode::Network)),
            Step::Delay => {
                tokio::time::sleep(Duration::from_secs(60)).await;
                Ok(HttpResponse {
                    status: 200,
                    headers: HeaderMap::new(),
                    body: b"{\"value\":[]}".to_vec(),
                })
            }
            Step::Rpc(result) => Ok(HttpResponse {
                status: 200,
                headers: HeaderMap::new(),
                body: serde_json::to_vec(
                    &json!({"jsonrpc":"2.0","id":body.unwrap()["id"],"result":result}),
                )
                .unwrap(),
            }),
        };
        self.completed.fetch_add(1, Ordering::SeqCst);
        response
    }
}
fn reply(value: Value) -> Step {
    Step::Reply(200, value, HeaderMap::new())
}
fn setup(steps: Vec<Step>) -> (TeamsClient, Session, Arc<Mock>, Arc<Tokens>) {
    let mock = Mock::new(steps);
    let tokens = Arc::new(Tokens::default());
    let client = TeamsClient::builder(tokens.clone())
        .transport(mock.clone())
        .build()
        .unwrap();
    let session = client.session(account());
    (client, session, mock, tokens)
}
fn chat(session: &Session, backend: Backend) -> ConversationRef {
    session
        .conversation(backend, Conversation::Chat(ChatId::new("chat").unwrap()))
        .unwrap()
}
fn channel(session: &Session, backend: Backend) -> ConversationRef {
    session
        .conversation(
            backend,
            Conversation::Channel {
                team: TeamId::new("team").unwrap(),
                channel: ChannelId::new("channel").unwrap(),
            },
        )
        .unwrap()
}
fn message(id: &str) -> Value {
    json!({"id":id,"createdDateTime":"2026-01-01T00:00:00Z","lastModifiedDateTime":"2026-01-01T01:00:00Z",
        "from":{"user":{"id":"sender","displayName":"Example participant"}},"body":{"contentType":"text","content":"transient message"},
        "mentions":[]})
}
fn error<T>(result: Result<T>) -> Error {
    result.err().expect("expected typed failure")
}

#[test]
fn identifiers_and_errors_are_redacted() {
    assert!(ChatId::new("..").is_err());
    assert!(UserId::new("line\nbreak").is_err());
    let id = ChatId::new("private-chat-id").unwrap();
    assert!(!format!("{id:?}").contains("private-chat-id"));
    let error = Error::new(ErrorCode::Protocol);
    assert_eq!(error.delivery, Delivery::NotAttempted);
    assert!(!error.to_string().contains("synthetic-token"));
}

#[cfg(feature = "graph")]
#[tokio::test]
async fn graph_unknown_system_sentinel_is_skipped_but_ordinary_senderless_messages_fail() {
    for message_type in [None, Some("unknownFutureValue"), Some("systemEventMessage")] {
        let mut system = json!({"id":"event","from":null,"body":{"contentType":"html","content":" <systemEventMessage/> "}});
        if let Some(kind) = message_type {
            system["messageType"] = json!(kind);
        }
        let (_, session, mock, _) =
            setup(vec![reply(json!({"value":[system,message("ordinary")]}))]);
        let page = session
            .messages(
                &chat(&session, Backend::Graph),
                None,
                &OperationContext::default(),
            )
            .await
            .unwrap();
        assert_eq!(page.raw_count, 2);
        assert_eq!(page.items.len(), 1);
        assert_eq!(
            mock.requests.lock().unwrap()[0].headers["prefer"],
            "include-unknown-enum-members"
        );
    }
    for (kind, content) in [
        ("unknownFutureValue", "ordinary body"),
        ("unknownFutureValue", "<systemEventMessage/> extra"),
        ("message", "<systemEventMessage/>"),
    ] {
        let mut ordinary = message("ordinary");
        ordinary["from"] = Value::Null;
        ordinary["messageType"] = json!(kind);
        ordinary["body"] = json!({"contentType":"html","content":content});
        let (_, session, _, _) = setup(vec![reply(json!({"value":[ordinary]}))]);
        assert_eq!(
            error(
                session
                    .messages(
                        &chat(&session, Backend::Graph),
                        None,
                        &OperationContext::default()
                    )
                    .await
            )
            .code,
            ErrorCode::Protocol
        );
    }
}

#[cfg(feature = "graph")]
#[tokio::test]
async fn graph_cursor_compares_decoded_segments_and_rejects_traversal_spellings() {
    let id = ChatId::new("19:sample@thread.v2").unwrap();
    let next =
        "https://graph.microsoft.com/v1.0/chats/19%3Asample%40thread.v2/messages?$skiptoken=next";
    let (_, session, mock, _) = setup(vec![
        reply(json!({"value":[],"@odata.nextLink":next})),
        reply(json!({"value":[]})),
    ]);
    let reference = session
        .conversation(Backend::Graph, Conversation::Chat(id))
        .unwrap();
    let page = session
        .messages(&reference, None, &OperationContext::default())
        .await
        .unwrap();
    session
        .messages(&reference, page.next.as_ref(), &OperationContext::default())
        .await
        .unwrap();
    assert_eq!(mock.count(), 2);
    for path in [
        "chats/other/../19:sample@thread.v2/messages",
        "chats/other/%2e%2E/19:sample@thread.v2/messages",
        "chats/19%3Asample%40thread.v2/messages/.",
        "chats/19%3Asample%40thread.v2/messages/%2e",
        "chats/19%3Asample%40thread.v2%2fmessages",
        "chats/19%3Asample%40thread.v2%5cmessages",
        "chats/19%253Asample%2540thread.v2/messages",
        "chats/19%3Asample%40thread.v2%/messages",
        "chats/19%3Aother%40thread.v2/messages",
    ] {
        let (_, session, mock, _) = setup(vec![reply(
            json!({"value":[],"@odata.nextLink":format!("https://graph.microsoft.com/v1.0/{path}")}),
        )]);
        let reference = session
            .conversation(
                Backend::Graph,
                Conversation::Chat(ChatId::new("19:sample@thread.v2").unwrap()),
            )
            .unwrap();
        assert_eq!(
            error(
                session
                    .messages(&reference, None, &OperationContext::default())
                    .await
            )
            .code,
            ErrorCode::UnsafeCursor
        );
        assert_eq!(mock.count(), 1);
    }
}

#[tokio::test]
async fn ic3_encoded_cursor_preserves_exact_region_account_and_collection() {
    use teams_sdk::ic3::Region;
    for account_path in [
        "ME".to_owned(),
        format!("8%3Aorgid%3A{}", account().user.as_str()),
    ] {
        let info = || {
            reply(
                json!({"id":"19:sample@thread.v2","threadProperties":{"threadType":"chat","productThreadType":"OneToOneChat"}}),
            )
        };
        let next = format!("https://teams.cloud.microsoft/api/chatsvc/amer/v1/users/{account_path}/conversations/19%3Asample%40thread.v2/messages?pageSize=50");
        let mock = Mock::new(vec![
            info(),
            reply(json!({"messages":[],"_metadata":{"backwardLink":next}})),
            info(),
            reply(json!({"messages":[]})),
        ]);
        let session = TeamsClient::builder(Arc::new(Tokens::default()))
            .transport(mock.clone())
            .ic3_region(Region::Americas)
            .build()
            .unwrap()
            .session(account());
        let reference = session
            .conversation(
                Backend::Ic3,
                Conversation::Chat(ChatId::new("19:sample@thread.v2").unwrap()),
            )
            .unwrap();
        let page = session
            .messages(&reference, None, &OperationContext::default())
            .await
            .unwrap();
        session
            .messages(&reference, page.next.as_ref(), &OperationContext::default())
            .await
            .unwrap();
        assert_eq!(mock.count(), 4);
    }
    for path in [
        "amer/v1/users/8%3Aorgid%3Aother/conversations",
        "emea/v1/users/ME/conversations",
        "amer/v1/users/ME/conversations%2Fother",
        "amer/v1/users/other/../ME/conversations",
    ] {
        let mock = Mock::new(vec![reply(
            json!({"conversations":[],"_metadata":{"backwardLink":format!("https://teams.cloud.microsoft/api/chatsvc/{path}")}}),
        )]);
        let session = TeamsClient::builder(Arc::new(Tokens::default()))
            .transport(mock.clone())
            .ic3_region(Region::Americas)
            .build()
            .unwrap()
            .session(account());
        assert_eq!(
            error(
                session
                    .chats(Backend::Ic3, None, &OperationContext::default())
                    .await
            )
            .code,
            ErrorCode::UnsafeCursor
        );
        assert_eq!(mock.count(), 1);
    }
}

#[tokio::test]
async fn mcp_replies_envelope_handles_populated_empty_and_malformed_pages() {
    let rpc =
        |value: Value| Step::Rpc(json!({"content":[{"type":"text","text":value.to_string()}]}));
    let mut item = message("reply");
    item["replyToId"] = json!("root");
    let next = "https://graph.microsoft.com/v1.0/teams/team/channels/channel/messages/root/replies?$skiptoken=next";
    let (_, session, mock, _) = setup(vec![
        Step::Rpc(json!({"protocolVersion":"2025-03-26"})),
        Step::Raw(202, vec![]),
        Step::Rpc(json!({"tools":[{"name":"ListChannelMessageReplies"}]})),
        rpc(json!({"replies":[item],"nextLink":next})),
        rpc(json!({"replies":[]})),
        rpc(json!({"replies":"not-array"})),
    ]);
    let reference = session
        .conversation(
            Backend::Mcp,
            Conversation::Replies {
                team: TeamId::new("team").unwrap(),
                channel: ChannelId::new("channel").unwrap(),
                root: MessageId::new("root").unwrap(),
            },
        )
        .unwrap();
    let ctx = OperationContext::default();
    let page = session.history(&reference, None, &ctx).await.unwrap();
    assert_eq!(page.items.len(), 1);
    let second = session
        .history(&reference, page.next.as_ref(), &ctx)
        .await
        .unwrap();
    assert_eq!(second.raw_count, 0);
    assert!(second.next.is_none());
    assert_eq!(
        error(session.history(&reference, None, &ctx).await).code,
        ErrorCode::Protocol
    );
    assert_eq!(
        mock.requests.lock().unwrap()[3].body.as_ref().unwrap()["params"]["arguments"]
            ["maxReplies"],
        50
    );
}

#[tokio::test]
async fn mcp_initialization_drop_and_cancellation_never_publish_partial_state() {
    fn ready() -> Vec<Step> {
        vec![
            Step::Rpc(json!({"protocolVersion":"2025-03-26"})),
            Step::Raw(202, vec![]),
            Step::Rpc(json!({"tools":[{"name":"ListChats"}]})),
        ]
    }
    fn chats_result() -> Step {
        Step::Rpc(json!({"content":[{"type":"text","text":"{\"chats\":[]}"}]}))
    }
    for recovering in [false, true] {
        for drop_future in [false, true] {
            for blocked_step in [2, 3] {
                let mut steps = vec![];
                let initial_requests = if recovering {
                    steps.extend(ready());
                    steps.push(chats_result());
                    steps.push(Step::Reply(404, Value::Null, HeaderMap::new()));
                    5
                } else {
                    0
                };
                steps.push(Step::Rpc(json!({"protocolVersion":"2025-03-26"})));
                if blocked_step == 3 {
                    steps.push(Step::Raw(202, vec![]));
                }
                steps.push(Step::Delay);
                steps.extend(ready());
                steps.push(chats_result());
                let (_, session, mock, _) = setup(steps);
                if recovering {
                    session
                        .chats(Backend::Mcp, None, &OperationContext::default())
                        .await
                        .unwrap();
                }
                let ctx = OperationContext::default();
                let worker_ctx = ctx.clone();
                let worker_session = session.clone();
                let worker = tokio::spawn(async move {
                    worker_session.chats(Backend::Mcp, None, &worker_ctx).await
                });
                let blocked_count = initial_requests + blocked_step;
                tokio::time::timeout(Duration::from_secs(2), async {
                    while mock.count() < blocked_count {
                        tokio::task::yield_now().await;
                    }
                })
                .await
                .unwrap();
                if drop_future {
                    worker.abort();
                    assert!(worker.await.err().unwrap().is_cancelled());
                } else {
                    ctx.cancellation.cancel();
                    assert_eq!(error(worker.await.unwrap()).code, ErrorCode::Cancelled);
                }
                let result = session
                    .chats(Backend::Mcp, None, &OperationContext::default())
                    .await
                    .unwrap();
                assert!(result.items.is_empty());
                let records = mock.requests.lock().unwrap();
                assert_eq!(
                    records[blocked_count].body.as_ref().unwrap()["method"],
                    "initialize"
                );
                assert!(records[blocked_count]
                    .headers
                    .get("mcp-protocol-version")
                    .is_none());
                assert_eq!(records.len(), blocked_count + 4);
            }
        }
    }
}

#[cfg(feature = "graph")]
#[tokio::test]
async fn graph_discovery_paging_and_membership() {
    let next = "https://graph.microsoft.com/v1.0/me/chats?$skiptoken=second";
    let (_, session, mock, _) = setup(vec![
        reply(
            json!({"value":[{"id":"chat","chatType":"oneOnOne"},{"id":"meeting","chatType":"meeting"}],"@odata.nextLink":next}),
        ),
        reply(json!({"value":[{"id":"group","chatType":"group"}]})),
        reply(
            json!({"value":[{"userId":account().user.as_str(),"displayName":"Example self"},{"userId":"other","displayName":"Example peer"}]}),
        ),
        reply(json!({"value":[{"id":"team"}]})),
        reply(json!({"value":[{"id":"channel"}]})),
    ]);
    let ctx = OperationContext::default();
    let first = session.chats(Backend::Graph, None, &ctx).await.unwrap();
    assert_eq!(first.items.len(), 1);
    assert_eq!(first.raw_count, 2);
    let second = session
        .chats(Backend::Graph, first.next.as_ref(), &ctx)
        .await
        .unwrap();
    assert_eq!(second.items[0].kind, ChatKind::Group);
    let members = session
        .participants(&first.items[0].reference, None, &ctx)
        .await
        .unwrap();
    assert!(members.items[0].is_self);
    assert_eq!(
        members.items[1].display_name.as_deref(),
        Some("Example peer")
    );
    let teams = session.teams(None, &ctx).await.unwrap();
    let channels = session
        .channels(&teams.items[0].id, None, &ctx)
        .await
        .unwrap();
    assert_eq!(channels.items.len(), 1);
    assert_eq!(mock.requests.lock().unwrap()[1].url, next);
}

#[cfg(feature = "graph")]
#[tokio::test]
async fn poisoned_cursors_never_dispatch() {
    for next in [
        "https://example.invalid/v1.0/me/chats",
        "https://graph.microsoft.com.evil.invalid/v1.0/me/chats",
        "https://graph.microsoft.com/v1.0/users/other/chats",
        "https://graph.microsoft.com/v1.0/chats/other/messages",
        "https://user:password@graph.microsoft.com/v1.0/me/chats",
        "https://graph.microsoft.com/v1.0/me/chats#fragment",
        "http://graph.microsoft.com/v1.0/me/chats",
        "/v1.0/me/chats",
    ] {
        let (_, session, mock, _) = setup(vec![reply(json!({"value":[],"@odata.nextLink":next}))]);
        let e = error(
            session
                .chats(Backend::Graph, None, &OperationContext::default())
                .await,
        );
        assert_eq!(e.code, ErrorCode::UnsafeCursor);
        assert_eq!(mock.count(), 1);
        assert!(!e.to_string().contains(next));
    }
}

#[cfg(feature = "graph")]
#[tokio::test]
async fn opaque_cursors_are_account_session_and_collection_pinned() {
    let (client, session, mock, _) = setup(vec![reply(json!({"value":[],
        "@odata.nextLink":"https://graph.microsoft.com/v1.0/chats/chat/messages?$skiptoken=next"}))]);
    let reference = chat(&session, Backend::Graph);
    let page = session
        .messages(&reference, None, &OperationContext::default())
        .await
        .unwrap();
    let other = client.session(Account::new(
        account().tenant,
        UserId::new("other").unwrap(),
    ));
    let e = error(
        other
            .messages(
                &chat(&other, Backend::Graph),
                page.next.as_ref(),
                &OperationContext::default(),
            )
            .await,
    );
    assert_eq!(e.code, ErrorCode::UnsafeCursor);
    let e = error(
        session
            .chats(
                Backend::Graph,
                page.next.as_ref(),
                &OperationContext::default(),
            )
            .await,
    );
    assert_eq!(e.code, ErrorCode::UnsafeCursor);
    assert_eq!(mock.count(), 1);
}

#[cfg(feature = "graph")]
#[tokio::test]
async fn one_refresh_on_read_401_and_no_refresh_on_403_or_429() {
    let (_, session, mock, tokens) = setup(vec![
        Step::Reply(401, json!({"private":"ignored"}), HeaderMap::new()),
        reply(json!({"value":[]})),
    ]);
    session
        .chats(Backend::Graph, None, &OperationContext::default())
        .await
        .unwrap();
    assert_eq!(
        *tokens.calls.lock().unwrap(),
        vec![(Audience::Graph, false), (Audience::Graph, true)]
    );
    assert_eq!(mock.count(), 2);
    for status in [401, 403, 429] {
        let mut headers = HeaderMap::new();
        headers.insert("retry-after", "120".parse().unwrap());
        let steps = if status == 401 {
            vec![
                Step::Reply(status, Value::Null, headers.clone()),
                Step::Reply(status, Value::Null, headers),
            ]
        } else {
            vec![Step::Reply(status, Value::Null, headers)]
        };
        let (_, session, mock, _) = setup(steps);
        let e = error(
            session
                .chats(Backend::Graph, None, &OperationContext::default())
                .await,
        );
        assert_eq!(mock.count(), if status == 401 { 2 } else { 1 });
        if status == 429 {
            assert_eq!(e.retry_after, Some(Duration::from_secs(120)));
            assert_eq!(e.code, ErrorCode::RateLimited);
        }
        if status == 403 {
            assert_eq!(e.code, ErrorCode::Permission);
        }
    }
}

#[cfg(feature = "graph")]
#[tokio::test]
async fn refresh_cannot_change_account() {
    let mock = Mock::new(vec![Step::Reply(401, Value::Null, HeaderMap::new())]);
    let tokens = Arc::new(Tokens {
        wrong_refresh: true,
        ..Default::default()
    });
    let session = TeamsClient::builder(tokens)
        .transport(mock.clone())
        .build()
        .unwrap()
        .session(account());
    assert_eq!(
        error(
            session
                .chats(Backend::Graph, None, &OperationContext::default())
                .await
        )
        .code,
        ErrorCode::Authentication
    );
    assert_eq!(mock.count(), 1);
}

#[cfg(feature = "graph")]
#[tokio::test]
async fn token_contract_checks_audience_expiry_and_account_before_network() {
    struct BadToken(u8);
    #[async_trait]
    impl TokenProvider for BadToken {
        async fn acquire(&self, account: &Account, _: Audience, _: bool) -> Result<AccessToken> {
            let mut account = account.clone();
            if self.0 == 2 {
                account.user = UserId::new("foreign").unwrap();
            }
            Ok(AccessToken {
                account,
                audience: if self.0 == 0 {
                    Audience::Ic3
                } else {
                    Audience::Graph
                },
                expires_at: SystemTime::now()
                    + Duration::from_secs(if self.0 == 1 { 10 } else { 3600 }),
                secret: "synthetic".into(),
            })
        }
    }
    for mode in 0..3 {
        let mock = Mock::new(vec![]);
        let session = TeamsClient::builder(Arc::new(BadToken(mode)))
            .transport(mock.clone())
            .build()
            .unwrap()
            .session(account());
        assert_eq!(
            error(
                session
                    .chats(Backend::Graph, None, &OperationContext::default())
                    .await
            )
            .code,
            ErrorCode::Authentication
        );
        assert_eq!(mock.count(), 0);
    }
}

#[cfg(feature = "graph")]
#[tokio::test(start_paused = true)]
async fn cancellation_and_deadline_cover_credentials_and_late_responses() {
    let mock = Mock::new(vec![]);
    let tokens = Arc::new(Tokens {
        delay: Duration::from_secs(60),
        ..Default::default()
    });
    let session = TeamsClient::builder(tokens)
        .transport(mock.clone())
        .build()
        .unwrap()
        .session(account());
    let ctx = OperationContext::with_timeout(Duration::from_secs(1));
    let e = error(
        session
            .send(
                Destination::Chat(ChatId::new("chat").unwrap()),
                MessageBody::text("text"),
                &ctx,
            )
            .await,
    );
    assert_eq!(e.code, ErrorCode::Timeout);
    assert_eq!(e.delivery, Delivery::NotAttempted);
    assert_eq!(mock.count(), 0);
    let (_, session, mock, _) = setup(vec![Step::Delay]);
    let ctx = OperationContext::with_timeout(Duration::from_secs(1));
    let e = error(
        session
            .send(
                Destination::Chat(ChatId::new("chat").unwrap()),
                MessageBody::text("text"),
                &ctx,
            )
            .await,
    );
    assert_eq!(e.code, ErrorCode::Timeout);
    assert_eq!(e.delivery, Delivery::Unknown);
    tokio::time::advance(Duration::from_secs(61)).await;
    assert_eq!(mock.completed.load(Ordering::SeqCst), 0);
    let ctx = OperationContext::default();
    ctx.cancellation.cancel();
    assert_eq!(
        error(session.chats(Backend::Graph, None, &ctx).await).code,
        ErrorCode::Cancelled
    );
    assert_eq!(mock.count(), 1);
}

#[cfg(feature = "graph")]
#[tokio::test]
async fn closing_clones_and_reconnecting_invalidate_old_references() {
    let (client, session, mock, _) = setup(vec![]);
    let reference = session
        .message_ref(
            &channel(&session, Backend::Graph),
            MessageId::new("root").unwrap(),
        )
        .unwrap();
    let old_clone = session.clone();
    let next = client.reconnect(&session, account());
    assert!(old_clone.is_closed());
    assert_eq!(
        error(
            next.reply(
                &reference,
                MessageBody::text("reply"),
                &OperationContext::default()
            )
            .await
        )
        .code,
        ErrorCode::InvalidTarget
    );
    assert_eq!(
        error(
            old_clone
                .like(&reference, &OperationContext::default())
                .await
        )
        .code,
        ErrorCode::Closed
    );
    assert_eq!(mock.count(), 0);
}

#[cfg(feature = "graph")]
#[tokio::test]
async fn metadata_scans_dedupe_edits_and_prefer_tombstones() {
    let mut deleted = message("edit");
    deleted["deletedDateTime"] = json!("2026-01-01T01:00:00Z");
    deleted["from"] = Value::Null;
    deleted["body"] = Value::Null;
    let (_, session, _, _) = setup(vec![
        reply(
            json!({"value":[message("edit"),{"id":"system","messageType":"systemEventMessage"}],
            "@odata.nextLink":"https://graph.microsoft.com/v1.0/chats/chat/messages?$skiptoken=two"}),
        ),
        reply(json!({"value":[deleted]})),
    ]);
    let scan = session
        .scan_messages(
            &chat(&session, Backend::Graph),
            ScanLimits::default(),
            &OperationContext::default(),
        )
        .await;
    match scan {
        Scan::Complete(items) => {
            assert_eq!(items.len(), 1);
            assert!(items[0].deleted);
            assert!(items[0].author.is_none());
        }
        _ => panic!("expected complete scan"),
    }
}

#[cfg(feature = "graph")]
#[tokio::test]
async fn failed_or_capped_scans_never_imply_coverage() {
    for limits in [
        ScanLimits {
            pages: 1,
            entries: 100,
        },
        ScanLimits {
            pages: 100,
            entries: 0,
        },
    ] {
        let (_, session, _, _) = setup(vec![reply(json!({"value":[message("one")],
            "@odata.nextLink":"https://graph.microsoft.com/v1.0/chats/chat/messages?$skiptoken=next"}))]);
        let scan = session
            .scan_messages(
                &chat(&session, Backend::Graph),
                limits,
                &OperationContext::default(),
            )
            .await;
        assert!(!scan.is_complete());
        if let Scan::Incomplete { reason, .. } = scan {
            assert_eq!(reason.code, ErrorCode::Limit);
        }
    }
    let repeated = reply(
        json!({"value":[],"@odata.nextLink":"https://graph.microsoft.com/v1.0/chats/chat/messages?$skiptoken=same"}),
    );
    let (_, session, mock, _) = setup(vec![
        repeated,
        reply(
            json!({"value":[],"@odata.nextLink":"https://graph.microsoft.com/v1.0/chats/chat/messages?$skiptoken=same"}),
        ),
    ]);
    let scan = session
        .scan_messages(
            &chat(&session, Backend::Graph),
            ScanLimits::default(),
            &OperationContext::default(),
        )
        .await;
    assert!(!scan.is_complete());
    assert_eq!(mock.count(), 2);
    let (_, session, _, _) = setup(vec![Step::Fail]);
    assert!(!session
        .scan_messages(
            &chat(&session, Backend::Graph),
            ScanLimits::default(),
            &OperationContext::default()
        )
        .await
        .is_complete());
}

#[cfg(feature = "graph")]
#[tokio::test]
async fn transient_detail_preserves_html_and_caps_without_partial_html() {
    let mut html = message("detail");
    html["body"] = json!({"contentType":"html","content":"<b>Hello &amp; goodbye</b>"});
    html["mentions"] =
        json!([{"mentioned":{"user":{"id":"00000000-0000-0000-0000-000000000003"}}}]);
    let mut large = html.clone();
    large["body"]["content"] = json!("é".repeat(9000));
    let (_, session, _, _) = setup(vec![reply(html), reply(large)]);
    let reference = session
        .message_ref(
            &chat(&session, Backend::Graph),
            MessageId::new("detail").unwrap(),
        )
        .unwrap();
    let first = session
        .detail(&reference, &OperationContext::default())
        .await
        .unwrap();
    assert!(first.text.contains("Hello & goodbye"));
    assert!(first.untrusted_html.is_some());
    assert_eq!(first.mentioned_users.unwrap().len(), 1);
    let second = session
        .detail(&reference, &OperationContext::default())
        .await
        .unwrap();
    assert!(second.untrusted_html.is_none());
    assert!(second.html_truncated && second.text_truncated);
    assert!(second.text.len() <= 16 * 1024);
}

#[cfg(feature = "graph")]
#[tokio::test]
async fn malformed_conflicting_and_oversized_responses_fail_closed() {
    let mut wrong_chat = message("one");
    wrong_chat["chatId"] = json!("other");
    let mut bad_time = message("one");
    bad_time["createdDateTime"] = json!("not-a-date");
    for value in [
        json!({"value":"not-array"}),
        json!({"value":[{"id":"senderless"}]}),
        json!({"value":[wrong_chat]}),
        json!({"value":[bad_time]}),
    ] {
        let (_, session, _, _) = setup(vec![reply(value)]);
        assert_eq!(
            error(
                session
                    .messages(
                        &chat(&session, Backend::Graph),
                        None,
                        &OperationContext::default()
                    )
                    .await
            )
            .code,
            ErrorCode::Protocol
        );
    }
    let (_, session, _, _) = setup(vec![Step::Raw(
        200,
        vec![b'x'; teams_sdk::http::MAX_RESPONSE_BYTES + 1],
    )]);
    assert_eq!(
        error(
            session
                .messages(
                    &chat(&session, Backend::Graph),
                    None,
                    &OperationContext::default()
                )
                .await
        )
        .code,
        ErrorCode::Limit
    );
}

#[cfg(feature = "graph")]
#[tokio::test]
async fn graph_send_reply_and_like_use_exact_paths() {
    let (_, session, mock, _) = setup(vec![
        reply(json!({"id":"root"})),
        reply(json!({"id":"reply"})),
        Step::Raw(204, vec![]),
    ]);
    let root = session
        .send(
            Destination::Channel {
                team: TeamId::new("team").unwrap(),
                channel: ChannelId::new("channel").unwrap(),
            },
            MessageBody::html("<b>Hello</b>"),
            &OperationContext::default(),
        )
        .await
        .unwrap();
    let response = session
        .reply(
            &root,
            MessageBody::text("Reply"),
            &OperationContext::default(),
        )
        .await
        .unwrap();
    session
        .like(&response, &OperationContext::default())
        .await
        .unwrap();
    let requests = mock.requests.lock().unwrap();
    assert!(requests[0]
        .url
        .ends_with("/teams/team/channels/channel/messages"));
    assert!(requests[1].url.ends_with("/messages/root/replies"));
    assert!(requests[2]
        .url
        .ends_with("/messages/root/replies/reply/setReaction"));
    assert_eq!(requests[0].method, Method::POST);
    assert_eq!(requests[2].body.as_ref().unwrap()["reactionType"], "👍");
}

#[cfg(feature = "graph")]
#[tokio::test]
async fn writes_are_never_replayed_and_delivery_is_explicit() {
    for (step, delivery) in [
        (Step::Fail, Delivery::Unknown),
        (Step::Raw(200, b"not-json".to_vec()), Delivery::Unknown),
        (reply(json!({})), Delivery::Unknown),
        (
            Step::Reply(401, Value::Null, HeaderMap::new()),
            Delivery::Rejected,
        ),
        (
            Step::Reply(403, Value::Null, HeaderMap::new()),
            Delivery::Rejected,
        ),
        (
            Step::Reply(500, Value::Null, HeaderMap::new()),
            Delivery::Unknown,
        ),
        (
            Step::Reply(302, Value::Null, HeaderMap::new()),
            Delivery::Unknown,
        ),
    ] {
        let (_, session, mock, tokens) = setup(vec![step]);
        let e = error(
            session
                .send(
                    Destination::Chat(ChatId::new("chat").unwrap()),
                    MessageBody::text("payload"),
                    &OperationContext::default(),
                )
                .await,
        );
        assert_eq!(e.delivery, delivery);
        assert_eq!(mock.count(), 1);
        assert_eq!(tokens.calls.lock().unwrap().len(), 1);
        assert!(!format!("{e:?}").contains("payload"));
    }
}

#[cfg(feature = "graph")]
#[tokio::test]
async fn unsupported_routes_fail_before_tokens() {
    let (_, session, mock, tokens) = setup(vec![]);
    assert!(!session.supports(Operation::SelfSend));
    assert_eq!(
        error(
            session
                .send(
                    Destination::SelfChat,
                    MessageBody::text("self"),
                    &OperationContext::default()
                )
                .await
        )
        .code,
        ErrorCode::Unsupported
    );
    let reference = session
        .message_ref(
            &chat(&session, Backend::Graph),
            MessageId::new("one").unwrap(),
        )
        .unwrap();
    assert_eq!(
        error(
            session
                .reply(
                    &reference,
                    MessageBody::text("reply"),
                    &OperationContext::default()
                )
                .await
        )
        .code,
        ErrorCode::Unsupported
    );
    assert_eq!(mock.count(), 0);
    assert_eq!(tokens.calls.lock().unwrap().len(), 0);
}

mod ic3_tests {
    use super::*;
    use teams_sdk::ic3::{ChatVerifier, Region, VerifiedChat};
    fn ic3_session(steps: Vec<Step>) -> (Session, Arc<Mock>) {
        let mock = Mock::new(steps);
        let session = TeamsClient::builder(Arc::new(Tokens::default()))
            .transport(mock.clone())
            .ic3_region(Region::EuropeMiddleEastAfrica)
            .routes(Routes {
                self_send: Some(Backend::Ic3),
                chat_send: Some(Backend::Ic3),
                channel_like: Some(Backend::Ic3),
                ..Routes::default()
            })
            .build()
            .unwrap()
            .session(account());
        (session, mock)
    }
    #[tokio::test]
    async fn explicit_region_and_self_send_protocol() {
        let (_, session, mock, _) = setup(vec![]);
        assert_eq!(
            error(
                session
                    .chats(Backend::Ic3, None, &OperationContext::default())
                    .await
            )
            .code,
            ErrorCode::Configuration
        );
        assert_eq!(mock.count(), 0);
        let (session, mock) = ic3_session(vec![reply(json!({"OriginalArrivalTime":"42"}))]);
        let sent = session
            .send(
                Destination::SelfChat,
                MessageBody::text("<plain>"),
                &OperationContext::default(),
            )
            .await
            .unwrap();
        assert_eq!(sent.id().as_str(), "42");
        let requests = mock.requests.lock().unwrap();
        assert!(requests[0].url.contains("/chatsvc/emea/"));
        assert_eq!(
            requests[0].body.as_ref().unwrap()["content"],
            "&lt;plain&gt;"
        );
        assert_eq!(
            requests[0].body.as_ref().unwrap()["conversationid"],
            "48:notes"
        );
    }
    #[tokio::test]
    async fn ic3_discovery_edits_and_senderless_tombstones() {
        let (session, mock) = ic3_session(vec![
            reply(
                json!({"conversations":[{"id":"chat","threadProperties":{"threadType":"chat","productThreadType":"OneToOneChat"}},
                {"id":"stream","threadProperties":{"threadType":"channel"}}]}),
            ),
            reply(
                json!({"id":"chat","threadProperties":{"threadType":"chat","productThreadType":"OneToOneChat"}}),
            ),
            reply(
                json!({"messages":[{"id":"one","conversationid":"chat","version":"1767229200000",
                "originalarrivaltime":"2026-01-01T00:00:00Z","messagetype":"Text","from":"8:orgid:sender",
                "content":"test","properties":{"mentions":"[]"}},{"id":"deleted","conversationid":"chat","version":"1767229200000",
                "properties":{"isdeleted":true}}]}),
            ),
        ]);
        let chats = session
            .chats(Backend::Ic3, None, &OperationContext::default())
            .await
            .unwrap();
        assert_eq!(chats.items.len(), 1);
        let messages = session
            .messages(
                &chats.items[0].reference,
                None,
                &OperationContext::default(),
            )
            .await
            .unwrap();
        assert_eq!(messages.items.len(), 2);
        assert!(messages.items[1].deleted);
        assert!(messages.items[0].modified_at > messages.items[0].created_at);
        assert_eq!(mock.count(), 3);
    }
    #[tokio::test]
    async fn ic3_participants_reject_channels_and_foreign_cursors_before_dispatch() {
        let (session, mock) = ic3_session(vec![reply(json!({
            "conversations":[],
            "_metadata":{"backwardLink":"https://teams.cloud.microsoft/api/chatsvc/emea/v1/users/ME/conversations?pageSize=50"}
        }))]);
        let page = session
            .chats(Backend::Ic3, None, &OperationContext::default())
            .await
            .unwrap();
        let reference = session
            .conversation(
                Backend::Ic3,
                Conversation::Chat(ChatId::new("chat").unwrap()),
            )
            .unwrap();
        assert!(page.next.is_some());
        assert_eq!(
            error(
                session
                    .participants(&reference, page.next.as_ref(), &OperationContext::default())
                    .await
            )
            .code,
            ErrorCode::UnsafeCursor
        );
        let channel = session
            .conversation(
                Backend::Ic3,
                Conversation::Channel {
                    team: TeamId::new("team").unwrap(),
                    channel: ChannelId::new("channel").unwrap(),
                },
            )
            .unwrap();
        assert_eq!(
            error(
                session
                    .participants(&channel, None, &OperationContext::default())
                    .await
            )
            .code,
            ErrorCode::Unsupported
        );
        assert_eq!(mock.count(), 1);
        session.close();
        assert_eq!(
            error(
                session
                    .participants(&reference, None, &OperationContext::default())
                    .await
            )
            .code,
            ErrorCode::Closed
        );
        assert_eq!(mock.count(), 1);
    }
    fn chat_info(id: &str) -> Step {
        reply(json!({"id":id,"threadProperties":{"threadType":"chat","productThreadType":"Chat"}}))
    }
    #[tokio::test]
    async fn ic3_dispatch_rejects_unsupported_discovery_and_replies_without_requests() {
        let mock = Mock::new(vec![]);
        let session = TeamsClient::builder(Arc::new(Tokens::default()))
            .transport(mock.clone())
            .ic3_region(Region::Americas)
            .routes(Routes {
                channel_reply: Some(Backend::Ic3),
                ..Routes::default()
            })
            .build()
            .unwrap()
            .session(account());
        let ctx = OperationContext::default();
        let team = TeamId::new("team").unwrap();
        assert_eq!(
            error(session.teams_with_backend(Backend::Ic3, None, &ctx).await).code,
            ErrorCode::Unsupported
        );
        assert_eq!(
            error(
                session
                    .channels_with_backend(Backend::Ic3, &team, None, &ctx)
                    .await
            )
            .code,
            ErrorCode::Unsupported
        );
        let channel = session
            .conversation(
                Backend::Ic3,
                Conversation::Channel {
                    team,
                    channel: ChannelId::new("channel").unwrap(),
                },
            )
            .unwrap();
        let parent = session
            .message_ref(&channel, MessageId::new("message").unwrap())
            .unwrap();
        assert_eq!(
            error(
                session
                    .reply(&parent, MessageBody::text("test"), &ctx)
                    .await
            )
            .code,
            ErrorCode::Unsupported
        );
        assert_eq!(mock.count(), 0);
    }
    #[tokio::test]
    async fn ic3_participants_read_region_pinned_rosters_and_escape_ids() {
        for region in [
            Region::Americas,
            Region::EuropeMiddleEastAfrica,
            Region::AsiaPacific,
        ] {
            let id = "19:sample/segment@thread.skype";
            let mock = Mock::new(vec![
                chat_info(id),
                reply(
                    json!({"id":id,"properties":{"threadType":"chat"},"members":[
                        {"id":format!("8:orgid:{}",account().user.as_str()),"friendlyName":"Example"},
                        {"id":"8:orgid:other","hidden":true,"rangeEnd":"1"}
                    ]}),
                ),
            ]);
            let session = TeamsClient::builder(Arc::new(Tokens::default()))
                .transport(mock.clone())
                .ic3_region(region)
                .build()
                .unwrap()
                .session(account());
            let reference = session
                .conversation(Backend::Ic3, Conversation::Chat(ChatId::new(id).unwrap()))
                .unwrap();
            let page = session
                .participants(&reference, None, &OperationContext::default())
                .await
                .unwrap();
            assert_eq!(page.items.len(), 2);
            assert_eq!(page.raw_count, 2);
            assert!(page.next.is_none());
            assert!(page.items[0].is_self);
            assert!(!page.items[1].is_self);
            assert_eq!(page.items[0].display_name.as_deref(), Some("Example"));
            assert_eq!(page.items[1].user.as_str(), "other");
            let requests = mock.requests.lock().unwrap();
            let region = match region {
                Region::Americas => "amer",
                Region::EuropeMiddleEastAfrica => "emea",
                Region::AsiaPacific => "apac",
            };
            assert_eq!(requests[1].url, format!("https://teams.cloud.microsoft/api/chatsvc/{region}/v1/threads/19:sample%2Fsegment@thread.skype?view=msnp24Equivalent"));
        }
    }
    #[tokio::test]
    async fn ic3_participants_reject_malformed_incomplete_and_unsupported_rosters() {
        for (value, code) in [
            (
                json!({"id":"other","properties":{"threadType":"chat"},"members":[]}),
                ErrorCode::Protocol,
            ),
            (
                json!({"id":"chat","properties":{"threadType":"channel"},"members":[]}),
                ErrorCode::Protocol,
            ),
            (
                json!({"id":"chat","properties":{"threadType":"chat"}}),
                ErrorCode::Protocol,
            ),
            (
                json!({"id":"chat","properties":{"threadType":"chat"},"members":{}}),
                ErrorCode::Protocol,
            ),
            (
                json!({"id":"chat","properties":{"threadType":"chat"},"members":[{"id":"8:orgid:"}]}),
                ErrorCode::Protocol,
            ),
            (
                json!({"id":"chat","properties":{"threadType":"chat"},"members":[{"id":"8:skype:other"}]}),
                ErrorCode::Unsupported,
            ),
            (
                json!({"id":"chat","properties":{"threadType":"chat"},"members":[{"id":"8:orgid:other"},{"id":"8:orgid:OTHER"}]}),
                ErrorCode::Protocol,
            ),
            (
                json!({"id":"chat","properties":{"threadType":"chat"},"members":[],"_metadata":{"forwardLink":"https://example.invalid/next"}}),
                ErrorCode::Limit,
            ),
            (
                json!({"id":"chat","properties":{"threadType":"chat"},"members":vec![json!({"id":"8:orgid:other"});201]}),
                ErrorCode::Limit,
            ),
        ] {
            let (session, mock) = ic3_session(vec![chat_info("chat"), reply(value)]);
            let reference = session
                .conversation(
                    Backend::Ic3,
                    Conversation::Chat(ChatId::new("chat").unwrap()),
                )
                .unwrap();
            assert_eq!(
                error(
                    session
                        .participants(&reference, None, &OperationContext::default())
                        .await
                )
                .code,
                code
            );
            assert_eq!(mock.count(), 2);
        }
        let (session, _) = ic3_session(vec![
            chat_info("chat"),
            reply(json!({"id":"chat","properties":{"threadType":"chat"},"members":[]})),
        ]);
        let reference = session
            .conversation(
                Backend::Ic3,
                Conversation::Chat(ChatId::new("chat").unwrap()),
            )
            .unwrap();
        assert!(session
            .participants(&reference, None, &OperationContext::default())
            .await
            .unwrap()
            .items
            .is_empty());
    }
    #[tokio::test]
    async fn ic3_cursors_reject_other_region_and_account() {
        for url in [
            "https://teams.cloud.microsoft/api/chatsvc/amer/v1/users/ME/conversations",
            "https://teams.cloud.microsoft/api/chatsvc/emea/v1/users/other/conversations",
        ] {
            let (session, mock) = ic3_session(vec![reply(
                json!({"conversations":[],"_metadata":{"backwardLink":url}}),
            )]);
            assert_eq!(
                error(
                    session
                        .chats(Backend::Ic3, None, &OperationContext::default())
                        .await
                )
                .code,
                ErrorCode::UnsafeCursor
            );
            assert_eq!(mock.count(), 1);
        }
    }
    struct Verifier {
        complete: bool,
    }
    #[async_trait]
    impl ChatVerifier for Verifier {
        async fn verify(&self, account: &Account, chat: &ChatId) -> Result<VerifiedChat> {
            Ok(VerifiedChat {
                account: account.clone(),
                chat: chat.clone(),
                kind: ChatKind::OneOnOne,
                members: vec![account.user.clone(), UserId::new("recipient").unwrap()],
                complete: self.complete,
            })
        }
    }
    #[tokio::test]
    async fn ic3_requires_fresh_complete_membership_for_intended_recipient() {
        for complete in [false, true] {
            let mock = Mock::new(if complete {
                vec![reply(json!({"OriginalArrivalTime":42}))]
            } else {
                vec![]
            });
            let session = TeamsClient::builder(Arc::new(Tokens::default()))
                .transport(mock.clone())
                .ic3_region(Region::Americas)
                .ic3_verifier(Arc::new(Verifier { complete }))
                .routes(Routes {
                    chat_send: Some(Backend::Ic3),
                    ..Routes::default()
                })
                .build()
                .unwrap()
                .session(account());
            let result = session
                .send_to_existing_one_on_one(
                    ChatId::new("19:sample@thread.v2").unwrap(),
                    UserId::new("recipient").unwrap(),
                    MessageBody::text("test"),
                    &OperationContext::default(),
                )
                .await;
            assert_eq!(result.is_ok(), complete);
            assert_eq!(mock.count(), usize::from(complete));
        }
    }
    #[tokio::test]
    async fn ic3_rejects_unsupported_one_on_one_chat_id_formats() {
        for chat in [
            "sample@thread.v2",
            "19:sample",
            "19:sample@thread.tacv2",
            "48:notes",
        ] {
            let mock = Mock::new(vec![]);
            let session = TeamsClient::builder(Arc::new(Tokens::default()))
                .transport(mock.clone())
                .ic3_region(Region::Americas)
                .ic3_verifier(Arc::new(Verifier { complete: true }))
                .routes(Routes {
                    chat_send: Some(Backend::Ic3),
                    ..Routes::default()
                })
                .build()
                .unwrap()
                .session(account());
            assert_eq!(
                error(
                    session
                        .send_to_existing_one_on_one(
                            ChatId::new(chat).unwrap(),
                            UserId::new("recipient").unwrap(),
                            MessageBody::text("test"),
                            &OperationContext::default(),
                        )
                        .await
                )
                .code,
                ErrorCode::InvalidTarget
            );
            assert_eq!(mock.count(), 0);
        }
    }
    #[tokio::test]
    async fn ic3_channel_like_is_explicit_and_never_replayed() {
        let (session, mock) = ic3_session(vec![Step::Reply(401, Value::Null, HeaderMap::new())]);
        let reference = session
            .conversation(
                Backend::Ic3,
                Conversation::Channel {
                    team: TeamId::new("team").unwrap(),
                    channel: ChannelId::new("channel").unwrap(),
                },
            )
            .unwrap();
        let message = session
            .message_ref(&reference, MessageId::new("42").unwrap())
            .unwrap();
        assert_eq!(
            error(session.like(&message, &OperationContext::default()).await).delivery,
            Delivery::Rejected
        );
        assert_eq!(mock.count(), 1);
        assert!(mock.requests.lock().unwrap()[0]
            .url
            .ends_with("/messages/42/properties?name=emotions"));
    }
}

mod mcp_tests {
    use super::*;
    fn init(tools: &[&str]) -> Vec<Step> {
        vec![
            Step::Rpc(json!({"protocolVersion":"2025-03-26"})),
            Step::Raw(202, vec![]),
            Step::Rpc(
                json!({"tools":tools.iter().map(|name| json!({"name":name})).collect::<Vec<_>>()}),
            ),
        ]
    }
    fn tool(value: Value) -> Step {
        Step::Rpc(json!({"content":[{"type":"text","text":value.to_string()}]}))
    }
    #[tokio::test]
    async fn mcp_initialization_reads_and_sender_projection() {
        let mut steps = init(&["ListChats", "ListChatMessages"]);
        steps.push(tool(json!({"chats":[{"id":"chat","chatType":"OneOnOne"}]})));
        steps.push(tool(json!({"messages":[message("one")]})));
        let (_, session, mock, tokens) = setup(steps);
        let chats = session
            .chats(Backend::Mcp, None, &OperationContext::default())
            .await
            .unwrap();
        let messages = session
            .messages(
                &chats.items[0].reference,
                None,
                &OperationContext::default(),
            )
            .await
            .unwrap();
        assert_eq!(messages.items.len(), 1);
        assert_eq!(
            mock.requests.lock().unwrap()[1].body.as_ref().unwrap()["method"],
            "notifications/initialized"
        );
        assert!(tokens
            .calls
            .lock()
            .unwrap()
            .iter()
            .all(|(audience, _)| *audience == Audience::TeamsMcp));
    }
    #[tokio::test]
    async fn mcp_read_session_expiry_recovers_once() {
        let mut steps = init(&["ListChats"]);
        steps.push(Step::Reply(404, Value::Null, HeaderMap::new()));
        steps.extend(init(&["ListChats"]));
        steps.push(tool(json!({"chats":[]})));
        let (_, session, mock, _) = setup(steps);
        session
            .chats(Backend::Mcp, None, &OperationContext::default())
            .await
            .unwrap();
        assert_eq!(mock.count(), 8);
    }
    #[tokio::test]
    async fn mcp_write_never_recovers_expired_session_and_respects_advertised_tools() {
        for supported in [false, true] {
            let mut steps = init(if supported {
                &["SendMessageToSelf"]
            } else {
                &[]
            });
            if supported {
                steps.push(Step::Reply(404, Value::Null, HeaderMap::new()));
            }
            let mock = Mock::new(steps);
            let session = TeamsClient::builder(Arc::new(Tokens::default()))
                .transport(mock.clone())
                .routes(Routes {
                    self_send: Some(Backend::Mcp),
                    ..Routes::default()
                })
                .build()
                .unwrap()
                .session(account());
            let e = error(
                session
                    .send(
                        Destination::SelfChat,
                        MessageBody::text("test"),
                        &OperationContext::default(),
                    )
                    .await,
            );
            assert_eq!(
                e.delivery,
                if supported {
                    Delivery::Rejected
                } else {
                    Delivery::NotAttempted
                }
            );
            assert_eq!(mock.count(), if supported { 4 } else { 3 });
        }
    }
    #[tokio::test]
    async fn mcp_self_receipt_and_tool_errors_are_sanitized() {
        let mut steps = init(&["SendMessageToSelf"]);
        steps.push(tool(json!({"messageId":"42","chatId":"self-chat"})));
        steps.push(Step::Rpc(
            json!({"isError":true,"content":[{"type":"text","text":"private provider payload"}]}),
        ));
        let mock = Mock::new(steps);
        let session = TeamsClient::builder(Arc::new(Tokens::default()))
            .transport(mock.clone())
            .routes(Routes {
                self_send: Some(Backend::Mcp),
                ..Routes::default()
            })
            .build()
            .unwrap()
            .session(account());
        let first = session
            .send(
                Destination::SelfChat,
                MessageBody::text("path\\part"),
                &OperationContext::default(),
            )
            .await
            .unwrap();
        assert_eq!(first.id().as_str(), "42");
        let e = error(
            session
                .send(
                    Destination::SelfChat,
                    MessageBody::text("test"),
                    &OperationContext::default(),
                )
                .await,
        );
        assert_eq!(e.delivery, Delivery::Rejected);
        assert!(!format!("{e:?}").contains("private"));
        assert_eq!(
            mock.requests.lock().unwrap()[3].body.as_ref().unwrap()["params"]["arguments"]
                ["content"],
            "path\\\\part"
        );
    }
}

#[cfg(not(feature = "graph"))]
#[tokio::test]
async fn disabled_graph_has_no_network_or_credentials() {
    let (_, session, mock, tokens) = setup(vec![]);
    assert_eq!(
        error(
            session
                .chats(Backend::Graph, None, &OperationContext::default())
                .await
        )
        .code,
        ErrorCode::Unsupported
    );
    assert_eq!(mock.count(), 0);
    assert_eq!(tokens.calls.lock().unwrap().len(), 0);
}

#[cfg(feature = "graph")]
#[tokio::test]
async fn cancelling_inflight_read_discards_late_completion() {
    let (_, session, mock, _) = setup(vec![Step::Delay]);
    let ctx = OperationContext::default();
    let worker_ctx = ctx.clone();
    let worker =
        tokio::spawn(async move { session.chats(Backend::Graph, None, &worker_ctx).await });
    tokio::time::timeout(Duration::from_secs(1), async {
        while mock.count() == 0 {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    ctx.cancellation.cancel();
    assert_eq!(error(worker.await.unwrap()).code, ErrorCode::Cancelled);
    assert_eq!(mock.completed.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn mcp_channel_discovery_and_bounded_detail_work_without_graph() {
    let tool =
        |value: Value| Step::Rpc(json!({"content":[{"type":"text","text":value.to_string()}]}));
    let mut detail = message("target");
    detail["from"] = json!({"id":"sender","displayName":"Example participant"});
    let (_, session, mock, _) = setup(vec![
        Step::Rpc(json!({"protocolVersion":"2025-03-26"})),
        Step::Raw(202, vec![]),
        Step::Rpc(
            json!({"tools":[{"name":"ListTeams"},{"name":"ListChannels"},{"name":"ListChannelMessages"}]}),
        ),
        tool(json!({"teams":[{"id":"team"}]})),
        tool(json!({"channels":[{"id":"channel"}]})),
        tool(
            json!({"messages":[message("other")],"nextLink":"https://graph.microsoft.com/v1.0/teams/team/channels/channel/messages?$skiptoken=next"}),
        ),
        tool(json!({"messages":[detail]})),
    ]);
    let ctx = OperationContext::default();
    let teams = session
        .teams_with_backend(Backend::Mcp, None, &ctx)
        .await
        .unwrap();
    let channels = session
        .channels_with_backend(Backend::Mcp, &teams.items[0].id, None, &ctx)
        .await
        .unwrap();
    let reference = session
        .message_ref(
            &channels.items[0].reference,
            MessageId::new("target").unwrap(),
        )
        .unwrap();
    let detail = session.detail(&reference, &ctx).await.unwrap();
    assert_eq!(detail.sender_name.as_deref(), Some("Example participant"));
    assert_eq!(mock.count(), 7);
}

#[tokio::test]
async fn ic3_chat_verification_rejects_channels_and_validates_sender_url() {
    use teams_sdk::ic3::Region;
    for valid in [false, true] {
        let mut steps = vec![reply(
            json!({"id":"chat","threadProperties":{"threadType":if valid {"chat"} else {"channel"},"productThreadType":"OneToOneChat"}}),
        )];
        if valid {
            steps.push(reply(json!({"messages":[{"id":"one","conversationid":"chat","version":"1767229200000",
                "originalarrivaltime":"2026-01-01T00:00:00Z","messagetype":"Text",
                "from":"https://teams.cloud.microsoft/api/chatsvc/amer/v1/users/ME/contacts/8%3Aorgid%3Asender",
                "content":"test","properties":{}}]})));
        }
        let mock = Mock::new(steps);
        let session = TeamsClient::builder(Arc::new(Tokens::default()))
            .transport(mock.clone())
            .ic3_region(Region::Americas)
            .build()
            .unwrap()
            .session(account());
        let result = session
            .history(
                &chat(&session, Backend::Ic3),
                None,
                &OperationContext::default(),
            )
            .await;
        assert_eq!(result.is_ok(), valid);
        assert_eq!(mock.count(), if valid { 2 } else { 1 });
    }
}
