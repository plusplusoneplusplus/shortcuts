/**
 * Main entry point for the diff review webview
 */

import { ExtensionMessage } from './types';
import { renderDiff, updateCommentIndicators } from './diff-renderer';
import { hideCommentPanel, hideCommentsList, initPanelElements, showCommentPanel, showCommentsForLine } from './panel-manager';
import { getCurrentSelection, hasValidSelection, setupSelectionListener } from './selection-handler';
import { createInitialState, getCommentsForLine, getState, setComments, setSettings, updateState } from './state';
import { initVSCodeAPI, sendReady } from './vscode-bridge';

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
 * Setup click handlers for comment indicators
 */
function setupCommentIndicatorHandlers(): void {
    // Use event delegation on the diff containers
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
                    showCommentsForLine(comments);
                }
            }
        }
    };

    if (oldContainer) {
        oldContainer.addEventListener('click', (e) => handleClick(e, 'old'));
    }

    if (newContainer) {
        newContainer.addEventListener('click', (e) => handleClick(e, 'new'));
    }

    // Also handle double-click on lines to add comments
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
        oldContainer.addEventListener('dblclick', handleDoubleClick);
    }

    if (newContainer) {
        newContainer.addEventListener('dblclick', handleDoubleClick);
    }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize);
} else {
    initialize();
}

