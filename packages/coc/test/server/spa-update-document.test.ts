/**
 * SPA Dashboard Tests — ai-actions module: Update Document modal flow,
 * DOM creation, model population, close behavior, submission, and window global.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { getClientBundle } from './spa-test-helpers';

const CLIENT_DIR = path.resolve(__dirname, '..', '..', 'src', 'server', 'spa', 'client');

function readClientFile(name: string): string {
    return fs.readFileSync(path.join(CLIENT_DIR, name), 'utf8');
}

// ============================================================================
// ai-actions.ts source — Update Document additions
// ============================================================================

describe('client/ai-actions.ts — Update Document modal', () => {
    let content: string;
    beforeAll(() => { content = readClientFile('ai-actions.ts'); });

    // -- Switch case wiring --

    it('wires update-document case in dropdown handler', () => {
        expect(content).toContain("case 'update-document'");
    });

    it('derives taskName from taskPath in update-document case', () => {
        // The case block derives name from taskPath
        const caseIdx = content.indexOf("case 'update-document'");
        const nextCase = content.indexOf('default:', caseIdx);
        const caseBlock = content.slice(caseIdx, nextCase);
        expect(caseBlock).toContain(".split('/').pop()?.replace(/\\.md$/, '')");
    });

    it('calls showUpdateDocumentModal from update-document case', () => {
        const caseIdx = content.indexOf("case 'update-document'");
        const nextCase = content.indexOf('default:', caseIdx);
        const caseBlock = content.slice(caseIdx, nextCase);
        expect(caseBlock).toContain('showUpdateDocumentModal(wsId, taskPath, name)');
    });

    // -- Imports --

    it('imports fetchQueue from queue', () => {
        expect(content).toContain("from './queue'");
        expect(content).toContain('fetchQueue');
    });

    it('imports startQueuePolling from queue', () => {
        expect(content).toContain('startQueuePolling');
    });

    // -- showUpdateDocumentModal function --

    it('exports showUpdateDocumentModal function', () => {
        expect(content).toContain('export function showUpdateDocumentModal');
    });

    it('showUpdateDocumentModal accepts wsId, taskPath, and taskName params', () => {
        expect(content).toContain('showUpdateDocumentModal(wsId: string, taskPath: string, taskName: string)');
    });

    // -- Idempotency --

    it('removes existing update-doc-overlay before creating new one', () => {
        expect(content).toContain("document.getElementById('update-doc-overlay')");
        expect(content).toContain('existing.remove()');
    });

    // -- DOM creation --

    it('creates overlay with update-doc-overlay id', () => {
        expect(content).toContain("overlay.id = 'update-doc-overlay'");
    });

    it('creates overlay with enqueue-overlay class', () => {
        const fnIdx = content.indexOf('function showUpdateDocumentModal');
        const fnContent = content.slice(fnIdx);
        expect(fnContent).toContain("overlay.className = 'enqueue-overlay'");
    });

    it('creates dialog with enqueue-dialog class and 500px width', () => {
        expect(content).toContain('enqueue-dialog" style="width:500px"');
    });

    it('uses enqueue-dialog-header for the header', () => {
        const fnIdx = content.indexOf('function showUpdateDocumentModal');
        const fnContent = content.slice(fnIdx);
        expect(fnContent).toContain('enqueue-dialog-header');
    });

    it('has header text "Update Document"', () => {
        expect(content).toContain('<h2>Update Document</h2>');
    });

    it('has close button with update-doc-close id', () => {
        expect(content).toContain('id="update-doc-close"');
    });

    it('creates form with update-doc-form id and enqueue-form class', () => {
        expect(content).toContain('id="update-doc-form"');
        expect(content).toContain('class="enqueue-form"');
    });

    it('has disabled input for document name', () => {
        expect(content).toContain('disabled />');
    });

    it('escapes taskName in document input value', () => {
        expect(content).toContain('escapeHtmlClient(taskName)');
    });

    it('has textarea with update-doc-instruction id', () => {
        expect(content).toContain('id="update-doc-instruction"');
    });

    it('textarea has required attribute', () => {
        const fnIdx = content.indexOf('function showUpdateDocumentModal');
        const fnContent = content.slice(fnIdx);
        expect(fnContent).toContain('required');
    });

    it('textarea has rows="4" and resize:vertical', () => {
        expect(content).toContain('rows="4"');
        expect(content).toContain('resize:vertical');
    });

    it('has placeholder text on instruction textarea', () => {
        expect(content).toContain('Describe what changes you want made to this document...');
    });

    it('has model select with update-doc-model id', () => {
        expect(content).toContain('id="update-doc-model"');
    });

    it('model select has Default option with empty value', () => {
        expect(content).toContain('<option value="">Default</option>');
    });

    it('has optional label hint for model', () => {
        expect(content).toContain('enqueue-optional');
        expect(content).toContain('(optional)');
    });

    it('has cancel button with update-doc-cancel id', () => {
        expect(content).toContain('id="update-doc-cancel"');
    });

    it('cancel button uses enqueue-btn-secondary class', () => {
        expect(content).toContain('class="enqueue-btn-secondary" id="update-doc-cancel"');
    });

    it('has submit button with update-doc-submit id', () => {
        expect(content).toContain('id="update-doc-submit"');
    });

    it('submit button uses enqueue-btn-primary class', () => {
        expect(content).toContain('class="enqueue-btn-primary" id="update-doc-submit"');
    });

    it('submit button text is "Update"', () => {
        expect(content).toContain('>Update</button>');
    });

    it('appends overlay to document.body', () => {
        const fnIdx = content.indexOf('function showUpdateDocumentModal');
        const fnContent = content.slice(fnIdx);
        expect(fnContent).toContain('document.body.appendChild(overlay)');
    });

    // -- Model population --

    it('reads options from #enqueue-model select', () => {
        const fnIdx = content.indexOf('function showUpdateDocumentModal');
        const fnContent = content.slice(fnIdx);
        expect(fnContent).toContain("document.getElementById('enqueue-model')");
    });

    it('clones non-empty-value options to target select', () => {
        expect(content).toContain('opt.cloneNode(true)');
    });

    it('skips empty-value options to avoid duplicate Default', () => {
        expect(content).toContain('if (opt.value)');
    });

    // -- Focus --

    it('focuses the instruction textarea on open', () => {
        const fnIdx = content.indexOf('function showUpdateDocumentModal');
        const fnContent = content.slice(fnIdx);
        expect(fnContent).toContain('instructionEl.focus()');
    });

    // -- Close handlers --

    it('close button removes overlay', () => {
        expect(content).toContain("document.getElementById('update-doc-close')?.addEventListener('click', close)");
    });

    it('cancel button removes overlay', () => {
        expect(content).toContain("document.getElementById('update-doc-cancel')?.addEventListener('click', close)");
    });

    it('backdrop click removes overlay', () => {
        const fnIdx = content.indexOf('function showUpdateDocumentModal');
        const fnContent = content.slice(fnIdx);
        expect(fnContent).toContain('e.target === overlay');
    });

    // -- Form submission --

    it('attaches submit handler to update-doc-form', () => {
        expect(content).toContain("document.getElementById('update-doc-form')?.addEventListener('submit'");
    });

    it('prevents default form submission', () => {
        const fnIdx = content.indexOf('function showUpdateDocumentModal');
        const fnContent = content.slice(fnIdx);
        expect(fnContent).toContain('e.preventDefault()');
    });

    it('trims instruction value', () => {
        expect(content).toContain("as HTMLTextAreaElement)?.value.trim()");
    });

    it('returns early if instruction is empty', () => {
        expect(content).toContain('if (!instruction) return');
    });

    it('disables submit button during async operation', () => {
        expect(content).toContain('submitBtn.disabled = true');
        expect(content).toContain("submitBtn.textContent = 'Updating...'");
    });

    it('fetches document content via tasks/content endpoint', () => {
        const fnIdx = content.indexOf('function showUpdateDocumentModal');
        const fnContent = content.slice(fnIdx);
        expect(fnContent).toContain('/tasks/content?path=');
    });

    it('URL-encodes wsId and taskPath in content fetch', () => {
        const fnIdx = content.indexOf('function showUpdateDocumentModal');
        const fnContent = content.slice(fnIdx);
        expect(fnContent).toContain('encodeURIComponent(wsId)');
        expect(fnContent).toContain('encodeURIComponent(taskPath)');
    });

    it('shows error toast when content fetch fails', () => {
        expect(content).toContain("showToast('Failed to load document content:");
    });

    it('re-enables button on content fetch error', () => {
        // After the content error check, button is restored
        const fnContent = content.slice(content.indexOf('function showUpdateDocumentModal'));
        const errorIdx = fnContent.indexOf('Failed to load document content');
        const restoreIdx = fnContent.indexOf("submitBtn.textContent = 'Update'", errorIdx);
        expect(restoreIdx).toBeGreaterThan(errorIdx);
    });

    it('builds prompt with document content and instruction', () => {
        expect(content).toContain("'Given this document:\\n\\n'");
        expect(content).toContain("'\\n\\nInstruction: ' + instruction");
        expect(content).toContain("'\\n\\nReturn the complete updated document.'");
    });

    it('POSTs to /queue endpoint', () => {
        const fnIdx = content.indexOf('function showUpdateDocumentModal');
        const fnContent = content.slice(fnIdx);
        expect(fnContent).toContain("getApiBase() + '/queue'");
        expect(fnContent).toContain("method: 'POST'");
    });

    it('enqueue body has type custom', () => {
        const fnIdx = content.indexOf('function showUpdateDocumentModal');
        const fnContent = content.slice(fnIdx);
        expect(fnContent).toContain("type: 'custom'");
    });

    it('enqueue body has displayName with Update prefix', () => {
        expect(content).toContain("displayName: 'Update: ' + taskName");
    });

    it('enqueue body includes prompt in payload.data', () => {
        expect(content).toContain('prompt,');
    });

    it('enqueue body includes originalTaskPath in payload.data', () => {
        expect(content).toContain('originalTaskPath: taskPath');
    });

    it('sets config.model only when model is non-empty', () => {
        expect(content).toContain('if (model)');
        expect(content).toContain('body.config.model = model');
    });

    it('shows error toast on POST failure', () => {
        expect(content).toContain("showToast('Failed to enqueue:");
    });

    it('re-enables button on POST failure', () => {
        const fnContent = content.slice(content.indexOf('function showUpdateDocumentModal'));
        const postErrorIdx = fnContent.indexOf("'Failed to enqueue:");
        const restoreIdx = fnContent.indexOf("submitBtn.textContent = 'Update'", postErrorIdx);
        expect(restoreIdx).toBeGreaterThan(postErrorIdx);
    });

    it('removes overlay on success', () => {
        const fnContent = content.slice(content.indexOf('function showUpdateDocumentModal'));
        expect(fnContent).toContain('overlay.remove()');
    });

    it('shows success toast on success', () => {
        expect(content).toContain("showToast('Task enqueued: Update ' + taskName, 'success')");
    });

    it('calls fetchQueue on success', () => {
        const fnContent = content.slice(content.indexOf('function showUpdateDocumentModal'));
        expect(fnContent).toContain('fetchQueue()');
    });

    it('calls startQueuePolling on success', () => {
        const fnContent = content.slice(content.indexOf('function showUpdateDocumentModal'));
        expect(fnContent).toContain('startQueuePolling()');
    });

    it('catches network errors with showToast', () => {
        expect(content).toContain("showToast('Network error:");
    });

    it('re-enables button on network error', () => {
        const fnContent = content.slice(content.indexOf('function showUpdateDocumentModal'));
        const netErrorIdx = fnContent.indexOf("'Network error:");
        const restoreIdx = fnContent.indexOf("submitBtn.textContent = 'Update'", netErrorIdx);
        expect(restoreIdx).toBeGreaterThan(netErrorIdx);
    });

    // -- Window global --

    it('exposes showUpdateDocumentModal on window', () => {
        expect(content).toContain('(window as any).showUpdateDocumentModal = showUpdateDocumentModal');
    });

    // -- No new CSS classes --

    it('does not introduce update-doc-specific CSS classes (reuses enqueue-*)', () => {
        // All className assignments use enqueue-* classes, not update-doc-* classes
        const fnIdx = content.indexOf('function showUpdateDocumentModal');
        const fnContent = content.slice(fnIdx, content.indexOf('// =====', fnIdx + 10));
        const classNameAssignments = fnContent.match(/\.className\s*=\s*'([^']+)'/g);
        if (classNameAssignments) {
            for (const match of classNameAssignments) {
                expect(match).toContain('enqueue');
            }
        }
    });
});

// ============================================================================
// Bundle — Update Document functions present in compiled output
// ============================================================================

describe('client bundle — Update Document functions', () => {
    let script: string;
    beforeAll(() => { script = getClientBundle(); });

    it('contains showUpdateDocumentModal function', () => {
        expect(script).toContain('showUpdateDocumentModal');
    });

    it('contains update-doc-overlay id', () => {
        expect(script).toContain('update-doc-overlay');
    });

    it('contains update-doc-form id', () => {
        expect(script).toContain('update-doc-form');
    });

    it('contains update-doc-instruction id', () => {
        expect(script).toContain('update-doc-instruction');
    });

    it('contains update-doc-model id', () => {
        expect(script).toContain('update-doc-model');
    });

    it('contains update-doc-submit id', () => {
        expect(script).toContain('update-doc-submit');
    });

    it('contains update-document action wiring (not a stub)', () => {
        expect(script).not.toContain('TODO: commit 007');
    });

    it('contains Update Document header text', () => {
        expect(script).toContain('Update Document');
    });

    it('contains originalTaskPath in payload', () => {
        expect(script).toContain('originalTaskPath');
    });

    it('contains window global assignment for showUpdateDocumentModal', () => {
        expect(script).toContain('showUpdateDocumentModal');
    });
});

// ============================================================================
// Payload shape validation (source-level checks)
// ============================================================================

describe('Update Document payload construction', () => {
    let content: string;
    beforeAll(() => { content = readClientFile('ai-actions.ts'); });

    it('payload type is custom', () => {
        const fnContent = content.slice(content.indexOf('function showUpdateDocumentModal'));
        expect(fnContent).toContain("type: 'custom'");
    });

    it('payload includes prompt string in data', () => {
        expect(content).toContain('prompt,');
        expect(content).toContain('originalTaskPath: taskPath');
    });

    it('payload wraps data in nested payload.data structure', () => {
        const fnContent = content.slice(content.indexOf('function showUpdateDocumentModal'));
        expect(fnContent).toContain('payload: {');
        expect(fnContent).toContain('data: {');
    });

    it('displayName follows Update: prefix convention', () => {
        expect(content).toContain("'Update: ' + taskName");
    });

    it('config.model is conditionally set', () => {
        const fnContent = content.slice(content.indexOf('function showUpdateDocumentModal'));
        expect(fnContent).toContain('if (model)');
        expect(fnContent).toContain('body.config.model = model');
    });

    it('POST body includes config object', () => {
        const fnContent = content.slice(content.indexOf('function showUpdateDocumentModal'));
        expect(fnContent).toContain('config: {},');
    });
});

// ============================================================================
// Files NOT modified — guards
// ============================================================================

describe('Update Document — no unintended file modifications', () => {
    it('styles.css does not contain update-doc-specific classes', () => {
        const css = fs.readFileSync(path.join(CLIENT_DIR, 'styles.css'), 'utf8');
        expect(css).not.toContain('.update-doc-');
    });

    it('index.ts does not import showUpdateDocumentModal directly', () => {
        const indexContent = readClientFile('index.ts');
        expect(indexContent).not.toContain('showUpdateDocumentModal');
    });
});
