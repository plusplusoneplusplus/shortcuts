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
// Miller columns rendering (Finder / Azure Portal blade style)
// ================================================================

/** Track whether the columns event listener is already attached. */
let columnsListenerAttached = false;
let columnsListenerContainer: HTMLElement | null = null;

/** Recursively count all items (documents + groups) inside a folder. */
function countFolderItems(folder: TaskFolder): number {
    let count = 0;
    if (folder.singleDocuments) count += folder.singleDocuments.length;
    if (folder.documentGroups) count += folder.documentGroups.length;
    if (folder.children) {
        for (const child of folder.children) {
            count += countFolderItems(child);
        }
    }
    return count;
}

function renderTasksInRepo(): void {
    const container = document.getElementById('repo-tasks-tree');
    if (!container) return;

    if (!currentTasks) {
        container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">&#128203;</div>' +
            '<div class="empty-state-title">No tasks folder found</div>' +
            '<div class="empty-state-text">Tasks are markdown files in .vscode/tasks/. Click "+ New Task" to get started.</div></div>';
        return;
    }

    // Build the Miller columns from the current navigation path
    renderMillerColumns(container);

    // Only attach the event listener once per container element
    if (!columnsListenerAttached || columnsListenerContainer !== container) {
        columnsListenerAttached = true;
        columnsListenerContainer = container;
        attachMillerEventListeners(container);
    }
}

/** Resolve a folder by navigating the path segments from root. */
function resolveFolderByPath(root: TaskFolder, folderPath: string): TaskFolder | null {
    if (!folderPath) return root;
    const parts = folderPath.split('/');
    let current = root;
    for (const part of parts) {
        const child = (current.children || []).find(c => c.name === part);
        if (!child) return null;
        current = child;
    }
    return current;
}

/** Render the full Miller columns view into the container. */
function renderMillerColumns(container: HTMLElement): void {
    const navPath = taskPanelState.expandedFolders['__navPath'] as any as string || '';
    const segments = navPath ? navPath.split('/') : [];

    let html = '<div class="miller-columns" id="miller-columns">';

    // Root column (always visible)
    html += renderColumn(currentTasks!, '', segments[0] || null);

    // One column per expanded folder in the path
    let accumulated = '';
    for (let i = 0; i < segments.length; i++) {
        accumulated = segments.slice(0, i + 1).join('/');
        const folder = resolveFolderByPath(currentTasks!, accumulated);
        if (!folder) break;
        const selectedChild = segments[i + 1] || null;
        html += renderColumn(folder, accumulated, selectedChild);
    }

    // Preview column if a file is open
    if (taskPanelState.openFilePath) {
        html += '<div class="miller-column miller-preview-column" id="miller-preview-column">' +
            '<div class="task-preview-loading">Loading...</div>' +
        '</div>';
    }

    html += '</div>';
    container.innerHTML = html;

    // Scroll to the rightmost column
    setTimeout(() => {
        const cols = document.getElementById('miller-columns');
        if (cols) cols.scrollLeft = cols.scrollWidth;
    }, 0);

    // If a file is open, load its content
    if (taskPanelState.openFilePath) {
        const wsId = taskPanelState.selectedWorkspaceId;
        if (wsId) loadPreviewContent(wsId, taskPanelState.openFilePath);
    }
}

