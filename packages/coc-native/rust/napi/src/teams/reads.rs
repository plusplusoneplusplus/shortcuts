use super::{error, Lifetime};
use napi::{
    bindgen_prelude::{ClassInstance, PromiseRaw},
    Env, Result,
};
use napi_derive::napi;
use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Weak,
    },
    time::Duration,
};
use teams_sdk::{
    Author, Backend, Chat, ChatId, ChatKind, Conversation, Cursor, ErrorCode, MessageDetail,
    OperationContext, Page, Session,
};

#[derive(Clone, PartialEq, Eq)]
enum Collection {
    Chats,
    History(ChatId),
}

/// Native-owned continuation: no URL, token or cross-session reconstruction.
#[napi]
pub struct NativeTeamsIc3Cursor {
    owner: Weak<Lifetime>,
    collection: Collection,
    cursor: Cursor,
}

#[napi(object)]
pub struct TeamsIc3Chat {
    pub chat_id: String,
    pub kind: String,
}

#[napi(object)]
pub struct TeamsIc3Message {
    pub chat_id: String,
    pub message_id: String,
    pub created_at: String,
    pub modified_at: String,
    pub deleted: bool,
    pub author_kind: String,
    pub author_id: Option<String>,
    pub text: String,
    pub text_truncated: bool,
    pub untrusted_html: Option<String>,
    pub html_truncated: bool,
    pub mentioned_user_ids: Option<Vec<String>>,
}

#[napi(object, object_from_js = false)]
pub struct TeamsIc3ChatPage {
    pub items: Vec<TeamsIc3Chat>,
    pub next: Option<NativeTeamsIc3Cursor>,
    pub raw_count: u32,
}

#[napi(object, object_from_js = false)]
pub struct TeamsIc3HistoryPage {
    pub items: Vec<TeamsIc3Message>,
    pub next: Option<NativeTeamsIc3Cursor>,
    pub raw_count: u32,
}

/// One read per handle. Cancelling it leaves other reads and the account usable.
#[napi]
pub struct NativeTeamsIc3Read {
    state: Arc<ReadState>,
}

struct ReadState {
    owner: Arc<Lifetime>,
    session: Session,
    ctx: OperationContext,
    started: AtomicBool,
}

impl NativeTeamsIc3Read {
    pub(super) fn new(owner: Arc<Lifetime>, timeout: Duration) -> teams_sdk::Result<Self> {
        let ctx = OperationContext::with_timeout(timeout);
        owner.check(&ctx)?;
        let session = owner
            .session
            .lock()
            .map_err(|_| teams_sdk::Error::new(ErrorCode::Closed))?
            .clone()
            .ok_or_else(|| teams_sdk::Error::new(ErrorCode::InvalidTarget))?;
        let state = Arc::new(ReadState { owner, session, ctx, started: AtomicBool::new(false) });
        state.check()?;
        Ok(Self { state })
    }
}

impl ReadState {
    fn check(&self) -> teams_sdk::Result<()> {
        self.owner.check(&self.ctx)?;
        if self.ctx.cancellation.is_cancelled() {
            return Err(teams_sdk::Error::new(ErrorCode::Cancelled));
        }
        Ok(())
    }

    fn begin(
        &self,
        collection: &Collection,
        cursor: Option<&NativeTeamsIc3Cursor>,
    ) -> teams_sdk::Result<Option<Cursor>> {
        self.check()?;
        if self.started.swap(true, Ordering::AcqRel) {
            return Err(teams_sdk::Error::new(ErrorCode::InvalidTarget));
        }
        if let Some(cursor) = cursor {
            if !cursor.owner.ptr_eq(&Arc::downgrade(&self.owner))
                || &cursor.collection != collection
            {
                return Err(teams_sdk::Error::new(ErrorCode::UnsafeCursor));
            }
        }
        Ok(cursor.map(|value| value.cursor.clone()))
    }

    fn continuation(
        &self,
        collection: Collection,
        cursor: Option<Cursor>,
    ) -> Option<NativeTeamsIc3Cursor> {
        cursor.map(|cursor| NativeTeamsIc3Cursor {
            owner: Arc::downgrade(&self.owner),
            collection,
            cursor,
        })
    }

    async fn chats(&self, cursor: Option<&Cursor>) -> teams_sdk::Result<Page<Chat>> {
        self.check()?;
        self.session.chats(Backend::Ic3, cursor, &self.ctx).await
    }

