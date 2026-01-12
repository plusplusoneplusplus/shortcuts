/**
 * DOM event handlers for the webview
 * 
 * Uses content-extraction module for extracting plain text from the contenteditable editor.
 */

import {
    DEFAULT_SKIP_CLASSES,
    ExtractionContext,
    normalizeExtractedLine
} from '../webview-logic/content-extraction';
import {
    attachAISubmenuHandlers,
    getAICommands,
    updateAISubmenu
} from './ai-menu-builder';
import {
    closeActiveCommentBubble,
    closeFloatingPanel,
    closeInlineEditPanel,
    showCommentBubble,
    showFloatingPanel
} from './panel-manager';
import { render } from './render';
import { getSelectionPosition } from './selection-handler';
import { state } from './state';
import { SerializedAICommand, SerializedPredefinedComment } from './types';
import { openFile, requestAskAI, requestCopyPrompt, requestDeleteAll, requestResolveAll, requestSendToChat, updateContent } from './vscode-bridge';
import { DEFAULT_MARKDOWN_PREDEFINED_COMMENTS, serializePredefinedComments } from '../../shared/predefined-comment-types';
import { initSearch, SearchController } from '../../shared/webview/search-handler';

// DOM element references
let editorWrapper: HTMLElement;
let showResolvedCheckbox: HTMLInputElement;
let contextMenu: HTMLElement;
let contextMenuCut: HTMLElement;
let contextMenuCopy: HTMLElement;
let contextMenuPaste: HTMLElement;
let contextMenuAddComment: HTMLElement;
let contextMenuAskAI: HTMLElement;
// Ask AI submenu element (dynamically populated)
let askAISubmenu: HTMLElement;
// Predefined comments submenu elements
let contextMenuPredefined: HTMLElement;
let predefinedSubmenu: HTMLElement;
// Predefined comment preview tooltip
let predefinedPreview: HTMLElement;
let previewContent: HTMLElement;
// Custom instruction dialog elements
let customInstructionDialog: HTMLElement;
let customInstructionClose: HTMLElement;
let customInstructionSelection: HTMLElement;
let customInstructionInput: HTMLTextAreaElement;
let customInstructionCancelBtn: HTMLElement;
let customInstructionSubmitBtn: HTMLElement;
let customInstructionOverlay: HTMLElement | null = null;
// Current command ID for custom instruction dialog
let pendingCustomCommandId: string = 'custom';
// Search controller
let searchController: SearchController | null = null;

/**
 * Initialize DOM handlers
 */
export function initDomHandlers(): void {
    editorWrapper = document.getElementById('editorWrapper')!;
    showResolvedCheckbox = document.getElementById('showResolvedCheckbox') as HTMLInputElement;
    contextMenu = document.getElementById('contextMenu')!;
    contextMenuCut = document.getElementById('contextMenuCut')!;
    contextMenuCopy = document.getElementById('contextMenuCopy')!;
    contextMenuPaste = document.getElementById('contextMenuPaste')!;
    contextMenuAddComment = document.getElementById('contextMenuAddComment')!;
    contextMenuAskAI = document.getElementById('contextMenuAskAI')!;
    // Ask AI submenu element (dynamically populated)
    askAISubmenu = document.getElementById('askAISubmenu')!;
    // Predefined comments submenu elements
    contextMenuPredefined = document.getElementById('contextMenuPredefined')!;
    predefinedSubmenu = document.getElementById('predefinedSubmenu')!;
    // Preview tooltip elements
    predefinedPreview = document.getElementById('predefinedPreview')!;
    previewContent = predefinedPreview.querySelector('.preview-content')!;
    // Custom instruction dialog elements
    customInstructionDialog = document.getElementById('customInstructionDialog')!;
    customInstructionClose = document.getElementById('customInstructionClose')!;
    customInstructionSelection = document.getElementById('customInstructionSelection')!;
    customInstructionInput = document.getElementById('customInstructionInput') as HTMLTextAreaElement;
    customInstructionCancelBtn = document.getElementById('customInstructionCancelBtn')!;
    customInstructionSubmitBtn = document.getElementById('customInstructionSubmitBtn')!;

    setupToolbarEventListeners();
    setupEditorEventListeners();
    setupContextMenuEventListeners();
    setupKeyboardEventListeners();
    setupGlobalEventListeners();
    setupCustomInstructionDialogEventListeners();
    
    // Initialize search functionality (Ctrl+F)
    searchController = initSearch('#editorWrapper');

    // Build initial AI submenu with default commands
    rebuildAISubmenu();

    // Build initial predefined comments submenu
    rebuildPredefinedSubmenu();
}

/**
 * Rebuild the AI submenu based on current settings
 */
export function rebuildAISubmenu(): void {
    const commands = getAICommands(state.settings.aiCommands);
    updateAISubmenu(askAISubmenu, commands);
    attachAISubmenuHandlers(askAISubmenu, handleAICommandClick);
}

/**
 * Get the predefined comments from settings or defaults
 */
function getPredefinedComments(): SerializedPredefinedComment[] {
    const comments = state.settings.predefinedComments;
    if (comments && comments.length > 0) {
        return [...comments].sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
    }
    // Default predefined comments from shared constants
    return serializePredefinedComments(DEFAULT_MARKDOWN_PREDEFINED_COMMENTS);
}

/**
 * Rebuild the predefined comments submenu based on current settings
 */
export function rebuildPredefinedSubmenu(): void {
    if (!predefinedSubmenu) return;

    const comments = getPredefinedComments();
    predefinedSubmenu.innerHTML = comments.map(c => {
        const title = c.description ? `title="${c.description}"` : '';
        return `<div class="context-menu-item predefined-item" data-id="${c.id}" data-text="${encodeURIComponent(c.text)}" ${title}>
            <span class="context-menu-label">${c.label}</span>
        </div>`;
    }).join('');

    // Attach click and hover handlers
    predefinedSubmenu.querySelectorAll('.predefined-item').forEach(item => {
        const el = item as HTMLElement;
        
        // Click handler
        el.addEventListener('click', (e) => {
            e.stopPropagation();
            const text = decodeURIComponent(el.dataset.text || '');
            hidePreview();
            hideContextMenu();
            handlePredefinedCommentFromContextMenu(text);
        });
        
        // Hover handlers for preview
        el.addEventListener('mouseenter', (e) => {
            const text = decodeURIComponent(el.dataset.text || '');
            showPreview(text, el);
        });
        
        el.addEventListener('mouseleave', () => {
            hidePreview();
        });
    });
}

/**
 * Show preview tooltip for predefined comment
 */
function showPreview(text: string, anchorElement: HTMLElement): void {
    if (!predefinedPreview || !previewContent) return;
    
    // Set the preview text
    previewContent.textContent = text;
    
    // Position the preview to the right of the submenu item
    const rect = anchorElement.getBoundingClientRect();
    predefinedPreview.style.left = `${rect.right + 8}px`;
    predefinedPreview.style.top = `${rect.top}px`;
    predefinedPreview.style.display = 'block';
}

/**
 * Hide preview tooltip
 */
