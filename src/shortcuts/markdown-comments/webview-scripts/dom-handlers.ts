/**
 * DOM event handlers for the webview
 * 
 * Uses content-extraction module for extracting plain text from the contenteditable editor.
 * Uses shared context menu module for consistent context menu behavior.
 */

import {
    DEFAULT_SKIP_CLASSES,
    ExtractionContext,
    normalizeExtractedLine
} from '../webview-logic/content-extraction';
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
import { AICommandMode, PromptFileInfo, RecentPrompt, SkillInfo } from './types';
import { openFile, requestAskAI, requestAskAIInteractive, requestCopyPrompt, requestDeleteAll, requestExecuteWorkPlan, requestExecuteWorkPlanWithSkill, requestPromptFiles, requestPromptSearch, requestRefreshPlan, requestResolveAll, requestSendToChat, requestSendToCLIBackground, requestSendToCLIInteractive, requestSkills, requestUpdateDocument, updateContent } from './vscode-bridge';
import { DEFAULT_MARKDOWN_PREDEFINED_COMMENTS, serializePredefinedComments } from '../../shared/predefined-comment-types';
import { initSearch, SearchController } from '../../shared/webview/search-handler';
import {
    ContextMenuManager,
    CustomInstructionDialog,
    ContextMenuSelection,
    getAIMenuConfig,
    getPredefinedComments as getSharedPredefinedComments,
    SerializedPredefinedComment
} from '../../shared/webview';

// DOM element references
let editorWrapper: HTMLElement;
let showResolvedCheckbox: HTMLInputElement;

// Shared context menu manager
let contextMenuManager: ContextMenuManager | null = null;

// Shared custom instruction dialog
let customInstructionDialog: CustomInstructionDialog | null = null;

// Search controller
let searchController: SearchController | null = null;

/**
 * Initialize DOM handlers
 */
export function initDomHandlers(): void {
    editorWrapper = document.getElementById('editorWrapper')!;
    showResolvedCheckbox = document.getElementById('showResolvedCheckbox') as HTMLInputElement;

    // Initialize shared context menu manager with rich menu items and preview tooltips
    contextMenuManager = new ContextMenuManager(
        {
            enableClipboardItems: true,
            enablePreviewTooltips: true,
            minWidth: 220,
            borderRadius: 8,
            richMenuItems: true
        },
        {
            onCut: handleCut,
            onCopy: handleCopy,
            onPaste: handlePaste,
            onAddComment: handleAddCommentFromContextMenu,
            onPredefinedComment: handlePredefinedCommentFromContextMenu,
            onAskAI: handleAICommandClick,
            onPromptFileSelected: handlePromptFileSelected,
            onSkillSelected: handleSkillSelected,
            onRequestPromptFiles: handleRequestPromptFilesForContextMenu,
            onRequestSkills: handleRequestSkillsForContextMenu,
            onActionItemSelected: handleActionItemSelected,
            onRequestActionItems: () => requestPromptFiles(),  // returns both prompts and skills
            onHide: () => {
                // Clear saved selection when menu is hidden
            }
        }
    );
    contextMenuManager.init();

    // Initialize shared custom instruction dialog
    customInstructionDialog = new CustomInstructionDialog(
        {
            title: '🤖 Custom AI Instruction',
            placeholder: "Enter your instruction for the AI (e.g., 'Explain the security implications')",
            submitLabel: 'Ask AI',
            cancelLabel: 'Cancel'
        },
        {
            onSubmit: (instruction, commandId, mode, promptFilePath, skillName) => {
                handleAskAIFromContextMenu(commandId, instruction, mode, promptFilePath, skillName);
            }
        }
    );
    customInstructionDialog.init();

    setupToolbarEventListeners();
    setupEditorEventListeners();
    setupContextMenuEventListeners();
    setupKeyboardEventListeners();
    setupGlobalEventListeners();
    
    // Initialize search functionality (Ctrl+F)
    searchController = initSearch('#editorWrapper');

    // Build initial AI submenu with default commands
    rebuildAISubmenu();

    // Build initial predefined comments submenu
    rebuildPredefinedSubmenu();
}

/**
 * Rebuild both AI submenus based on current settings
 * Uses the shared ContextMenuManager
 */
export function rebuildAISubmenu(): void {
    if (!contextMenuManager) return;
    contextMenuManager.rebuildAISubmenus(state.settings.aiMenuConfig);
}

