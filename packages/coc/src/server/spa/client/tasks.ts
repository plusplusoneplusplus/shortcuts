/**
 * Tasks module: workspace task CRUD operations with tree rendering.
 * Tasks are rendered inside the repo detail panel's Tasks sub-tab.
 * No standalone Tasks view — tasks are always repo-scoped.
 */

import { appState, taskPanelState } from './state';
import { getApiBase } from './config';
import { fetchApi } from './core';
import { escapeHtmlClient } from './utils';

// ================================================================
// Types
// ================================================================

/** Mirrors pipeline-core TaskFolder (serialized to JSON by the API). */
interface TaskFolder {
    name: string;
    relativePath: string;
    children: TaskFolder[];
    documentGroups: TaskDocumentGroup[];
    singleDocuments: TaskDocument[];
}

/** Mirrors pipeline-core TaskDocumentGroup. */
interface TaskDocumentGroup {
    baseName: string;
    documents: TaskDocument[];
    isArchived: boolean;
}

/** Mirrors pipeline-core TaskDocument. */
interface TaskDocument {
    baseName: string;
    docType?: string;
    fileName: string;
    relativePath?: string;
    status?: string;
    isArchived: boolean;
}

// ================================================================
// Data fetching
// ================================================================

let currentTasks: TaskFolder | null = null;

export async function fetchRepoTasks(wsId: string): Promise<void> {
    taskPanelState.selectedWorkspaceId = wsId;

    const data = await fetchApi(`/workspaces/${encodeURIComponent(wsId)}/tasks`);
    currentTasks = data || null;
    renderTasksInRepo();
}

// ================================================================
// Shared input dialog
// ================================================================

function showInputDialog(
    title: string,
    placeholder: string,
    onSubmit: (value: string) => void,
    defaultValue = '',
    extraFields?: { label: string; type: 'select'; options: Array<{ value: string; label: string }>; id: string }[]
): void {
    // Remove any existing dialog
    const existing = document.getElementById('task-input-dialog-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'task-input-dialog-overlay';
    overlay.className = 'enqueue-overlay';

    let extraFieldsHtml = '';
    if (extraFields) {
        for (const field of extraFields) {
            extraFieldsHtml += '<div class="enqueue-field">' +
                '<label>' + escapeHtmlClient(field.label) + '</label>' +
                '<select id="' + field.id + '">';
            for (const opt of field.options) {
                extraFieldsHtml += '<option value="' + escapeHtmlClient(opt.value) + '">' + escapeHtmlClient(opt.label) + '</option>';
            }
            extraFieldsHtml += '</select></div>';
        }
    }

    overlay.innerHTML =
        '<div class="enqueue-dialog" style="width:400px">' +
            '<div class="enqueue-dialog-header">' +
                '<h2>' + escapeHtmlClient(title) + '</h2>' +
                '<button class="enqueue-close-btn" id="task-dialog-close">&times;</button>' +
            '</div>' +
            '<form id="task-dialog-form" class="enqueue-form">' +
                '<div class="enqueue-field">' +
                    '<label for="task-dialog-input">Name</label>' +
                    '<input type="text" id="task-dialog-input" placeholder="' + escapeHtmlClient(placeholder) + '" value="' + escapeHtmlClient(defaultValue) + '" required />' +
                '</div>' +
                extraFieldsHtml +
                '<div class="enqueue-actions">' +
                    '<button type="button" class="enqueue-btn-secondary" id="task-dialog-cancel">Cancel</button>' +
                    '<button type="submit" class="enqueue-btn-primary">OK</button>' +
                '</div>' +
            '</form>' +
        '</div>';

    document.body.appendChild(overlay);

    const input = document.getElementById('task-dialog-input') as HTMLInputElement;
    if (input) input.focus();

    const close = () => overlay.remove();

    document.getElementById('task-dialog-close')?.addEventListener('click', close);
    document.getElementById('task-dialog-cancel')?.addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    document.getElementById('task-dialog-form')?.addEventListener('submit', (e) => {
        e.preventDefault();
        const value = (document.getElementById('task-dialog-input') as HTMLInputElement)?.value.trim();
        if (value) {
            onSubmit(value);
            close();
        }
    });
}

// ================================================================
// CRUD operations
// ================================================================

export async function createRepoTask(wsId: string, folder?: string): Promise<void> {
    showInputDialog('New Task', 'Task name', async (name) => {
        const docTypeSelect = document.getElementById('task-dialog-doctype') as HTMLSelectElement | null;
        const docType = docTypeSelect?.value || '';

        const body: any = { name };
        if (folder) body.folder = folder;
        if (docType) body.docType = docType;

        try {
            const res = await fetch(getApiBase() + `/workspaces/${encodeURIComponent(wsId)}/tasks`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({ error: 'Failed' }));
                alert(data.error || 'Failed to create task');
                return;
            }
            await fetchRepoTasks(wsId);
        } catch {
            alert('Network error creating task');
        }
    }, '', [
        {
            label: 'Doc Type (optional)',
            type: 'select',
            id: 'task-dialog-doctype',
            options: [
                { value: '', label: 'None' },
                { value: 'plan', label: 'Plan' },
                { value: 'spec', label: 'Spec' },
                { value: 'test', label: 'Test' },
                { value: 'notes', label: 'Notes' },
                { value: 'design', label: 'Design' },
                { value: 'impl', label: 'Implementation' },
            ],
        },
    ]);
}

