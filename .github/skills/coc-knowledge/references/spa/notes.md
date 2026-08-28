# Dashboard SPA — Notes

The Notes view, its collection roots, the rich editor, and Notes Chat.

## AI chat surface

Notes inherits `features.commitChatLens` as the single source of truth for its AI chat
surface. `NotesView` calls `useReviewChatPresentation()` with a workspace-scoped
`notes` target: with Lens on it uses the shared target-scoped open/pin/minimize keys,
with Lens off the workspace-scoped notes chat open key. No notes-specific Lens setting
is stored or exposed.

Note-producing SPA flows that originate in notes or chat UI — notes chat edits, AI note
creation, bulk chat summaries — attach
`context.lensChat = { inherited: true, source: 'features.commitChatLens' }` only while
the shared flag is enabled, so process metadata records inherited Lens routing without
persistent notes-specific state.

## Collection roots

`useNotesRoots` loads workspace-routed managed, user-configured, and task-derived roots
for the collection selector. Task-derived rows use the server-provided `isProtected`
marker to show a lock and stay outside modifier, range, and bulk-removal selection;
opening one is a normal read/write collection switch.

Refresh reloads both the selected tree and the derived collection list, so task
directories appear and disappear without persisted Notes configuration. If the active
root disappears, Notes selects the managed root, clears the file selection and route,
and persists that fallback. Notes Chat and AI page creation are managed-root-only and
render disabled with an explanation elsewhere.

**Root and tree request generations are scoped to the current workspace and root**, so
a late response from a prior workspace cannot replace the active selector or tree.
File, folder, search, comment, and image actions all carry the active root identity.

`NotesSidebar` persists expanded folder paths and tree scroll position in
`localStorage`, scoped by workspace **and** root, under
`coc-notes-expanded-<workspaceId>-<rootId>` and
`coc-notes-scroll-<workspaceId>-<rootId>`. Scope changes hydrate their own tree state
without writing the read value, and scroll restores only after the scoped tree is ready.

## Rich editor basics

### Links and file references

The destination URL and platform-specific modifier-click instruction go in a native
hover hint written **only to the live anchor DOM**, so it never reaches the saved
Markdown; the write is idempotent (skipped when the title already matches) so
ProseMirror's DOMObserver does not loop while hovering.

The `filePathRef` marked extension never tokenizes inside a link label
(`lexer.state.inLink`), so a `[URL](URL)` label stays one plain anchor instead of
gaining a `file-ref-link` chip. `FilePreviewTooltip` dismisses itself when its anchor
is detached or measures an all-zero rect, clamps its card to the viewport width, and
flips above the anchor near the bottom edge.

### Code highlighting

The editor highlights only its 16 explicitly registered Lowlight grammars. Unsupported
fenced-code labels such as `text` and `plaintext` render as plain code while retaining
the original label for Markdown round-trip — even when another SPA import registered
that language in the process-wide Highlight.js instance.

### Inline math

The shared Markdown math tokenizer accepts digit-led inline formulas such as `$2MNK$`
when their next unescaped dollar is a valid closer; otherwise the digit-led opener
stays literal, so currency before a later formula does not merge with it. Inline dollar
matches also stop at a Markdown backtick, so prose currency cannot close on a dollar
inside an inline code span.

## Notes Chat

`NotesChatHeader.tsx` (beside `NoteChatPanel.tsx`) renders one compact header across
the Lens, pinned side-panel, and embedded (mobile or Lens-disabled) presentations, in
both empty and active-conversation states. It carries a Notes Chat identity mark, a
muted context label (current note title in per-note scope, the folder name in
per-section scope, or the workspace display name from `resolveWorkspaceName` in
per-workspace scope, truncated with the full value on hover), and the independently
centered `NotesChatScopeToggle` pill (This note / Section / Workspace), which defaults
to `per-note` through `useNotesChat`'s `defaultScope` when no scope is persisted.