function hidePreview(): void {
    if (predefinedPreview) {
        predefinedPreview.style.display = 'none';
    }
}

/**
 * Handle click on an AI command in the submenu
 */
function handleAICommandClick(commandId: string, isCustomInput: boolean): void {
    hideContextMenu();
    if (isCustomInput) {
        pendingCustomCommandId = commandId;
        showCustomInstructionDialog();
    } else {
        handleAskAIFromContextMenu(commandId);
    }
}

/**
 * Setup toolbar event listeners
 */
function setupToolbarEventListeners(): void {
    document.getElementById('resolveAllBtn')?.addEventListener('click', () => {
        requestResolveAll();
    });

    document.getElementById('deleteAllBtn')?.addEventListener('click', () => {
        requestDeleteAll();
    });

    // AI Action dropdown
    setupAIActionDropdown();

    showResolvedCheckbox.addEventListener('change', (e) => {
        state.setSettings({ showResolved: (e.target as HTMLInputElement).checked });
        render();
    });

    // Mode toggle buttons
    setupModeToggle();
}

/**
 * Setup AI Action dropdown menu handlers
 */
function setupAIActionDropdown(): void {
    const aiActionDropdown = document.getElementById('aiActionDropdown');
    const aiActionBtn = document.getElementById('aiActionBtn');
    const aiActionMenu = document.getElementById('aiActionMenu');
    const sendToNewChatBtn = document.getElementById('sendToNewChatBtn');
    const sendToExistingChatBtn = document.getElementById('sendToExistingChatBtn');
    const copyPromptBtn = document.getElementById('copyPromptBtn');

    if (!aiActionDropdown || !aiActionBtn || !aiActionMenu) return;

    // Toggle dropdown on button click
    aiActionBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = aiActionMenu.classList.contains('show');
        if (isOpen) {
            hideAIActionMenu();
        } else {
            showAIActionMenu();
        }
    });

    // Send to New Chat action (starts a new conversation)
    sendToNewChatBtn?.addEventListener('click', () => {
        hideAIActionMenu();
        requestSendToChat('markdown', true);
    });

    // Send to Existing Chat action (uses existing conversation)
    sendToExistingChatBtn?.addEventListener('click', () => {
        hideAIActionMenu();
        requestSendToChat('markdown', false);
    });

    // Copy as Prompt action
    copyPromptBtn?.addEventListener('click', () => {
        hideAIActionMenu();
        requestCopyPrompt('markdown');
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
        if (!aiActionDropdown.contains(e.target as Node)) {
            hideAIActionMenu();
        }
    });

    // Close dropdown on Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            hideAIActionMenu();
        }
    });
}

/**
 * Show the AI Action dropdown menu
 */
function showAIActionMenu(): void {
    const aiActionMenu = document.getElementById('aiActionMenu');
    const aiActionBtn = document.getElementById('aiActionBtn');
    if (aiActionMenu && aiActionBtn) {
        aiActionMenu.classList.add('show');
        aiActionBtn.classList.add('active');
    }
}

/**
 * Hide the AI Action dropdown menu
 */
function hideAIActionMenu(): void {
    const aiActionMenu = document.getElementById('aiActionMenu');
    const aiActionBtn = document.getElementById('aiActionBtn');
    if (aiActionMenu && aiActionBtn) {
        aiActionMenu.classList.remove('show');
        aiActionBtn.classList.remove('active');
    }
}

/**
 * Setup mode toggle button handlers
 */
function setupModeToggle(): void {
    const reviewModeBtn = document.getElementById('reviewModeBtn');
    const sourceModeBtn = document.getElementById('sourceModeBtn');

    reviewModeBtn?.addEventListener('click', () => {
        if (state.viewMode !== 'review') {
            setViewMode('review');
        }
    });

    sourceModeBtn?.addEventListener('click', () => {
        if (state.viewMode !== 'source') {
            setViewMode('source');
        }
    });
}

/**
 * Set the view mode and update UI
 */
export function setViewMode(mode: 'review' | 'source'): void {
    state.setViewMode(mode);

    // Update button active states
    const reviewModeBtn = document.getElementById('reviewModeBtn');
    const sourceModeBtn = document.getElementById('sourceModeBtn');

    if (mode === 'review') {
        reviewModeBtn?.classList.add('active');
        sourceModeBtn?.classList.remove('active');
        document.body.classList.remove('source-mode');
    } else {
        reviewModeBtn?.classList.remove('active');
        sourceModeBtn?.classList.add('active');
        document.body.classList.add('source-mode');
    }

    // Re-render with the new mode
    render();
}

/**
 * Setup editor event listeners
 */
function setupEditorEventListeners(): void {
    editorWrapper.addEventListener('input', handleEditorInput);
    editorWrapper.addEventListener('keydown', handleEditorKeydown);
    editorWrapper.addEventListener('mouseup', handleSelectionChange);
    editorWrapper.addEventListener('keyup', handleSelectionChange);
    editorWrapper.addEventListener('click', handleTripleClick);
    editorWrapper.addEventListener('paste', handleKeyboardPaste);
}

/**
 * Handle keyboard paste (Ctrl+V / Cmd+V) in the editor
 * Intercepts paste to ensure plain text is inserted and properly rendered
 */
function handleKeyboardPaste(e: ClipboardEvent): void {
    const clipboardData = e.clipboardData;
    if (!clipboardData) return;

    // Get plain text from clipboard to avoid HTML/RTF formatting issues
    const text = clipboardData.getData('text/plain');
    if (!text) return;

    // Prevent default only if we have text to insert
    e.preventDefault();

    // Insert text at current selection using Range API
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
        // Fallback: focus editor and try execCommand
        editorWrapper.focus();
        document.execCommand('insertText', false, text);
    } else {
        const range = selection.getRangeAt(0);
        range.deleteContents();
        
        // Create text node and insert
        const textNode = document.createTextNode(text);
        range.insertNode(textNode);
        
        // Move cursor to end of inserted text
        range.setStartAfter(textNode);
        range.setEndAfter(textNode);
        selection.removeAllRanges();
        selection.addRange(range);
    }

    // After paste, extract the new content and update state/render
    setTimeout(() => {
        const newContent = getPlainTextContent();
        if (newContent !== state.currentContent) {
            state.setCurrentContent(newContent);
            updateContent(newContent);
            render();
        }
    }, 0);
}

/**
 * Setup context menu event listeners
 */
