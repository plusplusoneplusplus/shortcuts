import { afterEach, describe, expect, it, vi } from 'vitest';

const { executeResume, exit, loadConfig } = vi.hoisted(() => ({
    executeResume: vi.fn().mockResolvedValue(0),
    exit: vi.fn(),
    loadConfig: vi.fn().mockReturnValue({
        serve: {
            dataDir: './custom-data',
        },
    }),
}));

vi.mock('../src/config', async importOriginal => {
    const actual = await importOriginal<typeof import('../src/config')>();
    return {
        ...actual,
        loadConfigFile: loadConfig,
    };
});

vi.mock('../src/commands/reliability-watchdog', async importOriginal => {
    const actual = await importOriginal<typeof import('../src/commands/reliability-watchdog')>();
    return {
        ...actual,
        executeReliabilityWatchdogResume: executeResume,
    };
});

import { createProgram } from '../src/cli';

describe('reliability watchdog resume CLI action', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('passes only file-configured serve values so persisted URL fallback stays reachable', async () => {
        vi.spyOn(process, 'exit').mockImplementation(exit as never);
        const program = createProgram();

        await program.parseAsync([
            'node',
            'coc',
            'reliability-watchdog',
            'resume',
            '--state-dir',
            './watchdog-state',
        ]);

        expect(loadConfig).toHaveBeenCalledOnce();
        expect(executeResume).toHaveBeenCalledWith(
            expect.objectContaining({ stateDir: './watchdog-state' }),
            {
                config: {
                    serve: {
                        dataDir: './custom-data',
                    },
                },
            },
        );
        expect(exit).toHaveBeenCalledWith(0);
    });
});
