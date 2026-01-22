/**
 * Fix Applier Module
 *
 * Handles applying code review fixes to files.
 * Implements the apply workflow for the checkbox model UX.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as path from 'path';
import * as vscode from 'vscode';
import {
    ApplyFixResult,
    ApplyFixesResult,
    FindingWithState,
    ReviewFinding
} from './types';

/**
 * Options for applying fixes
 */
export interface ApplyFixOptions {
    /** Repository root path for resolving relative paths */
    repositoryRoot?: string;
    /** Whether to show a diff preview before applying (default: true) */
    showPreview?: boolean;
}

/**
 * Checks if a finding can be auto-applied
 * A finding is applicable if it has:
 * - A file path
 * - A line number
 * - A suggested code replacement OR a clear suggestion
 */
export function isApplicableFinding(finding: ReviewFinding): boolean {
    // Must have file and line number
    if (!finding.file || !finding.line) {
        return false;
    }

    // Must have suggested code or a non-empty suggestion
    const hasSuggestedCode = !!finding.suggestedCode && finding.suggestedCode.trim().length > 0;
    const hasSuggestion = !!finding.suggestion && finding.suggestion.trim().length > 0;

    return hasSuggestedCode || hasSuggestion;
}

/**
 * Converts a ReviewFinding to a FindingWithState with initial state
 */
export function toFindingWithState(finding: ReviewFinding): FindingWithState {
    const applicable = isApplicableFinding(finding);
    return {
        ...finding,
        isApplicable: applicable,
        applyState: 'pending'
    };
}

/**
 * Resolves a file path (absolute or relative) to an absolute path
 */
export function resolveFilePath(filePath: string, repositoryRoot?: string): string {
    if (path.isAbsolute(filePath)) {
        return filePath;
    }

    if (repositoryRoot) {
        return path.join(repositoryRoot, filePath);
    }

    // If no repo root, try workspace folders
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (workspaceFolder) {
        return path.join(workspaceFolder.uri.fsPath, filePath);
    }

    return filePath;
}

/**
 * Gets the content of a file at a specific line range
 */
export async function getFileContent(
    filePath: string,
    startLine: number,
    endLine?: number
): Promise<{ content: string; document: vscode.TextDocument } | undefined> {
    try {
        const uri = vscode.Uri.file(filePath);
        const document = await vscode.workspace.openTextDocument(uri);

        // Lines are 0-indexed in VSCode
        const start = Math.max(0, startLine - 1);
        const end = endLine ? Math.min(document.lineCount, endLine) : start + 1;

        const range = new vscode.Range(start, 0, end - 1, document.lineAt(end - 1).text.length);
        const content = document.getText(range);

        return { content, document };
    } catch (error) {
        return undefined;
    }
}

/**
 * Applies a single fix to a file
 */
export async function applySingleFix(
    finding: ReviewFinding,
    options: ApplyFixOptions = {}
): Promise<ApplyFixResult> {
    const { repositoryRoot } = options;

    // Validate finding
    if (!finding.file) {
        return {
            findingId: finding.id,
            success: false,
            error: 'Finding has no file path'
        };
    }

    if (!finding.line) {
        return {
            findingId: finding.id,
            success: false,
            error: 'Finding has no line number'
        };
    }

    // Get the replacement text
    const replacementText = finding.suggestedCode || finding.suggestion;
    if (!replacementText) {
        return {
            findingId: finding.id,
            success: false,
            error: 'Finding has no suggested code or suggestion'
        };
    }

    // Resolve file path
    const absolutePath = resolveFilePath(finding.file, repositoryRoot);

    try {
        // Open the document
        const uri = vscode.Uri.file(absolutePath);
        const document = await vscode.workspace.openTextDocument(uri);

        // Calculate the range to replace
        const startLine = finding.line - 1; // Convert to 0-indexed
        const endLine = finding.endLine ? finding.endLine - 1 : startLine;

        // Validate line numbers
        if (startLine < 0 || startLine >= document.lineCount) {
            return {
                findingId: finding.id,
                success: false,
                error: `Line ${finding.line} is out of range (file has ${document.lineCount} lines)`,
                file: finding.file
            };
        }

        // Get the current content at the line
        const currentLine = document.lineAt(startLine);

        // If we have a code snippet, verify the line still matches
        if (finding.codeSnippet) {
            const currentContent = currentLine.text.trim();
            const expectedContent = finding.codeSnippet.trim();

            // Do a loose match - check if the current line contains the expected snippet
            if (!currentContent.includes(expectedContent) && !expectedContent.includes(currentContent)) {
                // Allow partial match for simple cases
                const simplifiedCurrent = currentContent.replace(/\s+/g, '');
                const simplifiedExpected = expectedContent.replace(/\s+/g, '');

                if (!simplifiedCurrent.includes(simplifiedExpected) && !simplifiedExpected.includes(simplifiedCurrent)) {
                    return {
                        findingId: finding.id,
                        success: false,
                        error: 'Code changed since review - line content no longer matches',
                        file: finding.file
                    };
                }
            }
        }

        // Create a text edit
        const range = new vscode.Range(startLine, 0, endLine, document.lineAt(endLine).text.length);

        // Apply the edit (but don't save - leave file dirty)
        const edit = new vscode.WorkspaceEdit();
        edit.replace(uri, range, replacementText);

        const success = await vscode.workspace.applyEdit(edit);

        if (success) {
            return {
                findingId: finding.id,
                success: true,
                file: finding.file
            };
        } else {
            return {
                findingId: finding.id,
                success: false,
                error: 'Failed to apply edit',
                file: finding.file
            };
        }
    } catch (error) {
        return {
            findingId: finding.id,
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
            file: finding.file
        };
    }
}

