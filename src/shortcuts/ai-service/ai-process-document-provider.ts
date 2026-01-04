/**
 * AIProcessDocumentProvider - Provides read-only documents for AI process details
 *
 * Uses a virtual document scheme (ai-process:) to display process details
 * without prompting to save when closing.
 */

import * as vscode from 'vscode';
import { AIProcess, AIProcessManager } from './';

/**
 * URI scheme for AI process documents
 */
export const AI_PROCESS_SCHEME = 'ai-process';

/**
 * Provides read-only content for AI process details
 */
export class AIProcessDocumentProvider implements vscode.TextDocumentContentProvider {
    private processManager: AIProcessManager;
    private _onDidChange = new vscode.EventEmitter<vscode.Uri>();

    readonly onDidChange = this._onDidChange.event;

    constructor(processManager: AIProcessManager) {
        this.processManager = processManager;

        // Listen for process changes to update documents
        this.processManager.onDidChangeProcesses((event) => {
            if (event.process) {
                const uri = this.createUri(event.process.id);
                this._onDidChange.fire(uri);
            }
        });
    }

    /**
     * Create a URI for viewing a process
     */
    createUri(processId: string): vscode.Uri {
        return vscode.Uri.parse(`${AI_PROCESS_SCHEME}:${processId}.md`);
    }

    /**
     * Provide document content for a process
     */
    provideTextDocumentContent(uri: vscode.Uri): string {
        // Extract process ID from URI (remove .md extension)
        const processId = uri.path.replace(/\.md$/, '');
        const process = this.processManager.getProcess(processId);

        if (!process) {
            return '# Process Not Found\n\nThe requested AI process could not be found.';
        }

        return this.formatProcessContent(process);
    }

    /**
     * Format process details as markdown
     */
    private formatProcessContent(process: AIProcess): string {
        const lines: string[] = [];

        lines.push(`# AI Process Details`);
        lines.push('');

        // Status section
        lines.push(`## Status`);
        const statusEmoji = process.status === 'running' ? '🔄' :
            process.status === 'completed' ? '✅' :
            process.status === 'failed' ? '❌' : '🚫';
        lines.push(`${statusEmoji} **${process.status.charAt(0).toUpperCase() + process.status.slice(1)}**`);
        lines.push('');

        // Timing section
        lines.push(`## Timing`);
        lines.push(`- **Started:** ${process.startTime.toLocaleString()}`);
        if (process.endTime) {
            lines.push(`- **Ended:** ${process.endTime.toLocaleString()}`);
            const duration = process.endTime.getTime() - process.startTime.getTime();
            const seconds = Math.floor(duration / 1000);
            const minutes = Math.floor(seconds / 60);
            const hours = Math.floor(minutes / 60);
            let durationStr: string;
            if (hours > 0) {
                durationStr = `${hours}h ${minutes % 60}m`;
            } else if (minutes > 0) {
                durationStr = `${minutes}m ${seconds % 60}s`;
            } else {
                durationStr = `${seconds}s`;
            }
            lines.push(`- **Duration:** ${durationStr}`);
        }
        lines.push('');

        // Result file path section (if available)
        if (process.resultFilePath) {
            lines.push(`## Result File`);
            lines.push(`- **Path:** \`${process.resultFilePath}\``);
            lines.push('');
        }

        // Prompt section
        lines.push(`## Prompt`);
        lines.push('```');
        lines.push(process.fullPrompt);
        lines.push('```');
        lines.push('');

        // AI Response section
        if (process.result) {
            lines.push(`## AI Response`);
            lines.push('');
            lines.push(process.result);
            lines.push('');
        }

        // Error section
        if (process.error) {
            lines.push(`## Error`);
            lines.push('```');
            lines.push(process.error);
            lines.push('```');
        }

        return lines.join('\n');
    }

    /**
     * Open a process in a read-only document
     */
    async openProcess(processId: string): Promise<void> {
        const uri = this.createUri(processId);
        const doc = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(doc, { preview: true });
    }

    dispose(): void {
        this._onDidChange.dispose();
    }
}
