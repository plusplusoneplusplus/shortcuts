/**
 * Code Review Result Viewer
 *
 * A dedicated webview panel for displaying structured code review results.
 * Implements the checkbox model UX for applying selected fixes.
 *
 * Uses shared webview utilities:
 * - WebviewSetupHelper for nonce generation and HTML escaping
 * - WebviewMessageRouter for type-safe message handling
 */

import * as path from 'path';
import * as vscode from 'vscode';
import {
    ApplyFixesResult,
    CodeReviewResult,
    FindingApplyState,
    FindingWithState,
    ReviewFinding
} from './types';
import {
    GitContentStrategy,
    ReadOnlyDocumentProvider,
} from '../shared';
import { WebviewSetupHelper, WebviewMessageRouter } from '../shared/webview/extension-webview-utils';
import { applySelectedFixes, isApplicableFinding, toFindingWithState } from './fix-applier';

/**
 * URI scheme for git snapshot provider
 */
const GIT_SNAPSHOT_SCHEME = 'git-snapshot';

/**
 * Filter mode for findings
 */
type FilterMode = 'all' | 'errors' | 'warnings' | 'suggestions';

/**
 * Message types for code review viewer webview communication
 * Note: Uses 'type' field to conform to BaseWebviewMessage interface
 */
interface CodeReviewViewerMessage {
    type: 'openFile' | 'copyFinding' | 'toggleSelection' | 'selectAll' | 'applySelected' | 'filterChange' | 'applySingle';
    file?: string;
    line?: number;
    findingId?: string;
    selected?: boolean;
    filter?: FilterMode;
}

/**
 * Virtual document provider for showing file content at a specific commit.
 *
 * Refactored to use the shared ReadOnlyDocumentProvider with GitContentStrategy.
 */
class GitSnapshotProvider
    implements vscode.TextDocumentContentProvider, vscode.Disposable
{
    private static instance: GitSnapshotProvider | undefined;
    private readonly provider: ReadOnlyDocumentProvider;
    private disposable: vscode.Disposable | undefined;

    public readonly onDidChange: vscode.Event<vscode.Uri>;

    private constructor() {
        this.provider = new ReadOnlyDocumentProvider();

        // Use GitContentStrategy with file path from query param
        const strategy = new GitContentStrategy({
            commitParam: 'commit',
            repoParam: 'repo',
            fileParam: 'file', // File path from query param, not URI path
        });

        this.provider.registerScheme(GIT_SNAPSHOT_SCHEME, strategy);
        this.onDidChange = this.provider.onDidChange;
    }

    public static getInstance(): GitSnapshotProvider {
        if (!GitSnapshotProvider.instance) {
            GitSnapshotProvider.instance = new GitSnapshotProvider();
        }
        return GitSnapshotProvider.instance;
    }

    public register(): vscode.Disposable {
        if (!this.disposable) {
            this.disposable = vscode.workspace.registerTextDocumentContentProvider(
                GIT_SNAPSHOT_SCHEME,
                this
            );
        }
        return this.disposable;
    }

    public provideTextDocumentContent(
        uri: vscode.Uri
    ): string | Thenable<string> {
        return this.provider.provideTextDocumentContent(uri);
    }

    public dispose(): void {
        this.provider.dispose();
        this.disposable?.dispose();
        GitSnapshotProvider.instance = undefined;
    }
}

/**
 * Manages the code review result viewer webview panel
 *
 * Uses shared webview utilities for consistent setup and message handling.
 * Implements the checkbox model UX for applying selected fixes.
 */
export class CodeReviewViewer {
    public static currentPanel: CodeReviewViewer | undefined;
    private readonly panel: vscode.WebviewPanel;
    private readonly setupHelper: WebviewSetupHelper;
    private readonly messageRouter: WebviewMessageRouter<CodeReviewViewerMessage>;
    private disposables: vscode.Disposable[] = [];
    private currentResult: CodeReviewResult | undefined;

    /** Findings with state for the checkbox model */
    private findingsWithState: FindingWithState[] = [];

    /** Current filter mode */
    private filterMode: FilterMode = 'all';

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
        this.panel = panel;
        this.setupHelper = new WebviewSetupHelper(extensionUri);
        this.messageRouter = new WebviewMessageRouter<CodeReviewViewerMessage>({
            logUnhandledMessages: false
        });

        // Register the git snapshot provider
        this.disposables.push(GitSnapshotProvider.getInstance().register());

        // Handle panel disposal
        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

        // Setup type-safe message routing
        this.setupMessageHandlers();

