/**
 * AI Menu Builder
 *
 * Builds the AI context menu dynamically based on configured commands.
 * Supports two modes:
 * - 'comment': Ask AI to Comment - AI response is added as a comment
 * - 'interactive': Ask AI Interactively - Opens an interactive AI session
 */

import { AICommandMode, SerializedAICommand, SerializedAIMenuConfig } from './types';

/**
 * Default AI commands when none are configured
 * Note: These are fallbacks only - the actual prompts come from the extension's DEFAULT_AI_COMMANDS
 */
const DEFAULT_AI_COMMANDS: SerializedAICommand[] = [
    {
        id: 'clarify',
        label: 'Clarify',
        icon: '💡',
        order: 1,
        prompt: 'Please clarify the following snippet with more depth.'
    },
    {
        id: 'go-deeper',
        label: 'Go Deeper',
        icon: '🔍',
        order: 2,
        prompt: 'Please provide an in-depth explanation and analysis of the following snippet.'
    },
    {
        id: 'custom',
        label: 'Custom...',
        icon: '💬',
        order: 99,
        isCustomInput: true,
        prompt: 'Please explain the following snippet'
    }
];

/**
 * Get the AI commands to display in menus
 */
export function getAICommands(configuredCommands?: SerializedAICommand[]): SerializedAICommand[] {
    if (configuredCommands && configuredCommands.length > 0) {
        return [...configuredCommands].sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
    }
    return DEFAULT_AI_COMMANDS;
}

/**
 * Get AI menu configuration with both comment and interactive commands
 */
export function getAIMenuConfig(config?: SerializedAIMenuConfig): SerializedAIMenuConfig {
    if (config && config.commentCommands && config.commentCommands.length > 0) {
        return {
            commentCommands: [...config.commentCommands].sort((a, b) => (a.order ?? 100) - (b.order ?? 100)),
            interactiveCommands: [...config.interactiveCommands].sort((a, b) => (a.order ?? 100) - (b.order ?? 100))
        };
    }
    // Default: both menus use the same commands
    return {
        commentCommands: DEFAULT_AI_COMMANDS,
        interactiveCommands: DEFAULT_AI_COMMANDS
    };
}

/**
 * Build the AI submenu HTML dynamically
 * @param commands - The commands to display
 * @param mode - The mode for this menu ('comment' or 'interactive')
 */
export function buildAISubmenuHTML(commands: SerializedAICommand[], mode: AICommandMode = 'comment'): string {
    const modeClass = mode === 'interactive' ? 'ask-ai-interactive-item' : 'ask-ai-item';
    const items = commands.map(cmd => {
        const icon = cmd.icon ? `<span class="menu-icon">${cmd.icon}</span>` : '';
        const dataCustomInput = cmd.isCustomInput ? 'data-custom-input="true"' : '';
        const dataPrompt = cmd.prompt ? `data-prompt="${encodeURIComponent(cmd.prompt)}"` : '';
        return `<div class="context-menu-item ${modeClass}" data-command-id="${cmd.id}" data-mode="${mode}" ${dataCustomInput} ${dataPrompt}>
            ${icon}${cmd.label}
        </div>`;
    });

    return items.join('');
}

/**
 * Update the AI submenu in the DOM
 */
export function updateAISubmenu(submenuElement: HTMLElement, commands: SerializedAICommand[], mode: AICommandMode = 'comment'): void {
    submenuElement.innerHTML = buildAISubmenuHTML(commands, mode);
}

/**
 * Hover handler callbacks for AI submenu items
 */
export interface AISubmenuHoverHandlers {
    onHover: (description: string, element: HTMLElement) => void;
    onLeave: () => void;
}

/**
 * Attach click handlers to AI submenu items
 * @param submenuElement - The submenu element
 * @param onCommand - Callback with commandId, isCustomInput, and mode
 * @param hoverHandlers - Optional hover handlers for showing preview tooltips
 */
export function attachAISubmenuHandlers(
    submenuElement: HTMLElement,
    onCommand: (commandId: string, isCustomInput: boolean, mode: AICommandMode) => void,
    hoverHandlers?: AISubmenuHoverHandlers
): void {
    // Handle both comment and interactive items
    submenuElement.querySelectorAll('.ask-ai-item, .ask-ai-interactive-item').forEach(item => {
        const element = item as HTMLElement;

        // Click handler
        element.addEventListener('click', (e) => {
            e.stopPropagation();
            const commandId = element.dataset.commandId || '';
            const isCustomInput = element.dataset.customInput === 'true';
            const mode = (element.dataset.mode || 'comment') as AICommandMode;
            onCommand(commandId, isCustomInput, mode);
        });

        // Hover handlers for preview tooltip
        if (hoverHandlers) {
            element.addEventListener('mouseenter', () => {
                const prompt = element.dataset.prompt;
                if (prompt) {
                    hoverHandlers.onHover(decodeURIComponent(prompt), element);
                }
            });

            element.addEventListener('mouseleave', () => {
                hoverHandlers.onLeave();
            });
        }
    });
}

/**
 * Check if a command requires custom input
 */
export function isCustomInputCommand(commands: SerializedAICommand[], commandId: string): boolean {
    const cmd = commands.find(c => c.id === commandId);
    return cmd?.isCustomInput === true;
}