function setupContextMenuEventListeners(): void {
    document.addEventListener('contextmenu', (e) => {
        if ((e.target as HTMLElement).closest('#editorContainer')) {
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

    // Ask AI parent - reposition submenu on hover
    contextMenuAskAI.addEventListener('mouseenter', () => {
        positionSubmenu(askAISubmenu, contextMenuAskAI);
    });

    // Predefined comments parent - reposition submenu on hover
    contextMenuPredefined.addEventListener('mouseenter', () => {
        positionSubmenu(predefinedSubmenu, contextMenuPredefined);
    });

    // Note: AI submenu items are handled dynamically via rebuildAISubmenu()
    // Note: Predefined submenu items are handled dynamically via rebuildPredefinedSubmenu()

    // Hide context menu on click outside
    document.addEventListener('click', (e) => {
        if (!(e.target as HTMLElement).closest('.context-menu')) {
            hideContextMenu();
        }
    });
}

/**
 * Setup keyboard event listeners
 */
function setupKeyboardEventListeners(): void {
    document.addEventListener('keydown', (e) => {
        // Escape closes panels
        if (e.key === 'Escape') {
            closeFloatingPanel();
            closeInlineEditPanel();
            closeActiveCommentBubble();
            hideContextMenu();
        }

        // Ctrl+Shift+M to add comment
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'm') {
            e.preventDefault();
            handleAddComment();
        }
    });
}

/**
 * Setup global event listeners
 */
function setupGlobalEventListeners(): void {
    // Close bubble when clicking outside
    document.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        if (state.activeCommentBubble &&
            !target.closest('.inline-comment-bubble') &&
            !target.closest('.commented-text') &&
            !target.closest('.gutter-icon')) {
            // Don't close if currently resizing or dragging (or just finished)
            if (state.isInteracting) {
                return;
            }
            closeActiveCommentBubble();
        }
    });
}

/**
 * Handle context menu
 */
function handleContextMenu(e: MouseEvent): void {
    const selection = window.getSelection();
    const hasSelection = selection && !selection.isCollapsed && selection.toString().trim().length > 0;

    // Save selection info for later use
    if (hasSelection) {
        const range = selection!.getRangeAt(0);
        const selectionInfo = getSelectionPosition(range);
        if (selectionInfo) {
            state.setSavedSelectionForContextMenu({
                ...selectionInfo,
                selectedText: selection!.toString().trim(),
                range: range.cloneRange(),
                rect: range.getBoundingClientRect()
            });
        }
    } else {
        state.setSavedSelectionForContextMenu(null);
    }

    // Update menu item states based on selection
    if (hasSelection) {
        contextMenuCut.classList.remove('disabled');
        contextMenuCopy.classList.remove('disabled');
        contextMenuAddComment.classList.remove('disabled');
        contextMenuPredefined.classList.remove('disabled');
        // Only enable Ask AI if the feature is enabled in settings
        if (state.settings.askAIEnabled) {
            contextMenuAskAI.classList.remove('disabled');
        } else {
            contextMenuAskAI.classList.add('disabled');
        }
    } else {
        contextMenuCut.classList.add('disabled');
        contextMenuCopy.classList.add('disabled');
        contextMenuAddComment.classList.add('disabled');
        contextMenuPredefined.classList.add('disabled');
        contextMenuAskAI.classList.add('disabled');
    }
    // Paste is always enabled
    contextMenuPaste.classList.remove('disabled');

    // Show/hide Ask AI menu item based on feature flag
    if (state.settings.askAIEnabled) {
        contextMenuAskAI.style.display = '';
        // Also show the separator before Ask AI
        const separator = contextMenuAskAI.previousElementSibling;
        if (separator?.classList.contains('context-menu-separator')) {
            (separator as HTMLElement).style.display = '';
        }
    } else {
        contextMenuAskAI.style.display = 'none';
        // Also hide the separator before Ask AI
        const separator = contextMenuAskAI.previousElementSibling;
        if (separator?.classList.contains('context-menu-separator')) {
            (separator as HTMLElement).style.display = 'none';
        }
    }

    // Position and show context menu
    e.preventDefault();
    
    // Get menu dimensions
    contextMenu.style.display = 'block';
    contextMenu.style.visibility = 'hidden';
    const menuRect = contextMenu.getBoundingClientRect();
    contextMenu.style.visibility = '';
    
    // Calculate position with edge detection
    // Account for submenu width (180px + margin) when calculating right edge
    const submenuWidth = 200;
    const menuWidth = menuRect.width;
    const menuHeight = menuRect.height;
    
    let x = e.clientX;
    let y = e.clientY;
    
    // Check right edge - need room for both menu and potential submenu
    if (x + menuWidth + submenuWidth > window.innerWidth) {
        x = Math.max(0, window.innerWidth - menuWidth - submenuWidth);
    }
    
    // Check bottom edge
    if (y + menuHeight > window.innerHeight) {
        y = Math.max(0, window.innerHeight - menuHeight);
    }
    
    contextMenu.style.left = x + 'px';
    contextMenu.style.top = y + 'px';

    // Note: Submenus are positioned on hover via mouseenter events
}

/**
 * Hide context menu
 */
function hideContextMenu(): void {
    contextMenu.style.display = 'none';
    hidePreview(); // Also hide preview tooltip
    // Reset submenu positioning
    [askAISubmenu, predefinedSubmenu].forEach(submenu => {
        if (submenu) {
            submenu.style.left = '';
            submenu.style.right = '';
            submenu.style.top = '';
            submenu.style.bottom = '';
        }
    });
}

/**
 * Position submenu based on available viewport space
 * Adjusts left/right and top/bottom positioning to keep submenu visible
 * @param submenu - The submenu element to position
 * @param parentItem - The parent menu item element
 */
function positionSubmenu(submenu: HTMLElement, parentItem: HTMLElement): void {
    if (!submenu || !parentItem) return;

    // Get parent item position
    const parentRect = parentItem.getBoundingClientRect();
    const menuRect = contextMenu.getBoundingClientRect();

    // Temporarily show submenu to get its dimensions
    const originalDisplay = submenu.style.display;
    submenu.style.display = 'block';
    submenu.style.visibility = 'hidden';
    const submenuRect = submenu.getBoundingClientRect();
    submenu.style.visibility = '';
    submenu.style.display = originalDisplay;

    // Check horizontal space - can we show submenu on the right?
    const spaceOnRight = window.innerWidth - menuRect.right;
    const spaceOnLeft = menuRect.left;

    if (spaceOnRight < submenuRect.width && spaceOnLeft > submenuRect.width) {
        // Not enough space on right, but enough on left - flip to left side
        submenu.style.left = 'auto';
        submenu.style.right = '100%';
        submenu.style.marginLeft = '0';
        submenu.style.marginRight = '2px';
    } else {
        // Default: show on right
        submenu.style.left = '100%';
        submenu.style.right = 'auto';
        submenu.style.marginLeft = '2px';
        submenu.style.marginRight = '0';
    }

    // Check vertical space - position submenu so it doesn't go off-screen
    const submenuBottomIfAlignedToTop = parentRect.top + submenuRect.height;

    if (submenuBottomIfAlignedToTop > window.innerHeight) {
        // Submenu would go below viewport - align to bottom instead
        const overflow = submenuBottomIfAlignedToTop - window.innerHeight;
        submenu.style.top = `${-overflow - 5}px`;  // Extra 5px margin from bottom
    } else {
        submenu.style.top = '-1px';
    }
}

/**
 * Handle cut operation
 */
function handleCut(): void {
    const saved = state.savedSelectionForContextMenu;
    if (saved && saved.selectedText) {
        navigator.clipboard.writeText(saved.selectedText).then(() => {
            // Restore selection and delete
            const selection = window.getSelection();
            selection?.removeAllRanges();
            selection?.addRange(saved.range);
            document.execCommand('delete');
            state.setSavedSelectionForContextMenu(null);
        });
    }
}