        // Connect router to panel
        this.panel.webview.onDidReceiveMessage(
            (message: CodeReviewViewerMessage) => this.messageRouter.route(message),
            null,
            this.disposables
        );
    }

    /**
     * Setup message handlers using the type-safe router
     */
    private setupMessageHandlers(): void {
        this.messageRouter
            .on('openFile', (message: CodeReviewViewerMessage) => {
                if (message.file) {
                    this.openFileLocation(message.file, message.line);
                }
            })
            .on('copyFinding', () => {
                // Handle copy to clipboard - placeholder for future implementation
            })
            .on('toggleSelection', (message: CodeReviewViewerMessage) => {
                if (message.findingId !== undefined) {
                    this.toggleFindingSelection(message.findingId, message.selected);
                }
            })
            .on('selectAll', (message: CodeReviewViewerMessage) => {
                this.selectAllFindings(message.selected ?? true);
            })
            .on('applySelected', () => {
                this.applySelectedFindings();
            })
            .on('applySingle', (message: CodeReviewViewerMessage) => {
                if (message.findingId) {
                    this.applySingleFinding(message.findingId);
                }
            })
            .on('filterChange', (message: CodeReviewViewerMessage) => {
                if (message.filter) {
                    this.filterMode = message.filter;
                    this.refreshContent();
                }
            });
    }

    /**
     * Toggle selection state for a single finding
     */
    private toggleFindingSelection(findingId: string, selected?: boolean): void {
        const finding = this.findingsWithState.find(f => f.id === findingId);
        if (finding && finding.applyState !== 'applied' && finding.applyState !== 'failed') {
            finding.applyState = selected ?? (finding.applyState !== 'selected') ? 'selected' : 'pending';
            this.refreshContent();
        }
    }

    /**
     * Select or deselect all applicable findings
     */
    private selectAllFindings(select: boolean): void {
        const filteredFindings = this.getFilteredFindings();
        for (const finding of filteredFindings) {
            if (finding.isApplicable && finding.applyState !== 'applied' && finding.applyState !== 'failed') {
                finding.applyState = select ? 'selected' : 'pending';
            }
        }
        this.refreshContent();
    }

    /**
     * Get findings filtered by current filter mode
     */
    private getFilteredFindings(): FindingWithState[] {
        return this.findingsWithState.filter(f => {
            switch (this.filterMode) {
                case 'errors':
                    return f.severity === 'error';
                case 'warnings':
                    return f.severity === 'warning';
                case 'suggestions':
                    return f.severity === 'suggestion' || f.severity === 'info';
                default:
                    return true;
            }
        });
    }

    /**
     * Get the count of selected findings
     */
    private getSelectedCount(): number {
        return this.findingsWithState.filter(f => f.applyState === 'selected').length;
    }

    /**
     * Apply a single finding
     */
    private async applySingleFinding(findingId: string): Promise<void> {
        const finding = this.findingsWithState.find(f => f.id === findingId);
        if (!finding || !finding.isApplicable) {
            return;
        }

        const showPreview = vscode.workspace.getConfiguration('workspaceShortcuts.codeReview.apply')
            .get('showPreview', true);

        const result = await applySelectedFixes([finding], {
            repositoryRoot: this.currentResult?.metadata.repositoryRoot,
            showPreview
        });

        this.updateFindingStates(result);
        this.refreshContent();
    }

    /**
     * Apply all selected findings
     */
    private async applySelectedFindings(): Promise<void> {
        const selectedFindings = this.findingsWithState.filter(f => f.applyState === 'selected');
        if (selectedFindings.length === 0) {
            vscode.window.showInformationMessage('No findings selected to apply.');
            return;
        }

        const showPreview = vscode.workspace.getConfiguration('workspaceShortcuts.codeReview.apply')
            .get('showPreview', true);

        const result = await applySelectedFixes(selectedFindings, {
            repositoryRoot: this.currentResult?.metadata.repositoryRoot,
            showPreview
        });

        this.updateFindingStates(result);
        this.refreshContent();
    }

    /**
     * Update finding states based on apply results
     */
    private updateFindingStates(result: ApplyFixesResult): void {
        for (const applyResult of result.results) {
            const finding = this.findingsWithState.find(f => f.id === applyResult.findingId);
            if (finding) {
                if (applyResult.success) {
                    finding.applyState = 'applied';
                    finding.applyError = undefined;
                } else {
                    finding.applyState = 'failed';
                    finding.applyError = applyResult.error;
                }
            }
        }
    }

    /**
     * Refresh the webview content
     */
    private refreshContent(): void {
        if (this.currentResult) {
            this.panel.webview.html = this.getHtmlContent(this.currentResult);
        }
    }

    /**
     * Create or show the code review viewer
     */
    public static createOrShow(
        extensionUri: vscode.Uri,
        result: CodeReviewResult
    ): CodeReviewViewer {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        // If we already have a panel, show it
        if (CodeReviewViewer.currentPanel) {
            CodeReviewViewer.currentPanel.panel.reveal(column);
            CodeReviewViewer.currentPanel.updateContent(result);
            return CodeReviewViewer.currentPanel;
        }

        // Use shared setup helper for consistent webview options
        const setupHelper = new WebviewSetupHelper(extensionUri);

        // Create a new panel with options from the helper
        const panel = vscode.window.createWebviewPanel(
            'codeReviewViewer',
            'Code Review Results',
            column || vscode.ViewColumn.One,
            setupHelper.getWebviewPanelOptions()
        );

        CodeReviewViewer.currentPanel = new CodeReviewViewer(panel, extensionUri);
        CodeReviewViewer.currentPanel.updateContent(result);
        return CodeReviewViewer.currentPanel;
    }

    /**
     * Update the webview content with new results
     */
    public updateContent(result: CodeReviewResult): void {
        this.currentResult = result;
        // Convert findings to findings with state
        this.findingsWithState = result.findings.map(toFindingWithState);
        this.filterMode = 'all';
        this.panel.title = this.getTitle(result);
        this.panel.webview.html = this.getHtmlContent(result);
    }

    /**
     * Get panel title based on review type
     */
    private getTitle(result: CodeReviewResult): string {
        if (result.metadata.type === 'commit' && result.metadata.commitSha) {
            return `Review: ${result.metadata.commitSha.substring(0, 7)}`;
        } else if (result.metadata.type === 'pending') {
            return 'Review: Pending Changes';
        } else {
            return 'Review: Staged Changes';
        }
    }

    /**
     * Open a file at the specified location.
     * For commit reviews, opens a read-only snapshot of the file at that commit.
     * For pending/staged reviews, opens the current working file.
     */
    private async openFileLocation(filePath: string, line?: number): Promise<void> {
        const metadata = this.currentResult?.metadata;
        
        // Determine the full file path
        let fullPath = filePath;
        if (!path.isAbsolute(filePath) && metadata?.repositoryRoot) {
            fullPath = path.join(metadata.repositoryRoot, filePath);
        }

        // For commit reviews, try to open a snapshot of the file at that commit
        if (metadata?.type === 'commit' && metadata.commitSha && metadata.repositoryRoot) {
            const repoRoot = metadata.repositoryRoot;
            const commitSha = metadata.commitSha;
            
            // Create a URI for the git snapshot provider
            // Use the relative path from repo root for git
            // On Windows, paths are case-insensitive, so normalize for comparison
            const normalizedFilePath = path.normalize(filePath).toLowerCase();
            const normalizedRepoRoot = path.normalize(repoRoot).toLowerCase();
            const isAbsolutePathInRepo = path.isAbsolute(filePath) && normalizedFilePath.startsWith(normalizedRepoRoot);
            const relativePath = isAbsolutePathInRepo
                ? path.relative(repoRoot, filePath)
                : filePath;
            
            // Encode parameters properly
            const query = new URLSearchParams({
                commit: commitSha,
                file: relativePath,
                repo: repoRoot
            }).toString();
            
            const snapshotUri = vscode.Uri.parse(`git-snapshot:/${path.basename(relativePath)}@${commitSha.substring(0, 7)}?${query}`);
            
            try {
                const doc = await vscode.workspace.openTextDocument(snapshotUri);
                await vscode.window.showTextDocument(doc, {
                    preview: true,
                    selection: line 
                        ? new vscode.Range(line - 1, 0, line - 1, 0)
                        : undefined
                });
                return;
            } catch (error) {
                // Fall back to opening the current file if snapshot fails
                console.warn('Failed to open git snapshot, falling back to current file:', error);
            }
        }

        // For pending/staged reviews or if snapshot failed, open the current file
        try {
            const uri = vscode.Uri.file(fullPath);
            await vscode.window.showTextDocument(uri, {
                selection: line 
                    ? new vscode.Range(line - 1, 0, line - 1, 0)
                    : undefined
            });
        } catch (error) {
            vscode.window.showErrorMessage(`Unable to open file: ${filePath}`);
        }
    }

    /**
     * Dispose of resources
     */
    public dispose(): void {
        CodeReviewViewer.currentPanel = undefined;
        this.messageRouter.dispose();
        this.panel.dispose();
        while (this.disposables.length) {
            const disposable = this.disposables.pop();
            if (disposable) {
                disposable.dispose();
            }
        }
    }

    /**
     * Generate the HTML content for the webview
     */
    private getHtmlContent(result: CodeReviewResult): string {
        // Use shared helper for nonce generation
        const nonce = WebviewSetupHelper.generateNonce();

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <title>Code Review Results</title>
    <style>
        :root {
            --bg-primary: var(--vscode-editor-background);
            --bg-secondary: var(--vscode-sideBar-background);
            --text-primary: var(--vscode-editor-foreground);
            --text-secondary: var(--vscode-descriptionForeground);
            --border-color: var(--vscode-panel-border);
            --error-color: #f14c4c;
            --warning-color: #cca700;
            --info-color: #3794ff;
            --suggestion-color: #89d185;
            --pass-color: #89d185;
            --fail-color: #f14c4c;
            --attention-color: #cca700;
        }

        * {
            box-sizing: border-box;
        }

        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--text-primary);
            background-color: var(--bg-primary);
            margin: 0;
            padding: 20px;
            line-height: 1.6;
        }

        .header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            margin-bottom: 24px;
            padding-bottom: 16px;
            border-bottom: 1px solid var(--border-color);
        }

        .header-info h1 {
            margin: 0 0 8px 0;
            font-size: 1.5em;
            font-weight: 600;
        }

        .metadata {
            color: var(--text-secondary);
            font-size: 0.9em;
        }

        .metadata span {
            margin-right: 16px;
        }

        .assessment {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 12px 20px;
            border-radius: 8px;
            font-size: 1.1em;
            font-weight: 600;
        }

        .assessment.pass {
            background-color: rgba(137, 209, 133, 0.15);
            color: var(--pass-color);
        }

        .assessment.fail {
            background-color: rgba(241, 76, 76, 0.15);
            color: var(--fail-color);
        }

        .assessment.needs-attention {
            background-color: rgba(204, 167, 0, 0.15);
            color: var(--attention-color);
        }

        .summary-section {
            background-color: var(--bg-secondary);
            border-radius: 8px;
            padding: 16px;
            margin-bottom: 24px;
        }

        .summary-section h2 {
            margin: 0 0 12px 0;
            font-size: 1.1em;
        }

        .summary-text {
            margin-bottom: 16px;
        }

        .stats-grid {
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 12px;
        }

        .stat-card {
            text-align: center;
            padding: 12px;
            border-radius: 6px;
            background-color: var(--bg-primary);
        }

        .stat-card.error { border-left: 3px solid var(--error-color); }
        .stat-card.warning { border-left: 3px solid var(--warning-color); }
        .stat-card.info { border-left: 3px solid var(--info-color); }
        .stat-card.suggestion { border-left: 3px solid var(--suggestion-color); }

        .stat-count {
            font-size: 1.5em;
            font-weight: 700;
        }

        .stat-label {
            font-size: 0.85em;
            color: var(--text-secondary);
        }

        .findings-section h2 {
            margin: 0 0 16px 0;
            font-size: 1.1em;
        }

        .finding {
            background-color: var(--bg-secondary);
            border-radius: 8px;
            margin-bottom: 16px;
            overflow: hidden;
        }

        .finding-header {
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 12px 16px;
            cursor: pointer;
        }

        .finding-header:hover {
            background-color: rgba(255, 255, 255, 0.05);
        }

        .severity-badge {
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 0.75em;
            font-weight: 600;
            text-transform: uppercase;
        }

        .severity-badge.error { background-color: rgba(241, 76, 76, 0.2); color: var(--error-color); }
        .severity-badge.warning { background-color: rgba(204, 167, 0, 0.2); color: var(--warning-color); }
        .severity-badge.info { background-color: rgba(55, 148, 255, 0.2); color: var(--info-color); }
        .severity-badge.suggestion { background-color: rgba(137, 209, 133, 0.2); color: var(--suggestion-color); }

        .finding-rule {
            font-weight: 600;
            flex: 1;
        }

        .finding-location {
            color: var(--text-secondary);
            font-size: 0.9em;
        }

        .finding-location a {
            color: var(--vscode-textLink-foreground);
            text-decoration: none;
        }

        .finding-location a:hover {
            text-decoration: underline;
        }

        .finding-body {
            padding: 0 16px 16px 16px;
            border-top: 1px solid var(--border-color);
        }

        .finding-description {
            margin: 12px 0;
        }

        .finding-code {
            background-color: var(--bg-primary);
            padding: 12px;
            border-radius: 4px;
            font-family: var(--vscode-editor-font-family);
            font-size: 0.9em;
            overflow-x: auto;
            margin: 12px 0;
        }

        .finding-suggestion,
        .finding-explanation {
            margin: 12px 0;
            padding-left: 16px;
            border-left: 2px solid var(--border-color);
        }

        .finding-suggestion::before {
            content: "💡 Suggestion: ";
            font-weight: 600;
        }

        .finding-explanation::before {
            content: "📖 Explanation: ";
            font-weight: 600;
        }

        .finding-rule-file {
            margin: 8px 0 12px 0;
            padding: 6px 10px;
            background-color: rgba(55, 148, 255, 0.1);
            border-radius: 4px;
            font-size: 0.85em;
            color: var(--info-color);
        }

        .no-findings {
            text-align: center;
            padding: 40px;
            color: var(--text-secondary);
        }

        .no-findings .icon {
            font-size: 3em;
            margin-bottom: 16px;
        }

        .rules-used {
            margin-top: 24px;
            padding-top: 16px;
            border-top: 1px solid var(--border-color);
        }

        .rules-list {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            margin-top: 8px;
        }

        .rule-tag {
            background-color: var(--bg-secondary);
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 0.85em;
        }

        /* Action bar styles */
        .action-bar {
            display: flex;
            align-items: center;
            gap: 16px;
            padding: 12px 16px;
            background-color: var(--bg-secondary);
            border-radius: 8px;
            margin-bottom: 16px;
        }

        .action-bar-left {
            display: flex;
            align-items: center;
            gap: 12px;
        }

        .action-bar-right {
            margin-left: auto;
            display: flex;
            align-items: center;
            gap: 12px;
        }

        .select-all-label {
            display: flex;
            align-items: center;
            gap: 6px;
            cursor: pointer;
            font-size: 0.9em;
        }

        .select-all-label input {
            cursor: pointer;
        }

        .selection-count {
            color: var(--text-secondary);
            font-size: 0.9em;
        }

        .apply-btn {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 8px 16px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 0.9em;
            font-weight: 500;
        }

        .apply-btn:hover:not(:disabled) {
            background-color: var(--vscode-button-hoverBackground);
        }

        .apply-btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }

        .filter-select {
            background-color: var(--bg-primary);
            color: var(--text-primary);
            border: 1px solid var(--border-color);
            border-radius: 4px;
            padding: 6px 10px;
            font-size: 0.9em;
            cursor: pointer;
        }

        /* Finding checkbox styles */
        .finding-checkbox {
            display: flex;
            align-items: center;
            padding-right: 8px;
        }

        .finding-checkbox input {
            width: 18px;
            height: 18px;
            cursor: pointer;
        }

        .finding-checkbox input:disabled {
            cursor: not-allowed;
            opacity: 0.5;
        }

        /* Finding state styles */
        .finding.selected {
            border: 2px solid var(--vscode-focusBorder);
        }

        .finding.applied {
            border-left: 4px solid var(--pass-color);
            background-color: rgba(137, 209, 133, 0.08);
        }

        .finding.applied .finding-header {
            opacity: 0.8;
        }

        .finding.failed {
            border-left: 4px solid var(--attention-color);
            background-color: rgba(204, 167, 0, 0.08);
        }

        .apply-status {
            display: flex;
            align-items: center;
            gap: 6px;
            font-size: 0.85em;
            padding: 4px 8px;
            border-radius: 4px;
        }

        .apply-status.applied {
            color: var(--pass-color);
            background-color: rgba(137, 209, 133, 0.15);
        }

        .apply-status.failed {
            color: var(--attention-color);
            background-color: rgba(204, 167, 0, 0.15);
        }

        .apply-error {
            color: var(--attention-color);
            font-size: 0.85em;
            margin-top: 8px;
            padding: 8px;
            background-color: rgba(204, 167, 0, 0.1);
            border-radius: 4px;
        }

        .apply-single-btn {
            background-color: transparent;
            color: var(--vscode-textLink-foreground);
            border: 1px solid var(--border-color);
            padding: 4px 8px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 0.8em;
            margin-left: auto;
        }

        .apply-single-btn:hover {
            background-color: rgba(255, 255, 255, 0.05);
        }

        /* No applicable findings info */
        .no-applicable-info {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            font-size: 0.8em;
            color: var(--text-secondary);
            padding: 2px 6px;
            background-color: rgba(55, 148, 255, 0.1);
            border-radius: 4px;
        }
    </style>
