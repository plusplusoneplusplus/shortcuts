/**
 * Main entry point for the diff review webview
 */

import { initializeScrollSync, invalidateHighlightCache, renderDiff, updateCommentIndicators } from './diff-renderer';
import { closeActiveCommentBubble, hideCommentPanel, hideCommentsList, initPanelElements, rebuildAISubmenu, rebuildPredefinedSubmenu, showCommentPanel, showCommentsForLine, showContextMenu, updateContextMenuForSettings } from './panel-manager';
import { getCurrentSelection, hasValidSelection, setupSelectionListener } from './selection-handler';
import { createInitialState, getCommentsForLine, getIgnoreWhitespace, getIsEditable, getIsInteracting, getState, getViewMode, setComments, setIsEditable, setSettings, setViewMode, toggleIgnoreWhitespace, toggleViewMode, updateState, ViewMode } from './state';
import { ExtensionMessage } from './types';
import { getPersistedViewMode, initVSCodeAPI, saveViewMode, sendContentModified, sendCopyPath, sendOpenFile, sendPinTab, sendReady, sendSaveContent } from './vscode-bridge';
import { initSearch } from '../../shared/webview/search-handler';

// AbortController for managing event listeners
let commentHandlersAbortController: AbortController | null = null;
// Search cleanup function
let searchCleanup: (() => void) | null = null;

/**
 * Initialize the webview
 */
function initialize(): void {
    console.log('[Diff Webview] Initializing...');

    // Initialize VSCode API
    initVSCodeAPI();

    // Get persisted view mode preference before creating initial state
    const persistedViewMode = getPersistedViewMode();
    console.log('[Diff Webview] Persisted view mode:', persistedViewMode);

    // Initialize state with persisted view mode
    const state = createInitialState(persistedViewMode);
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

    // Setup diff navigation buttons
    setupDiffNavigation();

    // Setup file path click handler
    setupFilePathClickHandler();

    // Setup pin tab button
    setupPinTabButton();

    // Setup editable content (for uncommitted changes)
    setupEditableContent();

    // Setup double-click handler to pin the preview tab
    setupDoubleClickToPinTab();

    // Initialize search functionality (Ctrl+F)
    searchCleanup = initSearch('.diff-view-container');

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
                // Rebuild AI submenu if commands changed
                if (message.settings.aiCommands) {
                    rebuildAISubmenu();
                }
                // Rebuild predefined submenu if changed
                if (message.settings.predefinedComments) {
                    rebuildPredefinedSubmenu();
                }
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

        // Escape to close panels and bubbles
        if (e.key === 'Escape') {
            hideCommentPanel();
            hideCommentsList();
            closeActiveCommentBubble();
        }

        // Shift + Arrow key navigation to move between diff changes
        if (e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
            const activeElement = document.activeElement;
            const isInInputOrTextarea = activeElement instanceof HTMLElement && 
                (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA');

            // Don't interfere with input/textarea elements
            if (!isInInputOrTextarea) {
                e.preventDefault();
                navigateToDiff(e.key === 'ArrowUp' ? 'prev' : 'next');
                return;
            }
        }

        // Arrow key navigation
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            const activeElement = document.activeElement;
            const isInInputOrTextarea = activeElement instanceof HTMLElement && 
                (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA');

            // Don't interfere with input/textarea elements
            if (isInInputOrTextarea) {
                return;
            }

            // Check if we're in an editable line-text element
            const isInEditableLine = activeElement instanceof HTMLElement && 
                activeElement.isContentEditable &&
                activeElement.classList.contains('line-text');

            if (isInEditableLine) {
                // In editable mode, navigate between lines when cursor is at boundary
                const shouldNavigate = shouldNavigateFromEditableLine(
                    activeElement as HTMLElement,
                    e.key === 'ArrowUp' ? 'up' : 'down'
                );
                
                if (shouldNavigate) {
                    e.preventDefault();
                    handleArrowKeyNavigationFromEditable(
                        activeElement as HTMLElement,
                        e.key === 'ArrowUp' ? 'up' : 'down'
                    );
                }
                // Otherwise, let the browser handle cursor movement within the line
            } else {
                // Not in editable mode, use standard line navigation
                e.preventDefault();
                handleArrowKeyNavigation(e.key === 'ArrowUp' ? 'up' : 'down');
            }
        }
    });
}

