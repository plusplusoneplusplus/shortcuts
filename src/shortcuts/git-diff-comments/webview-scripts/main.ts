/**
 * Main entry point for the diff review webview
 */

import { ExtensionMessage } from './types';
import { initializeScrollSync, invalidateHighlightCache, renderDiff, updateCommentIndicators } from './diff-renderer';
import { hideCommentPanel, hideCommentsList, initPanelElements, showCommentPanel, showCommentsForLine } from './panel-manager';
import { getCurrentSelection, hasValidSelection, setupSelectionListener } from './selection-handler';
import { createInitialState, getCommentsForLine, getState, getViewMode, setComments, setSettings, toggleViewMode, updateState, ViewMode } from './state';
import { initVSCodeAPI, sendCopyPath, sendOpenFile, sendReady } from './vscode-bridge';

// AbortController for managing event listeners
let commentHandlersAbortController: AbortController | null = null;

/**
 * Initialize the webview
 */
function initialize(): void {
    console.log('[Diff Webview] Initializing...');

    // Initialize VSCode API
    initVSCodeAPI();

    // Initialize state
    const state = createInitialState();
    updateState(state);

    // Initialize UI elements
    initPanelElements();

    // Setup selection listener
    setupSelectionListener((selection) => {
        // Could show a floating "Add Comment" button here
        console.log('[Diff Webview] Selection changed:', selection);
    });

    // Setup keyboard shortcuts
    setupKeyboardShortcuts();

    // Setup click handlers for comment indicators
    setupCommentIndicatorHandlers();

    // Setup view mode toggle
    setupViewModeToggle();

    // Setup file path click handler
    setupFilePathClickHandler();

    // Setup message listener
    window.addEventListener('message', handleMessage);

    // Render initial diff
    renderDiff();

    // Notify extension we're ready
    sendReady();

    console.log('[Diff Webview] Initialized');
}

/**
 * Handle messages from the extension
 */
function handleMessage(event: MessageEvent<ExtensionMessage>): void {
    const message = event.data;
    console.log('[Diff Webview] Received message:', message.type);

    switch (message.type) {
        case 'update':
            if (message.oldContent !== undefined && message.newContent !== undefined) {
                updateState({
                    oldContent: message.oldContent,
                    newContent: message.newContent
                });
                // Invalidate highlight cache when content changes
                invalidateHighlightCache();
                renderDiff();
            }
            if (message.comments) {
                setComments(message.comments);
                updateCommentIndicators();
            }
            if (message.settings) {
                setSettings(message.settings);
                updateCommentIndicators();
            }
            break;

        case 'commentAdded':
        case 'commentUpdated':
        case 'commentDeleted':
            // Refresh comments - the extension will send an update message
            break;
    }
}

/**
 * Setup keyboard shortcuts
 */
function setupKeyboardShortcuts(): void {
    document.addEventListener('keydown', (e) => {
        // Ctrl/Cmd + Shift + M to add comment
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'm') {
            e.preventDefault();
            handleAddCommentShortcut();
        }

        // Escape to close panels
        if (e.key === 'Escape') {
            hideCommentPanel();
            hideCommentsList();
        }
    });
}

/**
 * Handle the add comment keyboard shortcut
 */
function handleAddCommentShortcut(): void {
    if (!hasValidSelection()) {
        console.log('[Diff Webview] No valid selection for comment');
        return;
    }

    const selection = getCurrentSelection();
    if (selection) {
        showCommentPanel(selection);
    }
}

/**
 * Setup file path click handler to open the file in the editor
 */
function setupFilePathClickHandler(): void {
    const filePathLink = document.getElementById('file-path-link');
    const copyPathBtn = document.getElementById('copy-path-btn');
    
    if (!filePathLink) {
        console.error('[Diff Webview] File path link element not found');
        return;
    }

    // Click to open file
    filePathLink.addEventListener('click', () => {
        const state = getState();
        if (state.filePath) {
            sendOpenFile(state.filePath);
        }
    });

    // Copy path button
    if (copyPathBtn) {
        copyPathBtn.addEventListener('click', () => {
            const state = getState();
            if (state.filePath) {
                sendCopyPath(state.filePath);
                
                // Visual feedback
                copyPathBtn.classList.add('copied');
                setTimeout(() => {
                    copyPathBtn.classList.remove('copied');
                }, 2000);
            }
        });
    }
}

/**
 * Setup view mode toggle button
 */
