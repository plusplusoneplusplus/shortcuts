/**
 * Shared Context Menu Manager
 * 
 * Manager class for handling context menu display and interactions.
 * Used by both markdown review editor and git diff review editor.
 */

import {
    AICommandMode,
    ContextMenuCallbacks,
    ContextMenuConfig,
    ContextMenuSelection,
    PromptFileInfo,
    SerializedAICommand,
    SerializedAIMenuConfig,
    SerializedPredefinedComment,
    SkillInfo
} from './context-menu-types';
import {
    buildAISubmenuHTML,
    buildPredefinedSubmenuHTML,
    buildPromptFileSubmenuHTML,
    buildSkillSubmenuHTML,
    getAIMenuConfig,
    getPredefinedComments
} from './context-menu-builder';

/**
 * Default context menu configuration
 */
const DEFAULT_CONFIG: ContextMenuConfig = {
    enableClipboardItems: false,
    enablePreviewTooltips: false,
    minWidth: 150,
    borderRadius: 4,
    richMenuItems: false,
    classPrefix: ''
};

/**
 * Context Menu Manager
 * 
 * Manages context menu display, positioning, and event handling.
 */
export class ContextMenuManager {
    private config: ContextMenuConfig;
    private callbacks: ContextMenuCallbacks;

    // DOM element references
    private contextMenu: HTMLElement | null = null;
    private contextMenuCut: HTMLElement | null = null;
    private contextMenuCopy: HTMLElement | null = null;
    private contextMenuPaste: HTMLElement | null = null;
    private contextMenuAddComment: HTMLElement | null = null;
    private contextMenuPredefined: HTMLElement | null = null;
    private predefinedSubmenu: HTMLElement | null = null;
    private contextMenuAskAIComment: HTMLElement | null = null;
    private askAICommentSubmenu: HTMLElement | null = null;
    private contextMenuAskAIInteractive: HTMLElement | null = null;
    private askAIInteractiveSubmenu: HTMLElement | null = null;
    private askAISeparator: HTMLElement | null = null;
    private predefinedPreview: HTMLElement | null = null;
    private previewContent: HTMLElement | null = null;
    // Prompt file and skill submenus
    private contextMenuCustomWithPromptFile: HTMLElement | null = null;
    private promptFileSubmenu: HTMLElement | null = null;
    private promptFileSeparator: HTMLElement | null = null;
    private contextMenuUseSkill: HTMLElement | null = null;
    private skillSubmenu: HTMLElement | null = null;
    private promptFilesLoaded: boolean = false;
    private skillsLoaded: boolean = false;

    // State
    private currentSelection: ContextMenuSelection | null = null;
    private previewHideTimeout: ReturnType<typeof setTimeout> | null = null;
    private currentPreviewParentItem: HTMLElement | null = null;
    private isVisible: boolean = false;

    constructor(config: ContextMenuConfig = DEFAULT_CONFIG, callbacks: ContextMenuCallbacks = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.callbacks = callbacks;
    }

    /**
     * Initialize the context menu manager
     * Finds DOM elements and sets up event listeners
     */
    init(): void {
        this.findElements();
        this.setupEventListeners();
    }

