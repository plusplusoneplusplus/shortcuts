# Dashboard SPA — Notes

The Notes view, its collection roots, the rich editor, and Notes Chat.

## AI chat surface

Notes inherits `features.commitChatLens` as the single source of truth for its AI chat
surface. `NotesView` uses `useReviewChatPresentation()` with a workspace-scoped `notes`
target: with Lens enabled it uses the shared target-scoped open/pin/minimize keys, and
with Lens disabled it uses the workspace-scoped notes chat open key. The notes area
shows no separate Lens indicator, and no notes-specific Lens setting is stored or
exposed.

Note-producing SPA flows that originate in notes or chat UI — notes chat edits, AI note
creation, bulk chat summaries — attach
`context.lensChat = { inherited: true, source: 'features.commitChatLens' }` only while
the shared flag is enabled, so process metadata records inherited Lens routing without
adding persistent notes-specific state.

## Collection roots

The collection selector loads workspace-routed managed, user-configured, and
task-derived roots through `useNotesRoots`. Task-derived rows use the server-provided
`isProtected` marker to show a lock and stay outside modifier, range, and bulk-removal
selection; opening a protected row is a normal read/write collection switch.

Refresh reloads both the selected tree and the derived collection list, so new task
directories appear and removed ones disappear without persisted Notes configuration. If
the active root disappears, Notes selects the managed root, clears the file selection
and route, and persists that fallback.

**Root and tree request generations are scoped to the current workspace and root**, so a
late response from a prior workspace cannot replace the active selector or tree. File,
folder, search, comment, and image actions all carry the active root identity.

Notes Chat and AI page creation are managed-root-only and render disabled with an
explanation in every other collection.

`NotesSidebar` persists expanded folder paths and tree scroll position in
`localStorage`, scoped by workspace **and** root, under
`coc-notes-expanded-<workspaceId>-<rootId>` and
`coc-notes-scroll-<workspaceId>-<rootId>`. Scope changes hydrate their own tree state
without writing the read value, and scroll position restores only after the scoped tree
is ready.

## Rich editor basics

### Links and file references

Links display their destination URL and the platform-specific modifier-click
instruction in a native hover hint. The hint is applied only to the **live anchor DOM**
so it never becomes part of the saved Markdown, and the write is idempotent (skipped
when the title already matches) so ProseMirror's DOMObserver never enters a redraw loop
while hovering.

The `filePathRef` marked extension never tokenizes inside a link label
(`lexer.state.inLink`), so a `[URL](URL)` label stays one plain anchor instead of
gaining a `file-ref-link` chip. `FilePreviewTooltip` dismisses itself when its anchor is
detached or measures an all-zero rect, clamps its 360px card to the viewport width, and
flips above the anchor near the bottom edge.

### Code highlighting

The editor highlights only its 16 explicitly registered Lowlight grammars. Unsupported
fenced-code labels such as `text` and `plaintext` render as plain code while retaining
the original label for Markdown round-trip — even when another SPA import registered
that language in the process-wide Highlight.js instance.

### Inline math

The shared Markdown math tokenizer accepts digit-led inline formulas such as `$2MNK$`
when their next unescaped dollar is a valid closer. If that dollar is not a valid
closer, the digit-led opener stays literal, so currency before a later formula does not
merge with it. Inline dollar matches also stop at a Markdown backtick, so prose currency
cannot close on a dollar inside an inline code span.

## Notes Chat

`NotesChatHeader.tsx` (beside `NoteChatPanel.tsx`) renders one compact 32px header
across Lens, pinned side-panel, and embedded (mobile or Lens-disabled) presentations, in
both empty and active-conversation states. It carries a Notes Chat identity mark, a
muted context label (current note title in per-note scope, or the workspace display name
from `resolveWorkspaceName` in per-workspace scope, truncated with the full value on
hover), and the independently centered `NotesChatScopeToggle` pill (This note /
Workspace), which defaults to `per-note` through `useNotesChat`'s `defaultScope` when no
scope is persisted.