export async function createRepoFolder(wsId: string, parent?: string): Promise<void> {
    showInputDialog('New Folder', 'Folder name', async (name) => {
        const body: any = { name, type: 'folder' };
        if (parent) body.parent = parent;

        try {
            const res = await fetch(getApiBase() + `/workspaces/${encodeURIComponent(wsId)}/tasks`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({ error: 'Failed' }));
                alert(data.error || 'Failed to create folder');
                return;
            }
            await fetchRepoTasks(wsId);
        } catch {
            alert('Network error creating folder');
        }
    });
}

async function renameItem(wsId: string, itemPath: string, currentName: string): Promise<void> {
    showInputDialog('Rename', 'New name', async (newName) => {
        try {
            const res = await fetch(getApiBase() + `/workspaces/${encodeURIComponent(wsId)}/tasks`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: itemPath, newName }),
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({ error: 'Failed' }));
                alert(data.error || 'Failed to rename');
                return;
            }
            await fetchRepoTasks(wsId);
        } catch {
            alert('Network error renaming');
        }
    }, currentName);
}

async function deleteItem(wsId: string, itemPath: string, name: string): Promise<void> {
    if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;

    try {
        const res = await fetch(getApiBase() + `/workspaces/${encodeURIComponent(wsId)}/tasks`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: itemPath }),
        });
        if (!res.ok && res.status !== 204) {
            const data = await res.json().catch(() => ({ error: 'Failed' }));
            alert(data.error || 'Failed to delete');
            return;
        }
        await fetchRepoTasks(wsId);
    } catch {
        alert('Network error deleting');
    }
}

async function archiveItem(wsId: string, itemPath: string, action: 'archive' | 'unarchive'): Promise<void> {
    try {
        const res = await fetch(getApiBase() + `/workspaces/${encodeURIComponent(wsId)}/tasks/archive`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: itemPath, action }),
        });
        if (!res.ok) {
            const data = await res.json().catch(() => ({ error: 'Failed' }));
            alert(data.error || `Failed to ${action}`);
            return;
        }
        await fetchRepoTasks(wsId);
    } catch {
        alert(`Network error during ${action}`);
    }
}

async function updateStatus(wsId: string, itemPath: string, status: string): Promise<void> {
    try {
        const res = await fetch(getApiBase() + `/workspaces/${encodeURIComponent(wsId)}/tasks`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: itemPath, status }),
        });
        if (!res.ok) {
            const data = await res.json().catch(() => ({ error: 'Failed' }));
            alert(data.error || 'Failed to update status');
            return;
        }
        await fetchRepoTasks(wsId);
    } catch {
        alert('Network error updating status');
    }
}

// ================================================================
// Status helpers
// ================================================================

const STATUS_CYCLE = ['pending', 'in-progress', 'done', 'future'];
const STATUS_LABELS: Record<string, string> = {
    'pending': 'Pending',
    'in-progress': 'In Progress',
    'done': 'Done',
    'future': 'Future',
};
const STATUS_ICONS: Record<string, string> = {
    'pending': '○',
    'in-progress': '◐',
    'done': '●',
    'future': '◇',
};

