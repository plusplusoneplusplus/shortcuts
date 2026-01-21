/**
 * Read-only Document Provider for Bundled Pipelines
 *
 * Provides a virtual document scheme that displays bundled pipeline files
 * as read-only content. This prevents users from accidentally editing
 * bundled pipelines that ship with the extension.
 *
 * Refactored to use the shared ReadOnlyDocumentProvider with FileContentStrategy.
 */

import * as vscode from 'vscode';
import {
    createSchemeUri,
    FileContentStrategy,
    ReadOnlyDocumentProvider,
} from '../../shared';

export const BUNDLED_PIPELINE_SCHEME = 'bundled-pipeline';

/**
 * Bundled pipeline content provider using the shared ReadOnlyDocumentProvider.
 * This is a thin wrapper that maintains backward compatibility while
 * delegating to the shared infrastructure.
 */
export class BundledPipelineContentProvider
    implements vscode.TextDocumentContentProvider, vscode.Disposable
{
    private readonly provider: ReadOnlyDocumentProvider;
    private readonly strategy: FileContentStrategy;

    readonly onDidChange: vscode.Event<vscode.Uri>;

    constructor() {
        this.provider = new ReadOnlyDocumentProvider();
        this.strategy = new FileContentStrategy({
            errorMessagePrefix: 'Error loading bundled pipeline',
        });
        this.provider.registerScheme(BUNDLED_PIPELINE_SCHEME, this.strategy);
        this.onDidChange = this.provider.onDidChange;
    }

    /**
     * Provide the content of a bundled pipeline file.
     * The URI path contains the actual file path.
     */
    provideTextDocumentContent(uri: vscode.Uri): string | Thenable<string> {
        return this.provider.provideTextDocumentContent(uri);
    }

    /**
     * Refresh the content of a document
     */
    refresh(uri: vscode.Uri): void {
        this.provider.refresh(uri);
    }

    dispose(): void {
        this.provider.dispose();
    }
}

/**
 * Create a read-only URI for a bundled pipeline file
 */
export function createBundledPipelineUri(filePath: string): vscode.Uri {
    return createSchemeUri(BUNDLED_PIPELINE_SCHEME, filePath);
}

/**
 * Register the bundled pipeline content provider
 */
export function registerBundledPipelineProvider(
    context: vscode.ExtensionContext
): BundledPipelineContentProvider {
    const provider = new BundledPipelineContentProvider();

    context.subscriptions.push(
        vscode.workspace.registerTextDocumentContentProvider(
            BUNDLED_PIPELINE_SCHEME,
            provider
        ),
        provider
    );

    return provider;
}
