use super::*;
use async_trait::async_trait;
use reqwest::{header::HeaderMap, Method};
use serde_json::{json, Value};
use std::{collections::VecDeque, sync::Mutex, time::SystemTime};
use teams_sdk::{
    auth::{AccessToken, Audience, TokenProvider},
    http::{HttpRequest, HttpResponse, HttpTransport},
    ic3::Region,
    Account, CancellationToken, TeamsClient, TenantId, UserId,
};

struct Tokens;
#[async_trait]
impl TokenProvider for Tokens {
    async fn acquire(
        &self,
        account: &Account,
        audience: Audience,
        _: bool,
    ) -> teams_sdk::Result<AccessToken> {
        assert_eq!(audience, Audience::Ic3);
        Ok(AccessToken {
            account: account.clone(),
            audience,
            expires_at: SystemTime::now() + Duration::from_secs(3600),
            secret: "synthetic-token".into(),
        })
    }
}

struct Transport {
    responses: Mutex<VecDeque<Value>>,
    requests: Mutex<Vec<String>>,
    pending: bool,
    started: CancellationToken,
    dropped: AtomicBool,
}

#[async_trait]
impl HttpTransport for Transport {
    async fn execute(&self, request: HttpRequest) -> teams_sdk::Result<HttpResponse> {
        assert_eq!(request.method, Method::GET);
        assert!(request.url.as_str().starts_with(
            "https://teams.cloud.microsoft/api/chatsvc/emea/v1/users/ME/conversations"
        ));
        self.requests.lock().unwrap().push(request.url.to_string());
        struct DropGuard<'a>(&'a AtomicBool);
        impl Drop for DropGuard<'_> {
            fn drop(&mut self) {
                self.0.store(true, Ordering::Release);
            }
        }
        let _guard = DropGuard(&self.dropped);
        self.started.cancel();
        if self.pending {
            return std::future::pending().await;
        }
        Ok(HttpResponse {
            status: 200,
            headers: HeaderMap::new(),
            body: serde_json::to_vec(
                &self.responses.lock().unwrap().pop_front().expect("unexpected request"),
            )
            .unwrap(),
        })
    }
}

fn setup(responses: Vec<Value>, pending: bool) -> (Arc<Lifetime>, Arc<Transport>) {
    let transport = Arc::new(Transport {
        responses: Mutex::new(responses.into()),
        requests: Mutex::new(vec![]),
        pending,
        started: CancellationToken::new(),
        dropped: AtomicBool::new(false),
    });
    let session = TeamsClient::builder(Arc::new(Tokens))
        .ic3_region(Region::EuropeMiddleEastAfrica)
        .transport(transport.clone())
        .build()
        .unwrap()
        .session(Account::new(
            TenantId::new("fixture-tenant").unwrap(),
            UserId::new("fixture-user").unwrap(),
        ));
    let owner = Arc::new(Lifetime::default());
    let ctx = owner.begin(Duration::from_secs(30)).unwrap();
    owner.publish(&ctx, session).unwrap();
    (owner, transport)
}

fn read(owner: &Arc<Lifetime>) -> NativeTeamsIc3Read {
    NativeTeamsIc3Read::new(owner.clone(), Duration::from_secs(5)).unwrap()
}

fn chat(id: &str, kind: &str) -> Value {
    json!({"id": id, "threadProperties": {"threadType": "chat", "productThreadType": kind}})
}

fn message(chat: &str, id: &str, sender: &str) -> Value {
    json!({
        "id": id, "conversationid": chat, "version": "1767225600000",
        "originalarrivaltime": "2026-01-01T00:00:00Z", "messagetype": "Text",
        "from": sender, "content": "@coc synthetic prompt", "properties": {"mentions": "[]"}
    })
}

#[tokio::test]
async fn discovery_keeps_raw_count_and_opaque_continuation_without_inventing_self_availability() {
    let (owner, transport) = setup(
        vec![
            json!({"conversations": [
            chat("ordinary", "OneToOneChat"), chat("group", "Chat"),
            {"id": "channel", "threadProperties": {"threadType": "channel"}},
            {"id": "48:notes"}
        ], "_metadata": {"backwardLink":
            "https://teams.cloud.microsoft/api/chatsvc/emea/v1/users/ME/conversations?pageSize=50&cursor=next"}}),
            json!({"conversations": []}),
        ],
        false,
    );
    let first = read(&owner);
    first.state.begin(&Collection::Chats, None).unwrap();
    let page = first.state.publish_chats(first.state.chats(None).await.unwrap()).unwrap();
    assert_eq!(page.raw_count, 4);
    assert_eq!(page.items.len(), 2);
    assert_eq!((&*page.items[0].chat_id, &*page.items[0].kind), ("ordinary", "oneOnOne"));
    assert_eq!((&*page.items[1].chat_id, &*page.items[1].kind), ("group", "group"));
    let next = read(&owner);
    let cursor = next.state.begin(&Collection::Chats, page.next.as_ref()).unwrap();
    let page = next.state.publish_chats(next.state.chats(cursor.as_ref()).await.unwrap()).unwrap();
    assert_eq!(page.raw_count, 0);
    assert!(page.next.is_none());
    assert!(transport.requests.lock().unwrap()[1].contains("cursor=next"));
}