Window actions are presentation-specific: minimize + pin in `'lens'`, unpin in
`'side-panel'`, neither in `'embedded'`, and close everywhere. "New chat" resets the
active scope while leaving the old process recoverable in history; it lives in
`ChatHeaderOverflowMenu` and renders only when a chat exists.

### Note binding

When the active chat is bound to a note, a compact 📎 path-reference button
(`data-testid="notes-chat-path-ref"`) appears before the overflow menu, with the full
prepended note path in its tooltip and `aria-label`. If the selected note diverges from
the chat-bound note the button tints amber (`data-switched="true"`) and the tooltip
reads "Attached to <note> — Start New Chat to switch." `NoteContextBanner.tsx` uses that
same `isSwitched` value — computed once in `NoteChatPanel` — to render a slim amber
one-line warning only in the divergent case.

The displayed note reference is **paired with the active chat task** in `useNotesChat`.
`createChat` seeds the pair from the returned task ID while the process is still queued,
and `ChatDetail` reports every accepted `processDetails` snapshot from its clone-routed
load and refresh paths through `onProcessLoaded`. `useNotesChat` reads the persisted
`metadata.queueTaskId`, `metadata.notePath`, and `metadata.noteTitle` from that snapshot
and ignores any task ID that is no longer active.

That pairing is why context from another task renders as `null` during note or scope
changes instead of showing another chat's attachment label or warning, including when an
older load finishes late. Note context is never read from or written to a
workspace-wide localStorage value, and resolving it adds no process request beyond the
normal `ChatDetail` flow.

## Notes editor toolbar structure

`features/notes/editor/NoteEditorToolbar.tsx` is composition only: it decides
which rows exist (formatting row, find/replace row, contextual table strip) and
delegates everything else to `features/notes/editor/toolbar/`.

- `formattingCommands.ts` — `FORMATTING_GROUPS`, the descriptor list driving the
  formatting half of the toolbar. Each inner array is one visual group and a
  separator is drawn between groups, so reordering the toolbar is an edit here
  rather than in JSX. A descriptor carries `id`, `label` (used for both `title`
  and `aria-label`), `icon`, `run(editor)`, and optional `activeName`/
  `activeAttrs` for the pressed state. Stateful controls (highlight, heading,
  list, table insert, insert PDF, find) sit in the same list as slots so the
  separator layout stays in one place. `toggleLink` lives here too — it is the
  one command that prompts for input.
- `FormattingToolbar.tsx` — renders the descriptor groups, plus the highlight
  split button, heading dropdown, and list dropdown. Re-exports
  `HIGHLIGHT_COLORS` / `DEFAULT_HIGHLIGHT_COLOR` from `colorPalette.ts` and
  exports `HEADING_LEVELS`.
- `colorPalette.ts` (in `editor/`, not `toolbar/`) — the single source of truth
  for the inline color palettes and `normalizeCssColor` / `readStyleProp` /
  `readInlineColor`. It imports neither React nor Tiptap so `noteMarkdown.ts`
  can read `DEFAULT_HIGHLIGHT_COLOR` from the plain serialization path.
- `ToolbarDropdown.tsx` — the single dropdown primitive (`ToolbarDropdown`,
  `MenuItem`, `Sep`). It owns open/close state, outside-click and Escape
  dismissal with focus return to the trigger, and — in `menu` mode — roving
  Arrow/Home/End focus over `role="menuitem"` children, with focus landing on
  the checked item on open. `MenuItem` activates on `onMouseDown` (with
  `preventDefault`, so the editor selection survives) plus Enter/Space, and
  deliberately has no `onClick`, which would run the command twice.
- `useFindReplaceToolbarController.ts` — owns whether the find row is showing,
  plus `useFindAndReplaceState` (the `transaction` subscription) and
  `getSelectedText`.
- `TableToolbarControls.tsx` — the contextual table strip, the insert-size
  picker (`TABLE_PICKER_COLS`/`ROWS`), the cell fill picker, and
  `useTableToolbarState`, which derives widths / header shape / wrap mode / move
  availability. Outside a table it short-circuits and reads nothing off the doc.
