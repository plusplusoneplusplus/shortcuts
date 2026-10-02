import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import QRCode from 'qrcode';
import { WhatsAppConnectionCard } from '../../../../src/server/spa/client/react/admin/WhatsAppConnectionCard';
import { IMSettingsSection } from '../../../../src/server/spa/client/react/admin/IMSettingsSection';

vi.mock('qrcode', () => ({ default: { toCanvas: vi.fn(async () => undefined) } }));

const initial = {
    enabled: false, status: 'disconnected', qr: null, error: null,
    groupJid: null, groupName: null, deviceName: 'CoC', selfJid: null,
};

function mockApi(status = initial, groups = [{ jid: 'one@g.us', name: 'First' }]) {
    let current: typeof initial = { ...status };
    const fetch = vi.fn(async (url: string, options?: RequestInit) => {
        const body = options?.body ? JSON.parse(options.body as string) : {};
        let payload: unknown = {};
        if (url.endsWith('/status')) payload = current;
        else if (url.endsWith('/config')) current = { ...current, ...body };
        else if (url.endsWith('/groups') && options?.method === 'POST') payload = { jid: 'new@g.us', name: body.name };
        else if (url.endsWith('/groups')) payload = { groups };
        return { ok: true, json: async () => payload };
    });
    vi.stubGlobal('fetch', fetch);
    return { fetch, setStatus: (next: Partial<typeof initial>) => { current = { ...current, ...next }; } };
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe('WhatsAppConnectionCard', () => {
    it('groups settings into named sections and uses the scoped admin controls', async () => {
        mockApi({ ...initial, enabled: true, status: 'connected' });
        render(<WhatsAppConnectionCard />);
        await screen.findByText('Connected');
        const group = screen.getByRole('region', { name: 'Chat group' });
        const device = screen.getByRole('region', { name: 'Device & pairing' });
        expect(within(group).getByLabelText('Group').className).toBe('ar-select');
        expect(within(group).getByLabelText('New group name').className).toBe('ar-input');
        expect(within(device).getByLabelText('Device name').className).toBe('ar-input');
        for (const button of within(screen.getByTestId('whatsapp-connection-card')).getAllByRole('button')) {
            expect(button.className).toContain('ar-btn');
        }
    });

    it('preserves unsaved edits on refresh and rejects blank device and group names', async () => {
        const { fetch } = mockApi({ ...initial, enabled: true, status: 'connected' });
        render(<WhatsAppConnectionCard />);
        await screen.findByRole('option', { name: 'First' });
        fireEvent.change(screen.getByLabelText('Device name'), { target: { value: 'My bridge' } });
        fireEvent.change(screen.getByLabelText('Group'), { target: { value: 'one@g.us' } });
        fireEvent.click(screen.getByText('Refresh status'));
        await waitFor(() => expect(fetch.mock.calls.filter(([url]) => url.endsWith('/status'))).toHaveLength(2));
        expect(screen.getByLabelText('Device name')).toHaveProperty('value', 'My bridge');
        expect(screen.getByLabelText('Group')).toHaveProperty('value', 'one@g.us');
        fireEvent.change(screen.getByLabelText('Device name'), { target: { value: '   ' } });
        fireEvent.change(screen.getByLabelText('New group name'), { target: { value: '   ' } });
        expect(screen.getByRole('button', { name: 'Save & Re-pair' })).toHaveProperty('disabled', true);
        expect(screen.getByRole('button', { name: 'Create group' })).toHaveProperty('disabled', true);
    });

    it('loads disabled state and enables without a redundant reconnect', async () => {
        const { fetch } = mockApi();
        render(<WhatsAppConnectionCard />);
        expect(await screen.findByText('Not connected')).toBeDefined();
        expect(screen.queryByText('Device name')).toBeNull();
        fireEvent.click(screen.getByLabelText('Enable WhatsApp'));
        await waitFor(() => expect(fetch).toHaveBeenCalledWith(
            expect.stringMatching(/\/messaging\/whatsapp\/config$/),
            expect.objectContaining({ method: 'POST', body: '{"enabled":true}' }),
        ));
        expect(await screen.findByText('Waiting for QR code…')).toBeDefined();
        expect(fetch.mock.calls.some(([url]) => url.endsWith('/reconnect'))).toBe(false);
        expect(screen.getByLabelText('Device name')).toBeDefined();
        fireEvent.click(screen.getByLabelText('Enable WhatsApp'));
        await waitFor(() => expect(fetch).toHaveBeenCalledWith(
            expect.stringMatching(/\/messaging\/whatsapp\/config$/),
            expect.objectContaining({ body: '{"enabled":false}' }),
        ));
        expect(screen.queryByText('Device name')).toBeNull();
    });

    it.each([
        ['qr-pending', 'QR-CONTENT', 'WhatsApp pairing QR code'],
        ['connecting', null, 'Connecting to WhatsApp…'],
        ['creating-group', null, 'Creating WhatsApp group…'],
        ['error', null, 'Connection failed'],
    ])('displays %s pairing state', async (connectionState, qr, expected) => {
        mockApi({ ...initial, enabled: true, status: connectionState, qr, error: connectionState === 'error' ? 'Retry pairing' : null });
        render(<WhatsAppConnectionCard />);
        await screen.findByText(connectionState === 'error' ? 'Error' : connectionState === 'qr-pending'
            ? 'Waiting for QR scan' : connectionState === 'connecting' ? 'Connecting…' : 'Creating group…');
        fireEvent.click(screen.getByText('Setup / Pair'));
        expect(await (connectionState === 'qr-pending' ? screen.findByLabelText(expected) : screen.findByText(expected))).toBeDefined();
        if (connectionState === 'error') expect(screen.getAllByText('Retry pairing').length).toBeGreaterThan(0);
    });

    it('closes pairing on connection, loads groups, selects an existing group and creates a new one', async () => {
        const api = mockApi({ ...initial, enabled: true, status: 'qr-pending', qr: 'QR-CONTENT' });
        render(<WhatsAppConnectionCard />);
        await screen.findByText('Waiting for QR scan');
        fireEvent.click(screen.getByText('Setup / Pair'));
        expect(await screen.findByLabelText('WhatsApp pairing QR code')).toBeDefined();
        api.setStatus({ status: 'connected', qr: null, selfJid: 'linked@s.whatsapp.net' });
        fireEvent.click(screen.getByText('Refresh status'));
        expect(await screen.findByText('Linked account: linked@s.whatsapp.net')).toBeDefined();
        await waitFor(() => expect(screen.queryByText('Pair WhatsApp')).toBeNull());
        await waitFor(() => expect(screen.getByRole('option', { name: 'First' })).toBeDefined());
        fireEvent.change(screen.getByLabelText('Group'), { target: { value: 'one@g.us' } });
        fireEvent.click(screen.getByText('Save group'));
        await waitFor(() => expect(api.fetch).toHaveBeenCalledWith(
            expect.stringMatching(/\/messaging\/whatsapp\/config$/),
            expect.objectContaining({ body: '{"groupJid":"one@g.us","groupName":"First"}' }),
        ));
        fireEvent.change(screen.getByLabelText('New group name'), { target: { value: 'Second' } });
        fireEvent.click(screen.getByText('Create group'));
        await waitFor(() => expect(api.fetch).toHaveBeenCalledWith(
            expect.stringMatching(/\/messaging\/whatsapp\/groups$/),
            expect.objectContaining({ body: '{"name":"Second"}' }),
        ));
        await waitFor(() => expect(api.fetch).toHaveBeenCalledWith(
            expect.stringMatching(/\/messaging\/whatsapp\/config$/),
            expect.objectContaining({ body: '{"groupJid":"new@g.us","groupName":"Second"}' }),
        ));
    });

    it('offers a ready-to-create CoC group by default', async () => {
        const { fetch } = mockApi({ ...initial, enabled: true, status: 'connected' });
        render(<WhatsAppConnectionCard />);
        await screen.findByText('Connected');
        expect(screen.getByLabelText('New group name')).toHaveProperty('value', 'CoC');
        fireEvent.click(screen.getByText('Create group'));
        await waitFor(() => expect(fetch).toHaveBeenCalledWith(
            expect.stringMatching(/\/messaging\/whatsapp\/groups$/),
            expect.objectContaining({ body: '{"name":"CoC"}' }),
        ));
        await waitFor(() => expect(fetch).toHaveBeenCalledWith(
            expect.stringMatching(/\/messaging\/whatsapp\/config$/),
            expect.objectContaining({ body: '{"groupJid":"new@g.us","groupName":"CoC"}' }),
        ));
        expect(screen.getByLabelText('New group name')).toHaveProperty('value', 'CoC');
    });

    it('surfaces QR rendering failures so users can retry pairing', async () => {
        vi.mocked(QRCode.toCanvas).mockRejectedValueOnce(new Error('canvas unavailable'));
        mockApi({ ...initial, enabled: true, status: 'qr-pending', qr: 'QR-CONTENT' });
        render(<WhatsAppConnectionCard />);
        await screen.findByText('Waiting for QR scan');
        fireEvent.click(screen.getByText('Setup / Pair'));
        expect(await screen.findByText(/Could not display the pairing QR code/)).toBeDefined();
        expect(screen.getByText('Refresh status')).toBeDefined();
    });

    it('saves a changed device name and requires repair; re-pair explicitly repairs too', async () => {
        const { fetch } = mockApi({ ...initial, enabled: true, status: 'connected', groupJid: 'one@g.us', groupName: 'First' });
        render(<WhatsAppConnectionCard />);
        await screen.findByText('Connected');
        fireEvent.change(screen.getByLabelText('Device name'), { target: { value: '  Bridge  ' } });
        expect(screen.getByText(/requires re-pairing/)).toBeDefined();
        fireEvent.click(screen.getByText('Save & Re-pair'));
        await waitFor(() => expect(fetch).toHaveBeenCalledWith(
            expect.stringMatching(/\/messaging\/whatsapp\/config$/),
            expect.objectContaining({ body: '{"deviceName":"Bridge"}' }),
        ));
        await waitFor(() => expect(fetch).toHaveBeenCalledWith(
            expect.stringMatching(/\/messaging\/whatsapp\/reconnect$/),
            expect.objectContaining({ body: '{"repair":true}' }),
        ));
        fireEvent.click(screen.getByText('Re-pair'));
        await waitFor(() => expect(fetch.mock.calls.filter(([url]) => url.endsWith('/reconnect'))).toHaveLength(2));
    });

    it('reports fetch and mutation failures without hiding the card, and allows retry', async () => {
        let fail = true;
        const fetch = vi.fn(async (url: string) => fail
            ? { ok: false, status: 503, json: async () => ({ error: 'Offline' }) }
            : { ok: true, json: async () => url.endsWith('/status') ? { ...initial, enabled: true } : { groups: [] } });
        vi.stubGlobal('fetch', fetch);
        render(<WhatsAppConnectionCard />);
        expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Offline');
        fail = false;
        fireEvent.click(screen.getByText('Refresh status'));
        expect(await screen.findByLabelText('Device name')).toBeDefined();
        expect(screen.queryByRole('alert')).toBeNull();
    });

    it('reports reconnect and group-list errors while keeping status and retry controls available', async () => {
        const fetch = vi.fn(async (url: string) => url.endsWith('/reconnect') || url.endsWith('/groups')
            ? { ok: false, status: 503, json: async () => ({ error: 'Temporarily offline' }) }
            : { ok: true, json: async () => ({ ...initial, enabled: true, status: 'connected' }) });
        vi.stubGlobal('fetch', fetch);
        render(<WhatsAppConnectionCard />);
        expect(await screen.findByText('Connected')).toBeDefined();
        expect(await screen.findByText('Could not load groups: Temporarily offline')).toBeDefined();
        fireEvent.click(screen.getByText('Re-pair'));
        expect(await screen.findByText('Temporarily offline')).toBeDefined();
        expect(screen.getByText('Refresh status')).toBeDefined();
    });

    it('shows the error status when the native connection is disconnected with an error', async () => {
        mockApi({ ...initial, enabled: true, error: 'Pairing failed' });
        render(<WhatsAppConnectionCard />);
        expect(await screen.findByText('Error')).toBeDefined();
        expect(screen.getByText('Pairing failed')).toBeDefined();
    });

    it('keeps container pairing QR and connection status on container routes', async () => {
        const fetch = vi.fn(async () => ({ ok: true, json: async () => ({
            enabled: true, status: 'qr-pending', qr: 'CONTAINER-QR', error: null, groupJid: null, userName: 'CoC',
        }) }));
        vi.stubGlobal('fetch', fetch);
        render(<IMSettingsSection />);
        expect(await screen.findByText('Waiting for QR scan')).toBeDefined();
        fireEvent.click(screen.getByText('Setup / Pair'));
        expect(await screen.findByLabelText('WhatsApp pairing QR code')).toBeDefined();
        expect(fetch.mock.calls.every(([url]) => url.includes('/container/messaging/'))).toBe(true);
    });

    it('keeps container messaging routes and disabled instructions unchanged', async () => {
        const fetch = vi.fn(async () => ({ ok: true, json: async () => ({
            enabled: false, status: 'disconnected', qr: null, error: null, groupJid: null, userName: 'CoC',
        }) }));
        vi.stubGlobal('fetch', fetch);
        render(<IMSettingsSection />);
        expect(await screen.findByText(/WhatsApp integration is disabled/)).toBeDefined();
        expect(fetch).toHaveBeenCalledWith(expect.stringMatching(/\/container\/messaging\/status$/));
        expect(fetch.mock.calls.some(([url]) => url.includes('/messaging/whatsapp'))).toBe(false);
    });
});
