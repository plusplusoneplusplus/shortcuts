/**
 * VS Code FileWatcherFactory implementation.
 * Bridges the portable FileWatcher interface with vscode.FileSystemWatcher.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { FileWatcher, FileWatcherFactory, Disposable } from './comments-manager-base';

export function createVSCodeFileWatcherFactory(): FileWatcherFactory {
    return (configPath: string): FileWatcher => {
        const pattern = new vscode.RelativePattern(
            path.dirname(configPath),
            path.basename(configPath)
        );
        const watcher = vscode.workspace.createFileSystemWatcher(pattern);
        return {
            onDidChange: (listener: () => void): Disposable => watcher.onDidChange(listener),
            onDidCreate: (listener: () => void): Disposable => watcher.onDidCreate(listener),
            onDidDelete: (listener: () => void): Disposable => watcher.onDidDelete(listener),
            dispose: () => watcher.dispose()
        };
    };
}