/**
 * Handle copy operation
 */
function handleCopy(): void {
    const saved = state.savedSelectionForContextMenu;
    if (saved && saved.selectedText) {
        navigator.clipboard.writeText(saved.selectedText);
    }
}

/**
 * Handle paste operation
 * After pasting, trigger content update and re-render for proper markdown rendering
 */
function handlePaste(): void {
    navigator.clipboard.readText().then(text => {
        editorWrapper.focus();

        // Use insertText command to paste the plain text
        document.execCommand('insertText', false, text);

        // After paste, extract the new content and update state/render
        // Use setTimeout to ensure DOM updates are complete
        setTimeout(() => {
            const newContent = getPlainTextContent();
            if (newContent !== state.currentContent) {
                state.setCurrentContent(newContent);
                updateContent(newContent);
                render();
            }
        }, 0);
    }).catch(() => {
        // Fallback if clipboard API fails
        editorWrapper.focus();
        document.execCommand('paste');

        // Still try to update after fallback paste
        setTimeout(() => {
            const newContent = getPlainTextContent();
            if (newContent !== state.currentContent) {
                state.setCurrentContent(newContent);
                updateContent(newContent);
                render();
            }
        }, 0);
    });
}

/**
 * Handle add comment from selection
 */
export function handleAddComment(): void {
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

    const range = selection.getRangeAt(0);
    const selectionInfo = getSelectionPosition(range);

    if (!selectionInfo) {
        alert('Could not determine selection position.');
        return;
    }

    state.setPendingSelection({
        ...selectionInfo,
        selectedText
    });

    const rect = range.getBoundingClientRect();
    showFloatingPanel(rect, selectedText);
}

/**
 * Handle add comment from context menu
 */
function handleAddCommentFromContextMenu(): void {
    const saved = state.savedSelectionForContextMenu;
    if (!saved) {
        alert('Please select some text first to add a comment.');
        return;
    }

    state.setPendingSelection({
        startLine: saved.startLine,
        startColumn: saved.startColumn,
        endLine: saved.endLine,
        endColumn: saved.endColumn,
        selectedText: saved.selectedText
    });

    showFloatingPanel(saved.rect, saved.selectedText);
    state.setSavedSelectionForContextMenu(null);
}

/**
 * Handle predefined comment from context menu
 * Opens the floating panel with the predefined text pre-filled
 * @param predefinedText - The predefined text to pre-fill in the comment input
 */
function handlePredefinedCommentFromContextMenu(predefinedText: string): void {
    const saved = state.savedSelectionForContextMenu;
    if (!saved) {
        alert('Please select some text first to add a comment.');
        return;
    }

    state.setPendingSelection({
        startLine: saved.startLine,
        startColumn: saved.startColumn,
        endLine: saved.endLine,
        endColumn: saved.endColumn,
        selectedText: saved.selectedText
    });

    showFloatingPanel(saved.rect, saved.selectedText, predefinedText);
    state.setSavedSelectionForContextMenu(null);
}

/**
 * Handle "Ask AI" from context menu with a specific command ID
 * Extracts document context and sends to extension for AI clarification
 * @param commandId - The command ID from the AI command registry
 * @param customInstruction - Optional custom instruction text (for custom input commands)
 */
function handleAskAIFromContextMenu(
    commandId: string,
    customInstruction?: string
): void {
    const saved = state.savedSelectionForContextMenu;
    if (!saved || !saved.selectedText) {
        alert('Please select some text first to ask AI.');
        return;
    }

    // Extract document context for the AI
    const baseContext = extractDocumentContext(saved.startLine, saved.endLine, saved.selectedText);

    // Add command ID (as instructionType for backward compatibility) and optional custom instruction
    const context = {
        ...baseContext,
        instructionType: commandId,
        customInstruction
    };

    // Send to extension
    requestAskAI(context);

    // Clear saved selection
    state.setSavedSelectionForContextMenu(null);
}

/**
 * Extract document context for AI clarification
 * Gathers headings, surrounding content, and selection info
 * 
 * @param startLine - Selection start line (1-based)
 * @param endLine - Selection end line (1-based)
 * @param selectedText - The selected text
 * @returns Context object for AI clarification
 */
function extractDocumentContext(startLine: number, endLine: number, selectedText: string): {
    selectedText: string;
    startLine: number;
    endLine: number;
    surroundingLines: string;
    nearestHeading: string | null;
    allHeadings: string[];
} {
    const content = state.currentContent;
    const lines = content.split('\n');

    // Extract all markdown headings from the document
    const allHeadings: string[] = [];
    let nearestHeading: string | null = null;
    let nearestHeadingLine = 0;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Match markdown headings (# Heading, ## Heading, etc.)
        const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
        if (headingMatch) {
            const headingText = headingMatch[2].trim();
            allHeadings.push(headingText);

            // Track nearest heading above selection
            if (i + 1 <= startLine && i + 1 > nearestHeadingLine) {
                nearestHeading = headingText;
                nearestHeadingLine = i + 1;
            }
        }
    }

    // Extract surrounding lines (5 lines before and after the selection)
    const contextRadius = 5;
    const contextStartLine = Math.max(0, startLine - 1 - contextRadius);
    const contextEndLine = Math.min(lines.length, endLine + contextRadius);

    const surroundingLines: string[] = [];
    for (let i = contextStartLine; i < contextEndLine; i++) {
        // Skip the selected lines themselves to avoid duplication
        if (i >= startLine - 1 && i < endLine) {
            continue;
        }
        surroundingLines.push(lines[i]);
    }

    return {
        selectedText,
        startLine,
        endLine,
        surroundingLines: surroundingLines.join('\n'),
        nearestHeading,
        allHeadings
    };
}

/**
 * Setup event listeners for the custom instruction dialog
 */
function setupCustomInstructionDialogEventListeners(): void {
    customInstructionClose.addEventListener('click', hideCustomInstructionDialog);
    customInstructionCancelBtn.addEventListener('click', hideCustomInstructionDialog);

    customInstructionSubmitBtn.addEventListener('click', () => {
        const instruction = customInstructionInput.value.trim();
        if (!instruction) {
            customInstructionInput.focus();
            return;
        }
        hideCustomInstructionDialog();
        // Use the pending command ID (set when custom input command was clicked)
        handleAskAIFromContextMenu(pendingCustomCommandId, instruction);
    });

    // Submit on Ctrl+Enter
    customInstructionInput.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            customInstructionSubmitBtn.click();
        }
        // Close on Escape
        if (e.key === 'Escape') {
            hideCustomInstructionDialog();
        }
    });
}

/**
 * Show the custom instruction dialog
 */