/** Render a single Miller column showing the contents of a folder. */
function renderColumn(folder: TaskFolder, folderPath: string, selectedChild: string | null): string {
    const label = folderPath ? folderPath.split('/').pop()! : 'tasks';
    let html = '<div class="miller-column" data-column-path="' + escapeHtmlClient(folderPath) + '">';
    html += '<div class="miller-column-header">' + escapeHtmlClient(label) + '</div>';
    html += '<div class="miller-column-body">';

    // Child folders
    if (folder.children) {
        for (const child of folder.children) {
            const childPath = folderPath ? folderPath + '/' + child.name : child.name;
            const isSelected = selectedChild === child.name;
            const isArchive = child.name === 'archive';
            const itemCount = countFolderItems(child);
            const countBadge = itemCount > 0 ? '<span class="task-folder-count">' + itemCount + '</span>' : '';
            html += '<div class="miller-row' + (isSelected ? ' miller-row-selected' : '') + (isArchive ? ' task-archive-folder' : '') + '" data-nav-folder="' + escapeHtmlClient(childPath) + '">' +
                '<span class="task-tree-icon">📁</span>' +
                '<span class="miller-row-name">' + escapeHtmlClient(child.name) + countBadge + '</span>' +
                '<span class="miller-chevron">▶</span>' +
            '</div>';
        }
    }

    // Document groups
    if (folder.documentGroups) {
        for (const group of folder.documentGroups) {
            for (const doc of group.documents) {
                const docPath = doc.relativePath ? doc.relativePath + '/' + doc.fileName : doc.fileName;
                const isActive = taskPanelState.openFilePath === docPath;
                const displayName = doc.docType ? group.baseName + '.' + doc.docType : doc.fileName;
                html += '<div class="miller-row miller-file-row' + (isActive ? ' miller-row-selected' : '') + '" data-file-path="' + escapeHtmlClient(docPath) + '">' +
                    '<span class="task-tree-icon">📄</span>' +
                    '<span class="miller-row-name">' + escapeHtmlClient(displayName) + '</span>' +
                    (doc.status ? '<span class="miller-status task-status-' + escapeHtmlClient(doc.status) + '">' + (STATUS_ICONS[doc.status] || '') + '</span>' : '') +
                '</div>';
            }
        }
    }

    // Single documents
    if (folder.singleDocuments) {
        for (const doc of folder.singleDocuments) {
            const docPath = doc.relativePath ? doc.relativePath + '/' + doc.fileName : doc.fileName;
            const isActive = taskPanelState.openFilePath === docPath;
            html += '<div class="miller-row miller-file-row' + (isActive ? ' miller-row-selected' : '') + '" data-file-path="' + escapeHtmlClient(docPath) + '">' +
                '<span class="task-tree-icon">📄</span>' +
                '<span class="miller-row-name">' + escapeHtmlClient(doc.baseName) + '</span>' +
                (doc.status ? '<span class="miller-status task-status-' + escapeHtmlClient(doc.status) + '">' + (STATUS_ICONS[doc.status] || '') + '</span>' : '') +
            '</div>';
        }
    }

    if (!folder.children?.length && !folder.documentGroups?.length && !folder.singleDocuments?.length) {
        html += '<div class="miller-empty">Empty folder</div>';
    }

    html += '</div></div>';
    return html;
}

/** Attach event delegation for the Miller columns container. */
function attachMillerEventListeners(container: HTMLElement): void {
    container.addEventListener('click', (e: Event) => {
        const wsId = taskPanelState.selectedWorkspaceId;
        if (!wsId) return;
        const target = e.target as HTMLElement;

        // 1. Folder navigation — push a new column
        const folderRow = target.closest('[data-nav-folder]') as HTMLElement | null;
        if (folderRow) {
            const navPath = folderRow.getAttribute('data-nav-folder') || '';
            taskPanelState.expandedFolders['__navPath'] = navPath as any;
            taskPanelState.openFilePath = null;
            updateTaskHash(wsId, null);
            renderMillerColumns(container);
            return;
        }

        // 2. File click — open preview as rightmost column
        const fileRow = target.closest('[data-file-path]') as HTMLElement | null;
        if (fileRow) {
            const filePath = fileRow.getAttribute('data-file-path');
            if (filePath) {
                openTaskFile(wsId, filePath);
            }
            return;
        }
    });

    // Right-click context menu on file rows
    container.addEventListener('contextmenu', (e: Event) => {
        const me = e as MouseEvent;
        const target = me.target as HTMLElement;
        const fileRow = target.closest('[data-file-path]') as HTMLElement | null;
        if (!fileRow) return;

        me.preventDefault();
        const filePath = fileRow.getAttribute('data-file-path');
        if (!filePath) return;

        const currentStatus = resolveFileStatus(filePath);
        showTaskContextMenu(me.clientX, me.clientY, filePath, currentStatus);
    });
}