/**
 * Format a timestamp as relative time (e.g., "2 hours ago", "yesterday")
 */
function formatRelativeTime(timestamp: number): string {
    const now = Date.now();
    const diff = now - timestamp;
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (seconds < 60) {
        return 'just now';
    } else if (minutes < 60) {
        return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
    } else if (hours < 24) {
        return `${hours} hour${hours === 1 ? '' : 's'} ago`;
    } else if (days === 1) {
        return 'yesterday';
    } else if (days < 7) {
        return `${days} days ago`;
    } else {
        return new Date(timestamp).toLocaleDateString();
    }
}

/**
 * Update the Execute Work Plan submenu with available prompt files and skills
 * @param promptFiles - Array of prompt file info from the extension
 * @param recentPrompts - Optional array of recent prompts for quick access
 * @param skills - Optional array of skills from .github/skills/
 */
export function updateExecuteWorkPlanSubmenu(promptFiles: PromptFileInfo[], recentPrompts?: RecentPrompt[], skills?: SkillInfo[]): void {
    const submenu = document.getElementById('executeWorkPlanSubmenu');
    if (!submenu) return;

    // Clear existing content
    submenu.innerHTML = '';

    const hasPrompts = promptFiles.length > 0;
    const hasSkills = skills && skills.length > 0;

    if (!hasPrompts && !hasSkills) {
        // Show "No prompts found" message
        const noPromptsItem = document.createElement('div');
        noPromptsItem.className = 'ai-action-menu-item ai-action-disabled';
        noPromptsItem.innerHTML = `
            <span class="ai-action-icon">📭</span>
            <span class="ai-action-label">No .prompt.md files found</span>
        `;
        submenu.appendChild(noPromptsItem);

        // Add help text
        const helpItem = document.createElement('div');
        helpItem.className = 'ai-action-menu-item ai-action-help';
        helpItem.innerHTML = `
            <span class="ai-action-icon">💡</span>
            <span class="ai-action-label">Add prompts to .github/prompts/</span>
        `;
        submenu.appendChild(helpItem);
        return;
    }

    // Add recent section if we have recent prompts
    if (recentPrompts && recentPrompts.length > 0) {
        // Filter recent prompts to only include those still in promptFiles
        const validRecent = recentPrompts.filter(r =>
            promptFiles.some(p => p.absolutePath === r.absolutePath)
        ).slice(0, 3);

        if (validRecent.length > 0) {
            const header = document.createElement('div');
            header.className = 'ai-action-menu-header';
            header.textContent = '⭐ Recent';
            submenu.appendChild(header);

            for (const recent of validRecent) {
                const item = document.createElement('div');
                item.className = 'ai-action-menu-item';
                item.dataset.promptPath = recent.absolutePath;
                item.innerHTML = `
                    <span class="ai-action-icon">📝</span>
                    <span class="ai-action-label">${escapeHtml(recent.name)}</span>
                `;
                item.title = `${recent.relativePath} (${formatRelativeTime(recent.lastUsed)})`;

                // Add click handler
                item.addEventListener('click', (e) => {
                    e.stopPropagation();
                    hideAIActionMenu();
                    requestExecuteWorkPlan(recent.absolutePath);
                });

                submenu.appendChild(item);
            }

            // Add divider
            const divider = document.createElement('div');
            divider.className = 'ai-action-menu-divider';
            submenu.appendChild(divider);
        }
    }

    // Add search option
    const searchItem = document.createElement('div');
    searchItem.className = 'ai-action-menu-item';
    searchItem.innerHTML = `
        <span class="ai-action-icon">🔍</span>
        <span class="ai-action-label">Search All Prompts...</span>
    `;
    searchItem.title = 'Open Quick Pick to search prompts';
    searchItem.addEventListener('click', (e) => {
        e.stopPropagation();
        hideAIActionMenu();
        requestPromptSearch();
    });
    submenu.appendChild(searchItem);

    // Add divider before all prompts
    if (hasPrompts) {
        const divider = document.createElement('div');
        divider.className = 'ai-action-menu-divider';
        submenu.appendChild(divider);
    }

    // Group prompt files by source folder
    const groupedFiles = new Map<string, PromptFileInfo[]>();
    for (const file of promptFiles) {
        const group = groupedFiles.get(file.sourceFolder) || [];
        group.push(file);
        groupedFiles.set(file.sourceFolder, group);
    }

    // Add prompt files to submenu
    let isFirstGroup = true;
    for (const [sourceFolder, files] of groupedFiles) {
        // Add separator between groups (except for the first group)
        if (!isFirstGroup) {
            const divider = document.createElement('div');
            divider.className = 'ai-action-menu-divider';
            submenu.appendChild(divider);
        }
        isFirstGroup = false;

        // Add group header if there are multiple groups
        if (groupedFiles.size > 1) {
            const header = document.createElement('div');
            header.className = 'ai-action-menu-header';
            header.textContent = sourceFolder;
            submenu.appendChild(header);
        }

        // Add each prompt file as a menu item
        for (const file of files) {
            const item = document.createElement('div');
            item.className = 'ai-action-menu-item';
            item.dataset.promptPath = file.absolutePath;
            item.innerHTML = `
                <span class="ai-action-icon">📝</span>
                <span class="ai-action-label">${escapeHtml(file.name)}</span>
            `;
            item.title = file.relativePath;

            // Add click handler
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                hideAIActionMenu();
                requestExecuteWorkPlan(file.absolutePath);
            });

            submenu.appendChild(item);
        }
    }

    // Add skills inline after prompts (with 🎯 icon to distinguish)
    if (hasSkills) {
        // Add divider before skills only if we have both prompts and multiple source folders
        // otherwise skills just appear after prompts with no extra header (they're visually distinct via icon)
        if (hasPrompts && groupedFiles.size > 1) {
            const divider = document.createElement('div');
            divider.className = 'ai-action-menu-divider';
            submenu.appendChild(divider);

            // Add skills header for clarity when there are multiple prompt groups
            const header = document.createElement('div');
            header.className = 'ai-action-menu-header';
            header.textContent = '🎯 Skills';
            submenu.appendChild(header);
        } else if (hasPrompts) {
            // Just add a simple divider when there's only one prompt group
            const divider = document.createElement('div');
            divider.className = 'ai-action-menu-divider';
            submenu.appendChild(divider);
        }

        // Add each skill as a menu item (interleaved with prompts at same level)
        for (const skill of skills!) {
            const item = document.createElement('div');
            item.className = 'ai-action-menu-item';
            item.dataset.skillName = skill.name;
            item.innerHTML = `
                <span class="ai-action-icon">🎯</span>
                <span class="ai-action-label">${escapeHtml(skill.name)}</span>
            `;
            item.title = skill.description || skill.relativePath;

            // Add click handler
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                hideAIActionMenu();
                requestExecuteWorkPlanWithSkill(skill.name);
            });

            submenu.appendChild(item);
        }
    }
}

