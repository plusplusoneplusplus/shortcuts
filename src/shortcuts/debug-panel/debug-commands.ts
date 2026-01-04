/**
 * Debug command definitions for the Debug Panel
 * These commands trigger VSCode Copilot Chat and related features
 */

export interface DebugCommand {
    id: string;
    label: string;
    description?: string;
    tooltip?: string;
    icon: string;
    commandId: string;
    args?: any[];
}

/**
 * Get the default list of debug commands for the panel
 * These are common Copilot Chat commands that developers frequently use
 */
export function getDefaultDebugCommands(): DebugCommand[] {
    return [
        {
            id: 'new-chat-with-prompt',
            label: 'New Chat with Prompt',
            description: 'Ask something...',
            tooltip: 'Start a new chat with a custom prompt\n\nCommand: workbench.action.chat.open',
            icon: 'add',
            commandId: 'debugPanel.newChatWithPrompt'
        },
        {
            id: 'open-chat',
            label: 'Open Chat',
            description: 'Continue existing chat',
            tooltip: 'Open the Copilot Chat panel to continue existing conversation\n\nCommand: workbench.panel.chat.view.copilot.focus',
            icon: 'comment-discussion',
            commandId: 'workbench.panel.chat.view.copilot.focus'
        },
        {
            id: 'new-chat-conversation',
            label: 'New Chat Conversation',
            description: 'Start fresh',
            tooltip: 'Start a new chat conversation with a custom prompt\n\nCommand: workbench.action.chat.newChat',
            icon: 'comment-unresolved',
            commandId: 'debugPanel.newChatConversation'
        }
    ];
}