// ================================================================
// Status helpers (used in column rendering)
// ================================================================

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
// Context menu (right-click on Miller rows)
// ================================================================

/** Remove any open context menu from the DOM. */
function dismissContextMenu(): void {
    const existing = document.getElementById('task-context-menu');
    if (existing) existing.remove();
}

/** Show a context menu at (x, y) for a task file with the given path and current status. */
function showTaskContextMenu(x: number, y: number, filePath: string, currentStatus: string | undefined): void {
    dismissContextMenu();

    const wsId = taskPanelState.selectedWorkspaceId;
    if (!wsId) return;

    const menu = document.createElement('div');
    menu.id = 'task-context-menu';
    menu.className = 'task-context-menu';

    // Build "Change Status" submenu items
    let submenuHtml = '';
    for (const status of STATUS_CYCLE) {
        const icon = STATUS_ICONS[status] || '○';
        const label = STATUS_LABELS[status] || status;
        const isActive = currentStatus === status;
        submenuHtml +=
            '<div class="task-context-submenu-item' + (isActive ? ' ctx-active' : '') + '" ' +
                'data-ctx-action="set-status" data-ctx-status="' + escapeHtmlClient(status) + '" data-ctx-path="' + escapeHtmlClient(filePath) + '">' +
                '<span class="ctx-status-icon">' + icon + '</span>' +
                '<span class="ctx-status-label">' + escapeHtmlClient(label) + '</span>' +
            '</div>';
    }

    menu.innerHTML =
        '<div class="task-context-menu-item has-submenu">' +
            '<span>Change Status</span>' +
            '<div class="task-context-submenu">' + submenuHtml + '</div>' +
        '</div>';

    document.body.appendChild(menu);

    // Position: keep within viewport
    const rect = menu.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let left = x;
    let top = y;

    if (left + rect.width > vw) left = vw - rect.width - 4;
    if (top + rect.height > vh) top = vh - rect.height - 4;
    if (left < 0) left = 4;
    if (top < 0) top = 4;

    menu.style.left = left + 'px';
    menu.style.top = top + 'px';

    // Also adjust submenu if it would overflow to the right
    const submenu = menu.querySelector('.task-context-submenu') as HTMLElement | null;
    if (submenu) {
        // Temporarily show to measure
        submenu.style.display = 'block';
        const subRect = submenu.getBoundingClientRect();
        submenu.style.display = '';
        if (left + rect.width + subRect.width > vw) {
            // Open submenu to the left instead
            submenu.style.left = 'auto';
            submenu.style.right = '100%';
        }
    }

    // Click handler for submenu items
    menu.addEventListener('click', (e: Event) => {
        const target = e.target as HTMLElement;
        const item = target.closest('[data-ctx-action="set-status"]') as HTMLElement | null;
        if (item) {
            const newStatus = item.getAttribute('data-ctx-status');
            const path = item.getAttribute('data-ctx-path');
            if (newStatus && path) {
                updateStatus(wsId, path, newStatus);
            }
            dismissContextMenu();
        }
    });

    // Dismiss on click outside or Escape
    const onClickOutside = (e: MouseEvent) => {
        if (!menu.contains(e.target as Node)) {
            dismissContextMenu();
            document.removeEventListener('click', onClickOutside, true);
        }
    };
    const onKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
            dismissContextMenu();
            document.removeEventListener('keydown', onKeyDown, true);
        }
    };
    // Use setTimeout so the current right-click event doesn't immediately dismiss
    setTimeout(() => {
        document.addEventListener('click', onClickOutside, true);
        document.addEventListener('keydown', onKeyDown, true);
    }, 0);
}

/** Resolve the current status of a file from the task tree data. */
function resolveFileStatus(filePath: string): string | undefined {
    if (!currentTasks) return undefined;
    return findDocStatus(currentTasks, filePath);
}

