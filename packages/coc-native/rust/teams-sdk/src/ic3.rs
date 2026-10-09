//! Experimental private chatsvc API. Regions are explicit; requests never cross regions.
use crate::{
    constants::ic3::{CHAT_ID_PREFIX, CHAT_ID_SUFFIX, ROSTER_VIEW, SELF_CHAT_ID},
    normalize::{self, protocol, string},
    session::OperationContext,
    *,
};
use async_trait::async_trait;
use chrono::Utc;
use reqwest::{header::HeaderMap, Method};
use serde_json::{json, Value};
use std::time::Duration;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Region {
    Americas,
    EuropeMiddleEastAfrica,
    AsiaPacific,
}
impl Region {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Americas => "amer",
            Self::EuropeMiddleEastAfrica => "emea",
            Self::AsiaPacific => "apac",
        }
    }
}
pub struct VerifiedChat {
    pub account: Account,
    pub chat: ChatId,
    pub kind: ChatKind,
    pub members: Vec<UserId>,
    pub complete: bool,
}
/// Trusted authority adapter. Implement using actual GetChat and complete membership reads,
/// never message authors, cached inference, or identifier naming conventions.
#[async_trait]
pub trait ChatVerifier: Send + Sync {
    async fn verify(&self, account: &Account, chat: &ChatId) -> Result<VerifiedChat>;
}
impl Session {
    pub(crate) async fn ic3_participants(
        &self,
        reference: &ConversationRef,
        cursor: Option<&Cursor>,
        ctx: &OperationContext,
    ) -> Result<Page<Participant>> {
        let Conversation::Chat(chat) = &reference.conversation else {
            return Err(Error::new(ErrorCode::Unsupported));
        };
        if cursor.is_some() {
            return Err(Error::new(ErrorCode::UnsafeCursor));
        }
        self.ic3_validate_chat(reference, ctx).await?;
        let mut url = self.url(Backend::Ic3, &[])?;
        url.path_segments_mut()
            .map_err(|_| protocol())?
            .pop_if_empty()
            .pop()
            .pop()
            .extend(["threads", chat.as_str()]);
        url.query_pairs_mut().append_pair("view", ROSTER_VIEW);
        let value = self.get(Backend::Ic3, url, ctx).await?;
        if value["id"].as_str() != Some(chat.as_str())
            || value["properties"]["threadType"].as_str() != Some("chat")
        {
            return Err(protocol());
        }
        if ["nextLink", "@odata.nextLink", "continuationToken"]
            .iter()
            .any(|key| !value[*key].is_null())
            || [
                "nextLink",
                "forwardLink",
                "backwardLink",
                "continuationToken",
            ]
            .iter()
            .any(|key| !value["_metadata"][*key].is_null())
        {
            return Err(Error::new(ErrorCode::Limit));
        }
        let rows = crate::session::rows(&value, "members")?;
        let mut users = std::collections::HashSet::new();
        let mut items = Vec::with_capacity(rows.len());
        for row in rows {
            let id = string(row, "id")?;
            let id = id
                .strip_prefix("8:orgid:")
                .ok_or_else(|| Error::new(ErrorCode::Unsupported))?;
            let user = UserId::new(id).map_err(|_| protocol())?;
            if !users.insert(user.as_str().to_ascii_lowercase()) {
                return Err(protocol());
            }
            items.push(Participant {
                is_self: user
                    .as_str()
                    .eq_ignore_ascii_case(self.account().user.as_str()),
                user,
                display_name: normalize::name(&row["friendlyName"]),
            });
        }
        Ok(Page {
            items,
            next: None,
            raw_count: rows.len(),
        })
    }

