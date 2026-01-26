/**
 * Shared Context Menu Builder
 * 
 * HTML generation functions for building context menus used by both
 * markdown review editor and git diff review editor.
 */

import {
    AICommandMode,
    ContextMenuConfig,
    ContextMenuItem,
    DEFAULT_AI_COMMANDS,
    DEFAULT_PREDEFINED_COMMENTS,
    PromptFileInfo,
    SerializedAICommand,
    SerializedAIMenuConfig,
    SerializedPredefinedComment,
    SkillInfo
} from './context-menu-types';

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
 * Get the CSS class name with optional prefix
 */
function getClassName(baseName: string, config: ContextMenuConfig): string {
    return config.classPrefix ? `${config.classPrefix}-${baseName}` : baseName;
}

/**
 * Build a single menu item HTML
 * @param item - The menu item definition
 * @param config - Context menu configuration
 * @returns HTML string for the menu item
 */
export function buildMenuItemHTML(item: ContextMenuItem, config: ContextMenuConfig = DEFAULT_CONFIG): string {
    const mergedConfig = { ...DEFAULT_CONFIG, ...config };

    if (item.isSeparator) {
        return `<div class="${getClassName('context-menu-separator', mergedConfig)}" id="${item.id}"></div>`;
    }

    const disabledClass = item.disabled ? ' disabled' : '';
    const parentClass = item.hasSubmenu ? ` ${getClassName('context-menu-parent', mergedConfig)}` : '';
    const customClass = item.className ? ` ${item.className}` : '';
    const itemClass = `${getClassName('context-menu-item', mergedConfig)}${disabledClass}${parentClass}${customClass}`;

    // Build data attributes string
    const dataAttrs = item.dataAttributes
        ? Object.entries(item.dataAttributes)
            .map(([key, value]) => `data-${key}="${value}"`)
            .join(' ')
        : '';

    // Build inner content
    let content = '';
    if (mergedConfig.richMenuItems) {
        // Rich format: icon + label + shortcut
        const icon = item.icon ? `<span class="${getClassName('context-menu-icon', mergedConfig)}">${item.icon}</span>` : '';
        const shortcut = item.shortcut ? `<span class="${getClassName('context-menu-shortcut', mergedConfig)}">${item.shortcut}</span>` : '';
        content = `${icon}<span class="${getClassName('context-menu-label', mergedConfig)}">${item.label}</span>${shortcut}`;
    } else {
        // Simple format: just icon (if any) + label
        const icon = item.icon ? `<span class="menu-icon">${item.icon}</span>` : '';
        content = `${icon}${item.label}`;
    }

    // Add arrow for submenu
    if (item.hasSubmenu) {
        content += `<span class="${getClassName('context-menu-arrow', mergedConfig)}">▶</span>`;
    }

    // Build submenu if present
    let submenuHTML = '';
    if (item.hasSubmenu && item.children) {
        const submenuItems = item.children.map(child => buildMenuItemHTML(child, mergedConfig)).join('');
        submenuHTML = `<div class="${getClassName('context-submenu', mergedConfig)}" id="${item.id}Submenu">${submenuItems}</div>`;
    }

    return `<div class="${itemClass}" id="${item.id}" ${dataAttrs}>${content}${submenuHTML}</div>`;
}

/**
 * Build clipboard items HTML (Cut/Copy/Paste)
 * @param config - Context menu configuration
 * @returns HTML string for clipboard items
 */
export function buildClipboardItemsHTML(config: ContextMenuConfig = DEFAULT_CONFIG): string {
    const mergedConfig = { ...DEFAULT_CONFIG, ...config };

    const items: ContextMenuItem[] = [
        { id: 'contextMenuCut', label: 'Cut', icon: '✂️', shortcut: 'Ctrl+X' },
        { id: 'contextMenuCopy', label: 'Copy', icon: '📋', shortcut: 'Ctrl+C' },
        { id: 'contextMenuPaste', label: 'Paste', icon: '📄', shortcut: 'Ctrl+V' }
    ];

    return items.map(item => buildMenuItemHTML(item, mergedConfig)).join('');
}

