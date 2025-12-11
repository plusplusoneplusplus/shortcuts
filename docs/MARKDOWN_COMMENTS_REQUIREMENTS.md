# Markdown Comments & AI Resolution Feature

## Overview

This feature enables users to add inline comments to markdown files within VS Code, similar to GitHub's Pull Request code review experience. Users can select text sections, leave contextual comments, and generate an AI-ready prompt to resolve all comments in one go.

**Implementation:** Uses a **Custom Editor (Review Editor View)** that provides a side-by-side editing experience with inline comment visualization.

## User Journey

### Phase 1: Adding Comments to Markdown Files

```
┌─────────────────────────────────────────────────────────────────────┐
│                         User Journey Flow                           │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  1. Open .md file  ──►  2. Select text  ──►  3. Add comment        │
│  (Review Editor)              │                    │                │
│         │                     ▼                    ▼                │
│         ▼              ┌───────────┐        ┌───────────┐          │
│  ┌───────────┐         │Text gets  │        │Floating   │          │
│  │ File opens│         │highlighted│        │panel opens│          │
│  │ in Review │         │+ context  │        │for comment│          │
│  │ Editor    │         │menu shows │        │input      │          │
│  └───────────┘         └───────────┘        └───────────┘          │
│                                                                     │
│  4. Review comments  ──►  5. Generate prompt  ──►  6. Copy to AI   │
│         │                        │                       │          │
│         ▼                        ▼                       ▼          │
│  ┌───────────┐          ┌───────────┐           ┌───────────┐      │
│  │Click      │          │Toolbar    │           │Agent      │      │
│  │highlight  │          │button     │           │resolves   │      │
│  │to view    │          │generates  │           │comments   │      │
│  │comment    │          │prompt     │           │           │      │
│  └───────────┘          └───────────┘           └───────────┘      │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Detailed User Stories

### US-1: Select Text and Add Comment ✅ IMPLEMENTED

**As a** user reviewing a markdown document,  
**I want to** select a portion of text and add a comment,  
**So that** I can annotate specific sections with feedback or questions.

**Acceptance Criteria:**
- [x] User can open .md file with "Open with Review Editor" context menu
- [x] Right-click context menu shows "Add Comment" option (when text selected)
- [x] Keyboard shortcut available (`Ctrl+Shift+M` / `Cmd+Shift+M`)
- [x] Comment input appears in a floating panel near the selection
- [x] Selected text range is preserved with the comment
- [x] Context menu also includes Cut, Copy, Paste for standard editing

**UI Mockup:**
```
┌──────────────────────────────────────────────────────────────────┐
│ document.md - Review Editor View                               ⚙️│
├──────────────────────────────────────────────────────────────────┤
│ ┌─ Toolbar ───────────────────────────────────────────────────┐ │
│ │ ✅ Resolve All │ 🤖 Generate Prompt │ 📋 Copy Prompt │ ☑ Show│ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  # Project Architecture                                          │
│                                                                  │
│  The system uses a ┌────────────────────────────────────────┐   │
│  microservices     │ 💬 Add Comment                          │   │
│  architecture with ├────────────────────────────────────────┤   │
│  three main        │ Selected: "microservices architecture" │   │
│  components:       │                                        │   │
│  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ │ Should we also mention the message     │   │
│  ▓ API Gateway ▓▓ │ queue architecture here?               │   │
│  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ │                                        │   │
│                    │ ┌─────────┐  ┌─────────────┐          │   │
│                    │ │ Cancel  │  │ Add Comment │          │   │
│                    │ └─────────┘  └─────────────┘          │   │
│                    └────────────────────────────────────────┘   │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

---

### US-2: Visual Indication of Commented Sections ✅ IMPLEMENTED

**As a** user viewing a markdown file with comments,  
**I want to** see visual indicators for commented sections,  
**So that** I can quickly identify which parts have annotations.

