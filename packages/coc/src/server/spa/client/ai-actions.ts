/**
 * AI action dropdown for task file rows in the Miller columns UI.
 * Stub shell — menu items wired to real handlers in 006/007.
 */

import { escapeHtmlClient } from './utils';
import { getApiBase } from './config';
import { fetchApi } from './core';
import { fetchQueue, startQueuePolling } from './queue';
import { appState, taskPanelState } from './state';
import { applyModelToSelect, watchModelSelect, saveModelPreference } from './preferences';

let activeDropdown: HTMLElement | null = null;
let outsideClickHandler: ((e: MouseEvent) => void) | null = null;

/**
 * Show the AI action dropdown positioned near the trigger button.
 * Only one dropdown can be open at a time.
 */
export function showAIActionDropdown(button: HTMLElement, wsId: string, taskPath: string): void {
    // Close any already-open dropdown first
    hideAIActionDropdown();

    const dropdown = document.createElement('div');
    dropdown.className = 'ai-action-dropdown';
    dropdown.setAttribute('data-ws-id', wsId);
    dropdown.setAttribute('data-task-path', taskPath);

    dropdown.innerHTML =
        '<button class="ai-action-menu-item" data-ai-action="follow-prompt">' +
            '<span class="ai-action-menu-icon">📝</span>' +
            '<span class="ai-action-menu-label">Follow Prompt</span>' +
        '</button>' +
        '<button class="ai-action-menu-item" data-ai-action="update-document">' +
            '<span class="ai-action-menu-icon">✏️</span>' +
            '<span class="ai-action-menu-label">Update Document</span>' +
        '</button>';

    // Position relative to the trigger button
    document.body.appendChild(dropdown);
    const rect = button.getBoundingClientRect();
    const dropdownRect = dropdown.getBoundingClientRect();

    // Default: below and left-aligned to button
    let top = rect.bottom + 4;
    let left = rect.left;

    // If dropdown would overflow right edge, align to right edge of button
    if (left + dropdownRect.width > window.innerWidth - 8) {
        left = rect.right - dropdownRect.width;
    }
    // If dropdown would overflow bottom, show above the button
    if (top + dropdownRect.height > window.innerHeight - 8) {
        top = rect.top - dropdownRect.height - 4;
    }

    dropdown.style.top = top + 'px';
    dropdown.style.left = left + 'px';

    activeDropdown = dropdown;

    // Menu item clicks
    dropdown.addEventListener('click', (e: Event) => {
        const item = (e.target as HTMLElement).closest('[data-ai-action]') as HTMLElement | null;
        if (!item) return;
        const action = item.getAttribute('data-ai-action');
        hideAIActionDropdown();

        switch (action) {
            case 'follow-prompt': {
                const taskName = taskPath.split('/').pop()?.replace(/\.md$/, '') || taskPath;
                showFollowPromptSubmenu(wsId, taskPath, taskName);
                break;
            }
            case 'update-document': {
                const name = taskPath.split('/').pop()?.replace(/\.md$/, '') || taskPath;
                showUpdateDocumentModal(wsId, taskPath, name);
                break;
            }
            default:
                console.log('[ai-actions] unhandled action:', action, 'path:', taskPath, 'ws:', wsId);
                break;
        }
    });

    // Close on outside click (deferred to next tick so the opening click doesn't close it)
    requestAnimationFrame(() => {
        outsideClickHandler = (e: MouseEvent) => {
            if (activeDropdown && !activeDropdown.contains(e.target as Node)) {
                hideAIActionDropdown();
            }
        };
        document.addEventListener('click', outsideClickHandler, true);
    });
}

/** Remove the active dropdown and clean up listeners. */
export function hideAIActionDropdown(): void {
    if (activeDropdown) {
        activeDropdown.remove();
        activeDropdown = null;
    }
    if (outsideClickHandler) {
        document.removeEventListener('click', outsideClickHandler, true);
        outsideClickHandler = null;
    }
}

// ================================================================
// Discovery cache
// ================================================================

interface PromptItem {
    name: string;
    relativePath: string;
}

interface SkillItem {
    name: string;
    description?: string;
}

interface DiscoveryCache {
    prompts: PromptItem[];
    skills: SkillItem[];
    fetchedAt: number;
}

const discoveryCache: Record<string, DiscoveryCache> = {};
const CACHE_TTL_MS = 60_000; // 60 seconds

/**
 * Default tasks folder path relative to workspace root.
 * Matches DEFAULT_SETTINGS.folderPath in tasks-handler.ts.
 */
const DEFAULT_TASKS_FOLDER = '.vscode/tasks';

