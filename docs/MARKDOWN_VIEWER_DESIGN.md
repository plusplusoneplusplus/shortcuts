# Markdown Viewer Enhancement Design Document

## Overview

This document outlines the design for enhancing the Review Editor View with:
1. **Markdown Syntax Highlighting** - Visual distinction for markdown elements (headings, code blocks, links, etc.)
2. **Code Block Syntax Highlighting** - Language-specific syntax highlighting for fenced code blocks
3. **Mermaid Diagram Rendering** - Interactive rendering of mermaid diagrams with comment support

---

## Current State

The Review Editor View (`review-editor-view-provider.ts` + `webview-content.ts`) currently:
- Displays markdown files as plain text with line numbers
- Supports inline text selection and commenting
- Uses a contenteditable div for editing
- Renders comments as highlighted overlays

**Current Limitations:**
- No visual distinction between markdown elements
- Code blocks appear as plain text without syntax highlighting
- Mermaid diagrams display as raw text (not rendered)

---

## Design Goals

| Goal | Priority | Description |
|------|----------|-------------|
| Markdown syntax highlighting | P0 | Visual distinction for headings, bold, italic, links, lists, etc. |
| Code block highlighting | P0 | Language-specific highlighting (JS, Python, etc.) |
| Mermaid diagram rendering | P1 | Render diagrams visually with SVG |
| Diagram commenting | P1 | Allow comments on mermaid diagram sections |
| Performance | P0 | No noticeable lag on files up to 5000 lines |
| Theme compatibility | P0 | Work with VSCode light and dark themes |

---

## Solution Options Analysis

### Option 1: CSS-Only Markdown Highlighting

**Approach:** Apply CSS classes during rendering based on regex pattern matching.

**Pros:**
- Lightweight, no external dependencies
- Full control over styling
- Works with existing contenteditable approach

**Cons:**
- Complex regex patterns needed
- Limited code block language support
- Must maintain regex patterns manually

**Verdict:** ✅ Recommended for basic markdown elements

---

### Option 2: Highlight.js for Code Blocks

