/**
 * Tests for ProviderConfigPanel component.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';

// Mock getApiBase so fetch URLs are predictable.
vi.mock('../../../../../src/server/spa/client/react/utils/config', () => ({
    getApiBase: () => '',
}));

async function renderPanel(props: { detected?: 'GitHub' | 'ADO' | string | null; remoteUrl?: string; onConfigured?: () => void } = {}) {
    const { ProviderConfigPanel } = await import(
        '../../../../../src/server/spa/client/react/repos/pull-requests/ProviderConfigPanel'
    );
    const onConfigured = props.onConfigured ?? vi.fn();
    const detected = Object.prototype.hasOwnProperty.call(props, 'detected') ? props.detected! : 'GitHub';
    const result = render(
        <ProviderConfigPanel
            detected={detected as any}
            remoteUrl={props.remoteUrl}
            onConfigured={onConfigured}
        />
    );
    return { ...result, onConfigured };
}

beforeEach(() => {
    vi.resetModules();
    vi.resetAllMocks();
    vi.useRealTimers();
});

// ── GitHub variant ─────────────────────────────────────────────────────────────

describe('GitHub variant', () => {
    it('renders GitHub token field when detected === GitHub', async () => {
        await act(async () => { await renderPanel({ detected: 'GitHub' }); });
        expect(screen.getByTestId('token-input')).toBeInTheDocument();
        expect(screen.queryByTestId('org-url-input')).not.toBeInTheDocument();
        expect(screen.getByText(/GitHub Token/)).toBeInTheDocument();
    });

    it('shows remote URL when provided', async () => {
        await act(async () => { await renderPanel({ detected: 'GitHub', remoteUrl: 'https://github.com/org/repo.git' }); });
        expect(screen.getByText(/https:\/\/github\.com\/org\/repo\.git/)).toBeInTheDocument();
    });

    it('shows detected provider label', async () => {
        await act(async () => { await renderPanel({ detected: 'GitHub' }); });
        expect(screen.getByText(/Detected provider:/)).toBeInTheDocument();
        expect(screen.getByText('GitHub')).toBeInTheDocument();
    });
});

// ── ADO variant ────────────────────────────────────────────────────────────────

describe('ADO variant', () => {
    it('renders both orgUrl and token fields when detected === ADO', async () => {
        await act(async () => { await renderPanel({ detected: 'ADO' }); });
        expect(screen.getByTestId('org-url-input')).toBeInTheDocument();
        expect(screen.getByTestId('token-input')).toBeInTheDocument();
        expect(screen.getByText(/Organization URL/)).toBeInTheDocument();
        expect(screen.getByText(/Personal Access Token/)).toBeInTheDocument();
    });
});

// ── Null detected ──────────────────────────────────────────────────────────────

describe('null detected', () => {
    it('shows generic message when detected is null', async () => {
        await act(async () => { await renderPanel({ detected: null }); });
        expect(screen.getByText(/Provider could not be detected/)).toBeInTheDocument();
    });
});

// ── Save button disabled state ─────────────────────────────────────────────────

describe('save button disabled state', () => {
    it('is disabled when token is empty', async () => {
        await act(async () => { await renderPanel({ detected: 'GitHub' }); });
        expect(screen.getByTestId('save-button')).toBeDisabled();
    });

    it('is enabled when token is non-empty', async () => {
        await act(async () => { await renderPanel({ detected: 'GitHub' }); });
        fireEvent.change(screen.getByTestId('token-input'), { target: { value: 'ghp_abc123' } });
        expect(screen.getByTestId('save-button')).not.toBeDisabled();
    });
});

// ── Successful save ────────────────────────────────────────────────────────────

describe('successful save', () => {
    it('calls PUT /api/providers/config with GitHub payload', async () => {
        global.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) } as any);
        const { onConfigured } = await act(async () => renderPanel({ detected: 'GitHub' }));

        fireEvent.change(screen.getByTestId('token-input'), { target: { value: 'ghp_tok' } });
        await act(async () => { fireEvent.click(screen.getByTestId('save-button')); });

        await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
            '/providers/config',
            expect.objectContaining({
                method: 'PUT',
                body: JSON.stringify({ github: { token: 'ghp_tok' } }),
            }),
        ));
    });

    it('calls PUT /api/providers/config with ADO payload', async () => {
        global.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) } as any);
        await act(async () => { await renderPanel({ detected: 'ADO' }); });

        fireEvent.change(screen.getByTestId('org-url-input'), { target: { value: 'https://dev.azure.com/myorg' } });
        fireEvent.change(screen.getByTestId('token-input'), { target: { value: 'my-pat' } });
        await act(async () => { fireEvent.click(screen.getByTestId('save-button')); });

        await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
            '/providers/config',
            expect.objectContaining({
                method: 'PUT',
                body: JSON.stringify({ ado: { token: 'my-pat', orgUrl: 'https://dev.azure.com/myorg' } }),
            }),
        ));
    });

    it('shows success message after save', async () => {
        global.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) } as any);
        await act(async () => { await renderPanel({ detected: 'GitHub' }); });

        fireEvent.change(screen.getByTestId('token-input'), { target: { value: 'ghp_tok' } });
        await act(async () => { fireEvent.click(screen.getByTestId('save-button')); });

        await waitFor(() => expect(screen.getByTestId('save-success')).toBeInTheDocument());
        expect(screen.getByText(/Configured! Loading pull requests/)).toBeInTheDocument();
    });

    it('calls onConfigured after successful save', async () => {
        global.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) } as any);
        const { onConfigured } = await act(async () => renderPanel({ detected: 'GitHub' }));

        fireEvent.change(screen.getByTestId('token-input'), { target: { value: 'ghp_tok' } });
        await act(async () => { fireEvent.click(screen.getByTestId('save-button')); });

        await waitFor(() => expect(screen.getByTestId('save-success')).toBeInTheDocument());
        // onConfigured fires after 800 ms flash
        await waitFor(() => expect(onConfigured).toHaveBeenCalledOnce(), { timeout: 2000 });
    }, 5000);
});

// ── Failed save ────────────────────────────────────────────────────────────────

describe('failed save', () => {
    it('displays inline error message on failed save', async () => {
        global.fetch = vi.fn().mockResolvedValue({
            ok: false,
            status: 400,
            statusText: 'Bad Request',
        } as any);
        await act(async () => { await renderPanel({ detected: 'GitHub' }); });

        fireEvent.change(screen.getByTestId('token-input'), { target: { value: 'bad-token' } });
        await act(async () => { fireEvent.click(screen.getByTestId('save-button')); });

        await waitFor(() => expect(screen.getByTestId('save-error')).toBeInTheDocument());
        expect(screen.getByText(/Error:/)).toBeInTheDocument();
    });

    it('does not call onConfigured on failed save', async () => {
        global.fetch = vi.fn().mockResolvedValue({
            ok: false,
            status: 401,
            statusText: 'Unauthorized',
        } as any);
        const { onConfigured } = await act(async () => renderPanel({ detected: 'GitHub' }));

        fireEvent.change(screen.getByTestId('token-input'), { target: { value: 'bad-token' } });
        await act(async () => { fireEvent.click(screen.getByTestId('save-button')); });

        await waitFor(() => expect(screen.getByTestId('save-error')).toBeInTheDocument());
        expect(onConfigured).not.toHaveBeenCalled();
    });
});

// ── Token show/hide toggle ─────────────────────────────────────────────────────

describe('token show/hide toggle', () => {
    it('token input defaults to type=password', async () => {
        await act(async () => { await renderPanel({ detected: 'GitHub' }); });
        expect(screen.getByTestId('token-input')).toHaveAttribute('type', 'password');
    });

    it('toggles token visibility when eye button is clicked', async () => {
        await act(async () => { await renderPanel({ detected: 'GitHub' }); });
        const toggle = screen.getByTestId('toggle-token-visibility');
        fireEvent.click(toggle);
        expect(screen.getByTestId('token-input')).toHaveAttribute('type', 'text');
        fireEvent.click(toggle);
        expect(screen.getByTestId('token-input')).toHaveAttribute('type', 'password');
    });
});

// ── Storage note ──────────────────────────────────────────────────────────────

describe('storage note', () => {
    it('shows providers.json storage note', async () => {
        await act(async () => { await renderPanel({ detected: 'GitHub' }); });
        expect(screen.getByText(/~\/.coc\/providers\.json/)).toBeInTheDocument();
    });
});