/**
 * Check if we should navigate to another line from an editable line
 * Returns true if cursor is at the start (for up) or end (for down) of the line
 */
function shouldNavigateFromEditableLine(element: HTMLElement, direction: 'up' | 'down'): boolean {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
        return true; // No selection, allow navigation
    }

    const range = selection.getRangeAt(0);
    
    // If there's a selection (not collapsed), don't navigate
    if (!range.collapsed) {
        return false;
    }

    const textContent = element.textContent || '';
    
    if (direction === 'up') {
        // Navigate up if cursor is at the very beginning of the line
        // Check if we're at offset 0 of the first text node
        if (range.startOffset === 0) {
            // Check if we're at the start of the element
            const beforeRange = document.createRange();
            beforeRange.setStart(element, 0);
            beforeRange.setEnd(range.startContainer, range.startOffset);
            const textBefore = beforeRange.toString();
            return textBefore.length === 0;
        }
        return false;
    } else {
        // Navigate down if cursor is at the very end of the line
        const afterRange = document.createRange();
        afterRange.setStart(range.endContainer, range.endOffset);
        afterRange.setEndAfter(element);
        const textAfter = afterRange.toString();
        return textAfter.length === 0;
    }
}

/**
 * Handle arrow key navigation when in an editable line
 * Moves focus to the adjacent editable line
 */
function handleArrowKeyNavigationFromEditable(currentElement: HTMLElement, direction: 'up' | 'down'): void {
    const viewMode = getViewMode();
    let container: HTMLElement | null = null;
    let lineSelector: string;

    if (viewMode === 'inline') {
        container = document.getElementById('inline-content');
        lineSelector = '.inline-diff-line';
    } else {
        container = document.getElementById('new-content');
        lineSelector = '.diff-line';
    }

    if (!container) return;

    // Find the current line element
    const currentLine = currentElement.closest(lineSelector) as HTMLElement;
    if (!currentLine) return;

    const lines = Array.from(container.querySelectorAll(lineSelector));
    const currentIndex = lines.indexOf(currentLine);
    if (currentIndex === -1) return;

    // Find the next/previous editable line
    let targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
    
    while (targetIndex >= 0 && targetIndex < lines.length) {
        const targetLine = lines[targetIndex] as HTMLElement;
        const targetTextEl = targetLine.querySelector('.line-text.editable') as HTMLElement;
        
        if (targetTextEl) {
            // Found an editable line, focus it
            targetTextEl.focus();
            
            // Place cursor at the appropriate position
            const selection = window.getSelection();
            const range = document.createRange();
            
            if (direction === 'up') {
                // Place cursor at the end of the line when going up
                if (targetTextEl.lastChild) {
                    const lastNode = targetTextEl.lastChild;
                    if (lastNode.nodeType === Node.TEXT_NODE) {
                        range.setStart(lastNode, (lastNode as Text).length);
                        range.setEnd(lastNode, (lastNode as Text).length);
                    } else {
                        range.selectNodeContents(targetTextEl);
                        range.collapse(false);
                    }
                } else {
                    range.selectNodeContents(targetTextEl);
                    range.collapse(false);
                }
            } else {
                // Place cursor at the start of the line when going down
                range.selectNodeContents(targetTextEl);
                range.collapse(true);
            }
            
            selection?.removeAllRanges();
            selection?.addRange(range);
            
            // Scroll into view
            targetLine.scrollIntoView({ behavior: 'auto', block: 'nearest' });
            return;
        }
        
        // Move to next candidate
        targetIndex = direction === 'up' ? targetIndex - 1 : targetIndex + 1;
    }
}

/**
 * Handle arrow key navigation in the diff view
 */
