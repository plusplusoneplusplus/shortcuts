# Markdown Comments & AI Resolution Feature

## Overview

This feature enables users to add inline comments to markdown files within VS Code, similar to GitHub's Pull Request code review experience. Users can select text sections, leave contextual comments, and generate an AI-ready prompt to resolve all comments in one go.

## User Journey

### Phase 1: Adding Comments to Markdown Files

```
┌─────────────────────────────────────────────────────────────────────┐
│                         User Journey Flow                           │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  1. Open .md file  ──►  2. Select text  ──►  3. Add comment        │
│         │                     │                    │                │
│         ▼                     ▼                    ▼                │
│  ┌───────────┐         ┌───────────┐        ┌───────────┐          │
│  │ File opens│         │Text gets  │        │Comment    │          │
│  │ with any  │         │highlighted│        │appears as │          │
│  │ existing  │         │+ context  │        │inline     │          │
│  │ comments  │         │menu shows │        │decoration │          │
│  └───────────┘         └───────────┘        └───────────┘          │
│                                                                     │
│  4. Review comments  ──►  5. Generate prompt  ──►  6. Copy to AI   │
│         │                        │                       │          │
│         ▼                        ▼                       ▼          │
│  ┌───────────┐          ┌───────────┐           ┌───────────┐      │
│  │Comments   │          │Structured │           │Agent      │      │
│  │panel shows│          │prompt with│           │resolves   │      │
│  │all open   │          │file + line│           │comments   │      │
│  │comments   │          │context    │           │           │      │
│  └───────────┘          └───────────┘           └───────────┘      │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Detailed User Stories

### US-1: Select Text and Add Comment

**As a** user reviewing a markdown document,  
**I want to** select a portion of text and add a comment,  
**So that** I can annotate specific sections with feedback or questions.

**Acceptance Criteria:**
- [ ] User can select any text in an open .md file
- [ ] Right-click context menu shows "Add Comment" option
- [ ] Keyboard shortcut available (e.g., `Ctrl+Shift+M` / `Cmd+Shift+M`)
- [ ] Comment input appears inline or in a floating panel near the selection
- [ ] Selected text range is preserved with the comment

**UI Mockup:**
```
┌──────────────────────────────────────────────────────────────────┐
│ document.md                                                    ⚙️│
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  # Project Architecture                                          │
│                                                                  │
│  The system uses a ┌────────────────────────────────────────┐   │
│  microservices     │ 💬 Add Comment                          │   │
│  architecture with ├────────────────────────────────────────┤   │
│  three main        │                                        │   │
│  components:       │ Should we also mention the message     │   │
│  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ │ queue architecture here?               │   │
│  ▓ API Gateway ▓▓ │                                        │   │
│  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ │ ┌─────────┐  ┌─────────┐              │   │
│                    │ │ Cancel  │  │  Save   │              │   │
│                    │ └─────────┘  └─────────┘              │   │
│                    └────────────────────────────────────────┘   │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

---

### US-2: Visual Indication of Commented Sections

**As a** user viewing a markdown file with comments,  
**I want to** see visual indicators for commented sections,  
**So that** I can quickly identify which parts have annotations.

**Acceptance Criteria:**
- [ ] Commented text has a distinct background highlight (e.g., soft yellow/orange)
- [ ] A gutter icon (💬) appears on lines with comments
- [ ] Hover over highlighted text shows comment preview tooltip
- [ ] Click on highlight or gutter icon opens full comment view

**Visual States:**
```
Normal text:        │ The quick brown fox jumps over the lazy dog.
Commented text:     │ The quick ▓▓▓▓▓▓▓▓▓ jumps over the lazy dog.
                    │           ▲
                    │           └── Highlighted with background color
                    │
Gutter indicator:   💬│ The quick ▓▓▓▓▓▓▓▓▓ jumps over the lazy dog.
```

---

### US-3: Comments Panel View

**As a** user managing multiple comments,  
**I want to** see all comments in a dedicated panel,  
**So that** I can navigate and manage them efficiently.

**Acceptance Criteria:**
- [ ] Dedicated tree view in the sidebar showing all comments
- [ ] Comments grouped by file
- [ ] Each comment shows: file path, line range, preview of commented text, comment content
- [ ] Click on comment navigates to the location in the file
- [ ] Status indicators: Open, Resolved, Pending
- [ ] Actions: Edit, Delete, Mark as Resolved

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

