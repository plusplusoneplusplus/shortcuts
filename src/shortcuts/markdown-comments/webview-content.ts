/**
 * Webview content generator for the Review Editor View
 * Provides inline commenting experience similar to GitHub PR reviews
 */

import * as vscode from 'vscode';

/**
 * Generate the HTML content for the Review Editor View webview
 */
export function getWebviewContent(
    webview: vscode.Webview,
    extensionUri: vscode.Uri
): string {
    // Get nonce for script security
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; font-src ${webview.cspSource};">
    <title>Review Editor View</title>
    <style>
        ${getStyles()}
    </style>
</head>
<body>
    <div class="toolbar">
        <div class="toolbar-group">
            <button id="resolveAllBtn" class="toolbar-btn" title="Resolve All Comments">
                <span class="icon">✅</span> Resolve All
            </button>
        </div>
        <div class="toolbar-group">
            <button id="generatePromptBtn" class="toolbar-btn" title="Generate AI Prompt">
                <span class="icon">🤖</span> Generate Prompt
            </button>
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
        <div class="editor-wrapper">
            <div class="line-numbers" id="lineNumbers"></div>
            <div class="editor-content" id="editorContent" contenteditable="true" spellcheck="true"></div>
        </div>
    </div>

    <!-- Floating comment input panel -->
    <div class="floating-comment-panel" id="floatingCommentPanel" style="display: none;">
        <div class="floating-panel-header">
            <span class="floating-panel-title">💬 Add Comment</span>
            <button class="floating-panel-close" id="floatingPanelClose">×</button>
        </div>
        <div class="floating-panel-selection" id="floatingPanelSelection"></div>
        <textarea id="floatingCommentInput" placeholder="What feedback do you have for this section?" rows="3"></textarea>
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
        <textarea id="inlineEditInput" rows="3"></textarea>
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

    <script nonce="${nonce}">
        ${getScript()}
    </script>
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

/**
 * Get CSS styles for the editor
 */
function getStyles(): string {
    return `
        :root {
            --bg-color: var(--vscode-editor-background);
            --text-color: var(--vscode-editor-foreground);
            --border-color: var(--vscode-panel-border);
            --highlight-open: rgba(255, 235, 59, 0.3);
            --highlight-resolved: rgba(76, 175, 80, 0.2);
            --highlight-hover: rgba(255, 235, 59, 0.5);
            --comment-bg: var(--vscode-editorWidget-background);
            --comment-border: var(--vscode-editorWidget-border);
            --button-bg: var(--vscode-button-background);
            --button-fg: var(--vscode-button-foreground);
            --button-hover: var(--vscode-button-hoverBackground);
            --input-bg: var(--vscode-input-background);
            --input-fg: var(--vscode-input-foreground);
            --input-border: var(--vscode-input-border);
            --line-number-color: var(--vscode-editorLineNumber-foreground);
            --gutter-icon-color: #FFC107;
        }

        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }

        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            background-color: var(--bg-color);
            color: var(--text-color);
            height: 100vh;
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }

        .toolbar {
            display: flex;
            align-items: center;
            gap: 16px;
            padding: 8px 16px;
            background: var(--vscode-titleBar-activeBackground);
            border-bottom: 1px solid var(--border-color);
            flex-wrap: wrap;
        }

        .toolbar-group {
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .toolbar-btn {
            display: flex;
            align-items: center;
            gap: 4px;
            padding: 6px 12px;
            background: var(--button-bg);
            color: var(--button-fg);
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 12px;
            transition: background-color 0.2s;
        }

        .toolbar-btn:hover {
            background: var(--button-hover);
        }

        .toolbar-btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }

        .toolbar-btn .icon {
            font-size: 14px;
        }

        .toolbar-checkbox {
            display: flex;
            align-items: center;
            gap: 6px;
            font-size: 12px;
            cursor: pointer;
        }

        .toolbar-stats {
            margin-left: auto;
            display: flex;
            gap: 12px;
            font-size: 12px;
        }

        .stat {
            padding: 4px 8px;
            border-radius: 4px;
        }

        .open-stat {
            background: var(--highlight-open);
        }

        .resolved-stat {
            background: var(--highlight-resolved);
        }

        .editor-container {
            flex: 1;
            overflow: auto;
            padding: 16px;
            position: relative;
        }

        .editor-wrapper {
            display: flex;
            min-height: 100%;
        }

        .line-numbers {
            width: 60px;
            padding-right: 16px;
            text-align: right;
            color: var(--line-number-color);
            font-family: var(--vscode-editor-font-family, monospace);
            font-size: var(--vscode-editor-font-size, 14px);
            line-height: 1.5;
            user-select: none;
            flex-shrink: 0;
        }

        .line-number {
            height: auto;
            min-height: 21px;
            display: flex;
            align-items: center;
            justify-content: flex-end;
            gap: 4px;
        }

        .line-number .gutter-icon {
            color: var(--gutter-icon-color);
            cursor: pointer;
            font-size: 12px;
        }

        .editor-content {
            flex: 1;
            font-family: var(--vscode-editor-font-family, monospace);
            font-size: var(--vscode-editor-font-size, 14px);
            line-height: 1.5;
            outline: none;
            white-space: pre-wrap;
            word-wrap: break-word;
            min-height: 100%;
        }

        .editor-content:focus {
            outline: none;
        }

        /* Highlighted text with comment */
        .commented-text {
            background-color: var(--highlight-open);
            cursor: pointer;
            border-bottom: 2px solid #f9a825;
            position: relative;
            transition: background-color 0.2s;
        }

        .commented-text:hover {
            background-color: var(--highlight-hover);
        }

        .commented-text.resolved {
            background-color: var(--highlight-resolved);
            border-bottom-color: #4caf50;
        }

        .commented-text.resolved:hover {
            background-color: rgba(76, 175, 80, 0.35);
        }

        /* Inline comment bubble (appears on hover/click) */
        .inline-comment-bubble {
            position: absolute;
            left: 0;
            right: 0;
            margin-top: 4px;
            padding: 12px;
            background: var(--comment-bg);
            border: 1px solid var(--comment-border);
            border-radius: 8px;
            border-left: 4px solid #f9a825;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
            z-index: 100;
            font-family: var(--vscode-font-family);
            font-size: 13px;
            animation: bubbleIn 0.15s ease-out;
        }

        .inline-comment-bubble.resolved {
            border-left-color: #4caf50;
            opacity: 0.85;
        }

        @keyframes bubbleIn {
            from {
                opacity: 0;
                transform: translateY(-5px);
            }
            to {
                opacity: 1;
                transform: translateY(0);
            }
        }

        .bubble-header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            margin-bottom: 8px;
        }

        .bubble-meta {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
        }

        .bubble-meta .status {
            display: inline-block;
            padding: 2px 6px;
            border-radius: 3px;
            font-weight: 500;
            margin-left: 8px;
        }

        .bubble-meta .status.open {
            background: var(--highlight-open);
            color: #f57f17;
        }

        .bubble-meta .status.resolved {
            background: var(--highlight-resolved);
            color: #2e7d32;
        }

        .bubble-actions {
            display: flex;
            gap: 4px;
        }

        .bubble-action-btn {
            background: none;
            border: none;
            cursor: pointer;
            padding: 4px 6px;
            border-radius: 4px;
            font-size: 12px;
            opacity: 0.7;
            transition: opacity 0.2s, background-color 0.2s;
        }

        .bubble-action-btn:hover {
            opacity: 1;
            background: var(--vscode-toolbar-hoverBackground);
        }

        .bubble-selected-text {
            background: var(--vscode-textBlockQuote-background);
            padding: 8px 10px;
            border-radius: 4px;
            font-family: var(--vscode-editor-font-family, monospace);
            font-size: 12px;
            margin-bottom: 8px;
            border-left: 3px solid var(--vscode-textBlockQuote-border);
            max-height: 80px;
            overflow: auto;
        }

        .bubble-comment-text {
            white-space: pre-wrap;
            line-height: 1.5;
        }

        /* Floating comment panel (for adding new comments) */
        .floating-comment-panel {
            position: fixed;
            width: 380px;
            background: var(--comment-bg);
            border: 1px solid var(--comment-border);
            border-radius: 8px;
            box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
            z-index: 1000;
            animation: floatIn 0.2s ease-out;
        }

        @keyframes floatIn {
            from {
                opacity: 0;
                transform: scale(0.95);
            }
            to {
                opacity: 1;
                transform: scale(1);
            }
        }

        .floating-panel-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 12px 16px;
            border-bottom: 1px solid var(--border-color);
        }

        .floating-panel-title {
            font-weight: 600;
            font-size: 14px;
        }

        .floating-panel-close {
            background: none;
            border: none;
            cursor: pointer;
            font-size: 18px;
            color: var(--text-color);
            opacity: 0.7;
            padding: 0 4px;
        }

        .floating-panel-close:hover {
            opacity: 1;
        }

        .floating-panel-selection {
            background: var(--vscode-textBlockQuote-background);
            padding: 10px 16px;
            font-family: var(--vscode-editor-font-family, monospace);
            font-size: 12px;
            max-height: 100px;
            overflow: auto;
            border-left: 4px solid #f9a825;
            margin: 0;
        }

        .floating-comment-panel textarea {
            width: calc(100% - 32px);
            margin: 12px 16px;
            padding: 10px;
            background: var(--input-bg);
            color: var(--input-fg);
            border: 1px solid var(--input-border);
            border-radius: 4px;
            font-family: var(--vscode-font-family);
            font-size: 13px;
            resize: vertical;
            min-height: 80px;
        }

        .floating-comment-panel textarea:focus {
            outline: none;
            border-color: var(--vscode-focusBorder);
        }

        .floating-panel-footer {
            display: flex;
            justify-content: flex-end;
            gap: 8px;
            padding: 12px 16px;
            border-top: 1px solid var(--border-color);
        }

        /* Inline edit panel */
        .inline-edit-panel {
            position: fixed;
            width: 350px;
            background: var(--comment-bg);
            border: 1px solid var(--comment-border);
            border-radius: 8px;
            box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
            z-index: 1000;
        }

        .inline-edit-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 10px 14px;
            border-bottom: 1px solid var(--border-color);
        }

        .inline-edit-title {
            font-weight: 600;
            font-size: 13px;
        }

        .inline-edit-close {
            background: none;
            border: none;
            cursor: pointer;
            font-size: 16px;
            color: var(--text-color);
            opacity: 0.7;
        }

        .inline-edit-close:hover {
            opacity: 1;
        }

        .inline-edit-panel textarea {
            width: calc(100% - 28px);
            margin: 10px 14px;
            padding: 8px;
            background: var(--input-bg);
            color: var(--input-fg);
            border: 1px solid var(--input-border);
            border-radius: 4px;
            font-family: var(--vscode-font-family);
            font-size: 13px;
            resize: vertical;
        }

        .inline-edit-panel textarea:focus {
            outline: none;
            border-color: var(--vscode-focusBorder);
        }

        .inline-edit-footer {
            display: flex;
            justify-content: flex-end;
            gap: 8px;
            padding: 10px 14px;
            border-top: 1px solid var(--border-color);
        }

        /* Buttons */
        .btn {
            padding: 8px 16px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 13px;
            transition: background-color 0.2s;
        }

        .btn-sm {
            padding: 6px 12px;
            font-size: 12px;
        }

        .btn-primary {
            background: var(--button-bg);
            color: var(--button-fg);
        }

        .btn-primary:hover {
            background: var(--button-hover);
        }

        .btn-secondary {
            background: transparent;
            color: var(--text-color);
            border: 1px solid var(--border-color);
        }

        .btn-secondary:hover {
            background: var(--vscode-toolbar-hoverBackground);
        }

        /* Selection highlight */
        ::selection {
            background: var(--vscode-editor-selectionBackground);
        }

        /* Hint text for adding comment */
        .add-comment-hint {
            position: fixed;
            background: var(--comment-bg);
            border: 1px solid var(--comment-border);
            padding: 6px 12px;
            border-radius: 4px;
            font-size: 12px;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
            z-index: 500;
            pointer-events: none;
            opacity: 0;
            transition: opacity 0.15s;
        }

        .add-comment-hint.visible {
            opacity: 1;
        }

        .add-comment-hint kbd {
            background: var(--vscode-keybindingLabel-background);
            border: 1px solid var(--vscode-keybindingLabel-border);
            border-radius: 3px;
            padding: 1px 4px;
            font-size: 11px;
            margin-left: 6px;
        }

        /* Context menu */
        .context-menu {
            position: fixed;
            min-width: 200px;
            background: var(--comment-bg);
            border: 1px solid var(--comment-border);
            border-radius: 6px;
            box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
            z-index: 2000;
            overflow: hidden;
        }

        .context-menu-item {
            display: flex;
            align-items: center;
            padding: 8px 12px;
            cursor: pointer;
            transition: background-color 0.15s;
        }

        .context-menu-item:hover {
            background: var(--vscode-list-hoverBackground);
        }

        .context-menu-item.disabled {
            opacity: 0.5;
            cursor: default;
        }

        .context-menu-item.disabled:hover {
            background: transparent;
        }

        .context-menu-icon {
            margin-right: 10px;
            font-size: 14px;
        }

        .context-menu-label {
            flex: 1;
            font-size: 13px;
        }

        .context-menu-shortcut {
            font-size: 11px;
            opacity: 0.6;
            margin-left: 16px;
        }

        .context-menu-separator {
            height: 1px;
            background: var(--border-color);
            margin: 4px 8px;
        }
    `;
}

/**
 * Get JavaScript for the editor
 */
function getScript(): string {
    return `
        (function() {
            const vscode = acquireVsCodeApi();
            
            // State
            let currentContent = '';
            let comments = [];
            let filePath = '';
            let settings = { showResolved: true };
            let pendingSelection = null;
            let editingCommentId = null;
            let activeCommentBubble = null;
            let savedSelectionForContextMenu = null; // Saved selection when context menu opens

            // DOM elements
            const editorContainer = document.getElementById('editorContainer');
            const editorContent = document.getElementById('editorContent');
            const lineNumbers = document.getElementById('lineNumbers');
            const floatingPanel = document.getElementById('floatingCommentPanel');
            const floatingInput = document.getElementById('floatingCommentInput');
            const floatingSelection = document.getElementById('floatingPanelSelection');
            const inlineEditPanel = document.getElementById('inlineEditPanel');
            const inlineEditInput = document.getElementById('inlineEditInput');
            const showResolvedCheckbox = document.getElementById('showResolvedCheckbox');
            const openCount = document.getElementById('openCount');
            const resolvedCount = document.getElementById('resolvedCount');
            const contextMenu = document.getElementById('contextMenu');
            const contextMenuCut = document.getElementById('contextMenuCut');
            const contextMenuCopy = document.getElementById('contextMenuCopy');
            const contextMenuPaste = document.getElementById('contextMenuPaste');
            const contextMenuAddComment = document.getElementById('contextMenuAddComment');

            // Initialize
            function init() {
                setupEventListeners();
                vscode.postMessage({ type: 'ready' });
            }

            // Setup event listeners
            function setupEventListeners() {
                // Toolbar buttons
                document.getElementById('resolveAllBtn').addEventListener('click', () => {
                    vscode.postMessage({ type: 'resolveAll' });
                });
                document.getElementById('generatePromptBtn').addEventListener('click', () => {
                    vscode.postMessage({ type: 'generatePrompt', promptOptions: { format: 'markdown' } });
                });
                document.getElementById('copyPromptBtn').addEventListener('click', () => {
                    vscode.postMessage({ type: 'copyPrompt', promptOptions: { format: 'markdown' } });
                });

                // Show resolved checkbox
                showResolvedCheckbox.addEventListener('change', (e) => {
                    settings.showResolved = e.target.checked;
                    render();
                });

                // Floating panel buttons
                document.getElementById('floatingPanelClose').addEventListener('click', closeFloatingPanel);
                document.getElementById('floatingCancelBtn').addEventListener('click', closeFloatingPanel);
                document.getElementById('floatingSaveBtn').addEventListener('click', saveNewComment);

                // Inline edit panel buttons
                document.getElementById('inlineEditClose').addEventListener('click', closeInlineEditPanel);
                document.getElementById('inlineEditCancelBtn').addEventListener('click', closeInlineEditPanel);
                document.getElementById('inlineEditSaveBtn').addEventListener('click', saveEditedComment);

                // Editor input
                editorContent.addEventListener('input', handleEditorInput);
                editorContent.addEventListener('keydown', handleEditorKeydown);
                editorContent.addEventListener('mouseup', handleSelectionChange);
                editorContent.addEventListener('keyup', handleSelectionChange);

                // Close panels on escape
                document.addEventListener('keydown', (e) => {
                    if (e.key === 'Escape') {
                        closeFloatingPanel();
                        closeInlineEditPanel();
                        closeActiveCommentBubble();
                    }
                });

                // Close bubble when clicking outside
                document.addEventListener('click', (e) => {
                    if (activeCommentBubble && !e.target.closest('.inline-comment-bubble') && 
                        !e.target.closest('.commented-text') && !e.target.closest('.gutter-icon')) {
                        closeActiveCommentBubble();
                    }
                });

                // Listen for messages from extension
                window.addEventListener('message', handleMessage);

                // Keyboard shortcut for adding comment
                document.addEventListener('keydown', (e) => {
                    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'm') {
                        e.preventDefault();
                        handleAddComment();
                    }
                });

                // Context menu
                editorContent.addEventListener('contextmenu', handleContextMenu);
                contextMenuCut.addEventListener('click', () => {
                    hideContextMenu();
                    handleCut();
                });
                contextMenuCopy.addEventListener('click', () => {
                    hideContextMenu();
                    handleCopy();
                });
                contextMenuPaste.addEventListener('click', () => {
                    hideContextMenu();
                    handlePaste();
                });
                contextMenuAddComment.addEventListener('click', () => {
                    hideContextMenu();
                    handleAddCommentFromContextMenu();
                });

                // Hide context menu on click outside or escape
                document.addEventListener('click', (e) => {
                    if (!e.target.closest('.context-menu')) {
                        hideContextMenu();
                    }
                });
                document.addEventListener('keydown', (e) => {
                    if (e.key === 'Escape') {
                        hideContextMenu();
                    }
                });
            }

            // Handle context menu
            function handleContextMenu(e) {
                const selection = window.getSelection();
                const hasSelection = selection && !selection.isCollapsed && selection.toString().trim().length > 0;

                // Save selection info for later use (before menu click clears it)
                if (hasSelection) {
                    const range = selection.getRangeAt(0);
                    const selectionInfo = getSelectionPosition(range);
                    if (selectionInfo) {
                        savedSelectionForContextMenu = {
                            ...selectionInfo,
                            selectedText: selection.toString().trim(),
                            range: range.cloneRange(),
                            rect: range.getBoundingClientRect()
                        };
                    }
                } else {
                    savedSelectionForContextMenu = null;
                }

                // Update menu item states based on selection
                if (hasSelection) {
                    contextMenuCut.classList.remove('disabled');
                    contextMenuCopy.classList.remove('disabled');
                    contextMenuAddComment.classList.remove('disabled');
                } else {
                    contextMenuCut.classList.add('disabled');
                    contextMenuCopy.classList.add('disabled');
                    contextMenuAddComment.classList.add('disabled');
                }
                // Paste is always enabled (depends on clipboard content, not selection)
                contextMenuPaste.classList.remove('disabled');

                // Position and show context menu
                e.preventDefault();
                const x = Math.min(e.clientX, window.innerWidth - 220);
                const y = Math.min(e.clientY, window.innerHeight - 150);
                contextMenu.style.left = x + 'px';
                contextMenu.style.top = y + 'px';
                contextMenu.style.display = 'block';
            }

            // Hide context menu
            function hideContextMenu() {
                contextMenu.style.display = 'none';
            }

            // Handle cut (uses saved selection from context menu)
            function handleCut() {
                if (savedSelectionForContextMenu && savedSelectionForContextMenu.selectedText) {
                    navigator.clipboard.writeText(savedSelectionForContextMenu.selectedText).then(() => {
                        // Restore selection and delete
                        const selection = window.getSelection();
                        selection.removeAllRanges();
                        selection.addRange(savedSelectionForContextMenu.range);
                        document.execCommand('delete');
                        savedSelectionForContextMenu = null;
                    });
                }
            }

            // Handle copy (uses saved selection from context menu)
            function handleCopy() {
                if (savedSelectionForContextMenu && savedSelectionForContextMenu.selectedText) {
                    navigator.clipboard.writeText(savedSelectionForContextMenu.selectedText);
                }
            }

            // Handle paste
            function handlePaste() {
                navigator.clipboard.readText().then(text => {
                    editorContent.focus();
                    document.execCommand('insertText', false, text);
                }).catch(() => {
                    // Fallback if clipboard API fails
                    editorContent.focus();
                    document.execCommand('paste');
                });
            }

            // Handle add comment from context menu (uses saved selection)
            function handleAddCommentFromContextMenu() {
                if (!savedSelectionForContextMenu) {
                    alert('Please select some text first to add a comment.');
                    return;
                }

                pendingSelection = {
                    startLine: savedSelectionForContextMenu.startLine,
                    startColumn: savedSelectionForContextMenu.startColumn,
                    endLine: savedSelectionForContextMenu.endLine,
                    endColumn: savedSelectionForContextMenu.endColumn,
                    selectedText: savedSelectionForContextMenu.selectedText
                };

                // Show the floating panel
                showFloatingPanel(savedSelectionForContextMenu.rect, savedSelectionForContextMenu.selectedText);
                savedSelectionForContextMenu = null;
            }

            // Handle messages from extension
            function handleMessage(event) {
                const message = event.data;
                
                switch (message.type) {
                    case 'update':
                        currentContent = message.content;
                        comments = message.comments || [];
                        filePath = message.filePath;
                        if (message.settings) {
                            settings = { ...settings, ...message.settings };
                            showResolvedCheckbox.checked = settings.showResolved;
                        }
                        render();
                        break;
                }
            }

            // Handle text selection for adding comments
            function handleSelectionChange() {
                const selection = window.getSelection();
                if (selection && !selection.isCollapsed) {
                    const text = selection.toString().trim();
                    if (text.length > 0) {
                        // Show hint for adding comment (optional enhancement)
                    }
                }
            }

            // Handle add comment (Ctrl+Shift+M or from selection)
            function handleAddComment() {
                const selection = window.getSelection();
                if (!selection || selection.isCollapsed) {
                    alert('Please select some text first to add a comment.');
                    return;
                }

                const selectedText = selection.toString().trim();
                if (!selectedText) {
                    alert('Please select some text first to add a comment.');
                    return;
                }

                // Get selection position info
                const range = selection.getRangeAt(0);
                const selectionInfo = getSelectionPosition(range);
                
                if (!selectionInfo) {
                    alert('Could not determine selection position.');
                    return;
                }

                pendingSelection = {
                    ...selectionInfo,
                    selectedText: selectedText
                };

                // Position and show the floating panel near the selection
                const rect = range.getBoundingClientRect();
                showFloatingPanel(rect, selectedText);
            }

            // Show floating panel for new comment
            function showFloatingPanel(selectionRect, selectedText) {
                floatingSelection.textContent = selectedText;
                floatingInput.value = '';
                
                // Position the panel near the selection
                const panelWidth = 380;
                const containerRect = editorContainer.getBoundingClientRect();
                
                let left = selectionRect.left;
                let top = selectionRect.bottom + 10;
                
                // Adjust if panel would go off-screen
                if (left + panelWidth > window.innerWidth - 20) {
                    left = window.innerWidth - panelWidth - 20;
                }
                if (left < 20) {
                    left = 20;
                }
                if (top + 250 > window.innerHeight) {
                    top = selectionRect.top - 260;
                }
                
                floatingPanel.style.left = left + 'px';
                floatingPanel.style.top = top + 'px';
                floatingPanel.style.display = 'block';
                
                setTimeout(() => floatingInput.focus(), 50);
            }

            // Close floating panel
            function closeFloatingPanel() {
                floatingPanel.style.display = 'none';
                pendingSelection = null;
                floatingInput.value = '';
            }

            // Save new comment from floating panel
            function saveNewComment() {
                const commentText = floatingInput.value.trim();
                if (!commentText) {
                    alert('Please enter a comment.');
                    return;
                }

                if (pendingSelection) {
                    vscode.postMessage({
                        type: 'addComment',
                        selection: pendingSelection,
                        comment: commentText
                    });
                }

                closeFloatingPanel();
            }

            // Show inline edit panel
            function showInlineEditPanel(comment, rect) {
                editingCommentId = comment.id;
                inlineEditInput.value = comment.comment;
                
                // Position the panel
                let left = rect.left;
                let top = rect.bottom + 5;
                
                if (left + 350 > window.innerWidth - 20) {
                    left = window.innerWidth - 370;
                }
                if (top + 150 > window.innerHeight) {
                    top = rect.top - 160;
                }
                
                inlineEditPanel.style.left = left + 'px';
                inlineEditPanel.style.top = top + 'px';
                inlineEditPanel.style.display = 'block';
                
                setTimeout(() => inlineEditInput.focus(), 50);
            }

            // Close inline edit panel
            function closeInlineEditPanel() {
                inlineEditPanel.style.display = 'none';
                editingCommentId = null;
            }

            // Save edited comment
            function saveEditedComment() {
                const commentText = inlineEditInput.value.trim();
                if (!commentText) {
                    alert('Comment cannot be empty.');
                    return;
                }

                if (editingCommentId) {
                    vscode.postMessage({
                        type: 'editComment',
                        commentId: editingCommentId,
                        comment: commentText
                    });
                }

                closeInlineEditPanel();
            }

            // Render the editor content with comments
            function render() {
                const lines = currentContent.split('\\n');
                const commentsMap = groupCommentsByLine(comments);
                
                let html = '';
                let lineNumbersHtml = '';
                
                lines.forEach((line, index) => {
                    const lineNum = index + 1;
                    const lineComments = commentsMap.get(lineNum) || [];
                    const visibleComments = lineComments.filter(c => 
                        settings.showResolved || c.status !== 'resolved'
                    );
                    
                    // Check if this line has comments
                    const hasComments = visibleComments.length > 0;
                    const gutterIcon = hasComments 
                        ? '<span class="gutter-icon" title="Click to view comments">💬</span>' 
                        : '';
                    
                    // Build line with highlighted sections
                    let lineHtml = escapeHtml(line) || '&nbsp;';
                    
                    // Apply comment highlights
                    visibleComments.forEach(comment => {
                        const statusClass = comment.status === 'resolved' ? 'resolved' : '';
                        lineHtml = '<span class="commented-text ' + statusClass + '" data-comment-id="' + comment.id + '">' + lineHtml + '</span>';
                    });
                    
                    html += '<div class="line" data-line="' + lineNum + '">' + lineHtml + '</div>';
                    lineNumbersHtml += '<div class="line-number">' + gutterIcon + lineNum + '</div>';
                });
                
                editorContent.innerHTML = html;
                lineNumbers.innerHTML = lineNumbersHtml;
                
                // Update stats
                const open = comments.filter(c => c.status === 'open').length;
                const resolved = comments.filter(c => c.status === 'resolved').length;
                openCount.textContent = open;
                resolvedCount.textContent = resolved;
                
                // Setup click handlers for commented text and gutter icons
                setupCommentInteractions();
            }

            // Group comments by their starting line
            function groupCommentsByLine(comments) {
                const map = new Map();
                comments.forEach(comment => {
                    const line = comment.selection.startLine;
                    if (!map.has(line)) {
                        map.set(line, []);
                    }
                    map.get(line).push(comment);
                });
                return map;
            }

            // Setup click handlers for viewing/interacting with comments
            function setupCommentInteractions() {
                // Click on commented text to show bubble
                document.querySelectorAll('.commented-text').forEach(el => {
                    el.addEventListener('click', (e) => {
                        e.stopPropagation();
                        const commentId = el.dataset.commentId;
                        const comment = comments.find(c => c.id === commentId);
                        if (comment) {
                            showCommentBubble(comment, el);
                        }
                    });
                });

                // Click on gutter icon
                document.querySelectorAll('.gutter-icon').forEach(icon => {
                    icon.addEventListener('click', (e) => {
                        e.stopPropagation();
                        const lineNumEl = icon.closest('.line-number');
                        const index = Array.from(lineNumbers.children).indexOf(lineNumEl);
                        const lineNum = index + 1;
                        
                        const lineComments = comments.filter(c => 
                            c.selection.startLine === lineNum && 
                            (settings.showResolved || c.status !== 'resolved')
                        );
                        
                        if (lineComments.length > 0) {
                            const lineEl = editorContent.querySelector('[data-line="' + lineNum + '"]');
                            if (lineEl) {
                                showCommentBubble(lineComments[0], lineEl);
                            }
                        }
                    });
                });
            }

            // Show inline comment bubble
            function showCommentBubble(comment, anchorEl) {
                closeActiveCommentBubble();
                
                const bubble = document.createElement('div');
                bubble.className = 'inline-comment-bubble' + (comment.status === 'resolved' ? ' resolved' : '');
                bubble.innerHTML = renderCommentBubbleContent(comment);
                
                // Position after the anchor element
                anchorEl.style.position = 'relative';
                anchorEl.appendChild(bubble);
                
                activeCommentBubble = { element: bubble, anchor: anchorEl };
                
                // Setup bubble action handlers
                setupBubbleActions(bubble, comment);
            }

            // Render comment bubble content
            function renderCommentBubbleContent(comment) {
                const statusClass = comment.status;
                const statusLabel = comment.status === 'open' ? '○ Open' : '✓ Resolved';
                const resolveBtn = comment.status === 'open'
                    ? '<button class="bubble-action-btn" data-action="resolve" title="Resolve">✅</button>'
                    : '<button class="bubble-action-btn" data-action="reopen" title="Reopen">🔄</button>';
                
                const lineRange = comment.selection.startLine === comment.selection.endLine
                    ? 'Line ' + comment.selection.startLine
                    : 'Lines ' + comment.selection.startLine + '-' + comment.selection.endLine;
                
                return '<div class="bubble-header">' +
                    '<div class="bubble-meta">' + lineRange + 
                    '<span class="status ' + statusClass + '">' + statusLabel + '</span></div>' +
                    '<div class="bubble-actions">' +
                    resolveBtn +
                    '<button class="bubble-action-btn" data-action="edit" title="Edit">✏️</button>' +
                    '<button class="bubble-action-btn" data-action="delete" title="Delete">🗑️</button>' +
                    '</div></div>' +
                    '<div class="bubble-selected-text">' + escapeHtml(comment.selectedText) + '</div>' +
                    '<div class="bubble-comment-text">' + escapeHtml(comment.comment) + '</div>';
            }

            // Setup bubble action button handlers
            function setupBubbleActions(bubble, comment) {
                bubble.querySelectorAll('.bubble-action-btn').forEach(btn => {
                    btn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        const action = btn.dataset.action;
                        
                        switch (action) {
                            case 'resolve':
                                vscode.postMessage({ type: 'resolveComment', commentId: comment.id });
                                closeActiveCommentBubble();
                                break;
                            case 'reopen':
                                vscode.postMessage({ type: 'reopenComment', commentId: comment.id });
                                closeActiveCommentBubble();
                                break;
                            case 'edit':
                                closeActiveCommentBubble();
                                showInlineEditPanel(comment, btn.getBoundingClientRect());
                                break;
                            case 'delete':
                                vscode.postMessage({ type: 'deleteComment', commentId: comment.id });
                                closeActiveCommentBubble();
                                break;
                        }
                    });
                });
            }

            // Close active comment bubble
            function closeActiveCommentBubble() {
                if (activeCommentBubble) {
                    activeCommentBubble.element.remove();
                    activeCommentBubble = null;
                }
            }

            // Get selection position (line and column)
            function getSelectionPosition(range) {
                const startContainer = range.startContainer;
                const endContainer = range.endContainer;
                
                const startLine = findLineElement(startContainer);
                const endLine = findLineElement(endContainer);
                
                if (!startLine || !endLine) return null;
                
                const startLineNum = parseInt(startLine.dataset.line);
                const endLineNum = parseInt(endLine.dataset.line);
                
                // Simplified column calculation
                const startColumn = range.startOffset + 1;
                const endColumn = range.endOffset + 1;
                
                return {
                    startLine: startLineNum,
                    startColumn: startColumn,
                    endLine: endLineNum,
                    endColumn: endColumn
                };
            }

            // Find the parent line element
            function findLineElement(node) {
                let current = node;
                while (current && current !== editorContent) {
                    if (current.classList && current.classList.contains('line')) {
                        return current;
                    }
                    current = current.parentElement;
                }
                return null;
            }

            // Handle editor input (content changes)
            function handleEditorInput(e) {
                const newContent = getPlainTextContent();
                if (newContent !== currentContent) {
                    currentContent = newContent;
                    vscode.postMessage({
                        type: 'updateContent',
                        content: newContent
                    });
                }
            }

            // Handle special keys in editor
            function handleEditorKeydown(e) {
                if (e.key === 'Tab') {
                    e.preventDefault();
                    document.execCommand('insertText', false, '    ');
                }
            }

            // Get plain text content from editor
            function getPlainTextContent() {
                const lines = [];
                editorContent.querySelectorAll('.line').forEach(lineEl => {
                    let text = '';
                    lineEl.childNodes.forEach(node => {
                        if (node.nodeType === Node.TEXT_NODE) {
                            text += node.textContent;
                        } else if (node.classList && node.classList.contains('commented-text')) {
                            text += node.textContent;
                        } else if (node.nodeType === Node.ELEMENT_NODE && 
                                   !node.classList.contains('inline-comment-bubble')) {
                            text += node.textContent;
                        }
                    });
                    if (text === '\\u00a0' || text === '') {
                        text = '';
                    }
                    lines.push(text);
                });
                return lines.join('\\n');
            }

            // Escape HTML entities
            function escapeHtml(text) {
                const div = document.createElement('div');
                div.textContent = text;
                return div.innerHTML;
            }

            // Initialize
            init();
        })();
    `;
}