/**
 * Escape HTML special characters to prevent XSS
 */
function escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
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
 * Uses the shared ContextMenuManager
 */
export function rebuildPredefinedSubmenu(): void {
    if (!contextMenuManager) return;
    contextMenuManager.rebuildPredefinedSubmenu(getPredefinedComments());
}

/**
 * Handle click on an AI command in the submenu
 */
function handleAICommandClick(commandId: string, isCustomInput: boolean, mode: AICommandMode): void {
    if (isCustomInput) {
        const saved = state.savedSelectionForContextMenu;
        if (saved && saved.selectedText && customInstructionDialog) {
            customInstructionDialog.show(saved.selectedText, commandId, mode);
        }
    } else {
        handleAskAIFromContextMenu(commandId, undefined, mode);
    }
}

/**
 * Handle prompt file selection from context menu
 * Opens custom instruction dialog with the prompt file as context
 */
function handlePromptFileSelected(promptFilePath: string): void {
    const saved = state.savedSelectionForContextMenu;
    if (saved && saved.selectedText && customInstructionDialog) {
        // Get the file name from the path for display
        const fileName = promptFilePath.split(/[/\\]/).pop() || 'prompt file';
        // Update dialog title to show the prompt file
        customInstructionDialog.updateTitle(`🤖 Custom Instruction with ${fileName}`);
        customInstructionDialog.show(saved.selectedText, 'custom', 'comment');
        // Store the prompt file path in the dialog's data for use on submit
        customInstructionDialog.setPromptFilePath(promptFilePath);
    }
}

/**
 * Handle skill selection from context menu
 * Opens custom instruction dialog with the skill as context
 */
