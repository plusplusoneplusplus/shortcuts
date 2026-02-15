/**
 * Review Editor SPA Template
 *
 * Generates the complete HTML page for the Markdown Review Editor
 * running inside the CoC serve dashboard. Inlines all CSS and JS,
 * injects runtime config via `window.__REVIEW_CONFIG__`, and adds
 * a navigation header.
 *
 * Mirrors packages/coc/src/server/spa/html-template.ts pattern.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as fs from 'fs';
import * as path from 'path';

import { escapeHtml } from '../spa/helpers';

// ---------------------------------------------------------------------------
// Module-level constants (read once at startup)
// ---------------------------------------------------------------------------

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..');

const CSS_FILES = [
    'webview.css',
    'markdown.css',
    'comments.css',
    'components.css',
    'search.css',
    'shared-context-menu.css',
];

/**
 * Read and concatenate all 6 CSS files.
 * Wrapped in a function so tests can import the module even when
 * the CSS files don't exist (the function is only called at template
 * generation time if we used eager reads, but we keep them lazy via
 * a getter to support test environments).
 */
let _inlinedCss: string | undefined;
function getInlinedCss(): string {
    if (_inlinedCss === undefined) {
        _inlinedCss = CSS_FILES
            .map(f => fs.readFileSync(path.join(REPO_ROOT, 'media', 'styles', f), 'utf-8'))
            .join('\n');
    }
    return _inlinedCss;
}

let _webviewJs: string | undefined;
function getWebviewJs(): string {
    if (_webviewJs === undefined) {
        _webviewJs = fs.readFileSync(
            path.join(REPO_ROOT, 'dist', 'webview.js'), 'utf-8'
        );
    }
    return _webviewJs;
}

// ---------------------------------------------------------------------------
// Code-block theme CSS
// ---------------------------------------------------------------------------

// TODO: deduplicate with src/shortcuts/markdown-comments/code-block-themes.ts
// The original has no VS Code dependencies — consider moving to a shared location.

interface CodeBlockThemeColors {
    keyword: string;
    string: string;
    number: string;
    comment: string;
    function: string;
    variable: string;
    type: string;
    regexp: string;
    contentBackground: string;
    headerBackground: string;
    border: string;
    lineHover: string;
    accentBorder: string;
}

const DARK_THEME: CodeBlockThemeColors = {
    keyword: '#7dcfff',
    string: '#ce9178',
    number: '#b5cea8',
    comment: '#6a9955',
    function: '#dcdcaa',
    variable: '#9cdcfe',
    type: '#4ec9b0',
    regexp: '#d16969',
    contentBackground: '#1e1e1e',
    headerBackground: '#2d2d30',
    border: '#3c3c3c',
    lineHover: 'rgba(255, 255, 255, 0.06)',
    accentBorder: '#0078d4',
};

const LIGHT_THEME: CodeBlockThemeColors = {
    keyword: '#0000ff',
    string: '#a31515',
    number: '#098658',
    comment: '#008000',
    function: '#795e26',
    variable: '#001080',
    type: '#267f99',
    regexp: '#811f3f',
    contentBackground: '#f5f5f5',
    headerBackground: '#e8e8e8',
    border: '#d4d4d4',
    lineHover: 'rgba(0, 0, 0, 0.04)',
    accentBorder: '#0078d4',
};