/** Cache for workspace tasks folder paths (wsId → folderPath). */
const tasksFolderCache: Record<string, { folder: string; fetchedAt: number }> = {};

/**
 * Resolve the tasks folder path for a workspace.
 * Fetches from /api/workspaces/:id/tasks/settings and caches the result.
 */
export async function getTasksFolderPath(wsId: string): Promise<string> {
    const cached = tasksFolderCache[wsId];
    if (cached && (Date.now() - cached.fetchedAt) < CACHE_TTL_MS) {
        return cached.folder;
    }
    try {
        const data = await fetchApi(`/workspaces/${encodeURIComponent(wsId)}/tasks/settings`);
        const folder = (data && typeof data.folderPath === 'string') ? data.folderPath : DEFAULT_TASKS_FOLDER;
        tasksFolderCache[wsId] = { folder, fetchedAt: Date.now() };
        return folder;
    } catch {
        return DEFAULT_TASKS_FOLDER;
    }
}

export async function fetchPromptsAndSkills(wsId: string): Promise<{ prompts: PromptItem[]; skills: SkillItem[] }> {
    const cached = discoveryCache[wsId];
    if (cached && (Date.now() - cached.fetchedAt) < CACHE_TTL_MS) {
        return { prompts: cached.prompts, skills: cached.skills };
    }

    const [promptData, skillData] = await Promise.all([
        fetchApi(`/workspaces/${encodeURIComponent(wsId)}/prompts`),
        fetchApi(`/workspaces/${encodeURIComponent(wsId)}/skills`),
    ]);

    const prompts: PromptItem[] = promptData?.prompts || [];
    const skills: SkillItem[] = skillData?.skills || [];

    discoveryCache[wsId] = { prompts, skills, fetchedAt: Date.now() };
    return { prompts, skills };
}

export function invalidateDiscoveryCache(wsId?: string): void {
    if (wsId) {
        delete discoveryCache[wsId];
    } else {
        for (const key of Object.keys(discoveryCache)) {
            delete discoveryCache[key];
        }
    }
}

// ================================================================
// Follow Prompt submenu
// ================================================================

export function showFollowPromptSubmenu(wsId: string, taskPath: string, taskName: string): void {
    document.getElementById('follow-prompt-submenu')?.remove();

    const overlay = document.createElement('div');
    overlay.id = 'follow-prompt-submenu';
    overlay.className = 'enqueue-overlay';
    overlay.innerHTML =
        '<div class="enqueue-dialog">' +
            '<div class="enqueue-dialog-header">' +
                '<h2>Follow Prompt</h2>' +
                '<button class="enqueue-close-btn" id="fp-close">&times;</button>' +
            '</div>' +
            '<div class="enqueue-field" style="padding:0 16px">' +
                '<label for="fp-model">Model <span class="enqueue-optional">(optional)</span></label>' +
                '<select id="fp-model">' +
                    '<option value="">Default</option>' +
                '</select>' +
            '</div>' +
            '<div class="follow-prompt-body" style="padding:16px;color:var(--text-secondary)">Loading\u2026</div>' +
        '</div>';
    document.body.appendChild(overlay);

    // Populate model options from the server-rendered #enqueue-model select
    const fpSourceSelect = document.getElementById('enqueue-model') as HTMLSelectElement | null;
    const fpTargetSelect = document.getElementById('fp-model') as HTMLSelectElement | null;
    if (fpSourceSelect && fpTargetSelect) {
        for (const opt of Array.from(fpSourceSelect.options)) {
            if (opt.value) {
                fpTargetSelect.appendChild(opt.cloneNode(true) as HTMLOptionElement);
            }
        }
    }

    // Apply persisted model preference and watch for changes
    applyModelToSelect('fp-model');
    watchModelSelect('fp-model');

    // Close handlers
    const closeBtn = document.getElementById('fp-close');
    if (closeBtn) closeBtn.addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e: Event) => {
        if (e.target === overlay) overlay.remove();
    });

    // Fetch and render
    fetchPromptsAndSkills(wsId).then(({ prompts, skills }) => {
        // User may have closed the overlay while we were fetching
        if (!document.getElementById('follow-prompt-submenu')) return;

        const body = overlay.querySelector('.follow-prompt-body');
        if (!body) return;

        if (prompts.length === 0 && skills.length === 0) {
            body.innerHTML =
                '<p style="color:var(--text-secondary)">No prompts or skills found in this workspace.</p>' +
                '<p style="font-size:0.85em;color:var(--text-secondary);margin-top:8px">' +
                    'Create .prompt.md files in .vscode/pipelines/ or skills in .github/skills/' +
                '</p>';
            return;
        }

        let html = '';
        if (prompts.length > 0) {
            html += '<div class="fp-section"><div class="fp-section-label">Prompts</div>';
            for (const p of prompts) {
                html +=
                    '<div class="fp-item" data-type="prompt" data-name="' + escapeHtmlClient(p.name) +
                    '" data-path="' + escapeHtmlClient(p.relativePath) + '">' +
                        '<span class="fp-item-icon">\uD83D\uDCDD</span>' +
                        '<span class="fp-item-name">' + escapeHtmlClient(p.name) + '</span>' +
                    '</div>';
            }
            html += '</div>';
        }
        if (skills.length > 0) {
            html += '<div class="fp-section"><div class="fp-section-label">Skills</div>';
            for (const s of skills) {
                html +=
                    '<div class="fp-item" data-type="skill" data-name="' + escapeHtmlClient(s.name) + '">' +
                        '<span class="fp-item-icon">\u26A1</span>' +
                        '<span class="fp-item-name">' + escapeHtmlClient(s.name) + '</span>' +
                        (s.description ? '<span class="fp-item-desc">' + escapeHtmlClient(s.description) + '</span>' : '') +
                    '</div>';
            }
            html += '</div>';
        }
        body.innerHTML = html;

        // Item click delegation
        body.addEventListener('click', (e: Event) => {
            const fpItem = (e.target as HTMLElement).closest('.fp-item') as HTMLElement | null;
            if (!fpItem) return;
            const type = fpItem.dataset.type || '';
            const name = fpItem.dataset.name || '';
            const path = fpItem.dataset.path;
            const model = (document.getElementById('fp-model') as HTMLSelectElement)?.value || '';
            overlay.remove();
            enqueueFollowPrompt(wsId, taskPath, taskName, type, name, path, model);
        });
    });
}

