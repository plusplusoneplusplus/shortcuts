/**
 * Main entry point for the diff review webview
 */

import { ExtensionMessage } from './types';
import { initializeScrollSync, invalidateHighlightCache, renderDiff, updateCommentIndicators } from './diff-renderer';
import { hideCommentPanel, hideCommentsList, initPanelElements, showCommentPanel, showCommentsForLine, showContextMenu, updateContextMenuForSettings } from './panel-manager';
import { getCurrentSelection, hasValidSelection, setupSelectionListener } from './selection-handler';
import { createInitialState, getCommentsForLine, getIgnoreWhitespace, getIsEditable, getState, getViewMode, setComments, setIsEditable, setSettings, toggleIgnoreWhitespace, toggleViewMode, updateState, ViewMode } from './state';
import { initVSCodeAPI, sendCopyPath, sendOpenFile, sendReady, sendSaveContent } from './vscode-bridge';

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

    // Setup click-outside-to-dismiss behavior for comment panels
    setupClickOutsideToDismiss();

    // Setup click handlers for comment indicators
    setupCommentIndicatorHandlers();

    // Setup view mode toggle
    setupViewModeToggle();

    // Setup whitespace toggle
    setupWhitespaceToggle();

    // Setup file path click handler
    setupFilePathClickHandler();

    // Setup editable content (for uncommitted changes)
    setupEditableContent();

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
            if (message.isEditable !== undefined) {
                setIsEditable(message.isEditable);
                updateEditableUI();
            }
            if (message.comments) {
                setComments(message.comments);
                updateCommentIndicators();
            }
            if (message.settings) {
                setSettings(message.settings);
                updateCommentIndicators();
                // Update context menu visibility based on askAIEnabled setting
                updateContextMenuForSettings();
            }
            break;

        case 'commentAdded':
        case 'commentUpdated':
        case 'commentDeleted':
            // Refresh comments - the extension will send an update message
            break;

        case 'scrollToComment':
            if (message.scrollToCommentId) {
                scrollToComment(message.scrollToCommentId);
            }
            break;
    }
}

/**
 * Scroll to a specific comment in the diff view
 */
