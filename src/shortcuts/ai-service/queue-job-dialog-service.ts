/**
 * Queue Job Dialog Service
 *
 * Provides a webview-based dialog for queuing AI jobs.
 * Uses queue-job-dialog.ts for HTML generation.
 * Supports two modes:
 * 1. Prompt: User provides a freeform prompt
 * 2. Skill: User selects a skill and optionally provides context
 */

import * as vscode from 'vscode';
import { getAvailableModels, getLastUsedAIModel, saveLastUsedAIModel } from './ai-config-helpers';
import { getSkillNames } from '../shared/skill-files-utils';
import { getWorkspaceRoot } from '../shared/workspace-utils';
import {
    QueueJobMode,
    QueueJobDialogResult,
    QueueJobOptions,
    getQueueJobDialogHtml
} from './queue-job-dialog';

/**
 * Service for showing the Queue Job dialog as a webview panel
 */
export class QueueJobDialogService {
    private readonly extensionUri: vscode.Uri;
    private readonly context: vscode.ExtensionContext;
    private currentPanel: vscode.WebviewPanel | undefined;
    private pendingResolve: ((result: QueueJobDialogResult) => void) | undefined;

    constructor(extensionUri: vscode.Uri, context: vscode.ExtensionContext) {
        this.extensionUri = extensionUri;
        this.context = context;
    }

    /**
     * Show the Queue Job dialog
     * @returns Dialog result with options or cancelled flag
     */
    async showDialog(options?: {
        initialMode?: QueueJobMode;
    }): Promise<QueueJobDialogResult> {
        if (this.currentPanel) {
            this.currentPanel.reveal(vscode.ViewColumn.Active);
            return { cancelled: true, options: null };
        }

        return new Promise<QueueJobDialogResult>((resolve) => {
            this.pendingResolve = resolve;
            this.createWebviewPanel(options);
        });
    }

    /**
     * Create and show the webview panel
     */
    private async createWebviewPanel(options?: {
        initialMode?: QueueJobMode;
    }): Promise<void> {
        const panel = vscode.window.createWebviewPanel(
            'queueJobDialog',
            'Queue AI Job',
            { viewColumn: vscode.ViewColumn.Active, preserveFocus: false },
            {
                enableScripts: true,
                retainContextWhenHidden: false,
                localResourceRoots: [
                    vscode.Uri.joinPath(this.extensionUri, 'media')
                ]
            }
        );

        this.currentPanel = panel;

        const models = getAvailableModels();
        const defaultModel = getLastUsedAIModel(this.context);
        const workspaceRoot = getWorkspaceRoot();
        const skills = await getSkillNames(workspaceRoot);

        panel.webview.html = getQueueJobDialogHtml(
            panel.webview,
            this.extensionUri,
            models,
            defaultModel,
            skills,
            workspaceRoot || '',
            options?.initialMode
        );

        panel.webview.onDidReceiveMessage(
            (message) => this.handleMessage(message),
            undefined
        );

        panel.onDidDispose(() => {
            this.currentPanel = undefined;
            if (this.pendingResolve) {
                this.pendingResolve({ cancelled: true, options: null });
                this.pendingResolve = undefined;
            }
        });
    }

    /**
     * Handle messages from the webview
     */
    private handleMessage(message: { type: string; [key: string]: any }): void {
        switch (message.type) {
            case 'submit':
                if (this.pendingResolve) {
                    const result: QueueJobOptions = {
                        mode: message.mode,
                        model: message.model,
                        priority: message.priority,
                        workingDirectory: message.workingDirectory || undefined,
                    };

                    if (message.mode === 'prompt') {
                        result.prompt = message.prompt;
                    } else {
                        result.skillName = message.skillName;
                        result.additionalContext = message.additionalContext || undefined;
                    }

                    if (message.model) {
                        saveLastUsedAIModel(this.context, message.model);
                    }

                    this.pendingResolve({
                        cancelled: false,
                        options: result
                    });
                    this.pendingResolve = undefined;
                }
                this.currentPanel?.dispose();
                break;

            case 'cancel':
                if (this.pendingResolve) {
                    this.pendingResolve({ cancelled: true, options: null });
                    this.pendingResolve = undefined;
                }
                this.currentPanel?.dispose();
                break;
        }
    }

    /**
     * Get available skill names (exposed for testing)
     */
    async getAvailableSkills(): Promise<string[]> {
        const workspaceRoot = getWorkspaceRoot();
        return getSkillNames(workspaceRoot);
    }

    /**
     * Validate the prompt text
     * @param value The prompt text
     * @returns Error message or null if valid
     */
    validatePrompt(value: string): string | null {
        if (!value || value.trim().length === 0) {
            return 'Prompt cannot be empty';
        }
        return null;
    }

    /**
     * Validate skill selection
     * @param value The skill name
     * @returns Error message or null if valid
     */
    validateSkillSelection(value: string): string | null {
        if (!value || value.trim().length === 0) {
            return 'Please select a skill';
        }
        return null;
    }
}