async function enqueueFollowPrompt(
    wsId: string,
    taskPath: string,
    taskName: string,
    itemType: string,
    itemName: string,
    itemPath?: string,
    model?: string,
): Promise<void> {
    // Resolve workspace rootPath for workingDirectory
    const ws = appState.workspaces.find((w: any) => w.id === wsId);
    const workingDirectory = ws?.rootPath || '';

    // taskPath is relative to the tasks folder (e.g. "coc/e2e-repo-tests/013-doc.md"),
    // so we must include the tasks folder prefix when constructing the absolute path.
    const tasksFolder = await getTasksFolderPath(wsId);
    const planFilePath = workingDirectory
        ? workingDirectory + '/' + tasksFolder + '/' + taskPath
        : taskPath;

    // Build payload based on item type
    let payload: Record<string, string>;
    if (itemType === 'prompt') {
        // itemPath is relativePath from findPromptFiles(), already relative to workspace root
        const promptFilePath = workingDirectory
            ? workingDirectory + '/' + (itemPath || '')
            : itemPath || '';
        payload = { promptFilePath, planFilePath, workingDirectory };
    } else {
        // Skill — use promptContent for type guard satisfaction
        payload = {
            skillName: itemName,
            promptContent: `Use the ${itemName} skill.`,
            planFilePath,
            workingDirectory,
        };
    }

    const body: any = {
        type: 'follow-prompt' as const,
        priority: 'normal',
        displayName: `Follow: ${itemName} on ${taskName}`,
        payload,
        config: {},
    };
    if (model) {
        body.config.model = model;
    }

    try {
        const res = await fetch(getApiBase() + '/queue', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({ error: 'Failed' }));
            showToast('Failed to enqueue: ' + (err.error || 'Unknown error'), 'error');
            return;
        }
        showToast('Enqueued: ' + itemName, 'success');
        if ((window as any).fetchQueue) {
            (window as any).fetchQueue();
        }
    } catch {
        showToast('Network error enqueuing task', 'error');
    }
}

// ================================================================
// Toast notifications
// ================================================================

