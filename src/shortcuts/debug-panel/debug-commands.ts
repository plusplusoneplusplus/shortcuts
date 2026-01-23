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
            id: 'test-copilot-sdk',
            label: 'Test Copilot SDK',
            description: 'Experiment with SDK',
            tooltip: 'Test GitHub Copilot SDK with a custom prompt\n\nSend a message to Copilot CLI via the SDK and see the response',
            icon: 'beaker',
            commandId: 'debugPanel.testCopilotSDK'
        },
        {
            id: 'run-custom-command',
            label: 'Run Custom Command',
            description: 'Execute any VSCode command',
            tooltip: 'Run any VSCode command with custom parameters\n\nEnter command ID and optional key-value parameters',
            icon: 'terminal',
            commandId: 'debugPanel.runCustomCommand'
        },
        {
            id: 'read-setting',
            label: 'Read Setting',
            description: 'Get setting value by ID',
            tooltip: 'Read a VSCode setting value by its ID\n\nEnter full setting ID like "editor.fontSize" or "workspaceShortcuts.sync.enabled"',
            icon: 'settings-gear',
            commandId: 'debugPanel.readSetting'
        },
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
        },
        {
            id: 'new-background-agent',
            label: 'New Background Agent',
            description: 'Start background agent',
            tooltip: 'Open a new Copilot CLI background agent session with a custom prompt\n\nCommand: workbench.action.chat.openNewSessionEditor.copilotcli',
            icon: 'hubot',
            commandId: 'debugPanel.newBackgroundAgent'
        },
        {
            id: 'new-interactive-session',
            label: 'New Interactive Session',
            description: 'Launch external CLI',
            tooltip: 'Launch an interactive AI CLI session (Copilot or Claude) in an external terminal window\n\nThe session runs independently and can be used for interactive conversations.',
            icon: 'terminal-view-icon',
            commandId: 'interactiveSessions.start'
        }
    ];
}