    async fn history(
        &self,
        chat: &ChatId,
        cursor: Option<&Cursor>,
    ) -> teams_sdk::Result<Page<MessageDetail>> {
        self.check()?;
        let reference =
            self.session.conversation(Backend::Ic3, Conversation::Chat(chat.clone()))?;
        self.session.history(&reference, cursor, &self.ctx).await
    }

    fn publish_chats(&self, page: Page<Chat>) -> teams_sdk::Result<TeamsIc3ChatPage> {
        self.check()?;
        let items = page
            .items
            .into_iter()
            .map(|chat| {
                let Conversation::Chat(id) = chat.reference.conversation() else {
                    return Err(teams_sdk::Error::new(ErrorCode::Protocol));
                };
                Ok(TeamsIc3Chat {
                    chat_id: id.as_str().to_owned(),
                    kind: match chat.kind {
                        ChatKind::OneOnOne => "oneOnOne",
                        ChatKind::Group => "group",
                    }
                    .into(),
                })
            })
            .collect::<teams_sdk::Result<Vec<_>>>()?;
        self.check()?;
        Ok(TeamsIc3ChatPage {
            items,
            next: self.continuation(Collection::Chats, page.next),
            raw_count: page.raw_count as u32,
        })
    }

    fn publish_history(
        &self,
        chat: ChatId,
        page: Page<MessageDetail>,
    ) -> teams_sdk::Result<TeamsIc3HistoryPage> {
        self.check()?;
        let items = page
            .items
            .into_iter()
            .map(|message| {
                let metadata = message.metadata;
                let (kind, id) = match metadata.author {
                    Some(Author::User(id)) => ("user", Some(id.as_str().to_owned())),
                    Some(Author::Application(id)) => ("application", Some(id)),
                    None => ("unknown", None),
                };
                TeamsIc3Message {
                    chat_id: chat.as_str().to_owned(),
                    message_id: metadata.reference.id().as_str().to_owned(),
                    created_at: metadata.created_at.to_rfc3339(),
                    modified_at: metadata.modified_at.to_rfc3339(),
                    deleted: metadata.deleted,
                    author_kind: kind.into(),
                    author_id: id,
                    text: message.text,
                    text_truncated: message.text_truncated,
                    untrusted_html: message.untrusted_html,
                    html_truncated: message.html_truncated,
                    mentioned_user_ids: message
                        .mentioned_users
                        .map(|users| users.into_iter().map(String::from).collect()),
                }
            })
            .collect();
        self.check()?;
        Ok(TeamsIc3HistoryPage {
            items,
            next: self.continuation(Collection::History(chat), page.next),
            raw_count: page.raw_count as u32,
        })
    }
}

#[napi]
impl NativeTeamsIc3Read {
    #[napi]
    pub fn read_chats<'env>(
        &self,
        env: &'env Env,
        cursor: Option<ClassInstance<NativeTeamsIc3Cursor>>,
    ) -> Result<PromiseRaw<'env, TeamsIc3ChatPage>> {
        let cursor = self.state.begin(&Collection::Chats, cursor.as_deref()).map_err(error)?;
        let read = self.state.clone();
        let publish = self.state.clone();
        env.spawn_future_with_callback(
            async move { read.chats(cursor.as_ref()).await.map_err(error) },
            move |_, page| publish.publish_chats(page).map_err(error),
        )
    }

    #[napi]
    pub fn read_history<'env>(
        &self,
        env: &'env Env,
        chat_id: String,
        cursor: Option<ClassInstance<NativeTeamsIc3Cursor>>,
    ) -> Result<PromiseRaw<'env, TeamsIc3HistoryPage>> {
        let chat = ChatId::new(chat_id).map_err(error)?;
        let cursor = self
            .state
            .begin(&Collection::History(chat.clone()), cursor.as_deref())
            .map_err(error)?;
        let read = self.state.clone();
        let publish = self.state.clone();
        let target = chat.clone();
        env.spawn_future_with_callback(
            async move { read.history(&target, cursor.as_ref()).await.map_err(error) },
            move |_, page| publish.publish_history(chat, page).map_err(error),
        )
    }

    #[napi]
    pub fn cancel(&self) {
        self.state.ctx.cancellation.cancel();
    }
}

impl Drop for NativeTeamsIc3Read {
    fn drop(&mut self) {
        self.cancel();
    }
}

#[cfg(test)]
mod tests;