/**
 * Build the Add Comment menu item HTML
 * @param config - Context menu configuration
 * @returns HTML string for the Add Comment item
 */
export function buildAddCommentItemHTML(config: ContextMenuConfig = DEFAULT_CONFIG): string {
    const mergedConfig = { ...DEFAULT_CONFIG, ...config };

    const item: ContextMenuItem = {
        id: 'contextMenuAddComment',
        label: 'Add Comment',
        icon: '💬',
        shortcut: mergedConfig.richMenuItems ? 'Ctrl+Shift+M' : undefined
    };

    return buildMenuItemHTML(item, mergedConfig);
}

/**
 * Build predefined comments submenu HTML
 * @param comments - The predefined comments to display
 * @param config - Context menu configuration
 * @returns HTML string for predefined comments submenu
 */
export function buildPredefinedSubmenuHTML(
    comments?: SerializedPredefinedComment[],
    config: ContextMenuConfig = DEFAULT_CONFIG
): string {
    const mergedConfig = { ...DEFAULT_CONFIG, ...config };
    const sortedComments = (comments && comments.length > 0)
        ? [...comments].sort((a, b) => (a.order ?? 100) - (b.order ?? 100))
        : DEFAULT_PREDEFINED_COMMENTS;

    return sortedComments.map(c => {
        const title = c.description ? `title="${c.description}"` : '';
        const itemClass = mergedConfig.richMenuItems
            ? `${getClassName('context-menu-item', mergedConfig)} predefined-item`
            : `${getClassName('context-menu-item', mergedConfig)} predefined-item`;

        const content = mergedConfig.richMenuItems
            ? `<span class="${getClassName('context-menu-label', mergedConfig)}">${c.label}</span>`
            : c.label;

        return `<div class="${itemClass}" data-id="${c.id}" data-text="${encodeURIComponent(c.text)}" ${title}>${content}</div>`;
    }).join('');
}

/**
 * Build predefined comments parent item with submenu HTML
 * @param comments - The predefined comments to display
 * @param config - Context menu configuration
 * @returns HTML string for predefined comments menu item with submenu
 */
export function buildPredefinedMenuItemHTML(
    comments?: SerializedPredefinedComment[],
    config: ContextMenuConfig = DEFAULT_CONFIG
): string {
    const mergedConfig = { ...DEFAULT_CONFIG, ...config };
    const submenuContent = buildPredefinedSubmenuHTML(comments, mergedConfig);

    const item: ContextMenuItem = {
        id: 'contextMenuPredefined',
        label: 'Add Predefined Comment',
        icon: mergedConfig.richMenuItems ? '📋' : undefined,
        hasSubmenu: true,
        className: 'context-menu-parent'
    };

    // Build without children (we'll add submenu manually)
    const itemClass = `${getClassName('context-menu-item', mergedConfig)} ${getClassName('context-menu-parent', mergedConfig)}`;
    const icon = item.icon ? `<span class="${getClassName('context-menu-icon', mergedConfig)}">${item.icon}</span>` : '';
    const label = mergedConfig.richMenuItems
        ? `<span class="${getClassName('context-menu-label', mergedConfig)}">${item.label}</span>`
        : item.label;
    const arrow = `<span class="${getClassName('context-menu-arrow', mergedConfig)}">▶</span>`;

    return `<div class="${itemClass}" id="${item.id}">
        ${icon}${label}${arrow}
        <div class="${getClassName('context-submenu', mergedConfig)}" id="predefinedSubmenu">${submenuContent}</div>
    </div>`;
}

/**
 * Build AI submenu HTML for a specific mode
 * @param commands - The AI commands to display
 * @param mode - The mode for this menu ('comment' or 'interactive')
 * @param config - Context menu configuration
 * @returns HTML string for AI submenu
 */