function generateCodeBlockCss(theme: CodeBlockThemeColors): string {
    return `
/* Code block theme */
.hljs-keyword, .hljs-selector-tag, .hljs-built_in, .hljs-name, .hljs-tag { color: ${theme.keyword} !important; }
.hljs-string, .hljs-title, .hljs-section, .hljs-attribute, .hljs-literal, .hljs-template-tag, .hljs-template-variable, .hljs-addition { color: ${theme.string} !important; }
.hljs-number, .hljs-symbol, .hljs-bullet, .hljs-link { color: ${theme.number} !important; }
.hljs-comment, .hljs-quote, .hljs-deletion, .hljs-meta { color: ${theme.comment} !important; }
.hljs-class .hljs-title, .hljs-function .hljs-title, .hljs-title.function_ { color: ${theme.function} !important; }
.hljs-variable, .hljs-template-variable, .hljs-attr, .hljs-params, .hljs-property { color: ${theme.variable} !important; }
.hljs-type, .hljs-title.class_ { color: ${theme.type} !important; }
.hljs-regexp, .hljs-selector-attr, .hljs-selector-pseudo { color: ${theme.regexp} !important; }
.code-block { background: ${theme.contentBackground} !important; border-color: ${theme.border} !important; border-left: 3px solid ${theme.accentBorder} !important; }
.code-block-header { background: ${theme.headerBackground} !important; border-bottom-color: ${theme.border} !important; }
.code-block-content { background: ${theme.contentBackground} !important; }
.code-line:hover { background: ${theme.lineHover} !important; }
`;
}

// ---------------------------------------------------------------------------
// Navigation header CSS
// ---------------------------------------------------------------------------

const NAV_HEADER_CSS = `
.review-nav-header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 16px;
    background: var(--vscode-editor-background, #1e1e1e);
    border-bottom: 1px solid var(--vscode-panel-border, #333);
    font-size: 13px;
}
.review-nav-header a {
    color: var(--vscode-textLink-foreground, #3794ff);
    text-decoration: none;
}
.review-nav-header a:hover { text-decoration: underline; }
.review-nav-header .review-filename {
    font-weight: 600;
    color: var(--vscode-foreground, #ccc);
}
`;

// ---------------------------------------------------------------------------
// Exported interface & function
// ---------------------------------------------------------------------------

export interface ReviewEditorOptions {
    /** File path being reviewed (absolute) */
    filePath: string;
    /** Directory containing the markdown file (for image resolution) */
    fileDir: string;
    /** Workspace root directory */
    workspaceRoot: string;
    /** API base path, e.g. '/api' */
    apiBasePath?: string;
    /** WebSocket path, e.g. '/ws' */
    wsPath?: string;
    /** Code-block theme: 'auto' | 'light' | 'dark' */
    codeBlockTheme?: string;
    /** Dashboard URL to link back to */
    dashboardUrl?: string;
}

