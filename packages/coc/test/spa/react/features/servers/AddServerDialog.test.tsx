/**
 * Tests for AddServerDialog component.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { AddServerDialog } from '../../../../../src/server/spa/client/react/features/servers/AddServerDialog';

// Render Dialog inline (avoid Portal)
vi.mock('react-dom', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-dom')>();
    return { ...actual, createPortal: (children: React.ReactNode) => children };
});

vi.mock('../../../../../src/server/spa/client/react/hooks/ui/useBreakpoint', () => ({
    useBreakpoint: () => ({ isMobile: false }),
}));

function jsonResponse(body: unknown, status = 200): Response {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: () => Promise.resolve(body),
    } as unknown as Response;
}

describe('AddServerDialog', () => {
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        fetchMock = vi.fn().mockResolvedValue(jsonResponse({}));
        vi.stubGlobal('fetch', fetchMock);
    });

    afterEach(() => {
        cleanup();
        vi.unstubAllGlobals();
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('renders nothing when open=false', () => {
        const { container } = render(
            <AddServerDialog open={false} onClose={() => {}} onAdd={() => {}} />
        );
        expect(container.querySelector('[data-testid="add-server-url-input"]')).toBeNull();
    });

    it('renders URL and Label inputs when open', () => {
        render(<AddServerDialog open={true} onClose={() => {}} onAdd={() => {}} />);
        expect(screen.getByTestId('add-server-url-input')).toBeTruthy();
        expect(screen.getByTestId('add-server-label-input')).toBeTruthy();
        expect(screen.getByTestId('add-server-submit-btn')).toBeTruthy();
        expect(screen.getByTestId('add-server-cancel-btn')).toBeTruthy();
    });

    it('disables Add Server button when URL is empty', () => {
        render(<AddServerDialog open={true} onClose={() => {}} onAdd={() => {}} />);
        const submit = screen.getByTestId('add-server-submit-btn') as HTMLButtonElement;
        expect(submit.disabled).toBe(true);
    });

    it('enables Add Server button when URL is non-empty (regardless of test result)', () => {
        render(<AddServerDialog open={true} onClose={() => {}} onAdd={() => {}} />);
        const url = screen.getByTestId('add-server-url-input') as HTMLInputElement;
        fireEvent.change(url, { target: { value: 'https://x.example.com' } });
        const submit = screen.getByTestId('add-server-submit-btn') as HTMLButtonElement;
        expect(submit.disabled).toBe(false);
    });

    it('shows "Testing…" indicator immediately while debounce is pending', () => {
        vi.useFakeTimers();
        render(<AddServerDialog open={true} onClose={() => {}} onAdd={() => {}} />);
        const url = screen.getByTestId('add-server-url-input') as HTMLInputElement;
        fireEvent.change(url, { target: { value: 'https://x.example.com' } });
        const indicator = screen.getByTestId('add-server-test-indicator');
        expect(indicator.textContent).toContain('Testing');
    });

    it('shows green indicator after a successful debounced fetch', async () => {
        vi.useFakeTimers();
        fetchMock.mockImplementation((u: string) => {
            if (u.endsWith('/api/health')) { return Promise.resolve(jsonResponse({ uptime: 1, processCount: 0 })); }
            if (u.endsWith('/api/admin/version')) { return Promise.resolve(jsonResponse({ version: '1.2.3' })); }
            if (u.endsWith('/api/admin/config')) { return Promise.resolve(jsonResponse({ hostname: 'box-a' })); }
            return Promise.resolve(jsonResponse({}));
        });

        render(<AddServerDialog open={true} onClose={() => {}} onAdd={() => {}} />);
        fireEvent.change(screen.getByTestId('add-server-url-input'), {
            target: { value: 'https://x.example.com' },
        });

        await act(async () => {
            await vi.advanceTimersByTimeAsync(700);
        });

        const indicator = screen.getByTestId('add-server-test-indicator');
        expect(indicator.textContent).toContain('🟢');
        expect(indicator.textContent).toMatch(/CoC @ box-a/);
        expect(indicator.textContent).toMatch(/v1\.2\.3/);
    });

    it('shows red indicator when the connection test fails', async () => {
        vi.useFakeTimers();
        fetchMock.mockRejectedValue(new Error('network down'));
        render(<AddServerDialog open={true} onClose={() => {}} onAdd={() => {}} />);
        fireEvent.change(screen.getByTestId('add-server-url-input'), {
            target: { value: 'https://x.example.com' },
        });
        await act(async () => {
            await vi.advanceTimersByTimeAsync(700);
        });
        const indicator = screen.getByTestId('add-server-test-indicator');
        expect(indicator.textContent).toContain('🔴');
    });

    it('shows red indicator on non-200 health response', async () => {
        vi.useFakeTimers();
        fetchMock.mockImplementation((u: string) => {
            if (u.endsWith('/api/health')) { return Promise.resolve(jsonResponse({}, 500)); }
            if (u.endsWith('/api/admin/version')) { return Promise.resolve(jsonResponse({ version: 'x' })); }
            return Promise.resolve(jsonResponse({}));
        });
        render(<AddServerDialog open={true} onClose={() => {}} onAdd={() => {}} />);
        fireEvent.change(screen.getByTestId('add-server-url-input'), {
            target: { value: 'https://x.example.com' },
        });
        await act(async () => {
            await vi.advanceTimersByTimeAsync(700);
        });
        const indicator = screen.getByTestId('add-server-test-indicator');
        expect(indicator.textContent).toContain('🔴');
    });

    it('debounces — does not fetch immediately on every keystroke', async () => {
        vi.useFakeTimers();
        render(<AddServerDialog open={true} onClose={() => {}} onAdd={() => {}} />);
        const url = screen.getByTestId('add-server-url-input') as HTMLInputElement;
        fireEvent.change(url, { target: { value: 'h' } });
        fireEvent.change(url, { target: { value: 'ht' } });
        fireEvent.change(url, { target: { value: 'http://a' } });
        await act(async () => {
            await vi.advanceTimersByTimeAsync(100);
        });
        expect(fetchMock).not.toHaveBeenCalled();
        await act(async () => {
            await vi.advanceTimersByTimeAsync(700);
        });
        expect(fetchMock).toHaveBeenCalled();
    });

    it('submit calls onAdd with trimmed URL (no trailing slash) and onClose', () => {
        const onAdd = vi.fn();
        const onClose = vi.fn();
        render(<AddServerDialog open={true} onClose={onClose} onAdd={onAdd} />);
        fireEvent.change(screen.getByTestId('add-server-url-input'), {
            target: { value: '  https://x.example.com/  ' },
        });
        fireEvent.change(screen.getByTestId('add-server-label-input'), {
            target: { value: '  My Box  ' },
        });
        fireEvent.click(screen.getByTestId('add-server-submit-btn'));
        expect(onAdd).toHaveBeenCalledWith({
            label: 'My Box',
            url: 'https://x.example.com',
        });
        expect(onClose).toHaveBeenCalled();
    });

    it('submit uses URL as label when label is blank', () => {
        const onAdd = vi.fn();
        render(<AddServerDialog open={true} onClose={() => {}} onAdd={onAdd} />);
        fireEvent.change(screen.getByTestId('add-server-url-input'), {
            target: { value: 'https://x.example.com' },
        });
        fireEvent.click(screen.getByTestId('add-server-submit-btn'));
        expect(onAdd).toHaveBeenCalledWith({
            label: 'https://x.example.com',
            url: 'https://x.example.com',
        });
    });

    it('Cancel button calls onClose without invoking onAdd', () => {
        const onAdd = vi.fn();
        const onClose = vi.fn();
        render(<AddServerDialog open={true} onClose={onClose} onAdd={onAdd} />);
        fireEvent.change(screen.getByTestId('add-server-url-input'), {
            target: { value: 'https://x.example.com' },
        });
        fireEvent.click(screen.getByTestId('add-server-cancel-btn'));
        expect(onAdd).not.toHaveBeenCalled();
        expect(onClose).toHaveBeenCalled();
    });

    it('resets state when closed and re-opened', () => {
        const { rerender } = render(
            <AddServerDialog open={true} onClose={() => {}} onAdd={() => {}} />
        );
        const url = screen.getByTestId('add-server-url-input') as HTMLInputElement;
        fireEvent.change(url, { target: { value: 'https://x.example.com' } });
        expect(url.value).toBe('https://x.example.com');

        rerender(<AddServerDialog open={false} onClose={() => {}} onAdd={() => {}} />);
        rerender(<AddServerDialog open={true} onClose={() => {}} onAdd={() => {}} />);

        const url2 = screen.getByTestId('add-server-url-input') as HTMLInputElement;
        expect(url2.value).toBe('');
        const label2 = screen.getByTestId('add-server-label-input') as HTMLInputElement;
        expect(label2.value).toBe('');
        expect(screen.queryByTestId('add-server-test-indicator')).toBeNull();
    });
});
