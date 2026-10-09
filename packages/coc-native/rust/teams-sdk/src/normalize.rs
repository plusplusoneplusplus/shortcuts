use crate::*;
use chrono::{DateTime, Utc};
use serde_json::Value;

pub(crate) fn protocol() -> Error {
    Error::new(ErrorCode::Protocol)
}
pub(crate) fn string<'a>(value: &'a Value, key: &str) -> Result<&'a str> {
    value
        .get(key)
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty() && s.len() <= 1024)
        .ok_or_else(protocol)
}
pub(crate) fn timestamp(value: &Value) -> Result<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(value.as_str().ok_or_else(protocol)?)
        .map(|t| t.with_timezone(&Utc))
        .map_err(|_| protocol())
}
pub(crate) fn name(value: &Value) -> Option<String> {
    value
        .as_str()
        .filter(|s| !s.trim().is_empty() && s.len() <= 256 && !s.chars().any(char::is_control))
        .map(str::to_owned)
}
fn bounded(value: &str) -> (String, bool) {
    let mut end = value.len().min(16 * 1024);
    while !value.is_char_boundary(end) {
        end -= 1;
    }
    (value[..end].to_owned(), end < value.len())
}
fn plain(html: &str) -> String {
    let mut out = String::new();
    let mut tag = false;
    for c in html.chars() {
        match c {
            '<' => tag = true,
            '>' if tag => {
                tag = false;
                out.push(' ');
            }
            _ if !tag => out.push(c),
            _ => {}
        }
    }
    html_escape::decode_html_entities(&out).into_owned()
}
fn mentions(value: &Value) -> Option<Vec<UserId>> {
    let values = value.as_array()?;
    if values.len() > 100 {
        return None;
    }
    let mut users = Vec::new();
    for mention in values {
        let identities = mention.get("mentioned")?.as_object()?;
        let present: Vec<_> = identities.iter().filter(|(_, v)| !v.is_null()).collect();
        if present.len() != 1 {
            return None;
        }
        let (kind, identity) = present[0];
        let id = identity.get("id")?.as_str()?;
        if kind == "user" {
            let canonical = uuid::Uuid::parse_str(id).ok()?.to_string();
            let id = UserId::new(canonical).ok()?;
            if !users.contains(&id) {
                users.push(id);
            }
        } else if !["application", "conversation"].contains(&kind.as_str()) || id.is_empty() {
            return None;
        }
    }
    Some(users)
}
pub(crate) fn graph(
    value: &Value,
    conversation: &ConversationRef,
) -> Result<Option<MessageDetail>> {
    if !value.is_object() {
        return Err(protocol());
    }
    let id = MessageId::new(string(value, "id")?).map_err(|_| protocol())?;
    let deleted = value.get("deletedDateTime").is_some_and(|v| !v.is_null());
    if deleted {
        timestamp(&value["deletedDateTime"])?;
    }
    let system = value["messageType"].as_str() == Some("systemEventMessage")
        || ((value.get("messageType").is_none()
            || value["messageType"].as_str() == Some("unknownFutureValue"))
            && value["from"].is_null()
            && value["body"]["contentType"]
                .as_str()
                .is_some_and(|s| s.eq_ignore_ascii_case("html"))
            && value["body"]["content"]
                .as_str()
                .is_some_and(|s| s.trim() == "<systemEventMessage/>"));
    if system && !deleted {
        return Ok(None);
    }
    if let Conversation::Chat(chat) = &conversation.conversation {
        if value
            .get("chatId")
            .is_some_and(|v| v.as_str() != Some(chat.as_str()))
        {
            return Err(protocol());
        }
    }
    if let Conversation::Channel { team, channel } | Conversation::Replies { team, channel, .. } =
        &conversation.conversation
    {
        if let Some(identity) = value.get("channelIdentity") {
            if identity["teamId"].as_str() != Some(team.as_str())
                || identity["channelId"].as_str() != Some(channel.as_str())
            {
                return Err(protocol());
            }
        }
        let parent = value.get("replyToId").filter(|v| !v.is_null());
        match &conversation.conversation {
            Conversation::Replies { root, .. }
                if parent.is_some_and(|v| v.as_str() != Some(root.as_str())) =>
            {
                return Err(protocol())
            }
            Conversation::Channel { .. } if parent.is_some_and(|v| v.as_str() != Some("")) => {
                return Err(protocol())
            }
            _ => {}
        }
    }
    let created = timestamp(&value["createdDateTime"])?;
    let modified = timestamp(
        value
            .get("lastModifiedDateTime")
            .filter(|v| !v.is_null())
            .unwrap_or(&value["createdDateTime"]),
    )?;
    if modified < created {
        return Err(protocol());
    }
    let mut projected;
    let from = if conversation.backend == Backend::Mcp {
        projected = value["from"].clone();
        if projected.is_null() && value["sender"].is_object() {
            projected = serde_json::json!({"user":value["sender"]});
        } else if projected["id"].is_string()
            && projected["user"].is_null()
            && projected["application"].is_null()
        {
            projected = serde_json::json!({"user":projected});
        }
        &projected
    } else {
        &value["from"]
    };
    let (author, display) = if deleted {
        (None, None)
    } else if from["user"].is_object() && !from["application"].is_object() {
        (
            Some(Author::User(
                UserId::new(string(&from["user"], "id")?).map_err(|_| protocol())?,
            )),
            name(&from["user"]["displayName"]),
        )
    } else if from["application"].is_object() && !from["user"].is_object() {
        (
            Some(Author::Application(
                string(&from["application"], "id")?.to_owned(),
            )),
            name(&from["application"]["displayName"]),
        )
    } else {
        return Err(protocol());
    };
    let (text, text_truncated, html, html_truncated) = if deleted {
        (String::new(), false, None, false)
    } else {
        let content = value["body"]["content"].as_str().ok_or_else(protocol)?;
        match value["body"]["contentType"].as_str() {
            Some("html") => {
                let (text, truncated) = bounded(&plain(content));
                (
                    text,
                    truncated,
                    (content.len() <= 16 * 1024).then(|| content.to_owned()),
                    content.len() > 16 * 1024,
                )
            }
            Some("text") => {
                let (text, truncated) = bounded(content);
                (text, truncated, None, false)
            }
            _ => return Err(protocol()),
        }
    };
    Ok(Some(MessageDetail {
        metadata: MessageMetadata {
            reference: MessageRef {
                conversation: conversation.clone(),
                id,
            },
            created_at: created,
            modified_at: modified,
            deleted,
            author,
        },
        text,
        text_truncated,
        untrusted_html: html,
        html_truncated,
        sender_name: display,
        mentioned_users: if deleted {
            None
        } else {
            mentions(&value["mentions"])
        },
    }))
}