**Acceptance Criteria:**
- [x] Commented text has a distinct background highlight (yellow for open, green for resolved)
- [x] A gutter icon (💬) appears on lines with comments
- [x] Click on highlighted text shows comment bubble inline
- [x] Click on gutter icon opens comment view
- [x] Comment bubble shows comment text with action buttons (Resolve, Edit, Delete)

**Visual States (in Review Editor View):**
```
Normal text:        │ The quick brown fox jumps over the lazy dog.
Commented (open):   │ The quick ▓▓▓▓▓▓▓▓▓ jumps over the lazy dog.
                    │           ▲ (yellow highlight)
                    │
Commented (resolved):│ The quick ░░░░░░░░░ jumps over the lazy dog.
                    │           ▲ (green highlight, strikethrough)
                    │
Gutter indicator: 💬│ The quick ▓▓▓▓▓▓▓▓▓ jumps over the lazy dog.
                    │
On click:         💬│ The quick ▓▓▓▓▓▓▓▓▓ jumps over the lazy dog.
                    │ ┌─────────────────────────────────────────┐
                    │ │ 💬 Comment                    ✓ ✏️ 🗑️ │
                    │ │ Should clarify this section            │
                    │ │ ─────────────────────────────────────  │
                    │ │ 📅 Dec 10, 2025                        │
                    │ └─────────────────────────────────────────┘
```

---

### US-3: Comments Panel View ✅ IMPLEMENTED

**As a** user managing multiple comments,  
**I want to** see all comments in a dedicated panel,  
**So that** I can navigate and manage them efficiently.

**Acceptance Criteria:**
- [x] Dedicated tree view in the sidebar showing all comments
- [x] Comments grouped by file
- [x] Each comment shows: file path, line range, preview of commented text, comment content
- [x] Click on comment navigates to the location in Review Editor View
- [x] Status indicators: Open (○), Resolved (✓)
- [x] Actions: Delete, Mark as Resolved, Reopen (via context menu)

**Panel Layout:**
```
┌──────────────────────────────────────────────────────────────┐
│ 📝 MARKDOWN COMMENTS                              ⟳ 🤖 ⋮    │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│ 📁 README.md (3 comments)                                    │
│   ├─ 💬 Lines 12-15: "system architecture"                   │
│   │     Should we mention the message queue?                 │
│   │     ○ Open                                               │
│   │                                                          │
│   ├─ 💬 Lines 45-47: "deployment process"                    │
│   │     Add more details about CI/CD pipeline                │
│   │     ○ Open                                               │
│   │                                                          │
│   └─ 💬 Lines 78-80: "API endpoints"                         │
│         Consider adding rate limiting info                    │
│         ✓ Resolved                                           │
│                                                              │
│ 📁 ARCHITECTURE.md (1 comment)                               │
│   └─ 💬 Lines 5-8: "microservices"                           │
│         Break this into subsections                          │
│         ○ Open                                               │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

---

### US-4: Generate AI Prompt from Comments ✅ IMPLEMENTED

**As a** user who has added comments to markdown files,  
**I want to** generate a structured AI prompt from all open comments,  
**So that** I can get an AI agent to resolve all feedback at once.

**Acceptance Criteria:**
- [x] "Generate Prompt" button in Review Editor View toolbar
- [x] Generates prompt only for "Open" comments (not resolved)
- [x] Prompt includes file content, line numbers, selected text, and comment
- [x] Prompt format optimized for AI understanding

**Generated Prompt Format:**
```markdown
# Document Revision Request

Please review and address the following comments in the markdown files.
For each comment, make the necessary changes to the document.

---

## File: README.md

### Comment 1 (Lines 12-15)
**Selected Text:**
```
The system uses a microservices architecture with three main components: API Gateway, User Service, and Data Service.
```

**Comment:**
Should we also mention the message queue architecture here?

**Requested Action:** Revise this section to address the comment.

---

# Instructions

1. For each comment above, modify the corresponding section in the file
2. Preserve the overall document structure and formatting
3. After making changes, summarize what was modified

