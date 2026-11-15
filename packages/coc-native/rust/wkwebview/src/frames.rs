//! Frame tree from the per-frame tracking script. WebKit has no public frame tree, so every
//! document reports itself (with its `WKFrameInfo`) and parents report which of their
//! frame elements a child document loaded into. A frame id is stable while its owner
//! element lives: `main` for the top level, `<parent id>/<owner>` below it.

use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;

pub const MAIN_FRAME: &str = "main";
/// Frames deeper than this are not tracked. It is one level past the desktop's depth-8
/// frame limit, so the desktop still sees (and reports) a truncated tree.
const MAX_DEPTH: usize = 9;
const MAX_DOCUMENTS: usize = 512;

/// Content world the tracking script runs in; page scripts cannot reach it.
pub const FRAME_WORLD: &str = "coc-frames";
/// Script message handler, registered for the frame world only.
pub const FRAME_HANDLER: &str = "cocFrames";

/// Document-start script for every frame. It names the document with a random token,
/// reports it, tells its parent window the token, and maps child tokens it hears back
/// to its own frame elements. `owner(id)` resolves an owner element for control calls.
pub const FRAME_SCRIPT: &str = r#"(() => {
const key = Symbol.for('coc.frame');
if (Object.prototype.hasOwnProperty.call(globalThis, key)) return;
const token = Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');
const owners = new Map();
const ids = new WeakMap();
let next = 0;
const post = message => { try { window.webkit.messageHandlers.cocFrames.postMessage(JSON.stringify(message)); } catch {} };
Object.defineProperty(globalThis, key, { value: Object.freeze({ token, owner: id => owners.get(id)?.deref() }) });
post({ kind: 'document', token, url: location.href, origin: location.origin, name: String(window.name).slice(0, 1024) });
addEventListener('message', event => {
  const data = event.data;
  if (!data || typeof data !== 'object' || typeof data.cocFrameChild !== 'string' || !event.source) return;
  for (const element of document.querySelectorAll('iframe,frame')) {
    if (element.contentWindow !== event.source) continue;
    let id = ids.get(element);
    if (id === undefined) { id = ++next; ids.set(element, id); }
    owners.set(id, new WeakRef(element));
    post({ kind: 'child', token, child: data.cocFrameChild, owner: id });
    return;
  }
}, true);
addEventListener('pagehide', () => post({ kind: 'gone', token }), true);
if (window.parent !== window) window.parent.postMessage({ cocFrameChild: token }, '*');
})();"#;

/// One validated message from the tracking script.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase", deny_unknown_fields)]
pub enum FrameMessage {
    Document {
        token: String,
        url: String,
        origin: String,
        /// The frame's name (`window.name`) when the document started, like CDP's `Frame.name`.
        #[serde(default)]
        name: String,
    },
    Child {
        token: String,
        child: String,
        owner: u32,
    },
    Gone {
        token: String,
    },
}

fn valid_token(token: &str) -> bool {
    token.len() == 32 && token.bytes().all(|c| c.is_ascii_hexdigit())
}

/// Parses a script message body; anything malformed is dropped.
pub fn frame_message(body: &str) -> Option<FrameMessage> {
    if body.len() > 16 * 1024 {
        return None;
    }
    let message: FrameMessage = serde_json::from_str(body).ok()?;
    let ok = match &message {
        FrameMessage::Document { token, url, origin, name } => {
            valid_token(token) && url.len() <= 8192 && origin.len() <= 1024 && name.len() <= 4096
        }
        FrameMessage::Child { token, child, owner } => {
            valid_token(token) && valid_token(child) && token != child && *owner > 0
        }
        FrameMessage::Gone { token } => valid_token(token),
    };
    ok.then_some(message)
}

#[derive(Debug, Clone, PartialEq)]
pub enum FrameEvent {
    Navigated {
        frame_id: String,
        parent_id: Option<String>,
        owner: Option<u32>,
        token: String,
        url: String,
        origin: String,
        name: String,
    },
    Detached {
        frame_id: String,
    },
}

