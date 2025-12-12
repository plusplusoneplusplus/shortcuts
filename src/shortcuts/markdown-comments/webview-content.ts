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
 * NOTE: Core calculation logic (e.g., table cell line numbers) is generated from
 * webview-utils.ts to ensure it stays in sync with unit tests.
 */

import * as vscode from 'vscode';
import { getWebviewTableCellLineFunction } from './webview-utils';

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

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net; img-src ${webview.cspSource} data: https:; font-src ${webview.cspSource};">
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
            let fileDir = ''; // Directory of the current file for resolving relative paths
            let workspaceRoot = ''; // Workspace root for resolving paths
            let settings = { showResolved: true };
            let pendingSelection = null;
            let editingCommentId = null;
            let activeCommentBubble = null;
            let savedSelectionForContextMenu = null; // Saved selection when context menu opens
            let mermaidLoaded = false;
            let mermaidLoading = false;
            let pendingMermaidBlocks = [];

            // DOM elements
            const editorContainer = document.getElementById('editorContainer');
            const editorWrapper = document.getElementById('editorWrapper');
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

                // Setup drag functionality for floating panel
                setupPanelDrag(floatingPanel);

                // Inline edit panel buttons
                document.getElementById('inlineEditClose').addEventListener('click', closeInlineEditPanel);
                document.getElementById('inlineEditCancelBtn').addEventListener('click', closeInlineEditPanel);
                document.getElementById('inlineEditSaveBtn').addEventListener('click', saveEditedComment);

                // Setup drag functionality for inline edit panel
                setupPanelDrag(inlineEditPanel);

                // Ctrl+Enter to submit comments
                floatingInput.addEventListener('keydown', (e) => {
                    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                        e.preventDefault();
                        saveNewComment();
                    }
                });
                inlineEditInput.addEventListener('keydown', (e) => {
                    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                        e.preventDefault();
                        saveEditedComment();
                    }
                });

                // Editor input
                editorWrapper.addEventListener('input', handleEditorInput);
                editorWrapper.addEventListener('keydown', handleEditorKeydown);
                editorWrapper.addEventListener('mouseup', handleSelectionChange);
                editorWrapper.addEventListener('keyup', handleSelectionChange);

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

                // Context menu - attach to document to work with tables and code blocks too
                document.addEventListener('contextmenu', (e) => {
                    // Only handle context menu within the editor container
                    if (e.target.closest('#editorContainer')) {
                        handleContextMenu(e);
                    }
                });
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
                    editorWrapper.focus();
                    document.execCommand('insertText', false, text);
                }).catch(() => {
                    // Fallback if clipboard API fails
                    editorWrapper.focus();
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
                        fileDir = message.fileDir || '';
                        workspaceRoot = message.workspaceRoot || '';
                        if (message.settings) {
                            settings = { ...settings, ...message.settings };
                            showResolvedCheckbox.checked = settings.showResolved;
                        }
                        render();
                        break;
                    
                    case 'imageResolved':
                        // Update the image with the resolved URI
                        const img = document.querySelector('.md-image-preview[data-img-id="' + message.imgId + '"]');
                        if (img) {
                            if (message.uri) {
                                img.src = message.uri;
                                img.alt = message.alt || 'Image';
                            } else {
                                // Image not found
                                img.style.display = 'none';
                                const errorSpan = img.nextElementSibling;
                                if (errorSpan && errorSpan.classList.contains('md-image-error')) {
                                    errorSpan.style.display = 'inline';
                                    errorSpan.textContent = '⚠️ ' + (message.error || 'Image not found: ' + img.dataset.pendingPath);
                                }
                            }
                        }
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
                    const message = {
                        type: 'addComment',
                        selection: pendingSelection,
                        comment: commentText
                    };
                    
                    // Include mermaid context if present
                    if (pendingSelection.mermaidContext) {
                        message.mermaidContext = pendingSelection.mermaidContext;
                    }
                    
                    vscode.postMessage(message);
                }

                closeFloatingPanel();
            }

            // Show inline edit panel
            function showInlineEditPanel(comment, rect) {
                editingCommentId = comment.id;
                inlineEditInput.value = comment.comment;
                
                // Use absolute positioning relative to document
                // Calculate position accounting for scroll
                const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
                const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;
                
                let left = rect.left + scrollLeft;
                let top = rect.bottom + scrollTop + 5;
                
                // Adjust if panel would go off-screen horizontally
                if (left + 350 > window.innerWidth + scrollLeft - 20) {
                    left = window.innerWidth + scrollLeft - 370;
                }
                if (left < scrollLeft + 20) {
                    left = scrollLeft + 20;
                }
                
                // Adjust if panel would go off-screen vertically
                const viewportBottom = scrollTop + window.innerHeight;
                if (top + 150 > viewportBottom) {
                    top = rect.top + scrollTop - 160;
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

            // ==============================
            // Markdown Syntax Highlighting
            // ==============================
            
            /**
             * Apply markdown syntax highlighting to a single line
             */
            function applyMarkdownHighlighting(line, lineNum, inCodeBlock, codeBlockLang) {
                // If we're inside a code block, don't apply markdown highlighting
                if (inCodeBlock && !line.startsWith('\`\`\`')) {
                    return { html: escapeHtml(line), inCodeBlock: true, codeBlockLang };
                }
                
                // Check for code fence start/end
                const codeFenceMatch = line.match(/^\`\`\`(\\w*)/);
                if (codeFenceMatch) {
                    if (!inCodeBlock) {
                        // Starting a code block
                        const lang = codeFenceMatch[1] || 'plaintext';
                        return { 
                            html: '<span class="md-code-fence">' + escapeHtml(line) + '</span>', 
                            inCodeBlock: true, 
                            codeBlockLang: lang,
                            isCodeFenceStart: true
                        };
                    } else {
                        // Ending a code block
                        return { 
                            html: '<span class="md-code-fence">' + escapeHtml(line) + '</span>', 
                            inCodeBlock: false, 
                            codeBlockLang: null,
                            isCodeFenceEnd: true
                        };
                    }
                }
                
                let html = escapeHtml(line);
                
                // Horizontal rule (must check before headings)
                if (/^(---+|\\*\\*\\*+|___+)\\s*$/.test(line)) {
                    return { html: '<span class="md-hr">' + html + '</span>', inCodeBlock: false, codeBlockLang: null };
                }
                
                // Headings
                const headingMatch = line.match(/^(#{1,6})\\s+(.*)$/);
                if (headingMatch) {
                    const level = headingMatch[1].length;
                    const hashes = escapeHtml(headingMatch[1]);
                    const content = applyInlineMarkdown(headingMatch[2]);
                    html = '<span class="md-h' + level + '"><span class="md-hash">' + hashes + '</span> ' + content + '</span>';
                    return { html, inCodeBlock: false, codeBlockLang: null };
                }
                
                // Blockquotes
                if (/^>\\s*/.test(line)) {
                    const content = line.replace(/^>\\s*/, '');
                    html = '<span class="md-blockquote"><span class="md-blockquote-marker">&gt;</span> ' + applyInlineMarkdown(content) + '</span>';
                    return { html, inCodeBlock: false, codeBlockLang: null };
                }
                
                // Unordered list items
                const ulMatch = line.match(/^(\\s*)([\\-\\*\\+])\\s+(.*)$/);
                if (ulMatch) {
                    const indent = ulMatch[1];
                    const marker = ulMatch[2];
                    let content = ulMatch[3];
                    
                    // Check for checkbox
                    const checkboxMatch = content.match(/^\\[([ xX])\\]\\s*(.*)$/);
                    if (checkboxMatch) {
                        const checked = checkboxMatch[1].toLowerCase() === 'x';
                        const checkboxClass = checked ? 'md-checkbox md-checkbox-checked' : 'md-checkbox';
                        const checkbox = checked ? '[x]' : '[ ]';
                        content = '<span class="' + checkboxClass + '">' + checkbox + '</span> ' + applyInlineMarkdown(checkboxMatch[2]);
                    } else {
                        content = applyInlineMarkdown(content);
                    }
                    
                    html = '<span class="md-list-item">' + indent + '<span class="md-list-marker">' + escapeHtml(marker) + '</span> ' + content + '</span>';
                    return { html, inCodeBlock: false, codeBlockLang: null };
                }
                
                // Ordered list items
                const olMatch = line.match(/^(\\s*)(\\d+\\.)\\s+(.*)$/);
                if (olMatch) {
                    const indent = olMatch[1];
                    const marker = olMatch[2];
                    const content = applyInlineMarkdown(olMatch[3]);
                    html = '<span class="md-list-item">' + indent + '<span class="md-list-marker">' + escapeHtml(marker) + '</span> ' + content + '</span>';
                    return { html, inCodeBlock: false, codeBlockLang: null };
                }
                
                // Apply inline markdown (bold, italic, code, links, etc.)
                html = applyInlineMarkdown(line);
                
                return { html, inCodeBlock: false, codeBlockLang: null };
            }
            
            /**
             * Resolve image path relative to the file or workspace
             */
            function resolveImagePath(src) {
                // If it's already an absolute URL (http, https, data), return as is
                if (/^(https?:|data:)/.test(src)) {
                    return src;
                }
                
                // For relative paths, we need to construct a proper path
                // The webview will need to convert this to a webview URI
                // For now, we'll mark it for post-processing
                return 'IMG_PATH:' + src;
            }
            
            /**
             * Apply inline markdown formatting (bold, italic, code, links, images)
             */
            function applyInlineMarkdown(text) {
                if (!text) return '';
                
                let html = escapeHtml(text);
                
                // Order matters - process from most specific to least specific
                
                // Inline code (must be before bold/italic to avoid conflicts)
                html = html.replace(/\`([^\`]+)\`/g, '<span class="md-inline-code">\`$1\`</span>');
                
                // Images ![alt](url) - render as actual images with preview
                html = html.replace(/!\\[([^\\]]*)\\]\\(([^)]+)\\)/g, function(match, alt, src) {
                    const resolvedSrc = resolveImagePath(src);
                    const escapedAlt = alt || 'Image';
                    const escapedSrc = escapeHtml(src);
                    return '<span class="md-image-container" data-src="' + escapedSrc + '">' +
                        '<span class="md-image-syntax">![' + escapeHtml(alt) + '](' + escapedSrc + ')</span>' +
                        '<img class="md-image-preview" src="' + resolvedSrc + '" alt="' + escapeHtml(escapedAlt) + '" title="' + escapeHtml(escapedAlt) + '" loading="lazy" onerror="this.style.display=\\'none\\';this.nextElementSibling.style.display=\\'inline\\';">' +
                        '<span class="md-image-error" style="display:none;">⚠️ Image not found</span>' +
                    '</span>';
                });
                
                // Links [text](url)
                html = html.replace(/\\[([^\\]]+)\\]\\(([^)]+)\\)/g, 
                    '<span class="md-link"><span class="md-link-text">[$1]</span><span class="md-link-url">($2)</span></span>');
                
                // Bold + Italic (***text*** or ___text___)
                html = html.replace(/\\*\\*\\*([^*]+)\\*\\*\\*/g, '<span class="md-bold-italic"><span class="md-marker">***</span>$1<span class="md-marker">***</span></span>');
                html = html.replace(/___([^_]+)___/g, '<span class="md-bold-italic"><span class="md-marker">___</span>$1<span class="md-marker">___</span></span>');
                
                // Bold (**text** or __text__)
                html = html.replace(/\\*\\*([^*]+)\\*\\*/g, '<span class="md-bold"><span class="md-marker">**</span>$1<span class="md-marker">**</span></span>');
                html = html.replace(/__([^_]+)__/g, '<span class="md-bold"><span class="md-marker">__</span>$1<span class="md-marker">__</span></span>');
                
                // Italic (*text* or _text_) - careful not to match inside bold
                html = html.replace(/(?<!\\*)\\*([^*]+)\\*(?!\\*)/g, '<span class="md-italic"><span class="md-marker">*</span>$1<span class="md-marker">*</span></span>');
                html = html.replace(/(?<!_)_([^_]+)_(?!_)/g, '<span class="md-italic"><span class="md-marker">_</span>$1<span class="md-marker">_</span></span>');
                
                // Strikethrough ~~text~~
                html = html.replace(/~~([^~]+)~~/g, '<span class="md-strike"><span class="md-marker">~~</span>$1<span class="md-marker">~~</span></span>');
                
                return html;
            }
            
            // ==============================
            // Code Block Handling
            // ==============================
            
            /**
             * Parse code blocks from content
             */
            function parseCodeBlocks(content) {
                const lines = content.split('\\n');
                const blocks = [];
                let inBlock = false;
                let currentBlock = null;
                let codeLines = [];
                
                lines.forEach((line, index) => {
                    const fenceMatch = line.match(/^\`\`\`(\\w*)/);
                    
                    if (fenceMatch && !inBlock) {
                        inBlock = true;
                        currentBlock = {
                            language: fenceMatch[1] || 'plaintext',
                            startLine: index + 1,
                            code: [],
                            isMermaid: fenceMatch[1] === 'mermaid'
                        };
                        codeLines = [];
                    } else if (line.startsWith('\`\`\`') && inBlock) {
                        inBlock = false;
                        currentBlock.endLine = index + 1;
                        currentBlock.code = codeLines.join('\\n');
                        currentBlock.id = 'codeblock-' + currentBlock.startLine;
                        blocks.push(currentBlock);
                        currentBlock = null;
                    } else if (inBlock) {
                        codeLines.push(line);
                    }
                });
                
                return blocks;
            }
            
            /**
             * Highlight code using highlight.js
             */
            function highlightCode(code, language) {
                if (typeof hljs === 'undefined') {
                    return escapeHtml(code);
                }
                
                try {
                    if (language && hljs.getLanguage(language)) {
                        return hljs.highlight(code, { language: language }).value;
                    } else {
                        return hljs.highlightAuto(code).value;
                    }
                } catch (e) {
                    return escapeHtml(code);
                }
            }
            
            /**
             * Render a code block with syntax highlighting and comment highlights
             */
            function renderCodeBlock(block, commentsMap) {
                const highlightedCode = highlightCode(block.code, block.language);
                const codeLines = highlightedCode.split('\\n');
                const plainCodeLines = block.code.split('\\n');
                
                const hasBlockComments = checkBlockHasComments(block.startLine, block.endLine, commentsMap);
                const containerClass = 'code-block' + (hasBlockComments ? ' has-comments' : '');
                
                let linesHtml = codeLines.map((line, i) => {
                    const actualLine = block.startLine + 1 + i; // +1 for fence line
                    const plainLine = plainCodeLines[i] || '';
                    const lineComments = getCommentsForLine(actualLine, commentsMap);

                    let lineContent = line || '&nbsp;';
                    // Apply comment highlights to this code line
                    if (lineComments.length > 0) {
                        lineContent = applyCommentsToBlockContent(lineContent, plainLine, lineComments);
                    }

                    return '<span class="code-line" data-line="' + actualLine + '">' + lineContent + '</span>';
                }).join('');
                
                return '<div class="' + containerClass + '" data-start-line="' + block.startLine + '" data-end-line="' + block.endLine + '" data-block-id="' + block.id + '">' +
                    '<div class="code-block-header">' +
                        '<span class="code-language">' + escapeHtml(block.language) + '</span>' +
                        '<div class="code-block-actions">' +
                            '<button class="code-action-btn code-copy-btn" title="Copy code" data-code="' + encodeURIComponent(block.code) + '">📋 Copy</button>' +
                            '<button class="code-action-btn code-comment-btn" title="Add comment to code block">💬</button>' +
                        '</div>' +
                    '</div>' +
                    '<pre class="code-block-content"><code class="hljs language-' + block.language + '">' + linesHtml + '</code></pre>' +
                '</div>';
            }
            
            // ==============================
            // Table Parsing and Rendering
            // ==============================
            
            /**
             * Parse tables from content
             */
            function parseTables(content) {
                const lines = content.split('\\n');
                const tables = [];
                let i = 0;
                
                while (i < lines.length) {
                    const line = lines[i];
                    
                    // Check if this line could be a table header (contains |)
                    if (line.includes('|') && i + 1 < lines.length) {
                        const separatorLine = lines[i + 1];
                        
                        // Check if next line is a table separator (contains | and - or :)
                        if (/^\\|?[\\s\\-:|]+\\|/.test(separatorLine)) {
                            const table = parseTableAt(lines, i);
                            if (table) {
                                tables.push(table);
                                // table.endLine is 1-based exclusive, convert back to 0-based for loop
                                i = table.endLine - 1;
                                continue;
                            }
                        }
                    }
                    i++;
                }
                
                return tables;
            }
            
            /**
             * Parse a table starting at a specific line
             */
            function parseTableAt(lines, startIndex) {
                const headerLine = lines[startIndex];
                const separatorLine = lines[startIndex + 1];
                
                // Parse header cells
                const headers = parseTableRow(headerLine);
                if (headers.length === 0) return null;
                
                // Parse alignment from separator
                const alignments = parseTableAlignments(separatorLine);
                
                // Parse body rows
                const rows = [];
                let i = startIndex + 2; // 0-based index starting after header and separator
                while (i < lines.length && lines[i].includes('|')) {
                    const row = parseTableRow(lines[i]);
                    if (row.length > 0) {
                        rows.push(row);
                    }
                    i++;
                }
                
                // i is now the 0-based index of the first line AFTER the table
                // Convert to 1-based for consistency with other block types
                return {
                    startLine: startIndex + 1, // 1-based (inclusive)
                    endLine: i + 1, // 1-based (exclusive) - first line after the table
                    headers: headers,
                    alignments: alignments,
                    rows: rows,
                    id: 'table-' + (startIndex + 1)
                };
            }
            
            /**
             * Parse a table row into cells
             */
            function parseTableRow(line) {
                // Remove leading/trailing pipes and split
                const trimmed = line.replace(/^\\|/, '').replace(/\\|$/, '');
                return trimmed.split('|').map(cell => cell.trim());
            }
            
            /**
             * Parse table alignments from separator line
             */
            function parseTableAlignments(line) {
                const cells = parseTableRow(line);
                return cells.map(cell => {
                    const left = cell.startsWith(':');
                    const right = cell.endsWith(':');
                    if (left && right) return 'center';
                    if (right) return 'right';
                    return 'left';
                });
            }
            
            /**
             * Render a table as HTML with comment highlights
             */
            function renderTable(table, commentsMap) {
                const hasComments = checkBlockHasComments(table.startLine, table.endLine - 1, commentsMap);
                const containerClass = 'md-table-container' + (hasComments ? ' has-comments' : '');
                
                let html = '<div class="' + containerClass + '" data-start-line="' + table.startLine + '" data-end-line="' + (table.endLine - 1) + '" data-table-id="' + table.id + '">';
                html += '<table class="md-table">';
                
                // Header row is at startLine
                const headerLineNum = table.startLine;
                const headerComments = getCommentsForLine(headerLineNum, commentsMap);
                
                // Header
                html += '<thead><tr data-line="' + headerLineNum + '">';
                table.headers.forEach((header, i) => {
                    const align = table.alignments[i] || 'left';
                    const alignClass = align !== 'left' ? ' align-' + align : '';
                    let cellContent = applyInlineMarkdown(header);
                    // Apply comment highlights to header cell
                    cellContent = applyCommentsToBlockContent(cellContent, header, headerComments);
                    html += '<th class="table-cell' + alignClass + '" data-line="' + headerLineNum + '">' + cellContent + '</th>';
                });
                html += '</tr></thead>';
                
                // Body - rows start at startLine + 2 (after header and separator)
                html += '<tbody>';
                table.rows.forEach((row, rowIndex) => {
                    const rowLineNum = table.startLine + 2 + rowIndex;
                    const rowComments = getCommentsForLine(rowLineNum, commentsMap);
                    
                    html += '<tr data-line="' + rowLineNum + '">';
                    row.forEach((cell, i) => {
                        const align = table.alignments[i] || 'left';
                        const alignClass = align !== 'left' ? ' align-' + align : '';
                        let cellContent = applyInlineMarkdown(cell);
                        // Apply comment highlights to cell
                        cellContent = applyCommentsToBlockContent(cellContent, cell, rowComments);
                        html += '<td class="table-cell' + alignClass + '" data-line="' + rowLineNum + '">' + cellContent + '</td>';
                    });
                    // Fill in empty cells if row is shorter than header
                    for (let j = row.length; j < table.headers.length; j++) {
                        html += '<td class="table-cell" data-line="' + rowLineNum + '"></td>';
                    }
                    html += '</tr>';
                });
                html += '</tbody>';
                
                html += '</table>';
                
                // Actions
                html += '<div class="md-table-actions">';
                html += '<button class="md-table-action-btn table-copy-btn" title="Copy table as markdown" data-table-id="' + table.id + '">📋 Copy</button>';
                html += '<button class="md-table-action-btn table-comment-btn" title="Add comment to table">💬</button>';
                html += '</div>';
                
                html += '</div>';
                
                return html;
            }
            
            /**
             * Get visible comments for a specific line
             */
            function getCommentsForLine(lineNum, commentsMap) {
                const lineComments = commentsMap.get(lineNum) || [];
                return lineComments.filter(c => settings.showResolved || c.status !== 'resolved');
            }
            
            /**
             * Apply comment highlights to block content (tables, code blocks)
             */
            function applyCommentsToBlockContent(htmlContent, plainText, lineComments) {
                if (lineComments.length === 0) return htmlContent;
                
                // Sort comments by column descending to apply from right to left
                const sortedComments = [...lineComments].sort((a, b) => {
                    return b.selection.startColumn - a.selection.startColumn;
                });
                
                let result = htmlContent;
                sortedComments.forEach(comment => {
                    const statusClass = comment.status === 'resolved' ? 'resolved' : '';
                    result = applyCommentHighlightToRange(result, plainText, 
                        comment.selection.startColumn, comment.selection.endColumn, 
                        comment.id, statusClass);
                });
                
                return result;
            }
            
            // ==============================
            // Mermaid Diagram Handling
            // ==============================
            
            /**
             * Load mermaid.js lazily
             */
            function loadMermaid(callback) {
                if (mermaidLoaded) {
                    callback();
                    return;
                }
                
                if (mermaidLoading) {
                    pendingMermaidBlocks.push(callback);
                    return;
                }
                
                mermaidLoading = true;
                
                const script = document.createElement('script');
                script.src = 'https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js';
                script.onload = () => {
                    mermaidLoaded = true;
                    mermaidLoading = false;
                    
                    // Initialize mermaid with theme based on VSCode theme
                    const isDark = document.body.classList.contains('vscode-dark') || 
                                   document.body.classList.contains('vscode-high-contrast');
                    window.mermaid.initialize({
                        startOnLoad: false,
                        theme: isDark ? 'dark' : 'default',
                        securityLevel: 'loose'
                    });
                    
                    callback();
                    
                    // Process pending callbacks
                    pendingMermaidBlocks.forEach(cb => cb());
                    pendingMermaidBlocks = [];
                };
                script.onerror = () => {
                    mermaidLoading = false;
                    console.error('Failed to load mermaid.js');
                };
                document.head.appendChild(script);
            }
            
            /**
             * Render a mermaid diagram
             */
            async function renderMermaidDiagram(block, container) {
                try {
                    const id = 'mermaid-' + block.startLine + '-' + Date.now();
                    const { svg } = await window.mermaid.render(id, block.code);
                    
                    const previewDiv = container.querySelector('.mermaid-preview');
                    if (previewDiv) {
                        previewDiv.innerHTML = svg;
                        previewDiv.classList.remove('mermaid-loading');
                        
                        // Setup node click handlers for commenting
                        setupMermaidNodeHandlers(previewDiv, block);
                    }
                } catch (error) {
                    const previewDiv = container.querySelector('.mermaid-preview');
                    if (previewDiv) {
                        previewDiv.classList.remove('mermaid-loading');
                        previewDiv.innerHTML = '<div class="mermaid-error-message">Diagram Error: ' + escapeHtml(error.message || 'Unknown error') + '</div>';
                    }
                    container.classList.add('mermaid-error');
                }
            }
            
            /**
             * Setup click handlers for mermaid diagram nodes
             */
            function setupMermaidNodeHandlers(previewDiv, block) {
                const nodes = previewDiv.querySelectorAll('.node, .cluster');
                nodes.forEach(node => {
                    node.style.cursor = 'pointer';
                    node.addEventListener('click', (e) => {
                        e.stopPropagation();
                        const nodeId = node.id || node.getAttribute('data-id') || 'unknown';
                        const nodeLabel = node.textContent?.trim() || nodeId;
                        
                        // Open comment panel for this node
                        openMermaidNodeComment(block, nodeId, nodeLabel, node);
                    });
                });
            }
            
            /**
             * Open comment panel for a mermaid node
             */
            function openMermaidNodeComment(block, nodeId, nodeLabel, element) {
                pendingSelection = {
                    startLine: block.startLine,
                    startColumn: 1,
                    endLine: block.endLine,
                    endColumn: 1,
                    selectedText: '[Mermaid Node: ' + nodeLabel + ']',
                    mermaidContext: {
                        diagramId: block.id,
                        nodeId: nodeId,
                        nodeLabel: nodeLabel,
                        diagramType: block.language
                    }
                };
                
                const rect = element.getBoundingClientRect();
                showFloatingPanel(rect, 'Mermaid Node: ' + nodeLabel);
            }
            
            /**
             * Render a mermaid block container
             */
            function renderMermaidContainer(block, commentsMap) {
                const hasBlockComments = checkBlockHasComments(block.startLine, block.endLine, commentsMap);
                const containerClass = 'mermaid-container' + (hasBlockComments ? ' has-comments' : '');
                
                return '<div class="' + containerClass + '" data-start-line="' + block.startLine + '" data-end-line="' + block.endLine + '" data-mermaid-id="' + block.id + '">' +
                    '<div class="mermaid-header">' +
                        '<span class="mermaid-label">📊 Mermaid Diagram</span>' +
                        '<div class="mermaid-actions">' +
                            '<button class="mermaid-action-btn mermaid-toggle-btn" title="Toggle source/preview">🔄 Toggle</button>' +
                            '<button class="mermaid-action-btn mermaid-comment-btn" title="Add comment to diagram">💬</button>' +
                        '</div>' +
                    '</div>' +
                    '<div class="mermaid-preview mermaid-loading">Loading diagram...</div>' +
                    '<div class="mermaid-source" style="display: none;"><code>' + escapeHtml(block.code) + '</code></div>' +
                '</div>';
            }
            
            /**
             * Check if a block has any comments
             */
            function checkBlockHasComments(startLine, endLine, commentsMap) {
                for (let line = startLine; line <= endLine; line++) {
                    if (commentsMap.has(line) && commentsMap.get(line).length > 0) {
                        return true;
                    }
                }
                return false;
            }
            
            // ==============================
            // Main Render Function
            // ==============================
            
            /**
             * Render the editor content with markdown highlighting, code blocks, tables, and comments
             */
            function render() {
                const lines = currentContent.split('\\n');
                const commentsMap = groupCommentsByLine(comments);
                const codeBlocks = parseCodeBlocks(currentContent);
                const tables = parseTables(currentContent);
                
                // Create a map of lines that are part of code blocks
                const codeBlockLines = new Map();
                codeBlocks.forEach(block => {
                    for (let i = block.startLine; i <= block.endLine; i++) {
                        codeBlockLines.set(i, block);
                    }
                });
                
                // Create a map of lines that are part of tables
                const tableLines = new Map();
                tables.forEach(table => {
                    for (let i = table.startLine; i < table.endLine; i++) {
                        tableLines.set(i, table);
                    }
                });
                
                let html = '';
                let inCodeBlock = false;
                let currentCodeBlockLang = null;
                let skipUntilLine = 0;
                
                // Helper function to generate line numbers HTML for a block
                function generateBlockLineNumbers(startLine, endLine, commentsMap) {
                    let lineNumsHtml = '';
                    for (let i = startLine; i <= endLine; i++) {
                        const blockLineComments = commentsMap.get(i) || [];
                        const blockHasComments = blockLineComments.filter(c => 
                            settings.showResolved || c.status !== 'resolved'
                        ).length > 0;
                        const blockGutterIcon = blockHasComments 
                            ? '<span class="gutter-icon" title="Click to view comments">💬</span>' 
                            : '';
                        lineNumsHtml += '<div class="line-number">' + blockGutterIcon + i + '</div>';
                    }
                    return lineNumsHtml;
                }
                
                lines.forEach((line, index) => {
                    const lineNum = index + 1;

                    // Skip lines that are part of a rendered code/mermaid/table block
                    // Line numbers for these lines are already added by the block handlers
                    if (lineNum <= skipUntilLine) {
                        return;
                    }
                    
                    const lineComments = commentsMap.get(lineNum) || [];
                    const visibleComments = lineComments.filter(c => 
                        settings.showResolved || c.status !== 'resolved'
                    );
                    
                    const hasComments = visibleComments.length > 0;
                    const gutterIcon = hasComments 
                        ? '<span class="gutter-icon" title="Click to view comments">💬</span>' 
                        : '';
                    
                    // Check if this line starts a code block
                    const block = codeBlocks.find(b => b.startLine === lineNum);
                    if (block) {
                        const blockLineNums = generateBlockLineNumbers(block.startLine, block.endLine, commentsMap);
                        const blockContent = block.isMermaid 
                            ? renderMermaidContainer(block, commentsMap)
                            : renderCodeBlock(block, commentsMap);
                        
                        html += '<div class="line-row block-row">' +
                            '<div class="line-number-column">' + blockLineNums + '</div>' +
                            '<div class="line-content block-content">' + blockContent + '</div>' +
                            '</div>';
                        
                        skipUntilLine = block.endLine;
                        return;
                    }
                    
                    // Check if this line starts a table
                    const table = tables.find(t => t.startLine === lineNum);
                    if (table) {
                        const tableLineNums = generateBlockLineNumbers(table.startLine, table.endLine - 1, commentsMap);
                        const tableContent = renderTable(table, commentsMap);
                        
                        html += '<div class="line-row block-row">' +
                            '<div class="line-number-column">' + tableLineNums + '</div>' +
                            '<div class="line-content block-content">' + tableContent + '</div>' +
                            '</div>';
                        
                        skipUntilLine = table.endLine - 1;
                        return;
                    }
                    
                    // Apply markdown highlighting
                    const result = applyMarkdownHighlighting(line, lineNum, inCodeBlock, currentCodeBlockLang);
                    inCodeBlock = result.inCodeBlock;
                    currentCodeBlockLang = result.codeBlockLang;
                    
                    let lineHtml = result.html || '&nbsp;';
                    
                    // Apply comment highlights to specific text ranges
                    // Sort comments by startColumn descending to apply from right to left
                    // This prevents offset issues when inserting spans
                    const sortedComments = [...visibleComments].sort((a, b) => {
                        // For multi-line comments, use column 1 for non-start lines
                        const aCol = a.selection.startLine === lineNum ? a.selection.startColumn : 1;
                        const bCol = b.selection.startLine === lineNum ? b.selection.startColumn : 1;
                        return bCol - aCol;
                    });
                    
                    sortedComments.forEach(comment => {
                        const statusClass = comment.status === 'resolved' ? 'resolved' : '';
                        const sel = comment.selection;
                        
                        // Determine the character range to highlight on this line
                        let startCol, endCol;
                        
                        if (sel.startLine === sel.endLine && sel.startLine === lineNum) {
                            // Single line comment - highlight specific range
                            startCol = sel.startColumn;
                            endCol = sel.endColumn;
                        } else if (sel.startLine === lineNum) {
                            // First line of multi-line comment
                            startCol = sel.startColumn;
                            endCol = line.length + 1;
                        } else if (sel.endLine === lineNum) {
                            // Last line of multi-line comment
                            startCol = 1;
                            endCol = sel.endColumn;
                        } else if (lineNum > sel.startLine && lineNum < sel.endLine) {
                            // Middle line of multi-line comment
                            startCol = 1;
                            endCol = line.length + 1;
                        } else {
                            // Shouldn't happen, but fallback to wrapping entire line
                            startCol = 1;
                            endCol = line.length + 1;
                        }
                        
                        // Apply the highlight to the specific text range
                        lineHtml = applyCommentHighlightToRange(lineHtml, line, startCol, endCol, comment.id, statusClass);
                    });
                    
                    // Create row-based layout with line number and content together
                    html += '<div class="line-row">' +
                        '<div class="line-number">' + gutterIcon + lineNum + '</div>' +
                        '<div class="line-content" data-line="' + lineNum + '">' + lineHtml + '</div>' +
                        '</div>';
                });
                
                editorWrapper.innerHTML = html;
                
                // Update stats
                const open = comments.filter(c => c.status === 'open').length;
                const resolved = comments.filter(c => c.status === 'resolved').length;
                openCount.textContent = open;
                resolvedCount.textContent = resolved;
                
                // Setup click handlers for commented text and gutter icons
                setupCommentInteractions();
                
                // Setup code block handlers
                setupCodeBlockHandlers();
                
                // Render mermaid diagrams
                renderMermaidDiagrams();
                
                // Setup table handlers
                setupTableHandlers();
                
                // Setup image handlers
                setupImageHandlers();
                
                // Resolve image paths
                resolveImagePaths();
            }
            
            /**
             * Setup handlers for code block actions
             */
            function setupCodeBlockHandlers() {
                // Copy button handlers
                document.querySelectorAll('.code-copy-btn').forEach(btn => {
                    btn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        const code = decodeURIComponent(btn.dataset.code);
                        navigator.clipboard.writeText(code).then(() => {
                            const originalText = btn.textContent;
                            btn.textContent = '✅ Copied!';
                            setTimeout(() => { btn.textContent = originalText; }, 1500);
                        });
                    });
                });
                
                // Comment button handlers for code blocks
                document.querySelectorAll('.code-comment-btn').forEach(btn => {
                    btn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        const container = btn.closest('.code-block');
                        const startLine = parseInt(container.dataset.startLine);
                        const endLine = parseInt(container.dataset.endLine);
                        
                        pendingSelection = {
                            startLine: startLine,
                            startColumn: 1,
                            endLine: endLine,
                            endColumn: 1,
                            selectedText: '[Code Block: lines ' + startLine + '-' + endLine + ']'
                        };
                        
                        showFloatingPanel(btn.getBoundingClientRect(), 'Code Block');
                    });
                });
            }
            
            /**
             * Setup handlers for table actions
             */
            function setupTableHandlers() {
                // Get original table markdown for copy
                const getTableMarkdown = (tableContainer) => {
                    const startLine = parseInt(tableContainer.dataset.startLine);
                    const endLine = parseInt(tableContainer.dataset.endLine);
                    const lines = currentContent.split('\\n');
                    return lines.slice(startLine - 1, endLine).join('\\n');
                };
                
                // Copy table button handlers
                document.querySelectorAll('.table-copy-btn').forEach(btn => {
                    btn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        const container = btn.closest('.md-table-container');
                        const markdown = getTableMarkdown(container);
                        navigator.clipboard.writeText(markdown).then(() => {
                            const originalText = btn.textContent;
                            btn.textContent = '✅ Copied!';
                            setTimeout(() => { btn.textContent = originalText; }, 1500);
                        });
                    });
                });
                
                // Comment button handlers for tables
                document.querySelectorAll('.table-comment-btn').forEach(btn => {
                    btn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        const container = btn.closest('.md-table-container');
                        const startLine = parseInt(container.dataset.startLine);
                        const endLine = parseInt(container.dataset.endLine);
                        
                        pendingSelection = {
                            startLine: startLine,
                            startColumn: 1,
                            endLine: endLine,
                            endColumn: 1,
                            selectedText: '[Table: lines ' + startLine + '-' + endLine + ']'
                        };
                        
                        showFloatingPanel(btn.getBoundingClientRect(), 'Table');
                    });
                });
            }
            
            /**
             * Setup handlers for image interactions
             */
            function setupImageHandlers() {
                // Click on image to open full view modal
                document.querySelectorAll('.md-image-preview').forEach(img => {
                    img.addEventListener('click', (e) => {
                        e.stopPropagation();
                        openImageModal(img.src, img.alt);
                    });
                });
            }
            
            /**
             * Open image in a full-screen modal
             */
            function openImageModal(src, alt) {
                const modal = document.createElement('div');
                modal.className = 'md-image-modal';
                modal.innerHTML = 
                    '<button class="md-image-modal-close">&times;</button>' +
                    '<img src="' + src + '" alt="' + escapeHtml(alt || 'Image') + '">';
                
                modal.addEventListener('click', () => modal.remove());
                modal.querySelector('.md-image-modal-close').addEventListener('click', (e) => {
                    e.stopPropagation();
                    modal.remove();
                });
                
                document.body.appendChild(modal);
                
                // Close on escape
                const escHandler = (e) => {
                    if (e.key === 'Escape') {
                        modal.remove();
                        document.removeEventListener('keydown', escHandler);
                    }
                };
                document.addEventListener('keydown', escHandler);
            }
            
            /**
             * Resolve image paths to proper URIs
             */
            function resolveImagePaths() {
                document.querySelectorAll('.md-image-preview').forEach(img => {
                    const src = img.getAttribute('src');
                    if (src && src.startsWith('IMG_PATH:')) {
                        const relativePath = src.substring(9); // Remove 'IMG_PATH:' prefix
                        
                        // Request the extension to resolve the path
                        vscode.postMessage({
                            type: 'resolveImagePath',
                            path: relativePath,
                            imgId: img.dataset.imgId || Math.random().toString(36).substr(2, 9)
                        });
                        
                        // Store the img element reference for later update
                        img.dataset.imgId = img.dataset.imgId || Math.random().toString(36).substr(2, 9);
                        img.dataset.pendingPath = relativePath;
                        img.src = ''; // Clear src while waiting
                        img.alt = 'Loading: ' + relativePath;
                    }
                });
            }

            /**
             * Render all mermaid diagrams in the content
             */
            function renderMermaidDiagrams() {
                const mermaidContainers = document.querySelectorAll('.mermaid-container');
                if (mermaidContainers.length === 0) return;
                
                const codeBlocks = parseCodeBlocks(currentContent);
                const mermaidBlocks = codeBlocks.filter(b => b.isMermaid);
                
                loadMermaid(() => {
                    mermaidContainers.forEach((container, index) => {
                        const block = mermaidBlocks[index];
                        if (block) {
                            renderMermaidDiagram(block, container);
                        }
                    });
                });
                
                // Setup mermaid action handlers
                setupMermaidHandlers();
            }
            
            /**
             * Setup handlers for mermaid actions
             */
            function setupMermaidHandlers() {
                // Toggle button handlers
                document.querySelectorAll('.mermaid-toggle-btn').forEach(btn => {
                    btn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        const container = btn.closest('.mermaid-container');
                        const preview = container.querySelector('.mermaid-preview');
                        const source = container.querySelector('.mermaid-source');
                        
                        if (preview.style.display === 'none') {
                            preview.style.display = 'flex';
                            source.style.display = 'none';
                            btn.textContent = '🔄 Toggle';
                        } else {
                            preview.style.display = 'none';
                            source.style.display = 'block';
                            btn.textContent = '👁️ Preview';
                        }
                    });
                });
                
                // Comment button handlers for diagrams
                document.querySelectorAll('.mermaid-comment-btn').forEach(btn => {
                    btn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        const container = btn.closest('.mermaid-container');
                        const startLine = parseInt(container.dataset.startLine);
                        const endLine = parseInt(container.dataset.endLine);
                        const diagramId = container.dataset.mermaidId;
                        
                        pendingSelection = {
                            startLine: startLine,
                            startColumn: 1,
                            endLine: endLine,
                            endColumn: 1,
                            selectedText: '[Mermaid Diagram: lines ' + startLine + '-' + endLine + ']',
                            mermaidContext: {
                                diagramId: diagramId,
                                diagramType: 'mermaid'
                            }
                        };
                        
                        showFloatingPanel(btn.getBoundingClientRect(), 'Mermaid Diagram');
                    });
                });
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
                        const lineRow = icon.closest('.line-row');
                        const lineContentEl = lineRow ? lineRow.querySelector('.line-content[data-line]') : null;
                        const lineNum = lineContentEl ? parseInt(lineContentEl.getAttribute('data-line'), 10) : null;
                        
                        if (!lineNum) return;
                        
                        const lineComments = comments.filter(c => 
                            c.selection.startLine === lineNum && 
                            (settings.showResolved || c.status !== 'resolved')
                        );
                        
                        if (lineComments.length > 0) {
                            const lineEl = editorWrapper.querySelector('[data-line="' + lineNum + '"]');
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
                
                // Always use fixed positioning to avoid layout interference
                // Appending to inline elements (like .commented-text spans) can cause text flow issues
                bubble.style.position = 'fixed';
                bubble.style.zIndex = '200';
                
                const rect = anchorEl.getBoundingClientRect();
                let left = rect.left;
                let top = rect.bottom + 5;
                
                // Adjust if bubble would go off screen
                if (left + 350 > window.innerWidth - 20) {
                    left = window.innerWidth - 370;
                }
                if (left < 20) {
                    left = 20;
                }
                if (top + 200 > window.innerHeight) {
                    top = rect.top - 210;
                }
                
                bubble.style.left = left + 'px';
                bubble.style.top = top + 'px';
                bubble.style.width = '350px';
                
                document.body.appendChild(bubble);
                activeCommentBubble = { element: bubble, anchor: anchorEl, isFixed: true };
                
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

                // Setup drag functionality for the bubble header
                setupBubbleDrag(bubble);
            }

            // Setup drag functionality for comment bubble
            function setupBubbleDrag(bubble) {
                const header = bubble.querySelector('.bubble-header');
                if (!header) return;

                let isDragging = false;
                let startX, startY;
                let initialLeft, initialTop;

                header.addEventListener('mousedown', (e) => {
                    // Only start drag if clicking on header (not on buttons)
                    if (e.target.closest('.bubble-action-btn')) return;

                    isDragging = true;
                    bubble.classList.add('dragging');

                    startX = e.clientX;
                    startY = e.clientY;
                    initialLeft = parseInt(bubble.style.left) || 0;
                    initialTop = parseInt(bubble.style.top) || 0;

                    e.preventDefault();
                });

                document.addEventListener('mousemove', (e) => {
                    if (!isDragging) return;

                    const deltaX = e.clientX - startX;
                    const deltaY = e.clientY - startY;

                    let newLeft = initialLeft + deltaX;
                    let newTop = initialTop + deltaY;

                    // Keep bubble within viewport bounds
                    const bubbleWidth = bubble.offsetWidth;
                    const bubbleHeight = bubble.offsetHeight;

                    newLeft = Math.max(10, Math.min(newLeft, window.innerWidth - bubbleWidth - 10));
                    newTop = Math.max(10, Math.min(newTop, window.innerHeight - bubbleHeight - 10));

                    bubble.style.left = newLeft + 'px';
                    bubble.style.top = newTop + 'px';
                });

                document.addEventListener('mouseup', () => {
                    if (isDragging) {
                        isDragging = false;
                        bubble.classList.remove('dragging');
                    }
                });
            }

            // Setup drag functionality for panels (floating comment panel, inline edit panel)
            function setupPanelDrag(panel) {
                // Find the header - could be .floating-panel-header or .inline-edit-header
                const header = panel.querySelector('.floating-panel-header, .inline-edit-header');
                if (!header) return;

                let isDragging = false;
                let startX, startY;
                let initialLeft, initialTop;

                header.addEventListener('mousedown', (e) => {
                    // Only start drag if clicking on header (not on close button)
                    if (e.target.closest('.floating-panel-close, .inline-edit-close')) return;

                    isDragging = true;
                    panel.classList.add('dragging');

                    startX = e.clientX;
                    startY = e.clientY;
                    initialLeft = parseInt(panel.style.left) || 0;
                    initialTop = parseInt(panel.style.top) || 0;

                    e.preventDefault();
                });

                document.addEventListener('mousemove', (e) => {
                    if (!isDragging) return;

                    const deltaX = e.clientX - startX;
                    const deltaY = e.clientY - startY;

                    let newLeft = initialLeft + deltaX;
                    let newTop = initialTop + deltaY;

                    // Keep panel within viewport bounds
                    const panelWidth = panel.offsetWidth;
                    const panelHeight = panel.offsetHeight;

                    newLeft = Math.max(10, Math.min(newLeft, window.innerWidth - panelWidth - 10));
                    newTop = Math.max(10, Math.min(newTop, window.innerHeight - panelHeight - 10));

                    panel.style.left = newLeft + 'px';
                    panel.style.top = newTop + 'px';
                });

                document.addEventListener('mouseup', () => {
                    if (isDragging) {
                        isDragging = false;
                        panel.classList.remove('dragging');
                    }
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
                
                // Try to find regular line elements first
                let startLine = findLineElement(startContainer);
                let endLine = findLineElement(endContainer);
                
                let startLineNum, endLineNum;
                let startColumn = range.startOffset + 1;
                let endColumn = range.endOffset + 1;
                
                // Check if selection is in a table
                const startCell = startContainer.nodeType === Node.TEXT_NODE 
                    ? startContainer.parentElement?.closest('td, th')
                    : startContainer.closest?.('td, th');
                const endCell = endContainer.nodeType === Node.TEXT_NODE 
                    ? endContainer.parentElement?.closest('td, th')
                    : endContainer.closest?.('td, th');
                
                if (startCell && endCell) {
                    // Selection is within a table
                    startLineNum = getLineFromTableCell(startCell);
                    endLineNum = getLineFromTableCell(endCell);
                    
                    if (startLineNum && endLineNum) {
                        // Calculate column based on text position within cell
                        const startText = getTextBeforeOffset(startCell, startContainer, range.startOffset);
                        const endText = getTextBeforeOffset(endCell, endContainer, range.endOffset);
                        startColumn = startText.length + 1;
                        endColumn = endText.length + 1;
                        
                        return {
                            startLine: startLineNum,
                            startColumn: startColumn,
                            endLine: endLineNum,
                            endColumn: endColumn
                        };
                    }
                }
                
                // Check if selection is in a code block
                const codeBlock = findBlockContainer(startContainer);
                if (codeBlock && codeBlock.classList.contains('code-block')) {
                    // For code blocks, use the code-line elements
                    if (startLine && startLine.classList.contains('code-line')) {
                        startLineNum = parseInt(startLine.dataset.line);
                    }
                    if (endLine && endLine.classList.contains('code-line')) {
                        endLineNum = parseInt(endLine.dataset.line);
                    }
                    
                    if (startLineNum && endLineNum) {
                        // Calculate column based on position in the line
                        const startText = getTextBeforeOffset(startLine, startContainer, range.startOffset);
                        const endText = getTextBeforeOffset(endLine, endContainer, range.endOffset);
                        startColumn = startText.length + 1;
                        endColumn = endText.length + 1;
                        
                        return {
                            startLine: startLineNum,
                            startColumn: startColumn,
                            endLine: endLineNum,
                            endColumn: endColumn
                        };
                    }
                }
                
                // Standard line elements
                if (!startLine || !endLine) return null;
                
                startLineNum = parseInt(startLine.dataset.line);
                endLineNum = parseInt(endLine.dataset.line);
                
                if (!startLineNum || !endLineNum) return null;
                
                // Calculate column based on text position
                const startText = getTextBeforeOffset(startLine, startContainer, range.startOffset);
                const endText = getTextBeforeOffset(endLine, endContainer, range.endOffset);
                startColumn = startText.length + 1;
                endColumn = endText.length + 1;
                
                return {
                    startLine: startLineNum,
                    startColumn: startColumn,
                    endLine: endLineNum,
                    endColumn: endColumn
                };
            }
            
            // Get the text content before a specific offset within a container
            function getTextBeforeOffset(container, targetNode, offset) {
                let text = '';
                let found = false;
                
                function traverse(node) {
                    if (found) return;
                    
                    if (node === targetNode) {
                        if (node.nodeType === Node.TEXT_NODE) {
                            text += node.textContent.substring(0, offset);
                        }
                        found = true;
                        return;
                    }
                    
                    if (node.nodeType === Node.TEXT_NODE) {
                        text += node.textContent;
                    } else if (node.nodeType === Node.ELEMENT_NODE) {
                        // Skip comment bubbles and other non-content elements
                        if (!node.classList?.contains('inline-comment-bubble')) {
                            for (const child of node.childNodes) {
                                traverse(child);
                                if (found) break;
                            }
                        }
                    }
                }
                
                traverse(container);
                return text;
            }

            // Find the parent line element or line context
            function findLineElement(node) {
                let current = node;
                while (current && current !== editorWrapper) {
                    // Regular markdown line - now using line-content class
                    if (current.classList && (current.classList.contains('line-content') || current.classList.contains('line'))) {
                        return current;
                    }
                    // Code block line
                    if (current.classList && current.classList.contains('code-line')) {
                        return current;
                    }
                    current = current.parentElement;
                }
                return null;
            }
            
            // Find the block container (code block, table, or mermaid) for a node
            function findBlockContainer(node) {
                let current = node;
                while (current && current !== editorWrapper) {
                    if (current.classList) {
                        if (current.classList.contains('code-block') ||
                            current.classList.contains('md-table-container') ||
                            current.classList.contains('mermaid-container')) {
                            return current;
                        }
                    }
                    current = current.parentElement;
                }
                return null;
            }
            
${getWebviewTableCellLineFunction()}

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
                editorWrapper.querySelectorAll('.line-content[data-line]').forEach(lineEl => {
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

            /**
             * Apply comment highlight to a specific character range in HTML content
             * This handles HTML tags and HTML entities by mapping character positions from plain text to HTML
             */
            function applyCommentHighlightToRange(htmlContent, plainText, startCol, endCol, commentId, statusClass) {
                // Convert 1-based columns to 0-based indices
                const startIdx = Math.max(0, startCol - 1);
                const endIdx = Math.min(plainText.length, endCol - 1);
                
                // If the range is invalid or empty, wrap the entire line
                if (startIdx >= endIdx || startIdx >= plainText.length) {
                    return '<span class="commented-text ' + statusClass + '" data-comment-id="' + commentId + '">' + htmlContent + '</span>';
                }
                
                // Create a mapping from plain text positions to HTML positions
                // We need to skip over HTML tags and handle HTML entities
                const plainToHtmlStart = [];
                const plainToHtmlEnd = [];
                let plainPos = 0;
                let htmlPos = 0;
                let inTag = false;
                
                while (htmlPos < htmlContent.length) {
                    const char = htmlContent[htmlPos];
                    
                    if (char === '<') {
                        inTag = true;
                        htmlPos++;
                    } else if (char === '>') {
                        inTag = false;
                        htmlPos++;
                    } else if (inTag) {
                        htmlPos++;
                    } else if (char === '&') {
                        // HTML entity - find the end
                        const entityEnd = htmlContent.indexOf(';', htmlPos);
                        if (entityEnd > htmlPos && entityEnd - htmlPos <= 10) {
                            // Valid entity
                            if (plainToHtmlStart[plainPos] === undefined) {
                                plainToHtmlStart[plainPos] = htmlPos;
                            }
                            plainToHtmlEnd[plainPos] = entityEnd + 1;
                            plainPos++;
                            htmlPos = entityEnd + 1;
                        } else {
                            // Treat & as regular character
                            if (plainToHtmlStart[plainPos] === undefined) {
                                plainToHtmlStart[plainPos] = htmlPos;
                            }
                            plainToHtmlEnd[plainPos] = htmlPos + 1;
                            plainPos++;
                            htmlPos++;
                        }
                    } else {
                        // Regular character
                        if (plainToHtmlStart[plainPos] === undefined) {
                            plainToHtmlStart[plainPos] = htmlPos;
                        }
                        plainToHtmlEnd[plainPos] = htmlPos + 1;
                        plainPos++;
                        htmlPos++;
                    }
                }
                
                // Handle edge case where plain text is shorter than expected
                if (plainToHtmlStart[startIdx] === undefined) {
                    return '<span class="commented-text ' + statusClass + '" data-comment-id="' + commentId + '">' + htmlContent + '</span>';
                }
                
                // Get HTML positions
                const htmlStartPos = plainToHtmlStart[startIdx];
                // For end position, we need the position AFTER the last character
                const lastCharIdx = Math.min(endIdx - 1, plainPos - 1);
                let htmlEndPos = plainToHtmlEnd[lastCharIdx] !== undefined ? plainToHtmlEnd[lastCharIdx] : htmlContent.length;
                
                // Find tag boundaries - we need to be careful not to split HTML tags
                // Extend the start to include any tag that's already wrapping this text
                let adjustedStart = htmlStartPos;
                let adjustedEnd = htmlEndPos;
                
                // Check if we're inside a tag and adjust
                // Look backwards from start to see if we need to include opening tag
                let depth = 0;
                for (let i = htmlStartPos - 1; i >= 0; i--) {
                    if (htmlContent[i] === '>') {
                        // Check if this is an opening tag (not closing)
                        const tagStart = htmlContent.lastIndexOf('<', i);
                        if (tagStart >= 0) {
                            const tagContent = htmlContent.substring(tagStart, i + 1);
                            if (!tagContent.startsWith('</')) {
                                // This is an opening tag, we should include it
                                adjustedStart = tagStart;
                                depth++;
                            }
                        }
                        break;
                    }
                }
                
                // Look forward from end to include closing tags
                for (let i = htmlEndPos; i < htmlContent.length && depth > 0; i++) {
                    if (htmlContent[i] === '<' && htmlContent[i + 1] === '/') {
                        // Find the end of this closing tag
                        const tagEnd = htmlContent.indexOf('>', i);
                        if (tagEnd >= 0) {
                            adjustedEnd = tagEnd + 1;
                            depth--;
                        }
                    } else if (htmlContent[i] === '<' && htmlContent[i + 1] !== '/') {
                        // Another opening tag, increase depth
                        depth++;
                    }
                }
                
                // Build the result
                const before = htmlContent.substring(0, adjustedStart);
                const highlighted = htmlContent.substring(adjustedStart, adjustedEnd);
                const after = htmlContent.substring(adjustedEnd);
                
                return before + '<span class="commented-text ' + statusClass + '" data-comment-id="' + commentId + '">' + highlighted + '</span>' + after;
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