The Section segment sits in the middle so the control reads as widening scope. Its
label is static — the pill is `text-[10px]`, and the folder name is already carried by
the adjacent context label. It is disabled (`title="This note isn't in a folder"`) when
the selected note sits at the notes root and therefore has no section.

Window actions are presentation-specific: minimize + pin in `'lens'`, unpin in
`'side-panel'`, neither in `'embedded'`, and close everywhere. "New chat" resets the
active scope while leaving the old process recoverable in history; it lives in
`ChatHeaderOverflowMenu` and renders only when a chat exists.

### Chat scope

`NoteChatScope` is `'per-note' | 'per-section' | 'per-workspace'`. Bindings live in the
`note_chat_bindings` table, keyed on a path:

- `per-note` — one row per note path.
- `per-section` — **one row keyed on the note's nearest parent folder**, so every note
  under that folder resolves to the same chat. `MultiModal/sub/note.md` belongs to
  `MultiModal/sub`, not `MultiModal`. A note at the notes root has no section and falls
  back to a per-note binding.
- `per-workspace` — no row at all; the task ID lives in
  `coc-notes-chat-<wsId>` localStorage.

`resolveNoteChatBinding` (`routes/queue-enqueue.ts`) picks the key at enqueue;
`useNotesChat` resolves it back as `perNoteMap[folder] ?? perNoteMap[notePath]`. The
two derivations — `noteSectionPath` server-side, `noteSectionOf` client-side — must
agree, or a chat binds to one key and resolves from another.

Because a section row is keyed on the folder itself, `NoteChatBindingStore.renamePrefix`
and `deletePrefix` carry that row along with the note rows under it; the `folder/%`
sweep alone would never match it.

Draft keys and the `/new` reset follow the same key: `notesChatDraftKey` returns
`notes-chat:<ws>:section:<folder>` under section scope, so a half-typed message survives
clicking a sibling.

Widening a per-note chat to section scope has no new enqueue to hang a binding off, so
`useNotesChat`'s `setScope` (`changeScope`) re-keys it: it mirrors the task onto the
folder locally and writes the row through
`PUT /api/workspaces/:id/notes/chat-bindings/by-path`. Adoption fills an **empty** folder
only — if the section already has a chat, the user joins it rather than overwriting it.
Without that write the conversation would resolve to nothing on the next sibling click,
which is exactly the disappearing act section scope exists to fix.

### Moving a chat's active note

The note a chat operates on is stored twice: `payload.context.noteChat.notePath` (read
once by `NoteChatExecutor` for the first turn) and `metadata.notePath` (read by
`FollowUpExecutor` for **every later turn**). Only the second decides which file a
follow-up snapshots and diffs.

`POST /api/processes/:id/note` (`{ notePath, noteTitle? }`) rewrites that metadata —
this is what makes a chat follow a note rather than silently attributing its edits to
the note it was created against. It is a dedicated endpoint rather than a field on
`.../message`, whose contract is "send text". Because it retargets where an agent
writes, it validates hard: the path is normalized (no traversal, no absolute), re-checked
against the workspace's notes root, and — when `metadata.noteChatScope` is
`per-section` — required to stay inside the bound folder. `metadata.noteChatScope` is
denormalized at enqueue by `process-lifecycle-runner` so the route needs no queue-payload
read.

`useNotesChat.moveChatNote` calls it and optimistically updates the local note context,
so the header label, the 📎 indicator, and the banner all follow with no extra plumbing.

Nothing is sent when the note changes — clicking a note in the sidebar is navigation,
not a turn. The switch is marked pending and folded into the *next* message as one
`[📝 Now viewing: <path>](…)` line via `NoteChatPanel`'s existing `combinedPrefix`
mechanism (the third contributor beside paper grounding and note references). The
*Now viewing* wording, rather than the creation-time *Note:*, makes a transcript with
several note links read as replacement instead of accumulation.

### Note binding

When the active chat is bound to a note, a path-reference button
(`data-testid="notes-chat-path-ref"`) appears before the overflow menu, with the full
prepended note path in its tooltip and `aria-label`. If the selected note diverges from
the chat-bound note the button sets `data-switched="true"`.