export function buildAISubmenuHTML(
    commands?: SerializedAICommand[],
    mode: AICommandMode = 'comment',
    config: ContextMenuConfig = DEFAULT_CONFIG
): string {
    const mergedConfig = { ...DEFAULT_CONFIG, ...config };
    const sortedCommands = (commands && commands.length > 0)
        ? [...commands].sort((a, b) => (a.order ?? 100) - (b.order ?? 100))
        : DEFAULT_AI_COMMANDS;

    const modeClass = mode === 'interactive' ? 'ask-ai-interactive-item' : 'ask-ai-item';

    return sortedCommands.map(cmd => {
        const icon = cmd.icon ? `<span class="menu-icon">${cmd.icon}</span>` : '';
        const dataCustomInput = cmd.isCustomInput ? 'data-custom-input="true"' : '';
        const dataPrompt = cmd.prompt ? `data-prompt="${encodeURIComponent(cmd.prompt)}"` : '';
        const itemClass = mergedConfig.richMenuItems
            ? `${getClassName('context-menu-item', mergedConfig)} ${modeClass}`
            : `${getClassName('context-menu-item', mergedConfig)} ${modeClass}`;

        const label = mergedConfig.richMenuItems
            ? `<span class="${getClassName('context-menu-label', mergedConfig)}">${cmd.label}</span>`
            : cmd.label;

        return `<div class="${itemClass}" data-command-id="${cmd.id}" data-mode="${mode}" ${dataCustomInput} ${dataPrompt}>
            ${icon}${label}
        </div>`;
    }).join('');
}

/**
 * Build AI menu item with submenu HTML
 * @param menuConfig - The AI menu configuration
 * @param mode - The mode for this menu ('comment' or 'interactive')
 * @param config - Context menu configuration
 * @returns HTML string for AI menu item with submenu
 */
export function buildAIMenuItemHTML(
    menuConfig: SerializedAIMenuConfig | undefined,
    mode: AICommandMode,
    config: ContextMenuConfig = DEFAULT_CONFIG
): string {
    const mergedConfig = { ...DEFAULT_CONFIG, ...config };

    const commands = mode === 'interactive'
        ? menuConfig?.interactiveCommands
        : menuConfig?.commentCommands;

    const submenuContent = buildAISubmenuHTML(commands, mode, mergedConfig);

    const itemId = mode === 'interactive' ? 'contextMenuAskAIInteractive' : 'contextMenuAskAIComment';
    const submenuId = mode === 'interactive' ? 'askAIInteractiveSubmenu' : 'askAICommentSubmenu';
    const label = mode === 'interactive' ? 'Ask AI Interactively' : 'Ask AI to Comment';
    const icon = mode === 'interactive' ? '🤖' : '💬';

    const itemClass = `${getClassName('context-menu-item', mergedConfig)} ${getClassName('context-menu-parent', mergedConfig)}`;
    const iconSpan = mergedConfig.richMenuItems
        ? `<span class="${getClassName('context-menu-icon', mergedConfig)}">${icon}</span>`
        : '';
    const labelSpan = mergedConfig.richMenuItems
        ? `<span class="${getClassName('context-menu-label', mergedConfig)}">${label}</span>`
        : label;
    const arrow = `<span class="${getClassName('context-menu-arrow', mergedConfig)}">▶</span>`;

    return `<div class="${itemClass}" id="${itemId}">
        ${iconSpan}${labelSpan}${arrow}
        <div class="${getClassName('context-submenu', mergedConfig)}" id="${submenuId}">${submenuContent}</div>
    </div>`;
}

/**
 * Get AI menu configuration from settings
 * @param configFromSettings - The configuration from settings
 * @returns Normalized AI menu configuration
 */
export function getAIMenuConfig(configFromSettings?: SerializedAIMenuConfig): SerializedAIMenuConfig {
    if (configFromSettings && configFromSettings.commentCommands && configFromSettings.commentCommands.length > 0) {
        return {
            commentCommands: [...configFromSettings.commentCommands].sort((a, b) => (a.order ?? 100) - (b.order ?? 100)),
            interactiveCommands: [...configFromSettings.interactiveCommands].sort((a, b) => (a.order ?? 100) - (b.order ?? 100))
        };
    }
    // Default: both menus use the same commands
    return {
        commentCommands: DEFAULT_AI_COMMANDS,
        interactiveCommands: DEFAULT_AI_COMMANDS
    };
}

