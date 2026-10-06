use crate::{Backend, Destination};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Operation {
    SelfSend,
    ChatSend,
    ChannelSend,
    ChannelReply,
    ChannelLike,
}
#[derive(Clone, Debug)]
pub struct Routes {
    pub self_send: Option<Backend>,
    pub chat_send: Option<Backend>,
    pub channel_send: Option<Backend>,
    pub channel_reply: Option<Backend>,
    pub channel_like: Option<Backend>,
}
impl Default for Routes {
    fn default() -> Self {
        let graph = cfg!(feature = "graph").then_some(Backend::Graph);
        Self {
            self_send: None,
            chat_send: graph,
            channel_send: graph,
            channel_reply: graph,
            channel_like: graph,
        }
    }
}
impl Routes {
    pub fn route(&self, operation: Operation) -> Option<Backend> {
        match operation {
            Operation::SelfSend => self.self_send,
            Operation::ChatSend => self.chat_send,
            Operation::ChannelSend => self.channel_send,
            Operation::ChannelReply => self.channel_reply,
            Operation::ChannelLike => self.channel_like,
        }
    }
    pub(crate) fn send(&self, destination: &Destination) -> Option<Backend> {
        self.route(match destination {
            Destination::SelfChat => Operation::SelfSend,
            Destination::Chat(_) => Operation::ChatSend,
            Destination::Channel { .. } => Operation::ChannelSend,
        })
    }
}
pub fn compiled(backend: Backend) -> bool {
    match backend {
        Backend::Graph => cfg!(feature = "graph"),
        Backend::Mcp => true,
        Backend::Ic3 => true,
    }
}