function showCustomInstructionDialog(): void {
    const saved = state.savedSelectionForContextMenu;
    if (!saved || !saved.selectedText) {
        alert('Please select some text first to ask AI.');
        return;
    }
    
    // Create and show overlay
    customInstructionOverlay = document.createElement('div');
    customInstructionOverlay.className = 'custom-instruction-overlay';
    customInstructionOverlay.addEventListener('click', hideCustomInstructionDialog);
    document.body.appendChild(customInstructionOverlay);
    
    // Show selected text preview (truncated if needed)
    const truncatedText = saved.selectedText.length > 100 
        ? saved.selectedText.substring(0, 100) + '...' 
        : saved.selectedText;
    customInstructionSelection.textContent = truncatedText;
    
    // Clear previous input and show dialog
    customInstructionInput.value = '';
    customInstructionDialog.style.display = 'block';
    
    // Focus the input
    setTimeout(() => customInstructionInput.focus(), 50);
}

/**
 * Hide the custom instruction dialog
 */
function hideCustomInstructionDialog(): void {
    customInstructionDialog.style.display = 'none';
    
    // Remove overlay if exists
    if (customInstructionOverlay) {
        customInstructionOverlay.remove();
        customInstructionOverlay = null;
    }
}

/**
 * Handle selection change in editor
 */
function handleSelectionChange(): void {
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed) {
        const text = selection.toString().trim();
        if (text.length > 0) {
            // Could show a hint for adding comment (optional enhancement)
        }
    }
}

/**
 * Handle triple-click to select the full logical line.
 * This ensures that even with word wrap, the entire line is selected.
 */
function handleTripleClick(e: MouseEvent): void {
    // detail === 3 indicates triple-click
    if (e.detail !== 3) return;

    const target = e.target as HTMLElement;

    // Find the line-content element that contains the click
    const lineContent = target.closest('.line-content') as HTMLElement;
    if (!lineContent) {
        // Also check for code block lines
        const codeLine = target.closest('.code-line') as HTMLElement;
        if (codeLine) {
            selectFullLine(codeLine);
            e.preventDefault();
        }
        return;
    }

    selectFullLine(lineContent);
    e.preventDefault();
}

/**
 * Select the full text content of a line element.
 * Excludes UI elements like comment bubbles and gutter icons.
 */
function selectFullLine(lineElement: HTMLElement): void {
    const selection = window.getSelection();
    if (!selection) return;

    // Create a range that spans the entire line content
    const range = document.createRange();

    // Find the first and last text nodes in the line, excluding UI elements
    let firstTextNode: Text | null = null;
    let lastTextNode: Text | null = null;

    const walker = document.createTreeWalker(
        lineElement,
        NodeFilter.SHOW_TEXT,
        {
            acceptNode: (node) => {
                const parent = node.parentElement;
                // Skip nodes inside comment bubbles, gutter icons, etc.
                if (parent && parent.closest('.inline-comment-bubble, .gutter-icon')) {
                    return NodeFilter.FILTER_REJECT;
                }
                // Skip empty text nodes
                if (!node.textContent || node.textContent.length === 0) {
                    return NodeFilter.FILTER_REJECT;
                }
                return NodeFilter.FILTER_ACCEPT;
            }
        }
    );

    let node: Text | null;
    while ((node = walker.nextNode() as Text | null)) {
        if (!firstTextNode) {
            firstTextNode = node;
        }
        lastTextNode = node;
    }

    if (firstTextNode && lastTextNode) {
        range.setStart(firstTextNode, 0);
        range.setEnd(lastTextNode, lastTextNode.length);
    } else {
        // Fallback: select the entire element content
        range.selectNodeContents(lineElement);
    }

    selection.removeAllRanges();
    selection.addRange(range);
}

/**
 * Handle editor input changes
 */
function handleEditorInput(): void {
    const newContent = getPlainTextContent();
    console.log('[Webview] handleEditorInput - extracted content length:', newContent.length);
    console.log('[Webview] handleEditorInput - current state content length:', state.currentContent.length);
    console.log('[Webview] handleEditorInput - content changed:', newContent !== state.currentContent);
    if (newContent !== state.currentContent) {
        // Debug: show first 200 chars of old and new content
        console.log('[Webview] OLD content preview:', state.currentContent.substring(0, 200));
        console.log('[Webview] NEW content preview:', newContent.substring(0, 200));
        state.setCurrentContent(newContent);
        updateContent(newContent);
    }
}

/**
 * Handle editor keydown events
 */
function handleEditorKeydown(e: KeyboardEvent): void {
    if (e.key === 'Tab') {
        e.preventDefault();
        handleTabKey(e.shiftKey);
    } else if (e.key === 'Enter' && !e.shiftKey) {
        // Handle Enter key explicitly to prevent browser from creating
        // DOM elements that break the flex layout in line-row containers.
        // The browser's default behavior creates <div> elements that become
        // flex siblings, causing text to appear side-by-side instead of on new lines.
        e.preventDefault();
        handleEnterKey();
    } else if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        // Handle Ctrl+S / Cmd+S to save without cursor reset
        e.preventDefault();
        handleSaveKey();
    }
}

/**
 * Handle Tab/Shift+Tab key for indentation
 * Supports multi-line selection for bulk indent/outdent
 */
function handleTabKey(isShiftKey: boolean): void {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;

    const range = selection.getRangeAt(0);
    const selectionInfo = getSelectionPosition(range);

    if (!selectionInfo) {
        // Fallback: simple tab insertion
        if (!isShiftKey) {
            document.execCommand('insertText', false, '    ');
        }
        return;
    }

    const lines = state.currentContent.split('\n');
    const startLineIdx = selectionInfo.startLine - 1;
    const endLineIdx = selectionInfo.endLine - 1;
    const startCol = selectionInfo.startColumn - 1;
    const endCol = selectionInfo.endColumn - 1;

    // Check if we have a multi-line selection or cursor is at the start of line
    const isMultiLine = startLineIdx !== endLineIdx;
    const isAtLineStart = startCol === 0;
    const hasSelection = !range.collapsed;

    if (isMultiLine || (hasSelection && isAtLineStart)) {
        // Multi-line indent/outdent
        handleMultiLineIndent(lines, startLineIdx, endLineIdx, isShiftKey, selectionInfo);
    } else if (isShiftKey) {
        // Single line outdent at cursor position
        handleSingleLineOutdent(lines, startLineIdx, startCol);
    } else {
        // Single line indent: insert 4 spaces at cursor
        document.execCommand('insertText', false, '    ');
    }
}

/**
 * Handle multi-line indent/outdent
 */
