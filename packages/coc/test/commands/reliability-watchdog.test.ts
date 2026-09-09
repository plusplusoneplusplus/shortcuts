import * as path from 'path';
import { Writable } from 'stream';
import { describe, expect, it, vi } from 'vitest';
import {
    buildDeliveryWatchdogConfig,
    executeReliabilityWatchdogStart,
    executeReliabilityWatchdogStatus,
    executeReliabilityWatchdogStop,
    type ReliabilityWatchdogDependencies,
} from '../../src/commands/reliability-watchdog';

function memoryWritable() {
    let output = '';
    return {
        stream: new Writable({
            write(chunk, _encoding, callback) {
                output += chunk.toString();
                callback();
            },
        }),
        output: () => output,
    };
}

function explicitOptions() {
    return {
        workspaceId: 'ws-example',
        processId: 'queue_example',
        worktree: './feature-worktree',
        ledger: './state/DELIVERY.md',
        promptFile: './state/continue.txt',
        stateDir: './state/watchdog',
        dataDir: './coc-data',
        serverUrl: 'http://127.0.0.1:4000',
        mode: 'autopilot',
        completeMarker: 'DELIVERY_COMPLETE',
        blockedMarker: 'DELIVERY_BLOCKED',
        pollInterval: '60000',
        idlePolls: '3',
        cooldown: '900000',
        ttl: '259200000',
        maxResumes: '12',
        heartbeatInterval: '900000',
    };
}

describe('reliability watchdog command', () => {
    it('normalizes and validates explicit start configuration', () => {
        const cwd = path.resolve('repo');
        const result = buildDeliveryWatchdogConfig(explicitOptions(), {
            cwd,
            env: {},
        });

        expect(result).toMatchObject({
            workspaceId: 'ws-example',
            processId: 'queue_example',
            worktree: path.resolve(cwd, 'feature-worktree'),
            ledgerPath: path.resolve(cwd, 'state', 'DELIVERY.md'),
            promptFile: path.resolve(cwd, 'state', 'continue.txt'),
            stateDir: path.resolve(cwd, 'state', 'watchdog'),
            dataDir: path.resolve(cwd, 'coc-data'),
            serverUrl: 'http://127.0.0.1:4000',
            mode: 'autopilot',
            limits: {
                pollIntervalMs: 60_000,
                idlePolls: 3,
                cooldownMs: 900_000,
                ttlMs: 259_200_000,
                maxResumes: 12,
                heartbeatIntervalMs: 900_000,
            },
        });
    });

    it('requires Ralph session identity for Ralph recovery', () => {
        expect(() => buildDeliveryWatchdogConfig({
            ...explicitOptions(),
            mode: 'ralph',
        }, { cwd: process.cwd(), env: {} })).toThrow('ralph-session-id');
    });

    it('rejects server URLs containing credentials', () => {
        expect(() => buildDeliveryWatchdogConfig({
            ...explicitOptions(),
            serverUrl: 'http://user:secret@127.0.0.1:4000',
        }, { cwd: process.cwd(), env: {} })).toThrow('credentials');
    });

    it('delegates start, status, and stop through injectable lifecycle functions', async () => {
        const stdout = memoryWritable();
        const start = vi.fn().mockResolvedValue({ pid: 42, stateFile: '/state/watchdog-state.json' });
        const status = vi.fn().mockResolvedValue({ running: true, pid: 42, resumeCount: 1 });
        const stop = vi.fn().mockResolvedValue({ requested: true, pid: 42 });
        const deps: ReliabilityWatchdogDependencies = {
            cwd: process.cwd(),
            env: {},
            stdout: stdout.stream,
            stderr: memoryWritable().stream,
            start,
            status,
            stop,
        };

        expect(await executeReliabilityWatchdogStart(explicitOptions(), deps)).toBe(0);
        expect(await executeReliabilityWatchdogStatus({ stateDir: './state/watchdog' }, deps)).toBe(0);
        expect(await executeReliabilityWatchdogStop({ stateDir: './state/watchdog' }, deps)).toBe(0);
        expect(start).toHaveBeenCalledOnce();
        expect(status).toHaveBeenCalledWith(path.resolve('state/watchdog'));
        expect(stop).toHaveBeenCalledWith(path.resolve('state/watchdog'));
        expect(stdout.output()).toContain('Watchdog started: PID 42');
        expect(stdout.output()).toContain('"running":true');
        expect(stdout.output()).toContain('Stop requested: PID 42');
    });
});