Please provide the updated content for each file.
```

---

### US-5: Copy Prompt to Clipboard ✅ IMPLEMENTED

**As a** user who has generated an AI prompt,  
**I want to** easily copy it to clipboard,  
**So that** I can paste it into my AI assistant/agent.

**Acceptance Criteria:**
- [x] "Copy Prompt" button in Review Editor View toolbar
- [x] Visual feedback when copied (notification)
- [x] Option to open prompt in a new editor for review ("Generate Prompt" shows in new tab)

---

### US-6: Mark Comments as Resolved ✅ IMPLEMENTED

**As a** user who has received AI-generated changes,  
**I want to** mark comments as resolved after reviewing changes,  
**So that** I can track progress on document feedback.

**Acceptance Criteria:**
- [x] "Mark as Resolved" action on each comment (via inline bubble or tree view)
- [x] "Resolve All" button in toolbar for bulk resolution
- [x] Resolved comments visually distinct (green highlight, strikethrough)
- [x] Option to show/hide resolved comments (toolbar checkbox)
- [x] Undo resolution action (Reopen)

---

## Technical Requirements

### TR-1: Comment Storage ✅ IMPLEMENTED

Comments are stored in a separate JSON file to avoid modifying the markdown files:

```
.vscode/
├── shortcuts.yaml         # Existing shortcuts config
└── md-comments.json       # Comments storage
```

**Storage Schema:**
```typescript
interface MarkdownComment {
  id: string;                    // Unique identifier (comment_timestamp_random)
  filePath: string;              // Relative path to .md file
  selection: {
    startLine: number;           // 1-based line number
    startColumn: number;         // 1-based column number
    endLine: number;
    endColumn: number;
  };
  selectedText: string;          // The actual selected text (for reference)
  comment: string;               // User's comment content
  status: 'open' | 'resolved' | 'pending';
  createdAt: string;             // ISO timestamp
  updatedAt: string;             // ISO timestamp
  author?: string;               // Optional author name
  tags?: string[];               // Optional tags for categorization
}

interface CommentsConfig {
  version: number;
  comments: MarkdownComment[];
  settings?: {
    showResolved: boolean;
    highlightColor: string;
  };
}
```

---

### TR-2: VS Code Integration ✅ IMPLEMENTED

**Required VS Code APIs (Current Implementation):**
- `CustomTextEditorProvider` - For Review Editor View (rich webview-based editor)
- `TreeDataProvider` - For comments panel in sidebar
- `Commands` - For context menu and keyboard shortcuts
- `Webview` - For rich comment editing UI

**Removed (in favor of Review Editor View):**
- ~~`TextEditorDecorationType`~~ - Replaced by webview highlights
- ~~`HoverProvider`~~ - Replaced by inline click-to-view
- ~~`CodeLensProvider`~~ - Not needed with Review Editor View

**Extension Points:**
```json
{
  "contributes": {
    "views": {
      "shortcuts": [
        {
          "id": "markdownCommentsView",
          "name": "Markdown Comments"
        }
      ]
    },
    "customEditors": [
      {
        "viewType": "reviewEditorView",
        "displayName": "Review Editor View",
        "selector": [{ "filenamePattern": "*.md" }],
        "priority": "option"
      }
    ],
    "commands": [
      {
        "command": "markdownComments.openWithReviewEditor",
        "title": "Open with Review Editor"
      },
      {
        "command": "markdownComments.resolveComment",
        "title": "Mark as Resolved"
      },
      {
        "command": "markdownComments.reopenComment",
        "title": "Reopen Comment"
      },
      {
        "command": "markdownComments.deleteComment",
        "title": "Delete Comment"
      },
      {
        "command": "markdownComments.resolveAll",
        "title": "Resolve All Comments"
      },
      {
        "command": "markdownComments.generatePrompt",
        "title": "Generate AI Prompt"
      },
      {
        "command": "markdownComments.generateAndCopyPrompt",
        "title": "Generate & Copy AI Prompt"
      },
      {
        "command": "markdownComments.goToComment",
        "title": "Go to Comment"
      },
      {
        "command": "markdownComments.toggleShowResolved",
        "title": "Toggle Show Resolved"
      },
      {
        "command": "markdownComments.refresh",
        "title": "Refresh Comments"
      }
    ],
    "menus": {
      "explorer/context": [
        {
          "command": "markdownComments.openWithReviewEditor",
          "when": "resourceExtname == .md"
        }
      ]
    }
  }
}
```

---

### TR-3: Prompt Generation Engine ✅ IMPLEMENTED

**Prompt Template Variables:**
- `{{FILE_PATH}}` - Relative path to the file
- `{{LINE_RANGE}}` - Start and end line numbers
- `{{SELECTED_TEXT}}` - The text that was commented on
- `{{COMMENT}}` - The user's comment
- `{{FULL_FILE_CONTENT}}` - Optional: include entire file for context

**Customization Options:**
```typescript
interface PromptGenerationOptions {
  includeFullFileContent: boolean;    // Include entire file in prompt
  groupByFile: boolean;               // Group comments by file
  includeLineNumbers: boolean;        // Include exact line numbers
  customPreamble?: string;            // Custom instructions at the start
  customInstructions?: string;        // Custom instructions at the end
  maxCommentsPerPrompt?: number;      // Split large prompts
  outputFormat: 'markdown' | 'json';  // Prompt output format
}
```

---

## UI/UX Specifications

### Color Scheme

| Element | Light Theme | Dark Theme |
|---------|-------------|------------|
| Open Comment Highlight | `rgba(255, 235, 59, 0.3)` | `rgba(255, 235, 59, 0.2)` |
| Resolved Highlight | `rgba(76, 175, 80, 0.2)` | `rgba(76, 175, 80, 0.15)` |
| Gutter Icon | `#FFC107` | `#FFD54F` |
| Comment Bubble BG | VS Code panel background | VS Code panel background |