export function generateReviewEditorHtml(options: ReviewEditorOptions): string {
    const {
        filePath,
        fileDir,
        workspaceRoot,
        apiBasePath = '/api',
        wsPath = '/ws',
        codeBlockTheme = 'dark',
        dashboardUrl = '/',
    } = options;

    const basename = path.basename(filePath);
    const themeColors = codeBlockTheme === 'light' ? LIGHT_THEME : DARK_THEME;
    const codeBlockCss = generateCodeBlockCss(themeColors);

    const inlinedCss = getInlinedCss();
    const webviewJs = getWebviewJs();

    const configJson = JSON.stringify({
        filePath,
        fileDir,
        workspaceRoot,
        apiBasePath,
        wsPath,
        serveMode: true,
    });

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' ws: wss:;">
    <title>Review: ${escapeHtml(basename)}</title>
    <style>
${inlinedCss}
${codeBlockCss}
${NAV_HEADER_CSS}
    </style>
</head>
<body>
    <!-- Navigation header -->
    <div class="review-nav-header">
        <a href="${escapeHtml(dashboardUrl)}">← Dashboard</a>
        <span class="review-filename">${escapeHtml(basename)}</span>
    </div>

    <!-- Search bar (Ctrl+F) -->
    <div class="search-bar" id="searchBar" style="display: none;">
        <div class="search-bar-inner">
            <span class="search-icon">🔍</span>
            <input type="text" class="search-input" id="searchInput" placeholder="Find in document..." autocomplete="off" />
            <span class="search-count" id="searchCount"></span>
            <button class="search-btn" id="searchPrevBtn" title="Previous match (Shift+Enter)">
                <span class="search-btn-icon">◀</span>
            </button>
            <button class="search-btn" id="searchNextBtn" title="Next match (Enter)">
                <span class="search-btn-icon">▶</span>
            </button>
            <button class="search-btn search-toggle-btn" id="searchCaseSensitiveBtn" title="Match case (Alt+C)">
                <span class="search-btn-text">Aa</span>
            </button>
            <button class="search-btn search-toggle-btn" id="searchRegexBtn" title="Use regular expression (Alt+R)">
                <span class="search-btn-text">.*</span>
            </button>
            <button class="search-btn search-close-btn" id="searchCloseBtn" title="Close (Escape)">
                <span class="search-btn-icon">✕</span>
            </button>
        </div>
    </div>

    <div class="toolbar">
        <div class="toolbar-group">
            <div class="mode-toggle" id="modeToggle" title="Switch between Review and Source modes">
                <button id="reviewModeBtn" class="mode-btn active" data-mode="review">
                    <span class="icon">📝</span> Review
                </button>
                <button id="sourceModeBtn" class="mode-btn" data-mode="source">
                    <span class="icon">📄</span> Source
                </button>
            </div>
        </div>
        <div class="toolbar-group toolbar-review-only">
            <div class="comments-dropdown" id="commentsDropdown">
                <button id="commentsBtn" class="toolbar-btn comments-btn" title="Comments Actions">
                    <span class="icon">💬</span> Comments <span class="comments-badge" id="commentsBadge">(0)</span>
                    <span class="dropdown-arrow">▼</span>
                </button>
                <div class="comments-menu" id="commentsMenu">
                    <div class="comments-menu-item" id="resolveAllBtn">
                        <span class="comments-menu-icon">✅</span>
                        <span class="comments-menu-label">Resolve All</span>
                    </div>
                    <div class="comments-menu-item comments-menu-item-danger" id="deleteAllBtn">
                        <span class="comments-menu-icon">🗑️</span>
                        <span class="comments-menu-label">Sign Off</span>
                    </div>
                    <div class="comments-menu-divider"></div>
                    <div class="comments-menu-header">Active Comments</div>
                    <div class="comments-list" id="commentsList">
                        <div class="comments-list-empty" id="commentsListEmpty">No open comments</div>
                    </div>
                </div>
            </div>
        </div>
        <div class="toolbar-group toolbar-review-only">
            <div class="ai-action-dropdown" id="aiActionDropdown">
                <button id="aiActionBtn" class="toolbar-btn ai-action-btn" title="AI Actions">
                    <span class="icon">🤖</span> AI Action
                    <span class="dropdown-arrow">▼</span>
                </button>
                <div class="ai-action-menu" id="aiActionMenu">
                    <div class="ai-action-menu-item ai-action-menu-parent" id="executeWorkPlanItem">
                        <span class="ai-action-icon">🚀</span>
                        <span class="ai-action-label">Follow Prompt</span>
                        <span class="ai-action-arrow">▶</span>
                        <div class="ai-action-submenu" id="executeWorkPlanSubmenu">
                            <div class="ai-action-menu-item ai-action-loading" id="executeWorkPlanLoading">
                                <span class="ai-action-icon">⏳</span>
                                <span class="ai-action-label">Loading prompts...</span>
                            </div>
                        </div>
                    </div>
                    <div class="ai-action-menu-item" id="updateDocumentItem">
                        <span class="ai-action-icon">📝</span>
                        <span class="ai-action-label">Update Document</span>
                    </div>
                    <div class="ai-action-menu-item" id="askAIInteractiveItem">
                        <span class="ai-action-icon">🤖</span>
                        <span class="ai-action-label">Ask AI Interactively</span>
                    </div>
                    <div class="ai-action-menu-item" id="refreshPlanItem">
                        <span class="ai-action-icon">🔄</span>
                        <span class="ai-action-label">Refresh Plan</span>
                    </div>
                    <div class="ai-action-menu-divider"></div>
                    <div class="ai-action-menu-item ai-action-menu-parent" id="resolveCommentsItem">
                        <span class="ai-action-icon">✨</span>
                        <span class="ai-action-label">Resolve Comments</span>
                        <span class="ai-action-arrow">▶</span>
                        <div class="ai-action-submenu" id="resolveCommentsSubmenu">
                            <div class="ai-action-menu-item" id="sendToNewChatBtn">
                                <span class="ai-action-icon">💬</span>
                                <span class="ai-action-label">Send to New Chat</span>
                            </div>
                            <div class="ai-action-menu-item" id="sendToExistingChatBtn">
                                <span class="ai-action-icon">🔄</span>
                                <span class="ai-action-label">Send to Existing Chat</span>
                            </div>
                            <div class="ai-action-menu-divider"></div>
                            <div class="ai-action-menu-item" id="sendToCLIInteractiveBtn">
                                <span class="ai-action-icon">🖥️</span>
                                <span class="ai-action-label">Send to CLI Interactive</span>
                            </div>
                            <div class="ai-action-menu-item" id="sendToCLIBackgroundBtn">
                                <span class="ai-action-icon">⏳</span>
                                <span class="ai-action-label">Send to CLI Background</span>
                            </div>
                            <div class="ai-action-menu-divider"></div>
                            <div class="ai-action-menu-item" id="copyPromptBtn">
                                <span class="ai-action-icon">📋</span>
                                <span class="ai-action-label">Copy as Prompt</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
        <div class="toolbar-group toolbar-review-only">
            <label class="toolbar-checkbox">
                <input type="checkbox" id="showResolvedCheckbox" checked>
                Show Resolved
            </label>
        </div>
        <div class="toolbar-stats toolbar-review-only" id="statsDisplay">
            <span class="stat open-stat">Open: <span id="openCount">0</span></span>
            <span class="stat resolved-stat">Resolved: <span id="resolvedCount">0</span></span>
        </div>
    </div>

    <div class="editor-container" id="editorContainer">
        <div class="editor-wrapper" id="editorWrapper" contenteditable="true" spellcheck="true"></div>
    </div>

    <!-- Floating comment input panel -->
    <div class="floating-comment-panel" id="floatingCommentPanel" style="display: none;">
        <div class="floating-panel-header">
            <span class="floating-panel-title">💬 Add Comment</span>
            <button class="floating-panel-close" id="floatingPanelClose">×</button>
        </div>
        <div class="floating-panel-selection" id="floatingPanelSelection"></div>
        <textarea id="floatingCommentInput" placeholder="What feedback do you have for this section? (Ctrl+Enter to submit)" rows="3"></textarea>
        <div class="floating-panel-footer">
            <button id="floatingCancelBtn" class="btn btn-secondary btn-sm">Cancel</button>
            <button id="floatingSaveBtn" class="btn btn-primary btn-sm">Add Comment</button>
        </div>
    </div>

    <!-- Inline comment edit panel -->
    <div class="inline-edit-panel" id="inlineEditPanel" style="display: none;">
        <div class="inline-edit-header">
            <span class="inline-edit-title">✏️ Edit Comment</span>
            <button class="inline-edit-close" id="inlineEditClose">×</button>
        </div>
        <textarea id="inlineEditInput" placeholder="Edit your comment (Ctrl+Enter to save)" rows="3"></textarea>
        <div class="inline-edit-footer">
            <button id="inlineEditCancelBtn" class="btn btn-secondary btn-sm">Cancel</button>
            <button id="inlineEditSaveBtn" class="btn btn-primary btn-sm">Save</button>
        </div>
    </div>

    <!-- Context menu -->
    <div class="context-menu" id="contextMenu" style="display: none;">
        <div class="context-menu-item" id="contextMenuCut">
            <span class="context-menu-icon">✂️</span>
            <span class="context-menu-label">Cut</span>
            <span class="context-menu-shortcut">Ctrl+X</span>
        </div>
        <div class="context-menu-item" id="contextMenuCopy">
            <span class="context-menu-icon">📋</span>
            <span class="context-menu-label">Copy</span>
            <span class="context-menu-shortcut">Ctrl+C</span>
        </div>
        <div class="context-menu-item" id="contextMenuPaste">
            <span class="context-menu-icon">📄</span>
            <span class="context-menu-label">Paste</span>
            <span class="context-menu-shortcut">Ctrl+V</span>
        </div>
        <div class="context-menu-separator"></div>
        <div class="context-menu-item" id="contextMenuAddComment">
            <span class="context-menu-icon">💬</span>
            <span class="context-menu-label">Add Comment</span>
            <span class="context-menu-shortcut">Ctrl+Shift+M</span>
        </div>
        <div class="context-menu-item context-menu-parent" id="contextMenuPredefined">
            <span class="context-menu-icon">📋</span>
            <span class="context-menu-label">Add Predefined Comment</span>
            <span class="context-menu-arrow">▶</span>
            <div class="context-submenu" id="predefinedSubmenu">
            </div>
        </div>
        <div class="context-menu-separator" id="askAISeparator"></div>
        <div class="context-menu-item context-menu-parent" id="contextMenuAskAIComment">
            <span class="context-menu-icon">💬</span>
            <span class="context-menu-label">Ask AI to Comment</span>
            <span class="context-menu-arrow">▶</span>
            <div class="context-submenu" id="askAICommentSubmenu">
            </div>
        </div>
        <div class="context-menu-item context-menu-parent" id="contextMenuAskAIInteractive">
            <span class="context-menu-icon">🤖</span>
            <span class="context-menu-label">Ask AI Interactively</span>
            <span class="context-menu-arrow">▶</span>
            <div class="context-submenu" id="askAIInteractiveSubmenu">
            </div>
        </div>
        <div class="context-menu-separator" id="actionItemsSeparator"></div>
        <div class="context-menu-item context-menu-parent" id="contextMenuActionItems">
            <span class="context-menu-icon">🚀</span>
            <span class="context-menu-label">Follow Prompt</span>
            <span class="context-menu-arrow">▶</span>
            <div class="context-submenu" id="actionItemsSubmenu">
                <div class="context-menu-item context-menu-loading" id="actionItemsLoading">
                    <span class="menu-icon">⏳</span>Loading...
                </div>
            </div>
        </div>
    </div>

    <!-- Hover preview tooltip for predefined comments -->
    <div class="predefined-comment-preview" id="predefinedPreview" style="display: none;">
        <div class="preview-header">Preview</div>
        <div class="preview-content"></div>
    </div>

    <!-- Custom AI instruction input dialog -->
    <div class="custom-instruction-dialog" id="customInstructionDialog" style="display: none;">
        <div class="custom-instruction-header">
            <span class="custom-instruction-title">🤖 Custom AI Instruction</span>
            <button class="custom-instruction-close" id="customInstructionClose">×</button>
        </div>
        <div class="custom-instruction-selection" id="customInstructionSelection"></div>
        <textarea id="customInstructionInput" placeholder="Enter your instruction for the AI (e.g., 'Explain the security implications')" rows="3"></textarea>
        <div class="custom-instruction-footer">
            <button id="customInstructionCancelBtn" class="btn btn-secondary btn-sm">Cancel</button>
            <button id="customInstructionSubmitBtn" class="btn btn-primary btn-sm">Ask AI</button>
        </div>
    </div>

    <!-- Follow Prompt Dialog -->
    <div class="modal-overlay" id="followPromptDialog" style="display: none;">
        <div class="modal-dialog follow-prompt-dialog">
            <div class="modal-header">
                <h3>📝 Follow Prompt: <span id="fpPromptName"></span></h3>
                <button id="fpCloseBtn" class="modal-close-btn">×</button>
            </div>
            <div class="modal-body">
                <div class="form-group">
                    <label for="fpAdditionalContext">Additional Context (optional)</label>
                    <textarea id="fpAdditionalContext"
                              placeholder="e.g., Focus on error handling and edge cases..."
                              rows="3"></textarea>
                </div>
                <hr class="modal-divider" />
                <div class="form-group">
                    <label>Execution Mode</label>
                    <div class="radio-group">
                        <label class="radio-option">
                            <input type="radio" name="fpMode" value="interactive" checked />
                            <span class="radio-label">
                                <span class="radio-icon">🖥️</span>
                                <span class="radio-content">
                                    <span class="radio-title">Interactive Session</span>
                                    <span class="radio-desc">Launch in external terminal</span>
                                </span>
                            </span>
                        </label>
                        <label class="radio-option">
                            <input type="radio" name="fpMode" value="background" />
                            <span class="radio-label">
                                <span class="radio-icon">⏳</span>
                                <span class="radio-content">
                                    <span class="radio-title">Background</span>
                                    <span class="radio-desc">Queue as a work item (track in AI Processes panel)</span>
                                </span>
                            </span>
                        </label>
                    </div>
                </div>
                <div class="form-group">
                    <label for="fpModelSelect">AI Model</label>
                    <select id="fpModelSelect" class="model-select">
                    </select>
                </div>
            </div>
            <div class="modal-footer">
                <button id="fpCancelBtn" class="btn btn-secondary">Cancel</button>
                <button id="fpCopyPromptBtn" class="btn btn-secondary">Copy Prompt</button>
                <button id="fpExecuteBtn" class="btn btn-primary">Execute</button>
            </div>
        </div>
    </div>

    <!-- Update Document Dialog -->
    <div class="modal-overlay" id="updateDocumentDialog" style="display: none;">
        <div class="modal-dialog update-document-dialog">
            <div class="modal-header">
                <h3>📝 Update Document</h3>
                <button id="udCloseBtn" class="modal-close-btn">×</button>
            </div>
            <div class="modal-body">
                <div class="form-group">
                    <label for="udInstruction">What changes do you want to make?</label>
                    <textarea id="udInstruction"
                              placeholder="e.g., Add a section about error handling, fix the formatting of code blocks, add more details to the introduction..."
                              rows="5"></textarea>
                </div>
            </div>
            <div class="modal-footer">
                <button id="udCancelBtn" class="btn btn-secondary">Cancel</button>
                <button id="udSubmitBtn" class="btn btn-primary">Update</button>
            </div>
        </div>
    </div>

    <!-- Refresh Plan Dialog -->
    <div class="modal-overlay" id="refreshPlanDialog" style="display: none;">
        <div class="modal-dialog refresh-plan-dialog">
            <div class="modal-header">
                <h3>🔄 Refresh Plan</h3>
                <button id="rpCloseBtn" class="modal-close-btn">×</button>
            </div>
            <div class="modal-body">
                <p class="modal-description">
                    Ask AI to rewrite and regenerate this plan based on the latest codebase state.
                </p>
                <div class="form-group">
                    <label for="rpContext">Additional Context <span class="optional">(optional)</span></label>
                    <textarea id="rpContext"
                              placeholder="e.g., Focus on the authentication changes, consider the new API endpoints we added, update based on the refactoring we did..."
                              rows="4"></textarea>
                    <div class="form-hint">Provide any additional background or context to help AI understand what has changed.</div>
                </div>
            </div>
            <div class="modal-footer">
                <button id="rpCancelBtn" class="btn btn-secondary">Cancel</button>
                <button id="rpSubmitBtn" class="btn btn-primary">Refresh Plan</button>
            </div>
        </div>
    </div>

    <!-- TODO: consider bundling highlight.js instead of CDN -->
    <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"><\/script>

    <script>window.__REVIEW_CONFIG__ = ${configJson.replace(/<\//g, '<\\/')};<\/script>
    <script>${webviewJs}<\/script>
</body>
</html>`;
}