    pub(crate) async fn ic3_validate_chat(
        &self,
        reference: &ConversationRef,
        ctx: &OperationContext,
    ) -> Result<()> {
        let Conversation::Chat(chat) = &reference.conversation else {
            return Err(Error::new(ErrorCode::Unsupported));
        };
        let url = self.url(Backend::Ic3, &["conversations", chat.as_str()])?;
        let info = self.get(Backend::Ic3, url, ctx).await?;
        if info["id"].as_str() != Some(chat.as_str()) {
            return Err(protocol());
        }
        if info["threadProperties"]["threadType"].as_str() != Some("chat")
            || !matches!(
                info["threadProperties"]["productThreadType"].as_str(),
                Some("OneToOneChat" | "Chat")
            )
        {
            return Err(Error::new(ErrorCode::Unsupported));
        }
        Ok(())
    }
    /// Explicit intended-recipient contract for private-protocol 1:1 writes.
    pub async fn send_to_existing_one_on_one(
        &self,
        chat: ChatId,
        recipient: UserId,
        body: MessageBody,
        ctx: &OperationContext,
    ) -> Result<MessageRef> {
        if self.inner.config.routes.chat_send != Some(Backend::Ic3) {
            return Err(Error::new(ErrorCode::Unsupported));
        }
        self.enabled(Backend::Ic3)?;
        body.validate()?;
        if !body.mentions.is_empty()
            || !chat.as_str().starts_with(CHAT_ID_PREFIX)
            || !chat.as_str().ends_with(CHAT_ID_SUFFIX)
            || chat
                .as_str()
                .chars()
                .any(|c| c.is_whitespace() || "/\\?#".contains(c))
            || recipient
                .as_str()
                .eq_ignore_ascii_case(self.account().user.as_str())
        {
            return Err(Error::new(ErrorCode::InvalidTarget));
        }
        let verifier = self
            .inner
            .config
            .verifier
            .as_ref()
            .ok_or_else(|| Error::new(ErrorCode::Unsupported))?;
        let ctx = ctx.bounded(Duration::from_secs(10));
        let verified = self
            .wait(&ctx, false, verifier.verify(self.account(), &chat))
            .await?;
        if !verified.account.matches(self.account())
            || verified.chat != chat
            || verified.kind != ChatKind::OneOnOne
            || !verified.complete
            || verified.members.len() != 2
            || !verified.members.iter().any(|id| {
                id.as_str()
                    .eq_ignore_ascii_case(self.account().user.as_str())
            })
            || !verified
                .members
                .iter()
                .any(|id| id.as_str().eq_ignore_ascii_case(recipient.as_str()))
        {
            return Err(Error::new(ErrorCode::InvalidTarget));
        }
        self.ic3_write(chat, body, &ctx).await
    }
    pub(crate) async fn ic3_send(
        &self,
        destination: Destination,
        body: MessageBody,
        ctx: &OperationContext,
    ) -> Result<MessageRef> {
        if !matches!(destination, Destination::SelfChat) || !body.mentions.is_empty() {
            return Err(Error::new(ErrorCode::Unsupported));
        }
        self.ic3_write(ChatId::new(SELF_CHAT_ID)?, body, ctx).await
    }
    async fn ic3_write(
        &self,
        chat: ChatId,
        body: MessageBody,
        ctx: &OperationContext,
    ) -> Result<MessageRef> {
        let reference = self.conversation(Backend::Ic3, Conversation::Chat(chat.clone()))?;
        let url = self.message_url(&reference)?;
        let sender = format!("8:orgid:{}", self.account().user.as_str());
        let now = Utc::now().to_rfc3339();
        let content = if body.content_type == ContentType::Html {
            body.content
        } else {
            html_escape::encode_safe(&body.content).replace('\n', "<br>")
        };
        let payload = json!({
            "id":"-1", "type":"Message", "conversationid":chat.as_str(),
            "conversationLink":format!("blah/{}", chat.as_str()), "from":sender, "fromUserId":sender,
            "composetime":now, "originalarrivaltime":now, "content":content, "messagetype":"RichText/Html",
            "contenttype":"Text", "clientmessageid":(uuid::Uuid::new_v4().as_u128() as u64 & 0x7fff_ffff_ffff_ffff).to_string(),
            "callId":"", "state":0, "version":"0", "amsreferences":[],
            "properties":{"importance":"","subject":"","title":"","cards":"[]","links":"[]","mentions":"[]",
                "onbehalfof":null,"files":"[]","policyViolation":null,"formatVariant":"TEAMS"}
        });
        let mut headers = HeaderMap::new();
        headers.insert(
            "behavioroverride",
            "redirectAs404".parse().expect("static header"),
        );
        let response = self
            .request(
                Backend::Ic3,
                Method::POST,
                url,
                Some(payload),
                headers,
                true,
                ctx,
            )
            .await?;
        let result: Value = serde_json::from_slice(&response.body)
            .map_err(|_| protocol().delivery(Delivery::Unknown))?;
        let arrival = &result["OriginalArrivalTime"];
        let id = if let Some(id) = arrival
            .as_str()
            .filter(|s| !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit()))
        {
            id.to_owned()
        } else if let Some(id) = arrival.as_u64().filter(|n| *n <= 9_007_199_254_740_991) {
            id.to_string()
        } else {
            return Err(protocol().delivery(Delivery::Unknown));
        };
        Ok(MessageRef {
            conversation: reference,
            id: MessageId::new(id).map_err(|_| protocol().delivery(Delivery::Unknown))?,
        })
    }
    pub(crate) async fn ic3_like(
        &self,
        message: &MessageRef,
        ctx: &OperationContext,
    ) -> Result<()> {
        let channel = match &message.conversation.conversation {
            Conversation::Channel { channel, .. } | Conversation::Replies { channel, .. } => {
                channel
            }
            _ => return Err(Error::new(ErrorCode::Unsupported)),
        };
        let mut url = self.url(
            Backend::Ic3,
            &[
                "conversations",
                channel.as_str(),
                "messages",
                message.id.as_str(),
                "properties",
            ],
        )?;
        url.query_pairs_mut().append_pair("name", "emotions");
        let mut headers = HeaderMap::new();
        headers.insert(
            "behavioroverride",
            "redirectAs404".parse().expect("static header"),
        );
        self.request(
            Backend::Ic3,
            Method::PUT,
            url,
            Some(json!({"emotions":{"key":"like","value":Utc::now().timestamp_millis()}})),
            headers,
            true,
            ctx,
        )
        .await?;
        Ok(())
    }
}
pub(crate) fn normalize(
    raw: &Value,
    reference: &ConversationRef,
    session: &Session,
) -> Result<Option<MessageDetail>> {
    let Conversation::Chat(chat) = &reference.conversation else {
        return Err(Error::new(ErrorCode::Unsupported));
    };
    if raw["conversationid"].as_str() != Some(chat.as_str()) {
        return Err(protocol());
    }
    let id = string(raw, "id")?;
    let version = raw["version"]
        .as_i64()
        .or_else(|| raw["version"].as_str().and_then(|s| s.parse().ok()))
        .filter(|n| *n > 0)
        .ok_or_else(protocol)?;
    let modified = chrono::DateTime::from_timestamp_millis(version).ok_or_else(protocol)?;
    let properties = &raw["properties"];
    let deleted_at = &properties["deletetime"];
    let deleted = properties["isdeleted"] == true
        || properties["isdeleted"] == "true"
        || deleted_at.as_i64().is_some_and(|n| n > 0)
        || deleted_at.as_str().is_some_and(|s| {
            s.parse::<i64>().is_ok_and(|n| n > 0) || chrono::DateTime::parse_from_rfc3339(s).is_ok()
        });
    let kind = raw["messagetype"].as_str().unwrap_or("");
    if !deleted
        && [
            "ThreadActivity/DeleteMessage",
            "ThreadActivity/MessageDelete",
        ]
        .contains(&kind)
    {
        return Err(protocol());
    }
    if !deleted
        && ["ThreadActivity/", "Event/", "Control/"]
            .iter()
            .any(|prefix| kind.starts_with(prefix))
    {
        return Ok(None);
    }
    if !deleted && !["Text", "RichText/Html", "RichText/Media_Card"].contains(&kind) {
        return Err(protocol());
    }
    let from = if deleted {
        Value::Null
    } else {
        let raw_sender = string(raw, "from")?;
        let decoded;
        let sender = if raw_sender.starts_with("https:") {
            let url = url::Url::parse(raw_sender).map_err(|_| protocol())?;
            let expected = session.url(Backend::Ic3, &["contacts"])?;
            if url.origin() != expected.origin()
                || !url.username().is_empty()
                || url.password().is_some()
                || url.query().is_some()
                || url.fragment().is_some()
            {
                return Err(protocol());
            }
            let segments = url
                .path_segments()
                .ok_or_else(protocol)?
                .map(|segment| {
                    percent_encoding::percent_decode_str(segment)
                        .decode_utf8()
                        .map(|s| s.into_owned())
                        .map_err(|_| protocol())
                })
                .collect::<Result<Vec<_>>>()?;
            let prefix = expected
                .path_segments()
                .ok_or_else(protocol)?
                .collect::<Vec<_>>();
            if segments.len() != prefix.len() + 1
                || segments
                    .iter()
                    .take(prefix.len())
                    .zip(prefix)
                    .any(|(actual, expected)| {
                        if expected == "ME" {
                            actual != "ME"
                                && !actual.eq_ignore_ascii_case(&format!(
                                    "8:orgid:{}",
                                    session.account().user.as_str()
                                ))
                        } else {
                            actual != expected
                        }
                    })
            {
                return Err(protocol());
            }
            decoded = segments.last().ok_or_else(protocol)?.clone();
            &decoded
        } else {
            raw_sender
        };
        if let Some(user) = sender.strip_prefix("8:orgid:") {
            json!({"user":{"id":user,"displayName":raw["imdisplayname"]}})
        } else if let Some(app) = sender.strip_prefix("28:") {
            json!({"application":{"id":app,"displayName":raw["imdisplayname"]}})
        } else {
            return Err(protocol());
        }
    };
    let created = raw
        .get("originalarrivaltime")
        .or_else(|| raw.get("composetime"))
        .cloned()
        .unwrap_or_else(|| {
            if deleted {
                json!(modified.to_rfc3339())
            } else {
                Value::Null
            }
        });
    let mentions_value = if let Some(text) = properties["mentions"]
        .as_str()
        .filter(|s| s.len() <= 16 * 1024)
    {
        serde_json::from_str(text).unwrap_or(Value::Null)
    } else {
        properties["mentions"].clone()
    };
    let mentions = mentions_value.as_array().map(|items| {
        items
            .iter()
            .map(|item| {
                if let Some(user) = item["mri"]
                    .as_str()
                    .and_then(|s| s.strip_prefix("8:orgid:"))
                {
                    json!({"mentioned":{"user":{"id":user}}})
                } else {
                    item.clone()
                }
            })
            .collect::<Vec<_>>()
    });
    normalize::graph(
        &json!({"id":id,"createdDateTime":created,"lastModifiedDateTime":modified.to_rfc3339(),
        "deletedDateTime":if deleted { json!(modified.to_rfc3339()) } else { Value::Null },
        "from":from,"body":{"content":raw["content"],"contentType":if kind == "RichText/Html" { "html" } else { "text" }},
        "mentions":mentions}),
        reference,
    )
}