impl FrameEvent {
    pub fn to_json(&self, view_id: &str) -> Value {
        match self {
            FrameEvent::Navigated { frame_id, parent_id, owner, token, url, origin, name } => {
                json!({
                    "event": "frame-navigated", "viewId": view_id, "frameId": frame_id,
                    "parentFrameId": parent_id, "owner": owner, "token": token, "url": url, "origin": origin,
                    "name": name,
                })
            }
            FrameEvent::Detached { frame_id } => {
                json!({ "event": "frame-detached", "viewId": view_id, "frameId": frame_id })
            }
        }
    }
}

struct Document<T> {
    info: T,
    url: String,
    origin: String,
    name: String,
    main: bool,
}

struct Frame {
    token: String,
    parent: Option<String>,
    owner: Option<u32>,
    depth: usize,
}

/// `T` is the engine's frame handle (`WKFrameInfo`); evaluation targets it.
pub struct FrameTracker<T> {
    documents: HashMap<String, Document<T>>,
    /// Child token -> (parent token, owner). The first report for a token wins.
    links: HashMap<String, (String, u32)>,
    frames: HashMap<String, Frame>,
}

impl<T> Default for FrameTracker<T> {
    fn default() -> Self {
        Self { documents: HashMap::new(), links: HashMap::new(), frames: HashMap::new() }
    }
}

impl<T: Clone> FrameTracker<T> {
    /// A document reported itself. `main` comes from WebKit's frame info, not the page.
    pub fn document(
        &mut self,
        token: &str,
        info: T,
        url: &str,
        origin: &str,
        name: &str,
        main: bool,
    ) -> Vec<FrameEvent> {
        if self.documents.contains_key(token) {
            return Vec::new();
        }
        if self.documents.len() >= MAX_DOCUMENTS {
            self.prune();
            if self.documents.len() >= MAX_DOCUMENTS {
                return Vec::new();
            }
        }
        self.documents.insert(
            token.to_string(),
            Document {
                info,
                url: url.to_string(),
                origin: origin.to_string(),
                name: name.to_string(),
                main,
            },
        );
        let mut events = Vec::new();
        if main {
            self.place(MAIN_FRAME.to_string(), token, None, None, 0, &mut events);
        } else {
            self.attach(token, &mut events);
        }
        events
    }

    /// A parent document mapped a child token to one of its frame elements.
    pub fn link(&mut self, parent: &str, child: &str, owner: u32) -> Vec<FrameEvent> {
        let mut events = Vec::new();
        if self.links.contains_key(child) || self.links.len() >= MAX_DOCUMENTS {
            return events;
        }
        self.links.insert(child.to_string(), (parent.to_string(), owner));
        self.attach(child, &mut events);
        events
    }

    /// A document went away (frame removed or navigated).
    pub fn gone(&mut self, token: &str) -> Vec<FrameEvent> {
        let mut events = Vec::new();
        if let Some(id) = self.frame_of(token).filter(|id| id != MAIN_FRAME) {
            self.detach(&id, &mut events);
        }
        self.documents.remove(token);
        self.links.remove(token);
        events
    }

    /// Frame handle for evaluation, by frame id.
    pub fn info(&self, frame_id: &str) -> Option<T> {
        let frame = self.frames.get(frame_id)?;
        self.documents.get(&frame.token).map(|document| document.info.clone())
    }

    /// Current frames, parents before children.
    pub fn snapshot(&self) -> Vec<Value> {
        let mut ids: Vec<&String> = self.frames.keys().collect();
        ids.sort_by_key(|id| (self.frames[*id].depth, (*id).clone()));
        ids.into_iter()
            .filter_map(|id| {
                let frame = &self.frames[id];
                let document = self.documents.get(&frame.token)?;
                Some(json!({
                    "frameId": id, "parentFrameId": frame.parent, "owner": frame.owner,
                    "token": frame.token, "url": document.url, "origin": document.origin,
                    "name": document.name,
                }))
            })
            .collect()
    }

    fn frame_of(&self, token: &str) -> Option<String> {
        self.frames.iter().find(|(_, frame)| frame.token == token).map(|(id, _)| id.clone())
    }