function handleMultiLineIndent(
    lines: string[],
    startLineIdx: number,
    endLineIdx: number,
    isOutdent: boolean,
    selectionInfo: { startLine: number; startColumn: number; endLine: number; endColumn: number }
): void {
    const INDENT = '    '; // 4 spaces
    let modifiedLines = [...lines];
    let totalIndentChange = 0;
    let firstLineIndentChange = 0;
    let lastLineIndentChange = 0;

    for (let i = startLineIdx; i <= endLineIdx; i++) {
        if (i < 0 || i >= modifiedLines.length) continue;

        const line = modifiedLines[i];
        if (isOutdent) {
            // Remove up to 4 spaces or 1 tab from the beginning
            let removed = 0;
            if (line.startsWith('\t')) {
                modifiedLines[i] = line.substring(1);
                removed = 1;
            } else {
                // Remove up to 4 spaces
                let spacesToRemove = 0;
                for (let j = 0; j < 4 && j < line.length; j++) {
                    if (line[j] === ' ') {
                        spacesToRemove++;
                    } else {
                        break;
                    }
                }
                if (spacesToRemove > 0) {
                    modifiedLines[i] = line.substring(spacesToRemove);
                    removed = spacesToRemove;
                }
            }
            if (i === startLineIdx) firstLineIndentChange = -removed;
            if (i === endLineIdx) lastLineIndentChange = -removed;
            totalIndentChange -= removed;
        } else {
            // Add 4 spaces at the beginning
            modifiedLines[i] = INDENT + line;
            if (i === startLineIdx) firstLineIndentChange = 4;
            if (i === endLineIdx) lastLineIndentChange = 4;
            totalIndentChange += 4;
        }
    }

    // Update content
    const newContent = modifiedLines.join('\n');
    state.setCurrentContent(newContent);
    updateContent(newContent);

    // Re-render
    render();

    // Restore selection to cover the same lines (adjusted for indent changes)
    setTimeout(() => {
        const newStartCol = Math.max(0, (selectionInfo.startColumn - 1) + firstLineIndentChange);
        const newEndCol = Math.max(0, (selectionInfo.endColumn - 1) + lastLineIndentChange);
        restoreSelectionRange(selectionInfo.startLine, newStartCol, selectionInfo.endLine, newEndCol);
    }, 0);
}

/**
 * Handle single line outdent at cursor position
 */
function handleSingleLineOutdent(lines: string[], lineIdx: number, cursorCol: number): void {
    if (lineIdx < 0 || lineIdx >= lines.length) return;

    const line = lines[lineIdx];
    let removed = 0;

    // Remove up to 4 spaces or 1 tab from the beginning
    if (line.startsWith('\t')) {
        lines[lineIdx] = line.substring(1);
        removed = 1;
    } else {
        let spacesToRemove = 0;
        for (let j = 0; j < 4 && j < line.length; j++) {
            if (line[j] === ' ') {
                spacesToRemove++;
            } else {
                break;
            }
        }
        if (spacesToRemove > 0) {
            lines[lineIdx] = line.substring(spacesToRemove);
            removed = spacesToRemove;
        }
    }

    if (removed === 0) return; // Nothing to remove

    // Update content
    const newContent = lines.join('\n');
    state.setCurrentContent(newContent);
    updateContent(newContent);

    // Re-render
    render();

    // Restore cursor position (adjusted for removed characters)
    setTimeout(() => {
        const newCol = Math.max(0, cursorCol - removed);
        restoreCursorToPosition(lineIdx + 1, newCol);
    }, 0);
}

/**
 * Restore selection to a specific range after re-render
 */
function restoreSelectionRange(startLine: number, startCol: number, endLine: number, endCol: number): void {
    const startLineElement = editorWrapper.querySelector(`.line-content[data-line="${startLine}"]`);
    const endLineElement = editorWrapper.querySelector(`.line-content[data-line="${endLine}"]`);

    if (!startLineElement || !endLineElement) return;

    const startTarget = findTextNodeAtColumn(startLineElement as HTMLElement, startCol);
    const endTarget = findTextNodeAtColumn(endLineElement as HTMLElement, endCol);

    if (!startTarget || !endTarget) return;

    try {
        const range = document.createRange();
        range.setStart(startTarget.node, startTarget.offset);
        range.setEnd(endTarget.node, endTarget.offset);

        const selection = window.getSelection();
        if (selection) {
            selection.removeAllRanges();
            selection.addRange(range);
        }
    } catch (e) {
        console.warn('[Webview] Could not restore selection range:', e);
    }
}

/**
 * Handle Ctrl+S / Cmd+S save key
 * Saves content while preserving cursor position
 */
function handleSaveKey(): void {
    // Get current cursor position before any updates
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;

    const range = selection.getRangeAt(0);
    const selectionInfo = getSelectionPosition(range);

    // Extract current content and send update
    const newContent = getPlainTextContent();
    if (newContent !== state.currentContent) {
        state.setCurrentContent(newContent);
        updateContent(newContent);
    }

    // Mark that we're saving - the cursor position will be preserved
    // because we're not triggering a re-render here
    // The extension will apply the edit and the webviewEditUntil timestamp
    // will prevent re-rendering

    // If we did need to re-render, restore cursor position
    if (selectionInfo) {
        setTimeout(() => {
            if (range.collapsed) {
                restoreCursorToPosition(selectionInfo.startLine, selectionInfo.startColumn - 1);
            } else {
                restoreSelectionRange(
                    selectionInfo.startLine,
                    selectionInfo.startColumn - 1,
                    selectionInfo.endLine,
                    selectionInfo.endColumn - 1
                );
            }
        }, 0);
    }
}

/**
 * Handle Enter key by inserting a newline into the content and re-rendering.
 * This prevents the browser from creating DOM elements that break the layout.
 */
function handleEnterKey(): void {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;

    const range = selection.getRangeAt(0);
    const selectionInfo = getSelectionPosition(range);

    if (!selectionInfo) {
        // Fallback: try using execCommand if we can't determine position
        document.execCommand('insertText', false, '\n');
        return;
    }

    // Get current content and split into lines
    const lines = state.currentContent.split('\n');

    // Calculate the position to insert the newline
    // selectionInfo uses 1-based line numbers and 1-based columns
    const lineIndex = selectionInfo.startLine - 1;
    const columnIndex = selectionInfo.startColumn - 1;

    if (lineIndex < 0 || lineIndex >= lines.length) {
        // Invalid line, use fallback
        document.execCommand('insertText', false, '\n');
        return;
    }

    // If there's a selection (not collapsed), delete the selected text first
    if (selectionInfo.startLine !== selectionInfo.endLine ||
        selectionInfo.startColumn !== selectionInfo.endColumn) {
        // Handle selection deletion - for now, just delete and insert at start
        const startLineIdx = selectionInfo.startLine - 1;
        const endLineIdx = selectionInfo.endLine - 1;
        const startCol = selectionInfo.startColumn - 1;
        const endCol = selectionInfo.endColumn - 1;

        if (startLineIdx === endLineIdx) {
            // Single line selection
            const line = lines[startLineIdx];
            lines[startLineIdx] = line.substring(0, startCol) + line.substring(endCol);
        } else {
            // Multi-line selection
            const startLine = lines[startLineIdx];
            const endLine = lines[endLineIdx];
            lines[startLineIdx] = startLine.substring(0, startCol) + endLine.substring(endCol);
            lines.splice(startLineIdx + 1, endLineIdx - startLineIdx);
        }
    }

    // Now insert the newline at the cursor position
    const currentLine = lines[lineIndex] || '';
    const beforeCursor = currentLine.substring(0, columnIndex);
    const afterCursor = currentLine.substring(columnIndex);

    // Split the line at cursor position
    lines[lineIndex] = beforeCursor;
    lines.splice(lineIndex + 1, 0, afterCursor);

    // Calculate new cursor position (start of the new line)
    const newCursorLine = selectionInfo.startLine + 1;
    const newCursorColumn = 1;

    // Update content
    const newContent = lines.join('\n');
    state.setCurrentContent(newContent);
    updateContent(newContent);

    // Re-render and restore cursor
    render();

    // Restore cursor position to the new line
    setTimeout(() => {
        restoreCursorToPosition(newCursorLine, newCursorColumn - 1);
    }, 0);
}