**Approach:** Use [highlight.js](https://highlightjs.org/) to syntax highlight code blocks.

**Pros:**
- Industry standard, battle-tested
- Supports 190+ languages
- Theme support (including VSCode-like themes)
- 45KB core + ~3KB per language
- Works with text-only input (no DOM manipulation required)

**Cons:**
- External dependency
- Requires CSP adjustments for loading
- Need to bundle only required languages

**Verdict:** ✅ Recommended for code block highlighting

---

### Option 3: Prism.js for Code Blocks

**Approach:** Use [Prism.js](https://prismjs.com/) for syntax highlighting.

**Pros:**
- Lightweight (~6KB core)
- Good language support
- Plugin ecosystem

**Cons:**
- Requires DOM elements (not just text)
- Less comprehensive than highlight.js

**Verdict:** ⚠️ Alternative to highlight.js if size is critical

---

### Option 4: Monaco Editor

**Approach:** Embed Monaco Editor (VSCode's editor) in the webview.

**Pros:**
- Identical to VSCode editing experience
- Built-in language support
- Tokenization API

**Cons:**
- Very heavy (5MB+)
- Complex integration
- Harder to add comment overlay system
- Overkill for markdown viewing

**Verdict:** ❌ Not recommended (too heavy, complex integration)

---

### Option 5: Mermaid.js for Diagram Rendering

**Approach:** Use [mermaid.js](https://mermaid.js.org/) to render diagrams.

**Pros:**
- Official library, actively maintained
- Comprehensive diagram support (flowcharts, sequences, Gantt, etc.)
- SVG output for crisp rendering
- Theming support

**Cons:**
- ~1.6MB bundle size
- SVG elements require special handling for commenting
- Need to parse mermaid blocks from markdown

**Verdict:** ✅ Recommended (no real alternatives)

---

## Recommended Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Review Editor View                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                         Toolbar                                      │   │
│  │  [Resolve All] [Generate Prompt] [Copy Prompt] [☑ Show Resolved]    │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌───────┬─────────────────────────────────────────────────────────────┐   │
│  │ Line  │                    Content Area                              │   │
│  │Numbers│                                                              │   │
│  │       │  ┌───────────────────────────────────────────────────────┐  │   │
│  │   1   │  │ # Heading 1                    ← Markdown Highlighting │  │   │
│  │   2   │  │                                                       │  │   │
│  │   3   │  │ Some **bold** and *italic* text                       │  │   │
│  │   4   │  │                                                       │  │   │
│  │   5   │  │ ```javascript                  ← Code Highlighting    │  │   │
│  │   6   │  │ const x = 42;                     (highlight.js)      │  │   │
│  │   7   │  │ ```                                                   │  │   │
│  │   8   │  │                                                       │  │   │
│  │   9   │  │ ```mermaid                     ← Mermaid Rendering    │  │   │
│  │  10   │  │ graph TD                          (mermaid.js)        │  │   │
│  │  11   │  │   A --> B                                             │  │   │
│  │  12   │  │ ```                                                   │  │   │
│  │       │  │                                                       │  │   │
│  │       │  │  ┌──────────────────────────┐                        │  │   │
│  │       │  │  │    [A] ──────► [B]       │  ← Rendered SVG        │  │   │
│  │       │  │  │                          │     (Clickable for     │  │   │
│  │       │  │  └──────────────────────────┘     comments)          │  │   │
│  │       │  │                                                       │  │   │
│  │       │  └───────────────────────────────────────────────────────┘  │   │
│  └───────┴─────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Implementation Design

### Phase 1: Markdown Syntax Highlighting (CSS-Based)

#### Approach
Apply CSS classes to markdown elements during the render phase using regex pattern matching.

#### Supported Elements

| Element | Pattern | CSS Class | Example Display |
|---------|---------|-----------|-----------------|
| H1 | `^# .+` | `.md-h1` | Large, bold |
| H2 | `^## .+` | `.md-h2` | Medium, bold |
| H3-H6 | `^#{3,6} .+` | `.md-h3` to `.md-h6` | Smaller headings |
| Bold | `\*\*.+?\*\*` or `__.+?__` | `.md-bold` | **Bold text** |
| Italic | `\*.+?\*` or `_.+?_` | `.md-italic` | *Italic text* |
| Strikethrough | `~~.+?~~` | `.md-strike` | ~~Strikethrough~~ |
| Inline code | `` `.+?` `` | `.md-inline-code` | `code` |
| Link | `\[.+?\]\(.+?\)` | `.md-link` | [link](url) |
| Image | `!\[.+?\]\(.+?\)` | `.md-image` | Image reference |
| Blockquote | `^> .+` | `.md-blockquote` | Indented, styled |
| List item | `^[\-\*\+] .+` or `^\d+\. .+` | `.md-list-item` | Bullet/number |
| Horizontal rule | `^---+$` or `^\*\*\*+$` | `.md-hr` | Line separator |
| Code fence start | `^\`\`\`.+` | `.md-code-fence` | Distinct background |

#### CSS Variables (Theme Compatible)

```css
:root {
    /* Markdown syntax colors */
    --md-heading-color: var(--vscode-textPreformat-foreground);
    --md-bold-color: inherit;
    --md-italic-color: inherit;
    --md-code-bg: var(--vscode-textCodeBlock-background);
    --md-code-color: var(--vscode-textPreformat-foreground);
    --md-link-color: var(--vscode-textLink-foreground);
    --md-blockquote-color: var(--vscode-textBlockQuote-foreground);
    --md-blockquote-border: var(--vscode-textBlockQuote-border);
    --md-list-marker-color: var(--vscode-textPreformat-foreground);
}
```

#### Implementation in `webview-content.ts`

```typescript
function applyMarkdownHighlighting(line: string): string {
    let html = escapeHtml(line);
    
    // Heading detection (must check for # at start of line)
    if (/^#{1,6}\s/.test(line)) {
        const level = line.match(/^(#{1,6})/)?.[1].length || 1;
        html = `<span class="md-h${level}">${html}</span>`;
        return html;
    }
    
    // Blockquote
    if (/^>\s/.test(line)) {
        html = `<span class="md-blockquote">${html}</span>`;
        return html;
    }
    
    // List items
    if (/^[\-\*\+]\s/.test(line) || /^\d+\.\s/.test(line)) {
        html = `<span class="md-list-item">${html}</span>`;
    }
    
    // Inline patterns (order matters - process from most specific to least)
    // Code backticks (must be before bold/italic to avoid conflicts)
    html = html.replace(/`([^`]+)`/g, '<span class="md-inline-code">$&</span>');
    
    // Bold (** or __)
    html = html.replace(/\*\*([^*]+)\*\*/g, '<span class="md-bold">$&</span>');
    html = html.replace(/__([^_]+)__/g, '<span class="md-bold">$&</span>');
    
    // Italic (* or _) - careful not to match bold patterns
    html = html.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<span class="md-italic">$&</span>');
    html = html.replace(/(?<!_)_([^_]+)_(?!_)/g, '<span class="md-italic">$&</span>');
    
    // Strikethrough
    html = html.replace(/~~([^~]+)~~/g, '<span class="md-strike">$&</span>');
    
    // Links [text](url)
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<span class="md-link">$&</span>');
    
    // Images ![alt](url)
    html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<span class="md-image">$&</span>');
    
    return html;
}
```

---

### Phase 2: Code Block Syntax Highlighting (highlight.js)

#### Library Selection: highlight.js

- **Version:** 11.x (latest stable)
- **Bundle Strategy:** Core + common languages only
- **Bundled Languages:** javascript, typescript, python, json, yaml, bash, html, css, sql, markdown, rust, go, java, c, cpp

#### Integration Approach

**Option A: CDN Loading (Simpler but requires internet)**
```html
<script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"></script>
```

**Option B: Bundled (Recommended for VSCode extensions)**
- Copy minified highlight.js into `resources/vendor/`
- Load as local resource with proper CSP

#### CSP Modification

```typescript
// Current CSP
`default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';`

// No change needed if bundled locally
// highlight.js operates on strings, no eval or dynamic code
```

#### Code Block Detection & Rendering

```typescript
interface CodeBlock {
    language: string;
    code: string;
    startLine: number;
    endLine: number;
}

function parseCodeBlocks(content: string): CodeBlock[] {
    const lines = content.split('\n');
    const blocks: CodeBlock[] = [];
    let inBlock = false;
    let currentBlock: Partial<CodeBlock> = {};
    let codeLines: string[] = [];
    
    lines.forEach((line, index) => {
        const fenceMatch = line.match(/^```(\w*)/);
        
        if (fenceMatch && !inBlock) {
            inBlock = true;
            currentBlock = {
                language: fenceMatch[1] || 'plaintext',
                startLine: index + 1
            };
            codeLines = [];
        } else if (line.startsWith('```') && inBlock) {
            inBlock = false;
            currentBlock.endLine = index + 1;
            currentBlock.code = codeLines.join('\n');
            blocks.push(currentBlock as CodeBlock);
        } else if (inBlock) {
            codeLines.push(line);
        }
    });
    
    return blocks;
}

function highlightCodeBlock(code: string, language: string): string {
    // Use highlight.js
    if (hljs.getLanguage(language)) {
        return hljs.highlight(code, { language }).value;
    }
    // Fallback for unknown languages
    return hljs.highlightAuto(code).value;
}
```

#### Rendering Code Blocks in Webview

```typescript
function renderCodeBlock(block: CodeBlock): string {
    const highlightedCode = highlightCodeBlock(block.code, block.language);
    const lines = highlightedCode.split('\n');
    
    return `
        <div class="code-block" data-start-line="${block.startLine}" data-end-line="${block.endLine}">
            <div class="code-block-header">
                <span class="code-language">${block.language}</span>
                <button class="code-copy-btn" title="Copy code">📋</button>
            </div>
            <pre class="code-block-content"><code class="hljs language-${block.language}">${
                lines.map((line, i) => 
                    `<span class="code-line" data-line="${block.startLine + i + 1}">${line}</span>`
                ).join('\n')
            }</code></pre>
        </div>
    `;
}
```

#### CSS for Code Blocks

```css
.code-block {
    margin: 12px 0;
    border-radius: 6px;
    overflow: hidden;
    border: 1px solid var(--vscode-panel-border);
}

.code-block-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 6px 12px;
    background: var(--vscode-editorGroupHeader-tabsBackground);
    border-bottom: 1px solid var(--vscode-panel-border);
}

.code-language {
    font-size: 11px;
    font-weight: 500;
    color: var(--vscode-descriptionForeground);
    text-transform: uppercase;
}

.code-block-content {
    margin: 0;
    padding: 12px;
    overflow-x: auto;
    background: var(--vscode-editor-background);
}

.code-block-content code {
    font-family: var(--vscode-editor-font-family);
    font-size: var(--vscode-editor-font-size);
    line-height: 1.5;
}

.code-line {
    display: block;
}

/* Selectable code for commenting */
.code-line::selection {
    background: var(--vscode-editor-selectionBackground);
}

.code-line:hover {
    background: var(--vscode-list-hoverBackground);
}
```

#### Highlight.js Theme Integration

Use VSCode-compatible themes that adapt to light/dark mode:

```css
/* Import VSCode-style highlight theme */
@media (prefers-color-scheme: dark) {
    /* Dark theme colors */
    .hljs-keyword { color: #569cd6; }
    .hljs-string { color: #ce9178; }
    .hljs-number { color: #b5cea8; }
    .hljs-comment { color: #6a9955; }
    .hljs-function { color: #dcdcaa; }
    .hljs-variable { color: #9cdcfe; }
    .hljs-type { color: #4ec9b0; }
}

@media (prefers-color-scheme: light) {
    /* Light theme colors */
    .hljs-keyword { color: #0000ff; }
    .hljs-string { color: #a31515; }
    .hljs-number { color: #098658; }
    .hljs-comment { color: #008000; }
    .hljs-function { color: #795e26; }
    .hljs-variable { color: #001080; }
    .hljs-type { color: #267f99; }
}
```

---

### Phase 3: Mermaid Diagram Rendering

#### Library: mermaid.js

- **Version:** 10.x (latest stable)
- **Size:** ~1.6MB (significant, consider lazy loading)
- **Bundle Strategy:** Lazy load only when mermaid blocks are detected

#### Diagram Detection

```typescript
function hasMermaidBlocks(content: string): boolean {
    return /```mermaid[\s\S]*?```/.test(content);
}

interface MermaidBlock {
    definition: string;
    startLine: number;
    endLine: number;
    id: string;
}

function parseMermaidBlocks(content: string): MermaidBlock[] {
    const lines = content.split('\n');
    const blocks: MermaidBlock[] = [];
    let inBlock = false;
    let currentBlock: Partial<MermaidBlock> = {};
    let defLines: string[] = [];
    
    lines.forEach((line, index) => {
        if (line.trim() === '```mermaid' && !inBlock) {
            inBlock = true;
            currentBlock = {
                startLine: index + 1,
                id: `mermaid-${Date.now()}-${index}`
            };
            defLines = [];
        } else if (line.startsWith('```') && inBlock) {
            inBlock = false;
            currentBlock.endLine = index + 1;
            currentBlock.definition = defLines.join('\n');
            blocks.push(currentBlock as MermaidBlock);
        } else if (inBlock) {
            defLines.push(line);
        }
    });
    
    return blocks;
}
```

#### Lazy Loading Strategy

```typescript
// Only load mermaid.js when needed
async function loadMermaidIfNeeded(content: string): Promise<void> {
    if (hasMermaidBlocks(content) && !window.mermaid) {
        // Load mermaid from bundled resources or CDN
        const script = document.createElement('script');
        script.src = mermaidResourceUri; // or CDN URL
        script.onload = () => {
            window.mermaid.initialize({
                startOnLoad: false,
                theme: getVSCodeTheme() === 'dark' ? 'dark' : 'default',
                securityLevel: 'strict'
            });
            renderAllMermaidDiagrams();
        };
        document.head.appendChild(script);
    }
}

function getVSCodeTheme(): 'dark' | 'light' {
    return document.body.classList.contains('vscode-dark') ? 'dark' : 'light';
}
```

#### Rendering Mermaid Diagrams

```typescript
async function renderMermaidBlock(block: MermaidBlock): Promise<string> {
    try {
        const { svg } = await mermaid.render(block.id, block.definition);
        
        return `
            <div class="mermaid-container" 
                 data-start-line="${block.startLine}" 
                 data-end-line="${block.endLine}"
                 data-mermaid-id="${block.id}">
                <div class="mermaid-header">
                    <span class="mermaid-label">📊 Mermaid Diagram</span>
                    <div class="mermaid-actions">
                        <button class="mermaid-toggle-btn" title="Toggle source/preview">🔄</button>
                        <button class="mermaid-comment-btn" title="Add comment to diagram">💬</button>
                    </div>
                </div>
                <div class="mermaid-preview" data-commentable="true">
                    ${svg}
                </div>
                <div class="mermaid-source" style="display: none;">
                    <pre><code class="language-mermaid">${escapeHtml(block.definition)}</code></pre>
                </div>
            </div>
        `;
    } catch (error) {
        // Show error with source code
        return `
            <div class="mermaid-container mermaid-error" data-start-line="${block.startLine}">
                <div class="mermaid-error-header">
                    <span>❌ Mermaid Syntax Error</span>
                </div>
                <div class="mermaid-error-message">${escapeHtml(error.message)}</div>
                <pre><code>${escapeHtml(block.definition)}</code></pre>
            </div>
        `;
    }
}
```

---

### Phase 4: Mermaid Diagram Commenting

#### Challenge
Mermaid generates SVG elements, which are not standard text selections. We need a special approach to make diagrams commentable.

#### Solution: Region-Based Comments

```
┌──────────────────────────────────────────────────────────────────────┐
│                    Mermaid Diagram Commenting                         │
├──────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  ┌─ Diagram Area ─────────────────────────────────────────────────┐  │
│  │                                                                 │  │
│  │     ┌──────┐                   ┌──────┐                        │  │
│  │     │  A   │ ──────────────►   │  B   │                        │  │
│  │     └──────┘                   └──────┘                        │  │
│  │         │                                                      │  │
│  │         │ Click on node opens comment panel                    │  │
│  │         ▼                                                      │  │
│  │     ┌──────┐                                                   │  │
│  │     │  C   │                                                   │  │
│  │     └──────┘                                                   │  │
│  │                                                                 │  │
│  └─────────────────────────────────────────────────────────────────┘  │
│                                                                       │
│  Comment Options:                                                     │
│  1. Click on SVG node → Comment on that node                         │
│  2. Click "💬 Add Comment to Diagram" → Comment on whole diagram     │
│  3. Select source code in source view → Comment on source lines      │
│                                                                       │
└──────────────────────────────────────────────────────────────────────┘
```

#### Implementation: Node-Level Comments

```typescript
interface MermaidNodeComment {
    diagramId: string;
    nodeId: string;           // The ID of the node in the diagram (e.g., "A", "B")
    nodeLabel?: string;       // Display label
    comment: string;
    status: 'open' | 'resolved';
}

// Enhance SVG after rendering to make nodes clickable
function enhanceMermaidSVG(svg: SVGElement, diagramId: string): void {
    // Find all nodes in the SVG
    const nodes = svg.querySelectorAll('.node, .cluster, .edgePath');
    
    nodes.forEach(node => {
        const nodeId = node.id || node.getAttribute('data-id');
        
        // Add click handler
        node.style.cursor = 'pointer';
        node.addEventListener('click', (e) => {
            e.stopPropagation();
            openMermaidNodeCommentPanel(diagramId, nodeId, node);
        });
        
        // Add hover effect
        node.addEventListener('mouseenter', () => {
            node.style.filter = 'brightness(1.1)';
        });
        node.addEventListener('mouseleave', () => {
            node.style.filter = '';
        });
    });
}

function openMermaidNodeCommentPanel(diagramId: string, nodeId: string, element: Element): void {
    const rect = element.getBoundingClientRect();
    const nodeLabel = element.textContent?.trim() || nodeId;
    
    // Reuse the floating comment panel with special context
    pendingSelection = {
        type: 'mermaid-node',
        diagramId,
        nodeId,
        nodeLabel,
        startLine: parseInt(element.closest('.mermaid-container')?.dataset.startLine || '0'),
        selectedText: `[Mermaid Node: ${nodeLabel}]`
    };
    
    showFloatingPanel(rect, `Diagram Node: ${nodeLabel}`);
}
```

#### Alternative: Whole-Diagram Comments

For simpler implementation, allow commenting on the entire diagram:

```typescript
function setupDiagramCommentButton(container: HTMLElement, block: MermaidBlock): void {
    const commentBtn = container.querySelector('.mermaid-comment-btn');
    
    commentBtn?.addEventListener('click', () => {
        pendingSelection = {
            startLine: block.startLine,
            endLine: block.endLine,
            startColumn: 1,
            endColumn: 1,
            selectedText: `[Mermaid Diagram: lines ${block.startLine}-${block.endLine}]`
        };
        
        const rect = container.getBoundingClientRect();
        showFloatingPanel(rect, 'Mermaid Diagram');
    });
}
```

#### Diagram Comment Storage

Extend the comment type to support mermaid diagrams:

```typescript
interface MarkdownComment {
    id: string;
    filePath: string;
    selection: {
        startLine: number;
        startColumn: number;
        endLine: number;
        endColumn: number;
    };
    selectedText: string;
    comment: string;
    status: 'open' | 'resolved' | 'pending';
    // New: Mermaid-specific fields
    mermaidContext?: {
        diagramId: string;
        nodeId?: string;      // Specific node if clicked
        nodeLabel?: string;
    };
}
```

#### Visual Indication of Commented Diagrams

```css
/* Diagram with comments */
.mermaid-container.has-comments {
    border-left: 4px solid #f9a825;
}

.mermaid-container.has-comments .mermaid-header {
    background: var(--highlight-open);
}

/* Node with comment */
.mermaid-preview .node.commented {
    outline: 2px solid #f9a825;
    outline-offset: 2px;
}

.mermaid-preview .node.commented.resolved {
    outline-color: #4caf50;
}
```

---

## File Changes Required

### Modified Files

| File | Changes |
|------|---------|
| `src/shortcuts/markdown-comments/webview-content.ts` | Add syntax highlighting, mermaid rendering, enhanced CSS |
| `src/shortcuts/markdown-comments/types.ts` | Add mermaidContext to MarkdownComment |
| `src/shortcuts/markdown-comments/review-editor-view-provider.ts` | Handle mermaid comment messages |
| `package.json` | Add highlight.js dependency (or bundle) |

### New Files

| File | Purpose |
|------|---------|
| `resources/vendor/highlight.min.js` | Bundled highlight.js (if not using CDN) |
| `resources/vendor/mermaid.min.js` | Bundled mermaid.js (if not using CDN) |
| `resources/styles/hljs-vscode.css` | VSCode-compatible highlight.js theme |

---

## Bundle Size Considerations

| Component | Size | Loading Strategy |
|-----------|------|------------------|
| Markdown CSS | ~3KB | Always included |
| highlight.js core | ~45KB | Always load (most files have code) |
| highlight.js languages | ~30KB | Bundle common languages |
| mermaid.js | ~1.6MB | Lazy load only when needed |

**Recommendation:** Lazy load mermaid.js only when a mermaid block is detected in the file.

---

## CSP Considerations

Current CSP:
```
default-src 'none'; 
style-src ${webview.cspSource} 'unsafe-inline'; 
script-src 'nonce-${nonce}';
```

Modifications needed:
- If loading from CDN: Add CDN to script-src
- If bundling locally: Load via webview.asWebviewUri (already supported)

---

## Implementation Phases

### Phase 1: Basic Markdown Highlighting (Week 1)
1. Add CSS classes for markdown elements
2. Implement regex-based line transformation
3. Test with VSCode light/dark themes
4. Update render() function

### Phase 2: Code Block Highlighting (Week 2)
1. Bundle highlight.js with common languages
2. Detect and parse code blocks
3. Apply syntax highlighting
4. Add code block UI (header, copy button)
5. Ensure code blocks are still selectable for comments

### Phase 3: Mermaid Diagram Rendering (Week 3)
1. Detect mermaid blocks
2. Implement lazy loading for mermaid.js
3. Render diagrams with error handling
4. Add toggle between source/preview
5. Add diagram copy/export functionality

### Phase 4: Diagram Commenting (Week 4)
1. Implement whole-diagram commenting
2. Add visual indicators for commented diagrams
3. Extend comment type with mermaid context
4. Update tree view to show diagram comments
5. Test with various diagram types

---

## Testing Requirements

### Unit Tests
- [ ] Markdown regex patterns match correctly
- [ ] Code block detection handles edge cases
- [ ] Mermaid block parsing is accurate
- [ ] Comment storage works with mermaid context

### Integration Tests
- [ ] Syntax highlighting renders correctly
- [ ] Code blocks are selectable and commentable
- [ ] Mermaid diagrams render without errors
- [ ] Diagram comments persist and load correctly
- [ ] Theme switching works for all components

### Visual Tests
- [ ] Light theme appearance
- [ ] Dark theme appearance
- [ ] High contrast theme support
- [ ] Various screen sizes

---

## Performance Considerations

1. **Debounce Rendering:** Don't re-render on every keystroke
2. **Virtual Scrolling:** For very large files (>1000 lines)
3. **Lazy Mermaid:** Only load mermaid.js when needed
4. **Web Worker:** Consider moving highlight.js to a worker for large files
5. **Caching:** Cache rendered diagrams by content hash

---

## Accessibility

1. **Keyboard Navigation:** All features accessible via keyboard
2. **Screen Reader:** ARIA labels for diagrams and code blocks
3. **High Contrast:** Support VSCode high contrast themes
4. **Focus Indicators:** Clear focus states for interactive elements

---

## Future Enhancements

1. **Live Preview:** Side-by-side markdown/preview mode
2. **Math Rendering:** KaTeX support for math equations
3. **Table Enhancement:** Better table rendering
4. **Diagram Export:** Export diagrams as PNG/SVG
5. **Diagram Editing:** Interactive diagram editing in place

---

## References

- [highlight.js Documentation](https://highlightjs.org/usage/)
- [Mermaid.js Documentation](https://mermaid.js.org/intro/)
- [VSCode Webview API](https://code.visualstudio.com/api/extension-guides/webview)
- [VSCode Custom Editors](https://code.visualstudio.com/api/extension-guides/custom-editors)

---

*Document Version: 1.0*  
*Created: December 2024*  
*Status: Draft*
