import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { TeamsSettingsCard } from '../../../../src/server/spa/client/react/admin/IMSettingsSection';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function fixture(overrides: Record<string, unknown> = {}) {
    let current: Record<string, unknown> = {
        enabled: true, status: 'disconnected', mode: 'mcp', error: null, botName: 'CoC',
        teamName: 'Engineering', channelName: 'General', ic3Region: 'emea', teamId: 'team-1', channelId: null,
        ...overrides,
    };
    const posts: Array<Record<string, unknown>> = [];
    const fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
        if (url.endsWith('/teams/config')) {
            const body = JSON.parse(String(options?.body));
            posts.push(body);
            current = { ...current, ...body };
        }
        return { ok: true, json: async () => url.endsWith('/teams/status') ? current : { ok: true } };
    });
    vi.stubGlobal('fetch', fetchMock);
    return { posts, fetchMock };
}

describe('container Teams settings card', () => {
    it('shows one channel form and keeps optional details in a collapsed disclosure', async () => {
        fixture();
        render(<TeamsSettingsCard />);
        const channel = await screen.findByRole('region', { name: 'Channel settings' });
        expect((within(channel).getByLabelText('Team') as HTMLInputElement).value).toBe('Engineering');
        expect((within(channel).getByLabelText('Channel') as HTMLInputElement).value).toBe('General');
        expect((within(channel).getByLabelText('Bot name') as HTMLInputElement).value).toBe('CoC');
        expect(screen.queryByLabelText('Transport mode')).toBeNull();
        const advanced = screen.getByText('Advanced options').closest('details')!;
        expect(advanced.open).toBe(false);
        expect(advanced.contains(screen.getByLabelText('IC3 region'))).toBe(true);
        expect(within(advanced).getByText('team-1')).toBeDefined();
        expect(within(advanced).getByText('not resolved')).toBeDefined();
        expect(screen.getByRole('region', { name: 'Sign-in' })
            .contains(screen.getByRole('button', { name: 'Connect' }))).toBe(true);
        expect((screen.getByRole('button', { name: 'Save channel' }) as HTMLButtonElement).disabled).toBe(true);
    });

    it('saves only the changed bot name and keeps team, channel and region untouched', async () => {
        const f = fixture();
        render(<TeamsSettingsCard />);
        fireEvent.change(await screen.findByLabelText('Bot name'), { target: { value: '  Helper  ' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save channel' }));
        await waitFor(() => expect(f.posts).toEqual([{ botName: 'Helper' }]));
        await waitFor(() => expect((screen.getByRole('button', { name: 'Save channel' }) as HTMLButtonElement).disabled).toBe(true));
        expect((screen.getByLabelText('Bot name') as HTMLInputElement).value).toBe('Helper');
    });

    it('saves team, channel and region together without the bot name', async () => {
        const f = fixture();
        render(<TeamsSettingsCard />);
        fireEvent.change(await screen.findByLabelText('Channel'), { target: { value: ' Ops ' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save channel' }));
        await waitFor(() => expect(f.posts).toEqual([{ teamName: 'Engineering', channelName: 'Ops', ic3Region: 'emea' }]));
    });

    it('keeps an unsaved draft through status refresh and discards it on request', async () => {
        const f = fixture();
        render(<TeamsSettingsCard />);
        const team = await screen.findByLabelText('Team') as HTMLInputElement;
        fireEvent.change(team, { target: { value: 'Draft team' } });
        fireEvent.click(screen.getByRole('button', { name: 'Refresh status' }));
        await waitFor(() => expect(f.fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/teams/status')).length).toBe(2));
        expect(team.value).toBe('Draft team');
        fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
        expect(team.value).toBe('Engineering');
        expect(f.posts).toEqual([]);
    });

    it('labels the enable switch and shows no settings form while disabled', async () => {
        const f = fixture({ enabled: false });
        render(<TeamsSettingsCard />);
        const toggle = await screen.findByRole('checkbox', { name: 'Enable Teams bridge' }) as HTMLInputElement;
        expect(toggle.checked).toBe(false);
        expect(screen.getByText(/Teams integration is disabled/)).toBeDefined();
        expect(screen.queryByRole('region', { name: 'Channel settings' })).toBeNull();
        fireEvent.click(toggle);
        await waitFor(() => expect(f.posts).toEqual([{ enabled: true }]));
    });
});