/**
 * Get predefined comments from settings or defaults
 * @param commentsFromSettings - The comments from settings
 * @returns Sorted predefined comments
 */
export function getPredefinedComments(commentsFromSettings?: SerializedPredefinedComment[]): SerializedPredefinedComment[] {
    if (commentsFromSettings && commentsFromSettings.length > 0) {
        return [...commentsFromSettings].sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
    }
    return DEFAULT_PREDEFINED_COMMENTS;
}

/**
 * Build the complete context menu HTML
 * @param config - Context menu configuration
 * @param aiMenuConfig - AI menu configuration from settings
 * @param predefinedComments - Predefined comments from settings
 * @returns Complete context menu HTML
 */
export function buildContextMenuHTML(
    config: ContextMenuConfig = DEFAULT_CONFIG,
    aiMenuConfig?: SerializedAIMenuConfig,
    predefinedComments?: SerializedPredefinedComment[]
): string {
    const mergedConfig = { ...DEFAULT_CONFIG, ...config };
    const parts: string[] = [];

    // Clipboard items (if enabled)
    if (mergedConfig.enableClipboardItems) {
        parts.push(buildClipboardItemsHTML(mergedConfig));
        parts.push(`<div class="${getClassName('context-menu-separator', mergedConfig)}"></div>`);
    }

    // Add Comment item
    parts.push(buildAddCommentItemHTML(mergedConfig));

    // Predefined Comments submenu
    parts.push(buildPredefinedMenuItemHTML(predefinedComments, mergedConfig));

    // Ask AI separator and menus
    parts.push(`<div class="${getClassName('context-menu-separator', mergedConfig)}" id="askAISeparator"></div>`);
    parts.push(buildAIMenuItemHTML(aiMenuConfig, 'comment', mergedConfig));
    parts.push(buildAIMenuItemHTML(aiMenuConfig, 'interactive', mergedConfig));

    // Wrap in container
    const menuClass = getClassName('context-menu', mergedConfig);
    const style = `min-width: ${mergedConfig.minWidth}px; border-radius: ${mergedConfig.borderRadius}px;`;

    return `<div class="${menuClass}" id="contextMenu" style="display: none; ${style}">
        ${parts.join('')}
    </div>`;
}

/**
 * Build preview tooltip HTML
 * @param config - Context menu configuration
 * @returns Preview tooltip HTML
 */
export function buildPreviewTooltipHTML(config: ContextMenuConfig = DEFAULT_CONFIG): string {
    const mergedConfig = { ...DEFAULT_CONFIG, ...config };

    if (!mergedConfig.enablePreviewTooltips) {
        return '';
    }

    return `<div class="predefined-comment-preview" id="predefinedPreview" style="display: none;">
        <div class="preview-header">Preview</div>
        <div class="preview-content"></div>
    </div>`;
}

/**
 * Build prompt file submenu HTML
 * @param promptFiles - The prompt files to display
 * @param config - Context menu configuration
 * @returns HTML string for prompt file submenu items
 */
export function buildPromptFileSubmenuHTML(
    promptFiles: PromptFileInfo[],
    config: ContextMenuConfig = DEFAULT_CONFIG
): string {
    const mergedConfig = { ...DEFAULT_CONFIG, ...config };

    if (!promptFiles || promptFiles.length === 0) {
        return `<div class="${getClassName('context-menu-item', mergedConfig)} context-menu-empty" disabled>
            <span class="menu-icon">📝</span>No prompt files found
        </div>
        <div class="${getClassName('context-menu-item', mergedConfig)} context-menu-hint" disabled>
            <span class="menu-icon">💡</span>Add .prompt.md files to chat.promptFilesLocations
        </div>`;
    }

    return promptFiles.map(file => {
        const itemClass = `${getClassName('context-menu-item', mergedConfig)} prompt-file-item`;
        const dataPath = `data-path="${encodeURIComponent(file.absolutePath)}"`;
        const title = `title="${file.relativePath}"`;
        
        const icon = `<span class="menu-icon">📄</span>`;
        const label = mergedConfig.richMenuItems
            ? `<span class="${getClassName('context-menu-label', mergedConfig)}">${file.name}</span>`
            : file.name;
        const source = `<span class="menu-hint">${file.sourceFolder}</span>`;

        return `<div class="${itemClass}" ${dataPath} ${title}>${icon}${label}${source}</div>`;
    }).join('');
}