</head>
<body>
    ${this.renderHeader(result)}
    ${this.renderSummary(result)}
    ${this.renderActionBar()}
    ${this.renderFindings(result)}
    ${this.renderRulesUsed(result)}
    
    <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();

        // Handle file link clicks
        document.addEventListener('click', (event) => {
            const link = event.target.closest('.file-link');
            if (link) {
                event.stopPropagation();
                event.preventDefault();
                
                const file = link.getAttribute('data-file');
                const line = parseInt(link.getAttribute('data-line') || '0', 10);
                
                vscode.postMessage({
                    type: 'openFile',
                    file: file,
                    line: line
                });
            }
        });

        // Toggle finding details (only when clicking on the header, not the file link or checkbox)
        document.querySelectorAll('.finding-header').forEach(header => {
            header.addEventListener('click', (event) => {
                // Only toggle if we didn't click on the file link, checkbox, or apply button
                if (!event.target.closest('.finding-location') && 
                    !event.target.closest('.finding-checkbox') &&
                    !event.target.closest('.apply-single-btn')) {
                    const body = header.nextElementSibling;
                    if (body) {
                        body.style.display = body.style.display === 'none' ? 'block' : 'none';
                    }
                }
            });
        });

        // Handle finding checkbox changes
        document.querySelectorAll('.finding-checkbox input').forEach(checkbox => {
            checkbox.addEventListener('change', (event) => {
                event.stopPropagation();
                const findingId = checkbox.getAttribute('data-finding-id');
                vscode.postMessage({
                    type: 'toggleSelection',
                    findingId: findingId,
                    selected: checkbox.checked
                });
            });
        });

        // Handle select all checkbox
        const selectAllCheckbox = document.getElementById('select-all');
        if (selectAllCheckbox) {
            selectAllCheckbox.addEventListener('change', (event) => {
                vscode.postMessage({
                    type: 'selectAll',
                    selected: selectAllCheckbox.checked
                });
            });
        }

        // Handle apply selected button
        const applyBtn = document.getElementById('apply-selected-btn');
        if (applyBtn) {
            applyBtn.addEventListener('click', () => {
                vscode.postMessage({
                    type: 'applySelected'
                });
            });
        }

        // Handle filter dropdown
        const filterSelect = document.getElementById('filter-select');
        if (filterSelect) {
            filterSelect.addEventListener('change', (event) => {
                vscode.postMessage({
                    type: 'filterChange',
                    filter: filterSelect.value
                });
            });
        }

        // Handle apply single buttons
        document.querySelectorAll('.apply-single-btn').forEach(btn => {
            btn.addEventListener('click', (event) => {
                event.stopPropagation();
                const findingId = btn.getAttribute('data-finding-id');
                vscode.postMessage({
                    type: 'applySingle',
                    findingId: findingId
                });
            });
        });

        // Keyboard navigation
        document.addEventListener('keydown', (event) => {
            // Ctrl/Cmd + A to select all
            if ((event.ctrlKey || event.metaKey) && event.key === 'a') {
                const selectAll = document.getElementById('select-all');
                if (selectAll && !selectAll.disabled) {
                    event.preventDefault();
                    selectAll.checked = !selectAll.checked;
                    vscode.postMessage({
                        type: 'selectAll',
                        selected: selectAll.checked
                    });
                }
            }
            // Enter to apply selected
            if (event.key === 'Enter' && !event.target.closest('input, select, button')) {
                const applyBtn = document.getElementById('apply-selected-btn');
                if (applyBtn && !applyBtn.disabled) {
                    event.preventDefault();
                    vscode.postMessage({
                        type: 'applySelected'
                    });
                }
            }
        });
    </script>