function nextStatus(current: string): string {
    const idx = STATUS_CYCLE.indexOf(current);
    return STATUS_CYCLE[(idx + 1) % STATUS_CYCLE.length];
}

// ================================================================
// Rendering (into repo detail Tasks sub-tab)
// ================================================================

/** Track whether the tree event listener is already attached to avoid duplicates. */
let treeListenerAttached = false;
let treeListenerContainer: HTMLElement | null = null;

function renderTasksInRepo(): void {
    const container = document.getElementById('repo-tasks-tree');
    if (!container) return;

    if (!currentTasks) {
        container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">&#128203;</div>' +
            '<div class="empty-state-title">No tasks folder found</div>' +
            '<div class="empty-state-text">Tasks are markdown files in .vscode/tasks/. Click "+ New Task" to get started.</div></div>';
        return;
    }

    container.innerHTML = renderFolder(currentTasks, '');

    // Only attach the event listener once per container element
    if (!treeListenerAttached || treeListenerContainer !== container) {
        treeListenerAttached = true;
        treeListenerContainer = container;
        attachTreeEventListeners(container);
    }
}

function renderFolder(folder: TaskFolder, parentPath: string): string {
    let html = '';

    // Render child folders
    if (folder.children) {
        for (const child of folder.children) {
            const folderPath = child.relativePath || child.name;
            const isExpanded = taskPanelState.expandedFolders[folderPath] !== false;
            const isArchive = child.name === 'archive';
            html += '<div class="task-tree-folder' + (isArchive ? ' task-archive-folder' : '') + '">' +
                '<div class="task-tree-row task-folder-row" data-path="' + escapeHtmlClient(folderPath) + '">' +
                    '<span class="task-tree-toggle" data-folder="' + escapeHtmlClient(folderPath) + '">' + (isExpanded ? '▼' : '▶') + '</span>' +
                    '<span class="task-tree-icon">📁</span>' +
                    '<span class="task-tree-name">' + escapeHtmlClient(child.name) + '</span>' +
                    '<span class="task-tree-actions">' +
                        '<button class="task-action-btn" data-action="new-task" data-folder="' + escapeHtmlClient(folderPath) + '" title="New task">+📄</button>' +
                        '<button class="task-action-btn" data-action="new-folder" data-parent="' + escapeHtmlClient(folderPath) + '" title="New folder">+📁</button>' +
                        '<button class="task-action-btn" data-action="rename" data-path="' + escapeHtmlClient(folderPath) + '" data-name="' + escapeHtmlClient(child.name) + '" title="Rename">✏️</button>' +
                        (isArchive ? '' : '<button class="task-action-btn" data-action="archive" data-path="' + escapeHtmlClient(folderPath) + '" title="Archive">📦</button>') +
                        '<button class="task-action-btn" data-action="delete" data-path="' + escapeHtmlClient(folderPath) + '" data-name="' + escapeHtmlClient(child.name) + '" title="Delete">🗑️</button>' +
                    '</span>' +
                '</div>' +
                '<div class="task-tree-children' + (isExpanded ? '' : ' hidden') + '">' +
                    renderFolder(child, folderPath) +
                '</div>' +
            '</div>';
        }
    }

    // Render document groups
    if (folder.documentGroups) {
        for (const group of folder.documentGroups) {
            // Derive the group path from the first document's relativePath + baseName
            const firstDoc = group.documents[0];
            const groupPath = firstDoc?.relativePath
                ? firstDoc.relativePath + '/' + group.baseName
                : group.baseName;
            html += '<div class="task-tree-group">' +
                '<div class="task-tree-row task-group-row">' +
                    '<span class="task-tree-icon">📑</span>' +
                    '<span class="task-tree-name">' + escapeHtmlClient(group.baseName) + '</span>' +
                    renderGroupStatusBadge(group) +
                    '<span class="task-tree-actions">' +
                        '<button class="task-action-btn" data-action="rename" data-path="' + escapeHtmlClient(groupPath) + '" data-name="' + escapeHtmlClient(group.baseName) + '" title="Rename">✏️</button>' +
                        renderArchiveButton(groupPath, group.baseName) +
                        '<button class="task-action-btn" data-action="delete" data-path="' + escapeHtmlClient(groupPath) + '" data-name="' + escapeHtmlClient(group.baseName) + '" title="Delete">🗑️</button>' +
                    '</span>' +
                '</div>';
            if (group.documents) {
                for (const doc of group.documents) {
                    html += renderDocumentRow(doc);
                }
            }
            html += '</div>';
        }
    }

    // Render single documents
    if (folder.singleDocuments) {
        for (const doc of folder.singleDocuments) {
            html += renderTaskRow(doc);
        }
    }

    return html;
}

