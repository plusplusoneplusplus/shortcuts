/**
 * Tests for AddAgentDialog — form fields, conditional tunnel ID, onAdd wiring.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { AddAgentDialog } from '../../../../src/server/spa/client/react/repos/AddAgentDialog';

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

function addressInput() {
    return screen.getByPlaceholderText('http://localhost:4000') as HTMLInputElement;
}

function nameInput() {
    return screen.getByPlaceholderText('My Agent') as HTMLInputElement;
}

function tunnelInput() {
    return screen.queryByPlaceholderText(/amusing-book/i) as HTMLInputElement | null;
}

function submitButton() {
    return screen.getByRole('button', { name: /add agent/i });
}

describe('AddAgentDialog — initial render', () => {
    it('renders the address and name fields', () => {
        renderDialog();
        expect(addressInput()).toBeTruthy();
        expect(nameInput()).toBeTruthy();
    });

    it('does not show tunnel ID field for a non-devtunnel address', () => {
        renderDialog();
        fireEvent.change(addressInput(), { target: { value: 'http://localhost:4000' } });
        expect(tunnelInput()).toBeNull();
    });

    it('does not render when open=false', () => {
        render(
            <AddAgentDialog open={false} onClose={vi.fn()} onAdd={vi.fn().mockResolvedValue(undefined)} />
        );
        expect(screen.queryByPlaceholderText('http://localhost:4000')).toBeNull();
    });
});

describe('AddAgentDialog — conditional tunnel ID field', () => {
    it('shows tunnel ID field when address ends with .devtunnels.ms', () => {
        renderDialog();
        fireEvent.change(addressInput(), { target: { value: 'https://my-tunnel.devtunnels.ms' } });
        expect(tunnelInput()).toBeTruthy();
    });

    it('shows hint text alongside the tunnel ID field', () => {
        renderDialog();
        fireEvent.change(addressInput(), { target: { value: 'https://my-tunnel.devtunnels.ms' } });
        expect(screen.getByText(/server-side auth/i)).toBeTruthy();
    });

    it('hides tunnel ID field when address is changed back to a non-devtunnel URL', () => {
        renderDialog();
        fireEvent.change(addressInput(), { target: { value: 'https://my-tunnel.devtunnels.ms' } });
        expect(tunnelInput()).toBeTruthy();
        fireEvent.change(addressInput(), { target: { value: 'http://localhost:4000' } });
        expect(tunnelInput()).toBeNull();
    });

    it('does not show tunnel ID field for a URL that merely contains devtunnels.ms as a path', () => {
        renderDialog();
        fireEvent.change(addressInput(), { target: { value: 'http://localhost:4000/devtunnels.ms' } });
        expect(tunnelInput()).toBeNull();
    });
});

describe('AddAgentDialog — onAdd callback', () => {
    beforeEach(() => vi.clearAllMocks());

    it('calls onAdd with trimmed address and no name/tunnelId when only address is provided', async () => {
        const { onAdd } = renderDialog();
        fireEvent.change(addressInput(), { target: { value: '  http://localhost:4000  ' } });
        await act(async () => { fireEvent.submit(addressInput().closest('form')!); });
        await waitFor(() => expect(onAdd).toHaveBeenCalledWith('http://localhost:4000', undefined, undefined));
    });

    it('calls onAdd with name when name field is filled', async () => {
        const { onAdd } = renderDialog();
        fireEvent.change(addressInput(), { target: { value: 'http://localhost:4000' } });
        fireEvent.change(nameInput(), { target: { value: 'My Agent' } });
        await act(async () => { fireEvent.submit(addressInput().closest('form')!); });
        await waitFor(() => expect(onAdd).toHaveBeenCalledWith('http://localhost:4000', 'My Agent', undefined));
    });

    it('calls onAdd with tunnelId when address is a devtunnel URL and tunnelId is filled', async () => {
        const { onAdd } = renderDialog();
        fireEvent.change(addressInput(), { target: { value: 'https://my-tunnel.devtunnels.ms' } });
        const tid = tunnelInput()!;
        fireEvent.change(tid, { target: { value: 'amusing-book-s4hcgw2.usw2' } });
        await act(async () => { fireEvent.submit(addressInput().closest('form')!); });
        await waitFor(() =>
            expect(onAdd).toHaveBeenCalledWith(
                'https://my-tunnel.devtunnels.ms',
                undefined,
                'amusing-book-s4hcgw2.usw2',
            )
        );
    });

    it('passes undefined tunnelId when tunnel field is left empty for a devtunnel address', async () => {
        const { onAdd } = renderDialog();
        fireEvent.change(addressInput(), { target: { value: 'https://my-tunnel.devtunnels.ms' } });
        await act(async () => { fireEvent.submit(addressInput().closest('form')!); });
        await waitFor(() =>
            expect(onAdd).toHaveBeenCalledWith('https://my-tunnel.devtunnels.ms', undefined, undefined)
        );
    });
});

describe('AddAgentDialog — error handling', () => {
    it('shows error message when onAdd rejects', async () => {
        const onAdd = vi.fn().mockRejectedValue(new Error('Connection refused'));
        render(<AddAgentDialog open={true} onClose={vi.fn()} onAdd={onAdd} />);
        fireEvent.change(addressInput(), { target: { value: 'http://localhost:4000' } });
        await act(async () => { fireEvent.submit(addressInput().closest('form')!); });
        await waitFor(() => expect(screen.getByText('Connection refused')).toBeTruthy());
    });

    it('clears previous error on a new successful submit', async () => {
        const onAdd = vi.fn()
            .mockRejectedValueOnce(new Error('Timeout'))
            .mockResolvedValue(undefined);
        render(<AddAgentDialog open={true} onClose={vi.fn()} onAdd={onAdd} />);
        fireEvent.change(addressInput(), { target: { value: 'http://localhost:4000' } });

        await act(async () => { fireEvent.submit(addressInput().closest('form')!); });
        await waitFor(() => expect(screen.getByText('Timeout')).toBeTruthy());

        await act(async () => { fireEvent.submit(addressInput().closest('form')!); });
        await waitFor(() => expect(screen.queryByText('Timeout')).toBeNull());
    });
});

describe('AddAgentDialog — submit button state', () => {
    it('disables submit when address is empty', () => {
        renderDialog();
        expect(submitButton()).toHaveAttribute('disabled');
    });

    it('enables submit when address has content', () => {
        renderDialog();
        fireEvent.change(addressInput(), { target: { value: 'http://localhost:4000' } });
        expect(submitButton()).not.toHaveAttribute('disabled');
    });
});
