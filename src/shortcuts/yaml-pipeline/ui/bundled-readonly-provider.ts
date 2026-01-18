/**
 * Read-only Document Provider for Bundled Pipelines
 * 
 * Provides a virtual document scheme that displays bundled pipeline files
 * as read-only content. This prevents users from accidentally editing
 * bundled pipelines that ship with the extension.
 */

import * as vscode from 'vscode';
import * as fs from 'fs';

export const BUNDLED_PIPELINE_SCHEME = 'bundled-pipeline';

/**
 * Text document content provider for bundled pipelines.
 * Files opened with this scheme are read-only.
 */
export class BundledPipelineContentProvider implements vscode.TextDocumentContentProvider {
    private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
    readonly onDidChange = this._onDidChange.event;

    /**
     * Provide the content of a bundled pipeline file.
     * The URI path contains the actual file path.
     */
    provideTextDocumentContent(uri: vscode.Uri): string {
        const filePath = uri.path;
        
        try {
            return fs.readFileSync(filePath, 'utf-8');
        } catch (error) {
            return `// Error loading bundled pipeline: ${error instanceof Error ? error.message : 'Unknown error'}`;
        }
    }

    /**
     * Refresh the content of a document
     */
    refresh(uri: vscode.Uri): void {
        this._onDidChange.fire(uri);
    }
}

/**
 * Create a read-only URI for a bundled pipeline file
 */
export function createBundledPipelineUri(filePath: string): vscode.Uri {
    return vscode.Uri.from({
        scheme: BUNDLED_PIPELINE_SCHEME,
        path: filePath
    });
}

/**
 * Register the bundled pipeline content provider
 */
export function registerBundledPipelineProvider(context: vscode.ExtensionContext): BundledPipelineContentProvider {
    const provider = new BundledPipelineContentProvider();
    
    context.subscriptions.push(
        vscode.workspace.registerTextDocumentContentProvider(BUNDLED_PIPELINE_SCHEME, provider)
    );
    
    return provider;
}