    /**
     * Find and cache DOM element references
     */
    private findElements(): void {
        // Main context menu
        this.contextMenu = document.getElementById('contextMenu');
        if (!this.contextMenu) {
            // Try alternate ID for diff editor
            this.contextMenu = document.getElementById('custom-context-menu');
        }

        // Clipboard items (if enabled)
        if (this.config.enableClipboardItems) {
            this.contextMenuCut = document.getElementById('contextMenuCut');
            this.contextMenuCopy = document.getElementById('contextMenuCopy');
            this.contextMenuPaste = document.getElementById('contextMenuPaste');
        }

        // Add comment item
        this.contextMenuAddComment = document.getElementById('contextMenuAddComment') ||
            document.getElementById('context-menu-add-comment');

        // Predefined comments
        this.contextMenuPredefined = document.getElementById('contextMenuPredefined') ||
            document.getElementById('context-menu-predefined');
        this.predefinedSubmenu = document.getElementById('predefinedSubmenu') ||
            document.getElementById('predefined-submenu');

        // Ask AI Comment submenu
        this.contextMenuAskAIComment = document.getElementById('contextMenuAskAIComment') ||
            document.getElementById('context-menu-ask-ai-comment');
        this.askAICommentSubmenu = document.getElementById('askAICommentSubmenu') ||
            document.getElementById('ask-ai-comment-submenu');

        // Ask AI Interactive submenu
        this.contextMenuAskAIInteractive = document.getElementById('contextMenuAskAIInteractive') ||
            document.getElementById('context-menu-ask-ai-interactive');
        this.askAIInteractiveSubmenu = document.getElementById('askAIInteractiveSubmenu') ||
            document.getElementById('ask-ai-interactive-submenu');

        // Ask AI separator
        this.askAISeparator = document.getElementById('askAISeparator') ||
            document.getElementById('ask-ai-separator');

        // Prompt file submenu
        this.contextMenuCustomWithPromptFile = document.getElementById('contextMenuCustomWithPromptFile') ||
            document.getElementById('context-menu-custom-with-prompt-file');
        this.promptFileSubmenu = document.getElementById('promptFileSubmenu') ||
            document.getElementById('prompt-file-submenu');
        this.promptFileSeparator = document.getElementById('promptFileSeparator') ||
            document.getElementById('prompt-file-separator');

        // Skill submenu
        this.contextMenuUseSkill = document.getElementById('contextMenuUseSkill') ||
            document.getElementById('context-menu-use-skill');
        this.skillSubmenu = document.getElementById('skillSubmenu') ||
            document.getElementById('skill-submenu');

        // Preview tooltip (if enabled)
        if (this.config.enablePreviewTooltips) {
            this.predefinedPreview = document.getElementById('predefinedPreview');
            this.previewContent = this.predefinedPreview?.querySelector('.preview-content') || null;
        }
    }

    /**
     * Setup event listeners for menu items
     */
    private setupEventListeners(): void {
        // Click outside to hide
        document.addEventListener('click', (e) => {
            if (this.contextMenu && !this.contextMenu.contains(e.target as Node)) {
                this.hide();
            }
        });

        // Clipboard items
        if (this.config.enableClipboardItems) {
            this.contextMenuCut?.addEventListener('click', () => {
                this.hide();
                this.callbacks.onCut?.();
            });

            this.contextMenuCopy?.addEventListener('click', () => {
                this.hide();
                this.callbacks.onCopy?.();
            });

            this.contextMenuPaste?.addEventListener('click', () => {
                this.hide();
                this.callbacks.onPaste?.();
            });
        }

        // Add comment
        this.contextMenuAddComment?.addEventListener('click', () => {
            this.hide();
            this.callbacks.onAddComment?.();
        });

        // Predefined comments parent - position submenu on hover
        this.contextMenuPredefined?.addEventListener('mouseenter', () => {
            this.positionSubmenu(this.predefinedSubmenu, this.contextMenuPredefined);
        });

        // Ask AI Comment parent - position submenu on hover
        this.contextMenuAskAIComment?.addEventListener('mouseenter', () => {
            this.positionSubmenu(this.askAICommentSubmenu, this.contextMenuAskAIComment);
        });

        // Ask AI Interactive parent - position submenu on hover
        this.contextMenuAskAIInteractive?.addEventListener('mouseenter', () => {
            this.positionSubmenu(this.askAIInteractiveSubmenu, this.contextMenuAskAIInteractive);
        });

        // Custom with Prompt File parent - position submenu and request files on hover
        this.contextMenuCustomWithPromptFile?.addEventListener('mouseenter', () => {
            this.positionSubmenu(this.promptFileSubmenu, this.contextMenuCustomWithPromptFile);
            if (!this.promptFilesLoaded) {
                this.callbacks.onRequestPromptFiles?.();
            }
        });

        // Use Skill parent - position submenu and request skills on hover
        this.contextMenuUseSkill?.addEventListener('mouseenter', () => {
            this.positionSubmenu(this.skillSubmenu, this.contextMenuUseSkill);
            if (!this.skillsLoaded) {
                this.callbacks.onRequestSkills?.();
            }
        });

        // Setup preview tooltip event listeners
        if (this.config.enablePreviewTooltips && this.predefinedPreview) {
            this.setupPreviewEventListeners();
        }
    }