function handleSkillSelected(skillName: string, _skillPath: string): void {
    const saved = state.savedSelectionForContextMenu;
    if (saved && saved.selectedText && customInstructionDialog) {
        // Update dialog title to show the skill
        customInstructionDialog.updateTitle(`🤖 Custom Instruction with Skill: ${skillName}`);
        customInstructionDialog.show(saved.selectedText, 'custom', 'comment');
        // Store the skill name in the dialog's data for use on submit
        customInstructionDialog.setSkillName(skillName);
    }
}

/**
 * Handle request for prompt files (for context menu submenu)
 */
function handleRequestPromptFilesForContextMenu(): void {
    requestPromptFiles();
}

/**
 * Handle request for skills (for context menu submenu)
 */
function handleRequestSkillsForContextMenu(): void {
    requestSkills();
}

/**
 * Handle action item selection from combined submenu (prompts + skills)
 * @param type - 'prompt' or 'skill'
 * @param path - The absolute path to the prompt file or skill
 * @param name - The name of the prompt or skill
 */
function handleActionItemSelected(type: 'prompt' | 'skill', path: string, name: string): void {
    if (type === 'prompt') {
        handlePromptFileSelected(path);
    } else {
        handleSkillSelected(name, path);
    }
}

/**
 * Update the prompt file submenu with available files
 * Called when the extension sends back the list of prompt files
 */
export function updatePromptFileSubmenu(promptFiles: PromptFileInfo[]): void {
    if (contextMenuManager) {
        contextMenuManager.setPromptFiles(promptFiles);
    }
}

/**
 * Update the skills submenu with available skills
 * Called when the extension sends back the list of skills
 */
export function updateSkillSubmenu(skills: SkillInfo[]): void {
    if (contextMenuManager) {
        contextMenuManager.setSkills(skills);
    }
}

/**
 * Update the combined action items submenu (prompts + skills)
 * Called when the extension sends back both prompts and skills
 */
export function updateActionItemsSubmenu(promptFiles: PromptFileInfo[], skills: SkillInfo[]): void {
    if (contextMenuManager) {
        contextMenuManager.setActionItems(promptFiles, skills);
    }
}

/**
 * Setup toolbar event listeners
 */
function setupToolbarEventListeners(): void {
    // Comments dropdown (contains Resolve All and Sign Off)
    setupCommentsDropdown();

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
 * Setup Comments dropdown menu handlers
 */
function setupCommentsDropdown(): void {
    const commentsDropdown = document.getElementById('commentsDropdown');
    const commentsBtn = document.getElementById('commentsBtn');
    const commentsMenu = document.getElementById('commentsMenu');
    const resolveAllBtn = document.getElementById('resolveAllBtn');
    const deleteAllBtn = document.getElementById('deleteAllBtn');

    if (!commentsDropdown || !commentsBtn || !commentsMenu) return;

    // Toggle dropdown on button click
    commentsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = commentsMenu.classList.contains('show');
        if (isOpen) {
            hideCommentsMenu();
        } else {
            showCommentsMenu();
            updateCommentsDropdownList();
        }
    });

    // Resolve All action
    resolveAllBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        hideCommentsMenu();
        requestResolveAll();
    });

    // Sign Off action
    deleteAllBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        hideCommentsMenu();
        requestDeleteAll();
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
        if (!commentsDropdown.contains(e.target as Node)) {
            hideCommentsMenu();
        }
    });

    // Close dropdown on Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            hideCommentsMenu();
        }
    });

    // Initial badge update
    updateCommentsBadge();
}

/**
 * Show the Comments dropdown menu
 */
function showCommentsMenu(): void {
    const commentsMenu = document.getElementById('commentsMenu');
    const commentsBtn = document.getElementById('commentsBtn');
    if (commentsMenu && commentsBtn) {
        commentsMenu.classList.add('show');
        commentsBtn.classList.add('active');
    }
}

/**
 * Hide the Comments dropdown menu
 */
function hideCommentsMenu(): void {
    const commentsMenu = document.getElementById('commentsMenu');
    const commentsBtn = document.getElementById('commentsBtn');
    if (commentsMenu && commentsBtn) {
        commentsMenu.classList.remove('show');
        commentsBtn.classList.remove('active');
    }
    // Hide any open preview tooltips
    hideCommentPreviewTooltip();
}

/**
 * Update the comments dropdown list with active (open) comments
 */