### Iconography

| Action | Icon | Description |
|--------|------|-------------|
| Add Comment | 💬 | Speech bubble |
| Resolved | ✓ | Checkmark |
| Open | ○ | Empty circle |
| Generate Prompt | 🤖 | Robot |
| Copy | 📋 | Clipboard |
| Delete | 🗑️ | Trash |
| Edit | ✏️ | Pencil |
| Resolve All | ✅ | Checkmark box |

---

## Workflow Diagram

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│ Right-click │────►│  Select     │────►│   Add       │
│ "Open with  │     │   Text      │     │  Comment    │
│ Review Ed." │     │             │     │ (Ctrl+Shift │
└─────────────┘     └─────────────┘     │  +M or R-   │
                                        │  click)     │
                                        └─────────────┘
                                              │
                                              ▼
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Copy to   │◄────│  Generate   │◄────│   Review    │
│  Clipboard  │     │ AI Prompt   │     │  Comments   │
│ (toolbar)   │     │ (toolbar)   │     │ (click hi-  │
└─────────────┘     └─────────────┘     │ lighted txt)│
      │                                 └─────────────┘
      ▼
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Paste to   │────►│    AI       │────►│   Review    │
│  AI Agent   │     │  Resolves   │     │  Changes    │
└─────────────┘     └─────────────┘     └─────────────┘
      │
      ▼