function handleArrowKeyNavigation(direction: 'up' | 'down'): void {
    const viewMode = getViewMode();
    let container: HTMLElement | null = null;
    let lineSelector: string;

    if (viewMode === 'inline') {
        container = document.getElementById('inline-content');
        lineSelector = '.inline-diff-line';
    } else {
        // For split view, use the new-content pane as the primary navigation target
        container = document.getElementById('new-content');
        lineSelector = '.diff-line';
    }

    if (!container) return;

    const lines = container.querySelectorAll(lineSelector);
    if (lines.length === 0) return;

    // Find the currently focused/selected line
    const currentLine = container.querySelector(`${lineSelector}.keyboard-focused`) as HTMLElement;
    let currentIndex = -1;

    if (currentLine) {
        currentIndex = Array.from(lines).indexOf(currentLine);
    } else {
        // If no line is focused, find the first visible line in the viewport
        const containerRect = container.getBoundingClientRect();
        const scrollTop = container.scrollTop;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i] as HTMLElement;
            const lineTop = line.offsetTop - scrollTop;
            // Check if this line is visible in the container
            if (lineTop >= 0 && lineTop < containerRect.height) {
                // Start from this visible line
                currentIndex = i;
                break;
            }
        }
        
        // If still not found, default to first or last based on direction
        if (currentIndex === -1) {
            currentIndex = direction === 'up' ? 0 : lines.length - 1;
        }
    }

    // Calculate new index
    let newIndex: number;
    if (direction === 'up') {
        newIndex = Math.max(0, currentIndex - 1);
    } else {
        newIndex = Math.min(lines.length - 1, currentIndex + 1);
    }

    // Remove focus from all lines (in case there are multiple)
    container.querySelectorAll(`${lineSelector}.keyboard-focused`).forEach(el => {
        el.classList.remove('keyboard-focused');
    });

    // Focus new line
    const newLine = lines[newIndex] as HTMLElement;
    if (newLine) {
        newLine.classList.add('keyboard-focused');
        // Use instant scroll for responsive navigation
        newLine.scrollIntoView({ behavior: 'auto', block: 'nearest' });
    }
}

/**
 * Setup click-outside-to-dismiss behavior for comment panels
 */
function setupClickOutsideToDismiss(): void {
    document.addEventListener('click', (e) => {
        // Don't dismiss if user is currently interacting with a panel (resize/drag)
        if (getIsInteracting()) {
            return;
        }

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

        // Check if clicking outside the active comment bubble
        const activeBubble = document.querySelector('.inline-comment-bubble');
        if (activeBubble) {
            // Don't dismiss if clicking inside the bubble
            if (!activeBubble.contains(target)) {
                // Don't dismiss if clicking on a comment indicator (which opens the bubble)
                if (!target.classList.contains('comment-indicator')) {
                    closeActiveCommentBubble();
                }
            }
        }
    });
}

/**
 * Setup double-click handler to pin the preview tab.
 * Similar to VS Code's behavior where double-clicking on a preview tab pins it.
 * Double-clicking anywhere in the diff content area will pin the tab.
 */