function updateCommentsDropdownList(): void {
    const commentsList = document.getElementById('commentsList');
    const commentsListEmpty = document.getElementById('commentsListEmpty');
    if (!commentsList) return;

    // Get open comments
    const openComments = state.comments.filter(c => c.status === 'open');

    // Clear existing list items (but keep the empty message)
    const existingItems = commentsList.querySelectorAll('.comments-list-item');
    existingItems.forEach(item => item.remove());

    if (openComments.length === 0) {
        if (commentsListEmpty) {
            commentsListEmpty.style.display = 'block';
        }
        return;
    }

    // Hide empty message
    if (commentsListEmpty) {
        commentsListEmpty.style.display = 'none';
    }

    // Add comment items
    openComments.forEach(comment => {
        const item = document.createElement('div');
        item.className = 'comments-list-item';
        item.dataset.commentId = comment.id;

        // Truncate comment text for display
        const displayText = comment.comment.length > 40 
            ? comment.comment.substring(0, 40) + '...' 
            : comment.comment;

        item.innerHTML = `
            <span class="comments-list-item-icon">💬</span>
            <div class="comments-list-item-content">
                <span class="comments-list-item-text">${escapeHtml(displayText)}</span>
                <span class="comments-list-item-line">Line ${comment.selection.startLine}</span>
            </div>
        `;

        // Click to navigate to comment
        item.addEventListener('click', (e) => {
            e.stopPropagation();
            hideCommentsMenu();
            navigateToComment(comment.id);
        });

        // Hover preview
        item.addEventListener('mouseenter', (e) => {
            showCommentPreviewTooltip(comment, e.currentTarget as HTMLElement);
        });

        item.addEventListener('mouseleave', () => {
            hideCommentPreviewTooltip();
        });

        commentsList.appendChild(item);
    });
}

/**
 * Update the comments badge count
 */
export function updateCommentsBadge(): void {
    const badge = document.getElementById('commentsBadge');
    if (badge) {
        const openCount = state.comments.filter(c => c.status === 'open').length;
        badge.textContent = `(${openCount})`;
    }
}

/**
 * Show a preview tooltip for a comment
 */
function showCommentPreviewTooltip(comment: import('../types').MarkdownComment, anchorEl: HTMLElement): void {
    // Remove any existing tooltip
    hideCommentPreviewTooltip();

    const tooltip = document.createElement('div');
    tooltip.className = 'comments-preview-tooltip';
    tooltip.id = 'commentsPreviewTooltip';

    // Truncate texts for display
    const commentText = comment.comment.length > 200 
        ? comment.comment.substring(0, 200) + '...' 
        : comment.comment;
    const selectionText = comment.selectedText.length > 60 
        ? comment.selectedText.substring(0, 60) + '...' 
        : comment.selectedText;

    tooltip.innerHTML = `
        <div class="comments-preview-tooltip-text">${escapeHtml(commentText)}</div>
        <div class="comments-preview-tooltip-selection">"${escapeHtml(selectionText)}"</div>
        <div class="comments-preview-tooltip-line">Line ${comment.selection.startLine}</div>
    `;

    document.body.appendChild(tooltip);

    // Position the tooltip
    const rect = anchorEl.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();
    
    // Position to the right of the menu item by default
    let left = rect.right + 8;
    let top = rect.top;

    // If it would overflow the right edge, position to the left
    if (left + tooltipRect.width > window.innerWidth - 10) {
        left = rect.left - tooltipRect.width - 8;
    }

    // If it would overflow the bottom edge, adjust upward
    if (top + tooltipRect.height > window.innerHeight - 10) {
        top = window.innerHeight - tooltipRect.height - 10;
    }

    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
}

/**
 * Hide the comment preview tooltip
 */
function hideCommentPreviewTooltip(): void {
    const tooltip = document.getElementById('commentsPreviewTooltip');
    if (tooltip) {
        tooltip.remove();
    }
}

/**
 * Navigate to a comment by ID
 */