┌─────────────┐
│   Mark as   │
│  Resolved   │
│ (inline or  │
│  toolbar)   │
└─────────────┘
```

---

## Implementation Status

### Phase 1: Core Commenting (MVP) ✅ COMPLETE
- [x] Add comment to selected text (via floating panel)
- [x] Store comments in JSON file
- [x] Display comments with inline highlighting
- [x] Comments panel with tree view
- [x] Delete and edit comments

### Phase 2: AI Prompt Generation ✅ COMPLETE
- [x] Generate AI prompt from open comments
- [x] Copy prompt to clipboard
- [x] Preview prompt in new editor
- [x] Exclude resolved comments from prompt

### Phase 3: Enhanced UX ✅ COMPLETE
- [x] Inline comment bubbles (click to view)
- [x] Gutter icons
- [x] Status management (open/resolved/reopen)
- [x] Keyboard shortcuts (Ctrl+Shift+M)
- [x] Context menu with Cut/Copy/Paste/Add Comment
- [x] Show/hide resolved comments toggle

### Phase 4: Advanced Features 🔄 FUTURE
- [ ] Comment threads/replies
- [ ] Tags and categorization
- [ ] Export comments to markdown
- [ ] Sync with cloud providers
- [ ] Multi-file prompt generation

---

## Architecture

### File Structure
```
src/shortcuts/markdown-comments/
├── index.ts                      # Module exports
├── types.ts                      # TypeScript interfaces
├── comments-manager.ts           # Data layer (CRUD, persistence)
├── comments-tree-provider.ts     # Sidebar tree view
├── comments-commands.ts          # VS Code command handlers
├── review-editor-view-provider.ts # Custom editor provider
├── webview-content.ts            # Webview HTML/CSS/JS
└── prompt-generator.ts           # AI prompt generation
```

### Key Classes

| Class | Responsibility |
|-------|---------------|
| `CommentsManager` | Comment CRUD, persistence, events |
| `MarkdownCommentsTreeDataProvider` | Sidebar tree view |
| `MarkdownCommentsCommands` | Command registration and handling |
| `ReviewEditorViewProvider` | Custom editor webview |
| `PromptGenerator` | AI prompt creation |

### Event Flow
```
User Action (webview)
       │
       ▼
ReviewEditorViewProvider.handleWebviewMessage()
       │
       ▼
CommentsManager.addComment() / updateComment() / etc.
       │
       ▼
CommentsManager.onDidChangeComments event
       │
       ├──► MarkdownCommentsTreeDataProvider.refresh()
       │
       └──► ReviewEditorViewProvider.syncCommentsToWebview()
```

---

## Success Metrics

| Metric | Target | Status |
|--------|--------|--------|
| Time to add first comment | < 3 seconds | ✅ Achieved |
| Time to generate prompt | < 1 second | ✅ Achieved |
| Comments visible after file reopen | 100% | ✅ Achieved |
| Prompt generation accuracy | All open comments included | ✅ Achieved |

---

## Usage Guide

### Opening a File in Review Editor View
1. Right-click any `.md` file in Explorer
2. Select "Open with Review Editor"
3. File opens with comment editing capabilities

### Adding a Comment
1. Select text in the Review Editor View
2. Either:
   - Press `Ctrl+Shift+M` (Windows/Linux) or `Cmd+Shift+M` (Mac)
   - Right-click and select "Add Comment"
3. Enter your comment in the floating panel
4. Click "Add Comment" to save

### Viewing Comments
- Click on highlighted text to see the comment bubble
- Click on 💬 gutter icon to see the comment
- Use the sidebar tree view to see all comments

### Managing Comments
- **Edit**: Click ✏️ in the comment bubble
- **Resolve**: Click ✓ in the comment bubble or use tree view context menu
- **Delete**: Click 🗑️ in the comment bubble or use tree view context menu
- **Resolve All**: Click "✅ Resolve All" in the toolbar

### Generating AI Prompt
1. Add comments to your markdown files
2. Click "🤖 Generate Prompt" to preview in new tab
3. Or click "📋 Copy Prompt" to copy directly to clipboard
4. Paste into your AI assistant

---

## Open Questions

1. **Thread Support**: Should comments support replies/threads like GitHub PRs?
2. **Collaboration**: Should comments sync across team members?
3. **AI Integration**: Direct integration with AI APIs vs clipboard-based workflow?
4. **File Types**: Extend beyond .md to other text files?
5. **Versioning**: How to handle comments when file content changes?

---

## Related Documents

- [SYNC_IMPLEMENTATION.md](./SYNC_IMPLEMENTATION.md) - For cloud sync of comments
- [CLAUDE.md](../CLAUDE.md) - Main project documentation

---

*Document Version: 2.0*  
*Last Updated: December 2025*  
*Implementation: Review Editor View (Custom Editor)*
