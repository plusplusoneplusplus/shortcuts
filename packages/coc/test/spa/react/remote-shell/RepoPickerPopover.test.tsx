/**
 * RepoPickerPopover — the shared presentational shell + row/section/empty
 * primitives that both remote repo pickers compose. Verifies the canonical
 * chrome (testids, search box, footer slot) and the PickerRow slot behavior
 * (color dot, sublabel, badges, active + offline states).
 *
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import {
    PickerEmpty,
    PickerRow,
    PickerSection,
    RepoPickerPopover,
    type RepoPickerPopoverProps,
} from '../../../../src/server/spa/client/react/features/remote-shell/RepoPickerPopover';

afterEach(cleanup);

function renderPopover(props: Partial<RepoPickerPopoverProps> = {}) {
    return render(
        <RepoPickerPopover
            open
            dropdownTestId="picker-dropdown"
            searchTestId="picker-search"
            searchPlaceholder="Search things"
            query=""
            onQueryChange={() => {}}
            {...props}
        >
            {props.children ?? <PickerSection label="Section" />}
        </RepoPickerPopover>,
    );
}

describe('RepoPickerPopover', () => {
    it('renders nothing when closed', () => {
        renderPopover({ open: false });
        expect(screen.queryByTestId('picker-dropdown')).toBeNull();
    });

    it('renders the popover chrome, search box and children when open', () => {
        renderPopover();
        expect(screen.getByTestId('picker-dropdown')).toBeTruthy();
        const search = screen.getByTestId('picker-search') as HTMLInputElement;
        expect(search.getAttribute('placeholder')).toBe('Search things');
        expect(search.getAttribute('aria-label')).toBe('Search things');
        expect(screen.getByTestId('picker-dropdown').textContent).toContain('Section');
    });

    it('uses an explicit aria-label over the placeholder when provided', () => {
        renderPopover({ searchAriaLabel: 'Filter it' });
        expect(screen.getByTestId('picker-search').getAttribute('aria-label')).toBe('Filter it');
    });

    it('reports search input changes through onQueryChange', () => {
        const onQueryChange = vi.fn();
        renderPopover({ onQueryChange });
        fireEvent.change(screen.getByTestId('picker-search'), { target: { value: 'abc' } });
        expect(onQueryChange).toHaveBeenCalledWith('abc');
    });

    it('renders a footer slot below the scroll area', () => {
        renderPopover({ footer: <button data-testid="picker-footer-btn">Footer</button> });
        expect(screen.getByTestId('picker-footer-btn')).toBeTruthy();
    });
});

describe('PickerSection', () => {
    it('renders its uppercase label', () => {
        render(<PickerSection label="Recent remotes" />);
        expect(screen.getByText('Recent remotes')).toBeTruthy();
    });
});

describe('PickerEmpty', () => {
    it('renders its children', () => {
        render(<PickerEmpty>No remotes found</PickerEmpty>);
        expect(screen.getByText('No remotes found')).toBeTruthy();
    });
});

describe('PickerRow', () => {
    it('renders name and sublabel and fires onClick', () => {
        const onClick = vi.fn();
        render(<PickerRow testId="row" name="shortcuts" sublabel="github.com/acme/shortcuts" onClick={onClick} />);
        const row = screen.getByTestId('row');
        expect(row.textContent).toContain('shortcuts');
        expect(row.textContent).toContain('github.com/acme/shortcuts');
        fireEvent.click(row);
        expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('renders a color dot and remote key + active state for group rows', () => {
        render(<PickerRow testId="row" name="forge" colorDot="#16825d" remoteKey="github.com/acme/forge" active />);
        const row = screen.getByTestId('row');
        expect(row.getAttribute('data-remote-key')).toBe('github.com/acme/forge');
        expect(row.getAttribute('data-active')).toBe('true');
        expect(row.querySelector('span[aria-hidden]')).not.toBeNull();
    });

    it('omits data-active and data-remote-key when not provided (repo rows)', () => {
        render(<PickerRow testId="row" name="local" />);
        const row = screen.getByTestId('row');
        expect(row.hasAttribute('data-active')).toBe(false);
        expect(row.hasAttribute('data-remote-key')).toBe(false);
    });

    it('disables the row and blocks clicks when offline', () => {
        const onClick = vi.fn();
        render(<PickerRow testId="row" name="offline-repo" offline onClick={onClick} badges={<span>offline</span>} />);
        const row = screen.getByTestId('row') as HTMLButtonElement;
        expect(row.disabled).toBe(true);
        expect(row.getAttribute('aria-disabled')).toBe('true');
        expect(row.textContent).toContain('offline');
        fireEvent.click(row);
        expect(onClick).not.toHaveBeenCalled();
    });

    it('renders trailing badges', () => {
        render(<PickerRow testId="row" name="repo" badges={<span data-testid="row-badge">2</span>} />);
        expect(screen.getByTestId('row-badge')).toBeTruthy();
    });
});