- `ToolbarHostActions.tsx` — the right-end actions (AI edits, comments, chat,
  TOC, refresh, custom `toolbarRight`). These read no editor state, are driven
  entirely by props, and stay visible in source mode. `hasHostActions(props)`
  decides whether the `ml-auto` spacer is emitted at all.

`NoteEditorToolbar.tsx` re-exports `HIGHLIGHT_COLORS`, `HEADING_LEVELS`,
`TABLE_PICKER_COLS`, and `TABLE_PICKER_ROWS` so it stays the entry point.

## Notes rich editor inline colors

Markdown has no color syntax, so `noteMarkdown.ts` persists inline color as
inline HTML — the one form that survives `marked` → Tiptap → `turndown` and
still renders in an external Markdown viewer:

- Text color → `<span style="color:#rrggbb">text</span>` (`textColorSpan`
  turndown rule).
- Highlight → bare `==text==` for `DEFAULT_HIGHLIGHT_COLOR`, and
  `<mark style="background-color:#rrggbb">text</mark>` for any other color. The
  default staying bare is what keeps every note written before colors were
  persisted byte-identical, so no migration is needed. The color is read from
  the `style` attribute, falling back to Tiptap's `data-color`.

Every color read goes through `normalizeCssColor` (`colorPalette.ts`), which
canonicalizes to lowercase `#rrggbb` and accepts `#rgb`, `#rrggbb`, `rgb()` and
`rgba()` (alpha dropped). This is what makes the round trip idempotent: a
browser rewrites `style="color: #e11d48"` to `rgb(225, 29, 72)` when Tiptap
parses it back, so without normalization every save would churn the file.
Anything else — a CSS keyword, `hsl()`, a custom property — normalizes to
`null` and is treated as no color.

On the way in, `sanitizeInlineColorStyles` keeps only `color` on a `<span>` and
only `background-color` on a `<mark>`, dropping every other declaration, so a
pasted or hand-written `style` cannot make the note format a general
HTML-styling escape hatch. A `<span>` left with no honored color loses its
`style` and is unwrapped entirely on the next save.

The `==` marked tokenizer matches `[^\n]+?` (non-greedy, single line) rather
than `[^=]+`, because a colored word nested inside a highlight puts an `=` in
the content via `style="…"`.

## Notes rich editor find & replace

In-document find and replace lives behind the 🔍 button in the Notes toolbar
(`features/notes/editor/toolbar/FindReplacePanel.tsx`), backed by
`@tiptap/extension-find-and-replace`. The extension is registered last in
`RichEditorCore` so its match decorations paint above the comment and AI-edit
decorations. State lives on the editor instance
(`editor.storage.findAndReplace`: term, modifiers, `results`, `currentIndex`);
the toolbar is not the component that calls `useEditor`, so the panel subscribes
to `transaction` events to keep the `n / total` counter live.

The panel offers find/replace inputs, prev/next (Enter and Shift+Enter in the
find input), Aa / `ab|` / `.*` modifier toggles, and Replace / Replace all. Regex
mode is RE2-backed, so lookarounds and backreferences are unsupported and an
invalid pattern yields zero matches rather than throwing; whole-word is disabled
in regex mode because the extension ignores it there. Opening the panel seeds the
term from a single-line selection.

Constraints worth knowing: no keyboard shortcut is bound, so `Ctrl+F` remains
native browser find across the whole page (sidebar, TOC, comments, chat panel).
It is rich-mode only — source mode mounts a separate raw-markdown editor — so the
button sits inside the `hidden`-gated formatting group and the panel force-closes
on a switch to source. Closing the panel clears the search term so no orphan
highlights survive — both invariants live in `useFindReplaceToolbarController`.
Content inside NodeViews (`mermaidBlock`, `mathNode`,
`pdfBlock`, `mapBlock`) is outside the searchable text flow and will not match;
fenced code blocks are real ProseMirror text and do match. `replaceAll` is one
transaction, so a single undo reverts it, and it preserves surrounding marks —
including comment marks spanning the replaced text.
Default match styles are disabled (`injectCSS: false`) because the bundled yellow
fill is indistinguishable from the first `HIGHLIGHT_COLORS` shade; `noteEditor.css`
outlines matches instead so one sitting inside a user highlight still reads.
