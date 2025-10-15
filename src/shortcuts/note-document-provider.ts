import * as vscode from 'vscode';
import { ConfigurationManager } from './configuration-manager';

/**
 * Provides a virtual file system for notes
 * Allows notes to be edited like regular files in the main editor
 */
export class NoteFileSystemProvider implements vscode.FileSystemProvider {
    private _emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
    readonly onDidChangeFile = this._emitter.event;

    constructor(private configurationManager: ConfigurationManager) {}

    watch(uri: vscode.Uri): vscode.Disposable {
        // We don't need file watching for notes
        return new vscode.Disposable(() => {});
    }

    stat(uri: vscode.Uri): vscode.FileStat {
        // Return basic file stats
        return {
            type: vscode.FileType.File,
            ctime: Date.now(),
            mtime: Date.now(),
            size: 0
        };
    }

    readDirectory(uri: vscode.Uri): [string, vscode.FileType][] {
        throw vscode.FileSystemError.NoPermissions('Notes do not support directory operations');
    }

    createDirectory(uri: vscode.Uri): void {
        throw vscode.FileSystemError.NoPermissions('Notes do not support directory operations');
    }

    async readFile(uri: vscode.Uri): Promise<Uint8Array> {
        // Strip leading slash from path to get noteId
        const noteId = uri.path.startsWith('/') ? uri.path.substring(1) : uri.path;

        try {
            const content = await this.configurationManager.getNoteContent(noteId);
            return Buffer.from(content, 'utf8');
        } catch (error) {
            console.error('Error reading note:', error);
            return Buffer.from('', 'utf8');
        }
    }

    async writeFile(uri: vscode.Uri, content: Uint8Array, options: { create: boolean, overwrite: boolean }): Promise<void> {
        // Strip leading slash from path to get noteId
        const noteId = uri.path.startsWith('/') ? uri.path.substring(1) : uri.path;

        try {
            const textContent = Buffer.from(content).toString('utf8');
            await this.configurationManager.saveNoteContent(noteId, textContent);

            // Notify that the file changed
            this._emitter.fire([{
                type: vscode.FileChangeType.Changed,
                uri
            }]);
        } catch (error) {
            console.error('Error writing note:', error);
            throw vscode.FileSystemError.Unavailable('Failed to save note');
        }
    }

    delete(uri: vscode.Uri): void {
        // Deleting is handled through the commands, not the file system
        throw vscode.FileSystemError.NoPermissions('Use the delete command to remove notes');
    }

    rename(oldUri: vscode.Uri, newUri: vscode.Uri): void {
        // Renaming is handled through the commands, not the file system
        throw vscode.FileSystemError.NoPermissions('Use the rename command to rename notes');
    }

    /**
     * Dispose resources
     */
    dispose(): void {
        this._emitter.dispose();
    }
}

/**
 * Manages note document lifecycle and saving
 */
export class NoteDocumentManager {
    private fileSystemProvider: NoteFileSystemProvider;

    constructor(
        private configurationManager: ConfigurationManager,
        private context: vscode.ExtensionContext
    ) {
        // Register the file system provider
        this.fileSystemProvider = new NoteFileSystemProvider(configurationManager);
        const providerDisposable = vscode.workspace.registerFileSystemProvider(
            'shortcuts-note',
            this.fileSystemProvider,
            { isCaseSensitive: true, isReadonly: false }
        );
        context.subscriptions.push(providerDisposable);
    }

    /**
     * Open a note in the editor
     * @param noteId ID of the note
     * @param noteName Name of the note (for display)
     */
    async openNote(noteId: string, noteName: string): Promise<void> {
        try {
            // Create URI for the note - use path format without authority
            const uri = vscode.Uri.parse(`shortcuts-note:/${noteId}?name=${encodeURIComponent(noteName)}`);

            // Open the document
            const doc = await vscode.workspace.openTextDocument(uri);
            await vscode.window.showTextDocument(doc, {
                preview: false,
                viewColumn: vscode.ViewColumn.One
            });
        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            console.error('Error opening note:', err);
            vscode.window.showErrorMessage(`Failed to open note: ${err.message}`);
        }
    }

    /**
     * Dispose resources
     */
    dispose(): void {
        this.fileSystemProvider.dispose();
    }
}