`isSwitched` is computed once in `NoteChatPanel` and is **only ever true in per-note
scope** — under section scope every sibling legitimately shares the chat, so flagging
each sibling click would defeat the feature; the chat is moved to follow the selection
instead. `NoteContextBanner.tsx` reads that same value and, when switched, offers
`Continue here` (keep the task, move it) and `Use section scope` (the same, plus flip
the toggle) rather than only naming the problem.

The displayed note reference is **paired with the active chat task** in `useNotesChat`.
`createChat` seeds the pair from the returned task ID while the process is still
queued, and `ChatDetail` reports every accepted `processDetails` snapshot from its
clone-routed load and refresh paths through `onProcessLoaded`. `useNotesChat` reads the
persisted `metadata.queueTaskId`, `metadata.notePath`, and `metadata.noteTitle` from
that snapshot and ignores any task ID that is no longer active.

That pairing is why context from another task renders as `null` during note or scope
changes instead of showing another chat's attachment label or warning, including when
an older load finishes late. Note context is never read from or written to a
workspace-wide localStorage value, and resolving it adds no process request beyond the
normal `ChatDetail` flow.

## Editor toolbar structure

`features/notes/editor/NoteEditorToolbar.tsx` is composition only: it decides which
rows exist (formatting row, find/replace row, contextual table strip) and delegates to
`features/notes/editor/toolbar/`. It re-exports `HIGHLIGHT_COLORS`, `HEADING_LEVELS`,
`TABLE_PICKER_COLS`, and `TABLE_PICKER_ROWS` so it stays the entry point.

- `formattingCommands.ts` — `FORMATTING_GROUPS`, the descriptor list driving the
  formatting half. Each inner array is one visual group with a separator drawn between
  groups, so reordering is an edit here rather than in JSX. A descriptor carries `id`,
  `label` (used for both `title` and `aria-label`), `icon`, `run(editor)`, and optional
  `activeName`/`activeAttrs` for the pressed state. Stateful controls (highlight,
  heading, list, table insert, insert PDF, find) sit in the same list as slots so
  separator layout stays in one place. `toggleLink` lives here too — the one command
  that prompts for input.
- `FormattingToolbar.tsx` — renders the descriptor groups plus the highlight split
  button, heading dropdown, and list dropdown. Re-exports `HIGHLIGHT_COLORS` /
  `DEFAULT_HIGHLIGHT_COLOR` from `colorPalette.ts` and exports `HEADING_LEVELS`.
- `colorPalette.ts` (in `editor/`, not `toolbar/`) — single source of truth for the
  inline color palettes and `normalizeCssColor` / `readStyleProp` / `readInlineColor`.
  It imports neither React nor Tiptap, so `noteMarkdown.ts` can read
  `DEFAULT_HIGHLIGHT_COLOR` from the plain serialization path.
- `ToolbarDropdown.tsx` — the single dropdown primitive (`ToolbarDropdown`, `MenuItem`,
  `Sep`). Owns open/close state, outside-click and Escape dismissal with focus return
  to the trigger, and — in `menu` mode — roving Arrow/Home/End focus over
  `role="menuitem"` children, focus landing on the checked item on open. `MenuItem`
  activates on `onMouseDown` (with `preventDefault`, so the editor selection survives)
  plus Enter/Space, and deliberately has no `onClick`, which would run the command
  twice.
- `useFindReplaceToolbarController.ts` — owns whether the find row shows, plus
  `useFindAndReplaceState` (the `transaction` subscription) and `getSelectedText`.
- `TableToolbarControls.tsx` — the contextual table strip, insert-size picker
  (`TABLE_PICKER_COLS`/`ROWS`), cell fill picker, and `useTableToolbarState`, which
  derives widths / header shape / wrap mode / move availability. Outside a table it
  short-circuits and reads nothing off the doc.
