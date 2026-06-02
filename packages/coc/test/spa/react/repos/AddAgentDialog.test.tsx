/**
 * Tests for AddAgentDialog — connection type radio, form fields, onAdd wiring.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { AddAgentDialog, EditAgentDialog } from '../../../../src/server/spa/client/react/repos/AddAgentDialog';

function renderDialog(props: Partial<Parameters<typeof AddAgentDialog>[0]> = {}) {
    const onClose = vi.fn();
    const onAdd = vi.fn().mockResolvedValue(undefined);
    render(
        <AddAgentDialog
            open={true}
            onClose={onClose}
            onAdd={onAdd}
            {...props}
        />
    );
    return { onClose, onAdd };
}

function selectKind(kind: 'url' | 'devtunnel' | 'ssh') {
    const radio = screen.getByTestId(`add-agent-kind-${kind}`) as HTMLInputElement;
    fireEvent.click(radio);
}

function urlInput() {
    return screen.queryByTestId('add-agent-url-input') as HTMLInputElement | null;
}

function devtunnelUrlInput() {
    return screen.queryByTestId('add-agent-devtunnel-url-input') as HTMLInputElement | null;
}

function tunnelIdInput() {
    return screen.queryByTestId('add-agent-tunnel-id-input') as HTMLInputElement | null;
}

function sshHostInput() {
    return screen.queryByTestId('add-agent-ssh-host-input') as HTMLInputElement | null;
}

function sshPortInput() {
    return screen.queryByTestId('add-agent-ssh-port-input') as HTMLInputElement | null;
}

function nameInput() {
    return screen.getByTestId('add-agent-name-input') as HTMLInputElement;
}

function submitButton() {
    return screen.getByTestId('add-agent-submit') as HTMLButtonElement;
}

describe('AddAgentDialog — initial render', () => {
    it('defaults to Direct URL kind and shows the URL input', () => {
        renderDialog();
        expect(urlInput()).toBeTruthy();
        expect(devtunnelUrlInput()).toBeNull();
        expect(sshHostInput()).toBeNull();
    });

    it('shows name input regardless of kind', () => {
        renderDialog();
        expect(nameInput()).toBeTruthy();
    });

    it('does not render when open=false', () => {
        render(
            <AddAgentDialog open={false} onClose={vi.fn()} onAdd={vi.fn().mockResolvedValue(undefined)} />
        );
        expect(screen.queryByTestId('add-agent-url-input')).toBeNull();
    });
});

describe('AddAgentDialog — connection type switching', () => {
    it('shows DevTunnel URL + Tunnel ID fields when devtunnel is selected', () => {
        renderDialog();
        selectKind('devtunnel');
        expect(devtunnelUrlInput()).toBeTruthy();
        expect(tunnelIdInput()).toBeTruthy();
        expect(urlInput()).toBeNull();
        expect(sshHostInput()).toBeNull();
    });

    it('shows SSH Host + Port fields when ssh is selected', () => {
        renderDialog();
        selectKind('ssh');
        expect(sshHostInput()).toBeTruthy();
        expect(sshPortInput()).toBeTruthy();
        expect(urlInput()).toBeNull();
        expect(devtunnelUrlInput()).toBeNull();
    });

    it('switches back to URL fields when url is reselected', () => {
        renderDialog();
        selectKind('ssh');
        expect(sshHostInput()).toBeTruthy();
        selectKind('url');
        expect(urlInput()).toBeTruthy();
        expect(sshHostInput()).toBeNull();
    });
});

describe('AddAgentDialog — onAdd callback', () => {
    beforeEach(() => vi.clearAllMocks());

    it('calls onAdd with trimmed address for Direct URL kind', async () => {
        const { onAdd } = renderDialog();
        fireEvent.change(urlInput()!, { target: { value: '  http://localhost:4000  ' } });
        await act(async () => { fireEvent.submit(urlInput()!.closest('form')!); });
        await waitFor(() => expect(onAdd).toHaveBeenCalledWith('http://localhost:4000', undefined, undefined));
    });

    it('calls onAdd with name when name field is filled', async () => {
        const { onAdd } = renderDialog();
        fireEvent.change(urlInput()!, { target: { value: 'http://localhost:4000' } });
        fireEvent.change(nameInput(), { target: { value: 'My Agent' } });
        await act(async () => { fireEvent.submit(urlInput()!.closest('form')!); });
        await waitFor(() => expect(onAdd).toHaveBeenCalledWith('http://localhost:4000', 'My Agent', undefined));
    });

    it('calls onAdd with tunnelId for DevTunnel kind', async () => {
        const { onAdd } = renderDialog();
        selectKind('devtunnel');
        fireEvent.change(devtunnelUrlInput()!, { target: { value: 'https://my-tunnel.devtunnels.ms' } });
        fireEvent.change(tunnelIdInput()!, { target: { value: 'amusing-book-s4hcgw2.usw2' } });
        await act(async () => { fireEvent.submit(devtunnelUrlInput()!.closest('form')!); });
        await waitFor(() =>
            expect(onAdd).toHaveBeenCalledWith(
                'https://my-tunnel.devtunnels.ms',
                undefined,
                'amusing-book-s4hcgw2.usw2',
            )
        );
    });

    it('passes undefined tunnelId when tunnel field is empty for DevTunnel kind', async () => {
        const { onAdd } = renderDialog();
        selectKind('devtunnel');
        fireEvent.change(devtunnelUrlInput()!, { target: { value: 'https://my-tunnel.devtunnels.ms' } });
        await act(async () => { fireEvent.submit(devtunnelUrlInput()!.closest('form')!); });
        await waitFor(() =>
            expect(onAdd).toHaveBeenCalledWith('https://my-tunnel.devtunnels.ms', undefined, undefined)
        );
    });

    it('calls onAdd with ssh:// address for SSH kind', async () => {
        const { onAdd } = renderDialog();
        selectKind('ssh');
        fireEvent.change(sshHostInput()!, { target: { value: 'ubuntu-arm' } });
        fireEvent.change(sshPortInput()!, { target: { value: '4000' } });
        await act(async () => { fireEvent.submit(sshHostInput()!.closest('form')!); });
        await waitFor(() =>
            expect(onAdd).toHaveBeenCalledWith('ssh://ubuntu-arm:4000', undefined, undefined)
        );
    });
});

describe('AddAgentDialog — error handling', () => {
    it('shows error message when onAdd rejects', async () => {
        const onAdd = vi.fn().mockRejectedValue(new Error('Connection refused'));
        render(<AddAgentDialog open={true} onClose={vi.fn()} onAdd={onAdd} />);
        fireEvent.change(urlInput()!, { target: { value: 'http://localhost:4000' } });
        await act(async () => { fireEvent.submit(urlInput()!.closest('form')!); });
        await waitFor(() => expect(screen.getByTestId('add-agent-error').textContent).toBe('Connection refused'));
    });
});

describe('AddAgentDialog — submit button state', () => {
    it('disables submit when URL address is empty', () => {
        renderDialog();
        expect(submitButton().disabled).toBe(true);
    });

    it('enables submit when URL address has content', () => {
        renderDialog();
        fireEvent.change(urlInput()!, { target: { value: 'http://localhost:4000' } });
        expect(submitButton().disabled).toBe(false);
    });

    it('disables submit when SSH host is empty', () => {
        renderDialog();
        selectKind('ssh');
        fireEvent.change(sshPortInput()!, { target: { value: '4000' } });
        expect(submitButton().disabled).toBe(true);
    });

    it('disables submit when SSH port is invalid', () => {
        renderDialog();
        selectKind('ssh');
        fireEvent.change(sshHostInput()!, { target: { value: 'my-host' } });
        fireEvent.change(sshPortInput()!, { target: { value: '0' } });
        expect(submitButton().disabled).toBe(true);
    });

    it('enables submit when SSH host and port are valid', () => {
        renderDialog();
        selectKind('ssh');
        fireEvent.change(sshHostInput()!, { target: { value: 'my-host' } });
        fireEvent.change(sshPortInput()!, { target: { value: '4000' } });
        expect(submitButton().disabled).toBe(false);
    });
});

describe('EditAgentDialog', () => {
    it('pre-fills fields from initial prop', () => {
        const onSave = vi.fn().mockResolvedValue(undefined);
        render(
            <EditAgentDialog
                open={true}
                onClose={vi.fn()}
                onSave={onSave}
                initial={{ name: 'Dev VM', address: 'http://192.168.1.10:4000', tunnelId: undefined }}
            />
        );
        const urlField = screen.getByTestId('edit-agent-url-input') as HTMLInputElement;
        expect(urlField.value).toBe('http://192.168.1.10:4000');
        const nameField = screen.getByTestId('edit-agent-name-input') as HTMLInputElement;
        expect(nameField.value).toBe('Dev VM');
    });

    it('detects SSH kind from ssh:// address', () => {
        const onSave = vi.fn().mockResolvedValue(undefined);
        render(
            <EditAgentDialog
                open={true}
                onClose={vi.fn()}
                onSave={onSave}
                initial={{ name: 'SSH Agent', address: 'ssh://my-host:4000' }}
            />
        );
        expect(screen.getByTestId('edit-agent-ssh-host-input')).toBeTruthy();
        expect((screen.getByTestId('edit-agent-ssh-host-input') as HTMLInputElement).value).toBe('my-host');
        expect((screen.getByTestId('edit-agent-ssh-port-input') as HTMLInputElement).value).toBe('4000');
    });

    it('calls onSave with updated fields', async () => {
        const onSave = vi.fn().mockResolvedValue(undefined);
        render(
            <EditAgentDialog
                open={true}
                onClose={vi.fn()}
                onSave={onSave}
                initial={{ name: 'Old Name', address: 'http://localhost:4000' }}
            />
        );
        const nameField = screen.getByTestId('edit-agent-name-input') as HTMLInputElement;
        fireEvent.change(nameField, { target: { value: 'New Name' } });
        await act(async () => {
            fireEvent.click(screen.getByTestId('edit-agent-submit'));
        });
        await waitFor(() =>
            expect(onSave).toHaveBeenCalledWith({
                name: 'New Name',
                address: 'http://localhost:4000',
                tunnelId: null,
            })
        );
    });
});