/**
 * Applies multiple fixes to files
 * Groups fixes by file and applies them in reverse order (bottom to top)
 * to preserve line numbers for subsequent fixes in the same file.
 */
export async function applyFixes(
    findings: ReviewFinding[],
    options: ApplyFixOptions = {}
): Promise<ApplyFixesResult> {
    const results: ApplyFixResult[] = [];
    const modifiedFiles = new Set<string>();

    // Filter to only applicable findings
    const applicableFindings = findings.filter(isApplicableFinding);

    if (applicableFindings.length === 0) {
        return {
            total: findings.length,
            successful: 0,
            failed: 0,
            results: findings.map(f => ({
                findingId: f.id,
                success: false,
                error: 'Finding is not applicable for auto-fix'
            })),
            modifiedFiles: []
        };
    }

    // Group findings by file
    const findingsByFile = new Map<string, ReviewFinding[]>();
    for (const finding of applicableFindings) {
        const file = finding.file!;
        if (!findingsByFile.has(file)) {
            findingsByFile.set(file, []);
        }
        findingsByFile.get(file)!.push(finding);
    }

    // Process each file
    for (const [file, fileFindings] of findingsByFile) {
        // Sort findings by line number in descending order
        // This ensures we apply fixes from bottom to top, preserving line numbers
        const sortedFindings = [...fileFindings].sort((a, b) => (b.line || 0) - (a.line || 0));

        for (const finding of sortedFindings) {
            const result = await applySingleFix(finding, options);
            results.push(result);

            if (result.success && result.file) {
                modifiedFiles.add(result.file);
            }
        }
    }

    // Add results for non-applicable findings
    for (const finding of findings) {
        if (!applicableFindings.includes(finding)) {
            results.push({
                findingId: finding.id,
                success: false,
                error: 'Finding is not applicable for auto-fix'
            });
        }
    }

    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;

    return {
        total: findings.length,
        successful,
        failed,
        results,
        modifiedFiles: Array.from(modifiedFiles)
    };
}

/**
 * Shows a diff preview for the proposed changes
 */
export async function showDiffPreview(
    findings: ReviewFinding[],
    options: ApplyFixOptions = {}
): Promise<boolean> {
    const applicableFindings = findings.filter(isApplicableFinding);

    if (applicableFindings.length === 0) {
        vscode.window.showInformationMessage('No applicable fixes to preview.');
        return false;
    }

    // Build preview content
    const previewLines: string[] = [
        '# Proposed Fixes Preview',
        '',
        `Total fixes: ${applicableFindings.length}`,
        ''
    ];

    // Group by file for the preview
    const findingsByFile = new Map<string, ReviewFinding[]>();
    for (const finding of applicableFindings) {
        const file = finding.file!;
        if (!findingsByFile.has(file)) {
            findingsByFile.set(file, []);
        }
        findingsByFile.get(file)!.push(finding);
    }

    for (const [file, fileFindings] of findingsByFile) {
        previewLines.push(`## ${file}`);
        previewLines.push('');

        for (const finding of fileFindings) {
            previewLines.push(`### Line ${finding.line}: ${finding.rule}`);
            previewLines.push('');

            if (finding.codeSnippet) {
                previewLines.push('**Current:**');
                previewLines.push('```');
                previewLines.push(finding.codeSnippet);
                previewLines.push('```');
                previewLines.push('');
            }

            const replacement = finding.suggestedCode || finding.suggestion;
            if (replacement) {
                previewLines.push('**Proposed:**');
                previewLines.push('```');
                previewLines.push(replacement);
                previewLines.push('```');
                previewLines.push('');
            }
        }
    }

    // Show preview in new editor
    const doc = await vscode.workspace.openTextDocument({
        content: previewLines.join('\n'),
        language: 'markdown'
    });

    await vscode.window.showTextDocument(doc, { preview: true });

    // Ask for confirmation
    const result = await vscode.window.showInformationMessage(
        `Apply ${applicableFindings.length} fix(es) to ${findingsByFile.size} file(s)?`,
        { modal: true },
        'Apply',
        'Cancel'
    );

    return result === 'Apply';
}

/**
 * Main entry point for applying selected fixes
 */
export async function applySelectedFixes(
    findings: ReviewFinding[],
    options: ApplyFixOptions = {}
): Promise<ApplyFixesResult> {
    const { showPreview = true } = options;

    // Show preview if enabled
    if (showPreview) {
        const confirmed = await showDiffPreview(findings, options);
        if (!confirmed) {
            return {
                total: findings.length,
                successful: 0,
                failed: 0,
                results: [],
                modifiedFiles: []
            };
        }
    }

    // Apply the fixes
    const result = await applyFixes(findings, options);

    // Show result message
    if (result.successful > 0) {
        const fileWord = result.modifiedFiles.length === 1 ? 'file' : 'files';
        let message = `Applied ${result.successful} fix(es) to ${result.modifiedFiles.length} ${fileWord}`;

        if (result.failed > 0) {
            message += ` (${result.failed} failed)`;
        }

        if (result.failed > 0) {
            vscode.window.showWarningMessage(message);
        } else {
            vscode.window.showInformationMessage(message);
        }
    } else if (result.failed > 0) {
        vscode.window.showErrorMessage(
            'None of the selected fixes could be applied. Code may have changed since the review.'
        );
    }

    return result;
}