/**
 * Restore cursor to a specific line and column position after re-render.
 */
function restoreCursorToPosition(line: number, column: number): void {
    const lineElement = editorWrapper.querySelector(`.line-content[data-line="${line}"]`);
    if (!lineElement) return;

    const target = findTextNodeAtColumn(lineElement as HTMLElement, column);
    if (!target) {
        // If no text node found, try to place cursor at start of line
        const range = document.createRange();
        range.selectNodeContents(lineElement);
        range.collapse(true);
        const selection = window.getSelection();
        if (selection) {
            selection.removeAllRanges();
            selection.addRange(range);
        }
        return;
    }

    try {
        const range = document.createRange();
        range.setStart(target.node, target.offset);
        range.collapse(true);

        const selection = window.getSelection();
        if (selection) {
            selection.removeAllRanges();
            selection.addRange(range);
        }
    } catch (e) {
        console.warn('[Webview] Could not restore cursor position:', e);
    }
}

/**
 * Find text node at a specific column position within a line element.
 */
function findTextNodeAtColumn(lineElement: HTMLElement, targetColumn: number): { node: Text; offset: number } | null {
    let currentOffset = 0;
    const walker = document.createTreeWalker(lineElement, NodeFilter.SHOW_TEXT, null);
    let currentNode: Text | null;
    let lastValidNode: Text | null = null;
    let lastValidNodeLength = 0;

    while ((currentNode = walker.nextNode() as Text | null)) {
        // Skip nodes in comment bubbles
        const parent = currentNode.parentElement;
        if (parent && parent.closest('.inline-comment-bubble, .gutter-icon')) {
            continue;
        }

        lastValidNode = currentNode;
        lastValidNodeLength = currentNode.length;

        if (currentOffset + currentNode.length >= targetColumn) {
            return {
                node: currentNode,
                offset: Math.min(targetColumn - currentOffset, currentNode.length)
            };
        }
        currentOffset += currentNode.length;
    }

    // If target is beyond content, return last node at end
    if (lastValidNode) {
        return {
            node: lastValidNode,
            offset: lastValidNodeLength
        };
    }

    return null;
}

/**
 * Check if an element should be skipped during content extraction.
 * Adapted from content-extraction module for browser DOM.
 */
function shouldSkipElement(el: HTMLElement): boolean {
    for (const cls of DEFAULT_SKIP_CLASSES) {
        if (el.classList.contains(cls)) {
            return true;
        }
    }
    return false;
}

/**
 * Check if an element is a block element.
 * Adapted from content-extraction module for browser DOM.
 */
function isBlockElement(el: HTMLElement): boolean {
    const tag = el.tagName.toLowerCase();
    if (tag === 'div' || tag === 'p') return true;
    if (el.classList.contains('line-row')) return true;
    if (el.classList.contains('block-row')) return true;
    return false;
}

/**
 * Check if BR is followed by meaningful content.
 * Adapted from content-extraction module for browser DOM.
 */
function hasMeaningfulContentAfterBr(el: HTMLElement): boolean {
    const nextSibling = el.nextSibling;
    if (!nextSibling) return false;

    if (nextSibling.nodeType === Node.TEXT_NODE) {
        const text = nextSibling.textContent?.trim();
        return Boolean(text && text.length > 0);
    }
    if (nextSibling.nodeType === Node.ELEMENT_NODE) {
        return true;
    }
    return false;
}

/**
 * Extract text from block content (code blocks, tables).
 * Adapted from content-extraction module for browser DOM.
 */
function extractBlockText(el: HTMLElement): string {
    // Check if this is a code block container
    const codeBlockEl = el.querySelector('.code-block');
    if (codeBlockEl) {
        // Extract language from the code element class (language-{lang}) or code-language span
        let language = 'text';
        const codeEl = codeBlockEl.querySelector('code');
        if (codeEl) {
            // Try to get language from class like "language-typescript" or "hljs language-typescript"
            const langMatch = codeEl.className.match(/language-(\w+)/);
            if (langMatch) {
                language = langMatch[1];
            }
        }
        // Fallback: try the code-language span
        if (language === 'text') {
            const langSpan = codeBlockEl.querySelector('.code-language');
            if (langSpan && langSpan.textContent) {
                language = langSpan.textContent.trim().toLowerCase();
            }
        }

        // Get the code content - try the data-code attribute first (most reliable)
        // The copy button stores the original code in a data-code attribute
        const copyBtn = codeBlockEl.querySelector('.code-copy-btn') as HTMLElement;

        // Don't include 'plaintext' in the code fence - it's our default for blocks without a language
        const fenceLanguage = language === 'plaintext' ? '' : language;

        if (copyBtn && copyBtn.dataset.code) {
            const codeContent = decodeURIComponent(copyBtn.dataset.code);
            return '```' + fenceLanguage + '\n' + codeContent + '\n```';
        }

        // Fallback: extract from code-line spans (preserving line breaks)
        const codeLines = codeBlockEl.querySelectorAll('.code-line');
        if (codeLines.length > 0) {
            const lines: string[] = [];
            codeLines.forEach(lineEl => {
                // Get text content, handling &nbsp; placeholder for empty lines
                let lineText = lineEl.textContent || '';
                if (lineText === '\u00a0') {
                    lineText = '';
                }
                lines.push(lineText);
            });
            return '```' + fenceLanguage + '\n' + lines.join('\n') + '\n```';
        }

        // Last fallback: just get textContent (may lose line breaks)
        const codeContent = codeEl?.textContent || '';
        return '```' + fenceLanguage + '\n' + codeContent + '\n```';
    }

    // Check for mermaid diagram container
    const mermaidEl = el.querySelector('.mermaid-container');
    if (mermaidEl) {
        // Get mermaid source from the hidden source element
        const sourceEl = mermaidEl.querySelector('.mermaid-source code');
        if (sourceEl) {
            const mermaidContent = sourceEl.textContent || '';
            return '```mermaid\n' + mermaidContent + '\n```';
        }
    }

    // For pre/code blocks (fallback for any other pre elements)
    const preElement = el.querySelector('pre');
    if (preElement) {
        const codeEl = preElement.querySelector('code') || preElement;
        // Try to extract from code-line spans first
        const codeLines = preElement.querySelectorAll('.code-line');
        if (codeLines.length > 0) {
            const lines: string[] = [];
            codeLines.forEach(lineEl => {
                let lineText = lineEl.textContent || '';
                if (lineText === '\u00a0') {
                    lineText = '';
                }
                lines.push(lineText);
            });
            // Try to detect language from code element class
            let language = '';
            if (codeEl.className) {
                const langMatch = codeEl.className.match(/language-(\w+)/);
                if (langMatch && langMatch[1] !== 'plaintext') {
                    language = langMatch[1];
                }
            }
            return '```' + language + '\n' + lines.join('\n') + '\n```';
        }

        const codeContent = codeEl.textContent || '';
        // Try to detect language from code element class
        let language = '';
        if (codeEl.className) {
            const langMatch = codeEl.className.match(/language-(\w+)/);
            if (langMatch && langMatch[1] !== 'plaintext') {
                language = langMatch[1];
            }
        }
        return '```' + language + '\n' + codeContent + '\n```';
    }

    // For tables, try to reconstruct markdown table format
    const tableEl = el.querySelector('table');
    if (tableEl) {
        const rows: string[] = [];
        tableEl.querySelectorAll('tr').forEach((tr, rowIndex) => {
            const cells: string[] = [];
            tr.querySelectorAll('th, td').forEach(cell => {
                cells.push((cell.textContent || '').trim());
            });
            rows.push('| ' + cells.join(' | ') + ' |');
            // Add separator row after header
            if (rowIndex === 0) {
                rows.push('| ' + cells.map(() => '---').join(' | ') + ' |');
            }
        });
        return rows.join('\n');
    }

    // Fallback: just get text content
    return el.textContent || '';
}

