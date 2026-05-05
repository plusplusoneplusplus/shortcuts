import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { AddServerDialog } from '../../../../../src/server/spa/client/react/features/servers/AddServerDialog';

const registryMocks = vi.hoisted(() => ({
    testRemoteServer: vi.fn(),
}));

vi.mock('../../../../../src/server/spa/client/react/utils/serverRegistry', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../../../src/server/spa/client/react/utils/serverRegistry')>();
    return {
        ...actual,
        testRemoteServer: registryMocks.testRemoteServer,
    };
});

vi.mock('react-dom', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-dom')>();
    return { ...actual, createPortal: (children: React.ReactNode) => children };
});

vi.mock('../../../../../src/server/spa/client/react/hooks/ui/useBreakpoint', () => ({
    useBreakpoint: () => ({ isMobile: false }),
}));

describe('AddServerDialog', () => {
    beforeEach(() => {
        registryMocks.testRemoteServer.mockResolvedValue({
            serverId: 'test',
            kind: 'url',
            status: 'online',
            version: '1.2.3',
            serverName: 'box-a',
            lastChecked: 1,
        });
    });

    afterEach(() => {
        cleanup();
        vi.useRealTimers();
        vi.restoreAllMocks();
        registryMocks.testRemoteServer.mockReset();
    });

    it('renders nothing when open=false', () => {
        const { container } = render(
            <AddServerDialog open={false} onClose={() => {}} onAdd={() => {}} />
        );
        expect(container.querySelector('[data-testid="add-server-url-input"]')).toBeNull();
    });

    it('renders connection type, URL, and Label inputs when open', () => {
        render(<AddServerDialog open={true} onClose={() => {}} onAdd={() => {}} />);
        expect(screen.getByTestId('add-server-kind-url')).toBeTruthy();
        expect(screen.getByTestId('add-server-kind-devtunnel')).toBeTruthy();
        expect(screen.getByTestId('add-server-url-input')).toBeTruthy();
        expect(screen.getByTestId('add-server-label-input')).toBeTruthy();
        expect(screen.getByTestId('add-server-submit-btn')).toBeTruthy();
        expect(screen.getByTestId('add-server-cancel-btn')).toBeTruthy();
    });

    it('disables Add Server button when the active endpoint field is empty', () => {
        render(<AddServerDialog open={true} onClose={() => {}} onAdd={() => {}} />);
        expect((screen.getByTestId('add-server-submit-btn') as HTMLButtonElement).disabled).toBe(true);
        fireEvent.click(screen.getByTestId('add-server-kind-devtunnel'));
        expect((screen.getByTestId('add-server-submit-btn') as HTMLButtonElement).disabled).toBe(true);
    });

    it('enables Add Server button when URL is non-empty', () => {
        render(<AddServerDialog open={true} onClose={() => {}} onAdd={() => {}} />);
        fireEvent.change(screen.getByTestId('add-server-url-input'), { target: { value: 'https://x.example.com' } });
        expect((screen.getByTestId('add-server-submit-btn') as HTMLButtonElement).disabled).toBe(false);
    });

    it('shows "Testing" indicator immediately while debounce is pending', () => {
        vi.useFakeTimers();
        render(<AddServerDialog open={true} onClose={() => {}} onAdd={() => {}} />);
        fireEvent.change(screen.getByTestId('add-server-url-input'), { target: { value: 'https://x.example.com' } });
        expect(screen.getByTestId('add-server-test-indicator').textContent).toContain('Testing');
    });

    it('tests Direct URL entries through /api/servers/test client', async () => {
        vi.useFakeTimers();
        render(<AddServerDialog open={true} onClose={() => {}} onAdd={() => {}} />);
        fireEvent.change(screen.getByTestId('add-server-url-input'), {
            target: { value: 'https://x.example.com/' },
        });

        await act(async () => {
            await vi.advanceTimersByTimeAsync(700);
        });

        expect(registryMocks.testRemoteServer).toHaveBeenCalledWith({
            kind: 'url',
            label: 'https://x.example.com',
            url: 'https://x.example.com',
        });
        expect(screen.getByTestId('add-server-test-indicator').textContent).toMatch(/CoC @ box-a/);
        expect(screen.getByTestId('add-server-test-indicator').textContent).toMatch(/v1\.2\.3/);
    });

    it('supports DevTunnel ID mode and displays the resolved local port', async () => {
        vi.useFakeTimers();
        registryMocks.testRemoteServer.mockResolvedValue({
            serverId: 'test',
            kind: 'devtunnel',
            status: 'online',
            tunnelId: 'my-remote-coc',
            localPort: 4000,
            lastChecked: 1,
        });
        render(<AddServerDialog open={true} onClose={() => {}} onAdd={() => {}} />);
        fireEvent.click(screen.getByTestId('add-server-kind-devtunnel'));
        fireEvent.change(screen.getByTestId('add-server-tunnel-id-input'), {
            target: { value: 'my-remote-coc' },
        });

        expect(screen.getByTestId('add-server-test-indicator').textContent).toContain('Connecting tunnel');
        await act(async () => {
            await vi.advanceTimersByTimeAsync(700);
        });

        expect(registryMocks.testRemoteServer).toHaveBeenCalledWith({
            kind: 'devtunnel',
            label: 'my-remote-coc',
            tunnelId: 'my-remote-coc',
        });
        expect(screen.getByTestId('add-server-test-indicator').textContent).toContain('localhost:4000');
    });

    it('shows red indicator when the connection test fails', async () => {
        vi.useFakeTimers();
        registryMocks.testRemoteServer.mockRejectedValue(new Error('network down'));
        render(<AddServerDialog open={true} onClose={() => {}} onAdd={() => {}} />);
        fireEvent.change(screen.getByTestId('add-server-url-input'), {
            target: { value: 'https://x.example.com' },
        });
        await act(async () => {
            await vi.advanceTimersByTimeAsync(700);
        });
        expect(screen.getByTestId('add-server-test-indicator').textContent).toContain('🔴');
        expect(screen.getByTestId('add-server-test-indicator').textContent).toContain('network down');
    });

    it('shows red indicator when backend health returns offline', async () => {
        vi.useFakeTimers();
        registryMocks.testRemoteServer.mockResolvedValue({
            serverId: 'test',
            kind: 'url',
            status: 'offline',
            error: 'HTTP 503',
            lastChecked: 1,
        });
        render(<AddServerDialog open={true} onClose={() => {}} onAdd={() => {}} />);
        fireEvent.change(screen.getByTestId('add-server-url-input'), {
            target: { value: 'https://x.example.com' },
        });
        await act(async () => {
            await vi.advanceTimersByTimeAsync(700);
        });
        expect(screen.getByTestId('add-server-test-indicator').textContent).toContain('🔴');
        expect(screen.getByTestId('add-server-test-indicator').textContent).toContain('HTTP 503');
    });

    it('debounces and does not test immediately on every keystroke', async () => {
        vi.useFakeTimers();
        render(<AddServerDialog open={true} onClose={() => {}} onAdd={() => {}} />);
        const url = screen.getByTestId('add-server-url-input') as HTMLInputElement;
        fireEvent.change(url, { target: { value: 'h' } });
        fireEvent.change(url, { target: { value: 'ht' } });
        fireEvent.change(url, { target: { value: 'http://a' } });
        await act(async () => {
            await vi.advanceTimersByTimeAsync(100);
        });
        expect(registryMocks.testRemoteServer).not.toHaveBeenCalled();
        await act(async () => {
            await vi.advanceTimersByTimeAsync(700);
        });
        expect(registryMocks.testRemoteServer).toHaveBeenCalledTimes(1);
    });

    it('submit calls onAdd with trimmed Direct URL and onClose', async () => {
        const onAdd = vi.fn().mockResolvedValue(undefined);
        const onClose = vi.fn();
        render(<AddServerDialog open={true} onClose={onClose} onAdd={onAdd} />);
        fireEvent.change(screen.getByTestId('add-server-url-input'), {
            target: { value: '  https://x.example.com/  ' },
        });
        fireEvent.change(screen.getByTestId('add-server-label-input'), {
            target: { value: '  My Box  ' },
        });
        await act(async () => {
            fireEvent.click(screen.getByTestId('add-server-submit-btn'));
        });
        expect(onAdd).toHaveBeenCalledWith({
            kind: 'url',
            label: 'My Box',
            url: 'https://x.example.com',
        });
        expect(onClose).toHaveBeenCalled();
    });

    it('submit calls onAdd with trimmed DevTunnel ID', async () => {
        const onAdd = vi.fn().mockResolvedValue(undefined);
        render(<AddServerDialog open={true} onClose={() => {}} onAdd={onAdd} />);
        fireEvent.click(screen.getByTestId('add-server-kind-devtunnel'));
        fireEvent.change(screen.getByTestId('add-server-tunnel-id-input'), {
            target: { value: '  my-remote-coc  ' },
        });
        await act(async () => {
            fireEvent.click(screen.getByTestId('add-server-submit-btn'));
        });
        expect(onAdd).toHaveBeenCalledWith({
            kind: 'devtunnel',
            label: 'my-remote-coc',
            tunnelId: 'my-remote-coc',
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
        fireEvent.click(screen.getByTestId('add-server-kind-devtunnel'));
        const tunnel = screen.getByTestId('add-server-tunnel-id-input') as HTMLInputElement;
        fireEvent.change(tunnel, { target: { value: 'my-remote-coc' } });
        expect(tunnel.value).toBe('my-remote-coc');

        rerender(<AddServerDialog open={false} onClose={() => {}} onAdd={() => {}} />);
        rerender(<AddServerDialog open={true} onClose={() => {}} onAdd={() => {}} />);

        expect((screen.getByTestId('add-server-url-input') as HTMLInputElement).value).toBe('');
        expect((screen.getByTestId('add-server-label-input') as HTMLInputElement).value).toBe('');
        expect(screen.queryByTestId('add-server-test-indicator')).toBeNull();
    });
});
