//! Optional Microsoft Teams MCP HTTP transport. Graph-only applications do not require MCP.
use crate::{
    http::HttpResponse,
    normalize::{protocol, string},
    session::graph_body,
    *,
};
use reqwest::{
    header::{HeaderMap, HeaderValue},
    Method,
};
use serde_json::{json, Value};
use std::collections::HashSet;
use url::Url;

#[derive(Default)]
pub(crate) struct State {
    session_id: Option<String>,
    version: Option<String>,
    tools: HashSet<String>,
}
impl Session {
    fn mcp_url(&self) -> Result<Url> {
        Url::parse(&crate::auth::Audience::TeamsMcp.resource(self.account()))
            .map_err(|_| protocol())
    }
    async fn mcp_rpc(
        &self,
        state: &mut State,
        method: &str,
        params: Value,
        write: bool,
        ctx: &OperationContext,
    ) -> Result<Value> {
        let mut headers = HeaderMap::new();
        headers.insert(
            "accept",
            HeaderValue::from_static("application/json, text/event-stream"),
        );
        if let Some(id) = &state.session_id {
            let mut header = HeaderValue::from_str(id).map_err(|_| protocol())?;
            header.set_sensitive(true);
            headers.insert("mcp-session-id", header);
        }
        if let Some(version) = &state.version {
            headers.insert(
                "mcp-protocol-version",
                HeaderValue::from_str(version).map_err(|_| protocol())?,
            );
        }
        let notification = method == "notifications/initialized";
        let id = uuid::Uuid::new_v4().to_string();
        let mut payload = json!({"jsonrpc":"2.0","method":method,"params":params});
        if !notification {
            payload["id"] = json!(id);
        }
        let response = self
            .request(
                Backend::Mcp,
                Method::POST,
                self.mcp_url()?,
                Some(payload),
                headers,
                write,
                ctx,
            )
            .await?;
        if let Some(value) = response.headers.get("mcp-session-id") {
            let id = value.to_str().map_err(|_| protocol())?;
            if id.is_empty() || id.len() > 4096 {
                return Err(protocol());
            }
            state.session_id = Some(id.to_owned());
        }
        if notification {
            return Ok(Value::Null);
        }
        let value = rpc_response(response, &id).map_err(|e| {
            if write {
                e.delivery(Delivery::Unknown)
            } else {
                e
            }
        })?;
        if value.get("error").is_some() {
            return Err(Error::new(ErrorCode::Rejected).delivery(if write {
                Delivery::Unknown
            } else {
                Delivery::NotAttempted
            }));
        }
        value.get("result").cloned().ok_or_else(|| {
            protocol().delivery(if write {
                Delivery::Unknown
            } else {
                Delivery::NotAttempted
            })
        })
    }
    async fn mcp_initialize(&self, state: &mut State, ctx: &OperationContext) -> Result<()> {
        *state = State::default();
        let ready = self.mcp_initialize_state(ctx).await?;
        self.check(ctx)?;
        *state = ready;
        Ok(())
    }
    async fn mcp_initialize_state(&self, ctx: &OperationContext) -> Result<State> {
        let mut pending = State::default();
        let state = &mut pending;
        let result = self
            .mcp_rpc(
                state,
                "initialize",
                json!({"protocolVersion":"2025-03-26","capabilities":{},
            "clientInfo":{"name":"teams-sdk","version":"0.1.0"}}),
                false,
                ctx,
            )
            .await?;
        let version = string(&result, "protocolVersion")?;
        if !["2025-03-26", "2025-06-18", "2024-11-05"].contains(&version) {
            return Err(protocol());
        }
        state.version = Some(version.to_owned());
        self.mcp_rpc(state, "notifications/initialized", json!({}), false, ctx)
            .await?;
        let mut cursor = None;
        let mut seen = HashSet::new();
        for _ in 0..20 {
            let params = cursor
                .as_ref()
                .map_or_else(|| json!({}), |cursor| json!({"cursor":cursor}));
            let result = self
                .mcp_rpc(state, "tools/list", params, false, ctx)
                .await?;
            let tools = result["tools"].as_array().ok_or_else(protocol)?;
            if state.tools.len() + tools.len() > 1000 {
                return Err(Error::new(ErrorCode::Limit));
            }
            for tool in tools {
                state.tools.insert(string(tool, "name")?.to_owned());
            }
            match result.get("nextCursor").filter(|v| !v.is_null()) {
                None => return Ok(pending),
                Some(value) => {
                    let next = value
                        .as_str()
                        .filter(|s| !s.is_empty() && s.len() < 16 * 1024)
                        .ok_or_else(protocol)?;
                    if !seen.insert(next.to_owned()) {
                        return Err(Error::new(ErrorCode::UnsafeCursor));
                    }
                    cursor = Some(next.to_owned());
                }
            }
        }
        Err(Error::new(ErrorCode::Limit))
    }
    pub(crate) async fn mcp_tool(
        &self,
        name: &str,
        args: Value,
        write: bool,
        ctx: &OperationContext,
    ) -> Result<Value> {
        self.enabled(Backend::Mcp)?;
        let mut state = self
            .wait(ctx, false, async { Ok(self.inner.mcp.lock().await) })
            .await?;
        if state.version.is_none() {
            self.mcp_initialize(&mut state, ctx).await?;
        }
        for attempt in 0..2 {
            if !state.tools.contains(name) {
                return Err(Error::new(ErrorCode::Unsupported));
            }
            let result = self
                .mcp_rpc(
                    &mut state,
                    "tools/call",
                    json!({"name":name,"arguments":args}),
                    write,
                    ctx,
                )
                .await;
            let result = match result {
                Err(error) if !write && error.status == Some(404) && attempt == 0 => {
                    self.mcp_initialize(&mut state, ctx).await?;
                    continue;
                }
                result => result?,
            };
            if result["isError"] == true {
                return Err(Error::new(ErrorCode::Rejected).delivery(if write {
                    Delivery::Rejected
                } else {
                    Delivery::NotAttempted
                }));
            }
            let parse = || -> Result<Value> {
                if let Some(value) = result.get("structuredContent") {
                    if !value.is_object() {
                        return Err(protocol());
                    }
                    return Ok(value.clone());
                }
                let content = result["content"].as_array().ok_or_else(protocol)?;
                if !(1..=2).contains(&content.len())
                    || content[0]["type"] != "text"
                    || (content.len() == 2 && !correlation_trailer(&content[1]))
                {
                    return Err(protocol());
                }
                let text = content[0]["text"].as_str().ok_or_else(protocol)?;
                if text.starts_with("Error:") {
                    return Err(Error::new(ErrorCode::Rejected).delivery(Delivery::Rejected));
                }
                serde_json::from_str(text).map_err(|_| protocol())
            };
            return parse().map_err(|e| {
                if write && e.code == ErrorCode::Protocol {
                    e.delivery(Delivery::Unknown)
                } else {
                    e
                }
            });
        }
        Err(protocol())
    }
    fn mcp_args(&self, reference: &ConversationRef) -> Result<Value> {
        self.validate_ref(reference)?;
        Ok(match &reference.conversation {
            Conversation::Chat(chat) => json!({"chatId":chat.as_str()}),
            Conversation::Channel { team, channel } => {
                json!({"teamId":team.as_str(),"channelId":channel.as_str()})
            }
            Conversation::Replies {
                team,
                channel,
                root,
            } => {
                json!({"teamId":team.as_str(),"channelId":channel.as_str(),"messageId":root.as_str()})
            }
        })
    }
    fn mcp_collection(&self, reference: &ConversationRef, members: bool) -> Result<Url> {
        // MCP pagination may only forward the corresponding public Graph collection URL.
        let mut url = Url::parse(crate::constants::GRAPH_API_BASE).map_err(|_| protocol())?;
        let mut path = url.path_segments_mut().map_err(|_| protocol())?;
        match &reference.conversation {
            Conversation::Chat(chat) => {
                path.extend([
                    "chats",
                    chat.as_str(),
                    if members { "members" } else { "messages" },
                ]);
            }
            Conversation::Channel { team, channel } => {
                path.extend([
                    "teams",
                    team.as_str(),
                    "channels",
                    channel.as_str(),
                    if members { "members" } else { "messages" },
                ]);
            }
            Conversation::Replies {
                team,
                channel,
                root,
            } if !members => {
                path.extend([
                    "teams",
                    team.as_str(),
                    "channels",
                    channel.as_str(),
                    "messages",
                    root.as_str(),
                    "replies",
                ]);
            }
            _ => return Err(Error::new(ErrorCode::Unsupported)),
        }
        drop(path);
        Ok(url)
    }
    fn mcp_cursor_arg(
        &self,
        args: &mut Value,
        collection: &Url,
        cursor: Option<&Cursor>,
    ) -> Result<()> {
        if let Some(cursor) = cursor {
            if cursor.generation != self.inner.generation
                || cursor.backend != Backend::Mcp
                || cursor.collection != collection.path()
            {
                return Err(Error::new(ErrorCode::UnsafeCursor));
            }
            self.page_cursor(Backend::Mcp, collection, Some(cursor.url.as_str()))?;
            args["nextLink"] = json!(cursor.url.as_str());
        }
        Ok(())
    }
    fn mcp_next(&self, result: &Value, collection: &Url) -> Result<Option<Cursor>> {
        let next = result
            .get("nextLink")
            .or_else(|| result.get("@odata.nextLink"));
        if next.is_some_and(|n| !n.is_null() && !n.is_string()) {
            return Err(protocol());
        }
        let cursor = self.page_cursor(Backend::Mcp, collection, next.and_then(Value::as_str))?;
        if result["hasMoreResults"] == true && cursor.is_none() {
            return Err(Error::new(ErrorCode::Limit));
        }
        Ok(cursor)
    }
    pub(crate) async fn mcp_chats(
        &self,
        cursor: Option<&Cursor>,
        ctx: &OperationContext,
    ) -> Result<Page<Chat>> {
        if cursor.is_some() {
            return Err(Error::new(ErrorCode::Unsupported));
        }
        let result = self
            .mcp_tool("ListChats", json!({"fetchAllPages":true}), false, ctx)
            .await?;
        if result["hasMoreResults"] == true {
            return Err(Error::new(ErrorCode::Limit));
        }
        let rows = tool_rows(&result, "chats", 5000)?;
        let mut items = vec![];
        for row in rows {
            let chat = ChatId::new(string(row, "id")?).map_err(|_| protocol())?;
            let info = if row["chatType"].is_null() {
                self.mcp_tool("GetChat", json!({"chatId":chat.as_str()}), false, ctx)
                    .await?
            } else {
                row.clone()
            };
            if info["id"].as_str() != Some(chat.as_str()) {
                return Err(protocol());
            }
            let kind = match info["chatType"].as_str() {
                Some("oneOnOne" | "OneOnOne") => ChatKind::OneOnOne,
                Some("group" | "Group") => ChatKind::Group,
                Some("meeting") => continue,
                _ => return Err(protocol()),
            };
            items.push(Chat {
                reference: self.conversation(Backend::Mcp, Conversation::Chat(chat))?,
                kind,
            });
        }
        Ok(Page {
            items,
            next: None,
            raw_count: rows.len(),
        })
    }
    pub(crate) async fn mcp_history(
        &self,
        reference: &ConversationRef,
        cursor: Option<&Cursor>,
        ctx: &OperationContext,
    ) -> Result<Page<MessageDetail>> {
        let collection = self.mcp_collection(reference, false)?;
        let mut args = self.mcp_args(reference)?;
        args["top"] = json!(50);
        self.mcp_cursor_arg(&mut args, &collection, cursor)?;
        let tool = match reference.conversation {
            Conversation::Chat(_) => "ListChatMessages",
            Conversation::Channel { .. } => "ListChannelMessages",
            Conversation::Replies { .. } => "ListChannelMessageReplies",
        };
        if matches!(reference.conversation, Conversation::Replies { .. }) {
            args.as_object_mut().ok_or_else(protocol)?.remove("top");
            args["maxReplies"] = json!(50);
        }
        let result = self.mcp_tool(tool, args, false, ctx).await?;
        let next = self.mcp_next(&result, &collection)?;
        let collection_key = if matches!(reference.conversation, Conversation::Replies { .. }) {
            "replies"
        } else {
            "messages"
        };
        let rows = tool_rows(&result, collection_key, 200)?;
        let mut items = vec![];
        for row in rows {
            if let Some(item) = self.normalize(row, reference)? {
                items.push(item);
            }
        }
        Ok(Page {
            items,
            next,
            raw_count: rows.len(),
        })
    }
    pub(crate) async fn mcp_detail(
        &self,
        reference: &MessageRef,
        ctx: &OperationContext,
    ) -> Result<MessageDetail> {
        if !matches!(reference.conversation.conversation, Conversation::Chat(_)) {
            let mut cursor = None;
            let mut seen = HashSet::new();
            let mut count = 0;
            for _ in 0..100 {
                let page = self
                    .mcp_history(&reference.conversation, cursor.as_ref(), ctx)
                    .await?;
                count += page.raw_count;
                if count > 5000 {
                    return Err(Error::new(ErrorCode::Limit));
                }
                if let Some(detail) = page
                    .items
                    .into_iter()
                    .find(|m| m.metadata.reference.id == reference.id)
                {
                    return Ok(detail);
                }
                cursor = page.next;
                let Some(next) = &cursor else {
                    return Err(Error::new(ErrorCode::NotFound));
                };
                if !seen.insert(next.url.as_str().to_owned()) {
                    return Err(Error::new(ErrorCode::UnsafeCursor));
                }
            }
            return Err(Error::new(ErrorCode::Limit));
        }
        let mut args = self.mcp_args(&reference.conversation)?;
        args["messageId"] = json!(reference.id.as_str());
        let result = self.mcp_tool("GetChatMessage", args, false, ctx).await?;
        let detail = self
            .normalize(&result, &reference.conversation)?
            .ok_or_else(|| Error::new(ErrorCode::NotFound))?;
        if detail.metadata.reference.id != reference.id {
            return Err(protocol());
        }
        Ok(detail)
    }
    pub(crate) async fn mcp_teams(
        &self,
        cursor: Option<&Cursor>,
        ctx: &OperationContext,
    ) -> Result<Page<Team>> {
        if cursor.is_some() {
            return Err(Error::new(ErrorCode::Unsupported));
        }
        let result = self.mcp_tool("ListTeams", json!({}), false, ctx).await?;
        if result["hasMoreResults"] == true || result.get("nextLink").is_some_and(|v| !v.is_null())
        {
            return Err(Error::new(ErrorCode::Limit));
        }
        let rows = tool_rows(&result, "teams", 200)?;
        let items = rows
            .iter()
            .map(|row| {
                Ok(Team {
                    id: TeamId::new(string(row, "id")?).map_err(|_| protocol())?,
                })
            })
            .collect::<Result<_>>()?;
        Ok(Page {
            items,
            next: None,
            raw_count: rows.len(),
        })
    }
    pub(crate) async fn mcp_channels(
        &self,
        team: &TeamId,
        cursor: Option<&Cursor>,
        ctx: &OperationContext,
    ) -> Result<Page<Channel>> {
        if cursor.is_some() {
            return Err(Error::new(ErrorCode::Unsupported));
        }
        let result = self
            .mcp_tool("ListChannels", json!({"teamId":team.as_str()}), false, ctx)
            .await?;
        if result["hasMoreResults"] == true || result.get("nextLink").is_some_and(|v| !v.is_null())
        {
            return Err(Error::new(ErrorCode::Limit));
        }
        let rows = tool_rows(&result, "channels", 200)?;
        let items = rows
            .iter()
            .map(|row| {
                Ok(Channel {
                    reference: self.conversation(
                        Backend::Mcp,
                        Conversation::Channel {
                            team: team.clone(),
                            channel: ChannelId::new(string(row, "id")?).map_err(|_| protocol())?,
                        },
                    )?,
                })
            })
            .collect::<Result<_>>()?;
        Ok(Page {
            items,
            next: None,
            raw_count: rows.len(),
        })
    }
    pub(crate) async fn mcp_participants(
        &self,
        reference: &ConversationRef,
        cursor: Option<&Cursor>,
        ctx: &OperationContext,
    ) -> Result<Page<Participant>> {
        let collection = self.mcp_collection(reference, true)?;
        let mut args = self.mcp_args(reference)?;
        self.mcp_cursor_arg(&mut args, &collection, cursor)?;
        let tool = if matches!(reference.conversation, Conversation::Chat(_)) {
            "ListChatMembers"
        } else {
            "ListChannelMembers"
        };
        let result = self.mcp_tool(tool, args, false, ctx).await?;
        let next = self.mcp_next(&result, &collection)?;
        let rows = tool_rows(&result, "members", 200)?;
        Ok(Page {
            items: self.normalize_members(rows)?,
            next,
            raw_count: rows.len(),
        })
    }
    pub(crate) async fn mcp_send(
        &self,
        destination: Destination,
        body: MessageBody,
        ctx: &OperationContext,
    ) -> Result<MessageRef> {
        let (tool, mut args, conversation) = match destination {
            Destination::SelfChat => ("SendMessageToSelf", json!({}), None),
            Destination::Chat(chat) => (
                "SendMessageToChat",
                json!({"chatId":chat.as_str()}),
                Some(Conversation::Chat(chat)),
            ),
            Destination::Channel { team, channel } => (
                "SendMessageToChannel",
                json!({"teamId":team.as_str(),"channelId":channel.as_str()}),
                Some(Conversation::Channel { team, channel }),
            ),
        };
        set_body(&mut args, &body);
        let result = self.mcp_tool(tool, args, true, ctx).await?;
        let conversation = match conversation {
            Some(conversation) => conversation,
            None => Conversation::Chat(
                ChatId::new(
                    string(&result, "chatId")
                        .map_err(|_| protocol().delivery(Delivery::Unknown))?,
                )
                .map_err(|_| protocol().delivery(Delivery::Unknown))?,
            ),
        };
        self.mcp_receipt(self.conversation(Backend::Mcp, conversation)?, result)
    }
    pub(crate) async fn mcp_reply(
        &self,
        reference: ConversationRef,
        body: MessageBody,
        ctx: &OperationContext,
    ) -> Result<MessageRef> {
        let mut args = self.mcp_args(&reference)?;
        set_body(&mut args, &body);
        let result = self
            .mcp_tool("ReplyToChannelMessage", args, true, ctx)
            .await?;
        self.mcp_receipt(reference, result)
    }
    fn mcp_receipt(&self, reference: ConversationRef, result: Value) -> Result<MessageRef> {
        let id = result
            .get("messageId")
            .or_else(|| result.get("id"))
            .and_then(Value::as_str)
            .ok_or_else(|| protocol().delivery(Delivery::Unknown))?;
        Ok(MessageRef {
            conversation: reference,
            id: MessageId::new(id).map_err(|_| protocol().delivery(Delivery::Unknown))?,
        })
    }
}
fn set_body(args: &mut Value, body: &MessageBody) {
    args["content"] = json!(body.content.replace('\\', "\\\\"));
    args["contentType"] = json!(if body.content_type == ContentType::Text {
        "text"
    } else {
        "html"
    });
    if !body.mentions.is_empty() {
        args["mentions"] = graph_body(body)["mentions"].clone();
    }
}
fn correlation_trailer(value: &Value) -> bool {
    if value["type"] != "text" {
        return false;
    }
    let Some(text) = value["text"].as_str().filter(|s| s.len() <= 128) else {
        return false;
    };
    let Some(text) = text.trim_end().strip_prefix("CorrelationId: ") else {
        return false;
    };
    let Some((id, timestamp)) = text.split_once(", TimeStamp: ") else {
        return false;
    };
    uuid::Uuid::parse_str(id).is_ok()
        && chrono::NaiveDateTime::parse_from_str(timestamp, "%Y-%m-%d_%H:%M:%S").is_ok()
}
fn tool_rows<'a>(result: &'a Value, key: &str, cap: usize) -> Result<&'a [Value]> {
    let rows = result
        .as_array()
        .or_else(|| result.get(key).and_then(Value::as_array))
        .or_else(|| result.get("value").and_then(Value::as_array))
        .ok_or_else(protocol)?;
    if rows.len() > cap {
        return Err(Error::new(ErrorCode::Limit));
    }
    Ok(rows)
}
fn rpc_response(response: HttpResponse, id: &str) -> Result<Value> {
    let is_sse = response
        .headers
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .is_some_and(|s| s.starts_with("text/event-stream"));
    let value: Value = if is_sse {
        let text = std::str::from_utf8(&response.body)
            .map_err(|_| protocol())?
            .replace("\r\n", "\n");
        let mut matched = None;
        for event in text.split("\n\n") {
            let data = event
                .lines()
                .filter_map(|line| {
                    line.strip_prefix("data:")
                        .map(|s| s.strip_prefix(' ').unwrap_or(s))
                })
                .collect::<Vec<_>>()
                .join("\n");
            if data.is_empty() {
                continue;
            }
            let value: Value = serde_json::from_str(&data).map_err(|_| protocol())?;
            if value["id"].as_str() == Some(id) {
                if matched.is_some() {
                    return Err(protocol());
                }
                matched = Some(value);
            }
        }
        matched.ok_or_else(protocol)?
    } else {
        serde_json::from_slice(&response.body).map_err(|_| protocol())?
    };
    if value["jsonrpc"] != "2.0" || value["id"].as_str() != Some(id) {
        return Err(protocol());
    }
    Ok(value)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn sse_requires_matching_rpc_id_and_rejects_duplicate_results() {
        let response = |body: String| {
            let mut headers = HeaderMap::new();
            headers.insert("content-type", "text/event-stream".parse().unwrap());
            HttpResponse {
                status: 200,
                headers,
                body: body.into_bytes(),
            }
        };
        let event = "data: {\"jsonrpc\":\"2.0\",\r\ndata: \"id\":\"request\",\"result\":{\"tools\":[]}}\r\n\r\n";
        let value = rpc_response(response(event.into()), "request").unwrap();
        assert!(value["result"]["tools"].is_array());
        assert!(rpc_response(response(event.repeat(2)), "request").is_err());
        assert!(rpc_response(response(event.into()), "other").is_err());
        assert!(rpc_response(response("data: not-json\n\n".into()), "request").is_err());
    }
    #[test]
    fn only_the_bounded_agent365_correlation_trailer_is_ignored() {
        assert!(correlation_trailer(
            &json!({"type":"text","text":"CorrelationId: 00000000-0000-0000-0000-000000000001, TimeStamp: 2026-01-01_00:00:00"})
        ));
        assert!(!correlation_trailer(
            &json!({"type":"text","text":"{\"second\":\"payload\"}"})
        ));
        assert!(!correlation_trailer(
            &json!({"type":"text","text":"CorrelationId: invalid, TimeStamp: invalid"})
        ));
    }
}