#[tokio::test]
async fn ordinary_group_and_explicit_self_history_preserve_author_edit_deletion_and_untrusted_content(
) {
    for id in ["ordinary", "group", "48:notes"] {
        let mut edited = message(id, "edited", "8:orgid:fixture-user");
        edited["version"] = json!("1767229200000");
        edited["messagetype"] = json!("RichText/Html");
        edited["content"] =
            json!("<p>@coc synthetic prompt</p><blockquote>ignored quote</blockquote>");
        let (owner, _) = setup(
            vec![
                if id == "48:notes" {
                    json!({"id": id})
                } else {
                    chat(id, if id == "ordinary" { "OneToOneChat" } else { "Chat" })
                },
                json!({"messages": [
                    edited,
                    message(id, "other", "8:orgid:other-user"),
                    message(id, "application", "28:fixture-application"),
                    {"id": "deleted", "conversationid": id, "version": "1767229200000", "properties": {"isdeleted": true}}
                ]}),
            ],
            false,
        );
        let request = read(&owner);
        let target = ChatId::new(id).unwrap();
        request.state.begin(&Collection::History(target.clone()), None).unwrap();
        let page = request
            .state
            .publish_history(target.clone(), request.state.history(&target, None).await.unwrap())
            .unwrap();
        assert_eq!(page.raw_count, 4);
        assert!(page.next.is_none());
        let own = &page.items[0];
        assert_eq!(own.chat_id, id);
        assert_eq!(own.message_id, "edited");
        assert_eq!((&*own.author_kind, own.author_id.as_deref()), ("user", Some("fixture-user")));
        assert!(own.modified_at > own.created_at);
        assert!(own.untrusted_html.as_ref().unwrap().contains("<blockquote>"));
        assert!(!own.text_truncated && !own.html_truncated);
        assert_eq!(own.mentioned_user_ids.as_ref().unwrap().len(), 0);
        assert_eq!(page.items[1].author_id.as_deref(), Some("other-user"));
        assert_eq!(
            (&*page.items[2].author_kind, page.items[2].author_id.as_deref()),
            ("application", Some("fixture-application"))
        );
        assert!(page.items[3].deleted);
        assert_eq!(page.items[3].author_kind, "unknown");
        assert!(page.items[3].author_id.is_none());
        assert!(page.items[3].text.is_empty());
    }
}

#[tokio::test]
async fn history_cursor_is_collection_and_owner_bound_and_does_not_expose_provider_urls() {
    let (owner, transport) = setup(
        vec![
            json!({"id": "48:notes"}),
            json!({"messages": [message("48:notes", "first", "8:orgid:fixture-user")], "_metadata": {"backwardLink":
            "https://teams.cloud.microsoft/api/chatsvc/emea/v1/users/ME/conversations/48%3Anotes/messages?pageSize=50&cursor=next"}}),
            json!({"id": "48:notes"}),
            json!({"messages": [message("48:notes", "next", "8:orgid:fixture-user")]}),
        ],
        false,
    );
    let target = ChatId::new("48:notes").unwrap();
    let first = read(&owner);
    first.state.begin(&Collection::History(target.clone()), None).unwrap();
    let page = first
        .state
        .publish_history(target.clone(), first.state.history(&target, None).await.unwrap())
        .unwrap();
    let cursor = page.next.as_ref();
    let (other_owner, other_transport) = setup(vec![], false);
    for (lifetime, collection) in [
        (&owner, Collection::Chats),
        (&owner, Collection::History(ChatId::new("other").unwrap())),
        (&other_owner, Collection::History(target.clone())),
    ] {
        assert_eq!(
            read(lifetime).state.begin(&collection, cursor).err().unwrap().code,
            ErrorCode::UnsafeCursor
        );
    }
    assert!(other_transport.requests.lock().unwrap().is_empty());
    assert_eq!(transport.requests.lock().unwrap().len(), 2);
    let next = read(&owner);
    let continuation = next.state.begin(&Collection::History(target.clone()), cursor).unwrap();
    let page = next
        .state
        .publish_history(
            target.clone(),
            next.state.history(&target, continuation.as_ref()).await.unwrap(),
        )
        .unwrap();
    assert_eq!(page.items[0].message_id, "next");
    assert!(page.next.is_none());
    owner.close();
    assert_eq!(
        NativeTeamsIc3Read::new(owner, Duration::from_secs(1)).err().unwrap().code,
        ErrorCode::Closed
    );
}

