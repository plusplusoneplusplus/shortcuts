/**
 * AIProcessDocumentProvider - Provides read-only documents for AI process details
 *
 * Uses a virtual document scheme (ai-process:) to display process details
 * without prompting to save when closing.
 *
 * Refactored to use the shared ReadOnlyDocumentProvider with DynamicContentStrategy.
 */

import * as fs from 'fs';
import * as vscode from 'vscode';
import { AIProcess, IAIProcessManager } from './';
import {
    createSchemeUri,
    DynamicContentStrategy,
    getExtensionLogger,
    LogCategory,
    ReadOnlyDocumentProvider,
} from '../shared';

/**
 * URI scheme for AI process documents
 */
export const AI_PROCESS_SCHEME = 'ai-process';

/**
 * Provides read-only content for AI process details.
 *
 * Refactored to use the shared ReadOnlyDocumentProvider with DynamicContentStrategy,
 * which allows for reactive content updates when processes change.
 */
export class AIProcessDocumentProvider
    implements vscode.TextDocumentContentProvider, vscode.Disposable
{
    private readonly processManager: IAIProcessManager;
    private readonly provider: ReadOnlyDocumentProvider;
    private readonly _onDidChange = new vscode.EventEmitter<vscode.Uri>();
    private readonly processChangeListener: vscode.Disposable;

    readonly onDidChange: vscode.Event<vscode.Uri>;

    constructor(processManager: IAIProcessManager) {
        this.processManager = processManager;
        this.provider = new ReadOnlyDocumentProvider();

        // Create dynamic strategy that retrieves content from the process manager
        const strategy = new DynamicContentStrategy<IAIProcessManager>({
            getContent: (uri, manager) => {
                if (!manager) {
                    return '# Process Not Found\n\nThe requested AI process could not be found.';
                }
                const processId = uri.path.replace(/\.md$/, '');
                const process = manager.getProcess(processId);

                if (!process) {
                    return '# Process Not Found\n\nThe requested AI process could not be found.';
                }

                return this.formatProcessContent(process);
            },
            onChange: this._onDidChange.event,
            context: processManager,
        });

        this.provider.registerScheme(AI_PROCESS_SCHEME, strategy);
        this.onDidChange = this.provider.onDidChange;

        // Listen for process changes to update documents
        this.processChangeListener = this.processManager.onDidChangeProcesses(
            (event) => {
                if (event.process) {
                    const uri = this.createUri(event.process.id);
                    this._onDidChange.fire(uri);
                }
            }
        );
    }

    /**
     * Create a URI for viewing a process
     */
    createUri(processId: string): vscode.Uri {
        return createSchemeUri(AI_PROCESS_SCHEME, `${processId}.md`);
    }

    /**
     * Provide document content for a process
     */
    provideTextDocumentContent(uri: vscode.Uri): string | Thenable<string> {
        return this.provider.provideTextDocumentContent(uri);
    }

    /**
     * Format process details as markdown (main entry point)
     */
    private formatProcessContent(process: AIProcess): string {
        const lines: string[] = [];

        lines.push(`# AI Process Details`);
        lines.push('');

        // Format the main process
        this.formatSingleProcess(process, lines, 2);

        // For group processes (pipeline-execution, code-review-group), show child process details
        if (process.type === 'pipeline-execution' || process.type === 'code-review-group') {
            const childProcesses = this.processManager.getChildProcesses(process.id);
            if (childProcesses.length > 0) {
                lines.push('');
                lines.push('---');
                lines.push('');
                lines.push(`# Child Processes (${childProcesses.length} items)`);
                lines.push('');

                for (let i = 0; i < childProcesses.length; i++) {
                    const child = childProcesses[i];
                    lines.push(`## Item ${i + 1}: ${child.promptPreview}`);
                    lines.push('');
                    
                    // Format child process with heading level 3 (###)
                    this.formatSingleProcess(child, lines, 3);
                    
                    lines.push('---');
                    lines.push('');
                }
            }
        }

        return lines.join('\n');
    }

    /**
     * Format a single process details into markdown lines.
     * This is the unified method for formatting any process (parent or child).
     * 
     * @param process The process to format
     * @param lines The array to append formatted lines to
     * @param headingLevel The markdown heading level to use (2 for ##, 3 for ###, etc.)
     */
    private formatSingleProcess(process: AIProcess, lines: string[], headingLevel: number): void {
        const h = '#'.repeat(headingLevel);
        const subH = '#'.repeat(headingLevel + 1);

        // Status section
        lines.push(`${h} Status`);
        const statusEmoji = this.getStatusEmoji(process.status);
        lines.push(`${statusEmoji} **${process.status.charAt(0).toUpperCase() + process.status.slice(1)}**`);
        lines.push('');

        // Timing section
        lines.push(`${h} Timing`);
        lines.push(`- **Started:** ${process.startTime.toLocaleString()}`);
        if (process.endTime) {
            lines.push(`- **Ended:** ${process.endTime.toLocaleString()}`);
            lines.push(`- **Duration:** ${this.formatDuration(process.endTime.getTime() - process.startTime.getTime())}`);
        }
        lines.push('');

        // Result file path section (if available)
        if (process.resultFilePath) {
            lines.push(`${h} Result File`);
            lines.push(`- **Path:** \`${process.resultFilePath}\``);
            lines.push('');
        }

        // Raw stdout section (if available)
        if (process.rawStdoutFilePath) {
            lines.push(`${h} Raw Stdout`);
            lines.push(`- **Path:** \`${process.rawStdoutFilePath}\``);
            lines.push('');

            const stdoutContent = this.readRawStdout(process.rawStdoutFilePath);
            if (stdoutContent === undefined) {
                lines.push('_Raw stdout file could not be read._');
                lines.push('');
            } else {
                lines.push('```text');
                lines.push(stdoutContent);
                lines.push('```');
                lines.push('');
            }
        }

        // Prompt section (AI Input)
        lines.push(`${h} Prompt`);
        lines.push('```');
        lines.push(process.fullPrompt);
        lines.push('```');
        lines.push('');

        // AI Response section (AI Output)
        if (process.result) {
            lines.push(`${h} AI Response`);
            lines.push('');
            lines.push(process.result);
            lines.push('');
        }

        // Structured Result section (for pipeline map items with detailed output)
        if (process.structuredResult) {
            this.formatStructuredResult(process.structuredResult, lines, headingLevel, subH);
        }

        // Error section
        if (process.error) {
            lines.push(`${h} Error`);
            lines.push('```');
            lines.push(process.error);
            lines.push('```');
            lines.push('');
        }
    }

    /**
     * Format structured result section
     */
    private formatStructuredResult(structuredResult: string, lines: string[], headingLevel: number, subH: string): void {
        const h = '#'.repeat(headingLevel);
        
        lines.push(`${h} Structured Result`);
        lines.push('');
        try {
            const parsed = JSON.parse(structuredResult);
            
            // Check if this is a pipeline item result with rawResponse
            if (parsed.rawResponse !== undefined) {
                // Show input
                if (parsed.item) {
                    lines.push(`${subH} Input`);
                    lines.push('```json');
                    lines.push(JSON.stringify(parsed.item, null, 2));
                    lines.push('```');
                    lines.push('');
                }
                
                // Show output
                if (parsed.output) {
                    lines.push(`${subH} Output`);
                    lines.push('```json');
                    lines.push(JSON.stringify(parsed.output, null, 2));
                    lines.push('```');
                    lines.push('');
                }
                
                // Show success/error status
                if (parsed.success === false && parsed.error) {
                    lines.push(`${subH} Error`);
                    lines.push('```');
                    lines.push(parsed.error);
                    lines.push('```');
                    lines.push('');
                }
                
                // Show raw AI response
                if (parsed.rawResponse) {
                    lines.push(`${subH} Raw AI Response`);
                    lines.push('```');
                    lines.push(parsed.rawResponse);
                    lines.push('```');
                    lines.push('');
                }
            } else {
                // Generic structured result - show as formatted JSON
                lines.push('```json');
                lines.push(JSON.stringify(parsed, null, 2));
                lines.push('```');
                lines.push('');
            }
        } catch {
            // If parsing fails, show raw string
            lines.push('```');
            lines.push(structuredResult);
            lines.push('```');
            lines.push('');
        }
    }

    /**
     * Get emoji for process status
     */
    private getStatusEmoji(status: string): string {
        switch (status) {
            case 'running': return '🔄';
            case 'completed': return '✅';
            case 'failed': return '❌';
            case 'cancelled': return '🚫';
            default: return '○';
        }
    }

    /**
     * Format duration in human readable format
     */
    private formatDuration(ms: number): string {
        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);

        if (hours > 0) {
            return `${hours}h ${minutes % 60}m`;
        }
        if (minutes > 0) {
            return `${minutes}m ${seconds % 60}s`;
        }
        return `${seconds}s`;
    }

    /**
     * Open a process in a read-only document
     */
    async openProcess(processId: string): Promise<void> {
        const uri = this.createUri(processId);
        const doc = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(doc, { preview: true });
    }

    private readRawStdout(filePath: string): string | undefined {
        try {
            if (!fs.existsSync(filePath)) {
                return undefined;
            }
            return fs.readFileSync(filePath, 'utf8');
        } catch (error) {
            getExtensionLogger().error(LogCategory.AI, 'Failed to read raw stdout file', error instanceof Error ? error : undefined, { filePath });
            return undefined;
        }
    }

    dispose(): void {
        this._onDidChange.dispose();
        this.processChangeListener.dispose();
        this.provider.dispose();
    }
}
