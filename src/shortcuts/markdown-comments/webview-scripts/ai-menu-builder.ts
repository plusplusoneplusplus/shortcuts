/**
 * AI Menu Builder
 *
 * Builds the AI context menu dynamically based on configured commands.
 */

import { SerializedAICommand } from './types';

/**
 * Default AI commands when none are configured
 */
const DEFAULT_AI_COMMANDS: SerializedAICommand[] = [
    {
        id: 'clarify',
        label: 'Clarify',
        icon: '💡',
        order: 1
    },
    {
        id: 'go-deeper',
        label: 'Go Deeper',
        icon: '🔍',
        order: 2
    },
    {
        id: 'custom',
        label: 'Custom...',
        icon: '💬',
        order: 99,
        isCustomInput: true
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
 * Build the AI submenu HTML dynamically
 */
export function buildAISubmenuHTML(commands: SerializedAICommand[]): string {
    const items = commands.map(cmd => {
        const icon = cmd.icon ? `<span class="menu-icon">${cmd.icon}</span>` : '';
        const dataCustomInput = cmd.isCustomInput ? 'data-custom-input="true"' : '';
        return `<div class="context-menu-item ask-ai-item" data-command-id="${cmd.id}" ${dataCustomInput}>
            ${icon}${cmd.label}
        </div>`;
    });

    return items.join('');
}

/**
 * Update the AI submenu in the DOM
 */
export function updateAISubmenu(submenuElement: HTMLElement, commands: SerializedAICommand[]): void {
    submenuElement.innerHTML = buildAISubmenuHTML(commands);
}

/**
 * Attach click handlers to AI submenu items
 */
export function attachAISubmenuHandlers(
    submenuElement: HTMLElement,
    onCommand: (commandId: string, isCustomInput: boolean) => void
): void {
    submenuElement.querySelectorAll('.ask-ai-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.stopPropagation();
            const element = item as HTMLElement;
            const commandId = element.dataset.commandId || '';
            const isCustomInput = element.dataset.customInput === 'true';
            onCommand(commandId, isCustomInput);
        });
    });
}

/**
 * Check if a command requires custom input
 */
export function isCustomInputCommand(commands: SerializedAICommand[], commandId: string): boolean {
    const cmd = commands.find(c => c.id === commandId);
    return cmd?.isCustomInput === true;
}
