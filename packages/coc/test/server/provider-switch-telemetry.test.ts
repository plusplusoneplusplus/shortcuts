import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import pino from 'pino';
import { Writable } from 'stream';
import { clearLogBuffer, getLogHistory } from '../../src/server/logging/server-log-capture';
import { setServerLogger } from '../../src/server/logging/server-logger';
import { recordProviderSwitchServerTelemetry } from '../../src/server/provider-switch-telemetry';

describe('provider-switch server telemetry', () => {
    beforeEach(() => {
        clearLogBuffer();
        setServerLogger(pino({ level: 'info' }, new Writable({ write: (_chunk, _encoding, callback) => callback() })));
    });

    afterEach(() => {
        clearLogBuffer();
        setServerLogger(pino({ level: 'silent' }));
    });

    it('records only the allow-listed provider-switch fields', () => {
        recordProviderSwitchServerTelemetry({
            action: 'failed',
            sourceProvider: 'copilot',
            targetProvider: 'codex',
            workspaceId: 'workspace-1',
            processId: 'process-1',
            handoffOmittedHistory: true,
            failureReason: 'after-session-creation',
        });

        const [entry] = getLogHistory({ component: 'provider-switch' });
        expect(entry).toMatchObject({
            event: 'provider-switch',
            action: 'failed',
            sourceProvider: 'copilot',
            targetProvider: 'codex',
            workspaceId: 'workspace-1',
            processId: 'process-1',
            handoffOmittedHistory: true,
            failureReason: 'after-session-creation',
        });
        expect(Object.keys(entry).sort()).toEqual([
            'action',
            'component',
            'event',
            'failureReason',
            'handoffOmittedHistory',
            'level',
            'msg',
            'processId',
            'sourceProvider',
            'targetProvider',
            'ts',
            'workspaceId',
        ]);
    });
});