    /**
     * Setup event listeners for the preview tooltip
     */
    private setupPreviewEventListeners(): void {
        if (!this.predefinedPreview) return;

        // Keep preview visible when mouse enters it
        this.predefinedPreview.addEventListener('mouseenter', () => {
            if (this.previewHideTimeout) {
                clearTimeout(this.previewHideTimeout);
                this.previewHideTimeout = null;
            }
            // Add submenu-open class to keep the submenu visible
            if (this.currentPreviewParentItem) {
                this.currentPreviewParentItem.classList.add('submenu-open');
            }
        });

        // Hide preview when mouse leaves it
        this.predefinedPreview.addEventListener('mouseleave', () => {
            if (this.currentPreviewParentItem) {
                this.currentPreviewParentItem.classList.remove('submenu-open');
                this.currentPreviewParentItem = null;
            }
            this.hidePreviewImmediately();
        });
    }

    /**
     * Show the context menu at the specified position
     * @param x - X coordinate (client)
     * @param y - Y coordinate (client)
     * @param selection - Current selection state
     * @param askAIEnabled - Whether Ask AI feature is enabled
     */
    show(x: number, y: number, selection: ContextMenuSelection, askAIEnabled: boolean = true): void {
        if (!this.contextMenu) return;

        this.currentSelection = selection;
        const hasSelection = selection.selectedText.trim().length > 0;

        // Update menu item states based on selection
        this.updateMenuItemStates(hasSelection, askAIEnabled);

        // Position and show context menu
        this.contextMenu.style.display = 'block';
        this.contextMenu.style.visibility = 'hidden';
        const menuRect = this.contextMenu.getBoundingClientRect();
        this.contextMenu.style.visibility = '';

        // Calculate position with edge detection
        const submenuWidth = 200;
        const menuWidth = menuRect.width;
        const menuHeight = menuRect.height;

        let posX = x;
        let posY = y;

        // Check right edge - need room for both menu and potential submenu
        if (posX + menuWidth + submenuWidth > window.innerWidth) {
            posX = Math.max(0, window.innerWidth - menuWidth - submenuWidth);
        }

        // Check bottom edge
        if (posY + menuHeight > window.innerHeight) {
            posY = Math.max(0, window.innerHeight - menuHeight);
        }

        this.contextMenu.style.left = posX + 'px';
        this.contextMenu.style.top = posY + 'px';
        this.contextMenu.classList.remove('hidden');
        this.isVisible = true;
    }

    /**
     * Hide the context menu
     */
    hide(): void {
        if (this.contextMenu) {
            this.contextMenu.style.display = 'none';
            this.contextMenu.classList.add('hidden');
        }
        this.hidePreviewImmediately();
        this.resetSubmenuPositioning();
        this.isVisible = false;
        this.callbacks.onHide?.();
    }

    /**
     * Check if the menu is currently visible
     */
    isMenuVisible(): boolean {
        return this.isVisible;
    }

    /**
     * Get the current selection
     */
    getSelection(): ContextMenuSelection | null {
        return this.currentSelection;
    }

