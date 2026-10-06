//! Best-effort, content-free Trouter hints. Reconciliation is always caller-owned.
use crate::constants::ic3::{
    APP_ID, CLIENT_VERSION, CORRELATION_VERSION, REGISTRAR_ENDPOINT, SELF_CHAT_ID, TEMPLATE_KEY,
    TROUTER_ENDPOINT, USER_AGENT,
};
use crate::{normalize::protocol, *};
use async_trait::async_trait;
use futures_util::{SinkExt, StreamExt};
use reqwest::{header::HeaderMap, Method};
use serde_json::{json, Value};
use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::{Duration, SystemTime},
};
use tokio::sync::{mpsc, watch};
use tokio_tungstenite::{
    tungstenite::{protocol::WebSocketConfig, Message},
    MaybeTlsStream, WebSocketStream,
};
use url::Url;

const MAX_FRAME: usize = 256 * 1024;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ReconcileReason {
    Startup,
    Reconnected,
    Gap,
    Overflow,
    Disconnected,
}
#[derive(Clone, Debug)]
pub enum ChangeHint {
    Changed {
        conversation: ChatId,
        root: Option<MessageId>,
    },
    Reconcile(ReconcileReason),
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NotificationState {
    Connecting,
    Registered,
    Retrying,
    Stopped,
}
#[derive(Clone, Debug)]
pub struct NotificationStatus {
    pub state: NotificationState,
    pub error: Option<Error>,
}

/// Trusted injectable socket boundary. No payload logging/persistence; no reconnection or replay.
#[async_trait]
pub trait NotificationSocket: Send {
    async fn send(&mut self, frame: String) -> Result<()>;
    async fn receive(&mut self) -> Result<Option<String>>;
}
#[async_trait]
pub trait NotificationConnector: Send + Sync {
    async fn connect(&self, url: Url) -> Result<Box<dyn NotificationSocket>>;
}
pub struct WebSocketConnector;
struct NativeSocket(WebSocketStream<MaybeTlsStream<tokio::net::TcpStream>>);
#[async_trait]
impl NotificationConnector for WebSocketConnector {
    async fn connect(&self, url: Url) -> Result<Box<dyn NotificationSocket>> {
        let config = WebSocketConfig::default()
            .max_message_size(Some(MAX_FRAME))
            .max_frame_size(Some(MAX_FRAME))
            .max_write_buffer_size(MAX_FRAME * 2);
        let (socket, _) =
            tokio_tungstenite::connect_async_with_config(url.as_str(), Some(config), false)
                .await
                .map_err(|_| Error::new(ErrorCode::Network))?;
        Ok(Box::new(NativeSocket(socket)))
    }
}
#[async_trait]
impl NotificationSocket for NativeSocket {
    async fn send(&mut self, frame: String) -> Result<()> {
        if frame.len() > MAX_FRAME {
            return Err(Error::new(ErrorCode::Limit));
        }
        self.0
            .send(Message::Text(frame.into()))
            .await
            .map_err(|_| Error::new(ErrorCode::Network))
    }
    async fn receive(&mut self) -> Result<Option<String>> {
        loop {
            match self.0.next().await {
                Some(Ok(Message::Text(text))) => return Ok(Some(text.to_string())),
                Some(Ok(Message::Ping(_))) => {
                    self.0
                        .flush()
                        .await
                        .map_err(|_| Error::new(ErrorCode::Network))?;
                }
                Some(Ok(Message::Pong(_))) => {}
                Some(Ok(Message::Close(_))) | None => return Ok(None),
                _ => return Err(protocol()),
            }
        }
    }
}
pub struct Notifications {
    receiver: mpsc::Receiver<ChangeHint>,
    overflow: Arc<AtomicBool>,
    stop: CancellationToken,
    lifetime: CancellationToken,
    status: watch::Receiver<NotificationStatus>,
    task: Option<tokio::task::JoinHandle<()>>,
}
impl Notifications {
    pub async fn next(&mut self) -> Option<ChangeHint> {
        if self.stop.is_cancelled() || self.lifetime.is_cancelled() {
            return None;
        }
        if self.overflow.swap(false, Ordering::AcqRel) {
            while self.receiver.try_recv().is_ok() {}
            return Some(ChangeHint::Reconcile(ReconcileReason::Overflow));
        }
        tokio::select! {
            biased;
            _ = self.stop.cancelled() => None,
            _ = self.lifetime.cancelled() => None,
            hint = self.receiver.recv() => hint,
        }
    }
    pub fn status(&self) -> NotificationStatus {
        self.status.borrow().clone()
    }
    pub async fn close(&mut self) -> Result<()> {
        self.stop.cancel();
        if let Some(task) = self.task.take() {
            task.await.map_err(|_| Error::new(ErrorCode::Protocol))?;
        }
        Ok(())
    }
}
impl Drop for Notifications {
    fn drop(&mut self) {
        self.stop.cancel();
    }
}
struct Outbox {
    sender: mpsc::Sender<ChangeHint>,
    overflow: Arc<AtomicBool>,
    stop: CancellationToken,
}
impl Outbox {
    fn emit(&self, hint: ChangeHint) {
        if self.stop.is_cancelled() {
            return;
        }
        if let Err(mpsc::error::TrySendError::Full(_)) = self.sender.try_send(hint) {
            self.overflow.store(true, Ordering::Release);
        }
    }
}
impl Session {
    pub fn notifications(&self, capacity: usize) -> Result<Notifications> {
        self.notifications_with_connector(capacity, Arc::new(WebSocketConnector))
    }
    pub fn notifications_with_connector(
        &self,
        capacity: usize,
        connector: Arc<dyn NotificationConnector>,
    ) -> Result<Notifications> {
        self.enabled(Backend::Ic3)?;
        if self.is_closed() {
            return Err(Error::new(ErrorCode::Closed));
        }
        if !(1..=1024).contains(&capacity) {
            return Err(Error::new(ErrorCode::Configuration));
        }
        let (sender, receiver) = mpsc::channel(capacity);
        let (status_tx, status) = watch::channel(NotificationStatus {
            state: NotificationState::Connecting,
            error: None,
        });
        let stop = self.inner.lifetime.child_token();
        let overflow = Arc::new(AtomicBool::new(false));
        let outbox = Outbox {
            sender,
            overflow: overflow.clone(),
            stop: stop.clone(),
        };
        let session = self.clone();
        let task_stop = stop.clone();
        let task = tokio::spawn(async move {
            session
                .notification_loop(connector, outbox, status_tx, task_stop)
                .await;
        });
        Ok(Notifications {
            receiver,
            overflow,
            stop,
            lifetime: self.inner.lifetime.clone(),
            status,
            task: Some(task),
        })
    }
    async fn notification_loop(
        &self,
        connector: Arc<dyn NotificationConnector>,
        outbox: Outbox,
        status: watch::Sender<NotificationStatus>,
        stop: CancellationToken,
    ) {
        let mut failures = 0u32;
        let mut refresh = false;
        outbox.emit(ChangeHint::Reconcile(ReconcileReason::Startup));
        'reconnect: while !stop.is_cancelled() {
            status.send_replace(NotificationStatus {
                state: NotificationState::Connecting,
                error: None,
            });
            let result = self
                .notification_connection(&*connector, &outbox, &status, &stop, refresh)
                .await;
            refresh = match &result {
                Ok(()) => true,
                Err(error) => error.code == ErrorCode::Authentication,
            };
            if stop.is_cancelled() || self.is_closed() {
                break;
            }
            outbox.emit(ChangeHint::Reconcile(ReconcileReason::Disconnected));
            let (error, minimum_delay) = match result {
                Ok(()) => {
                    failures = 0;
                    (None, Duration::ZERO)
                }
                Err(error) => {
                    let delay = error.retry_after.unwrap_or_default();
                    (Some(error), delay)
                }
            };
            status.send_replace(NotificationStatus {
                state: NotificationState::Retrying,
                error,
            });
            let cap = 500u64.saturating_mul(1 << failures.min(6)).min(30_000);
            failures = failures.saturating_add(1);
            let jitter = u64::from(uuid::Uuid::new_v4().as_bytes()[0]);
            let delay =
                minimum_delay.max(Duration::from_millis(cap / 2 + (cap / 2 * jitter / 255)));
            // Preserve even very large Retry-After values without overflowing Instant.
            let mut remaining = delay;
            while !remaining.is_zero() {
                let chunk = remaining.min(Duration::from_secs(3600));
                tokio::select! { biased; _ = stop.cancelled() => break 'reconnect, _ = tokio::time::sleep(chunk) => {} }
                remaining -= chunk;
            }
        }
        status.send_replace(NotificationStatus {
            state: NotificationState::Stopped,
            error: None,
        });
    }
    async fn notification_connection(
        &self,
        connector: &dyn NotificationConnector,
        outbox: &Outbox,
        status: &watch::Sender<NotificationStatus>,
        stop: &CancellationToken,
        refresh: bool,
    ) -> Result<()> {
        let mut ctx = OperationContext::with_timeout(Duration::from_secs(30));
        ctx.cancellation = stop.clone();
        let token = self.token(Backend::Ic3, refresh, &ctx).await?;
        let lease = token
            .expires_at
            .duration_since(SystemTime::now())
            .unwrap_or_default();
        if lease <= Duration::from_secs(120) {
            return Err(Error::new(ErrorCode::Authentication));
        }
        let lease_end = tokio::time::Instant::now()
            + (lease - Duration::from_secs(120)).min(Duration::from_secs(55 * 60));
        let mut url = Url::parse(TROUTER_ENDPOINT).map_err(|_| protocol())?;
        url.query_pairs_mut()
            .append_pair(
                "tc",
                &json!({"cv":CORRELATION_VERSION,"ua":USER_AGENT,"hr":"","v":CLIENT_VERSION})
                    .to_string(),
            )
            .append_pair("timeout", "40")
            .append_pair("epid", &uuid::Uuid::new_v4().to_string())
            .append_pair("cor_id", &uuid::Uuid::new_v4().to_string())
            .append_pair("ccid", "")
            .append_pair("con_num", "1_0");
        let mut socket = self.wait(&ctx, false, connector.connect(url)).await?;
        self.wait(&ctx, false, socket.send(format!("5:::{}", json!({"name":"user.authenticate","args":[{
            "headers":{"Authorization":format!("Bearer {}", token.secret),"X-Ms-Test-User":"False"}}]})))).await?;
        let registration_deadline = ctx.deadline;
        let mut registered = false;
        loop {
            let deadline = if registered {
                lease_end.min(tokio::time::Instant::now() + Duration::from_secs(60))
            } else {
                registration_deadline
            };
            let ctx = OperationContext {
                cancellation: stop.clone(),
                deadline,
            };
            let frame = match self.wait(&ctx, false, socket.receive()).await {
                Err(error)
                    if registered
                        && error.code == ErrorCode::Timeout
                        && tokio::time::Instant::now() >= lease_end =>
                {
                    return Ok(())
                }
                result => result?,
            }
            .ok_or_else(|| Error::new(ErrorCode::Network))?;
            let effects = parse_frame(&frame)?;
            for frame in effects.responses {
                self.wait(&ctx, false, socket.send(frame)).await?;
            }
            if let Some(hint) = effects.hint {
                outbox.emit(hint);
            }
            if let Some(path) = effects.registration_path {
                if registered {
                    return Err(protocol());
                }
                let ctx = ctx.bounded(Duration::from_secs(10));
                let mut headers = HeaderMap::new();
                headers.insert("x-ms-test-user", "False".parse().expect("static header"));
                headers.insert("x-ms-migration", "True".parse().expect("static header"));
                self.request(Backend::Ic3, Method::POST, Url::parse(REGISTRAR_ENDPOINT).map_err(|_| protocol())?,
                    Some(json!({"clientDescription":{"appId":APP_ID,"aesKey":"","languageId":"en-US",
                        "platform":"edge","templateKey":TEMPLATE_KEY,"platformUIVersion":CLIENT_VERSION},
                        "registrationId":uuid::Uuid::new_v4().to_string(),"nodeId":"",
                        "transports":{"TROUTER":[{"context":"","path":path,"ttl":3600}]}})),
                    headers, true, &ctx).await?;
                self.check(&ctx)?;
                registered = true;
                outbox.emit(ChangeHint::Reconcile(ReconcileReason::Reconnected));
                status.send_replace(NotificationStatus {
                    state: NotificationState::Registered,
                    error: None,
                });
            }
        }
    }
}
pub(crate) struct Effects {
    pub responses: Vec<String>,
    pub registration_path: Option<String>,
    pub hint: Option<ChangeHint>,
}
pub(crate) fn parse_frame(raw: &str) -> Result<Effects> {
    if raw.len() > MAX_FRAME {
        return Err(Error::new(ErrorCode::Limit));
    }
    let parts: Vec<_> = raw.splitn(4, ':').collect();
    if parts.len() < 3 {
        return Err(protocol());
    }
    let mut effects = Effects {
        responses: vec![],
        registration_path: None,
        hint: None,
    };
    match parts[0] {
        "0" | "7" => return Err(Error::new(ErrorCode::Network)),
        "2" => effects.responses.push("2::".to_owned()),
        "5" => {
            let value: Value =
                serde_json::from_str(parts.get(3).ok_or_else(protocol)?).map_err(|_| protocol())?;
            if let Some(ack) = parts[1].strip_suffix('+') {
                if ack.len() > 32 || ack.is_empty() || !ack.bytes().all(|b| b.is_ascii_digit()) {
                    return Err(protocol());
                }
                effects.responses.push(format!("6:::{ack}+[]"));
            }
            match value["name"].as_str() {
                Some("trouter.connected") => {
                    let connection = &value["args"][0];
                    let path = connection["surl"]
                        .as_str()
                        .or_else(|| connection["url"].as_str())
                        .ok_or_else(protocol)?;
                    if path.len() > 4096 || path.chars().any(char::is_control) {
                        return Err(protocol());
                    }
                    let url = Url::parse(path).map_err(|_| protocol())?;
                    if !["https", "wss"].contains(&url.scheme())
                        || !url.username().is_empty()
                        || url.password().is_some()
                    {
                        return Err(protocol());
                    }
                    // Forwarding data only; never a credential-bearing request destination.
                    effects.registration_path = Some(path.to_owned());
                }
                Some("trouter.message_loss") => {
                    effects.hint = Some(ChangeHint::Reconcile(ReconcileReason::Gap))
                }
                _ => {}
            }
        }
        "3" => {
            let request: Value =
                serde_json::from_str(parts.get(3).ok_or_else(protocol)?).map_err(|_| protocol())?;
            let id = &request["id"];
            if !id.is_u64() && !id.as_str().is_some_and(|s| !s.is_empty() && s.len() <= 128) {
                return Err(protocol());
            }
            effects.responses.push(format!(
                "3:::{}",
                json!({"id":id,"status":200,"headers":{}})
            ));
            let body = object(&request["body"])?;
            let kind = body["resourceType"]
                .as_str()
                .unwrap_or("")
                .to_ascii_lowercase();
            if body["type"]
                .as_str()
                .unwrap_or("")
                .eq_ignore_ascii_case("eventmessage")
                && ["newmessage", "updatemessage", "editedmessage"].contains(&kind.as_str())
            {
                let resource = object(&body["resource"])?;
                let properties = object(&resource["properties"])?;
                let activity = object(&properties["activity"])?;
                let source = activity["sourceThreadId"].as_str();
                let stream = resource["to"]
                    .as_str()
                    .or_else(|| body["to"].as_str())
                    .or_else(|| resource["conversationLink"].as_str())
                    .or_else(|| body["resourceLink"].as_str());
                let candidate = source.or(stream).and_then(conversation_id);
                effects.hint = Some(match candidate {
                    Some(conversation) => {
                        let root = activity["sourceReplyChainId"]
                            .as_str()
                            .or_else(|| resource["parentmessageid"].as_str())
                            .or_else(|| body["parentmessageid"].as_str())
                            .or_else(|| body["parentMessageId"].as_str())
                            .or_else(|| resource["parentMessageId"].as_str())
                            .or_else(|| resource["replyToId"].as_str())
                            .map(MessageId::new)
                            .transpose()?;
                        ChangeHint::Changed { conversation, root }
                    }
                    None => ChangeHint::Reconcile(ReconcileReason::Gap),
                });
            }
        }
        "1" | "4" | "6" | "8" => {}
        _ => return Err(protocol()),
    }
    Ok(effects)
}
fn object(value: &Value) -> Result<Value> {
    if value.is_null() {
        return Ok(json!({}));
    }
    let value = match value.as_str() {
        Some(text) => serde_json::from_str(text).map_err(|_| protocol())?,
        None => value.clone(),
    };
    if !value.is_object() {
        return Err(protocol());
    }
    Ok(value)
}
fn conversation_id(value: &str) -> Option<ChatId> {
    let decoded = percent_encoding::percent_decode_str(value)
        .decode_utf8()
        .ok()?;
    let value = decoded.as_ref();
    let value = if value.starts_with("https://") {
        let url = Url::parse(value).ok()?;
        let parts: Vec<_> = url.path_segments()?.collect();
        let index = parts.iter().position(|s| *s == "conversations")?;
        parts.get(index + 1)?.to_string()
    } else {
        value.to_owned()
    };
    let id = value
        .split(";messageid=")
        .next()?
        .split(['?', '#'])
        .next()?;
    if id != SELF_CHAT_ID && id.to_ascii_lowercase().starts_with("48:") {
        return None;
    }
    ChatId::new(id).ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn self_chat_events_preserve_notes_but_filter_other_activity_streams() {
        for target in [
            "48:notes",
            "48%3Anotes",
            "https://teams.cloud.microsoft/api/chatsvc/amer/v1/users/ME/conversations/48%3Anotes/messages",
        ] {
            let frame = format!(
                "3:::{}",
                json!({"id":1,"body":{"type":"EventMessage","resourceType":"NewMessage",
                "resource":{"to":target,"content":"private-self-message","properties":{}}}})
            );
            let parsed = parse_frame(&frame).unwrap();
            let Some(ChangeHint::Changed { conversation, root }) = parsed.hint else {
                panic!("self-chat must produce a change hint");
            };
            assert_eq!(conversation.as_str(), "48:notes");
            assert!(root.is_none());
            assert!(!parsed.responses.join("").contains("private-self-message"));
        }
        for target in ["48:synthetic", "48:notes-other", "48:NOTES"] {
            assert!(conversation_id(target).is_none());
        }
    }

    #[test]
    fn frames_ack_and_drop_content() {
        let frame = format!(
            "3:::{}",
            json!({"id":1,"body":{"type":"EventMessage","resourceType":"EditedMessage",
            "resource":{"to":"48:synthetic","content":"secret-body","properties":{"activity":{
                "sourceThreadId":"19:sample@thread.v2","sourceReplyChainId":"root"}}}}})
        );
        let parsed = parse_frame(&frame).unwrap();
        assert!(matches!(parsed.hint, Some(ChangeHint::Changed { .. })));
        assert!(!parsed.responses.join("").contains("secret-body"));
        assert_eq!(parse_frame("2::").unwrap().responses, vec!["2::"]);
        assert!(matches!(
            parse_frame("5:12+::{\"name\":\"trouter.message_loss\"}")
                .unwrap()
                .hint,
            Some(ChangeHint::Reconcile(ReconcileReason::Gap))
        ));
        assert!(parse_frame(&"x".repeat(MAX_FRAME + 1)).is_err());
        assert!(parse_frame("5:::not-json").is_err());
    }
    #[tokio::test]
    async fn overflow_is_reconciliation_and_revocation_drops_queue() {
        let (sender, receiver) = mpsc::channel(1);
        let stop = CancellationToken::new();
        let overflow = Arc::new(AtomicBool::new(false));
        let (_, status) = watch::channel(NotificationStatus {
            state: NotificationState::Registered,
            error: None,
        });
        let outbox = Outbox {
            sender,
            overflow: overflow.clone(),
            stop: stop.clone(),
        };
        let mut notifications = Notifications {
            receiver,
            overflow,
            stop: stop.clone(),
            lifetime: stop.clone(),
            status,
            task: None,
        };
        outbox.emit(ChangeHint::Reconcile(ReconcileReason::Startup));
        outbox.emit(ChangeHint::Reconcile(ReconcileReason::Gap));
        assert!(matches!(
            notifications.next().await,
            Some(ChangeHint::Reconcile(ReconcileReason::Overflow))
        ));
        outbox.emit(ChangeHint::Reconcile(ReconcileReason::Gap));
        stop.cancel();
        assert!(notifications.next().await.is_none());
    }
}