function navigateToComment(commentId: string): void {
    const comment = state.findCommentById(commentId);
    if (!comment) return;

    // Find the commented text element
    const commentedTextEl = document.querySelector(`.commented-text[data-comment-id="${commentId}"]`) as HTMLElement;
    
    if (commentedTextEl) {
        // Scroll to the element
        commentedTextEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        
        // Show the comment bubble
        showCommentBubble(comment, commentedTextEl);
    } else {
        // If the element is not rendered (e.g., in source mode), scroll to the line
        const lineEl = document.querySelector(`.line-content[data-line="${comment.selection.startLine}"]`) as HTMLElement;
        if (lineEl) {
            lineEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }
}

/**
 * Setup AI Action dropdown menu handlers
 */
function setupAIActionDropdown(): void {
    const aiActionDropdown = document.getElementById('aiActionDropdown');
    const aiActionBtn = document.getElementById('aiActionBtn');
    const aiActionMenu = document.getElementById('aiActionMenu');
    const resolveCommentsItem = document.getElementById('resolveCommentsItem');
    const executeWorkPlanItem = document.getElementById('executeWorkPlanItem');
    const updateDocumentItem = document.getElementById('updateDocumentItem');
    const sendToNewChatBtn = document.getElementById('sendToNewChatBtn');
    const sendToExistingChatBtn = document.getElementById('sendToExistingChatBtn');
    const sendToCLIInteractiveBtn = document.getElementById('sendToCLIInteractiveBtn');
    const sendToCLIBackgroundBtn = document.getElementById('sendToCLIBackgroundBtn');
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

    // Handle Execute Work Plan menu item hover/click
    if (executeWorkPlanItem) {
        // Request prompt files when hovering over the menu item
        executeWorkPlanItem.addEventListener('mouseenter', () => {
            requestPromptFiles();
        });

        // On click, toggle submenu visibility (for touch/keyboard accessibility)
        executeWorkPlanItem.addEventListener('click', (e) => {
            e.stopPropagation();
            executeWorkPlanItem.classList.toggle('submenu-open');
            requestPromptFiles();
        });
    }

    // Handle Update Document menu item click
    if (updateDocumentItem) {
        updateDocumentItem.addEventListener('click', (e) => {
            e.stopPropagation();
            hideAIActionMenu();
            // Request the extension to show the update document dialog
            requestUpdateDocument();
        });
    }

    // Handle Refresh Plan menu item click
    const refreshPlanItem = document.getElementById('refreshPlanItem');
    if (refreshPlanItem) {
        refreshPlanItem.addEventListener('click', (e) => {
            e.stopPropagation();
            hideAIActionMenu();
            // Request the extension to show the refresh plan dialog
            requestRefreshPlan();
        });
    }

    // Handle parent menu item hover/click for submenu
    if (resolveCommentsItem) {
        // On click, toggle submenu visibility (for touch/keyboard accessibility)
        resolveCommentsItem.addEventListener('click', (e) => {
            e.stopPropagation();
            resolveCommentsItem.classList.toggle('submenu-open');
        });
    }

    // Send to New Chat action (starts a new conversation)
    sendToNewChatBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        hideAIActionMenu();
        requestSendToChat('markdown', true);
    });

    // Send to Existing Chat action (uses existing conversation)
    sendToExistingChatBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        hideAIActionMenu();
        requestSendToChat('markdown', false);
    });

    // Send to CLI Interactive action (opens external terminal with AI CLI)
    sendToCLIInteractiveBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        hideAIActionMenu();
        requestSendToCLIInteractive('markdown');
    });

    // Send to CLI Background action (uses Copilot SDK in background)
    sendToCLIBackgroundBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        hideAIActionMenu();
        requestSendToCLIBackground('markdown');
    });

    // Copy as Prompt action
    copyPromptBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
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
    const resolveCommentsItem = document.getElementById('resolveCommentsItem');
    const executeWorkPlanItem = document.getElementById('executeWorkPlanItem');
    if (aiActionMenu && aiActionBtn) {
        aiActionMenu.classList.remove('show');
        aiActionBtn.classList.remove('active');
    }
    // Also close any open submenus
    if (resolveCommentsItem) {
        resolveCommentsItem.classList.remove('submenu-open');
    }
    if (executeWorkPlanItem) {
        executeWorkPlanItem.classList.remove('submenu-open');
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
 * Uses the shared ContextMenuManager for menu display
 */
function setupContextMenuEventListeners(): void {
    document.addEventListener('contextmenu', (e) => {
        if ((e.target as HTMLElement).closest('#editorContainer')) {
            handleContextMenu(e);
        }
    });
    // Note: Click handlers and submenu positioning are handled by ContextMenuManager
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
 * Uses the shared ContextMenuManager for display
 */
function handleContextMenu(e: MouseEvent): void {
    if (!contextMenuManager) return;

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

    e.preventDefault();

    // Create selection state for context menu manager
    const savedSelection = state.savedSelectionForContextMenu;
    const menuSelection: ContextMenuSelection = savedSelection ? {
        selectedText: savedSelection.selectedText,
        startLine: savedSelection.startLine,
        endLine: savedSelection.endLine,
        startColumn: savedSelection.startColumn,
        endColumn: savedSelection.endColumn
    } : {
        selectedText: '',
        startLine: 0,
        endLine: 0,
        startColumn: 0,
        endColumn: 0
    };

    // Show context menu using the shared manager
    contextMenuManager.show(e.clientX, e.clientY, menuSelection, state.settings.askAIEnabled ?? false);
}

/**
 * Hide context menu
 */
function hideContextMenu(): void {
    contextMenuManager?.hide();
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
 * @param mode - The AI command mode ('comment' or 'interactive')
 * @param promptFilePath - Optional path to prompt file to include as context
 * @param skillName - Optional skill name to use for this request
 */
function handleAskAIFromContextMenu(
    commandId: string,
    customInstruction?: string,
    mode: AICommandMode = 'comment',
    promptFilePath?: string,
    skillName?: string
): void {
    const saved = state.savedSelectionForContextMenu;
    if (!saved || !saved.selectedText) {
        alert('Please select some text first to ask AI.');
        return;
    }

    // Extract document context for the AI
    const baseContext = extractDocumentContext(saved.startLine, saved.endLine, saved.selectedText);

    // Add command ID (as instructionType for backward compatibility), mode, and optional fields
    const context = {
        ...baseContext,
        instructionType: commandId,
        customInstruction,
        mode,
        promptFilePath,
        skillName
    };

    // Send to extension based on mode
    if (mode === 'interactive') {
        requestAskAIInteractive(context);
    } else {
        requestAskAI(context);
    }

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

// Custom instruction dialog event listeners are handled by the shared CustomInstructionDialog class

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

        // Clear line change indicators when user edits (acknowledges they've seen changes)
        if (state.hasLineChanges) {
            console.log('[Webview] Clearing line changes on user edit');
            state.clearLineChanges();
        }

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
 * Setup toolbar event listeners (called after render to re-attach)
 */
export function setupToolbarInteractions(): void {
    // Update comments badge (called after render when comments change)
    updateCommentsBadge();
    
    // Re-attach click listeners for comments dropdown items
    const resolveAllBtn = document.getElementById('resolveAllBtn');
    const deleteAllBtn = document.getElementById('deleteAllBtn');
    
    if (resolveAllBtn) {
        // Remove old listener by cloning the node (this removes all event listeners)
        const newResolveAllBtn = resolveAllBtn.cloneNode(true);
        resolveAllBtn.parentNode?.replaceChild(newResolveAllBtn, resolveAllBtn);
        newResolveAllBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            hideCommentsMenu();
            requestResolveAll();
        });
    }
    
    if (deleteAllBtn) {
        const newDeleteAllBtn = deleteAllBtn.cloneNode(true);
        deleteAllBtn.parentNode?.replaceChild(newDeleteAllBtn, deleteAllBtn);
        newDeleteAllBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            hideCommentsMenu();
            requestDeleteAll();
        });
    }
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

    // Click on checkboxes to toggle them
    setupCheckboxClickHandlers();

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

    // Click on anchor links (ToC navigation) to jump to the target heading
    setupAnchorLinkNavigation();
}