    /**
     * Update menu item states based on selection and settings
     */
    updateMenuItemStates(hasSelection: boolean, askAIEnabled: boolean): void {
        // Clipboard items
        if (this.config.enableClipboardItems) {
            this.setItemDisabled(this.contextMenuCut, !hasSelection);
            this.setItemDisabled(this.contextMenuCopy, !hasSelection);
            // Paste is always enabled
            this.setItemDisabled(this.contextMenuPaste, false);
        }

        // Add comment
        this.setItemDisabled(this.contextMenuAddComment, !hasSelection);

        // Predefined comments
        this.setItemDisabled(this.contextMenuPredefined, !hasSelection);

        // Ask AI items
        if (askAIEnabled) {
            this.setItemDisabled(this.contextMenuAskAIComment, !hasSelection);
            this.setItemDisabled(this.contextMenuAskAIInteractive, !hasSelection);
            this.setItemVisible(this.contextMenuAskAIComment, true);
            this.setItemVisible(this.contextMenuAskAIInteractive, true);
            this.setItemVisible(this.askAISeparator, true);
            // Prompt file and skill items
            this.setItemDisabled(this.contextMenuCustomWithPromptFile, !hasSelection);
            this.setItemDisabled(this.contextMenuUseSkill, !hasSelection);
            this.setItemVisible(this.contextMenuCustomWithPromptFile, true);
            this.setItemVisible(this.contextMenuUseSkill, true);
            this.setItemVisible(this.promptFileSeparator, true);
        } else {
            this.setItemVisible(this.contextMenuAskAIComment, false);
            this.setItemVisible(this.contextMenuAskAIInteractive, false);
            this.setItemVisible(this.askAISeparator, false);
            this.setItemVisible(this.contextMenuCustomWithPromptFile, false);
            this.setItemVisible(this.contextMenuUseSkill, false);
            this.setItemVisible(this.promptFileSeparator, false);
        }
    }

