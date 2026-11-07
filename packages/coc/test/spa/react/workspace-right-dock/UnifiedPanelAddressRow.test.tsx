// @vitest-environment jsdom
/**
 * UnifiedPanelAddressRow — the `coc://` address row: shows the active tab's
 * address, an owner chip only for a foreign owner, Escape restores the
 * address, Enter on it unchanged does nothing, and bad input errors inline.
 */
import { createRef } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UnifiedPanelAddressRow } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/UnifiedPanelAddressRow';

afterEach(cleanup);

function setup(props: Partial<Parameters<typeof UnifiedPanelAddressRow>[0]> = {}) {
    const onOpenAddress = vi.fn<(address: unknown) => string | void>();
    const all = { inputRef: createRef<HTMLInputElement>(), address: 'coc://settings', ownerKey: 'tab-1', enabled: true, onOpenAddress, ...props };
    const view = render(<UnifiedPanelAddressRow {...all} />);
    const input = screen.getByLabelText('Address') as HTMLInputElement;
    const submit = (value: string) => {
        fireEvent.change(input, { target: { value } });
        fireEvent.keyDown(input, { key: 'Enter' });
    };
    return { ...view, all, input, submit, onOpenAddress: all.onOpenAddress as typeof onOpenAddress };
}

describe('UnifiedPanelAddressRow', () => {
    it('shows the address with no owner chip for the panel scope', () => {
        const { input } = setup();
        expect(input.value).toBe('coc://settings');
        expect(input.getAttribute('role')).toBeNull();
        expect(screen.queryByTestId('unified-panel-address-owner')).toBeNull();
    });

    it('shows an owner chip for a foreign owner', () => {
        setup({ ownerLabel: 'api-repo' });
        expect(screen.getByTestId('unified-panel-address-owner').textContent).toBe('api-repo');
    });

    it('opens a parsed address', () => {
        const { submit, onOpenAddress } = setup();
        submit('COC://Terminal/');
        expect(onOpenAddress).toHaveBeenCalledWith({ kind: 'terminal' });
        expect(screen.queryByTestId('unified-panel-address-error')).toBeNull();
    });

    it('ignores Enter on the unchanged address', () => {
        const { submit, onOpenAddress } = setup();
        submit('coc://settings');
        expect(onOpenAddress).not.toHaveBeenCalled();
    });

    it('errors inline on bad input without opening, and editing clears it', () => {
        const { input, submit, onOpenAddress } = setup();
        submit('coc://git');
        expect(screen.getByTestId('unified-panel-address-error').textContent).toBe('Not supported yet');
        expect(input.getAttribute('aria-invalid')).toBe('true');
        submit('https://example.com');
        expect(screen.getByTestId('unified-panel-address-error').textContent).toBe('Not a valid coc:// address');
        expect(onOpenAddress).not.toHaveBeenCalled();
        fireEvent.change(input, { target: { value: 'coc://' } });
        expect(screen.queryByTestId('unified-panel-address-error')).toBeNull();
    });

    it('shows an availability error from the panel', () => {
        const { submit, onOpenAddress } = setup();
        onOpenAddress.mockReturnValue('To-do is only available in a Sentinel chat');
        submit('coc://todo');
        expect(screen.getByRole('alert').textContent).toBe('To-do is only available in a Sentinel chat');
    });

    it('Escape restores the address', () => {
        const { input } = setup();
        fireEvent.change(input, { target: { value: 'coc://term' } });
        fireEvent.keyDown(input, { key: 'Escape' });
        expect(input.value).toBe('coc://settings');
    });

    it('follows a new address and drops the error on a tab change', () => {
        const { input, submit, rerender, all } = setup();
        submit('coc://git');
        rerender(<UnifiedPanelAddressRow {...all} address="coc://todo/item-1" ownerKey="tab-2" />);
        expect(input.value).toBe('coc://todo/item-1');
        expect(screen.queryByTestId('unified-panel-address-error')).toBeNull();
    });
});
