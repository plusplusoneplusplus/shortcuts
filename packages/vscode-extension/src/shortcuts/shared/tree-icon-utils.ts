import * as vscode from 'vscode';

/**
 * Common process status types across different providers.
 */
export type ProcessStatus = 'running' | 'completed' | 'failed' | 'cancelled';

/**
 * Git staging types.
 */
export type GitStageType = 'staged' | 'unstaged' | 'untracked';

/**
 * Icon mappings for process statuses (AI processes, pipeline execution, etc.).
 */
export const PROCESS_STATUS_ICONS: Record<ProcessStatus, vscode.ThemeIcon> = {
    'running': new vscode.ThemeIcon('sync~spin', new vscode.ThemeColor('charts.blue')),
    'completed': new vscode.ThemeIcon('check-all', new vscode.ThemeColor('charts.green')),
    'failed': new vscode.ThemeIcon('error', new vscode.ThemeColor('charts.red')),
    'cancelled': new vscode.ThemeIcon('circle-slash', new vscode.ThemeColor('charts.orange')),
};

/**
 * Icon mappings for git staging states.
 */
export const GIT_STATUS_ICONS: Record<GitStageType, vscode.ThemeIcon> = {
    'staged': new vscode.ThemeIcon('check', new vscode.ThemeColor('gitDecoration.addedResourceForeground')),
    'unstaged': new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor('gitDecoration.modifiedResourceForeground')),
    'untracked': new vscode.ThemeIcon('question', new vscode.ThemeColor('gitDecoration.untrackedResourceForeground')),
};

/**
 * Icon mappings for document/task types.
 */
export const DOCUMENT_TYPE_ICONS: Record<string, string> = {
    'plan': 'checklist',
    'spec': 'file-code',
    'test': 'beaker',
    'notes': 'note',
    'todo': 'tasklist',
    'readme': 'book',
    'design': 'lightbulb',
    'impl': 'code',
    'implementation': 'code',
    'review': 'comment-discussion',
    'requirements': 'list-ordered',
    'analysis': 'graph',
    'research': 'search',
    'summary': 'file-text',
    'log': 'history',
    'draft': 'edit',
    'final': 'verified',
};

/**
 * Gets a ThemeIcon for a document type.
 * @param docType Document type string (case-insensitive)
 * @param defaultIcon Icon name to use if type not found (default: 'file-text')
 * @returns ThemeIcon for the document type
 */
export function getDocumentIcon(docType: string, defaultIcon: string = 'file-text'): vscode.ThemeIcon {
    const icon = DOCUMENT_TYPE_ICONS[docType.toLowerCase()] ?? defaultIcon;
    return new vscode.ThemeIcon(icon);
}

/**
 * Gets the standard archived item icon (grayed out).
 */
export function getArchivedIcon(): vscode.ThemeIcon {
    return new vscode.ThemeIcon('archive', new vscode.ThemeColor('disabledForeground'));
}

/**
 * Gets a process status icon.
 * @param status Process status
 * @param fallback Optional fallback icon if status not found
 */
export function getProcessStatusIcon(status: ProcessStatus, fallback?: vscode.ThemeIcon): vscode.ThemeIcon {
    return PROCESS_STATUS_ICONS[status] ?? fallback ?? new vscode.ThemeIcon('question');
}

/**
 * Gets a git stage status icon.
 * @param stageType Git stage type
 */
export function getGitStageIcon(stageType: GitStageType): vscode.ThemeIcon {
    return GIT_STATUS_ICONS[stageType];
}