function scrollToComment(commentId: string): void {
    console.log('[Diff Webview] Scrolling to comment:', commentId);
    
    // Find the comment in our state
    const state = getState();
    const comment = state.comments.find(c => c.id === commentId);
    
    if (!comment) {
        console.log('[Diff Webview] Comment not found:', commentId);
        return;
    }

    // Determine which line to scroll to based on the comment's selection
    const side = comment.selection.side;
    const lineNumber = side === 'old' 
        ? comment.selection.oldStartLine 
        : comment.selection.newStartLine;

    if (lineNumber === null) {
        console.log('[Diff Webview] No line number for comment');
        return;
    }

    const viewMode = getViewMode();
    let lineElement: HTMLElement | null = null;

    if (viewMode === 'inline') {
        // In inline view, find the line element with the matching line number and side
        const inlineContainer = document.getElementById('inline-content');
        if (inlineContainer) {
            const lines = inlineContainer.querySelectorAll('.inline-diff-line');
            for (const line of lines) {
                const el = line as HTMLElement;
                const lineSide = el.dataset.side;
                
                if (side === 'old' && lineSide === 'old' && el.dataset.oldLineNumber === String(lineNumber)) {
                    lineElement = el;
                    break;
                } else if (side === 'new' && (lineSide === 'new' || lineSide === 'context') && el.dataset.newLineNumber === String(lineNumber)) {
                    lineElement = el;
                    break;
                }
            }
        }
    } else {
        // In split view, find the line element in the appropriate container
        const containerId = side === 'old' ? 'old-content' : 'new-content';
        const container = document.getElementById(containerId);
        if (container) {
            lineElement = container.querySelector(`.diff-line[data-line-number="${lineNumber}"]`);
        }
    }

    if (lineElement) {
        // Add a highlight effect to draw attention
        lineElement.classList.add('highlight-flash');
        setTimeout(() => {
            lineElement?.classList.remove('highlight-flash');
        }, 3000);

        // FIRST: Scroll to the line so it's visible
        // Position it near the top with some context
        lineElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
        
        // THEN: After scroll completes, show the comments panel
        // The panel will position correctly since the element is now visible
        setTimeout(() => {
            if (!lineElement) return;
            
            // Adjust scroll to add some top padding (context above the line)
            const container = lineElement.closest('.diff-pane, #inline-content') as HTMLElement;
            if (container) {
                container.scrollTop = Math.max(0, container.scrollTop - 80);
            }

            // Now show the comments for this line (convert 'both' to 'new' for lookup)
            const lookupSide: 'old' | 'new' = side === 'both' ? 'new' : side;
            const comments = getCommentsForLine(lookupSide, lineNumber);
            if (comments.length > 0) {
                // Find the comment indicator on this line
                const indicator = lineElement.querySelector('.comment-indicator');
                if (indicator) {
                    showCommentsForLine(comments, indicator as HTMLElement);
                }
            }
        }, 400); // Wait for smooth scroll to complete
    } else {
        console.log('[Diff Webview] Line element not found for line:', lineNumber);
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
 * Setup click-outside-to-dismiss behavior for comment panels
 */
function setupClickOutsideToDismiss(): void {
    document.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        
        // Check if clicking outside the comment panel
        const commentPanel = document.getElementById('comment-panel');
        if (commentPanel && !commentPanel.classList.contains('hidden')) {
            // Don't dismiss if clicking inside the panel
            if (!commentPanel.contains(target)) {
                // Don't dismiss if clicking on a comment indicator (which opens the panel)
                // Also don't dismiss if clicking on the context menu (which might be opening the panel)
                if (!target.classList.contains('comment-indicator') && !target.closest('#custom-context-menu')) {
                    hideCommentPanel();
                }
            }
        }
        
        // Check if clicking outside the comments list
        const commentsList = document.getElementById('comments-list');
        if (commentsList && !commentsList.classList.contains('hidden')) {
            // Don't dismiss if clicking inside the panel
            if (!commentsList.contains(target)) {
                // Don't dismiss if clicking on a comment indicator (which opens the panel)
                if (!target.classList.contains('comment-indicator')) {
                    hideCommentsList();
                }
            }
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
 * Setup whitespace toggle button
 */
function setupWhitespaceToggle(): void {
    const toggleButton = document.getElementById('whitespace-toggle');
    const toggleIcon = document.getElementById('whitespace-icon');
    const toggleLabel = document.getElementById('whitespace-label');

    if (!toggleButton || !toggleIcon || !toggleLabel) {
        console.error('[Diff Webview] Whitespace toggle elements not found');
        return;
    }

    // Update UI to reflect current state
    const updateToggleUI = (ignoreWhitespace: boolean) => {
        if (ignoreWhitespace) {
            toggleIcon.textContent = '␣';
            toggleLabel.textContent = 'Hide Whitespace';
            toggleButton.classList.add('active');
            toggleButton.title = 'Showing diff without whitespace changes - click to show whitespace changes';
        } else {
            toggleIcon.textContent = '␣';
            toggleLabel.textContent = 'Show Whitespace';
            toggleButton.classList.remove('active');
            toggleButton.title = 'Showing all changes including whitespace - click to hide whitespace-only changes';
        }
    };

    // Initialize UI
    updateToggleUI(getIgnoreWhitespace());

    // Handle click
    toggleButton.addEventListener('click', () => {
        const newValue = toggleIgnoreWhitespace();
        updateToggleUI(newValue);
        // Invalidate highlight cache since we're changing how lines are compared
        invalidateHighlightCache();
        renderDiff();
        
        // Re-setup comment indicator handlers after re-render
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
    const signal = commentHandlersAbortController!.signal;
    
    const viewMode = getViewMode();
    
    // Common handler for context menu
    const handleContextMenu = (e: MouseEvent) => {
        if (hasValidSelection()) {
            const selection = getCurrentSelection();
            if (selection) {
                e.preventDefault(); // Prevent default context menu
                showContextMenu(e.clientX, e.clientY, selection);
            }
        }
    };
    
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

        if (inlineContainer) {
            inlineContainer.addEventListener('click', handleInlineClick, { signal });
            inlineContainer.addEventListener('contextmenu', handleContextMenu, { signal });
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

        if (oldContainer) {
            oldContainer.addEventListener('click', (e) => handleClick(e, 'old'), { signal });
            oldContainer.addEventListener('contextmenu', handleContextMenu, { signal });
        }

        if (newContainer) {
            newContainer.addEventListener('click', (e) => handleClick(e, 'new'), { signal });
            newContainer.addEventListener('contextmenu', handleContextMenu, { signal });
        }
        
        // Re-initialize scroll sync for split view since we're not cloning elements anymore
        initializeScrollSync();
    }
}

/**
 * Update UI to reflect editable state - make content directly editable
 */
function updateEditableUI(): void {
    // Re-setup editable content when state changes
    setupEditableContent();
}

/** Track if content has been modified */
let contentModified = false;

/** Debounce timer for auto-save */
let saveDebounceTimer: number | null = null;

/**
 * Setup editable content for uncommitted changes
 * Content is directly editable without needing a toggle button
 */
function setupEditableContent(): void {
    const isEditable = getIsEditable();
    
    if (!isEditable) {
        return;
    }

    const viewMode = getViewMode();
    
    if (viewMode === 'inline') {
        // For inline view, make addition and context lines editable
        const inlineContainer = document.getElementById('inline-content');
        if (inlineContainer) {
            inlineContainer.classList.add('editable-mode');
            const lineElements = inlineContainer.querySelectorAll('.inline-diff-line');
            lineElements.forEach((el) => {
                const htmlEl = el as HTMLElement;
                const side = htmlEl.dataset.side;
                // Only make new and context lines editable (not deletions)
                if (side === 'new' || side === 'context') {
                    const textEl = htmlEl.querySelector('.line-text') as HTMLElement;
                    if (textEl) {
                        textEl.contentEditable = 'true';
                        textEl.classList.add('editable');
                        setupEditableLineHandlers(textEl);
                    }
                }
            });
        }
    } else {
        // For split view, make the new content pane editable
        const newContainer = document.getElementById('new-content');
        if (newContainer) {
            newContainer.classList.add('editable-mode');
            const lineContents = newContainer.querySelectorAll('.line-content .line-text');
            lineContents.forEach((el) => {
                const htmlEl = el as HTMLElement;
                // Don't make empty alignment lines editable
                const lineEl = htmlEl.closest('.diff-line');
                if (lineEl && !lineEl.classList.contains('diff-line-empty')) {
                    htmlEl.contentEditable = 'true';
                    htmlEl.classList.add('editable');
                    setupEditableLineHandlers(htmlEl);
                }
            });
        }
    }
}

/**
 * Setup event handlers for an editable line
 */
function setupEditableLineHandlers(element: HTMLElement): void {
    // Track modifications
    element.addEventListener('input', () => {
        contentModified = true;
        // Debounced auto-save after 2 seconds of no typing
        if (saveDebounceTimer) {
            clearTimeout(saveDebounceTimer);
        }
        saveDebounceTimer = window.setTimeout(() => {
            if (contentModified) {
                saveEditedContent();
            }
        }, 2000);
    });

    // Save on blur (when user clicks away)
    element.addEventListener('blur', () => {
        if (contentModified) {
            // Clear any pending debounce
            if (saveDebounceTimer) {
                clearTimeout(saveDebounceTimer);
                saveDebounceTimer = null;
            }
            saveEditedContent();
        }
    });

    // Handle keyboard shortcuts
    element.addEventListener('keydown', (e) => {
        // Ctrl/Cmd + S to save
        if ((e.ctrlKey || e.metaKey) && e.key === 's') {
            e.preventDefault();
            if (contentModified) {
                saveEditedContent();
            }
        }
    });
}

/**
 * Save the edited content
 */
function saveEditedContent(): void {
    const viewMode = getViewMode();
    
    if (viewMode === 'inline') {
        // For inline view, extract content from addition and context lines
        const inlineContainer = document.getElementById('inline-content');
        if (!inlineContainer) return;
        
        const lines: string[] = [];
        const lineElements = inlineContainer.querySelectorAll('.inline-diff-line');
        
        lineElements.forEach((el) => {
            const htmlEl = el as HTMLElement;
            const side = htmlEl.dataset.side;
            
            // Include context lines and new lines, skip deletions
            if (side === 'new' || side === 'context') {
                const textEl = htmlEl.querySelector('.line-text');
                if (textEl) {
                    lines.push(textEl.textContent || '');
                }
            }
        });
        
        const newContent = lines.join('\n');
        sendSaveContent(newContent);
        updateState({ newContent });
    } else {
        // For split view, extract content from the new pane
        const newContainer = document.getElementById('new-content');
        if (!newContainer) return;
        
        const lines: string[] = [];
        const lineElements = newContainer.querySelectorAll('.diff-line');
        
        lineElements.forEach((el) => {
            const htmlEl = el as HTMLElement;
            // Skip empty alignment lines
            if (!htmlEl.classList.contains('diff-line-empty')) {
                const textEl = htmlEl.querySelector('.line-text');
                if (textEl) {
                    lines.push(textEl.textContent || '');
                }
            }
        });
        
        const newContent = lines.join('\n');
        sendSaveContent(newContent);
        updateState({ newContent });
    }
    
    contentModified = false;
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize);
} else {
    initialize();
}

