/**
 * Tasks view: workspace task CRUD operations with tree rendering.
 */

import { appState, taskPanelState } from './state';
import { getApiBase } from './config';
import { fetchApi } from './core';
import { escapeHtmlClient } from './utils';

// ================================================================
// Types
// ================================================================

interface TaskItem {
    name: string;
    relativePath: string;
    status?: string;
    type: 'file' | 'folder' | 'documentGroup';
    children?: TaskItem[];
    documents?: Array<{ name: string; relativePath: string; status?: string }>;
    singleDocuments?: TaskItem[];
    documentGroups?: TaskItem[];
}

// ================================================================
// Data fetching
// ================================================================

let currentTasks: TaskItem | null = null;

export async function fetchTasksData(): Promise<void> {
    const wsId = taskPanelState.selectedWorkspaceId;
    if (!wsId) {
        currentTasks = null;
        renderTasksPanel();
        return;
    }

    const data = await fetchApi(`/workspaces/${encodeURIComponent(wsId)}/tasks`);
    currentTasks = data || null;
    renderTasksPanel();
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

async function createTask(folder?: string): Promise<void> {
    const wsId = taskPanelState.selectedWorkspaceId;
    if (!wsId) return;

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
            await fetchTasksData();
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

async function createFolder(parent?: string): Promise<void> {
    const wsId = taskPanelState.selectedWorkspaceId;
    if (!wsId) return;

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
            await fetchTasksData();
        } catch {
            alert('Network error creating folder');
        }
    });
}

async function renameItem(itemPath: string, currentName: string): Promise<void> {
    const wsId = taskPanelState.selectedWorkspaceId;
    if (!wsId) return;

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
            await fetchTasksData();
        } catch {
            alert('Network error renaming');
        }
    }, currentName);
}

async function deleteItem(itemPath: string, name: string): Promise<void> {
    const wsId = taskPanelState.selectedWorkspaceId;
    if (!wsId) return;

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
        await fetchTasksData();
    } catch {
        alert('Network error deleting');
    }
}

async function archiveItem(itemPath: string, action: 'archive' | 'unarchive'): Promise<void> {
    const wsId = taskPanelState.selectedWorkspaceId;
    if (!wsId) return;

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
        await fetchTasksData();
    } catch {
        alert(`Network error during ${action}`);
    }
}