    /// Places a child document once its own report, its link and its parent are known.
    fn attach(&mut self, token: &str, events: &mut Vec<FrameEvent>) {
        let Some((parent_token, owner)) = self.links.get(token).cloned() else { return };
        if self.documents.get(token).is_none_or(|document| document.main) {
            return;
        }
        let Some(parent_id) = self.frame_of(&parent_token) else { return };
        let depth = self.frames[&parent_id].depth + 1;
        if depth > MAX_DEPTH {
            return;
        }
        let id = format!("{parent_id}/{owner}");
        self.place(id, token, Some(parent_id), Some(owner), depth, events);
    }

    fn place(
        &mut self,
        id: String,
        token: &str,
        parent: Option<String>,
        owner: Option<u32>,
        depth: usize,
        events: &mut Vec<FrameEvent>,
    ) {
        if self.frames.get(&id).is_some_and(|frame| frame.token == token) {
            return;
        }
        // A new document in the frame: everything under the old one is gone.
        self.detach_children(&id, events);
        if let Some(old) = self.frames.get(&id).map(|frame| frame.token.clone()) {
            self.documents.remove(&old);
            self.links.remove(&old);
        }
        let document = &self.documents[token];
        events.push(FrameEvent::Navigated {
            frame_id: id.clone(),
            parent_id: parent.clone(),
            owner,
            token: token.to_string(),
            url: document.url.clone(),
            origin: document.origin.clone(),
            name: document.name.clone(),
        });
        self.frames.insert(id.clone(), Frame { token: token.to_string(), parent, owner, depth });
        // Children that reported before this document was placed.
        let waiting: Vec<String> = self
            .links
            .iter()
            .filter(|(_, (parent, _))| parent == token)
            .map(|(child, _)| child.clone())
            .collect();
        for child in waiting {
            self.attach(&child, events);
        }
    }

    fn detach_children(&mut self, id: &str, events: &mut Vec<FrameEvent>) {
        let children: Vec<String> = self
            .frames
            .iter()
            .filter(|(_, frame)| frame.parent.as_deref() == Some(id))
            .map(|(child, _)| child.clone())
            .collect();
        for child in children {
            self.detach(&child, events);
        }
    }

    fn detach(&mut self, id: &str, events: &mut Vec<FrameEvent>) {
        self.detach_children(id, events);
        if let Some(frame) = self.frames.remove(id) {
            self.documents.remove(&frame.token);
            self.links.remove(&frame.token);
            events.push(FrameEvent::Detached { frame_id: id.to_string() });
        }
    }

