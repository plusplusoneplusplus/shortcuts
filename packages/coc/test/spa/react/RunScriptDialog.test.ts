/**
 * Tests for RunScriptDialog — workspace pre-fill and source-level checks.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const RUN_SCRIPT_SOURCE = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'queue', 'RunScriptDialog.tsx'),
    'utf-8',
);

describe('RunScriptDialog Dialog open prop', () => {
    it('passes open={true} to Dialog so it renders when showScriptDialog is true', () => {
        // Regression: previously <Dialog onClose={close}> omitted open prop,
        // causing Dialog to always return null (Dialog returns null when open is falsy).
        expect(RUN_SCRIPT_SOURCE).toContain('<Dialog open={true}');
    });
});

describe('RunScriptDialog workspace pre-fill', () => {
    it('reads scriptDialogWorkspaceId from queueState', () => {
        expect(RUN_SCRIPT_SOURCE).toContain('queueState.scriptDialogWorkspaceId');
    });

    it('uses scriptDialogWorkspaceId as first choice for workspaceId', () => {
        expect(RUN_SCRIPT_SOURCE).toContain("queueState.scriptDialogWorkspaceId || appState.workspaces?.[0]?.id || ''");
    });

    it('has a useEffect that pre-fills working directory when opened', () => {
        expect(RUN_SCRIPT_SOURCE).toContain('useEffect');
        expect(RUN_SCRIPT_SOURCE).toContain('setWorkingDir(ws?.rootPath');
    });

    it('clears working directory when opened without a specific workspace', () => {
        expect(RUN_SCRIPT_SOURCE).toContain("setWorkingDir('')");
    });

    it('looks up workspace from appState.workspaces to get rootPath', () => {
        expect(RUN_SCRIPT_SOURCE).toContain('appState.workspaces?.find');
    });

    it('imports useEffect from react', () => {
        expect(RUN_SCRIPT_SOURCE).toContain('useEffect');
        expect(RUN_SCRIPT_SOURCE).toMatch(/import\s*\{[^}]*useEffect[^}]*\}\s*from\s*'react'/);
    });
});

describe('RunScriptDialog model hint', () => {
    it('shows a hint that the model field is not used for script execution', () => {
        expect(RUN_SCRIPT_SOURCE).toContain('Not used for script execution');
    });
});

describe('RunScriptDialog model filtering', () => {
    it('filters model list to enabled models only', () => {
        expect(RUN_SCRIPT_SOURCE).toContain('filter(m => m.enabled)');
    });

    it('falls back to all models when none are enabled', () => {
        expect(RUN_SCRIPT_SOURCE).toContain('enabledModels.length > 0 ? enabledModels : modelInfos');
    });
});