- `ToolbarHostActions.tsx` — right-end actions (AI edits, comments, chat, TOC, refresh,
  custom `toolbarRight`). These read no editor state, are prop-driven, and stay visible
  in source mode. `hasHostActions(props)` decides whether the `ml-auto` spacer is
  emitted at all.

## Inline colors

Markdown has no color syntax, so `noteMarkdown.ts` persists inline color as inline HTML
— the one form that survives `marked` → Tiptap → `turndown` and still renders in an
external Markdown viewer:

- Text color → `<span style="color:#rrggbb">text</span>` (`textColorSpan` turndown
  rule).
- Highlight → bare `==text==` for `DEFAULT_HIGHLIGHT_COLOR`, and
  `<mark style="background-color:#rrggbb">text</mark>` otherwise. The default staying
  bare keeps notes written before color persistence byte-identical, so no migration is
  needed. Color is read from `style`, falling back to Tiptap's `data-color`.

Every color read goes through `normalizeCssColor` (`colorPalette.ts`), which
canonicalizes to lowercase `#rrggbb` and accepts `#rgb`, `#rrggbb`, `rgb()`, and
`rgba()` (alpha dropped). That is what makes the round trip idempotent: a browser
rewrites `style="color: #e11d48"` to `rgb(225, 29, 72)` when Tiptap parses it back, so
without normalization every save would churn the file. A CSS keyword, `hsl()`, or a
custom property normalizes to `null` and counts as no color.

On the way in, `sanitizeInlineColorStyles` keeps only `color` on a `<span>` and only
`background-color` on a `<mark>`, dropping every other declaration, so a pasted or
hand-written `style` cannot turn the note format into a general HTML-styling escape
hatch. A `<span>` left with no honored color loses its `style` and is unwrapped on the
next save.

The `==` marked tokenizer matches `[^\n]+?` (non-greedy, single line) rather than
`[^=]+`, because a colored word nested inside a highlight puts an `=` in the content
via `style="…"`.

## Find & replace

In-document find and replace lives behind the toolbar's 🔍 button
(`features/notes/editor/toolbar/FindReplacePanel.tsx`), backed by
`@tiptap/extension-find-and-replace`, registered last in `RichEditorCore` so its match
decorations paint above the comment and AI-edit decorations. State lives on the editor
instance (`editor.storage.findAndReplace`: term, modifiers, `results`, `currentIndex`);
because the toolbar is not the component calling `useEditor`, the panel subscribes to
`transaction` events to keep the `n / total` counter live.

The panel offers find/replace inputs, prev/next (Enter and Shift+Enter in the find
input), Aa / `ab|` / `.*` modifier toggles, and Replace / Replace all, seeding the term
from a single-line selection on open. Regex mode is RE2-backed, so lookarounds and
backreferences are unsupported and an invalid pattern yields zero matches rather than
throwing; whole-word is disabled in regex mode because the extension ignores it there.

Constraints worth knowing:

- No keyboard shortcut is bound, so `Ctrl+F` stays native browser find across the whole
  page (sidebar, TOC, comments, chat panel).
- Rich-mode only — source mode mounts a separate raw-markdown editor — so the button
  sits inside the `hidden`-gated formatting group and the panel force-closes on a
  switch to source. Closing clears the search term so no orphan highlights survive;
  both invariants live in `useFindReplaceToolbarController`.
- Content inside NodeViews (`mermaidBlock`, `mathNode`, `pdfBlock`, `mapBlock`) is
  outside the searchable text flow and never matches; fenced code blocks are real
  ProseMirror text and do match.
- `replaceAll` is one transaction, so a single undo reverts it, and it preserves
  surrounding marks — including comment marks spanning the replaced text (see
  [../task-comments.md](../task-comments.md)).
- Default match styles are disabled (`injectCSS: false`) because the bundled yellow
  fill is indistinguishable from the first `HIGHLIGHT_COLORS` shade; `noteEditor.css`
  outlines matches instead so one inside a user highlight still reads.