/**
 * Get plain text content from editor.
 * Uses content-extraction module logic adapted for browser DOM.
 * Handles contenteditable DOM mutations (br tags, div elements, etc.)
 */
function getPlainTextContent(): string {
    const context: ExtractionContext = {
        lines: [],
        insideLineContent: false,
        skipClasses: DEFAULT_SKIP_CLASSES
    };

    /**
     * Process a node and extract text content.
     * Adapted from content-extraction module for browser DOM.
     */
    function processNode(node: Node, isFirstChild: boolean = false): void {
        // Handle text nodes
        if (node.nodeType === Node.TEXT_NODE) {
            const text = node.textContent || '';
            if (context.lines.length === 0) {
                context.lines.push(text);
            } else {
                context.lines[context.lines.length - 1] += text;
            }
            return;
        }

        // Handle element nodes
        if (node.nodeType !== Node.ELEMENT_NODE) {
            return;
        }

        const el = node as HTMLElement;
        const tag = el.tagName.toLowerCase();

        // Skip elements that should be ignored
        if (shouldSkipElement(el)) {
            return;
        }

        // Handle BR elements
        if (tag === 'br') {
            if (!context.insideLineContent) {
                context.lines.push('');
            } else if (hasMeaningfulContentAfterBr(el)) {
                context.lines.push('');
            }
            return;
        }

        // Handle line-content elements (our rendered lines)
        if (el.classList.contains('line-content') && el.hasAttribute('data-line')) {
            if (context.lines.length === 0 ||
                context.lines[context.lines.length - 1] !== '' ||
                !isFirstChild) {
                context.lines.push('');
            }

            const wasInsideLineContent = context.insideLineContent;
            context.insideLineContent = true;

            let childIndex = 0;
            el.childNodes.forEach(child => {
                processNode(child, childIndex === 0);
                childIndex++;
            });

            context.insideLineContent = wasInsideLineContent;
            return;
        }

        // Handle line-row elements (just process children)
        if (el.classList.contains('line-row') || el.classList.contains('block-row')) {
            let childIndex = 0;
            el.childNodes.forEach(child => {
                processNode(child, childIndex === 0);
                childIndex++;
            });
            return;
        }

        // Handle block-content elements (code blocks, tables)
        if (el.classList.contains('block-content')) {
            const blockText = extractBlockText(el);
            if (blockText) {
                const blockLines = blockText.split('\n');
                blockLines.forEach((line, idx) => {
                    if (idx === 0 && context.lines.length > 0 &&
                        context.lines[context.lines.length - 1] === '') {
                        context.lines[context.lines.length - 1] = line;
                    } else {
                        context.lines.push(line);
                    }
                });
            }
            return;
        }

        // Handle other block elements (div, p created by contenteditable)
        if (isBlockElement(el)) {
            if (context.insideLineContent) {
                if (context.lines.length > 0 &&
                    context.lines[context.lines.length - 1] !== '') {
                    context.lines.push('');
                }
            } else if (context.lines.length > 0 &&
                context.lines[context.lines.length - 1] !== '' &&
                !isFirstChild) {
                context.lines.push('');
            }
        }

        // Process children for all other elements
        let childIndex = 0;
        el.childNodes.forEach(child => {
            processNode(child, childIndex === 0);
            childIndex++;
        });
    }

    processNode(editorWrapper, true);

    // Post-process: strip editor placeholder artifacts (e.g. NBSP for empty lines)
    return context.lines.map(normalizeExtractedLine).join('\n');
}

/**
 * Setup comment interaction handlers (called after render)
 */
export function setupCommentInteractions(): void {
    // Click on commented text to show bubble
    document.querySelectorAll('.commented-text').forEach(el => {
        el.addEventListener('click', (e) => {
            e.stopPropagation();
            const commentId = (el as HTMLElement).dataset.commentId;
            const comment = state.findCommentById(commentId || '');
            if (comment) {
                showCommentBubble(comment, el as HTMLElement);
            }
        });
    });

    // Click on gutter icon
    document.querySelectorAll('.gutter-icon').forEach(icon => {
        icon.addEventListener('click', (e) => {
            e.stopPropagation();
            const lineRow = (icon as HTMLElement).closest('.line-row');
            const lineContentEl = lineRow?.querySelector('.line-content[data-line]') as HTMLElement;
            const lineNum = lineContentEl ? parseInt(lineContentEl.getAttribute('data-line') || '', 10) : null;

            if (!lineNum) return;

            const lineComments = state.comments.filter(c =>
                c.selection.startLine === lineNum &&
                (state.settings.showResolved || c.status !== 'resolved')
            );

            if (lineComments.length > 0) {
                const lineEl = editorWrapper.querySelector('[data-line="' + lineNum + '"]') as HTMLElement;
                if (lineEl) {
                    showCommentBubble(lineComments[0], lineEl);
                }
            }
        });
    });

    // Ctrl+Click on markdown links to open workspace files
    document.querySelectorAll('.md-link').forEach(linkEl => {
        linkEl.addEventListener('click', (e) => {
            const mouseEvent = e as MouseEvent;
            // Check for Ctrl (Windows/Linux) or Meta/Cmd (Mac)
            if (mouseEvent.ctrlKey || mouseEvent.metaKey) {
                e.preventDefault();
                e.stopPropagation();

                // Extract the URL from the link
                const urlSpan = linkEl.querySelector('.md-link-url');
                if (urlSpan) {
                    // The URL is wrapped in parentheses, e.g., "(path/to/file.md)"
                    const urlText = urlSpan.textContent || '';
                    // Remove the surrounding parentheses
                    const url = urlText.replace(/^\(|\)$/g, '');

                    if (url) {
                        // Send message to extension to open the file
                        openFile(url);
                    }
                }
            }
        });

        // Add visual hint that links are ctrl+clickable
        (linkEl as HTMLElement).title = 'Ctrl+Click to open file';
    });
}

