/**
 * VS Code implementation of EditorHost.
 * Wraps all vscode.* API calls used by the message router.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { isMarkdownFile } from './file-path-utils';
import { EditorHost } from './editor-host';
import { ReviewEditorViewProvider } from './review-editor-view-provider';
import type { StateStore } from './state-store';

export class VscodeEditorHost implements EditorHost {
    constructor(
        private readonly webviewPanel: vscode.WebviewPanel,
        private readonly context: vscode.ExtensionContext,
        private readonly document: vscode.TextDocument,
        private readonly stateStore: StateStore
    ) {}

    // --- Notifications ---

    async showInfo(message: string, ...actions: string[]): Promise<string | undefined> {
        return vscode.window.showInformationMessage(message, ...actions);
    }

    async showWarning(message: string, options?: { modal?: boolean }, ...actions: string[]): Promise<string | undefined> {
        if (options?.modal) {
            return vscode.window.showWarningMessage(message, { modal: true }, ...actions);
        }
        return vscode.window.showWarningMessage(message, ...actions);
    }

    showError(message: string): void {
        vscode.window.showErrorMessage(message);
    }

    // --- Clipboard ---

    async copyToClipboard(text: string): Promise<void> {
        await vscode.env.clipboard.writeText(text);
    }

    // --- File operations ---

    async openFile(filePath: string, lineNumber?: number): Promise<void> {
        const fileUri = vscode.Uri.file(filePath);
        if (isMarkdownFile(filePath)) {
            await vscode.commands.executeCommand(
                'vscode.openWith',
                fileUri,
                ReviewEditorViewProvider.viewType
            );
        } else if (lineNumber !== undefined && lineNumber > 0) {
            const line = lineNumber - 1;
            const position = new vscode.Position(line, 0);
            const selection = new vscode.Selection(position, position);
            await vscode.window.showTextDocument(fileUri, { selection });
        } else {
            await vscode.window.showTextDocument(fileUri);
        }
    }

    async openExternalUrl(url: string): Promise<void> {
        await vscode.env.openExternal(vscode.Uri.parse(url));
    }

    async readFile(filePath: string): Promise<string | undefined> {
        try {
            return await fs.promises.readFile(filePath, 'utf-8');
        } catch (error) {
            console.error(`Error reading file: ${filePath}`, error);
            return undefined;
        }
    }

    async readFileLines(filePath: string, maxLines: number): Promise<{ content: string; totalLines: number } | undefined> {
        try {
            const full = await fs.promises.readFile(filePath, 'utf-8');
            const lines = full.split('\n');
            const totalLines = lines.length;
            const content = lines.slice(0, maxLines).join('\n');
            return { content, totalLines };
        } catch (error) {
            console.error(`Error reading file lines: ${filePath}`, error);
            return undefined;
        }
    }

    async fileExists(filePath: string): Promise<boolean> {
        return fs.existsSync(filePath);
    }

    // --- Document editing ---

    async replaceDocumentContent(documentUri: string, content: string): Promise<void> {
        const edit = new vscode.WorkspaceEdit();
        const fullRange = new vscode.Range(
            this.document.positionAt(0),
            this.document.positionAt(this.document.getText().length)
        );
        edit.replace(this.document.uri, fullRange, content);
        await vscode.workspace.applyEdit(edit);
    }

    // --- Dialogs ---

    async showInputBox(options: { prompt: string; placeHolder?: string; ignoreFocusOut?: boolean }): Promise<string | undefined> {
        return vscode.window.showInputBox(options);
    }

    async showQuickPick<T extends { label: string }>(
        items: T[],
        options?: { placeHolder?: string; matchOnDescription?: boolean; matchOnDetail?: boolean }
    ): Promise<T | undefined> {
        return vscode.window.showQuickPick(items, options);
    }

    // --- Webview communication ---

    postMessage(message: unknown): void {
        this.webviewPanel.webview.postMessage(message);
    }

    // --- VS Code commands ---

    async executeCommand(command: string, ...args: unknown[]): Promise<void> {
        await vscode.commands.executeCommand(command, ...args);
    }

    // --- Document creation ---

    async openUntitledDocument(content: string, language: string): Promise<void> {
        const doc = await vscode.workspace.openTextDocument({ content, language });
        await vscode.window.showTextDocument(doc, { preview: true });
    }

    // --- Image resolution ---

    resolveImageToWebviewUri(absolutePath: string): string | null {
        if (!fs.existsSync(absolutePath)) {
            return null;
        }
        const imageUri = vscode.Uri.file(absolutePath);
        return this.webviewPanel.webview.asWebviewUri(imageUri).toString();
    }

    // --- State persistence ---

    getState<T>(key: string, defaultValue: T): T {
        return this.stateStore.get<T>(key, defaultValue);
    }

    async setState(key: string, value: unknown): Promise<void> {
        await this.stateStore.update(key, value);
    }

    // --- Configuration ---

    getConfig<T>(section: string, key: string, defaultValue: T): T {
        return vscode.workspace.getConfiguration(section).get<T>(key, defaultValue);
    }
}
