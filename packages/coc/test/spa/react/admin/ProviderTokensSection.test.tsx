/**
 * Tests for ProviderTokensSection component.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
    request: vi.fn(),
}));

vi.mock('../../../../src/server/spa/client/react/api/cocClient', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../../src/server/spa/client/react/api/cocClient')>();
    return {
        ...actual,
        getSpaCocClient: () => ({ request: mocks.request }),
    };
});

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
    it('shows "already saved" message when GitHub hasToken is true', async () => {
        mocks.request.mockResolvedValue({
            providers: { github: { hasToken: true } },
        });

        await act(async () => { await renderSection(); });

        await waitFor(() => {
            expect(screen.getByTestId('github-token-saved')).toBeInTheDocument();
        });
        expect(screen.getByText(/A token is already saved/)).toBeInTheDocument();
    });

    it('does NOT show "already saved" message when GitHub hasToken is false', async () => {
        mocks.request.mockResolvedValue({
            providers: { github: { hasToken: false } },
        });

        await act(async () => { await renderSection(); });

        await waitFor(() => {
            expect(screen.queryByTestId('github-token-saved')).not.toBeInTheDocument();
        });
    });

    it('does NOT show "already saved" message when no GitHub entry in providers', async () => {
        mocks.request.mockResolvedValue({ providers: {} });

        await act(async () => { await renderSection(); });

        await waitFor(() => {
            expect(screen.queryByTestId('github-token-saved')).not.toBeInTheDocument();
        });
    });

    it('pre-fills ADO org URL from saved config', async () => {
        mocks.request.mockResolvedValue({
            providers: { ado: { orgUrl: 'https://dev.azure.com/myorg' } },
        });

        await act(async () => { await renderSection(); });

        await waitFor(() => {
            const input = screen.getByTestId('ado-org-url-input') as HTMLInputElement;
            expect(input.placeholder).toBe('https://dev.azure.com/myorg');
        });
    });

    it('calls onError when load fails', async () => {
        mocks.request.mockRejectedValue(new Error('Failed to load provider config'));

        await act(async () => { await renderSection(); });

        await waitFor(() => expect(onError).toHaveBeenCalled());
    });

    it('does NOT render ADO PAT input field', async () => {
        mocks.request.mockResolvedValue({ providers: {} });

        await act(async () => { await renderSection(); });

        await waitFor(() => {
            expect(screen.queryByTestId('ado-token-input')).not.toBeInTheDocument();
        });
    });

    it('does NOT render ADO token visibility toggle', async () => {
        mocks.request.mockResolvedValue({ providers: {} });

        await act(async () => { await renderSection(); });

        await waitFor(() => {
            expect(screen.queryByTestId('ado-toggle-visibility')).not.toBeInTheDocument();
        });
    });
});

// ── GitHub save ─────────────────────────────────────────────────────────────────

describe('GitHub save', () => {
    it('calls PUT /providers/config with correct GitHub body', async () => {
        mocks.request
            .mockResolvedValueOnce({ providers: {} })
            .mockResolvedValueOnce(undefined);

        await act(async () => { await renderSection(); });

        fireEvent.change(screen.getByTestId('github-token-input'), { target: { value: 'ghp_newtoken' } });
        await act(async () => { fireEvent.click(screen.getByTestId('github-save-button')); });

        await waitFor(() => {
            const putCall = mocks.request.mock.calls.find(
                (args: unknown[]) => (args[1] as any)?.method === 'PUT'
            );
            expect(putCall).toBeDefined();
            expect(putCall![1]).toEqual(expect.objectContaining({
                method: 'PUT',
                body: { github: { token: 'ghp_newtoken' } },
            }));
        });
    });

    it('shows success message after GitHub save', async () => {
        mocks.request
            .mockResolvedValueOnce({ providers: {} })
            .mockResolvedValueOnce(undefined);

        await act(async () => { await renderSection(); });

        fireEvent.change(screen.getByTestId('github-token-input'), { target: { value: 'ghp_tok' } });
        await act(async () => { fireEvent.click(screen.getByTestId('github-save-button')); });

        await waitFor(() => expect(screen.getByTestId('github-save-success')).toBeInTheDocument());
        expect(onSuccess).toHaveBeenCalledWith('GitHub token saved');
    });

    it('sets hasGithubToken true after successful GitHub save', async () => {
        mocks.request
            .mockResolvedValueOnce({ providers: {} })
            .mockResolvedValueOnce(undefined);

        await act(async () => { await renderSection(); });

        // No "already saved" before save
        expect(screen.queryByTestId('github-token-saved')).not.toBeInTheDocument();

        fireEvent.change(screen.getByTestId('github-token-input'), { target: { value: 'ghp_tok' } });
        await act(async () => { fireEvent.click(screen.getByTestId('github-save-button')); });

        // "already saved" should now appear
        await waitFor(() => expect(screen.getByTestId('github-token-saved')).toBeInTheDocument());
    });

    it('clears input after successful GitHub save', async () => {
        mocks.request
            .mockResolvedValueOnce({ providers: {} })
            .mockResolvedValueOnce(undefined);

        await act(async () => { await renderSection(); });

        fireEvent.change(screen.getByTestId('github-token-input'), { target: { value: 'ghp_tok' } });
        await act(async () => { fireEvent.click(screen.getByTestId('github-save-button')); });

        await waitFor(() => {
            const input = screen.getByTestId('github-token-input') as HTMLInputElement;
            expect(input.value).toBe('');
        });
    });

    it('shows error message when GitHub save fails', async () => {
        mocks.request
            .mockResolvedValueOnce({ providers: {} })
            .mockRejectedValueOnce(new Error('Invalid token'));

        await act(async () => { await renderSection(); });

        fireEvent.change(screen.getByTestId('github-token-input'), { target: { value: 'bad' } });
        await act(async () => { fireEvent.click(screen.getByTestId('github-save-button')); });

        await waitFor(() => expect(screen.getByTestId('github-save-error')).toBeInTheDocument());
        expect(screen.getByText(/Invalid token/)).toBeInTheDocument();
    });

    it('GitHub save button is disabled when token is empty', async () => {
        mocks.request.mockResolvedValue({ providers: {} });

        await act(async () => { await renderSection(); });

        expect(screen.getByTestId('github-save-button')).toBeDisabled();
    });
});

// ── ADO save (org URL only — PAT removed) ───────────────────────────────────────

describe('ADO save', () => {
    it('calls PUT /providers/config with orgUrl only (no token)', async () => {
        mocks.request
            .mockResolvedValueOnce({ providers: {} })
            .mockResolvedValueOnce(undefined);

        await act(async () => { await renderSection(); });

        fireEvent.change(screen.getByTestId('ado-org-url-input'), { target: { value: 'https://dev.azure.com/myorg' } });
        await act(async () => { fireEvent.click(screen.getByTestId('ado-save-button')); });

        await waitFor(() => {
            const putCall = mocks.request.mock.calls.find(
                (args: unknown[]) => (args[1] as any)?.method === 'PUT'
            );
            expect(putCall).toBeDefined();
            const body = (putCall![1] as any).body;
            expect(body).toEqual({ ado: { orgUrl: 'https://dev.azure.com/myorg' } });
            expect(body.ado.token).toBeUndefined();
        });
    });

    it('shows success message after ADO org URL save', async () => {
        mocks.request
            .mockResolvedValueOnce({ providers: {} })
            .mockResolvedValueOnce(undefined);

        await act(async () => { await renderSection(); });

        fireEvent.change(screen.getByTestId('ado-org-url-input'), { target: { value: 'https://dev.azure.com/myorg' } });
        await act(async () => { fireEvent.click(screen.getByTestId('ado-save-button')); });

        await waitFor(() => expect(screen.getByTestId('ado-save-success')).toBeInTheDocument());
        expect(onSuccess).toHaveBeenCalledWith('ADO settings saved');
    });

    it('shows error message when ADO save fails', async () => {
        mocks.request
            .mockResolvedValueOnce({ providers: {} })
            .mockRejectedValueOnce(new Error('Bad org URL'));

        await act(async () => { await renderSection(); });

        fireEvent.change(screen.getByTestId('ado-org-url-input'), { target: { value: 'https://dev.azure.com/myorg' } });
        await act(async () => { fireEvent.click(screen.getByTestId('ado-save-button')); });

        await waitFor(() => expect(screen.getByTestId('ado-save-error')).toBeInTheDocument());
        expect(screen.getByText(/Bad org URL/)).toBeInTheDocument();
    });

    it('ADO save button is disabled when org URL is empty', async () => {
        mocks.request.mockResolvedValue({ providers: {} });

        await act(async () => { await renderSection(); });

        expect(screen.getByTestId('ado-save-button')).toBeDisabled();
    });
});

// ── Token visibility toggle ─────────────────────────────────────────────────────

describe('token visibility toggle', () => {
    beforeEach(async () => {
        mocks.request.mockResolvedValue({ providers: {} });
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
});

