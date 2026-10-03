import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { readBotControl } from '../../../../src/server/spa/client/react/utils/botControl';
import { BotManagementBadge } from '../../../../src/server/spa/client/react/features/chat/BotManagementBadge';

const teams = { state: 'active', source: 'teams', controllerLabel: 'Teams bridge' };
const whatsapp = { state: 'active', source: 'whatsapp', controllerLabel: 'WhatsApp bridge' };

describe('safe public bot control presentation', () => {
    it.each([
        undefined, null, [], 'teams', 1, {},
        { ...teams, state: 'released' }, { ...teams, source: 'cron' },
        { ...teams, controllerLabel: 'Account 123' },
        { ...teams, controllerKey: 'teams-bridge' },
        { ...teams, credentials: 'private' },
    ])('omits absent or malformed control: %j', value => {
        expect(readBotControl(value)).toBeUndefined();
        const { container } = render(<BotManagementBadge control={value} />);
        expect(container.innerHTML).toBe('');
    });

    it.each([
        [teams, 'Teams'], [whatsapp, 'WhatsApp'],
    ])('shows accessible bot/source identity separately from provider: %j', (control, source) => {
        render(<BotManagementBadge control={control} />);
        expect(screen.getByRole('img', { name: `Bot-managed \u00b7 ${source}` }).textContent)
            .toContain(`Bot-managed \u00b7 ${source}`);
    });

    it('keeps the full accessible label in compact layouts', () => {
        render(<BotManagementBadge control={whatsapp} compact />);
        const badge = screen.getByRole('img', { name: 'Bot-managed \u00b7 WhatsApp' });
        expect(badge.querySelector('.sr-only')).not.toBeNull();
        expect(badge.getAttribute('title')).toBe('Bot-managed \u00b7 WhatsApp');
        expect(badge.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    });

    it.each([
        'javascript:alert(1)', 'data:text/html,test', 'http://teams.microsoft.com/thread',
        'https://teams.microsoft.com.evil.test/thread', 'https://web.whatsapp.com/thread',
        'https://credential@teams.microsoft.com/thread', 'https://teams.microsoft.com:444/thread',
        'https://teams.microsoft.com/thread#token', 'https://teams.microsoft.com/ thread',
        'https://teams.microsoft.com\\thread', 'https://teams.microsoft.com/' + 'a'.repeat(2048),
    ])('omits unsafe links without losing valid control: %s', externalThreadUrl => {
        expect(readBotControl({ ...teams, externalThreadUrl })).toEqual(teams);
    });

    it.each([
        [teams, 'https://teams.microsoft.com/l/message/thread/1'],
        [whatsapp, 'https://web.whatsapp.com/thread/1'],
    ])('preserves the server-authorized matching-host link: %j', (control, externalThreadUrl) => {
        expect(readBotControl({ ...control, externalThreadUrl })).toEqual({ ...control, externalThreadUrl });
    });
});