async function updateStatus(itemPath: string, status: string): Promise<void> {
    const wsId = taskPanelState.selectedWorkspaceId;
    if (!wsId) return;

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
        await fetchTasksData();
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
// Rendering
// ================================================================

function renderTasksPanel(): void {
    const container = document.getElementById('tasks-tree');
    if (!container) return;

    if (!taskPanelState.selectedWorkspaceId) {
        container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📋</div>' +
            '<div class="empty-state-title">Select a workspace</div>' +
            '<div class="empty-state-text">Choose a workspace from the dropdown to manage tasks.</div></div>';
        return;
    }

    if (!currentTasks) {
        container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📋</div>' +
            '<div class="empty-state-title">No tasks found</div>' +
            '<div class="empty-state-text">Create a task to get started.</div></div>';
        return;
    }

    container.innerHTML = renderFolder(currentTasks, '');
    attachTreeEventListeners(container);
}

function renderFolder(folder: TaskItem, parentPath: string): string {
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
            const groupPath = group.relativePath || group.name;
            html += '<div class="task-tree-group">' +
                '<div class="task-tree-row task-group-row">' +
                    '<span class="task-tree-icon">📑</span>' +
                    '<span class="task-tree-name">' + escapeHtmlClient(group.name) + '</span>' +
                    renderStatusBadge(group) +
                    '<span class="task-tree-actions">' +
                        '<button class="task-action-btn" data-action="rename" data-path="' + escapeHtmlClient(groupPath) + '" data-name="' + escapeHtmlClient(group.name) + '" title="Rename">✏️</button>' +
                        renderArchiveButton(groupPath, group.name) +
                        '<button class="task-action-btn" data-action="delete" data-path="' + escapeHtmlClient(groupPath) + '" data-name="' + escapeHtmlClient(group.name) + '" title="Delete">🗑️</button>' +
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

function renderTaskRow(item: TaskItem): string {
    const itemPath = item.relativePath || item.name;
    return '<div class="task-tree-row task-file-row">' +
        '<span class="task-tree-icon">📄</span>' +
        '<span class="task-tree-name">' + escapeHtmlClient(item.name) + '</span>' +
        renderStatusBadge(item) +
        '<span class="task-tree-actions">' +
            '<button class="task-action-btn" data-action="rename" data-path="' + escapeHtmlClient(itemPath) + '" data-name="' + escapeHtmlClient(item.name) + '" title="Rename">✏️</button>' +
            renderArchiveButton(itemPath, item.name) +
            '<button class="task-action-btn" data-action="delete" data-path="' + escapeHtmlClient(itemPath) + '" data-name="' + escapeHtmlClient(item.name) + '" title="Delete">🗑️</button>' +
        '</span>' +
    '</div>';
}

function renderDocumentRow(doc: { name: string; relativePath: string; status?: string }): string {
    const docPath = doc.relativePath || doc.name;
    return '<div class="task-tree-row task-doc-row">' +
        '<span class="task-tree-icon">📄</span>' +
        '<span class="task-tree-name task-doc-name">' + escapeHtmlClient(doc.name) + '</span>' +
        (doc.status ? renderStatusBadgeRaw(doc.status, docPath) : '') +
        '<span class="task-tree-actions">' +
            '<button class="task-action-btn" data-action="delete" data-path="' + escapeHtmlClient(docPath) + '" data-name="' + escapeHtmlClient(doc.name) + '" title="Delete">🗑️</button>' +
        '</span>' +
    '</div>';
}

function renderStatusBadge(item: TaskItem): string {
    const status = item.status || '';
    if (!status) return '';
    const itemPath = item.relativePath || item.name;
    return renderStatusBadgeRaw(status, itemPath);
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
        const target = e.target as HTMLElement;
        const btn = target.closest('[data-action]') as HTMLElement | null;
        if (!btn) {
            // Check for folder toggle
            const toggle = target.closest('.task-tree-toggle') as HTMLElement | null;
            if (toggle) {
                const folderKey = toggle.getAttribute('data-folder');
                if (folderKey) {
                    taskPanelState.expandedFolders[folderKey] = !(taskPanelState.expandedFolders[folderKey] !== false);
                    renderTasksPanel();
                }
            }
            return;
        }

        const action = btn.getAttribute('data-action');
        const itemPath = btn.getAttribute('data-path') || '';
        const name = btn.getAttribute('data-name') || '';
        const folder = btn.getAttribute('data-folder') || '';
        const parent = btn.getAttribute('data-parent') || '';
        const status = btn.getAttribute('data-status') || '';

        switch (action) {
            case 'new-task':
                createTask(folder || undefined);
                break;
            case 'new-folder':
                createFolder(parent || undefined);
                break;
            case 'rename':
                renameItem(itemPath, name);
                break;
            case 'delete':
                deleteItem(itemPath, name);
                break;
            case 'archive':
                archiveItem(itemPath, 'archive');
                break;
            case 'unarchive':
                archiveItem(itemPath, 'unarchive');
                break;
            case 'status':
                updateStatus(itemPath, status);
                break;
        }
    });
}

// ================================================================
// Workspace selector for tasks tab
// ================================================================

function initTasksWorkspaceSelector(): void {
    const select = document.getElementById('tasks-workspace-select') as HTMLSelectElement | null;
    if (!select) return;

    select.addEventListener('change', () => {
        taskPanelState.selectedWorkspaceId = select.value || null;
        fetchTasksData();
    });
}

export function populateTasksWorkspaces(workspaces: any[]): void {
    const select = document.getElementById('tasks-workspace-select') as HTMLSelectElement | null;
    if (!select) return;

    // Preserve current selection
    const current = select.value;
    select.innerHTML = '<option value="">Select workspace...</option>';
    for (const ws of workspaces) {
        const opt = document.createElement('option');
        opt.value = ws.id;
        opt.textContent = ws.name || ws.id;
        select.appendChild(opt);
    }

    if (current && workspaces.some(w => w.id === current)) {
        select.value = current;
    } else if (workspaces.length === 1) {
        select.value = workspaces[0].id;
        taskPanelState.selectedWorkspaceId = workspaces[0].id;
        fetchTasksData();
    }
}

// ================================================================
// Init
// ================================================================

initTasksWorkspaceSelector();

// Wire toolbar buttons
const newTaskBtn = document.getElementById('tasks-new-task-btn');
if (newTaskBtn) newTaskBtn.addEventListener('click', () => createTask());

const newFolderBtn = document.getElementById('tasks-new-folder-btn');
if (newFolderBtn) newFolderBtn.addEventListener('click', () => createFolder());

// Expose for tab switching
(window as any).fetchTasksData = fetchTasksData;
(window as any).populateTasksWorkspaces = populateTasksWorkspaces;