export function showToast(message: string, type: 'success' | 'error'): void {
    const toast = document.createElement('div');
    toast.className = 'toast toast-' + type;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => {
        toast.classList.add('toast-fade');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// ================================================================
// Update Document Modal
// ================================================================

export function showUpdateDocumentModal(wsId: string, taskPath: string, taskName: string): void {
    // Remove any existing instance
    const existing = document.getElementById('update-doc-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'update-doc-overlay';
    overlay.className = 'enqueue-overlay';

    overlay.innerHTML =
        '<div class="enqueue-dialog" style="width:500px">' +
            '<div class="enqueue-dialog-header">' +
                '<h2>Update Document</h2>' +
                '<button class="enqueue-close-btn" id="update-doc-close">&times;</button>' +
            '</div>' +
            '<form id="update-doc-form" class="enqueue-form">' +
                '<div class="enqueue-field">' +
                    '<label>Document</label>' +
                    '<input type="text" value="' + escapeHtmlClient(taskName) + '" disabled />' +
                '</div>' +
                '<div class="enqueue-field">' +
                    '<label for="update-doc-instruction">Instruction</label>' +
                    '<textarea id="update-doc-instruction" rows="4" ' +
                        'placeholder="Describe what changes you want made to this document..." ' +
                        'required style="width:100%;resize:vertical"></textarea>' +
                '</div>' +
                '<div class="enqueue-field">' +
                    '<label for="update-doc-model">Model <span class="enqueue-optional">(optional)</span></label>' +
                    '<select id="update-doc-model">' +
                        '<option value="">Default</option>' +
                    '</select>' +
                '</div>' +
                '<div class="enqueue-actions">' +
                    '<button type="button" class="enqueue-btn-secondary" id="update-doc-cancel">Cancel</button>' +
                    '<button type="submit" class="enqueue-btn-primary" id="update-doc-submit">Update</button>' +
                '</div>' +
            '</form>' +
        '</div>';

    document.body.appendChild(overlay);

    // Populate model options from the server-rendered #enqueue-model select
    const sourceSelect = document.getElementById('enqueue-model') as HTMLSelectElement | null;
    const targetSelect = document.getElementById('update-doc-model') as HTMLSelectElement | null;
    if (sourceSelect && targetSelect) {
        for (const opt of Array.from(sourceSelect.options)) {
            if (opt.value) {
                targetSelect.appendChild(opt.cloneNode(true) as HTMLOptionElement);
            }
        }
    }

    // Apply persisted model preference and watch for changes
    applyModelToSelect('update-doc-model');
    watchModelSelect('update-doc-model');

    // Focus the instruction textarea
    const instructionEl = document.getElementById('update-doc-instruction') as HTMLTextAreaElement;
    if (instructionEl) instructionEl.focus();

    // Close handlers
    const close = () => overlay.remove();
    document.getElementById('update-doc-close')?.addEventListener('click', close);
    document.getElementById('update-doc-cancel')?.addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    // Form submission
    document.getElementById('update-doc-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();

        const instruction = (document.getElementById('update-doc-instruction') as HTMLTextAreaElement)?.value.trim();
        if (!instruction) return;

        const model = (document.getElementById('update-doc-model') as HTMLSelectElement)?.value || '';
        const submitBtn = document.getElementById('update-doc-submit') as HTMLButtonElement;
        if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Updating...'; }

        try {
            // 1. Fetch document content
            const data = await fetchApi(
                `/workspaces/${encodeURIComponent(wsId)}/tasks/content?path=${encodeURIComponent(taskPath)}`
            );
            if (!data || data.error) {
                showToast('Failed to load document content: ' + (data?.error || 'Unknown error'), 'error');
                if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Update'; }
                return;
            }

            const content: string = data.content || '';

            // 2. Build prompt
            const prompt =
                'Given this document:\n\n' +
                content +
                '\n\nInstruction: ' + instruction +
                '\n\nReturn the complete updated document.';

            // 3. Enqueue via POST /queue
            const body: any = {
                type: 'custom',
                displayName: 'Update: ' + taskName,
                payload: {
                    data: {
                        prompt,
                        originalTaskPath: taskPath,
                    },
                },
                config: {},
            };
            if (model) {
                body.config.model = model;
            }

            const res = await fetch(getApiBase() + '/queue', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });

            if (!res.ok) {
                const err = await res.json().catch(() => ({ error: 'Failed' }));
                showToast('Failed to enqueue: ' + (err.error || 'Unknown error'), 'error');
                if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Update'; }
                return;
            }

            // 4. Close modal and refresh queue
            overlay.remove();
            showToast('Task enqueued: Update ' + taskName, 'success');
            fetchQueue();
            startQueuePolling();
        } catch (err) {
            showToast('Network error: ' + (err instanceof Error ? err.message : String(err)), 'error');
            if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Update'; }
        }
    });
}

// ================================================================
// Window globals
// ================================================================

(window as any).showFollowPromptSubmenu = showFollowPromptSubmenu;
(window as any).invalidateDiscoveryCache = invalidateDiscoveryCache;
(window as any).showToast = showToast;
(window as any).showUpdateDocumentModal = showUpdateDocumentModal;