#[tokio::test]
async fn cancel_close_deadline_and_drop_revoke_pending_reads_without_late_publication() {
    for mode in ["cancel", "close", "deadline", "drop"] {
        let (owner, transport) = setup(vec![], true);
        let mut request = read(&owner);
        if mode == "deadline" {
            Arc::get_mut(&mut request.state).unwrap().ctx.deadline =
                tokio::time::Instant::now() + Duration::from_millis(20);
        }
        let state = request.state.clone();
        let pending = tokio::spawn(async move { state.chats(None).await });
        transport.started.cancelled().await;
        match mode {
            "cancel" => request.cancel(),
            "close" => owner.close(),
            "drop" => drop(request),
            _ => {}
        }
        let code = if mode == "close" {
            ErrorCode::Closed
        } else if mode == "deadline" {
            ErrorCode::Timeout
        } else {
            ErrorCode::Cancelled
        };
        let failure = tokio::time::timeout(Duration::from_secs(1), pending)
            .await
            .unwrap()
            .unwrap()
            .err()
            .unwrap();
        assert_eq!(failure.code, code);
        assert!(transport.dropped.load(Ordering::Acquire));
    }
    let (owner, _) = setup(vec![json!({"conversations": []})], false);
    let request = read(&owner);
    let page = request.state.chats(None).await.unwrap();
    request.cancel();
    assert_eq!(request.state.publish_chats(page).err().unwrap().code, ErrorCode::Cancelled);
}

#[tokio::test]
async fn reads_are_one_shot_and_cancellation_does_not_dispose_the_account_or_other_reads() {
    let (owner, transport) = setup(vec![json!({"conversations": []})], false);
    let first = read(&owner);
    first.state.begin(&Collection::Chats, None).unwrap();
    assert_eq!(
        first.state.begin(&Collection::Chats, None).err().unwrap().code,
        ErrorCode::InvalidTarget
    );
    first.cancel();
    assert_eq!(first.state.chats(None).await.err().unwrap().code, ErrorCode::Cancelled);
    let next = read(&owner);
    next.state.begin(&Collection::Chats, None).unwrap();
    assert!(next.state.publish_chats(next.state.chats(None).await.unwrap()).is_ok());
    assert_eq!(transport.requests.lock().unwrap().len(), 1);
    let no_session = Arc::new(Lifetime::default());
    assert_eq!(
        NativeTeamsIc3Read::new(no_session, Duration::from_secs(1)).err().unwrap().code,
        ErrorCode::InvalidTarget
    );
}

#[tokio::test]
async fn completed_results_are_revoked_on_close_or_deadline_before_node_publication() {
    for close in [true, false] {
        let (owner, _) = setup(vec![json!({"conversations": []})], false);
        let mut request = read(&owner);
        let page = request.state.chats(None).await.unwrap();
        if close {
            owner.close();
        } else {
            Arc::get_mut(&mut request.state).unwrap().ctx.deadline =
                tokio::time::Instant::now() - Duration::from_secs(1);
        }

        assert_eq!(
            request.state.publish_chats(page).err().unwrap().code,
            if close { ErrorCode::Closed } else { ErrorCode::Timeout }
        );
    }
}

#[tokio::test]
async fn cancellation_is_isolated_between_simultaneous_reads_on_one_session() {
    let (owner, transport) = setup(vec![], true);
    let first = read(&owner);
    let second = read(&owner);
    let first_state = first.state.clone();
    let second_state = second.state.clone();
    let cancelled = tokio::spawn(async move { first_state.chats(None).await });
    let surviving = tokio::spawn(async move { second_state.chats(None).await });
    tokio::time::timeout(Duration::from_secs(1), async {
        while transport.requests.lock().unwrap().len() < 2 {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    first.cancel();
    assert_eq!(cancelled.await.unwrap().err().unwrap().code, ErrorCode::Cancelled);
    assert!(!surviving.is_finished());
    assert!(!owner.cancellation.is_cancelled());
    owner.close();
    assert_eq!(surviving.await.unwrap().err().unwrap().code, ErrorCode::Closed);
}

#[tokio::test]
async fn sdk_body_bounds_survive_the_native_projection() {
    let mut large = message("48:notes", "large", "8:orgid:fixture-user");
    large["messagetype"] = json!("RichText/Html");
    large["content"] = json!(format!("<p>{}</p>", "x".repeat(20 * 1024)));
    let (owner, _) = setup(vec![json!({"id": "48:notes"}), json!({"messages": [large]})], false);
    let request = read(&owner);
    let target = ChatId::new("48:notes").unwrap();
    let page = request
        .state
        .publish_history(target.clone(), request.state.history(&target, None).await.unwrap())
        .unwrap();
    assert_eq!(page.items[0].text.len(), 16 * 1024);
    assert!(page.items[0].text_truncated);
    assert!(page.items[0].untrusted_html.is_none());
    assert!(page.items[0].html_truncated);
}
