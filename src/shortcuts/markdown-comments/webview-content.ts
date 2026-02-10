/**
 * Webview content generator for the Review Editor View
 * Provides inline commenting experience similar to GitHub PR reviews
 *
 * Features:
 * - Markdown syntax highlighting
 * - Code block syntax highlighting (via highlight.js)
 * - Mermaid diagram rendering
 * - Inline commenting on text and diagrams
 *
 * The webview JavaScript is now bundled separately by webpack (dist/webview.js)
 * for better maintainability, testability, and IDE support.
 */

import * as vscode from 'vscode';
import { CodeBlockTheme, generateCodeBlockThemeStyle } from './code-block-themes';

/**
 * Get URIs for CSS stylesheets
 */
function getStylesheetUris(webview: vscode.Webview, extensionUri: vscode.Uri): {
    webviewCss: vscode.Uri;
    markdownCss: vscode.Uri;
    commentsCss: vscode.Uri;
    componentsCss: vscode.Uri;
    searchCss: vscode.Uri;
    sharedContextMenuCss: vscode.Uri;
} {
    const stylesPath = vscode.Uri.joinPath(extensionUri, 'media', 'styles');
    return {
        webviewCss: webview.asWebviewUri(vscode.Uri.joinPath(stylesPath, 'webview.css')),
        markdownCss: webview.asWebviewUri(vscode.Uri.joinPath(stylesPath, 'markdown.css')),
        commentsCss: webview.asWebviewUri(vscode.Uri.joinPath(stylesPath, 'comments.css')),
        componentsCss: webview.asWebviewUri(vscode.Uri.joinPath(stylesPath, 'components.css')),
        searchCss: webview.asWebviewUri(vscode.Uri.joinPath(stylesPath, 'search.css')),
        sharedContextMenuCss: webview.asWebviewUri(vscode.Uri.joinPath(stylesPath, 'shared-context-menu.css'))
    };
}

/**
 * Get URI for the bundled webview script
 */
function getWebviewScriptUri(webview: vscode.Webview, extensionUri: vscode.Uri): vscode.Uri {
    return webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist', 'webview.js'));
}

/**
 * Options for webview content generation
 */
export interface WebviewContentOptions {
    /** Code block theme setting: 'auto', 'light', or 'dark' */
    codeBlockTheme: CodeBlockTheme;
    /** Current VSCode theme kind for 'auto' detection */
    vscodeThemeKind: 'light' | 'dark' | 'high-contrast' | 'high-contrast-light';
}

/**
 * Generate the HTML content for the Review Editor View webview
 */
export function getWebviewContent(
    webview: vscode.Webview,
    extensionUri: vscode.Uri,
    options?: WebviewContentOptions
): string {
    // Get nonce for script security
    const nonce = getNonce();

    // Get stylesheet URIs
    const styles = getStylesheetUris(webview, extensionUri);

    // Get bundled webview script URI
    const webviewScriptUri = getWebviewScriptUri(webview, extensionUri);

    // Generate code block theme CSS if options provided
    const codeBlockThemeStyle = options
        ? generateCodeBlockThemeStyle(options.codeBlockTheme, options.vscodeThemeKind)
        : '';

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' ${webview.cspSource} https://cdnjs.cloudflare.com https://cdn.jsdelivr.net; img-src ${webview.cspSource} data: https:; font-src ${webview.cspSource};">
    <title>Review Editor View</title>
    <link rel="stylesheet" href="${styles.webviewCss}">
    <link rel="stylesheet" href="${styles.markdownCss}">
    <link rel="stylesheet" href="${styles.commentsCss}">
    <link rel="stylesheet" href="${styles.componentsCss}">
    <link rel="stylesheet" href="${styles.searchCss}">
    <link rel="stylesheet" href="${styles.sharedContextMenuCss}">
    ${codeBlockThemeStyle}
</head>
<body>
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
                            <!-- Dynamically populated with prompt files -->
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

    <!-- Inline comment edit panel (for editing existing comments) -->
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

    <!-- Context menu for adding comments -->
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
                <!-- Dynamically populated from settings -->
            </div>
        </div>
        <div class="context-menu-separator" id="askAISeparator"></div>
        <div class="context-menu-item context-menu-parent" id="contextMenuAskAIComment">
            <span class="context-menu-icon">💬</span>
            <span class="context-menu-label">Ask AI to Comment</span>
            <span class="context-menu-arrow">▶</span>
            <div class="context-submenu" id="askAICommentSubmenu">
                <!-- Dynamically populated from settings -->
            </div>
        </div>
        <div class="context-menu-item context-menu-parent" id="contextMenuAskAIInteractive">
            <span class="context-menu-icon">🤖</span>
            <span class="context-menu-label">Ask AI Interactively</span>
            <span class="context-menu-arrow">▶</span>
            <div class="context-submenu" id="askAIInteractiveSubmenu">
                <!-- Dynamically populated from settings -->
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

    <!-- Follow Prompt Dialog (Mode & Model Selection) -->
    <div class="modal-overlay" id="followPromptDialog" style="display: none;">
        <div class="modal-dialog follow-prompt-dialog">
            <div class="modal-header">
                <h3>📝 Follow Prompt: <span id="fpPromptName"></span></h3>
                <button id="fpCloseBtn" class="modal-close-btn">×</button>
            </div>
            
            <div class="modal-body">
                <!-- Additional Context -->
                <div class="form-group">
                    <label for="fpAdditionalContext">Additional Context (optional)</label>
                    <textarea id="fpAdditionalContext" 
                              placeholder="e.g., Focus on error handling and edge cases..."
                              rows="3"></textarea>
                </div>
                
                <hr class="modal-divider" />
                
                <!-- Execution Mode -->
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
                
                <!-- AI Model -->
                <div class="form-group">
                    <label for="fpModelSelect">AI Model</label>
                    <select id="fpModelSelect" class="model-select">
                        <!-- Dynamically populated -->
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

    <!-- Load highlight.js from CDN for code syntax highlighting -->
    <script nonce="${nonce}" src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"></script>
    
    <!-- Load bundled webview script -->
    <script nonce="${nonce}" src="${webviewScriptUri}"></script>
</body>
</html>`;
}

/**
 * Generate a nonce for CSP
 */
function getNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}
