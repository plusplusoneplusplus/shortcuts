/**
 * Tests for ProviderTokensSection component.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';

// Mock getApiBase so fetch URLs are predictable.
vi.mock('../../../../src/server/spa/client/react/utils/config', () => ({
    getApiBase: () => '',
}));

const onError = vi.fn();
const onSuccess = vi.fn();

async function renderSection() {
    const { ProviderTokensSection } = await import(
        '../../../../src/server/spa/client/react/admin/ProviderTokensSection'
    );
    return render(<ProviderTokensSection onError={onError} onSuccess={onSuccess} />);
}

beforeEach(() => {
    vi.resetModules();
    vi.resetAllMocks();
    onError.mockReset();
    onSuccess.mockReset();
});

// ── Initial load ────────────────────────────────────────────────────────────────

describe('initial load', () => {
    it('shows masked placeholder text when GitHub token exists', async () => {
        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({
                providers: { github: { token: '****' } },
            }),
        } as any);

        await act(async () => { await renderSection(); });

        await waitFor(() => {
            expect(screen.getByTestId('github-token-saved')).toBeInTheDocument();
        });
        expect(screen.getByText(/A token is already saved/)).toBeInTheDocument();
    });

    it('shows masked placeholder when ADO token exists', async () => {
        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({
                providers: { ado: { token: '****', orgUrl: 'https://dev.azure.com/myorg' } },
            }),
        } as any);

        await act(async () => { await renderSection(); });

        await waitFor(() => {
            expect(screen.getByTestId('ado-token-saved')).toBeInTheDocument();
        });
    });

    it('does NOT show masked placeholder when no GitHub token saved', async () => {
        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ providers: {} }),
        } as any);

        await act(async () => { await renderSection(); });

        await waitFor(() => {
            expect(screen.queryByTestId('github-token-saved')).not.toBeInTheDocument();
        });
    });

    it('pre-fills ADO org URL from saved config', async () => {
        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({
                providers: { ado: { token: '****', orgUrl: 'https://dev.azure.com/myorg' } },
            }),
        } as any);

        await act(async () => { await renderSection(); });

        await waitFor(() => {
            const input = screen.getByTestId('ado-org-url-input') as HTMLInputElement;
            expect(input.placeholder).toBe('https://dev.azure.com/myorg');
        });
    });

    it('calls onError when load fails', async () => {
        global.fetch = vi.fn().mockResolvedValue({ ok: false, json: () => Promise.resolve({}) } as any);

        await act(async () => { await renderSection(); });

        await waitFor(() => expect(onError).toHaveBeenCalled());
    });
});

// ── GitHub save ─────────────────────────────────────────────────────────────────

describe('GitHub save', () => {
    it('calls PUT /providers/config with correct GitHub body', async () => {
        global.fetch = vi.fn()
            .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ providers: {} }) } as any)
            .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) } as any);

        await act(async () => { await renderSection(); });

        fireEvent.change(screen.getByTestId('github-token-input'), { target: { value: 'ghp_newtoken' } });
        await act(async () => { fireEvent.click(screen.getByTestId('github-save-button')); });

        await waitFor(() => {
            const calls = (global.fetch as any).mock.calls;
            const putCall = calls.find(([_url, opts]: [string, any]) => opts?.method === 'PUT');
            expect(putCall).toBeDefined();
            const body = JSON.parse(putCall[1].body);
            expect(body).toEqual({ github: { token: 'ghp_newtoken' } });
        });
    });

    it('shows success message after GitHub save', async () => {
        global.fetch = vi.fn()
            .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ providers: {} }) } as any)
            .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) } as any);

        await act(async () => { await renderSection(); });

        fireEvent.change(screen.getByTestId('github-token-input'), { target: { value: 'ghp_tok' } });
        await act(async () => { fireEvent.click(screen.getByTestId('github-save-button')); });

        await waitFor(() => expect(screen.getByTestId('github-save-success')).toBeInTheDocument());
        expect(onSuccess).toHaveBeenCalledWith('GitHub token saved');
    });

    it('clears input after successful GitHub save', async () => {
        global.fetch = vi.fn()
            .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ providers: {} }) } as any)
            .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) } as any);

        await act(async () => { await renderSection(); });

        fireEvent.change(screen.getByTestId('github-token-input'), { target: { value: 'ghp_tok' } });
        await act(async () => { fireEvent.click(screen.getByTestId('github-save-button')); });

        await waitFor(() => {
            const input = screen.getByTestId('github-token-input') as HTMLInputElement;
            expect(input.value).toBe('');
        });
    });

    it('shows error message when GitHub save fails', async () => {
        global.fetch = vi.fn()
            .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ providers: {} }) } as any)
            .mockResolvedValueOnce({ ok: false, status: 400, statusText: 'Bad Request', json: () => Promise.resolve({ error: 'Invalid token' }) } as any);

        await act(async () => { await renderSection(); });

        fireEvent.change(screen.getByTestId('github-token-input'), { target: { value: 'bad' } });
        await act(async () => { fireEvent.click(screen.getByTestId('github-save-button')); });

        await waitFor(() => expect(screen.getByTestId('github-save-error')).toBeInTheDocument());
        expect(screen.getByText(/Invalid token/)).toBeInTheDocument();
    });

    it('GitHub save button is disabled when token is empty', async () => {
        global.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ providers: {} }) } as any);

        await act(async () => { await renderSection(); });

        expect(screen.getByTestId('github-save-button')).toBeDisabled();
    });
});

// ── ADO save ────────────────────────────────────────────────────────────────────

describe('ADO save', () => {
    it('calls PUT /providers/config with correct ADO body', async () => {
        global.fetch = vi.fn()
            .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ providers: {} }) } as any)
            .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) } as any);

        await act(async () => { await renderSection(); });

        fireEvent.change(screen.getByTestId('ado-org-url-input'), { target: { value: 'https://dev.azure.com/myorg' } });
        fireEvent.change(screen.getByTestId('ado-token-input'), { target: { value: 'my-pat' } });
        await act(async () => { fireEvent.click(screen.getByTestId('ado-save-button')); });

        await waitFor(() => {
            const calls = (global.fetch as any).mock.calls;
            const putCall = calls.find(([_url, opts]: [string, any]) => opts?.method === 'PUT');
            expect(putCall).toBeDefined();
            const body = JSON.parse(putCall[1].body);
            expect(body).toEqual({ ado: { token: 'my-pat', orgUrl: 'https://dev.azure.com/myorg' } });
        });
    });

    it('shows success message after ADO save', async () => {
        global.fetch = vi.fn()
            .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ providers: {} }) } as any)
            .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) } as any);

        await act(async () => { await renderSection(); });

        fireEvent.change(screen.getByTestId('ado-org-url-input'), { target: { value: 'https://dev.azure.com/myorg' } });
        fireEvent.change(screen.getByTestId('ado-token-input'), { target: { value: 'my-pat' } });
        await act(async () => { fireEvent.click(screen.getByTestId('ado-save-button')); });

        await waitFor(() => expect(screen.getByTestId('ado-save-success')).toBeInTheDocument());
        expect(onSuccess).toHaveBeenCalledWith('ADO token saved');
    });

    it('shows error message when ADO save fails', async () => {
        global.fetch = vi.fn()
            .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ providers: {} }) } as any)
            .mockResolvedValueOnce({ ok: false, status: 400, statusText: 'Bad Request', json: () => Promise.resolve({ error: 'Bad org URL' }) } as any);

        await act(async () => { await renderSection(); });

        fireEvent.change(screen.getByTestId('ado-org-url-input'), { target: { value: 'https://dev.azure.com/myorg' } });
        fireEvent.change(screen.getByTestId('ado-token-input'), { target: { value: 'my-pat' } });
        await act(async () => { fireEvent.click(screen.getByTestId('ado-save-button')); });

        await waitFor(() => expect(screen.getByTestId('ado-save-error')).toBeInTheDocument());
        expect(screen.getByText(/Bad org URL/)).toBeInTheDocument();
    });

    it('ADO save button is disabled when token is empty', async () => {
        global.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ providers: {} }) } as any);

        await act(async () => { await renderSection(); });

        fireEvent.change(screen.getByTestId('ado-org-url-input'), { target: { value: 'https://dev.azure.com/myorg' } });
        expect(screen.getByTestId('ado-save-button')).toBeDisabled();
    });

    it('ADO save button is disabled when org URL is empty', async () => {
        global.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ providers: {} }) } as any);

        await act(async () => { await renderSection(); });

        fireEvent.change(screen.getByTestId('ado-token-input'), { target: { value: 'my-pat' } });
        expect(screen.getByTestId('ado-save-button')).toBeDisabled();
    });
});

// ── Token visibility toggle ─────────────────────────────────────────────────────

describe('token visibility toggle', () => {
    beforeEach(async () => {
        global.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ providers: {} }) } as any);
    });

    it('GitHub token input defaults to type=password', async () => {
        await act(async () => { await renderSection(); });
        expect(screen.getByTestId('github-token-input')).toHaveAttribute('type', 'password');
    });

    it('toggles GitHub token visibility', async () => {
        await act(async () => { await renderSection(); });
        const toggle = screen.getByTestId('github-toggle-visibility');
        fireEvent.click(toggle);
        expect(screen.getByTestId('github-token-input')).toHaveAttribute('type', 'text');
        fireEvent.click(toggle);
        expect(screen.getByTestId('github-token-input')).toHaveAttribute('type', 'password');
    });

    it('ADO token input defaults to type=password', async () => {
        await act(async () => { await renderSection(); });
        expect(screen.getByTestId('ado-token-input')).toHaveAttribute('type', 'password');
    });

    it('toggles ADO token visibility', async () => {
        await act(async () => { await renderSection(); });
        const toggle = screen.getByTestId('ado-toggle-visibility');
        fireEvent.click(toggle);
        expect(screen.getByTestId('ado-token-input')).toHaveAttribute('type', 'text');
        fireEvent.click(toggle);
        expect(screen.getByTestId('ado-token-input')).toHaveAttribute('type', 'password');
    });
});