### US-4: Generate AI Prompt from Comments

**As a** user who has added comments to markdown files,  
**I want to** generate a structured AI prompt from all open comments,  
**So that** I can get an AI agent to resolve all feedback at once.

**Acceptance Criteria:**
- [ ] "Generate AI Prompt" button in the comments panel toolbar
- [ ] Generates prompt only for "Open" comments (not resolved)
- [ ] Prompt includes file content, line numbers, selected text, and comment
- [ ] Option to select which comments to include
- [ ] Prompt format optimized for AI understanding

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

### Comment 2 (Lines 45-47)
**Selected Text:**
```
The deployment process involves pushing to main branch.
```

**Comment:**
Add more details about CI/CD pipeline

**Requested Action:** Revise this section to address the comment.

---

## File: ARCHITECTURE.md

### Comment 1 (Lines 5-8)
**Selected Text:**
```
Our microservices architecture enables scalable and maintainable code.
```

**Comment:**
Break this into subsections

**Requested Action:** Revise this section to address the comment.

---

# Instructions

1. For each comment above, modify the corresponding section in the file
2. Preserve the overall document structure and formatting
3. After making changes, summarize what was modified

Please provide the updated content for each file.
```

---

### US-5: Copy Prompt to Clipboard

**As a** user who has generated an AI prompt,  
**I want to** easily copy it to clipboard,  
**So that** I can paste it into my AI assistant/agent.

**Acceptance Criteria:**
- [ ] "Copy to Clipboard" button after prompt generation
- [ ] Visual feedback when copied (toast notification)
- [ ] Option to open prompt in a new editor for review before copying
- [ ] Quick action: "Generate & Copy" for one-click workflow

---

### US-6: Mark Comments as Resolved

**As a** user who has received AI-generated changes,  
**I want to** mark comments as resolved after reviewing changes,  
**So that** I can track progress on document feedback.

**Acceptance Criteria:**
- [ ] "Mark as Resolved" action on each comment
- [ ] "Resolve All" button for bulk resolution
- [ ] Resolved comments visually distinct (greyed out, checkmark)
- [ ] Option to hide resolved comments
- [ ] Undo resolution action

---

## Technical Requirements

### TR-1: Comment Storage

Comments should be stored in a separate JSON file to avoid modifying the markdown files:

```
.vscode/
├── shortcuts.yaml         # Existing shortcuts config
└── md-comments.json       # New comments storage
```

**Storage Schema:**
```typescript
interface MarkdownComment {
  id: string;                    // Unique identifier (UUID)
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

### TR-2: VS Code Integration

**Required VS Code APIs:**
- `TextEditorDecorationType` - For highlighting commented sections
- `TreeDataProvider` - For comments panel in sidebar
- `CodeLensProvider` - Optional: Show comment count above sections
- `HoverProvider` - For showing comment preview on hover
- `Commands` - For context menu and keyboard shortcuts
- `Webview` - For rich comment editing (if needed)

**Extension Points:**
```json
{
  "contributes": {
    "views": {
      "shortcuts": [
        {
          "id": "markdownComments",
          "name": "Markdown Comments"
        }
      ]
    },
    "commands": [
      {
        "command": "shortcuts.addMarkdownComment",
        "title": "Add Comment",
        "category": "Markdown Comments"
      },
      {
        "command": "shortcuts.generateAIPrompt",
        "title": "Generate AI Prompt",
        "category": "Markdown Comments"
      },
      {
        "command": "shortcuts.resolveComment",
        "title": "Mark as Resolved",
        "category": "Markdown Comments"
      }
    ],
    "menus": {
      "editor/context": [
        {
          "command": "shortcuts.addMarkdownComment",
          "when": "editorHasSelection && resourceExtname == .md",
          "group": "comments"
        }
      ]
    },
    "keybindings": [
      {
        "command": "shortcuts.addMarkdownComment",
        "key": "ctrl+shift+m",
        "mac": "cmd+shift+m",
        "when": "editorHasSelection && resourceExtname == .md"
      }
    ]
  }
}
```

---

### TR-3: Prompt Generation Engine

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
| Comment Highlight | `rgba(255, 235, 59, 0.3)` | `rgba(255, 235, 59, 0.2)` |
| Resolved Highlight | `rgba(76, 175, 80, 0.2)` | `rgba(76, 175, 80, 0.15)` |
| Gutter Icon | `#FFC107` | `#FFD54F` |
| Panel Background | VS Code default | VS Code default |

### Iconography

| Action | Icon | Description |
|--------|------|-------------|
| Add Comment | 💬 | Speech bubble |
| Resolved | ✓ | Checkmark |
| Open | ○ | Empty circle |
| Generate Prompt | 🤖 | Robot |
| Copy | 📋 | Clipboard |
| Delete | 🗑️ | Trash |

---

## Workflow Diagram

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Open MD   │────►│  Select     │────►│   Add       │
│    File     │     │   Text      │     │  Comment    │
└─────────────┘     └─────────────┘     └─────────────┘
                                              │
                                              ▼
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Copy to   │◄────│  Generate   │◄────│   Review    │
│  Clipboard  │     │ AI Prompt   │     │  Comments   │
└─────────────┘     └─────────────┘     └─────────────┘
      │
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
└─────────────┘
```

---

## Implementation Phases

### Phase 1: Core Commenting (MVP)
- [ ] Add comment to selected text
- [ ] Store comments in JSON file
- [ ] Display comments with text highlighting
- [ ] Basic comments panel with list view
- [ ] Delete and edit comments

### Phase 2: AI Prompt Generation
- [ ] Generate AI prompt from open comments
- [ ] Copy prompt to clipboard
- [ ] Customizable prompt templates
- [ ] Preview prompt before copying

### Phase 3: Enhanced UX
- [ ] Hover previews
- [ ] Gutter icons
- [ ] Status management (open/resolved)
- [ ] Keyboard navigation
- [ ] Search/filter comments

### Phase 4: Advanced Features
- [ ] Comment threads/replies
- [ ] Tags and categorization
- [ ] Export comments to markdown
- [ ] Sync with cloud providers
- [ ] Multi-file prompt generation

---

## Success Metrics

| Metric | Target |
|--------|--------|
| Time to add first comment | < 3 seconds |
| Time to generate prompt | < 1 second |
| Comments visible after file reopen | 100% |
| Prompt generation accuracy | All open comments included |

---

## Open Questions

1. **Thread Support**: Should comments support replies/threads like GitHub PRs?
2. **Collaboration**: Should comments sync across team members?
3. **AI Integration**: Direct integration with AI APIs vs clipboard-based workflow?
4. **File Types**: Extend beyond .md to other text files?
5. **Versioning**: How to handle comments when file content changes?

---

## Appendix: Example Prompt Output

```markdown
# Document Revision Request

I need help revising a markdown document based on review comments. 
Please address each comment below and provide the updated content.

## Context

**File:** `README.md`
**Total Comments:** 3

---

## Comment #1

**Location:** Lines 12-15  
**Selected Text:**
> The system uses a microservices architecture with three main components: API Gateway, User Service, and Data Service.

**Feedback:**  
Should we also mention the message queue architecture here? It's a key component.

**Action Required:** Expand this section to include information about the message queue.

---

## Comment #2

**Location:** Lines 45-47  
**Selected Text:**
> The deployment process involves pushing to main branch.

**Feedback:**  
Add more details about CI/CD pipeline - specifically mention GitHub Actions and staging environment.

**Action Required:** Elaborate on the deployment process with CI/CD details.

---

## Comment #3

**Location:** Lines 78-80  
**Selected Text:**
> All API endpoints are available at /api/v1/

**Feedback:**  
Consider adding rate limiting info - we have 100 req/min for free tier.

**Action Required:** Add rate limiting information to this section.

---

## Instructions for AI Agent

1. Read each comment and understand the requested change
2. Modify the relevant section to address the feedback
3. Maintain the existing document style and formatting
4. Provide the complete updated sections (not just diffs)
5. After all changes, provide a brief summary of modifications

Please proceed with the revisions.
```

---

## Related Documents

- [SYNC_IMPLEMENTATION.md](./SYNC_IMPLEMENTATION.md) - For cloud sync of comments
- [CLAUDE.md](../CLAUDE.md) - Main project documentation

---

*Document Version: 1.0*  
*Last Updated: December 2025*  
*Author: [Your Name]*