    /**
     * Rebuild the predefined comments submenu
     * @param comments - Predefined comments from settings
     */
    rebuildPredefinedSubmenu(comments?: SerializedPredefinedComment[]): void {
        if (!this.predefinedSubmenu) return;

        const sortedComments = getPredefinedComments(comments);
        this.predefinedSubmenu.innerHTML = buildPredefinedSubmenuHTML(sortedComments, this.config);

        // Attach click and hover handlers
        this.predefinedSubmenu.querySelectorAll('.predefined-item').forEach(item => {
            const el = item as HTMLElement;

            // Click handler
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                const text = decodeURIComponent(el.dataset.text || '');
                this.hidePreviewImmediately();
                this.hide();
                this.callbacks.onPredefinedComment?.(text);
            });

            // Hover handlers for preview
            if (this.config.enablePreviewTooltips) {
                el.addEventListener('mouseenter', () => {
                    const text = decodeURIComponent(el.dataset.text || '');
                    this.showPreview(text, el);
                });

                el.addEventListener('mouseleave', () => {
                    this.hidePreview();
                });
            }
        });
    }

    /**
     * Rebuild both AI submenus based on current settings
     * @param menuConfig - AI menu configuration from settings
     */
    rebuildAISubmenus(menuConfig?: SerializedAIMenuConfig): void {
        const config = getAIMenuConfig(menuConfig);

        // Build "Ask AI to Comment" submenu
        if (this.askAICommentSubmenu) {
            this.askAICommentSubmenu.innerHTML = buildAISubmenuHTML(config.commentCommands, 'comment', this.config);
            this.attachAISubmenuHandlers(this.askAICommentSubmenu);
        }

        // Build "Ask AI Interactively" submenu
        if (this.askAIInteractiveSubmenu) {
            this.askAIInteractiveSubmenu.innerHTML = buildAISubmenuHTML(config.interactiveCommands, 'interactive', this.config);
            this.attachAISubmenuHandlers(this.askAIInteractiveSubmenu);
        }
    }

    /**
     * Set the prompt files for the "Custom with Prompt File" submenu
     * @param promptFiles - Array of prompt files to display
     */
    setPromptFiles(promptFiles: PromptFileInfo[]): void {
        if (!this.promptFileSubmenu) return;

        this.promptFilesLoaded = true;
        this.promptFileSubmenu.innerHTML = buildPromptFileSubmenuHTML(promptFiles, this.config);

        // Attach click handlers to prompt file items
        this.promptFileSubmenu.querySelectorAll('.prompt-file-item').forEach(item => {
            const el = item as HTMLElement;
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                const path = decodeURIComponent(el.dataset.path || '');
                this.hide();
                this.callbacks.onPromptFileSelected?.(path);
            });
        });
    }

    /**
     * Set the skills for the "Use Skill" submenu
     * @param skills - Array of skills to display
     */
    setSkills(skills: SkillInfo[]): void {
        if (!this.skillSubmenu) return;

        this.skillsLoaded = true;
        this.skillSubmenu.innerHTML = buildSkillSubmenuHTML(skills, this.config);

        // Attach click handlers to skill items
        this.skillSubmenu.querySelectorAll('.skill-item').forEach(item => {
            const el = item as HTMLElement;
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                const skillName = decodeURIComponent(el.dataset.skillName || '');
                const skillPath = decodeURIComponent(el.dataset.skillPath || '');
                this.hide();
                this.callbacks.onSkillSelected?.(skillName, skillPath);
            });
        });
    }

    /**
     * Reset the prompt files and skills loaded state
     * Call this when the menu is hidden to refresh on next show
     */
    resetPromptFilesAndSkillsState(): void {
        this.promptFilesLoaded = false;
        this.skillsLoaded = false;
    }

    /**
     * Attach click handlers to AI submenu items
     */
    private attachAISubmenuHandlers(submenuElement: HTMLElement): void {
        submenuElement.querySelectorAll('.ask-ai-item, .ask-ai-interactive-item').forEach(item => {
            const element = item as HTMLElement;

            // Click handler
            element.addEventListener('click', (e) => {
                e.stopPropagation();
                const commandId = element.dataset.commandId || '';
                const isCustomInput = element.dataset.customInput === 'true';
                const mode = (element.dataset.mode || 'comment') as AICommandMode;
                this.hide();
                this.callbacks.onAskAI?.(commandId, isCustomInput, mode);
            });

            // Hover handlers for preview
            if (this.config.enablePreviewTooltips) {
                element.addEventListener('mouseenter', () => {
                    const prompt = element.dataset.prompt;
                    if (prompt) {
                        this.showPreview(decodeURIComponent(prompt), element);
                    }
                });

                element.addEventListener('mouseleave', () => {
                    this.hidePreview();
                });
            }
        });
    }

    /**
     * Position submenu based on available viewport space
     */
    private positionSubmenu(submenu: HTMLElement | null, parentItem: HTMLElement | null): void {
        if (!submenu || !parentItem || !this.contextMenu) return;

        const parentRect = parentItem.getBoundingClientRect();
        const menuRect = this.contextMenu.getBoundingClientRect();

        // Temporarily show submenu to get its dimensions
        const originalDisplay = submenu.style.display;
        submenu.style.display = 'block';
        submenu.style.visibility = 'hidden';
        const submenuRect = submenu.getBoundingClientRect();
        submenu.style.visibility = '';
        submenu.style.display = originalDisplay;

        // Check horizontal space
        const spaceOnRight = window.innerWidth - menuRect.right;
        const spaceOnLeft = menuRect.left;

        if (spaceOnRight < submenuRect.width && spaceOnLeft > submenuRect.width) {
            // Show on left side
            submenu.style.left = 'auto';
            submenu.style.right = '100%';
            submenu.style.marginLeft = '0';
            submenu.style.marginRight = '2px';
        } else {
            // Show on right side (default)
            submenu.style.left = '100%';
            submenu.style.right = 'auto';
            submenu.style.marginLeft = '2px';
            submenu.style.marginRight = '0';
        }

        // Check vertical space
        const submenuBottomIfAlignedToTop = parentRect.top + submenuRect.height;
        if (submenuBottomIfAlignedToTop > window.innerHeight) {
            const overflow = submenuBottomIfAlignedToTop - window.innerHeight;
            submenu.style.top = `${-overflow - 5}px`;
        } else {
            submenu.style.top = '-1px';
        }
    }

    /**
     * Reset submenu positioning
     */
    private resetSubmenuPositioning(): void {
        const submenus = [
            this.askAICommentSubmenu, 
            this.askAIInteractiveSubmenu, 
            this.predefinedSubmenu,
            this.promptFileSubmenu,
            this.skillSubmenu
        ];
        submenus.forEach(submenu => {
            if (submenu) {
                submenu.style.left = '';
                submenu.style.right = '';
                submenu.style.top = '';
                submenu.style.bottom = '';
            }
        });
    }

    /**
     * Show preview tooltip
     */
    private showPreview(text: string, anchorElement: HTMLElement): void {
        if (!this.predefinedPreview || !this.previewContent) return;

        // Cancel any pending hide timeout
        if (this.previewHideTimeout) {
            clearTimeout(this.previewHideTimeout);
            this.previewHideTimeout = null;
        }

        // Track the parent menu item
        const parentMenuItem = anchorElement.closest('.context-menu-parent') as HTMLElement;
        if (this.currentPreviewParentItem && this.currentPreviewParentItem !== parentMenuItem) {
            this.currentPreviewParentItem.classList.remove('submenu-open');
        }
        this.currentPreviewParentItem = parentMenuItem;

        // Set the preview text
        this.previewContent.textContent = text;

        // Temporarily show to get dimensions
        this.predefinedPreview.style.display = 'block';
        this.predefinedPreview.style.visibility = 'hidden';
        const previewRect = this.predefinedPreview.getBoundingClientRect();
        this.predefinedPreview.style.visibility = '';

        // Get positions
        const submenu = anchorElement.closest('.context-submenu');
        const submenuRect = submenu ? submenu.getBoundingClientRect() : anchorElement.getBoundingClientRect();
        const anchorRect = anchorElement.getBoundingClientRect();

        const margin = 8;
        const previewWidth = previewRect.width;
        const previewHeight = previewRect.height;

        // Calculate horizontal position - prefer right side of submenu
        let left: number;
        const spaceOnRight = window.innerWidth - submenuRect.right;
        const spaceOnLeft = submenuRect.left;

        if (spaceOnRight >= previewWidth + margin) {
            left = submenuRect.right + margin;
        } else if (spaceOnLeft >= previewWidth + margin) {
            left = submenuRect.left - previewWidth - margin;
        } else {
            left = window.innerWidth - previewWidth - margin;
        }

        // Calculate vertical position
        let top = anchorRect.top;
        if (top + previewHeight > window.innerHeight - margin) {
            top = window.innerHeight - previewHeight - margin;
        }
        if (top < margin) {
            top = margin;
        }

        this.predefinedPreview.style.left = `${Math.max(margin, left)}px`;
        this.predefinedPreview.style.top = `${top}px`;
    }

    /**
     * Hide preview tooltip with delay
     */
    private hidePreview(): void {
        this.previewHideTimeout = setTimeout(() => {
            if (this.predefinedPreview) {
                this.predefinedPreview.style.display = 'none';
            }
            this.previewHideTimeout = null;
        }, 100);
    }

    /**
     * Hide preview tooltip immediately
     */
    private hidePreviewImmediately(): void {
        if (this.previewHideTimeout) {
            clearTimeout(this.previewHideTimeout);
            this.previewHideTimeout = null;
        }
        if (this.currentPreviewParentItem) {
            this.currentPreviewParentItem.classList.remove('submenu-open');
            this.currentPreviewParentItem = null;
        }
        if (this.predefinedPreview) {
            this.predefinedPreview.style.display = 'none';
        }
    }

    /**
     * Set disabled state on a menu item
     */
    private setItemDisabled(element: HTMLElement | null, disabled: boolean): void {
        if (!element) return;
        if (disabled) {
            element.classList.add('disabled');
        } else {
            element.classList.remove('disabled');
        }
    }

    /**
     * Set visibility of a menu item
     */
    private setItemVisible(element: HTMLElement | null, visible: boolean): void {
        if (!element) return;
        element.style.display = visible ? '' : 'none';
    }
}
