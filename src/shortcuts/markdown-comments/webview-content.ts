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

/**
 * Get URIs for CSS stylesheets
 */
function getStylesheetUris(webview: vscode.Webview, extensionUri: vscode.Uri): {
    webviewCss: vscode.Uri;
    markdownCss: vscode.Uri;
    commentsCss: vscode.Uri;
    componentsCss: vscode.Uri;
} {
    const stylesPath = vscode.Uri.joinPath(extensionUri, 'media', 'styles');
    return {
        webviewCss: webview.asWebviewUri(vscode.Uri.joinPath(stylesPath, 'webview.css')),
        markdownCss: webview.asWebviewUri(vscode.Uri.joinPath(stylesPath, 'markdown.css')),
        commentsCss: webview.asWebviewUri(vscode.Uri.joinPath(stylesPath, 'comments.css')),
        componentsCss: webview.asWebviewUri(vscode.Uri.joinPath(stylesPath, 'components.css'))
    };
}

/**
 * Get URI for the bundled webview script
 */
function getWebviewScriptUri(webview: vscode.Webview, extensionUri: vscode.Uri): vscode.Uri {
    return webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist', 'webview.js'));
}

/**
 * Generate the HTML content for the Review Editor View webview
 */
export function getWebviewContent(
    webview: vscode.Webview,
    extensionUri: vscode.Uri
): string {
    // Get nonce for script security
    const nonce = getNonce();
    
    // Get stylesheet URIs
    const styles = getStylesheetUris(webview, extensionUri);
    
    // Get bundled webview script URI
    const webviewScriptUri = getWebviewScriptUri(webview, extensionUri);

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
</head>
<body>
    <div class="toolbar">
        <div class="toolbar-group">
            <button id="resolveAllBtn" class="toolbar-btn" title="Resolve All Comments">
                <span class="icon">✅</span> Resolve All
            </button>
            <button id="deleteAllBtn" class="toolbar-btn toolbar-btn-danger" title="Sign Off - Delete All Comments">
                <span class="icon">🗑️</span> Sign Off
            </button>
        </div>
        <div class="toolbar-group">
            <button id="copyPromptBtn" class="toolbar-btn" title="Copy AI Prompt to Clipboard">
                <span class="icon">📋</span> Copy Prompt
            </button>
        </div>
        <div class="toolbar-group">
            <label class="toolbar-checkbox">
                <input type="checkbox" id="showResolvedCheckbox" checked>
                Show Resolved
            </label>
        </div>
        <div class="toolbar-stats" id="statsDisplay">
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
