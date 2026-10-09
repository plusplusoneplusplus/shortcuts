use crate::{
    auth::{AccessToken, Audience},
    capabilities::{compiled, Operation},
    client::Config,
    http::{retry_after, HttpRequest, HttpResponse, MAX_RESPONSE_BYTES},
    normalize::{self, protocol, string},
    *,
};
use reqwest::{
    header::{HeaderMap, HeaderValue, AUTHORIZATION, CONTENT_TYPE},
    Method,
};
use serde_json::{json, Value};
use std::{collections::HashSet, future::Future, sync::Arc, time::Duration};
use tokio::time::Instant;
use url::Url;

#[derive(Clone)]
pub struct OperationContext {
    pub cancellation: CancellationToken,
    pub deadline: Instant,
}
impl Default for OperationContext {
    fn default() -> Self {
        Self::with_timeout(Duration::from_secs(30))
    }
}
impl OperationContext {
    pub fn with_timeout(timeout: Duration) -> Self {
        Self {
            cancellation: CancellationToken::new(),
            deadline: Instant::now() + timeout.min(Duration::from_secs(300)),
        }
    }
    pub(crate) fn bounded(&self, duration: Duration) -> Self {
        Self {
            cancellation: self.cancellation.clone(),
            deadline: self.deadline.min(Instant::now() + duration),
        }
    }
}
#[derive(Clone)]
pub struct Session {
    pub(crate) inner: Arc<SessionInner>,
}
pub(crate) struct SessionInner {
    pub config: Arc<Config>,
    pub account: Account,
    pub generation: uuid::Uuid,
    pub lifetime: CancellationToken,
    pub mcp: tokio::sync::Mutex<crate::mcp::State>,
}
impl Drop for SessionInner {
    fn drop(&mut self) {
        self.lifetime.cancel();
    }
}
impl Session {
    pub(crate) fn new(config: Arc<Config>, account: Account) -> Self {
        Self {
            inner: Arc::new(SessionInner {
                config,
                account,
                generation: uuid::Uuid::new_v4(),
                lifetime: CancellationToken::new(),
                mcp: tokio::sync::Mutex::new(crate::mcp::State::default()),
            }),
        }
    }
    pub fn account(&self) -> &Account {
        &self.inner.account
    }
    pub fn close(&self) {
        self.inner.lifetime.cancel();
    }
    pub fn is_closed(&self) -> bool {
        self.inner.lifetime.is_cancelled()
    }
    pub(crate) fn check(&self, ctx: &OperationContext) -> Result<()> {
        if self.is_closed() {
            Err(Error::new(ErrorCode::Closed))
        } else if ctx.cancellation.is_cancelled() {
            Err(Error::new(ErrorCode::Cancelled))
        } else if Instant::now() >= ctx.deadline {
            Err(Error::new(ErrorCode::Timeout))
        } else {
            Ok(())
        }
    }
    pub(crate) async fn wait<T>(
        &self,
        ctx: &OperationContext,
        attempted: bool,
        future: impl Future<Output = Result<T>>,
    ) -> Result<T> {
        let delivery = if attempted {
            Delivery::Unknown
        } else {
            Delivery::NotAttempted
        };
        self.check(ctx).map_err(|e| e.delivery(delivery))?;
        let result = tokio::select! {
            biased;
            _ = self.inner.lifetime.cancelled() => Err(Error::new(ErrorCode::Closed)),
            _ = ctx.cancellation.cancelled() => Err(Error::new(ErrorCode::Cancelled)),
            _ = tokio::time::sleep_until(ctx.deadline) => Err(Error::new(ErrorCode::Timeout)),
            result = future => result,
        };
        self.check(ctx).map_err(|e| e.delivery(delivery))?;
        result.map_err(|e| if attempted { e.delivery(delivery) } else { e })
    }
    pub(crate) fn enabled(&self, backend: Backend) -> Result<()> {
        if !compiled(backend) {
            return Err(Error::new(ErrorCode::Unsupported));
        }
        if backend == Backend::Ic3 && self.inner.config.region.is_none() {
            return Err(Error::new(ErrorCode::Configuration));
        }
        Ok(())
    }
    pub fn supports(&self, operation: Operation) -> bool {
        let Some(backend) = self.inner.config.routes.route(operation) else {
            return false;
        };
        if self.is_closed() || self.enabled(backend).is_err() {
            return false;
        }
        match backend {
            Backend::Graph => operation != Operation::SelfSend,
            Backend::Mcp => operation != Operation::ChannelLike,
            Backend::Ic3 => {
                matches!(operation, Operation::SelfSend | Operation::ChannelLike)
                    || operation == Operation::ChatSend && self.has_verifier()
            }
        }
    }
    fn has_verifier(&self) -> bool {
        self.inner.config.verifier.is_some()
    }
    /// Bind a target to this session, not proof of membership. Reads still require authorization.
    pub fn conversation(
        &self,
        backend: Backend,
        conversation: Conversation,
    ) -> Result<ConversationRef> {
        self.enabled(backend)?;
        if self.is_closed() {
            return Err(Error::new(ErrorCode::Closed));
        }
        Ok(ConversationRef {
            generation: self.inner.generation,
            backend,
            conversation,
        })
    }
    pub fn message_ref(&self, conversation: &ConversationRef, id: MessageId) -> Result<MessageRef> {
        self.validate_ref(conversation)?;
        Ok(MessageRef {
            conversation: conversation.clone(),
            id,
        })
    }
    pub(crate) fn validate_ref(&self, reference: &ConversationRef) -> Result<()> {
        if self.is_closed() {
            return Err(Error::new(ErrorCode::Closed));
        }
        if reference.generation != self.inner.generation {
            return Err(Error::new(ErrorCode::InvalidTarget));
        }
        self.enabled(reference.backend)
    }
    pub(crate) async fn token(
        &self,
        backend: Backend,
        refresh: bool,
        ctx: &OperationContext,
    ) -> Result<AccessToken> {
        self.enabled(backend)?;
        let audience = match backend {
            Backend::Graph => Audience::Graph,
            Backend::Mcp => Audience::TeamsMcp,
            Backend::Ic3 => Audience::Ic3,
        };
        let token = self
            .wait(
                ctx,
                false,
                self.inner
                    .config
                    .tokens
                    .acquire(self.account(), audience, refresh),
            )
            .await
            .map_err(|e| match e.code {
                ErrorCode::Cancelled | ErrorCode::Closed | ErrorCode::Timeout => e,
                _ => Error::new(ErrorCode::Authentication),
            })?;
        token.validate(self.account(), audience)?;
        Ok(token)
    }
    #[allow(clippy::too_many_arguments)]
    pub(crate) async fn request(
        &self,
        backend: Backend,
        method: Method,
        url: Url,
        body: Option<Value>,
        extra: HeaderMap,
        write: bool,
        ctx: &OperationContext,
    ) -> Result<HttpResponse> {
        self.enabled(backend)?;
        // No automatic retry on transport failures, throttles, 403, or writes (including 401).
        for attempt in 0..2 {
            let token = self.token(backend, attempt != 0, ctx).await?;
            let mut headers = extra.clone();
            let mut auth = HeaderValue::from_str(&format!("Bearer {}", token.secret))
                .map_err(|_| Error::new(ErrorCode::Authentication))?;
            auth.set_sensitive(true);
            headers.insert(AUTHORIZATION, auth);
            headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
            if backend == Backend::Graph && !write {
                headers.insert(
                    "prefer",
                    HeaderValue::from_static("include-unknown-enum-members"),
                );
            }
            let request = HttpRequest {
                method: method.clone(),
                url: url.clone(),
                headers,
                body: body
                    .as_ref()
                    .map(|b| serde_json::to_vec(b).expect("JSON value serializes")),
            };
            let response = self
                .wait(ctx, write, self.inner.config.http.execute(request))
                .await?;
            if response.status == 401 && attempt == 0 && !write {
                continue;
            }
            if !(200..300).contains(&response.status) {
                return Err(Error::http(
                    response.status,
                    retry_after(&response.headers),
                    write,
                ));
            }
            if response.body.len() > MAX_RESPONSE_BYTES {
                return Err(Error::new(ErrorCode::Limit).delivery(if write {
                    Delivery::Unknown
                } else {
                    Delivery::NotAttempted
                }));
            }
            return Ok(response);
        }
        Err(Error::new(ErrorCode::Authentication))
    }
    pub(crate) fn url(&self, backend: Backend, segments: &[&str]) -> Result<Url> {
        self.enabled(backend)?;
        let base = match backend {
            Backend::Graph => crate::constants::GRAPH_API_BASE.to_owned(),
            Backend::Ic3 => format!(
                "{}/api/chatsvc/{}/v1/users/ME",
                crate::constants::TEAMS_ORIGIN,
                self.inner
                    .config
                    .region
                    .ok_or_else(|| Error::new(ErrorCode::Configuration))?
                    .as_str()
            ),
            Backend::Mcp => return Err(Error::new(ErrorCode::Unsupported)),
        };
        let mut url = Url::parse(&base).map_err(|_| Error::new(ErrorCode::Configuration))?;
        url.path_segments_mut()
            .map_err(|_| protocol())?
            .extend(segments);
        Ok(url)
    }
    pub(crate) fn message_url(&self, reference: &ConversationRef) -> Result<Url> {
        self.validate_ref(reference)?;
        match (&reference.conversation, reference.backend) {
            (Conversation::Chat(chat), Backend::Graph) => {
                self.url(Backend::Graph, &["chats", chat.as_str(), "messages"])
            }
            (Conversation::Chat(chat), Backend::Ic3) => {
                self.url(Backend::Ic3, &["conversations", chat.as_str(), "messages"])
            }
            (Conversation::Channel { team, channel }, Backend::Graph) => self.url(
                Backend::Graph,
                &[
                    "teams",
                    team.as_str(),
                    "channels",
                    channel.as_str(),
                    "messages",
                ],
            ),
            (
                Conversation::Replies {
                    team,
                    channel,
                    root,
                },
                Backend::Graph,
            ) => self.url(
                Backend::Graph,
                &[
                    "teams",
                    team.as_str(),
                    "channels",
                    channel.as_str(),
                    "messages",
                    root.as_str(),
                    "replies",
                ],
            ),
            _ => Err(Error::new(ErrorCode::Unsupported)),
        }
    }
    fn safe_cursor(&self, backend: Backend, collection: &Url, candidate: &Url) -> Result<()> {
        let same = candidate.origin() == collection.origin()
            && candidate.username().is_empty()
            && candidate.password().is_none()
            && candidate.fragment().is_none();
        let expected = cursor_segments(collection.path())?;
        let actual = cursor_segments(candidate.path())?;
        // Only the account segment immediately following the fixed IC3 users prefix may vary.
        let account_index = (backend == Backend::Ic3)
            .then(|| expected.iter().position(|s| s == "users").map(|i| i + 1))
            .flatten();
        let path_ok = expected.len() == actual.len()
            && expected
                .iter()
                .zip(&actual)
                .enumerate()
                .all(|(index, (expected, actual))| {
                    expected == actual
                        || (Some(index) == account_index
                            && expected == "ME"
                            && actual.eq_ignore_ascii_case(&format!(
                                "8:orgid:{}",
                                self.account().user.as_str()
                            )))
                });
        if !same || !path_ok {
            return Err(Error::new(ErrorCode::UnsafeCursor));
        }
        Ok(())
    }
    pub(crate) fn page_cursor(
        &self,
        backend: Backend,
        collection: &Url,
        next: Option<&str>,
    ) -> Result<Option<Cursor>> {
        let Some(next) = next.filter(|s| !s.is_empty()) else {
            return Ok(None);
        };
        if next.len() > 16 * 1024 {
            return Err(Error::new(ErrorCode::UnsafeCursor));
        }
        // URL parsers normalize dot segments before exposing pathname. Reject traversal in
        // the original spelling first, including percent-encoded separators and dot segments.
        if next.chars().any(|c| c.is_control() || c == '\\') {
            return Err(Error::new(ErrorCode::UnsafeCursor));
        }
        let authority = next
            .split_once("://")
            .ok_or_else(|| Error::new(ErrorCode::UnsafeCursor))?
            .1;
        let raw_path = authority
            .find('/')
            .map(|i| &authority[i..])
            .ok_or_else(|| Error::new(ErrorCode::UnsafeCursor))?;
        cursor_segments(
            raw_path
                .split(['?', '#'])
                .next()
                .ok_or_else(|| Error::new(ErrorCode::UnsafeCursor))?,
        )?;
        let url = Url::parse(next).map_err(|_| Error::new(ErrorCode::UnsafeCursor))?;
        self.safe_cursor(backend, collection, &url)?;
        Ok(Some(Cursor {
            generation: self.inner.generation,
            backend,
            collection: collection.path().to_owned(),
            url,
        }))
    }
    async fn get_page(
        &self,
        backend: Backend,
        collection: Url,
        cursor: Option<&Cursor>,
        ctx: &OperationContext,
    ) -> Result<(Value, Option<Cursor>)> {
        let url = if let Some(cursor) = cursor {
            if cursor.generation != self.inner.generation
                || cursor.backend != backend
                || cursor.collection != collection.path()
            {
                return Err(Error::new(ErrorCode::UnsafeCursor));
            }
            self.safe_cursor(backend, &collection, &cursor.url)?;
            cursor.url.clone()
        } else {
            collection.clone()
        };
        let value = self.get(backend, url, ctx).await?;
        let next_value = if backend == Backend::Ic3 {
            &value["_metadata"]["backwardLink"]
        } else {
            &value["@odata.nextLink"]
        };
        if !next_value.is_null() && !next_value.is_string() {
            return Err(protocol());
        }
        let next = self.page_cursor(backend, &collection, next_value.as_str())?;
        Ok((value, next))
    }
    pub(crate) async fn get(
        &self,
        backend: Backend,
        url: Url,
        ctx: &OperationContext,
    ) -> Result<Value> {
        let response = self
            .request(
                backend,
                Method::GET,
                url,
                None,
                HeaderMap::new(),
                false,
                ctx,
            )
            .await?;
        serde_json::from_slice(&response.body).map_err(|_| protocol())
    }
    pub async fn chats(
        &self,
        backend: Backend,
        cursor: Option<&Cursor>,
        ctx: &OperationContext,
    ) -> Result<Page<Chat>> {
        let mut url = match backend {
            Backend::Graph => self.url(backend, &["me", "chats"])?,
            Backend::Ic3 => self.url(backend, &["conversations"])?,
            Backend::Mcp => return self.mcp_chats(cursor, ctx).await,
        };
        url.query_pairs_mut().append_pair(
            if backend == Backend::Graph {
                "$top"
            } else {
                "pageSize"
            },
            "50",
        );
        let (value, next) = self.get_page(backend, url, cursor, ctx).await?;
        let rows = rows(
            &value,
            if backend == Backend::Ic3 {
                "conversations"
            } else {
                "value"
            },
        )?;
        let mut items = Vec::new();
        for row in rows {
            let kind = if backend == Backend::Ic3 {
                if row["threadProperties"]["threadType"].as_str() != Some("chat") {
                    continue;
                }
                match row["threadProperties"]["productThreadType"].as_str() {
                    Some("OneToOneChat") => ChatKind::OneOnOne,
                    Some("Chat") => ChatKind::Group,
                    _ => return Err(protocol()),
                }
            } else {
                match row["chatType"].as_str() {
                    Some("oneOnOne") => ChatKind::OneOnOne,
                    Some("group") => ChatKind::Group,
                    Some("meeting") => continue,
                    _ => return Err(protocol()),
                }
            };
            let id = ChatId::new(string(row, "id")?).map_err(|_| protocol())?;
            items.push(Chat {
                reference: self.conversation(backend, Conversation::Chat(id))?,
                kind,
            });
        }
        Ok(Page {
            items,
            next,
            raw_count: rows.len(),
        })
    }
    pub async fn teams(
        &self,
        cursor: Option<&Cursor>,
        ctx: &OperationContext,
    ) -> Result<Page<Team>> {
        let url = self.url(Backend::Graph, &["me", "joinedTeams"])?;
        let (value, next) = self.get_page(Backend::Graph, url, cursor, ctx).await?;
        let rows = rows(&value, "value")?;
        let items = rows
            .iter()
            .map(|v| {
                Ok(Team {
                    id: TeamId::new(string(v, "id")?).map_err(|_| protocol())?,
                })
            })
            .collect::<Result<_>>()?;
        Ok(Page {
            items,
            next,
            raw_count: rows.len(),
        })
    }
    /// Explicit backend choice; never falls back to Graph when MCP is unavailable.
    pub async fn teams_with_backend(
        &self,
        backend: Backend,
        cursor: Option<&Cursor>,
        ctx: &OperationContext,
    ) -> Result<Page<Team>> {
        self.enabled(backend)?;
        match backend {
            Backend::Graph => self.teams(cursor, ctx).await,
            Backend::Mcp => self.mcp_teams(cursor, ctx).await,
            Backend::Ic3 => Err(Error::new(ErrorCode::Unsupported)),
        }
    }
    pub async fn channels(
        &self,
        team: &TeamId,
        cursor: Option<&Cursor>,
        ctx: &OperationContext,
    ) -> Result<Page<Channel>> {
        let url = self.url(Backend::Graph, &["teams", team.as_str(), "channels"])?;
        let (value, next) = self.get_page(Backend::Graph, url, cursor, ctx).await?;
        let rows = rows(&value, "value")?;
        let items = rows
            .iter()
            .map(|v| {
                Ok(Channel {
                    reference: self.conversation(
                        Backend::Graph,
                        Conversation::Channel {
                            team: team.clone(),
                            channel: ChannelId::new(string(v, "id")?).map_err(|_| protocol())?,
                        },
                    )?,
                })
            })
            .collect::<Result<_>>()?;
        Ok(Page {
            items,
            next,
            raw_count: rows.len(),
        })
    }
    pub async fn channels_with_backend(
        &self,
        backend: Backend,
        team: &TeamId,
        cursor: Option<&Cursor>,
        ctx: &OperationContext,
    ) -> Result<Page<Channel>> {
        self.enabled(backend)?;
        match backend {
            Backend::Graph => self.channels(team, cursor, ctx).await,
            Backend::Mcp => self.mcp_channels(team, cursor, ctx).await,
            Backend::Ic3 => Err(Error::new(ErrorCode::Unsupported)),
        }
    }
    /// Transient history. System events count toward raw limits; edits and tombstones are retained.
    pub async fn history(
        &self,
        conversation: &ConversationRef,
        cursor: Option<&Cursor>,
        ctx: &OperationContext,
    ) -> Result<Page<MessageDetail>> {
        self.validate_ref(conversation)?;
        match conversation.backend {
            Backend::Ic3 => self.ic3_validate_chat(conversation, ctx).await?,
            Backend::Mcp => return self.mcp_history(conversation, cursor, ctx).await,
            Backend::Graph => {}
        }
        let mut url = self.message_url(conversation)?;
        url.query_pairs_mut().append_pair(
            if conversation.backend == Backend::Ic3 {
                "pageSize"
            } else {
                "$top"
            },
            "50",
        );
        let (value, next) = self
            .get_page(conversation.backend, url, cursor, ctx)
            .await?;
        let rows = rows(
            &value,
            if conversation.backend == Backend::Ic3 {
                "messages"
            } else {
                "value"
            },
        )?;
        let mut items = Vec::new();
        for row in rows {
            if let Some(item) = self.normalize(row, conversation)? {
                items.push(item);
            }
        }
        Ok(Page {
            items,
            next,
            raw_count: rows.len(),
        })
    }
    pub(crate) fn normalize(
        &self,
        value: &Value,
        reference: &ConversationRef,
    ) -> Result<Option<MessageDetail>> {
        match reference.backend {
            Backend::Ic3 => crate::ic3::normalize(value, reference, self),
            Backend::Graph | Backend::Mcp => normalize::graph(value, reference),
        }
    }
    pub async fn messages(
        &self,
        conversation: &ConversationRef,
        cursor: Option<&Cursor>,
        ctx: &OperationContext,
    ) -> Result<Page<MessageMetadata>> {
        let page = self.history(conversation, cursor, ctx).await?;
        Ok(Page {
            items: page.items.into_iter().map(|m| m.metadata).collect(),
            next: page.next,
            raw_count: page.raw_count,
        })
    }
    pub async fn detail(
        &self,
        reference: &MessageRef,
        ctx: &OperationContext,
    ) -> Result<MessageDetail> {
        self.validate_ref(&reference.conversation)?;
        match reference.conversation.backend {
            Backend::Ic3 => self.ic3_validate_chat(&reference.conversation, ctx).await?,
            Backend::Mcp => return self.mcp_detail(reference, ctx).await,
            Backend::Graph => {}
        }
        let mut url = self.message_url(&reference.conversation)?;
        url.path_segments_mut()
            .map_err(|_| protocol())?
            .push(reference.id.as_str());
        let value = self.get(reference.conversation.backend, url, ctx).await?;
        let detail = self
            .normalize(&value, &reference.conversation)?
            .ok_or_else(|| Error::new(ErrorCode::NotFound))?;
        if detail.metadata.reference.id != reference.id {
            return Err(protocol());
        }
        Ok(detail)
    }
    pub async fn participants(
        &self,
        conversation: &ConversationRef,
        cursor: Option<&Cursor>,
        ctx: &OperationContext,
    ) -> Result<Page<Participant>> {
        self.validate_ref(conversation)?;
        match conversation.backend {
            Backend::Ic3 => return self.ic3_participants(conversation, cursor, ctx).await,
            Backend::Mcp => return self.mcp_participants(conversation, cursor, ctx).await,
            Backend::Graph => {}
        }
        let url = match &conversation.conversation {
            Conversation::Chat(chat) => {
                self.url(Backend::Graph, &["chats", chat.as_str(), "members"])?
            }
            Conversation::Channel { team, channel }
            | Conversation::Replies { team, channel, .. } => self.url(
                Backend::Graph,
                &[
                    "teams",
                    team.as_str(),
                    "channels",
                    channel.as_str(),
                    "members",
                ],
            )?,
        };
        let (value, next) = self.get_page(Backend::Graph, url, cursor, ctx).await?;
        let rows = rows(&value, "value")?;
        Ok(Page {
            items: self.normalize_members(rows)?,
            next,
            raw_count: rows.len(),
        })
    }
    pub(crate) fn normalize_members(&self, rows: &[Value]) -> Result<Vec<Participant>> {
        rows.iter()
            .map(|row| {
                let user = UserId::new(string(row, "userId")?).map_err(|_| protocol())?;
                Ok(Participant {
                    is_self: user
                        .as_str()
                        .eq_ignore_ascii_case(self.account().user.as_str()),
                    user,
                    display_name: normalize::name(&row["displayName"]),
                })
            })
            .collect()
    }
    /// Complete only when all provider pages succeed within caps. Not a durable delta checkpoint.
    pub async fn scan_messages(
        &self,
        conversation: &ConversationRef,
        limits: ScanLimits,
        ctx: &OperationContext,
    ) -> Scan<MessageMetadata> {
        let ctx = ctx.bounded(Duration::from_secs(300));
        let mut items: Vec<MessageMetadata> = vec![];
        let mut cursor = None;
        let mut seen = HashSet::new();
        let mut raw_count = 0;
        let caps = ScanLimits {
            pages: limits.pages.min(100),
            entries: limits.entries.min(5000),
        };
        for _ in 0..caps.pages {
            let page = match self.messages(conversation, cursor.as_ref(), &ctx).await {
                Ok(page) => page,
                Err(reason) => return Scan::Incomplete { items, reason },
            };
            raw_count += page.raw_count;
            if raw_count > caps.entries {
                return Scan::Incomplete {
                    items,
                    reason: Error::new(ErrorCode::Limit),
                };
            }
            for item in page.items {
                if let Some(existing) = items
                    .iter_mut()
                    .find(|m| m.reference.id == item.reference.id)
                {
                    if existing.modified_at < item.modified_at
                        || existing.modified_at == item.modified_at && item.deleted
                    {
                        *existing = item;
                    }
                } else {
                    items.push(item);
                }
            }
            cursor = page.next;
            let Some(next) = &cursor else {
                return Scan::Complete(items);
            };
            if !seen.insert(next.url.as_str().to_owned()) {
                return Scan::Incomplete {
                    items,
                    reason: Error::new(ErrorCode::UnsafeCursor),
                };
            }
        }
        Scan::Incomplete {
            items,
            reason: Error::new(ErrorCode::Limit),
        }
    }
    pub async fn send(
        &self,
        destination: Destination,
        body: MessageBody,
        ctx: &OperationContext,
    ) -> Result<MessageRef> {
        body.validate()?;
        let backend = self
            .inner
            .config
            .routes
            .send(&destination)
            .ok_or_else(|| Error::new(ErrorCode::Unsupported))?;
        self.enabled(backend)?;
        let ctx = ctx.bounded(Duration::from_secs(10));
        self.check(&ctx)?;
        match backend {
            Backend::Mcp => return self.mcp_send(destination, body, &ctx).await,
            Backend::Ic3 => return self.ic3_send(destination, body, &ctx).await,
            Backend::Graph => {}
        }
        let conversation = match destination {
            Destination::SelfChat => return Err(Error::new(ErrorCode::Unsupported)),
            Destination::Chat(chat) => {
                if !body.mentions.is_empty() {
                    return Err(Error::new(ErrorCode::Unsupported));
                }
                Conversation::Chat(chat)
            }
            Destination::Channel { team, channel } => Conversation::Channel { team, channel },
        };
        let reference = self.conversation(backend, conversation)?;
        self.graph_write(reference, body, &ctx).await
    }
    pub async fn reply(
        &self,
        parent: &MessageRef,
        body: MessageBody,
        ctx: &OperationContext,
    ) -> Result<MessageRef> {
        self.validate_ref(&parent.conversation)?;
        body.validate()?;
        let backend = self
            .inner
            .config
            .routes
            .channel_reply
            .ok_or_else(|| Error::new(ErrorCode::Unsupported))?;
        if parent.conversation.backend != backend {
            return Err(Error::new(ErrorCode::Unsupported));
        }
        let (team, channel, root) = match &parent.conversation.conversation {
            Conversation::Channel { team, channel } => (team, channel, &parent.id),
            Conversation::Replies {
                team,
                channel,
                root,
            } => (team, channel, root),
            _ => return Err(Error::new(ErrorCode::Unsupported)),
        };
        let reference = self.conversation(
            backend,
            Conversation::Replies {
                team: team.clone(),
                channel: channel.clone(),
                root: root.clone(),
            },
        )?;
        let ctx = ctx.bounded(Duration::from_secs(10));
        match backend {
            Backend::Mcp => self.mcp_reply(reference, body, &ctx).await,
            Backend::Graph => self.graph_write(reference, body, &ctx).await,
            Backend::Ic3 => Err(Error::new(ErrorCode::Unsupported)),
        }
    }
    async fn graph_write(
        &self,
        reference: ConversationRef,
        body: MessageBody,
        ctx: &OperationContext,
    ) -> Result<MessageRef> {
        let url = self.message_url(&reference)?;
        let response = self
            .request(
                Backend::Graph,
                Method::POST,
                url,
                Some(graph_body(&body)),
                HeaderMap::new(),
                true,
                ctx,
            )
            .await?;
        let value: Value = serde_json::from_slice(&response.body)
            .map_err(|_| protocol().delivery(Delivery::Unknown))?;
        let id = string(&value, "id")
            .and_then(MessageId::new)
            .map_err(|_| protocol().delivery(Delivery::Unknown))?;
        Ok(MessageRef {
            conversation: reference,
            id,
        })
    }
    pub async fn like(&self, message: &MessageRef, ctx: &OperationContext) -> Result<()> {
        self.validate_ref(&message.conversation)?;
        if matches!(message.conversation.conversation, Conversation::Chat(_)) {
            return Err(Error::new(ErrorCode::Unsupported));
        }
        let backend = self
            .inner
            .config
            .routes
            .channel_like
            .ok_or_else(|| Error::new(ErrorCode::Unsupported))?;
        self.enabled(backend)?;
        let ctx = ctx.bounded(Duration::from_secs(10));
        match backend {
            Backend::Ic3 => return self.ic3_like(message, &ctx).await,
            Backend::Mcp => return Err(Error::new(ErrorCode::Unsupported)),
            Backend::Graph => {}
        }
        if message.conversation.backend != backend {
            return Err(Error::new(ErrorCode::Unsupported));
        }
        let mut url = self.message_url(&message.conversation)?;
        url.path_segments_mut()
            .map_err(|_| protocol())?
            .extend([message.id.as_str(), "setReaction"]);
        self.request(
            backend,
            Method::POST,
            url,
            Some(json!({"reactionType":"👍"})),
            HeaderMap::new(),
            true,
            &ctx,
        )
        .await?;
        Ok(())
    }
}
fn cursor_segments(path: &str) -> Result<Vec<String>> {
    path.split('/')
        .map(|segment| {
            let bytes = segment.as_bytes();
            for (i, byte) in bytes.iter().enumerate() {
                if *byte == b'%'
                    && (i + 2 >= bytes.len()
                        || !bytes[i + 1].is_ascii_hexdigit()
                        || !bytes[i + 2].is_ascii_hexdigit())
                {
                    return Err(Error::new(ErrorCode::UnsafeCursor));
                }
            }
            let decoded = percent_encoding::percent_decode_str(segment)
                .decode_utf8()
                .map_err(|_| Error::new(ErrorCode::UnsafeCursor))?;
            if decoded == "."
                || decoded == ".."
                || decoded
                    .chars()
                    .any(|c| c.is_control() || "/\\%".contains(c))
            {
                return Err(Error::new(ErrorCode::UnsafeCursor));
            }
            Ok(decoded.into_owned())
        })
        .collect()
}
pub(crate) fn rows<'a>(value: &'a Value, key: &str) -> Result<&'a [Value]> {
    let rows = value
        .get(key)
        .and_then(Value::as_array)
        .ok_or_else(protocol)?;
    if rows.len() > 200 {
        return Err(Error::new(ErrorCode::Limit));
    }
    Ok(rows)
}
pub(crate) fn graph_body(body: &MessageBody) -> Value {
    json!({"body":{"content":body.content, "contentType": if body.content_type == ContentType::Text { "text" } else { "html" }},
        "mentions":body.mentions.iter().enumerate().map(|(i,m)| json!({"id":i,"mentionText":m.display_name,
            "mentioned":{"user":{"id":m.user.as_str(),"displayName":m.display_name}}})).collect::<Vec<_>>()})
}
