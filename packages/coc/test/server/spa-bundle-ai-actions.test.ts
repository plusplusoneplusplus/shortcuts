/**
 * SPA Dashboard Tests — ai-actions module: Follow Prompt flow,
 * discovery cache, toast notifications, enqueue payload construction.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { getClientBundle, generateDashboardHtml } from './spa-test-helpers';

const CLIENT_DIR = path.resolve(__dirname, '..', '..', 'src', 'server', 'spa', 'client');

function readClientFile(name: string): string {
    return fs.readFileSync(path.join(CLIENT_DIR, name), 'utf8');
}

// ============================================================================
// ai-actions.ts source file — Follow Prompt additions
// ============================================================================

describe('client/ai-actions.ts — Follow Prompt flow', () => {
    let content: string;
    beforeAll(() => { content = readClientFile('ai-actions.ts'); });

    // -- Imports --

    it('imports getApiBase from config', () => {
        expect(content).toContain("from './config'");
        expect(content).toContain('getApiBase');
    });

    it('imports fetchApi from core', () => {
        expect(content).toContain("from './core'");
        expect(content).toContain('fetchApi');
    });

    it('imports appState from state', () => {
        expect(content).toContain("from './state'");
        expect(content).toContain('appState');
    });

    // -- Discovery cache types --

    it('defines PromptItem interface with name and relativePath', () => {
        expect(content).toContain('interface PromptItem');
        expect(content).toContain('relativePath: string');
    });

    it('defines SkillItem interface with name and optional description', () => {
        expect(content).toContain('interface SkillItem');
        expect(content).toContain('description?: string');
    });

    it('defines DiscoveryCache with prompts, skills, and fetchedAt', () => {
        expect(content).toContain('interface DiscoveryCache');
        expect(content).toContain('fetchedAt: number');
    });

    it('defines discoveryCache as a Record', () => {
        expect(content).toContain('const discoveryCache: Record<string, DiscoveryCache>');
    });

    it('defines CACHE_TTL_MS of 60 seconds', () => {
        expect(content).toContain('CACHE_TTL_MS');
        expect(content).toContain('60_000');
    });

    // -- fetchPromptsAndSkills --

    it('exports fetchPromptsAndSkills function', () => {
        expect(content).toContain('export async function fetchPromptsAndSkills');
    });

    it('fetchPromptsAndSkills checks cache before fetching', () => {
        const fnIdx = content.indexOf('fetchPromptsAndSkills');
        const cacheCheck = content.indexOf('discoveryCache[wsId]', fnIdx);
        const fetchCall = content.indexOf('fetchApi(', cacheCheck);
        expect(cacheCheck).toBeGreaterThan(fnIdx);
        expect(fetchCall).toBeGreaterThan(cacheCheck);
    });

    it('fetchPromptsAndSkills fetches prompts and skills in parallel', () => {
        expect(content).toContain('Promise.all');
        expect(content).toContain('/workspaces/');
        expect(content).toContain('/prompts');
        expect(content).toContain('/skills');
    });

    it('fetchPromptsAndSkills gracefully defaults to empty arrays on null', () => {
        expect(content).toContain("promptData?.prompts || []");
        expect(content).toContain("skillData?.skills || []");
    });

    it('fetchPromptsAndSkills stores result in discoveryCache', () => {
        expect(content).toContain('discoveryCache[wsId] = {');
    });

    // -- invalidateDiscoveryCache --

    it('exports invalidateDiscoveryCache function', () => {
        expect(content).toContain('export function invalidateDiscoveryCache');
    });

    it('invalidateDiscoveryCache can clear a specific wsId', () => {
        expect(content).toContain('delete discoveryCache[wsId]');
    });

    it('invalidateDiscoveryCache can clear all entries', () => {
        expect(content).toContain('Object.keys(discoveryCache)');
    });

    // -- showFollowPromptSubmenu --

    it('exports showFollowPromptSubmenu function', () => {
        expect(content).toContain('export function showFollowPromptSubmenu');
    });

    it('showFollowPromptSubmenu removes existing overlay first', () => {
        expect(content).toContain("document.getElementById('follow-prompt-submenu')?.remove()");
    });

    it('showFollowPromptSubmenu creates overlay with enqueue-overlay class', () => {
        expect(content).toContain("overlay.className = 'enqueue-overlay'");
    });

    it('showFollowPromptSubmenu sets follow-prompt-submenu id', () => {
        expect(content).toContain("overlay.id = 'follow-prompt-submenu'");
    });

    it('showFollowPromptSubmenu uses enqueue-dialog for the modal container', () => {
        expect(content).toContain('enqueue-dialog');
        expect(content).toContain('enqueue-dialog-header');
    });

    it('showFollowPromptSubmenu shows loading state', () => {
        expect(content).toContain('Loading');
    });

    it('showFollowPromptSubmenu has close button with fp-close id', () => {
        expect(content).toContain("id=\"fp-close\"");
    });

    it('showFollowPromptSubmenu closes on overlay background click', () => {
        expect(content).toContain('e.target === overlay');
    });

    it('showFollowPromptSubmenu checks if overlay still exists after fetch', () => {
        expect(content).toContain("document.getElementById('follow-prompt-submenu')");
    });

    it('showFollowPromptSubmenu shows empty state when no prompts or skills', () => {
        expect(content).toContain('No prompts or skills found');
    });

    it('showFollowPromptSubmenu renders prompt items with fp-item class', () => {
        expect(content).toContain('fp-item');
        expect(content).toContain('data-type="prompt"');
    });

    it('showFollowPromptSubmenu renders skill items with fp-item class', () => {
        expect(content).toContain('data-type="skill"');
    });

    it('showFollowPromptSubmenu renders section labels', () => {
        expect(content).toContain('fp-section-label');
        expect(content).toContain('Prompts</div>');
        expect(content).toContain('Skills</div>');
    });

    it('showFollowPromptSubmenu escapes all text through escapeHtmlClient', () => {
        // All prompt/skill name/desc rendering goes through escapeHtmlClient
        const matches = content.match(/escapeHtmlClient\(/g);
        expect(matches).toBeTruthy();
        expect(matches!.length).toBeGreaterThanOrEqual(5);
    });

    it('showFollowPromptSubmenu uses event delegation on fp-item clicks', () => {
        expect(content).toContain("closest('.fp-item')");
    });

    it('showFollowPromptSubmenu extracts type, name, path from dataset', () => {
        expect(content).toContain('fpItem.dataset.type');
        expect(content).toContain('fpItem.dataset.name');
        expect(content).toContain('fpItem.dataset.path');
    });

    // -- follow-prompt case in dropdown handler --

    it('wires follow-prompt case to showFollowPromptSubmenu', () => {
        expect(content).toContain("case 'follow-prompt'");
        expect(content).toContain('showFollowPromptSubmenu(wsId, taskPath, taskName)');
    });

    it('derives taskName from taskPath by stripping .md extension', () => {
        expect(content).toContain(".split('/').pop()?.replace(/\\.md$/, '')");
    });

    // -- enqueueFollowPrompt --

    it('defines enqueueFollowPrompt function', () => {
        expect(content).toContain('async function enqueueFollowPrompt');
    });

    it('enqueueFollowPrompt does not fetch task content via tasks/content endpoint', () => {
        // New behavior: no /tasks/content API call
        const fnContent = content.slice(content.indexOf('enqueueFollowPrompt'));
        const fnEnd = fnContent.indexOf('\nasync function') > 0 ? fnContent.indexOf('\nasync function') : fnContent.indexOf('\nexport function');
        const fnBody = fnEnd > 0 ? fnContent.slice(0, fnEnd) : fnContent;
        expect(fnBody).not.toContain('/tasks/content?path=');
    });

    it('enqueueFollowPrompt constructs planFilePath from workspace root + taskPath', () => {
        expect(content).toContain("workingDirectory + '/' + taskPath");
    });

    it('enqueueFollowPrompt builds promptFilePath for prompt items using workspace root + relativePath', () => {
        // promptFilePath is constructed from workingDirectory + '/' + itemPath (relativePath from findPromptFiles)
        expect(content).toContain("workingDirectory + '/' + (itemPath || '')");
        expect(content).toContain('promptFilePath');
    });

    it('enqueueFollowPrompt builds promptContent for skill items', () => {
        expect(content).toContain('skillName: itemName');
        expect(content).toContain('promptContent:');
    });

    it('enqueueFollowPrompt sends planFilePath instead of additionalContext', () => {
        expect(content).toContain('planFilePath');
        // Should not have additionalContext in the enqueue payload
        const fnStart = content.indexOf('async function enqueueFollowPrompt');
        const fnBody = content.slice(fnStart, content.indexOf('\n// ==', fnStart));
        expect(fnBody).not.toContain('additionalContext');
    });

    it('enqueueFollowPrompt sets workingDirectory', () => {
        expect(content).toContain('workingDirectory');
    });

    it('enqueueFollowPrompt POSTs to /queue', () => {
        expect(content).toContain("getApiBase() + '/queue'");
        expect(content).toContain("method: 'POST'");
    });

    it('enqueueFollowPrompt sets type to follow-prompt', () => {
        expect(content).toContain("type: 'follow-prompt'");
    });

    it('enqueueFollowPrompt builds displayName with item name and task name', () => {
        expect(content).toContain('Follow: ${itemName} on ${taskName}');
    });

    it('enqueueFollowPrompt shows success toast and refreshes queue on success', () => {
        expect(content).toContain("showToast('Enqueued: ' + itemName, 'success')");
        expect(content).toContain('(window as any).fetchQueue');
    });

    it('enqueueFollowPrompt shows error toast on non-2xx response', () => {
        expect(content).toContain("showToast('Failed to enqueue:");
    });

    it('enqueueFollowPrompt shows network error toast on fetch failure', () => {
        expect(content).toContain("showToast('Network error enqueuing task', 'error')");
    });

    // -- showToast --

    it('exports showToast function', () => {
        expect(content).toContain('export function showToast');
    });

    it('showToast creates element with toast class', () => {
        expect(content).toContain("toast.className = 'toast toast-' + type");
    });

    it('showToast appends to body', () => {
        expect(content).toContain('document.body.appendChild(toast)');
    });

    it('showToast adds toast-fade class after timeout', () => {
        expect(content).toContain("toast.classList.add('toast-fade')");
    });

    it('showToast removes element after fade', () => {
        expect(content).toContain('toast.remove()');
    });

    // -- Window globals --

    it('exposes showFollowPromptSubmenu on window', () => {
        expect(content).toContain('(window as any).showFollowPromptSubmenu = showFollowPromptSubmenu');
    });

    it('exposes invalidateDiscoveryCache on window', () => {
        expect(content).toContain('(window as any).invalidateDiscoveryCache = invalidateDiscoveryCache');
    });

    it('exposes showToast on window', () => {
        expect(content).toContain('(window as any).showToast = showToast');
    });
});

// ============================================================================
// Bundle — Follow Prompt functions present in compiled output
// ============================================================================

describe('client bundle — Follow Prompt functions', () => {
    let script: string;
    beforeAll(() => { script = getClientBundle(); });

    it('contains fetchPromptsAndSkills function', () => {
        expect(script).toContain('fetchPromptsAndSkills');
    });

    it('contains showFollowPromptSubmenu function', () => {
        expect(script).toContain('showFollowPromptSubmenu');
    });

    it('contains enqueueFollowPrompt function', () => {
        expect(script).toContain('enqueueFollowPrompt');
    });

    it('contains invalidateDiscoveryCache function', () => {
        expect(script).toContain('invalidateDiscoveryCache');
    });

    it('contains showToast function', () => {
        expect(script).toContain('showToast');
    });

    it('contains discovery cache TTL constant', () => {
        expect(script).toContain('CACHE_TTL_MS');
    });

    it('contains follow-prompt-submenu overlay id', () => {
        expect(script).toContain('follow-prompt-submenu');
    });

    it('contains fp-item CSS class in item rendering', () => {
        expect(script).toContain('fp-item');
    });

    it('contains fp-section-label for section headers', () => {
        expect(script).toContain('fp-section-label');
    });

    it('contains toast-fade class for animation', () => {
        expect(script).toContain('toast-fade');
    });

    it('contains window global assignment for showFollowPromptSubmenu', () => {
        expect(script).toContain('showFollowPromptSubmenu');
    });

    it('contains follow-prompt action wiring (not a stub)', () => {
        // Should not contain the old stub log message
        expect(script).not.toContain('stub action');
    });

    it('contains fp-model select id for Follow Prompt model dropdown', () => {
        expect(script).toContain('fp-model');
    });

    it('contains enqueue-model reference for populating model options', () => {
        expect(script).toContain('enqueue-model');
    });
});

// ============================================================================
// CSS — Follow Prompt submenu styles
// ============================================================================

describe('CSS — Follow Prompt submenu styles', () => {
    const html = generateDashboardHtml();

    it('defines .follow-prompt-body styles', () => {
        expect(html).toContain('.follow-prompt-body');
    });

    it('defines .fp-section styles', () => {
        expect(html).toContain('.fp-section');
    });

    it('defines .fp-section-label styles', () => {
        expect(html).toContain('.fp-section-label');
    });

    it('defines .fp-item styles with flex layout', () => {
        expect(html).toContain('.fp-item');
    });

    it('defines .fp-item hover state', () => {
        expect(html).toContain('.fp-item:hover');
    });

    it('defines .fp-item-icon styles', () => {
        expect(html).toContain('.fp-item-icon');
    });

    it('defines .fp-item-name styles', () => {
        expect(html).toContain('.fp-item-name');
    });

    it('defines .fp-item-desc styles', () => {
        expect(html).toContain('.fp-item-desc');
    });
});

// ============================================================================
// CSS — Toast notification styles
// ============================================================================

describe('CSS — Toast notification styles', () => {
    const html = generateDashboardHtml();

    it('defines .toast base styles', () => {
        expect(html).toContain('.toast');
    });

    it('defines .toast-success with status-completed color', () => {
        expect(html).toContain('.toast-success');
        expect(html).toContain('--status-completed');
    });

    it('defines .toast-error with status-failed color', () => {
        expect(html).toContain('.toast-error');
        expect(html).toContain('--status-failed');
    });

    it('defines .toast-fade for exit animation', () => {
        expect(html).toContain('.toast-fade');
    });

    it('defines toast-in keyframes animation', () => {
        expect(html).toContain('@keyframes toast-in');
    });
});

// ============================================================================
// Payload shape validation (source-level checks)
// ============================================================================

describe('Follow Prompt payload construction', () => {
    let content: string;
    beforeAll(() => { content = readClientFile('ai-actions.ts'); });

    it('prompt payload includes promptFilePath field', () => {
        expect(content).toContain('promptFilePath');
    });

    it('prompt payload constructs absolute path from rootPath + relativePath', () => {
        // itemPath is relativePath from findPromptFiles(), already relative to workspace root
        expect(content).toContain("workingDirectory + '/' + (itemPath || '')");
    });

    it('prompt payload does NOT hardcode .vscode/pipelines/ in path construction', () => {
        // Regression test: relativePath from findPromptFiles() is already relative to rootDir
        // so we must NOT prepend .vscode/pipelines/ (which would create a wrong path like
        // /workspace/.vscode/pipelines/.github/prompts/impl.prompt.md)
        const fnStart = content.indexOf('async function enqueueFollowPrompt');
        const fnBody = content.slice(fnStart, content.indexOf('\n// ==', fnStart));
        expect(fnBody).not.toContain("'/.vscode/pipelines/'");
    });

    it('skill payload includes skillName field', () => {
        expect(content).toContain('skillName: itemName');
    });

    it('skill payload includes promptContent for type guard satisfaction', () => {
        // promptContent is present so isFollowPromptPayload('promptContent' in payload) passes
        expect(content).toContain('promptContent: `Use the ${itemName} skill.`');
    });

    it('both payloads include planFilePath', () => {
        const fnStart = content.indexOf('async function enqueueFollowPrompt');
        const fnBody = content.slice(fnStart, content.indexOf('\n// ==', fnStart));
        const matches = fnBody.match(/planFilePath/g);
        expect(matches).toBeTruthy();
        expect(matches!.length).toBeGreaterThanOrEqual(3);
    });

    it('both payloads include workingDirectory', () => {
        // workingDirectory appears in both prompt and skill payload branches
        const fnContent = content.slice(content.indexOf('enqueueFollowPrompt'));
        const wdMatches = fnContent.match(/workingDirectory/g);
        expect(wdMatches).toBeTruthy();
        expect(wdMatches!.length).toBeGreaterThanOrEqual(4);
    });

    it('enqueue body has required fields: type, priority, displayName, payload, config', () => {
        expect(content).toContain("type: 'follow-prompt'");
        expect(content).toContain("priority: 'normal'");
        expect(content).toContain('displayName:');
        expect(content).toContain('payload,');
        expect(content).toContain('config: {},');
    });
});

// ============================================================================
// Follow Prompt model selection
// ============================================================================

describe('Follow Prompt model selection', () => {
    let content: string;
    beforeAll(() => { content = readClientFile('ai-actions.ts'); });

    // -- Model dropdown UI --

    it('showFollowPromptSubmenu includes model select with fp-model id', () => {
        expect(content).toContain("id=\"fp-model\"");
    });

    it('showFollowPromptSubmenu includes model label with optional hint', () => {
        expect(content).toContain('Model <span class="enqueue-optional">(optional)</span>');
    });

    it('showFollowPromptSubmenu includes Default option with empty value', () => {
        expect(content).toContain('<option value="">Default</option>');
    });

    it('showFollowPromptSubmenu populates model options from #enqueue-model', () => {
        expect(content).toContain("document.getElementById('enqueue-model')");
        expect(content).toContain("document.getElementById('fp-model')");
        expect(content).toContain('fpSourceSelect');
        expect(content).toContain('fpTargetSelect');
    });

    it('showFollowPromptSubmenu clones options from source select', () => {
        expect(content).toContain('opt.cloneNode(true)');
    });

    // -- Model passed to enqueue --

    it('click handler reads model value from fp-model select', () => {
        expect(content).toContain("(document.getElementById('fp-model') as HTMLSelectElement)?.value");
    });

    it('enqueueFollowPrompt accepts model parameter', () => {
        const sig = content.match(/function enqueueFollowPrompt\([^)]+\)/s);
        expect(sig).toBeTruthy();
        expect(sig![0]).toContain('model?: string');
    });

    it('enqueueFollowPrompt sets config.model when model is provided', () => {
        expect(content).toContain('body.config.model = model');
    });

    it('enqueueFollowPrompt only sets config.model when model is truthy', () => {
        expect(content).toContain('if (model)');
        expect(content).toContain('body.config.model = model');
    });

    it('config.model pattern matches Update Document implementation', () => {
        // Both Follow Prompt and Update Document use the same pattern
        const matches = content.match(/body\.config\.model\s*=\s*model/g);
        expect(matches).toBeTruthy();
        expect(matches!.length).toBe(2); // once in enqueueFollowPrompt, once in Update Document
    });
});