    /// Drops documents and links that never made it into the tree.
    fn prune(&mut self) {
        let placed: Vec<String> = self.frames.values().map(|frame| frame.token.clone()).collect();
        self.documents.retain(|token, _| placed.contains(token));
        self.links.retain(|token, _| placed.contains(token));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn token(n: u8) -> String {
        format!("{n:032x}")
    }

    fn ids(events: &[FrameEvent]) -> Vec<String> {
        events
            .iter()
            .map(|event| match event {
                FrameEvent::Navigated { frame_id, .. } => format!("+{frame_id}"),
                FrameEvent::Detached { frame_id } => format!("-{frame_id}"),
            })
            .collect()
    }

    #[test]
    fn parses_only_valid_messages() {
        let document = format!(
            r#"{{"kind":"document","token":"{}","url":"https://a/","origin":"https://a"}}"#,
            token(1)
        );
        assert!(matches!(frame_message(&document), Some(FrameMessage::Document { .. })));
        let named = format!(
            r#"{{"kind":"document","token":"{}","url":"https://a/","origin":"https://a","name":"x"}}"#,
            token(1)
        );
        assert!(
            matches!(frame_message(&named), Some(FrameMessage::Document { name, .. }) if name == "x")
        );
        let child = format!(
            r#"{{"kind":"child","token":"{}","child":"{}","owner":2}}"#,
            token(1),
            token(2)
        );
        assert_eq!(
            frame_message(&child),
            Some(FrameMessage::Child { token: token(1), child: token(2), owner: 2 })
        );
        assert!(frame_message(r#"{"kind":"gone","token":"short"}"#).is_none());
        assert!(frame_message(&format!(
            r#"{{"kind":"child","token":"{0}","child":"{0}","owner":1}}"#,
            token(1)
        ))
        .is_none());
        assert!(frame_message(&format!(
            r#"{{"kind":"child","token":"{}","child":"{}","owner":0}}"#,
            token(1),
            token(2)
        ))
        .is_none());
        assert!(frame_message(&format!(r#"{{"kind":"gone","token":"{}","extra":1}}"#, token(1)))
            .is_none());
        assert!(frame_message("not json").is_none());
    }

    #[test]
    fn builds_tree_in_any_report_order() {
        let mut frames = FrameTracker::<u8>::default();
        assert_eq!(
            ids(&frames.document(&token(1), 1, "https://a/", "https://a", "", true)),
            ["+main"]
        );
        // Link before the child's own report.
        assert!(frames.link(&token(1), &token(2), 1).is_empty());
        assert_eq!(
            ids(&frames.document(&token(2), 2, "https://b/", "https://b", "named", false)),
            ["+main/1"]
        );
        // Grandchild report before its parent's link.
        assert!(frames.document(&token(4), 4, "https://d/", "https://d", "", false).is_empty());
        assert!(frames.document(&token(3), 3, "https://c/", "https://c", "", false).is_empty());
        assert!(frames.link(&token(3), &token(4), 1).is_empty());
        assert_eq!(ids(&frames.link(&token(1), &token(3), 2)), ["+main/2", "+main/2/1"]);
        assert_eq!(frames.info("main/2/1"), Some(4));
        let snapshot = frames.snapshot();
        assert_eq!(snapshot.len(), 4);
        assert_eq!(snapshot[3]["parentFrameId"], "main/2");
        assert_eq!(snapshot[3]["origin"], "https://d");
        assert_eq!(snapshot[1]["name"], "named");
        assert_eq!(snapshot[3]["name"], "");
    }

    #[test]
    fn navigation_and_removal_detach_descendants() {
        let mut frames = FrameTracker::<u8>::default();
        frames.document(&token(1), 1, "https://a/", "https://a", "", true);
        frames.document(&token(2), 2, "https://b/", "https://b", "", false);
        frames.link(&token(1), &token(2), 1);
        frames.document(&token(3), 3, "https://c/", "https://c", "", false);
        frames.link(&token(2), &token(3), 1);
        // The child frame navigates: same frame id, new document, grandchild gone.
        frames.document(&token(4), 4, "https://e/", "https://e", "", false);
        assert_eq!(ids(&frames.link(&token(1), &token(4), 1)), ["-main/1/1", "+main/1"]);
        assert_eq!(frames.info("main/1"), Some(4));
        // A late pagehide from the replaced document changes nothing.
        assert!(frames.gone(&token(2)).is_empty());
        assert_eq!(ids(&frames.gone(&token(4))), ["-main/1"]);
        assert_eq!(frames.info("main/1"), None);
        // A main navigation drops every child; main pagehide alone does not.
        frames.document(&token(5), 5, "https://b/", "https://b", "", false);
        frames.link(&token(1), &token(5), 3);
        assert!(frames.gone(&token(1)).is_empty());
        assert_eq!(
            ids(&frames.document(&token(6), 6, "https://z/", "https://z", "", true)),
            ["-main/3", "+main"]
        );
    }

    #[test]
    fn first_link_wins_and_main_documents_never_link() {
        let mut frames = FrameTracker::<u8>::default();
        frames.document(&token(1), 1, "https://a/", "https://a", "", true);
        frames.document(&token(2), 2, "https://b/", "https://b", "", false);
        assert_eq!(ids(&frames.link(&token(1), &token(2), 1)), ["+main/1"]);
        assert!(frames.link(&token(1), &token(2), 7).is_empty());
        assert_eq!(frames.info("main/7"), None);
        // A page cannot re-parent the top-level document.
        assert!(frames.link(&token(2), &token(1), 1).is_empty());
        assert_eq!(frames.info("main"), Some(1));
    }

    #[test]
    fn depth_is_bounded() {
        let mut frames = FrameTracker::<u8>::default();
        frames.document(&token(0), 0, "https://a/", "https://a", "", true);
        for n in 1..=10u8 {
            frames.document(&token(n), n, "https://a/", "https://a", "", false);
            frames.link(&token(n - 1), &token(n), 1);
        }
        assert_eq!(frames.snapshot().len(), 1 + MAX_DEPTH);
    }
}