function setupDoubleClickToPinTab(): void {
    // Use document-level listener to catch double-clicks anywhere in the webview
    // This ensures we capture the event even if text selection occurs
    document.addEventListener('dblclick', (e: MouseEvent) => {
        const target = e.target as HTMLElement;
        
        // Don't pin if double-clicking on interactive elements like buttons or inputs
        if (target.tagName === 'BUTTON' || 
            target.tagName === 'INPUT' || 
            target.tagName === 'TEXTAREA' ||
            target.closest('button') ||
            target.closest('input') ||
            target.closest('textarea') ||
            target.closest('.comment-panel') ||
            target.closest('.comments-list') ||
            target.closest('.custom-context-menu') ||
            target.closest('#custom-context-menu')) {
            return;
        }

        // Only pin if the double-click is within the diff view container or header
        const diffViewContainer = document.getElementById('diff-view-container');
        const header = document.querySelector('.diff-header');
        
        if ((diffViewContainer && diffViewContainer.contains(target)) || 
            (header && header.contains(target))) {
            // Send message to extension to pin the tab
            console.log('[Diff Webview] Double-click detected, pinning tab');
            sendPinTab();
        }
    }, true); // Use capture phase to get the event before text selection
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

    // Initialize UI with current view mode (which may have been restored from persisted state)
    const currentMode = getViewMode();
    updateToggleUI(currentMode);
    
    // If starting in inline mode, we need to re-render the diff
    if (currentMode === 'inline') {
        // Defer re-render to ensure DOM is ready
        setTimeout(() => {
            renderDiff();
            setupCommentIndicatorHandlers();
        }, 0);
    }

    // Handle click
    toggleButton.addEventListener('click', () => {
        const newMode = toggleViewMode();
        updateToggleUI(newMode);
        
        // Persist the view mode preference
        saveViewMode(newMode);
        console.log('[Diff Webview] Saved view mode:', newMode);
        
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
 * Setup diff navigation buttons (prev/next change)
 */
function setupDiffNavigation(): void {
    const prevBtn = document.getElementById('prev-diff-btn');
    const nextBtn = document.getElementById('next-diff-btn');

    if (prevBtn) {
        prevBtn.addEventListener('click', () => navigateToDiff('prev'));
    }
    if (nextBtn) {
        nextBtn.addEventListener('click', () => navigateToDiff('next'));
    }
}

/**
 * Setup pin tab button to keep the current tab open when viewing other files.
 * This converts the preview tab to a pinned tab.
 */
function setupPinTabButton(): void {
    const pinBtn = document.getElementById('pin-tab-btn');
    if (!pinBtn) {
        console.warn('[Diff Webview] Pin tab button not found');
        return;
    }

    pinBtn.addEventListener('click', () => {
        console.log('[Diff Webview] Pin tab button clicked');
        sendPinTab();
        
        // Update button to show it's been pinned
        pinBtn.classList.add('pinned');
        const label = pinBtn.querySelector('.pin-label');
        if (label) {
            label.textContent = 'Pinned';
        }
        pinBtn.title = 'This tab is pinned (will not be replaced)';
        
        // Optionally hide the button after pinning since it's no longer needed
        setTimeout(() => {
            pinBtn.style.display = 'none';
        }, 1000);
    });
}

/**
 * Navigate to the previous or next diff change
 * Groups consecutive changes together to navigate between change blocks
 */
function navigateToDiff(direction: 'prev' | 'next'): void {
    const viewMode = getViewMode();
    let container: HTMLElement | null;
    let lineSelector: string;
    let additionClass: string;
    let deletionClass: string;

    if (viewMode === 'inline') {
        container = document.getElementById('inline-content');
        lineSelector = '.inline-diff-line';
        // Inline view uses inline-diff-line-addition and inline-diff-line-deletion
        additionClass = 'inline-diff-line-addition';
        deletionClass = 'inline-diff-line-deletion';
    } else {
        // For split view, use the new-content pane
        container = document.getElementById('new-content');
        lineSelector = '.diff-line';
        // Split view uses diff-line-addition and diff-line-deletion (or line-added/line-deleted)
        additionClass = 'line-added';
        deletionClass = 'line-deleted';
    }

    if (!container) return;

    const allLines = Array.from(container.querySelectorAll(lineSelector)) as HTMLElement[];
    
    // Check if there are any change lines
    const hasChanges = allLines.some(line => 
        line.classList.contains(additionClass) || line.classList.contains(deletionClass)
    );
    
    if (!hasChanges) return;

    // Group consecutive change lines into change blocks
    const changeBlocks: { startIndex: number; endIndex: number; firstLine: HTMLElement }[] = [];
    let currentBlockStart = -1;
    let currentBlockEnd = -1;
    let currentBlockFirstLine: HTMLElement | null = null;

    for (let i = 0; i < allLines.length; i++) {
        const line = allLines[i];
        const isChange = line.classList.contains(additionClass) || line.classList.contains(deletionClass);

        if (isChange) {
            if (currentBlockStart === -1) {
                // Start a new block
                currentBlockStart = i;
                currentBlockFirstLine = line;
            }
            currentBlockEnd = i;
        } else {
            // End of a change block
            if (currentBlockStart !== -1 && currentBlockFirstLine) {
                changeBlocks.push({
                    startIndex: currentBlockStart,
                    endIndex: currentBlockEnd,
                    firstLine: currentBlockFirstLine
                });
                currentBlockStart = -1;
                currentBlockEnd = -1;
                currentBlockFirstLine = null;
            }
        }
    }
    
    // Don't forget the last block if we're still in one
    if (currentBlockStart !== -1 && currentBlockFirstLine) {
        changeBlocks.push({
            startIndex: currentBlockStart,
            endIndex: currentBlockEnd,
            firstLine: currentBlockFirstLine
        });
    }

    if (changeBlocks.length === 0) return;

    // Find the currently focused line or the first visible line
    const focusedLine = container.querySelector(`${lineSelector}.keyboard-focused`) as HTMLElement;
    let currentLineIndex = -1;

    if (focusedLine) {
        currentLineIndex = allLines.indexOf(focusedLine);
    } else {
        // Find the first visible line
        const containerRect = container.getBoundingClientRect();
        const scrollTop = container.scrollTop;

        for (let i = 0; i < allLines.length; i++) {
            const line = allLines[i];
            const lineTop = line.offsetTop - scrollTop;
            if (lineTop >= 0 && lineTop < containerRect.height) {
                currentLineIndex = i;
                break;
            }
        }
    }

    // Find the target change block
    let targetBlockIndex = -1;
    
    if (direction === 'next') {
        // Find the next change block after current position
        for (let i = 0; i < changeBlocks.length; i++) {
            if (changeBlocks[i].startIndex > currentLineIndex) {
                targetBlockIndex = i;
                break;
            }
        }
        // If we're at the end, wrap to the first block
        if (targetBlockIndex === -1 && changeBlocks.length > 0) {
            targetBlockIndex = 0;
        }
    } else {
        // Find the previous change block before current position
        for (let i = changeBlocks.length - 1; i >= 0; i--) {
            if (changeBlocks[i].startIndex < currentLineIndex) {
                targetBlockIndex = i;
                break;
            }
        }
        // If we're at the beginning, wrap to the last block
        if (targetBlockIndex === -1 && changeBlocks.length > 0) {
            targetBlockIndex = changeBlocks.length - 1;
        }
    }

    if (targetBlockIndex === -1) return;

    const targetBlock = changeBlocks[targetBlockIndex];
    const targetLine = targetBlock.firstLine;

    // Remove keyboard focus from all lines
    container.querySelectorAll(`${lineSelector}.keyboard-focused`).forEach(el => {
        el.classList.remove('keyboard-focused');
    });

    // Add keyboard focus to the target line
    targetLine.classList.add('keyboard-focused');

    // Add a highlight flash effect to the entire change block
    for (let i = targetBlock.startIndex; i <= targetBlock.endIndex; i++) {
        const line = allLines[i];
        if (line.classList.contains(additionClass) || line.classList.contains(deletionClass)) {
            line.classList.add('highlight-flash');
            setTimeout(() => {
                line.classList.remove('highlight-flash');
            }, 1500);
        }
    }

    // Scroll to the target line with some context above
    targetLine.scrollIntoView({ behavior: 'smooth', block: 'center' });
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
        if (!contentModified) {
            contentModified = true;
            // Notify extension that content is now dirty
            sendContentModified(true);
        }
        // Mark the line element as edited so we know to extract from DOM
        const lineEl = element.closest('.diff-line, .inline-diff-line') as HTMLElement;
        if (lineEl) {
            lineEl.dataset.edited = 'true';
        }
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
 * Extract line content, preserving original whitespace for unedited lines
 * @param lineEl The line element
 * @returns The line content string
 */
function extractLineContent(lineEl: HTMLElement): string {
    // If the line was edited, extract from DOM (user's changes)
    if (lineEl.dataset.edited === 'true') {
        const textEl = lineEl.querySelector('.line-text');
        return textEl?.textContent || '';
    }

    // For unedited lines, use the original content to preserve whitespace
    if (lineEl.dataset.originalContent !== undefined) {
        return lineEl.dataset.originalContent;
    }

    // Fallback to DOM extraction
    const textEl = lineEl.querySelector('.line-text');
    return textEl?.textContent || '';
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
                lines.push(extractLineContent(htmlEl));
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
                lines.push(extractLineContent(htmlEl));
            }
        });

        const newContent = lines.join('\n');
        sendSaveContent(newContent);
        updateState({ newContent });
    }

    contentModified = false;
    // Notify extension that content is no longer dirty
    sendContentModified(false);
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize);
} else {
    initialize();
}