function renderTaskRow(doc: TaskDocument): string {
    const docPath = doc.relativePath
        ? doc.relativePath + '/' + doc.fileName
        : doc.fileName;
    const displayName = doc.baseName;
    return '<div class="task-tree-row task-file-row" data-file-path="' + escapeHtmlClient(docPath) + '">' +
        '<span class="task-tree-icon">📄</span>' +
        '<span class="task-tree-name">' + escapeHtmlClient(displayName) + '</span>' +
        renderDocStatusBadge(doc) +
        '<span class="task-tree-actions">' +
            '<button class="task-action-btn" data-action="rename" data-path="' + escapeHtmlClient(docPath) + '" data-name="' + escapeHtmlClient(displayName) + '" title="Rename">✏️</button>' +
            renderArchiveButton(docPath, displayName) +
            '<button class="task-action-btn" data-action="delete" data-path="' + escapeHtmlClient(docPath) + '" data-name="' + escapeHtmlClient(displayName) + '" title="Delete">🗑️</button>' +
        '</span>' +
    '</div>';
}

function renderDocumentRow(doc: TaskDocument): string {
    const docPath = doc.relativePath
        ? doc.relativePath + '/' + doc.fileName
        : doc.fileName;
    // Show the doc type suffix (e.g., "plan") or the full filename for clarity
    const displayName = doc.docType || doc.fileName;
    return '<div class="task-tree-row task-doc-row" data-file-path="' + escapeHtmlClient(docPath) + '">' +
        '<span class="task-tree-icon">📄</span>' +
        '<span class="task-tree-name task-doc-name">' + escapeHtmlClient(displayName) + '</span>' +
        (doc.status ? renderStatusBadgeRaw(doc.status, docPath) : '') +
        '<span class="task-tree-actions">' +
            '<button class="task-action-btn" data-action="delete" data-path="' + escapeHtmlClient(docPath) + '" data-name="' + escapeHtmlClient(doc.fileName) + '" title="Delete">🗑️</button>' +
        '</span>' +
    '</div>';
}

function renderDocStatusBadge(doc: TaskDocument): string {
    const status = doc.status || '';
    if (!status) return '';
    const docPath = doc.relativePath
        ? doc.relativePath + '/' + doc.fileName
        : doc.fileName;
    return renderStatusBadgeRaw(status, docPath);
}

function renderGroupStatusBadge(group: TaskDocumentGroup): string {
    // Use the status from the first document in the group (if any)
    const firstDoc = group.documents[0];
    if (!firstDoc || !firstDoc.status) return '';
    const docPath = firstDoc.relativePath
        ? firstDoc.relativePath + '/' + firstDoc.fileName
        : firstDoc.fileName;
    return renderStatusBadgeRaw(firstDoc.status, docPath);
}

function renderStatusBadgeRaw(status: string, itemPath: string): string {
    const label = STATUS_LABELS[status] || status;
    const icon = STATUS_ICONS[status] || '○';
    const next = nextStatus(status);
    return '<button class="task-status-badge task-status-' + escapeHtmlClient(status) + '" ' +
        'data-action="status" data-path="' + escapeHtmlClient(itemPath) + '" data-status="' + escapeHtmlClient(next) + '" ' +
        'title="Click to change to ' + escapeHtmlClient(STATUS_LABELS[next] || next) + '">' +
        icon + ' ' + escapeHtmlClient(label) +
    '</button>';
}

function renderArchiveButton(itemPath: string, name: string): string {
    const isArchived = itemPath.startsWith('archive/') || itemPath.startsWith('archive\\');
    const action = isArchived ? 'unarchive' : 'archive';
    const icon = isArchived ? '📤' : '📦';
    const title = isArchived ? 'Unarchive' : 'Archive';
    return '<button class="task-action-btn" data-action="' + action + '" data-path="' + escapeHtmlClient(itemPath) + '" title="' + title + '">' + icon + '</button>';
}