/**
 * Setup click handlers for markdown checkboxes.
 * Clicking on a checkbox cycles through states: [ ] -> [~] -> [x] -> [ ]
 * (unchecked -> in-progress -> checked -> unchecked)
 * 
 * Works consistently across Windows, macOS, and Linux.
 */
function setupCheckboxClickHandlers(): void {
    // Handle both review mode (.md-checkbox-clickable) and source mode (.src-checkbox-clickable)
    document.querySelectorAll('.md-checkbox-clickable, .src-checkbox-clickable').forEach(checkboxEl => {
        checkboxEl.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();

            const el = checkboxEl as HTMLElement;
            const currentState = el.dataset.state || 'unchecked';
            
            // Get the line number from the checkbox's data attribute or parent line-content element
            let lineNum: number | null = null;
            if (el.dataset.line) {
                lineNum = parseInt(el.dataset.line, 10);
            } else {
                // For source mode, get line number from parent line-content element
                const lineContent = el.closest('.line-content[data-line]');
                if (lineContent) {
                    lineNum = parseInt((lineContent as HTMLElement).dataset.line || '', 10);
                }
            }
            
            if (!lineNum || isNaN(lineNum)) {
                console.warn('[Webview] Could not determine line number for checkbox');
                return;
            }

            // Cycle the checkbox state in the content
            cycleCheckboxState(lineNum, currentState);
        });

        // Add cursor pointer style
        (checkboxEl as HTMLElement).style.cursor = 'pointer';
    });
}

