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
    it('passes open={true} to Dialog (mobile) so it renders when showScriptDialog is true', () => {
        // Mobile path still uses <Dialog open={true}>.
        expect(RUN_SCRIPT_SOURCE).toContain('<Dialog open={true}');
    });

    it('passes open={true} to FloatingDialog (desktop) so it renders when showScriptDialog is true', () => {
        expect(RUN_SCRIPT_SOURCE).toContain('<FloatingDialog');
        expect(RUN_SCRIPT_SOURCE).toContain('open={true}');
    });
});

describe('RunScriptDialog responsive container', () => {
    it('imports FloatingDialog from shared', () => {
        expect(RUN_SCRIPT_SOURCE).toMatch(/import\s*\{[^}]*FloatingDialog[^}]*\}\s*from\s*'\.\.\/shared'/);
    });

    it('imports useBreakpoint for mobile detection', () => {
        expect(RUN_SCRIPT_SOURCE).toContain('useBreakpoint');
    });

    it('uses isMobile to choose between FloatingDialog and Dialog', () => {
        expect(RUN_SCRIPT_SOURCE).toContain('isMobile');
        expect(RUN_SCRIPT_SOURCE).toContain('if (!isMobile)');
    });

    it('sets resizable, minWidth and minHeight on FloatingDialog', () => {
        expect(RUN_SCRIPT_SOURCE).toContain('resizable');
        expect(RUN_SCRIPT_SOURCE).toContain('minWidth={520}');
        expect(RUN_SCRIPT_SOURCE).toContain('minHeight={420}');
    });
});

describe('RunScriptDialog minimize-to-tray', () => {
    it('imports useMinimizedDialog', () => {
        expect(RUN_SCRIPT_SOURCE).toContain('useMinimizedDialog');
    });

    it('has a minimized boolean state', () => {
        expect(RUN_SCRIPT_SOURCE).toContain('minimized');
        expect(RUN_SCRIPT_SOURCE).toContain('setMinimized');
    });

    it('returns null when minimized', () => {
        expect(RUN_SCRIPT_SOURCE).toContain('if (minimized) return null');
    });

    it('calls useMinimizedDialog with minimizedEntry', () => {
        expect(RUN_SCRIPT_SOURCE).toContain('useMinimizedDialog(minimizedEntry)');
    });

    it('uses script icon and Run Script label for the pill', () => {
        expect(RUN_SCRIPT_SOURCE).toContain("icon: '⚡'");
        expect(RUN_SCRIPT_SOURCE).toContain("label: 'Run Script'");
    });

    it('wires onMinimize to both dialog variants', () => {
        expect(RUN_SCRIPT_SOURCE).toContain('onMinimize={handleMinimize}');
    });

    it('resets minimized state when dialog closes externally', () => {
        expect(RUN_SCRIPT_SOURCE).toContain('if (!open) setMinimized(false)');
    });

    it('handleClose dispatches CLOSE_SCRIPT_DIALOG and clears minimized', () => {
        expect(RUN_SCRIPT_SOURCE).toContain('handleClose');
        expect(RUN_SCRIPT_SOURCE).toContain("type: 'CLOSE_SCRIPT_DIALOG'");
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

describe('RunScriptDialog Ctrl+Enter submit shortcut', () => {
    it('defines a handleKeyDown callback', () => {
        expect(RUN_SCRIPT_SOURCE).toContain('handleKeyDown');
    });

    it('checks for Ctrl or Meta key combined with Enter', () => {
        expect(RUN_SCRIPT_SOURCE).toContain('e.ctrlKey || e.metaKey');
        expect(RUN_SCRIPT_SOURCE).toContain("e.key === 'Enter'");
    });

    it('guards against double-submit by checking submitting flag', () => {
        expect(RUN_SCRIPT_SOURCE).toMatch(/ctrlKey.*!submitting|!submitting.*ctrlKey/s);
    });

    it('wires onKeyDown to the dialog content container', () => {
        expect(RUN_SCRIPT_SOURCE).toContain('onKeyDown={handleKeyDown}');
    });

    it('shows Ctrl+Enter tooltip on the Enqueue button', () => {
        expect(RUN_SCRIPT_SOURCE).toContain('title="Ctrl+Enter"');
    });
});

describe('RunScriptDialog onboarding hasRunWorkflow', () => {
    it('destructures dispatch from useApp as appDispatch', () => {
        expect(RUN_SCRIPT_SOURCE).toContain('dispatch: appDispatch');
    });

    it('guards dispatch with onboardingProgress check', () => {
        expect(RUN_SCRIPT_SOURCE).toContain('!appState.onboardingProgress?.hasRunWorkflow');
    });

    it('dispatches UPDATE_ONBOARDING with hasRunWorkflow true', () => {
        expect(RUN_SCRIPT_SOURCE).toContain("appDispatch({ type: 'UPDATE_ONBOARDING', payload: { hasRunWorkflow: true } })");
    });
});