// ================================================================
// Event delegation
// ================================================================

function attachTreeEventListeners(container: HTMLElement): void {
    container.addEventListener('click', (e: Event) => {
        const wsId = taskPanelState.selectedWorkspaceId;
        if (!wsId) return;

        const target = e.target as HTMLElement;

        // 1. Check for action buttons first (highest priority)
        const btn = target.closest('[data-action]') as HTMLElement | null;
        if (btn) {
            const action = btn.getAttribute('data-action');
            const itemPath = btn.getAttribute('data-path') || '';
            const name = btn.getAttribute('data-name') || '';
            const folder = btn.getAttribute('data-folder') || '';
            const parent = btn.getAttribute('data-parent') || '';
            const status = btn.getAttribute('data-status') || '';

            switch (action) {
                case 'new-task':
                    createRepoTask(wsId, folder || undefined);
                    break;
                case 'new-folder':
                    createRepoFolder(wsId, parent || undefined);
                    break;
                case 'rename':
                    renameItem(wsId, itemPath, name);
                    break;
                case 'delete':
                    deleteItem(wsId, itemPath, name);
                    break;
                case 'archive':
                    archiveItem(wsId, itemPath, 'archive');
                    break;
                case 'unarchive':
                    archiveItem(wsId, itemPath, 'unarchive');
                    break;
                case 'status':
                    updateStatus(wsId, itemPath, status);
                    break;
            }
            return;
        }

        // 2. Check for folder row click (toggle expand/collapse on full row)
        const folderRow = target.closest('.task-folder-row') as HTMLElement | null;
        if (folderRow) {
            const folderKey = folderRow.getAttribute('data-path');
            if (folderKey) {
                taskPanelState.expandedFolders[folderKey] = !(taskPanelState.expandedFolders[folderKey] !== false);
                renderTasksInRepo();
            }
            return;
        }

        // 3. Check for file row click (open markdown preview)
        const fileRow = target.closest('[data-file-path]') as HTMLElement | null;
        if (fileRow) {
            const filePath = fileRow.getAttribute('data-file-path');
            if (filePath) {
                openTaskFile(wsId, filePath);
            }
            return;
        }
    });
}

// ================================================================
// Markdown file preview
// ================================================================

/** Currently open file path (to highlight active row). */
let currentOpenFile: string | null = null;

async function openTaskFile(wsId: string, filePath: string): Promise<void> {
    currentOpenFile = filePath;

    // Highlight the active row
    const container = document.getElementById('repo-tasks-tree');
    if (container) {
        container.querySelectorAll('[data-file-path]').forEach(el => {
            el.classList.toggle('task-file-active', el.getAttribute('data-file-path') === filePath);
        });
    }

    // Show or create the preview panel
    let previewPanel = document.getElementById('task-file-preview');
    if (!previewPanel) {
        // Create the preview panel after the tree
        const treeEl = document.getElementById('repo-tasks-tree');
        if (!treeEl) return;
        previewPanel = document.createElement('div');
        previewPanel.id = 'task-file-preview';
        previewPanel.className = 'task-file-preview';
        treeEl.parentElement!.appendChild(previewPanel);
    }

    previewPanel.innerHTML = '<div class="task-preview-loading">Loading...</div>';
    previewPanel.classList.remove('hidden');

    try {
        const data = await fetchApi(`/workspaces/${encodeURIComponent(wsId)}/tasks/content?path=${encodeURIComponent(filePath)}`);
        if (!data || data.error) {
            previewPanel.innerHTML = '<div class="task-preview-error">' + escapeHtmlClient(data?.error || 'Failed to load file') + '</div>';
            return;
        }

        const content: string = data.content || '';
        const fileName = filePath.split('/').pop() || filePath;

        previewPanel.innerHTML =
            '<div class="task-preview-header">' +
                '<span class="task-preview-title">' + escapeHtmlClient(fileName) + '</span>' +
                '<button class="task-preview-close" id="task-preview-close" title="Close">&times;</button>' +
            '</div>' +
            '<div class="task-preview-body">' + renderMarkdown(content) + '</div>';

        document.getElementById('task-preview-close')?.addEventListener('click', closeTaskPreview);
    } catch {
        previewPanel.innerHTML = '<div class="task-preview-error">Network error loading file</div>';
    }
}