/**
 * Build skill submenu HTML
 * @param skills - The skills to display
 * @param config - Context menu configuration
 * @returns HTML string for skill submenu items
 */
export function buildSkillSubmenuHTML(
    skills: SkillInfo[],
    config: ContextMenuConfig = DEFAULT_CONFIG
): string {
    const mergedConfig = { ...DEFAULT_CONFIG, ...config };

    if (!skills || skills.length === 0) {
        return `<div class="${getClassName('context-menu-item', mergedConfig)} context-menu-empty" disabled>
            <span class="menu-icon">🎯</span>No skills found
        </div>
        <div class="${getClassName('context-menu-item', mergedConfig)} context-menu-hint" disabled>
            <span class="menu-icon">💡</span>Add skills to .github/skills/
        </div>`;
    }

    return skills.map(skill => {
        const itemClass = `${getClassName('context-menu-item', mergedConfig)} skill-item`;
        const dataName = `data-skill-name="${encodeURIComponent(skill.name)}"`;
        const dataPath = `data-skill-path="${encodeURIComponent(skill.absolutePath)}"`;
        // Use description for tooltip if available, otherwise use relative path
        const tooltipText = skill.description 
            ? `${skill.name}: ${skill.description}` 
            : skill.relativePath;
        const title = `title="${tooltipText.replace(/"/g, '&quot;')}"`;
        
        const icon = `<span class="menu-icon">🎯</span>`;
        const label = mergedConfig.richMenuItems
            ? `<span class="${getClassName('context-menu-label', mergedConfig)}">${skill.name}</span>`
            : skill.name;

        return `<div class="${itemClass}" ${dataName} ${dataPath} ${title}>${icon}${label}</div>`;
    }).join('');
}

/**
 * Build custom instruction dialog HTML
 * @param config - Context menu configuration
 * @returns Custom instruction dialog HTML
 */
export function buildCustomInstructionDialogHTML(config: ContextMenuConfig = DEFAULT_CONFIG): string {
    const mergedConfig = { ...DEFAULT_CONFIG, ...config };
    const classPrefix = mergedConfig.classPrefix;

    const dialogClass = classPrefix ? `${classPrefix}-custom-instruction-dialog` : 'custom-instruction-dialog';
    const headerClass = classPrefix ? `${classPrefix}-custom-instruction-header` : 'custom-instruction-header';
    const titleClass = classPrefix ? `${classPrefix}-custom-instruction-title` : 'custom-instruction-title';
    const closeClass = classPrefix ? `${classPrefix}-custom-instruction-close` : 'custom-instruction-close';
    const selectionClass = classPrefix ? `${classPrefix}-custom-instruction-selection` : 'custom-instruction-selection';
    const footerClass = classPrefix ? `${classPrefix}-custom-instruction-footer` : 'custom-instruction-footer';

    return `<div class="${dialogClass}" id="customInstructionDialog" style="display: none;">
        <div class="${headerClass}">
            <span class="${titleClass}">🤖 Custom AI Instruction</span>
            <button class="${closeClass}" id="customInstructionClose">×</button>
        </div>
        <div class="${selectionClass}" id="customInstructionSelection"></div>
        <textarea id="customInstructionInput" placeholder="Enter your instruction for the AI (e.g., 'Explain the security implications')" rows="3"></textarea>
        <div class="${footerClass}">
            <button id="customInstructionCancelBtn" class="btn btn-secondary btn-sm">Cancel</button>
            <button id="customInstructionSubmitBtn" class="btn btn-primary btn-sm">Ask AI</button>
        </div>
    </div>`;
}
