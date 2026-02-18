/**
 * SPA Dashboard Tests — preferences module: model persistence,
 * API calls, DOM integration, and wiring with ai-actions.
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
// client/preferences.ts — source file analysis
// ============================================================================

describe('client/preferences.ts — module structure', () => {
    let content: string;
    beforeAll(() => { content = readClientFile('preferences.ts'); });

    // -- Imports --

    it('imports getApiBase from config', () => {
        expect(content).toContain("from './config'");
        expect(content).toContain('getApiBase');
    });

    // -- State --

    it('tracks savedModel as a module-level variable', () => {
        expect(content).toContain("let savedModel = ''");
    });

    it('tracks loaded state', () => {
        expect(content).toContain('let loaded = false');
    });

    // -- loadPreferences --

    it('exports loadPreferences function', () => {
        expect(content).toContain('export async function loadPreferences');
    });

    it('loadPreferences fetches from /api/preferences', () => {
        expect(content).toContain("getApiBase() + '/preferences'");
    });

    it('loadPreferences reads lastModel from response', () => {
        expect(content).toContain('prefs.lastModel');
    });

    it('loadPreferences calls applyModelToAllSelects after loading', () => {
        expect(content).toContain('applyModelToAllSelects()');
    });

    it('loadPreferences sets loaded = true', () => {
        expect(content).toContain('loaded = true');
    });

    it('loadPreferences silently ignores fetch errors', () => {
        expect(content).toContain('catch');
    });

    // -- saveModelPreference --

    it('exports saveModelPreference function', () => {
        expect(content).toContain('export async function saveModelPreference');
    });

    it('saveModelPreference PATCHes to /api/preferences', () => {
        expect(content).toContain("method: 'PATCH'");
        expect(content).toContain("getApiBase() + '/preferences'");
    });

    it('saveModelPreference sends lastModel in body', () => {
        expect(content).toContain('lastModel: model');
    });

    it('saveModelPreference updates local savedModel', () => {
        expect(content).toContain('savedModel = model');
    });

    it('saveModelPreference is fire-and-forget (catch with empty body)', () => {
        const fnStart = content.indexOf('export async function saveModelPreference');
        const fnBody = content.slice(fnStart, content.indexOf('\n// ==', fnStart));
        expect(fnBody).toContain('catch');
    });

    // -- MODEL_SELECT_IDS --

    it('defines MODEL_SELECT_IDS array with all known select IDs', () => {
        expect(content).toContain('MODEL_SELECT_IDS');
        expect(content).toContain("'enqueue-model'");
        expect(content).toContain("'fp-model'");
        expect(content).toContain("'update-doc-model'");
    });

    // -- applyModelToAllSelects --

    it('exports applyModelToAllSelects function', () => {
        expect(content).toContain('export function applyModelToAllSelects');
    });

    it('applyModelToAllSelects iterates over MODEL_SELECT_IDS', () => {
        expect(content).toContain('for (const id of MODEL_SELECT_IDS)');
    });

    // -- applyModelToSelect --

    it('exports applyModelToSelect function', () => {
        expect(content).toContain('export function applyModelToSelect');
    });

    it('applyModelToSelect checks loaded before applying', () => {
        const fnStart = content.indexOf('export function applyModelToSelect');
        const fnBody = content.slice(fnStart, content.indexOf('\n\n', fnStart));
        expect(fnBody).toContain('if (!loaded) return');
    });

    it('applyModelToSelect checks that option exists before setting value', () => {
        expect(content).toContain('optionExists');
    });

    // -- getSavedModel --

    it('exports getSavedModel function', () => {
        expect(content).toContain('export function getSavedModel');
    });

    it('getSavedModel returns savedModel', () => {
        expect(content).toContain('return savedModel');
    });

    // -- watchModelSelect --

    it('exports watchModelSelect function', () => {
        expect(content).toContain('export function watchModelSelect');
    });

    it('watchModelSelect adds change event listener', () => {
        expect(content).toContain("addEventListener('change'");
    });

    it('watchModelSelect calls saveModelPreference on change', () => {
        expect(content).toContain('saveModelPreference(sel.value)');
    });

    // -- initModelPersistence --

    it('exports initModelPersistence function', () => {
        expect(content).toContain('export function initModelPersistence');
    });

    it('initModelPersistence watches enqueue-model select', () => {
        const fnStart = content.indexOf('export function initModelPersistence');
        const fnBody = content.slice(fnStart, content.indexOf('\n}', fnStart));
        expect(fnBody).toContain("watchModelSelect('enqueue-model')");
    });
});

// ============================================================================
// client/ai-actions.ts — preferences integration
// ============================================================================

describe('client/ai-actions.ts — preferences integration', () => {
    let content: string;
    beforeAll(() => { content = readClientFile('ai-actions.ts'); });

    it('imports applyModelToSelect from preferences', () => {
        expect(content).toContain('applyModelToSelect');
        expect(content).toContain("from './preferences'");
    });

    it('imports watchModelSelect from preferences', () => {
        expect(content).toContain('watchModelSelect');
    });

    it('imports saveModelPreference from preferences', () => {
        expect(content).toContain('saveModelPreference');
    });

    it('applies saved model to fp-model after populating options', () => {
        const fpPopulate = content.indexOf("fpTargetSelect.appendChild");
        const applyCall = content.indexOf("applyModelToSelect('fp-model')", fpPopulate);
        expect(applyCall).toBeGreaterThan(fpPopulate);
    });

    it('watches fp-model for changes', () => {
        expect(content).toContain("watchModelSelect('fp-model')");
    });

    it('applies saved model to update-doc-model after populating options', () => {
        const udPopulate = content.indexOf("targetSelect.appendChild");
        const applyCall = content.indexOf("applyModelToSelect('update-doc-model')", udPopulate);
        expect(applyCall).toBeGreaterThan(udPopulate);
    });

    it('watches update-doc-model for changes', () => {
        expect(content).toContain("watchModelSelect('update-doc-model')");
    });
});

// ============================================================================
// client/queue.ts — preferences integration
// ============================================================================

describe('client/queue.ts — preferences integration', () => {
    let content: string;
    beforeAll(() => { content = readClientFile('queue.ts'); });

    it('imports saveModelPreference from preferences', () => {
        expect(content).toContain('saveModelPreference');
        expect(content).toContain("from './preferences'");
    });

    it('calls saveModelPreference in submitEnqueueForm', () => {
        const fnStart = content.indexOf('export async function submitEnqueueForm');
        const fnBody = content.slice(fnStart, content.indexOf('\n// ', fnStart));
        expect(fnBody).toContain('saveModelPreference(model)');
    });
});

// ============================================================================
// client/index.ts — preferences bootstrapping
// ============================================================================

describe('client/index.ts — preferences bootstrapping', () => {
    let content: string;
    beforeAll(() => { content = readClientFile('index.tsx'); });

    it('imports loadPreferences and initModelPersistence from preferences', () => {
        expect(content).toContain("from './preferences'");
        expect(content).toContain('loadPreferences');
        expect(content).toContain('initModelPersistence');
    });

    it('calls loadPreferences()', () => {
        expect(content).toContain('loadPreferences()');
    });

    it('calls initModelPersistence()', () => {
        expect(content).toContain('initModelPersistence()');
    });

    it('loads preferences before AI actions module', () => {
        const prefsIdx = content.indexOf('loadPreferences()');
        const aiIdx = content.indexOf("'./ai-actions'");
        expect(prefsIdx).toBeGreaterThan(-1);
        expect(aiIdx).toBeGreaterThan(prefsIdx);
    });
});

// ============================================================================
// Client bundle — preferences functions present
// ============================================================================

describe('client bundle — preferences functions', () => {
    let script: string;
    beforeAll(() => { script = getClientBundle(); });

    it('contains loadPreferences function', () => {
        expect(script).toContain('loadPreferences');
    });

    it('contains saveModelPreference function', () => {
        expect(script).toContain('saveModelPreference');
    });

    it('contains applyModelToAllSelects function', () => {
        expect(script).toContain('applyModelToAllSelects');
    });

    it('contains applyModelToSelect function', () => {
        expect(script).toContain('applyModelToSelect');
    });

    it('contains watchModelSelect function', () => {
        expect(script).toContain('watchModelSelect');
    });

    it('contains initModelPersistence function', () => {
        expect(script).toContain('initModelPersistence');
    });

    it('contains /api/preferences endpoint reference', () => {
        expect(script).toContain('/preferences');
    });

    it('contains MODEL_SELECT_IDS array', () => {
        expect(script).toContain('MODEL_SELECT_IDS');
    });

    it('contains savedModel state variable', () => {
        expect(script).toContain('savedModel');
    });

    it('contains PATCH method for saving preferences', () => {
        expect(script).toContain('PATCH');
    });
});
