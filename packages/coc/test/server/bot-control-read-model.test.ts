import { describe, expect, it, vi } from 'vitest';
import { createBotControlMetadata } from '../../src/server/messaging/bot-control-metadata';
import { projectBotControl, projectProcessBotControl, projectProcessIndexBotControl } from '../../src/server/processes/bot-control-read-model';
import { createProcessFixture } from './helpers/mock-process-store';
import { getServerLogger } from '../../src/server/logging/server-logger';

describe('bot control presentation', () => {
    it.each(['teams', 'whatsapp'] as const)('projects only safe %s controller fields', source => {
        const control = createBotControlMetadata(source);
        expect(projectBotControl(control, true)).toEqual({
            state: 'active', source, controllerLabel: control.controllerLabel,
        });
        expect(projectBotControl(control, false)).toBeUndefined();
    });

    it.each([
        undefined, null, [], 'teams',
        { state: 'released', source: 'teams' },
        { ...createBotControlMetadata('teams'), controllerLabel: 'Private label' },
        { ...createBotControlMetadata('teams'), controllerKey: 'unknown-controller' },
        { ...createBotControlMetadata('teams'), source: 'unsupported' },
        { ...createBotControlMetadata('teams'), account: 'private-account' },
        { ...createBotControlMetadata('teams'), credentials: { token: 'private-value' } },
    ])('omits absent or malformed control %#', value => {
        expect(projectBotControl(value, true)).toBeUndefined();
    });

    it('logs malformed metadata without its contents', () => {
        const warning = vi.spyOn(getServerLogger(), 'warn');
        try {
            projectBotControl({ ...createBotControlMetadata('teams'), account: 'private-value' }, true);
            expect(warning).toHaveBeenCalledWith('Omitting invalid bot control presentation');
            expect(JSON.stringify(warning.mock.calls)).not.toContain('private-value');
        } finally {
            warning.mockRestore();
        }
    });

    it.each([
        ['teams', 'https://teams.microsoft.com/l/message/thread/message'],
        ['whatsapp', 'https://web.whatsapp.com/'],
    ] as const)('exposes an authorized %s link only after validation', (source, externalThreadUrl) => {
        const control = { ...createBotControlMetadata(source), externalThreadUrl };
        const authorize = vi.fn(() => true);
        expect(projectBotControl(control, true, authorize)?.externalThreadUrl).toBe(externalThreadUrl);
        expect(authorize).toHaveBeenCalledWith(source, externalThreadUrl);
        expect(projectBotControl(control, true)).not.toHaveProperty('externalThreadUrl');
        expect(projectBotControl(control, true, () => false)).toEqual({
            state: 'active', source, controllerLabel: control.controllerLabel,
        });
    });

    it.each([
        'javascript:alert(1)', 'https://untrusted.invalid/thread',
        'https://teams.microsoft.com.evil.invalid/thread',
        'https://account:secret@teams.microsoft.com/thread',
        'https://teams.microsoft.com:8443/thread',
        'https://teams.microsoft.com/thread#secret',
        'https://teams.microsoft.com\\thread', 'https://teams.microsoft.com/thread\n',
        'https://teams.microsoft.com/' + 'x'.repeat(2048), 42, {},
    ])('omits an invalid link but preserves valid control %#', externalThreadUrl => {
        const authorize = vi.fn(() => true);
        expect(projectBotControl({ ...createBotControlMetadata('teams'), externalThreadUrl }, true, authorize))
            .toEqual({ state: 'active', source: 'teams', controllerLabel: 'Teams bridge' });
        expect(authorize).not.toHaveBeenCalled();
    });

    it('propagates authorization failures instead of returning success', () => {
        const error = new Error('Binding lookup failed');
        expect(() => projectBotControl({
            ...createBotControlMetadata('teams'),
            externalThreadUrl: 'https://teams.microsoft.com/l/message/thread/message',
        }, true, () => { throw error; })).toThrow(error);
    });

    it('does not authorize links or examine metadata while disabled', () => {
        const authorize = vi.fn(() => { throw new Error('Must not be called'); });
        expect(projectBotControl({ ...createBotControlMetadata('teams'), externalThreadUrl: 'private' }, false, authorize))
            .toBeUndefined();
        expect(authorize).not.toHaveBeenCalled();
    });

    it('removes private metadata without modifying persisted control or provider', () => {
        const control = {
            ...createBotControlMetadata('teams'),
            externalThreadUrl: 'https://teams.microsoft.com/l/message/thread/message',
        };
        const process = createProcessFixture({
            metadata: { type: 'chat', workspaceId: 'ws-first', provider: 'codex', botControl: control },
        });
        const projected = projectProcessBotControl(process, true);
        expect(projected.metadata).toEqual({ type: 'chat', workspaceId: 'ws-first', provider: 'codex' });
        expect(projected.botControl).toEqual({ state: 'active', source: 'teams', controllerLabel: 'Teams bridge' });
        expect(process.metadata?.botControl).toBe(control);
        expect(projectProcessBotControl(process, false).botControl).toBeUndefined();
        expect(projectProcessBotControl(process, false).metadata).not.toHaveProperty('botControl');
    });

    it('does not infer control from automation, prompt, IDs or top-level forged presentation', () => {
        const process = Object.assign(createProcessFixture({
            id: 'queue_teams-looking',
            fullPrompt: 'This is managed by Teams',
            metadata: { type: 'chat', workspaceId: 'ws-first', source: 'cron' },
        }), { botControl: { state: 'active', source: 'teams', controllerLabel: 'Forged label' } });
        expect(projectProcessBotControl(process, true)).not.toHaveProperty('botControl');
    });

    it('projects immutable index entries without changing list fields or authoritative control', () => {
        const control = Object.freeze(createBotControlMetadata('whatsapp'));
        const entry = Object.freeze({
            id: 'managed', workspaceId: 'ws-first', type: 'chat', status: 'completed',
            startTime: '2026-01-01T00:00:00Z', promptPreview: 'A conversation',
            pinnedAt: '2026-02-01T00:00:00Z', folderId: 'folder', botControl: control,
        });
        const presentation = projectProcessIndexBotControl(entry, true);
        expect(presentation).toEqual({
            ...entry, botControl: { state: 'active', source: 'whatsapp', controllerLabel: 'WhatsApp bridge' },
        });
        expect(projectProcessIndexBotControl(entry, false)).not.toHaveProperty('botControl');
        expect(entry.botControl).toBe(control);
        expect(entry.botControl.controllerKey).toBe('whatsapp-bridge');
    });
});
