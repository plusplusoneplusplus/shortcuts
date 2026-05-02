/**
 * Tests for infrastructure/terminal-infrastructure.ts
 *
 * Verifies:
 * - Returns undefined when terminal.enabled is false
 * - Returns undefined when node-pty is unavailable (logs warning)
 * - Returns TerminalInfrastructure when enabled and node-pty is available
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ProcessStore } from '@plusplusoneplusplus/forge';
import type { ResolvedCLIConfig } from '../../../src/config';
import { createMockProcessStore } from '../../helpers/mock-process-store';

// ── Logger spy ────────────────────────────────────────────────────────────────

const warnSpy = vi.fn();
const infoSpy = vi.fn();

vi.mock('../../../src/server/logging/server-logger', () => ({
    getServerLogger: () => ({
        warn: warnSpy,
        info: infoSpy,
        debug: vi.fn(),
        error: vi.fn(),
        trace: vi.fn(),
        fatal: vi.fn(),
    }),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeConfig(terminalEnabled: boolean): ResolvedCLIConfig {
    return {
        terminal: { enabled: terminalEnabled },
    } as unknown as ResolvedCLIConfig;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('createTerminalInfrastructure', () => {
    let store: ProcessStore;

    beforeEach(() => {
        store = createMockProcessStore();
        warnSpy.mockClear();
        infoSpy.mockClear();
    });

    it('returns undefined when terminal.enabled is false', async () => {
        const { createTerminalInfrastructure } = await import(
            '../../../src/server/infrastructure/terminal-infrastructure'
        );
        const result = createTerminalInfrastructure(store, makeConfig(false));
        expect(result).toBeUndefined();
        expect(infoSpy).not.toHaveBeenCalled();
    });

    it('returns undefined when node-pty is unavailable and logs warning', async () => {
        // Mock require to fail for the terminal ws server module
        vi.doMock('../../../src/server/terminal/terminal-ws-server', () => {
            throw new Error('Cannot find module node-pty');
        });

        // Clear the module cache to force re-evaluation with the mock
        vi.resetModules();

        // Re-mock the logger after resetModules
        vi.doMock('../../../src/server/logging/server-logger', () => ({
            getServerLogger: () => ({
                warn: warnSpy,
                info: infoSpy,
                debug: vi.fn(),
                error: vi.fn(),
                trace: vi.fn(),
                fatal: vi.fn(),
            }),
        }));

        const { createTerminalInfrastructure } = await import(
            '../../../src/server/infrastructure/terminal-infrastructure'
        );
        const result = createTerminalInfrastructure(store, makeConfig(true));
        expect(result).toBeUndefined();
        expect(warnSpy).toHaveBeenCalledWith(
            expect.objectContaining({ err: expect.any(Error) }),
            expect.stringContaining('node-pty unavailable'),
        );
    });

    it('returns infrastructure when enabled and node-pty is available', async () => {
        const { createTerminalInfrastructure } = await import(
            '../../../src/server/infrastructure/terminal-infrastructure'
        );

        // The real TerminalWebSocketServer will try to load node-pty;
        // if node-pty is not installed in CI, this will return undefined.
        // We test with the real module if available, skip gracefully otherwise.
        const result = createTerminalInfrastructure(store, makeConfig(true));

        if (result === undefined) {
            // node-pty not installed — the factory correctly returned undefined
            expect(warnSpy).toHaveBeenCalled();
            return;
        }

        expect(result).toBeDefined();
        expect(result.terminalWsServer).toBeDefined();
        expect(result.terminalSessionManager).toBeDefined();
        expect(typeof result.terminalWsServer.closeAll).toBe('function');
        expect(typeof result.terminalSessionManager.destroyAll).toBe('function');
        expect(infoSpy).toHaveBeenCalledWith(
            expect.stringContaining('web terminal enabled'),
        );

        // Cleanup
        result.terminalWsServer.closeAll();
    });
});