</body>
</html>`;
    }

    /**
     * Render the header section
     */
    private renderHeader(result: CodeReviewResult): string {
        let title = 'Code Review Results';
        let commitInfo = '';

        if (result.metadata.type === 'commit' && result.metadata.commitSha) {
            title = `Commit ${result.metadata.commitSha.substring(0, 7)}`;
            if (result.metadata.commitMessage) {
                commitInfo = `<span>📝 ${this.escapeHtml(result.metadata.commitMessage)}</span>`;
            }
        } else if (result.metadata.type === 'pending') {
            title = 'Pending Changes';
        } else {
            title = 'Staged Changes';
        }

        let diffStats = '';
        if (result.metadata.diffStats) {
            const { files, additions, deletions } = result.metadata.diffStats;
            diffStats = `<span>📊 ${files} file(s), +${additions}/-${deletions}</span>`;
        }

        const assessmentClass = result.summary.overallAssessment;
        const assessmentIcon = assessmentClass === 'pass' ? '✅' : 
            assessmentClass === 'fail' ? '❌' : '⚠️';

        return `
        <div class="header">
            <div class="header-info">
                <h1>📋 ${this.escapeHtml(title)}</h1>
                <div class="metadata">
                    ${commitInfo}
                    ${diffStats}
                    <span>🕐 ${result.timestamp.toLocaleString()}</span>
                </div>
            </div>
            <div class="assessment ${assessmentClass}">
                <span>${assessmentIcon}</span>
                <span>${assessmentClass.replace('-', ' ').toUpperCase()}</span>
            </div>
        </div>`;
    }

    /**
     * Render the summary section
     */
    private renderSummary(result: CodeReviewResult): string {
        const { summary } = result;

        return `
        <div class="summary-section">
            <h2>📊 Summary</h2>
            <div class="summary-text">${this.escapeHtml(summary.summaryText)}</div>
            <div class="stats-grid">
                <div class="stat-card error">
                    <div class="stat-count">${summary.bySeverity.error}</div>
                    <div class="stat-label">Errors</div>
                </div>
                <div class="stat-card warning">
                    <div class="stat-count">${summary.bySeverity.warning}</div>
                    <div class="stat-label">Warnings</div>
                </div>
                <div class="stat-card info">
                    <div class="stat-count">${summary.bySeverity.info}</div>
                    <div class="stat-label">Info</div>
                </div>
                <div class="stat-card suggestion">
                    <div class="stat-count">${summary.bySeverity.suggestion}</div>
                    <div class="stat-label">Suggestions</div>
                </div>
            </div>
        </div>`;
    }

    /**
     * Render the action bar with select all, apply selected, and filter controls
     */
    private renderActionBar(): string {
        const filteredFindings = this.getFilteredFindings();
        const applicableCount = filteredFindings.filter(f => f.isApplicable && f.applyState !== 'applied' && f.applyState !== 'failed').length;
        const selectedCount = this.getSelectedCount();
        const totalFindings = this.findingsWithState.length;
        const appliedCount = this.findingsWithState.filter(f => f.applyState === 'applied').length;

        // Check if all applicable findings are selected
        const allSelected = applicableCount > 0 && 
            filteredFindings.filter(f => f.isApplicable && f.applyState !== 'applied' && f.applyState !== 'failed')
                .every(f => f.applyState === 'selected');

        const selectAllDisabled = applicableCount === 0;
        const applyDisabled = selectedCount === 0;

        let statusText = `${totalFindings} findings`;
        if (selectedCount > 0) {
            statusText += ` • ${selectedCount} selected`;
        }
        if (appliedCount > 0) {
            statusText += ` • ${appliedCount} applied`;
        }

        return `
        <div class="action-bar">
            <div class="action-bar-left">
                <label class="select-all-label">
                    <input type="checkbox" id="select-all" ${allSelected ? 'checked' : ''} ${selectAllDisabled ? 'disabled' : ''}>
                    Select all
                </label>
                <span class="selection-count">${statusText}</span>
            </div>
            <div class="action-bar-right">
                <select id="filter-select" class="filter-select">
                    <option value="all" ${this.filterMode === 'all' ? 'selected' : ''}>All</option>
                    <option value="errors" ${this.filterMode === 'errors' ? 'selected' : ''}>Errors</option>
                    <option value="warnings" ${this.filterMode === 'warnings' ? 'selected' : ''}>Warnings</option>
                    <option value="suggestions" ${this.filterMode === 'suggestions' ? 'selected' : ''}>Suggestions</option>
                </select>
                <button id="apply-selected-btn" class="apply-btn" ${applyDisabled ? 'disabled' : ''}>
                    Apply Selected${selectedCount > 0 ? ` (${selectedCount})` : ''}
                </button>
            </div>
        </div>`;
    }

    /**
     * Render the findings section
     */
    private renderFindings(result: CodeReviewResult): string {
        const filteredFindings = this.getFilteredFindings();

        if (this.findingsWithState.length === 0) {
            return `
            <div class="findings-section">
                <h2>🔍 Findings</h2>
                <div class="no-findings">
                    <div class="icon">✨</div>
                    <div>No issues found! The code follows the provided rules.</div>
                </div>
            </div>`;
        }

        if (filteredFindings.length === 0) {
            return `
            <div class="findings-section">
                <h2>🔍 Findings (${this.findingsWithState.length})</h2>
                <div class="no-findings">
                    <div class="icon">🔍</div>
                    <div>No findings match the current filter.</div>
                </div>
            </div>`;
        }

        const findingsHtml = filteredFindings.map(finding => this.renderFindingWithState(finding)).join('');

        return `
        <div class="findings-section">
            <h2>🔍 Findings (${filteredFindings.length}${filteredFindings.length !== this.findingsWithState.length ? ` of ${this.findingsWithState.length}` : ''})</h2>
            ${findingsHtml}
        </div>`;
    }

    /**
     * Render a single finding with checkbox and state
     */
    private renderFindingWithState(finding: FindingWithState): string {
        const stateClass = finding.applyState === 'selected' ? 'selected' :
            finding.applyState === 'applied' ? 'applied' :
            finding.applyState === 'failed' ? 'failed' : '';

        // Checkbox for applicable findings
        let checkboxHtml = '';
        if (finding.isApplicable) {
            if (finding.applyState === 'applied') {
                checkboxHtml = `<span class="apply-status applied">✓ Applied</span>`;
            } else if (finding.applyState === 'failed') {
                checkboxHtml = `<span class="apply-status failed">⚠️ Failed</span>`;
            } else {
                const checked = finding.applyState === 'selected' ? 'checked' : '';
                checkboxHtml = `
                <span class="finding-checkbox">
                    <input type="checkbox" ${checked} data-finding-id="${this.escapeHtml(finding.id)}">
                </span>`;
            }
        } else {
            checkboxHtml = `<span class="no-applicable-info" title="No code fix available">ℹ️</span>`;
        }

        // Location link
        const locationHtml = finding.file
            ? `<span class="finding-location">
                <a href="#" class="file-link" data-file="${this.escapeHtml(finding.file)}" data-line="${finding.line || 0}">
                    📁 ${this.escapeHtml(finding.file)}${finding.line ? `:${finding.line}` : ''}
                </a>
               </span>`
            : '';

        // Apply single button for applicable findings that haven't been applied
        const applySingleHtml = finding.isApplicable && finding.applyState !== 'applied'
            ? `<button class="apply-single-btn" data-finding-id="${this.escapeHtml(finding.id)}" title="Apply this fix">Apply</button>`
            : '';

        const codeHtml = finding.codeSnippet
            ? `<pre class="finding-code"><code>${this.escapeHtml(finding.codeSnippet)}</code></pre>`
            : '';

        const suggestionHtml = finding.suggestion
            ? `<div class="finding-suggestion">${this.escapeHtml(finding.suggestion)}</div>`
            : '';

        const explanationHtml = finding.explanation
            ? `<div class="finding-explanation">${this.escapeHtml(finding.explanation)}</div>`
            : '';

        // Show the source rule file if available and different from the rule name
        const ruleFileHtml = finding.ruleFile && finding.ruleFile !== finding.rule
            ? `<div class="finding-rule-file">📄 From rule: <strong>${this.escapeHtml(finding.ruleFile)}</strong></div>`
            : '';

        // Show error message for failed findings
        const errorHtml = finding.applyError
            ? `<div class="apply-error">⚠️ ${this.escapeHtml(finding.applyError)}</div>`
            : '';

        return `
        <div class="finding ${stateClass}">
            <div class="finding-header">
                ${checkboxHtml}
                <span class="severity-badge ${finding.severity}">${finding.severity}</span>
                <span class="finding-rule">${this.escapeHtml(finding.rule)}</span>
                ${locationHtml}
                ${applySingleHtml}
            </div>
            <div class="finding-body">
                ${ruleFileHtml}
                <div class="finding-description">${this.escapeHtml(finding.description)}</div>
                ${codeHtml}
                ${suggestionHtml}
                ${explanationHtml}
                ${errorHtml}
            </div>
        </div>`;
    }

    /**
     * Render a single finding (legacy method for backward compatibility)
     */
    private renderFinding(finding: ReviewFinding): string {
        // Convert to FindingWithState and use the new renderer
        const findingWithState = this.findingsWithState.find(f => f.id === finding.id);
        if (findingWithState) {
            return this.renderFindingWithState(findingWithState);
        }

        // Fallback for findings not in state (shouldn't happen)
        const locationHtml = finding.file
            ? `<span class="finding-location">
                <a href="#" class="file-link" data-file="${this.escapeHtml(finding.file)}" data-line="${finding.line || 0}">
                    📁 ${this.escapeHtml(finding.file)}${finding.line ? `:${finding.line}` : ''}
                </a>
               </span>`
            : '';

        const codeHtml = finding.codeSnippet
            ? `<pre class="finding-code"><code>${this.escapeHtml(finding.codeSnippet)}</code></pre>`
            : '';

        const suggestionHtml = finding.suggestion
            ? `<div class="finding-suggestion">${this.escapeHtml(finding.suggestion)}</div>`
            : '';

        const explanationHtml = finding.explanation
            ? `<div class="finding-explanation">${this.escapeHtml(finding.explanation)}</div>`
            : '';

        const ruleFileHtml = finding.ruleFile && finding.ruleFile !== finding.rule
            ? `<div class="finding-rule-file">📄 From rule: <strong>${this.escapeHtml(finding.ruleFile)}</strong></div>`
            : '';

        return `
        <div class="finding">
            <div class="finding-header">
                <span class="severity-badge ${finding.severity}">${finding.severity}</span>
                <span class="finding-rule">${this.escapeHtml(finding.rule)}</span>
                ${locationHtml}
            </div>
            <div class="finding-body">
                ${ruleFileHtml}
                <div class="finding-description">${this.escapeHtml(finding.description)}</div>
                ${codeHtml}
                ${suggestionHtml}
                ${explanationHtml}
            </div>
        </div>`;
    }

    /**
     * Render the rules used section
     */
    private renderRulesUsed(result: CodeReviewResult): string {
        if (!result.metadata.rulesUsed || result.metadata.rulesUsed.length === 0) {
            return '';
        }

        const rulesHtml = result.metadata.rulesUsed
            .map(rule => `<span class="rule-tag">📄 ${this.escapeHtml(rule)}</span>`)
            .join('');

        return `
        <div class="rules-used">
            <h3>📚 Rules Applied</h3>
            <div class="rules-list">${rulesHtml}</div>
        </div>`;
    }

    /**
     * Escape HTML special characters
     * Uses the shared WebviewSetupHelper utility
     */
    private escapeHtml(text: string): string {
        return WebviewSetupHelper.escapeHtml(text);
    }
}

