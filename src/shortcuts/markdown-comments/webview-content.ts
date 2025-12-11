/**
 * Webview content generator for the Review Editor View
 */

import * as vscode from 'vscode';

/**
 * Generate the HTML content for the custom editor webview
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
            <button id="addCommentBtn" class="toolbar-btn" title="Add Comment (Select text first)">
                <span class="icon">💬</span> Add Comment
            </button>
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
    
    <div class="editor-container">
        <div class="editor-wrapper">
            <div class="line-numbers" id="lineNumbers"></div>
            <div class="editor-content" id="editorContent" contenteditable="true" spellcheck="true"></div>
        </div>
    </div>

    <div class="comment-dialog" id="commentDialog" style="display: none;">
        <div class="dialog-content">
            <h3 id="dialogTitle">Add Comment</h3>
            <div class="selected-text-preview" id="selectedTextPreview"></div>
            <textarea id="commentInput" placeholder="Enter your comment..." rows="4"></textarea>
            <div class="dialog-buttons">
                <button id="dialogCancel" class="btn btn-secondary">Cancel</button>
                <button id="dialogConfirm" class="btn btn-primary">Add Comment</button>
            </div>
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
            --comment-bg: var(--vscode-editorWidget-background);
            --comment-border: var(--vscode-editorWidget-border);
            --button-bg: var(--vscode-button-background);
            --button-fg: var(--vscode-button-foreground);
            --button-hover: var(--vscode-button-hoverBackground);
            --input-bg: var(--vscode-input-background);
            --input-fg: var(--vscode-input-foreground);
            --input-border: var(--vscode-input-border);
            --line-number-color: var(--vscode-editorLineNumber-foreground);
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
        }

        .editor-wrapper {
            display: flex;
            min-height: 100%;
        }

        .line-numbers {
            width: 50px;
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
        }

        .commented-text.resolved {
            background-color: var(--highlight-resolved);
            border-bottom-color: #4caf50;
        }

        .commented-text:hover {
            filter: brightness(0.9);
        }

        /* Inline comment block */
        .comment-block {
            display: block;
            margin: 8px 0 8px 20px;
            padding: 12px;
            background: var(--comment-bg);
            border: 1px solid var(--comment-border);
            border-radius: 6px;
            border-left: 4px solid #f9a825;
            font-family: var(--vscode-font-family);
            font-size: 13px;
        }

        .comment-block.resolved {
            border-left-color: #4caf50;
            opacity: 0.7;
        }

        .comment-block.hidden {
            display: none;
        }

        .comment-header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            margin-bottom: 8px;
        }

        .comment-meta {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
        }

        .comment-meta .status {
            display: inline-block;
            padding: 2px 6px;
            border-radius: 3px;
            font-weight: 500;
            margin-left: 8px;
        }

        .comment-meta .status.open {
            background: var(--highlight-open);
            color: #f57f17;
        }

        .comment-meta .status.resolved {
            background: var(--highlight-resolved);
            color: #2e7d32;
        }

        .comment-actions {
            display: flex;
            gap: 4px;
        }

        .comment-action-btn {
            background: none;
            border: none;
            cursor: pointer;
            padding: 4px;
            border-radius: 4px;
            font-size: 14px;
            opacity: 0.7;
            transition: opacity 0.2s, background-color 0.2s;
        }

        .comment-action-btn:hover {
            opacity: 1;
            background: var(--vscode-toolbar-hoverBackground);
        }

        .comment-selected-text {
            background: var(--vscode-textBlockQuote-background);
            padding: 6px 10px;
            border-radius: 4px;
            font-family: var(--vscode-editor-font-family, monospace);
            font-size: 12px;
            margin-bottom: 8px;
            border-left: 3px solid var(--vscode-textBlockQuote-border);
            max-height: 60px;
            overflow: auto;
        }

        .comment-text {
            white-space: pre-wrap;
            line-height: 1.4;
        }

        /* Dialog */
        .comment-dialog {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.5);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 1000;
        }

        .dialog-content {
            background: var(--comment-bg);
            border: 1px solid var(--comment-border);
            border-radius: 8px;
            padding: 20px;
            width: 90%;
            max-width: 500px;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
        }

        .dialog-content h3 {
            margin-bottom: 16px;
            font-size: 16px;
        }

        .selected-text-preview {
            background: var(--vscode-textBlockQuote-background);
            padding: 10px;
            border-radius: 4px;
            font-family: var(--vscode-editor-font-family, monospace);
            font-size: 12px;
            margin-bottom: 16px;
            max-height: 100px;
            overflow: auto;
            border-left: 3px solid var(--vscode-textBlockQuote-border);
        }

        .dialog-content textarea {
            width: 100%;
            padding: 10px;
            background: var(--input-bg);
            color: var(--input-fg);
            border: 1px solid var(--input-border);
            border-radius: 4px;
            font-family: var(--vscode-font-family);
            font-size: 13px;
            resize: vertical;
            margin-bottom: 16px;
        }

        .dialog-content textarea:focus {
            outline: none;
            border-color: var(--vscode-focusBorder);
        }

        .dialog-buttons {
            display: flex;
            justify-content: flex-end;
            gap: 8px;
        }

        .btn {
            padding: 8px 16px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 13px;
            transition: background-color 0.2s;
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

            // DOM elements
            const editorContent = document.getElementById('editorContent');
            const lineNumbers = document.getElementById('lineNumbers');
            const commentDialog = document.getElementById('commentDialog');
            const commentInput = document.getElementById('commentInput');
            const selectedTextPreview = document.getElementById('selectedTextPreview');
            const dialogTitle = document.getElementById('dialogTitle');
            const dialogConfirm = document.getElementById('dialogConfirm');
            const showResolvedCheckbox = document.getElementById('showResolvedCheckbox');
            const openCount = document.getElementById('openCount');
            const resolvedCount = document.getElementById('resolvedCount');

            // Initialize
            function init() {
                setupEventListeners();
                vscode.postMessage({ type: 'ready' });
            }

            // Setup event listeners
            function setupEventListeners() {
                // Toolbar buttons
                document.getElementById('addCommentBtn').addEventListener('click', handleAddComment);
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

                // Dialog buttons
                document.getElementById('dialogCancel').addEventListener('click', closeDialog);
                document.getElementById('dialogConfirm').addEventListener('click', confirmDialog);

                // Editor input
                editorContent.addEventListener('input', handleEditorInput);
                editorContent.addEventListener('keydown', handleEditorKeydown);

                // Close dialog on escape
                document.addEventListener('keydown', (e) => {
                    if (e.key === 'Escape' && commentDialog.style.display !== 'none') {
                        closeDialog();
                    }
                });

                // Listen for messages from extension
                window.addEventListener('message', handleMessage);
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

            // Render the editor content with comments
            function render() {
                const lines = currentContent.split('\\n');
                const commentsMap = groupCommentsByLine(comments);
                
                let html = '';
                let lineNumbersHtml = '';
                
                lines.forEach((line, index) => {
                    const lineNum = index + 1;
                    const lineComments = commentsMap.get(lineNum) || [];
                    
                    // Build line with highlighted sections
                    let lineHtml = escapeHtml(line) || '&nbsp;';
                    
                    // Apply comment highlights (simplified - highlights entire line if commented)
                    lineComments.forEach(comment => {
                        if (comment.status === 'resolved' && !settings.showResolved) {
                            return;
                        }
                        const statusClass = comment.status === 'resolved' ? 'resolved' : '';
                        lineHtml = \`<span class="commented-text \${statusClass}" data-comment-id="\${comment.id}">\${lineHtml}</span>\`;
                    });
                    
                    html += \`<div class="line" data-line="\${lineNum}">\${lineHtml}</div>\`;
                    
                    // Add comment blocks after the line
                    lineComments.forEach(comment => {
                        if (comment.status === 'resolved' && !settings.showResolved) {
                            return;
                        }
                        html += renderCommentBlock(comment);
                    });
                    
                    lineNumbersHtml += \`<div class="line-number">\${lineNum}</div>\`;
                    
                    // Add placeholder for comment blocks in line numbers
                    lineComments.forEach(comment => {
                        if (comment.status === 'resolved' && !settings.showResolved) {
                            return;
                        }
                        lineNumbersHtml += \`<div class="line-number">&nbsp;</div>\`;
                    });
                });
                
                editorContent.innerHTML = html;
                lineNumbers.innerHTML = lineNumbersHtml;
                
                // Update stats
                const open = comments.filter(c => c.status === 'open').length;
                const resolved = comments.filter(c => c.status === 'resolved').length;
                openCount.textContent = open;
                resolvedCount.textContent = resolved;
                
                // Setup comment block event listeners
                setupCommentBlockListeners();
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

            // Render a single comment block
            function renderCommentBlock(comment) {
                const statusClass = comment.status === 'resolved' ? 'resolved' : '';
                const statusLabel = comment.status === 'open' ? 'Open' : 'Resolved';
                const resolveBtn = comment.status === 'open' 
                    ? \`<button class="comment-action-btn" data-action="resolve" data-id="\${comment.id}" title="Resolve">✅</button>\`
                    : \`<button class="comment-action-btn" data-action="reopen" data-id="\${comment.id}" title="Reopen">🔄</button>\`;
                
                return \`
                    <div class="comment-block \${statusClass}" data-comment-id="\${comment.id}">
                        <div class="comment-header">
                            <div class="comment-meta">
                                Line \${comment.selection.startLine}\${comment.selection.endLine > comment.selection.startLine ? '-' + comment.selection.endLine : ''}
                                <span class="status \${comment.status}">\${statusLabel}</span>
                            </div>
                            <div class="comment-actions">
                                \${resolveBtn}
                                <button class="comment-action-btn" data-action="edit" data-id="\${comment.id}" title="Edit">✏️</button>
                                <button class="comment-action-btn" data-action="delete" data-id="\${comment.id}" title="Delete">🗑️</button>
                            </div>
                        </div>
                        <div class="comment-selected-text">\${escapeHtml(comment.selectedText)}</div>
                        <div class="comment-text">\${escapeHtml(comment.comment)}</div>
                    </div>
                \`;
            }

            // Setup event listeners for comment blocks
            function setupCommentBlockListeners() {
                document.querySelectorAll('.comment-action-btn').forEach(btn => {
                    btn.addEventListener('click', (e) => {
                        const action = e.target.dataset.action;
                        const id = e.target.dataset.id;
                        
                        switch (action) {
                            case 'resolve':
                                vscode.postMessage({ type: 'resolveComment', commentId: id });
                                break;
                            case 'reopen':
                                vscode.postMessage({ type: 'reopenComment', commentId: id });
                                break;
                            case 'edit':
                                editComment(id);
                                break;
                            case 'delete':
                                vscode.postMessage({ type: 'deleteComment', commentId: id });
                                break;
                        }
                    });
                });
            }

            // Handle add comment button
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

                // Get selection position
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
                editingCommentId = null;
                
                dialogTitle.textContent = 'Add Comment';
                dialogConfirm.textContent = 'Add Comment';
                selectedTextPreview.textContent = selectedText;
                commentInput.value = '';
                commentDialog.style.display = 'flex';
                commentInput.focus();
            }

            // Edit existing comment
            function editComment(commentId) {
                const comment = comments.find(c => c.id === commentId);
                if (!comment) return;

                editingCommentId = commentId;
                pendingSelection = null;
                
                dialogTitle.textContent = 'Edit Comment';
                dialogConfirm.textContent = 'Save Changes';
                selectedTextPreview.textContent = comment.selectedText;
                commentInput.value = comment.comment;
                commentDialog.style.display = 'flex';
                commentInput.focus();
            }

            // Get selection position (line and column)
            function getSelectionPosition(range) {
                const startContainer = range.startContainer;
                const endContainer = range.endContainer;
                
                // Find the line elements
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

            // Close dialog
            function closeDialog() {
                commentDialog.style.display = 'none';
                pendingSelection = null;
                editingCommentId = null;
                commentInput.value = '';
            }

            // Confirm dialog action
            function confirmDialog() {
                const commentText = commentInput.value.trim();
                if (!commentText) {
                    alert('Please enter a comment.');
                    return;
                }

                if (editingCommentId) {
                    // Edit existing comment
                    vscode.postMessage({
                        type: 'editComment',
                        commentId: editingCommentId,
                        comment: commentText
                    });
                } else if (pendingSelection) {
                    // Add new comment
                    vscode.postMessage({
                        type: 'addComment',
                        selection: pendingSelection,
                        comment: commentText
                    });
                }

                closeDialog();
            }

            // Handle editor input (content changes)
            function handleEditorInput(e) {
                // Get plain text content
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
                // Handle Tab
                if (e.key === 'Tab') {
                    e.preventDefault();
                    document.execCommand('insertText', false, '    ');
                }
            }

            // Get plain text content from editor (excluding comment blocks)
            function getPlainTextContent() {
                const lines = [];
                editorContent.querySelectorAll('.line').forEach(lineEl => {
                    // Get text content, stripping any HTML
                    let text = '';
                    lineEl.childNodes.forEach(node => {
                        if (node.nodeType === Node.TEXT_NODE) {
                            text += node.textContent;
                        } else if (node.classList && node.classList.contains('commented-text')) {
                            text += node.textContent;
                        } else if (node.nodeType === Node.ELEMENT_NODE && !node.classList.contains('comment-block')) {
                            text += node.textContent;
                        }
                    });
                    // Handle empty lines (nbsp)
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