function closeTaskPreview(): void {
    currentOpenFile = null;
    const previewPanel = document.getElementById('task-file-preview');
    if (previewPanel) {
        previewPanel.classList.add('hidden');
        previewPanel.innerHTML = '';
    }
    // Remove active highlight
    const container = document.getElementById('repo-tasks-tree');
    if (container) {
        container.querySelectorAll('.task-file-active').forEach(el => el.classList.remove('task-file-active'));
    }
}

// ================================================================
// Simple markdown renderer (no external deps)
// ================================================================

function renderMarkdown(md: string): string {
    // Strip YAML frontmatter
    let text = md.replace(/^---\n[\s\S]*?\n---\n*/, '');

    // Escape HTML first
    text = escapeHtmlClient(text);

    // Code blocks (``` ... ```)
    text = text.replace(/```(\w*)\n([\s\S]*?)```/g, (_m, lang, code) => {
        return '<pre><code class="lang-' + (lang || 'text') + '">' + code.trimEnd() + '</code></pre>';
    });

    // Inline code
    text = text.replace(/`([^`\n]+)`/g, '<code>$1</code>');

    // Headings (must be done after escaping)
    text = text.replace(/^#### (.+)$/gm, '<h4>$1</h4>');
    text = text.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    text = text.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    text = text.replace(/^# (.+)$/gm, '<h1>$1</h1>');

    // Horizontal rule
    text = text.replace(/^---$/gm, '<hr>');

    // Bold and italic
    text = text.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
    text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/\*(.+?)\*/g, '<em>$1</em>');

    // Checkboxes
    text = text.replace(/^(\s*)- \[x\] (.+)$/gm, '$1<div class="task-checkbox checked">&#9745; $2</div>');
    text = text.replace(/^(\s*)- \[ \] (.+)$/gm, '$1<div class="task-checkbox">&#9744; $2</div>');

    // Unordered lists
    text = text.replace(/^- (.+)$/gm, '<li>$1</li>');
    text = text.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');

    // Ordered lists
    text = text.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');

    // Blockquotes
    text = text.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');

    // Links
    text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

    // Paragraphs: wrap remaining text lines that aren't already wrapped
    text = text.replace(/^(?!<[a-z])((?!<\/)[^\n]+)$/gm, '<p>$1</p>');

    // Clean up empty paragraphs
    text = text.replace(/<p>\s*<\/p>/g, '');

    return text;
}

// ================================================================
// AI Task Generation Dialog
// ================================================================

export function showRepoAIGenerateDialog(wsId: string): void {
    const existing = document.getElementById('ai-generate-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'ai-generate-overlay';
    overlay.className = 'enqueue-overlay';

    overlay.innerHTML =
        '<div class="enqueue-dialog" style="width:500px;max-height:80vh;overflow-y:auto">' +
            '<div class="enqueue-dialog-header">' +
                '<h2>Generate Task with AI</h2>' +
                '<button class="enqueue-close-btn" id="ai-gen-close">&times;</button>' +
            '</div>' +
            '<form id="ai-gen-form" class="enqueue-form">' +
                '<div class="enqueue-field">' +
                    '<label for="ai-gen-prompt">Description / Prompt</label>' +
                    '<textarea id="ai-gen-prompt" rows="3" placeholder="Describe the task you want to create..." required style="width:100%;resize:vertical"></textarea>' +
                '</div>' +
                '<div class="enqueue-field">' +
                    '<label for="ai-gen-name">Task Name (optional)</label>' +
                    '<input type="text" id="ai-gen-name" placeholder="kebab-case name, or leave empty for AI to generate" />' +
                '</div>' +
                '<div class="enqueue-field">' +
                    '<label for="ai-gen-folder">Target Folder (optional)</label>' +
                    '<input type="text" id="ai-gen-folder" placeholder="relative path under .vscode/tasks/" />' +
                '</div>' +
                '<div class="enqueue-field">' +
                    '<label for="ai-gen-mode">Mode</label>' +
                    '<select id="ai-gen-mode">' +
                        '<option value="create">Create from prompt</option>' +
                        '<option value="from-feature">From feature context</option>' +
                    '</select>' +
                '</div>' +
                '<div class="enqueue-field">' +
                    '<label for="ai-gen-depth">Depth</label>' +
                    '<select id="ai-gen-depth">' +
                        '<option value="simple">Simple</option>' +
                        '<option value="deep">Deep (go-deep skill)</option>' +
                    '</select>' +
                '</div>' +
                '<div id="ai-gen-progress" class="hidden" style="margin:8px 0;padding:8px;background:var(--bg-secondary,#f5f5f5);border-radius:4px;font-size:0.85em;max-height:200px;overflow-y:auto;white-space:pre-wrap"></div>' +
                '<div class="enqueue-actions">' +
                    '<button type="button" class="enqueue-btn-secondary" id="ai-gen-cancel">Cancel</button>' +
                    '<button type="submit" class="enqueue-btn-primary" id="ai-gen-submit">Generate</button>' +
                '</div>' +
            '</form>' +
        '</div>';

    document.body.appendChild(overlay);

    const promptEl = document.getElementById('ai-gen-prompt') as HTMLTextAreaElement;
    if (promptEl) promptEl.focus();

    const close = () => overlay.remove();
    document.getElementById('ai-gen-close')?.addEventListener('click', close);
    document.getElementById('ai-gen-cancel')?.addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    document.getElementById('ai-gen-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();

        const prompt = (document.getElementById('ai-gen-prompt') as HTMLTextAreaElement)?.value.trim();
        if (!prompt) return;

        const name = (document.getElementById('ai-gen-name') as HTMLInputElement)?.value.trim() || undefined;
        const targetFolder = (document.getElementById('ai-gen-folder') as HTMLInputElement)?.value.trim() || undefined;
        const mode = (document.getElementById('ai-gen-mode') as HTMLSelectElement)?.value || 'create';
        const depth = (document.getElementById('ai-gen-depth') as HTMLSelectElement)?.value || 'simple';

        const submitBtn = document.getElementById('ai-gen-submit') as HTMLButtonElement;
        const progressEl = document.getElementById('ai-gen-progress') as HTMLDivElement;
        if (submitBtn) submitBtn.disabled = true;
        if (progressEl) { progressEl.classList.remove('hidden'); progressEl.textContent = 'Starting...\n'; }

        try {
            const res = await fetch(
                getApiBase() + `/workspaces/${encodeURIComponent(wsId)}/tasks/generate`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ prompt, name, targetFolder, mode, depth }),
                }
            );

            if (!res.ok || !res.body) {
                const data = await res.json().catch(() => ({ error: 'Request failed' }));
                if (progressEl) progressEl.textContent += 'Error: ' + (data.error || 'Unknown error') + '\n';
                if (submitBtn) submitBtn.disabled = false;
                return;
            }

            // Read SSE stream
            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });

                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                let eventType = '';
                for (const line of lines) {
                    if (line.startsWith('event: ')) {
                        eventType = line.substring(7).trim();
                    } else if (line.startsWith('data: ')) {
                        try {
                            const data = JSON.parse(line.substring(6));
                            if (eventType === 'progress' && progressEl) {
                                progressEl.textContent += data.message + '\n';
                            } else if (eventType === 'chunk' && progressEl) {
                                progressEl.textContent += data.content || '';
                            } else if (eventType === 'error' && progressEl) {
                                progressEl.textContent += 'Error: ' + (data.message || '') + '\n';
                            } else if (eventType === 'done') {
                                if (data.success) {
                                    if (progressEl) progressEl.textContent += '\n✅ Task generated' + (data.filePath ? ': ' + data.filePath : '') + '\n';
                                    await fetchRepoTasks(wsId);
                                } else {
                                    if (progressEl) progressEl.textContent += '\n❌ Generation failed\n';
                                }
                            }
                        } catch { /* ignore parse errors */ }
                        eventType = '';
                    }
                }
            }
        } catch (err) {
            if (progressEl) progressEl.textContent += 'Network error: ' + (err instanceof Error ? err.message : String(err)) + '\n';
        } finally {
            if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Generate Again'; }
        }
    });
}

// ================================================================
// Expose for global access (called from repos.ts)
// ================================================================

(window as any).fetchRepoTasks = fetchRepoTasks;
(window as any).createRepoTask = createRepoTask;
(window as any).createRepoFolder = createRepoFolder;
(window as any).showRepoAIGenerateDialog = showRepoAIGenerateDialog;