/**
 * Cycle a checkbox state on a specific line.
 * State cycle: unchecked -> in-progress -> checked -> unchecked
 * Updates the markdown content and triggers a re-render.
 * 
 * @param lineNum - 1-based line number
 * @param currentState - Current state of the checkbox ('unchecked', 'in-progress', 'checked')
 */
function cycleCheckboxState(lineNum: number, currentState: string): void {
    const lines = state.currentContent.split('\n');
    const lineIndex = lineNum - 1;

    if (lineIndex < 0 || lineIndex >= lines.length) {
        console.warn('[Webview] Invalid line number for checkbox toggle:', lineNum);
        return;
    }

    const line = lines[lineIndex];
    
    // Match checkbox pattern: optional indent, list marker (- * +), space, checkbox
    // Supports: - [ ] item, - [x] item, - [X] item, - [~] item
    // Also supports: * [ ] item, + [ ] item
    const checkboxPattern = /^(\s*[-*+]\s+)\[([ xX~])\](\s*.*)$/;
    const match = line.match(checkboxPattern);

    if (!match) {
        console.warn('[Webview] Line does not contain a checkbox:', line);
        return;
    }

    const prefix = match[1];  // "- " or "  - " etc.
    const suffix = match[3];  // " item text" etc.

    // Cycle the checkbox state: unchecked -> in-progress -> checked -> unchecked
    let newCheckbox: string;
    switch (currentState) {
        case 'unchecked':
            newCheckbox = '[~]';  // unchecked -> in-progress
            break;
        case 'in-progress':
            newCheckbox = '[x]';  // in-progress -> checked
            break;
        case 'checked':
        default:
            newCheckbox = '[ ]';  // checked -> unchecked
            break;
    }
    
    lines[lineIndex] = prefix + newCheckbox + suffix;

    // Update content
    const newContent = lines.join('\n');
    state.setCurrentContent(newContent);
    updateContent(newContent);

    // Re-render to show the updated checkbox
    render();
}

/**
 * Setup click handlers for anchor links (Table of Contents navigation).
 * Clicking on a link like [Section](#section-name) will scroll to the heading
 * with the matching anchor ID.
 * 
 * Works consistently across Windows, macOS, and Linux.
 */
function setupAnchorLinkNavigation(): void {
    document.querySelectorAll('.md-anchor-link').forEach(linkEl => {
        linkEl.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();

            const anchorTarget = (linkEl as HTMLElement).dataset.anchor;
            if (!anchorTarget) return;

            // Find the heading with the matching anchor ID
            const targetHeading = document.querySelector(`[data-anchor-id="${anchorTarget}"]`);
            if (targetHeading) {
                // Scroll to the heading
                targetHeading.scrollIntoView({ behavior: 'smooth', block: 'start' });

                // Add a temporary highlight effect to make the target visible
                const lineRow = targetHeading.closest('.line-row');
                if (lineRow) {
                    lineRow.classList.add('anchor-highlight');
                    setTimeout(() => {
                        lineRow.classList.remove('anchor-highlight');
                    }, 2000);
                }
            } else {
                // If target not found, try to match with normalized anchor
                // This handles cases where the link might have different casing
                const allHeadings = document.querySelectorAll('[data-anchor-id]');
                for (const heading of allHeadings) {
                    const headingAnchor = (heading as HTMLElement).dataset.anchorId || '';
                    // Case-insensitive comparison for better compatibility
                    if (headingAnchor.toLowerCase() === anchorTarget.toLowerCase()) {
                        heading.scrollIntoView({ behavior: 'smooth', block: 'start' });

                        const lineRow = heading.closest('.line-row');
                        if (lineRow) {
                            lineRow.classList.add('anchor-highlight');
                            setTimeout(() => {
                                lineRow.classList.remove('anchor-highlight');
                            }, 2000);
                        }
                        break;
                    }
                }
            }
        });

        // Add visual hint that anchor links are clickable for navigation
        (linkEl as HTMLElement).title = 'Click to jump to section';
    });
}