/** Recursively search the task tree for a document's status by file path. */
function findDocStatus(folder: TaskFolder, filePath: string): string | undefined {
    // Check single documents
    if (folder.singleDocuments) {
        for (const doc of folder.singleDocuments) {
            const docPath = doc.relativePath ? doc.relativePath + '/' + doc.fileName : doc.fileName;
            if (docPath === filePath) return doc.status;
        }
    }
    // Check document groups
    if (folder.documentGroups) {
        for (const group of folder.documentGroups) {
            for (const doc of group.documents) {
                const docPath = doc.relativePath ? doc.relativePath + '/' + doc.fileName : doc.fileName;
                if (docPath === filePath) return doc.status;
            }
        }
    }
    // Recurse into children
    if (folder.children) {
        for (const child of folder.children) {
            const found = findDocStatus(child, filePath);
            if (found !== undefined) return found;
        }
    }
    return undefined;
}

// ================================================================
// Markdown file preview (rightmost Miller column)
// ================================================================

async function openTaskFile(wsId: string, filePath: string): Promise<void> {
    taskPanelState.openFilePath = filePath;
    updateTaskHash(wsId, filePath);

    // Re-render columns (adds preview column, highlights active file)
    const container = document.getElementById('repo-tasks-tree');
    if (container && currentTasks) {
        renderMillerColumns(container);
    }
}

/** Load and render file content into the preview column. */
async function loadPreviewContent(wsId: string, filePath: string): Promise<void> {
    const previewCol = document.getElementById('miller-preview-column');
    if (!previewCol) return;

    try {
        const data = await fetchApi(`/workspaces/${encodeURIComponent(wsId)}/tasks/content?path=${encodeURIComponent(filePath)}`);
        if (!data || data.error) {
            previewCol.innerHTML = '<div class="task-preview-error">' + escapeHtmlClient(data?.error || 'Failed to load file') + '</div>';
            return;
        }

        const content: string = data.content || '';
        const fileName = filePath.split('/').pop() || filePath;

        previewCol.innerHTML =
            '<div class="task-preview-header">' +
                '<span class="task-preview-title">' + escapeHtmlClient(fileName) + '</span>' +
                '<button class="task-preview-close" id="task-preview-close" title="Close">&times;</button>' +
            '</div>' +
            '<div class="task-preview-body">' + renderMarkdown(content) + '</div>';

        document.getElementById('task-preview-close')?.addEventListener('click', closeTaskPreview);
    } catch {
        previewCol.innerHTML = '<div class="task-preview-error">Network error loading file</div>';
    }
}

/**
 * Called from hash router when navigating to #repos/{id}/tasks/{file}.
 * Waits for the tasks tree to load, then opens the file.
 */
async function openTaskFileFromHash(wsId: string, filePath: string): Promise<void> {
    let retries = 0;
    while (!currentTasks && retries < 20) {
        await new Promise(r => setTimeout(r, 150));
        retries++;
    }
    // Auto-expand the navigation path to the file's parent folder
    const parts = filePath.split('/');
    if (parts.length > 1) {
        const parentPath = parts.slice(0, -1).join('/');
        taskPanelState.expandedFolders['__navPath'] = parentPath as any;
    }
    openTaskFile(wsId, filePath);
}

function closeTaskPreview(): void {
    taskPanelState.openFilePath = null;
    const wsId = taskPanelState.selectedWorkspaceId;
    if (wsId) {
        updateTaskHash(wsId, null);
    }
    // Re-render without preview column
    const container = document.getElementById('repo-tasks-tree');
    if (container && currentTasks) {
        renderMillerColumns(container);
    }
}

/** Update the URL hash to reflect the current task file state. */
function updateTaskHash(wsId: string, filePath: string | null): void {
    const { setHashSilent } = await_setHashSilent();
    if (filePath) {
        setHashSilent('#repos/' + encodeURIComponent(wsId) + '/tasks/' + encodeURIComponent(filePath));
    } else {
        setHashSilent('#repos/' + encodeURIComponent(wsId) + '/tasks');
    }
}

/** Lazy import of setHashSilent to avoid circular dependency. */
function await_setHashSilent(): { setHashSilent: (hash: string) => void } {
    return { setHashSilent: (window as any).__setHashSilent || (() => {}) };
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
(window as any).openTaskFileFromHash = openTaskFileFromHash;
