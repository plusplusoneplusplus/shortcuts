import * as vscode from 'vscode';
import { ConfigurationManager } from '../configuration-manager';

/**
 * Provides a virtual file system for notes
 * Allows notes to be edited like regular files in the main editor
 */
export class NoteFileSystemProvider implements vscode.FileSystemProvider {
    private _emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
    readonly onDidChangeFile = this._emitter.event;
    private readonly MAX_RETRIES = 5;
    private readonly RETRY_DELAY_MS = 200;

    constructor(private configurationManager: ConfigurationManager) { }

    watch(uri: vscode.Uri): vscode.Disposable {
        // We don't need file watching for notes
        return new vscode.Disposable(() => { });
    }

    /**
     * Helper method to retry an operation with exponential backoff
     * Useful for handling cases where configuration might not be loaded yet during VSCode restart
     */
    private async retryWithBackoff<T>(
        operation: () => Promise<T>,
        retries: number = this.MAX_RETRIES
    ): Promise<T> {
        for (let attempt = 0; attempt < retries; attempt++) {
            try {
                return await operation();
            } catch (error) {
                // If it's a FileSystemError, don't retry (file actually doesn't exist)
                if (error instanceof vscode.FileSystemError) {
                    throw error;
                }

                // On last attempt, throw the error
                if (attempt === retries - 1) {
                    throw error;
                }

                // Wait before retrying (exponential backoff)
                const delay = this.RETRY_DELAY_MS * Math.pow(2, attempt);
                await new Promise(resolve => setTimeout(resolve, delay));
                console.log(`Retrying operation, attempt ${attempt + 2}/${retries}...`);
            }
        }
        throw new Error('Max retries exceeded');
    }

    async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
        // Strip leading slash from path to get noteId
        const noteId = uri.path.startsWith('/') ? uri.path.substring(1) : uri.path;

        try {
            return await this.retryWithBackoff(async () => {
                // Check if note exists in configuration
                const exists = await this.configurationManager.noteExists(noteId);
                if (!exists) {
                    throw vscode.FileSystemError.FileNotFound(uri);
                }

                // Get content to determine size
                const content = await this.configurationManager.getNoteContent(noteId);

                // Return basic file stats
                return {
                    type: vscode.FileType.File,
                    ctime: Date.now(),
                    mtime: Date.now(),
                    size: Buffer.from(content, 'utf8').length
                };
            });
        } catch (error) {
            // If note doesn't exist or any error occurs, throw FileNotFound error
            if (error instanceof vscode.FileSystemError) {
                throw error;
            }
            console.error('Error in stat after retries:', error);
            throw vscode.FileSystemError.FileNotFound(uri);
        }
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
            return await this.retryWithBackoff(async () => {
                // First check if note exists in configuration
                const exists = await this.configurationManager.noteExists(noteId);
                if (!exists) {
                    throw vscode.FileSystemError.FileNotFound(uri);
                }

                // Get the note content
                const content = await this.configurationManager.getNoteContent(noteId);
                return Buffer.from(content, 'utf8');
            });
        } catch (error) {
            console.error('Error reading note:', error);
            // Throw FileNotFound error so VSCode handles it properly
            if (error instanceof vscode.FileSystemError) {
                throw error;
            }
            throw vscode.FileSystemError.FileNotFound(uri);
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
    // Static flag to track if the provider is already registered
    // This prevents double registration in test environments
    private static providerRegistered = false;

    constructor(
        private configurationManager: ConfigurationManager,
        private context: vscode.ExtensionContext
    ) {
        // Register the file system provider (only once per process)
        this.fileSystemProvider = new NoteFileSystemProvider(configurationManager);
        if (!NoteDocumentManager.providerRegistered) {
            try {
                const providerDisposable = vscode.workspace.registerFileSystemProvider(
                    'shortcuts-note',
                    this.fileSystemProvider,
                    { isCaseSensitive: true, isReadonly: false }
                );
                context.subscriptions.push(providerDisposable);
                NoteDocumentManager.providerRegistered = true;
            } catch (error) {
                // Provider might already be registered (e.g., in tests)
                if (error instanceof Error && error.message.includes('already registered')) {
                    console.log('Note file system provider already registered, skipping registration');
                } else {
                    throw error;
                }
            }
        }
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

