/**
 * AI Command Registry
 *
 * Central registry for managing configurable AI commands.
 * Loads commands from VSCode settings and provides command lookup.
 */

import * as vscode from 'vscode';
import { AICommand, DEFAULT_AI_COMMANDS, serializeCommands, SerializedAICommand } from './ai-command-types';
import { DEFAULT_PROMPTS } from './types';

/**
 * Singleton registry for AI commands
 */
export class AICommandRegistry {
    private static instance: AICommandRegistry | null = null;
    private commands: Map<string, AICommand> = new Map();
    private disposables: vscode.Disposable[] = [];

    private readonly _onDidChange = new vscode.EventEmitter<void>();
    readonly onDidChange: vscode.Event<void> = this._onDidChange.event;

    private constructor() {
        this.loadFromSettings();
        this.watchSettings();
    }

    /**
     * Get the singleton instance
     */
    public static getInstance(): AICommandRegistry {
        if (!AICommandRegistry.instance) {
            AICommandRegistry.instance = new AICommandRegistry();
        }
        return AICommandRegistry.instance;
    }

    /**
     * Dispose the registry (for testing or extension deactivation)
     */
    public static dispose(): void {
        if (AICommandRegistry.instance) {
            AICommandRegistry.instance.disposables.forEach(d => d.dispose());
            AICommandRegistry.instance._onDidChange.dispose();
            AICommandRegistry.instance = null;
        }
    }

    /**
     * Load commands from VSCode settings
     */
    private loadFromSettings(): void {
        this.commands.clear();

        const config = vscode.workspace.getConfiguration('workspaceShortcuts.aiService');
        const customCommands = config.get<AICommand[]>('commands');

        // Use custom commands if configured and non-empty, otherwise use defaults
        const commandsToLoad = (customCommands && customCommands.length > 0)
            ? customCommands
            : DEFAULT_AI_COMMANDS;

        // Validate and load each command
        for (const cmd of commandsToLoad) {
            if (this.validateCommand(cmd)) {
                this.commands.set(cmd.id, {
                    ...cmd,
                    // Ensure defaults for optional fields
                    order: cmd.order ?? 100,
                    commentType: cmd.commentType ?? 'ai-clarification',
                    responseLabel: cmd.responseLabel ?? '🤖 **AI Response:**'
                });
            } else {
                console.warn(`[AICommandRegistry] Invalid command configuration:`, cmd);
            }
        }

        // Ensure there's always at least one command (use defaults as fallback)
        if (this.commands.size === 0) {
            for (const cmd of DEFAULT_AI_COMMANDS) {
                this.commands.set(cmd.id, cmd);
            }
        }
    }

    /**
     * Validate a command configuration
     */
    private validateCommand(cmd: unknown): cmd is AICommand {
        if (!cmd || typeof cmd !== 'object') {
            return false;
        }

        const c = cmd as Record<string, unknown>;

        // Required fields
        if (typeof c.id !== 'string' || c.id.trim() === '') {
            return false;
        }
        if (typeof c.label !== 'string' || c.label.trim() === '') {
            return false;
        }
        if (typeof c.prompt !== 'string') {
            return false;
        }

        // Optional fields type checking
        if (c.icon !== undefined && typeof c.icon !== 'string') {
            return false;
        }
        if (c.order !== undefined && typeof c.order !== 'number') {
            return false;
        }
        if (c.isCustomInput !== undefined && typeof c.isCustomInput !== 'boolean') {
            return false;
        }

        return true;
    }

    /**
     * Watch for settings changes
     */
    private watchSettings(): void {
        const disposable = vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('workspaceShortcuts.aiService.commands')) {
                this.loadFromSettings();
                this._onDidChange.fire();
            }
        });
        this.disposables.push(disposable);
    }

    /**
     * Get all commands sorted by order
     */
    public getCommands(): AICommand[] {
        return Array.from(this.commands.values())
            .sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
    }

    /**
     * Get a command by ID
     */
    public getCommand(id: string): AICommand | undefined {
        return this.commands.get(id);
    }

    /**
     * Get commands serialized for webview
     */
    public getSerializedCommands(): SerializedAICommand[] {
        return serializeCommands(this.getCommands());
    }

    /**
     * Get the prompt for a command, optionally with custom instruction override
     */
    public getPromptForCommand(commandId: string, customInstruction?: string): string {
        const command = this.getCommand(commandId);
        if (!command) {
            // Fallback to default clarify prompt
            return DEFAULT_PROMPTS.clarify;
        }

        // For custom input commands, use the provided custom instruction
        if (command.isCustomInput && customInstruction) {
            return customInstruction;
        }

        return command.prompt;
    }

    /**
     * Get the response label for a command
     */
    public getResponseLabel(commandId: string): string {
        const command = this.getCommand(commandId);
        return command?.responseLabel ?? '🤖 **AI Response:**';
    }

    /**
     * Get the comment type for a command
     */
    public getCommentType(commandId: string): 'ai-clarification' | 'ai-critique' | 'ai-suggestion' | 'ai-question' {
        const command = this.getCommand(commandId);
        return command?.commentType ?? 'ai-clarification';
    }
}

/**
 * Get the singleton instance (convenience function)
 */
export function getAICommandRegistry(): AICommandRegistry {
    return AICommandRegistry.getInstance();
}
