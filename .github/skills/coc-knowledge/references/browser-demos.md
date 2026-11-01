# Desktop Browser Demonstrations

### Ownership and availability

`browserControl.demoRecordingEnabled` is live and default off; the SPA reads
`browserDemoRecordingEnabled`. `BrowserDemoRecorders` in `packages/coc-desktop/src/`
owns memory-only drafts keyed by desktop window, concrete workspace, process and
routing reference. URL tabs only participate. Electron supports recording;
WebView2 explicitly reports unavailable because its native popup events do not
preserve immediate opener lineage. No engine changes happen automatically.

### Capture and lineage

`browser-demo-capture.ts` installs a private isolated-world collector for trusted
clicks, typing existence, toggles, selection, file selection, submission and
meaningful keys. It reads targeted accessible semantics, never typed values,
screenshots or page dumps. Editable/control roots and descendants cannot supply
label text. Main validates every queued observation and redacts credentials,
emails, numbers and opaque identifiers from labels, titles and URL metadata.
Only bounded semantic roles survive.

`browser-demo-tab-capture.ts` polls document-local queues through main-only CDP.
Document replacement, inaccessible frames, malformed reports and overflow produce
explicit gaps. Pause revisions reject in-flight batches; boundary drains discard
paused observations. Stop drains final actions before session freeze. Capture
startup, child adoption and resumed handshakes recheck lifecycle ownership.
Collection has 300 steps plus one terminal limit marker, 24 tabs, 16 frames per
poll, 100 queued observations per document and 16 pending child reservations.

The host manager preserves actual popup source identity separately from root tab
routing. Electron navigation, focus, new-tab and nested-popup events identify the
immediate source; recursively opened descendants inherit the recording. Existing
unrelated tabs require explicit Add. Human navigation permissions and the
agent-driven site approval path retain their existing contracts.

### Toolbar, review and attachment

`shared/file-path/browser-demo.ts` mirrors counts and owner identities in SPA
memory. `BrowserDemoStrip` supplies recording state, Pause/Stop and explicit Add;
chat/workspace departure pauses recording and the owning composer blocks send
while capturing. The desktop blocks AI access to captured views and their chat.
Stopped drafts remain reviewable from another browser tab of the same owner.

`BrowserDemoReview` loads the stopped action list with tab lineage, editable
explanations, remove/restore and safe example values for nonsensitive typing.
Examples resembling credentials block Send. Review edits stay in memory and
terminal state events, Send and Discard clear them. Explicit Send previews and
attaches one `browser-demo-<timestamp>.md` through the owning clone client's
existing process-message attachment path. Sent attachments use ordinary chat
history: admission retains the complete reviewed text in the user turn or
buffered display content while provider prompts keep ordinary attachment file
references. Temporary file cleanup cannot erase the sent demo. Demos are
neither training data nor reusable cross-chat workflows.

### Explain-only turns and shutdown

`ProcessMessageRequest.browserDemo` accepts only `{inputAllowed:false}`. Owner
admission queues or buffers it rather than steering an active turn. Pending
context and follow-up options bind the restriction to that turn's browser tool,
outside model arguments or conversation metadata. The relay permits only
tabs/snapshot/read/frames/wait/screenshot; input, navigation, evaluation and
takeover fail `demo-no-input` before dispatch. Later explicit tasks have
independent bindings. Website text remains untrusted context.

The SPA keeps a beforeunload warning for every unsent draft independently of
panel mounts. Registered desktop owners confirm native close/reload; both app
entry points confirm all drafts before shutdown disposal. Cancel preserves
drafts. Successful close, full reload, crash and disposal revoke them. Sudden
process or OS termination cannot guarantee a warning; unsent data is never saved.
