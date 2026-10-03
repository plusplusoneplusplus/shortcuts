import { describe, expect, it, vi } from 'vitest';
import {
    createBotControlMetadata,
    validateBotControlMetadata,
} from '../../../src/server/messaging/bot-control-metadata';

describe('bot control metadata', () => {
    it.each(['teams', 'whatsapp'] as const)('creates safe fixed %s controller metadata', source => {
        const metadata = createBotControlMetadata(source);
        expect(metadata).toEqual({
            state: 'active',
            source,
            controllerKey: `${source}-bridge`,
            controllerLabel: source === 'teams' ? 'Teams bridge' : 'WhatsApp bridge',
        });
        expect(validateBotControlMetadata(metadata)).toEqual(metadata);
        expect(createBotControlMetadata(source)).not.toBe(metadata);
    });

    it.each([
        undefined, null, [], 'teams', {}, { state: 'active' },
        { state: 'released', source: 'teams', controllerKey: 'teams-bridge', controllerLabel: 'Teams bridge' },
        { state: 'active', source: 'cron', controllerKey: 'cron', controllerLabel: 'Automation' },
    ])('rejects invalid or non-bridge claims: %j', value => {
        expect(() => validateBotControlMetadata(value)).toThrow('Invalid bot control metadata');
    });

    it.each([
        { controllerKey: 'whatsapp-bridge' },
        { controllerLabel: 'WhatsApp bridge' },
        { controllerKey: 'account@example.invalid' },
        { controllerLabel: 'Account holder' },
        { controllerKey: 'x'.repeat(1000) },
        { controllerLabel: 'x'.repeat(1000) },
        { controllerLabel: '<script>unsafe</script>' },
        { controllerLabel: 'Teams bridge\n' },
        { accountId: 'routing-placeholder' },
        { token: 'credential-placeholder' },
        { workspaceId: 'other-workspace' },
        { provider: 'copilot' },
    ])('rejects mismatched identities and extra private fields: %j', changes => {
        expect(() => validateBotControlMetadata({
            ...createBotControlMetadata('teams'), ...changes,
        })).toThrow('Invalid bot control');
    });

    it.each([
        ['teams', 'https://teams.microsoft.com/l/message/thread-placeholder/message-placeholder'],
        ['whatsapp', 'https://web.whatsapp.com/'],
    ] as const)('accepts a validated %s URL only with binding authorization', (source, url) => {
        const candidate = { ...createBotControlMetadata(source), externalThreadUrl: url };
        const authorize = vi.fn((claimedSource, claimedUrl) => claimedSource === source && claimedUrl === url);
        expect(validateBotControlMetadata(candidate, authorize)).toEqual(candidate);
        expect(authorize).toHaveBeenCalledExactlyOnceWith(source, url);
        expect(() => validateBotControlMetadata(candidate)).toThrow('Unauthorized');
        expect(() => validateBotControlMetadata(candidate, () => false)).toThrow('Unauthorized');
    });

    it.each([
        '', 123, 'not a URL', 'javascript:alert(1)', 'file:///thread', 'http://teams.microsoft.com/l/message/thread',
        'https://teams.microsoft.com.evil.invalid/thread', 'https://evil.invalid/thread',
        'https://web.whatsapp.com/', 'https://teams.microsoft.com:8443/thread',
        'https://account:credential@teams.microsoft.com/thread',
        'https://teams.microsoft.com/thread#credential', 'https://teams.microsoft.com\\@evil.invalid/thread',
        ' https://teams.microsoft.com/thread', 'https://teams.microsoft.com/thread\n',
        `https://teams.microsoft.com/${'x'.repeat(2048)}`,
    ])('rejects unsafe URLs before asking for authorization: %j', url => {
        const authorize = vi.fn(() => true);
        expect(() => validateBotControlMetadata({
            ...createBotControlMetadata('teams'), externalThreadUrl: url,
        }, authorize)).toThrow('Invalid bot control thread URL');
        expect(authorize).not.toHaveBeenCalled();
    });

    it('propagates authorization failures without reporting a valid claim', () => {
        expect(() => validateBotControlMetadata({
            ...createBotControlMetadata('teams'),
            externalThreadUrl: 'https://teams.microsoft.com/l/message/thread-placeholder/message-placeholder',
        }, () => { throw new Error('Binding lookup failed'); })).toThrow('Binding lookup failed');
    });
});
