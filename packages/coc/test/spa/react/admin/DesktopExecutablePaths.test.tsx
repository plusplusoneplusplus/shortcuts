// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    DesktopExecutablePaths,
    desktopExecutablePathsBridge,
    type DesktopExecutablePathsBridge,
    type ExecutablePathsState,
} from '../../../../src/server/spa/client/react/admin/DesktopExecutablePaths';

const DEFAULTS = ['/opt/homebrew/bin', '/opt/homebrew/sbin', '/usr/local/bin'];

let state: ExecutablePathsState;
let bridge: DesktopExecutablePathsBridge & { set: ReturnType<typeof vi.fn>; get: ReturnType<typeof vi.fn> };

beforeEach(() => {
    state = {
        paths: DEFAULTS, custom: false, defaults: DEFAULTS, platform: 'darwin',
        server: { ownership: 'owned', appliedPaths: DEFAULTS }, restartRequired: false,
    };
    bridge = {
        get: vi.fn(async () => state),
        set: vi.fn(async (paths: string[] | null) => {
            const next = paths ?? DEFAULTS;
            state = { ...state, paths: next, custom: paths !== null, restartRequired: next.join() !== DEFAULTS.join() };
            return { ok: true as const, state };
        }),
    };
});
afterEach(() => { cleanup(); delete (window as any).cocDesktop; vi.restoreAllMocks(); });

describe('DesktopExecutablePaths', () => {
    it('renders nothing outside the desktop app or with an older desktop build', () => {
        expect(desktopExecutablePathsBridge()).toBeUndefined();
        (window as any).cocDesktop = { isDesktop: true };
        expect(desktopExecutablePathsBridge()).toBeUndefined();
        const { container } = render(<DesktopExecutablePaths bridge={undefined} />);
        expect(container.innerHTML).toBe('');
    });

    it('reads the bridge from window.cocDesktop', () => {
        (window as any).cocDesktop = { executablePaths: bridge };
        expect(desktopExecutablePathsBridge()).toBe(bridge);
    });

    it('shows the macOS defaults (including Homebrew) and the owned server state', async () => {
        render(<DesktopExecutablePaths bridge={bridge} />);
        expect(((await screen.findByLabelText('Executable search path 1')) as HTMLInputElement).value).toBe('/opt/homebrew/bin');
        expect(screen.getByText('Started by this app')).toBeTruthy();
        expect(screen.getByText('Default')).toBeTruthy();
        expect(screen.getByText(/macOS defaults\./)).toBeTruthy();
        expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
        expect((screen.getByRole('button', { name: 'Reset to macOS defaults' }) as HTMLButtonElement).disabled).toBe(true);
    });

    it('saves edits through the desktop bridge (not the server) and tells the user to restart', async () => {
        const fetch = vi.spyOn(globalThis, 'fetch');
        render(<DesktopExecutablePaths bridge={bridge} />);
        await screen.findByLabelText('Executable search path 1');
        fireEvent.click(screen.getByRole('button', { name: 'Add folder' }));
        fireEvent.change(screen.getByLabelText('Executable search path 4'), { target: { value: '  ~/bin  ' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));
        await screen.findByText(/Quit and reopen CoC Desktop to apply\. The running server/);
        expect(bridge.set).toHaveBeenCalledExactlyOnceWith([...DEFAULTS, '~/bin']);
        expect(screen.getByTestId('desktop-executable-paths-restart')).toBeTruthy();
        expect(screen.getByText('Custom')).toBeTruthy();
        expect(fetch).not.toHaveBeenCalled();
    });

    it('anchors rejected entries to their rows, skipping blank rows', async () => {
        bridge.set.mockResolvedValueOnce({
            ok: false, reason: 'invalid', message: 'Fix the highlighted paths and save again. The saved paths are unchanged.',
            errors: [{ index: 3, message: 'Use an absolute folder or start with ~.' }],
        });
        render(<DesktopExecutablePaths bridge={bridge} />);
        await screen.findByLabelText('Executable search path 1');
        fireEvent.click(screen.getByRole('button', { name: 'Add folder' }));
        fireEvent.click(screen.getByRole('button', { name: 'Add folder' }));
        fireEvent.change(screen.getByLabelText('Executable search path 5'), { target: { value: 'relative' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));
        await screen.findByText('Use an absolute folder or start with ~.');
        expect(bridge.set).toHaveBeenCalledWith([...DEFAULTS, 'relative']);
        expect(screen.getByLabelText('Executable search path 5').getAttribute('aria-invalid')).toBe('true');
        expect(screen.getByLabelText('Executable search path 4').getAttribute('aria-invalid')).toBeNull();
        expect(screen.getByTestId('desktop-executable-paths-message').textContent).toContain('saved paths are unchanged');
    });

    it('restores OS defaults with null and lets the user remove every folder', async () => {
        state = { ...state, paths: ['/custom'], custom: true, restartRequired: true };
        render(<DesktopExecutablePaths bridge={bridge} />);
        await screen.findByTestId('desktop-executable-paths-restart');
        fireEvent.click(screen.getByRole('button', { name: 'Remove executable search path 1' }));
        expect(screen.getByTestId('desktop-executable-paths-empty')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Reset to macOS defaults' }));
        await waitFor(() => expect(bridge.set).toHaveBeenCalledWith(null));
        await screen.findByText('Saved.');
        expect(((screen.getByLabelText('Executable search path 1')) as HTMLInputElement).value).toBe('/opt/homebrew/bin');
        expect(screen.queryByTestId('desktop-executable-paths-restart')).toBeNull();
    });

    it('explains that an attached external server keeps its own PATH', async () => {
        state = { ...state, server: { ownership: 'external', appliedPaths: null } };
        render(<DesktopExecutablePaths bridge={bridge} />);
        await screen.findByText('External server');
        expect(screen.getByTestId('desktop-executable-paths-ownership').textContent).toContain('keeps its own PATH');
    });

    it('shows a load failure', async () => {
        bridge.get.mockRejectedValueOnce(new Error('Executable search paths require the CoC desktop window.'));
        render(<DesktopExecutablePaths bridge={bridge} />);
        await screen.findByText('Executable search paths require the CoC desktop window.');
    });
});
