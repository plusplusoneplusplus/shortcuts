use crate::{Error, ErrorCode, Result};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::fmt;

macro_rules! identifier {
    ($name:ident) => {
        #[derive(Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
        #[serde(try_from = "String", into = "String")]
        pub struct $name(String);
        impl $name {
            pub fn new(value: impl Into<String>) -> Result<Self> {
                let value = value.into();
                if value.is_empty()
                    || value.len() > 1024
                    || value.trim() != value
                    || value.chars().any(|c| c.is_control())
                    || value == "."
                    || value == ".."
                {
                    return Err(Error::new(ErrorCode::InvalidTarget));
                }
                Ok(Self(value))
            }
            pub fn as_str(&self) -> &str {
                &self.0
            }
        }
        impl TryFrom<String> for $name {
            type Error = Error;
            fn try_from(value: String) -> Result<Self> {
                Self::new(value)
            }
        }
        impl From<$name> for String {
            fn from(value: $name) -> String {
                value.0
            }
        }
        impl fmt::Debug for $name {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                f.write_str(concat!(stringify!($name), "([redacted])"))
            }
        }
    };
}
identifier!(TenantId);
identifier!(UserId);
identifier!(ChatId);
identifier!(TeamId);
identifier!(ChannelId);
identifier!(MessageId);

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Account {
    pub tenant: TenantId,
    pub user: UserId,
}
impl Account {
    pub fn new(tenant: TenantId, user: UserId) -> Self {
        Self { tenant, user }
    }
    pub(crate) fn matches(&self, other: &Self) -> bool {
        self.tenant
            .as_str()
            .eq_ignore_ascii_case(other.tenant.as_str())
            && self.user.as_str().eq_ignore_ascii_case(other.user.as_str())
    }
}
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash)]
pub enum Backend {
    Graph,
    Mcp,
    Ic3,
}
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ChatKind {
    OneOnOne,
    Group,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum Conversation {
    Chat(ChatId),
    Channel {
        team: TeamId,
        channel: ChannelId,
    },
    Replies {
        team: TeamId,
        channel: ChannelId,
        root: MessageId,
    },
}
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum Destination {
    SelfChat,
    Chat(ChatId),
    Channel { team: TeamId, channel: ChannelId },
}
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ConversationRef {
    pub(crate) generation: uuid::Uuid,
    pub(crate) backend: Backend,
    pub(crate) conversation: Conversation,
}
impl ConversationRef {
    pub fn conversation(&self) -> &Conversation {
        &self.conversation
    }
    pub fn backend(&self) -> Backend {
        self.backend
    }
}
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MessageRef {
    pub(crate) conversation: ConversationRef,
    pub(crate) id: MessageId,
}
impl MessageRef {
    pub fn conversation(&self) -> &ConversationRef {
        &self.conversation
    }
    pub fn id(&self) -> &MessageId {
        &self.id
    }
}
#[derive(Clone, Debug)]
pub struct Chat {
    pub reference: ConversationRef,
    pub kind: ChatKind,
}
#[derive(Clone, Debug)]
pub struct Team {
    pub id: TeamId,
}
#[derive(Clone, Debug)]
pub struct Channel {
    pub reference: ConversationRef,
}
#[derive(Clone, Debug)]
pub enum Author {
    User(UserId),
    Application(String),
}
#[derive(Clone, Debug)]
pub struct MessageMetadata {
    pub reference: MessageRef,
    pub created_at: DateTime<Utc>,
    pub modified_at: DateTime<Utc>,
    pub deleted: bool,
    pub author: Option<Author>,
}

/// Not serializable or Debug: these fields are transient, untrusted provider content.
pub struct MessageDetail {
    pub metadata: MessageMetadata,
    pub text: String,
    pub text_truncated: bool,
    pub untrusted_html: Option<String>,
    pub html_truncated: bool,
    pub sender_name: Option<String>,
    /// None means incomplete/unavailable evidence, not "no mentions".
    pub mentioned_users: Option<Vec<UserId>>,
}
pub struct Participant {
    pub user: UserId,
    pub display_name: Option<String>,
    pub is_self: bool,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ContentType {
    Text,
    Html,
}
#[derive(Clone)]
pub struct Mention {
    pub user: UserId,
    pub display_name: String,
}
#[derive(Clone)]
pub struct MessageBody {
    pub content: String,
    pub content_type: ContentType,
    pub mentions: Vec<Mention>,
}
impl MessageBody {
    pub fn text(content: impl Into<String>) -> Self {
        Self {
            content: content.into(),
            content_type: ContentType::Text,
            mentions: vec![],
        }
    }
    pub fn html(content: impl Into<String>) -> Self {
        Self {
            content: content.into(),
            content_type: ContentType::Html,
            mentions: vec![],
        }
    }
    pub(crate) fn validate(&self) -> Result<()> {
        if self.content.trim().is_empty()
            || self.content.len() > 64 * 1024
            || self.mentions.len() > 100
            || self
                .mentions
                .iter()
                .any(|m| m.display_name.trim().is_empty() || m.display_name.len() > 256)
        {
            return Err(Error::new(ErrorCode::InvalidTarget));
        }
        Ok(())
    }
}
#[derive(Clone)]
pub struct Cursor {
    pub(crate) generation: uuid::Uuid,
    pub(crate) backend: Backend,
    pub(crate) collection: String,
    pub(crate) url: url::Url,
}
impl fmt::Debug for Cursor {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("Cursor([opaque])")
    }
}
pub struct Page<T> {
    pub items: Vec<T>,
    pub next: Option<Cursor>,
    /// Counts raw provider entries, including skipped system records.
    pub raw_count: usize,
}
#[derive(Clone, Copy, Debug)]
pub struct ScanLimits {
    pub pages: usize,
    pub entries: usize,
}
impl Default for ScanLimits {
    fn default() -> Self {
        Self {
            pages: 100,
            entries: 5000,
        }
    }
}
/// No partial result is represented as complete coverage.
pub enum Scan<T> {
    Complete(Vec<T>),
    Incomplete { items: Vec<T>, reason: Error },
}
impl<T> Scan<T> {
    pub fn is_complete(&self) -> bool {
        matches!(self, Self::Complete(_))
    }
}
