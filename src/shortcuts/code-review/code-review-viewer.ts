/**
 * Code Review Result Viewer
 * 
 * A dedicated webview panel for displaying structured code review results.
 */

import * as vscode from 'vscode';
import { CodeReviewResult, ReviewFinding, ReviewSeverity } from './types';

/**
 * Manages the code review result viewer webview panel
 */
export class CodeReviewViewer {
    public static currentPanel: CodeReviewViewer | undefined;
    private readonly panel: vscode.WebviewPanel;
    private disposables: vscode.Disposable[] = [];

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
        this.panel = panel;

        // Handle panel disposal
        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

        // Handle messages from webview
        this.panel.webview.onDidReceiveMessage(
            message => this.handleMessage(message),
            null,
            this.disposables
        );
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

        // Create a new panel
        const panel = vscode.window.createWebviewPanel(
            'codeReviewViewer',
            'Code Review Results',
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [extensionUri]
            }
        );

        CodeReviewViewer.currentPanel = new CodeReviewViewer(panel, extensionUri);
        CodeReviewViewer.currentPanel.updateContent(result);
        return CodeReviewViewer.currentPanel;
    }

    /**
     * Update the webview content with new results
     */
    public updateContent(result: CodeReviewResult): void {
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
     * Handle messages from the webview
     */
    private handleMessage(message: { command: string; file?: string; line?: number }): void {
        switch (message.command) {
            case 'openFile':
                if (message.file) {
                    const uri = vscode.Uri.file(message.file);
                    vscode.window.showTextDocument(uri, {
                        selection: message.line 
                            ? new vscode.Range(message.line - 1, 0, message.line - 1, 0)
                            : undefined
                    });
                }
                break;
            case 'copyFinding':
                // Handle copy to clipboard
                break;
        }
    }

    /**
     * Dispose of resources
     */
    public dispose(): void {
        CodeReviewViewer.currentPanel = undefined;
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
        const nonce = this.getNonce();

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
    </style>
</head>
<body>
    ${this.renderHeader(result)}
    ${this.renderSummary(result)}
    ${this.renderFindings(result)}
    ${this.renderRulesUsed(result)}
    
    <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();

        function openFile(file, line) {
            vscode.postMessage({
                command: 'openFile',
                file: file,
                line: line
            });
        }

        // Toggle finding details
        document.querySelectorAll('.finding-header').forEach(header => {
            header.addEventListener('click', () => {
                const body = header.nextElementSibling;
                if (body) {
                    body.style.display = body.style.display === 'none' ? 'block' : 'none';
                }
            });
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
     * Render the findings section
     */
    private renderFindings(result: CodeReviewResult): string {
        if (result.findings.length === 0) {
            return `
            <div class="findings-section">
                <h2>🔍 Findings</h2>
                <div class="no-findings">
                    <div class="icon">✨</div>
                    <div>No issues found! The code follows the provided rules.</div>
                </div>
            </div>`;
        }

        const findingsHtml = result.findings.map(finding => this.renderFinding(finding)).join('');

        return `
        <div class="findings-section">
            <h2>🔍 Findings (${result.findings.length})</h2>
            ${findingsHtml}
        </div>`;
    }

    /**
     * Render a single finding
     */
    private renderFinding(finding: ReviewFinding): string {
        const locationHtml = finding.file
            ? `<span class="finding-location">
                <a href="#" onclick="openFile('${this.escapeHtml(finding.file)}', ${finding.line || 0}); return false;">
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

        return `
        <div class="finding">
            <div class="finding-header">
                <span class="severity-badge ${finding.severity}">${finding.severity}</span>
                <span class="finding-rule">${this.escapeHtml(finding.rule)}</span>
                ${locationHtml}
            </div>
            <div class="finding-body">
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
     */
    private escapeHtml(text: string): string {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    /**
     * Generate a nonce for CSP
     */
    private getNonce(): string {
        let text = '';
        const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        for (let i = 0; i < 32; i++) {
            text += possible.charAt(Math.floor(Math.random() * possible.length));
        }
        return text;
    }
}