function setupViewModeToggle(): void {
    const toggleButton = document.getElementById('view-mode-toggle');
    const toggleIcon = document.getElementById('toggle-icon');
    const toggleLabel = document.getElementById('toggle-label');
    const diffViewContainer = document.getElementById('diff-view-container');

    if (!toggleButton || !toggleIcon || !toggleLabel || !diffViewContainer) {
        console.error('[Diff Webview] View mode toggle elements not found');
        return;
    }

    // Update UI to reflect current state
    const updateToggleUI = (mode: ViewMode) => {
        if (mode === 'inline') {
            toggleIcon.textContent = '⫼';
            toggleLabel.textContent = 'Inline';
            diffViewContainer.classList.add('inline-view');
        } else {
            toggleIcon.textContent = '⫼';
            toggleLabel.textContent = 'Split';
            diffViewContainer.classList.remove('inline-view');
        }
    };

    // Initialize UI
    updateToggleUI(getViewMode());

    // Handle click
    toggleButton.addEventListener('click', () => {
        const newMode = toggleViewMode();
        updateToggleUI(newMode);
        renderDiff();
        
        // Re-setup comment indicator handlers for the new view
        setupCommentIndicatorHandlers();
    });
}

/**
 * Setup click handlers for comment indicators (called on view mode change too)
 * Uses AbortController to properly clean up old listeners without cloning elements
 */
function setupCommentIndicatorHandlers(): void {
    // Abort any previous listeners
    if (commentHandlersAbortController) {
        commentHandlersAbortController.abort();
    }
    commentHandlersAbortController = new AbortController();
    const signal = commentHandlersAbortController.signal;
    
    const viewMode = getViewMode();
    
    if (viewMode === 'inline') {
        // Inline view handlers
        const inlineContainer = document.getElementById('inline-content');
        
        const handleInlineClick = (e: MouseEvent) => {
            const target = e.target as HTMLElement;
            
            // Check if clicking on a comment indicator
            if (target.classList.contains('comment-indicator')) {
                e.preventDefault();
                e.stopPropagation();

                const lineEl = target.closest('.inline-diff-line') as HTMLElement;
                if (lineEl) {
                    const side = lineEl.dataset.side;
                    let lineNum: number | null = null;
                    let commentSide: 'old' | 'new' = 'new';
                    
                    if (side === 'old' && lineEl.dataset.oldLineNumber) {
                        lineNum = parseInt(lineEl.dataset.oldLineNumber);
                        commentSide = 'old';
                    } else if (side === 'new' && lineEl.dataset.newLineNumber) {
                        lineNum = parseInt(lineEl.dataset.newLineNumber);
                        commentSide = 'new';
                    } else if (side === 'context' && lineEl.dataset.newLineNumber) {
                        lineNum = parseInt(lineEl.dataset.newLineNumber);
                        commentSide = 'new';
                    }
                    
                    if (lineNum !== null) {
                        const comments = getCommentsForLine(commentSide, lineNum);
                        if (comments.length > 0) {
                            showCommentsForLine(comments, target);
                        }
                    }
                }
            }
        };

        // Handle double-click on lines to add comments
        const handleInlineDoubleClick = (e: MouseEvent) => {
            if (hasValidSelection()) {
                const selection = getCurrentSelection();
                if (selection) {
                    showCommentPanel(selection);
                }
            }
        };

        if (inlineContainer) {
            inlineContainer.addEventListener('click', handleInlineClick, { signal });
            inlineContainer.addEventListener('dblclick', handleInlineDoubleClick, { signal });
        }
    } else {
        // Split view handlers
        const oldContainer = document.getElementById('old-content');
        const newContainer = document.getElementById('new-content');

        const handleClick = (e: MouseEvent, side: 'old' | 'new') => {
            const target = e.target as HTMLElement;
            
            // Check if clicking on a comment indicator
            if (target.classList.contains('comment-indicator')) {
                e.preventDefault();
                e.stopPropagation();

                const lineEl = target.closest('.diff-line') as HTMLElement;
                if (lineEl && lineEl.dataset.lineNumber) {
                    const lineNum = parseInt(lineEl.dataset.lineNumber);
                    const comments = getCommentsForLine(side, lineNum);
                    if (comments.length > 0) {
                        // Pass the clicked indicator element for positioning
                        showCommentsForLine(comments, target);
                    }
                }
            }
        };

        // Handle double-click on lines to add comments
        const handleDoubleClick = (e: MouseEvent) => {
            // Only if there's a selection
            if (hasValidSelection()) {
                const selection = getCurrentSelection();
                if (selection) {
                    showCommentPanel(selection);
                }
            }
        };

        if (oldContainer) {
            oldContainer.addEventListener('click', (e) => handleClick(e, 'old'), { signal });
            oldContainer.addEventListener('dblclick', handleDoubleClick, { signal });
        }

        if (newContainer) {
            newContainer.addEventListener('click', (e) => handleClick(e, 'new'), { signal });
            newContainer.addEventListener('dblclick', handleDoubleClick, { signal });
        }
        
        // Re-initialize scroll sync for split view since we're not cloning elements anymore
        initializeScrollSync();
    }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize);
} else {
    initialize();
}

