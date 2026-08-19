/**
 * BitFlagDecoderCard — the wiring between the paste box, the saved sets, the
 * number box and the checkboxes. The parsing, decoding and storage rules
 * themselves are covered by bitFlags.test.ts and bitFlagStore.test.ts.
 *
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { BitFlagDecoderCard } from '../../../../../src/server/spa/client/react/features/dev-tools/BitFlagDecoderCard';
import { BIT_FLAG_STORAGE_KEY } from '../../../../../src/server/spa/client/react/features/dev-tools/logic/bitFlagStore';
import { DEV_TOOLS } from '../../../../../src/server/spa/client/react/features/dev-tools/registry';

const SOURCE = [
    'enum Perm : uint32_t {',
    '  READ = 1 << 0,',
    '  WRITE = 1 << 1,',
    '  EXEC = 1 << 2,',
    '  ALL = READ | WRITE | EXEC,',
    '  SPEED_MASK = 0x30,',
    '  SPEED_SHIFT = 4,',
    '};',
].join('\n');

function paste(source: string) {
    fireEvent.change(screen.getByTestId('bitflags-source'), { target: { value: source } });
}

function type(value: string) {
    fireEvent.change(screen.getByTestId('bitflags-value'), { target: { value } });
}

function summary(): string {
    return screen.getByTestId('bitflags-summary').textContent ?? '';
}

function numberBox(): HTMLInputElement {
    return screen.getByTestId('bitflags-value') as HTMLInputElement;
}

beforeEach(() => {
    localStorage.clear();
});

afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.restoreAllMocks();
});

describe('BitFlagDecoderCard — parsed definitions', () => {
    it('lists every parsed name with its hex value and kind', () => {
        render(<BitFlagDecoderCard />);
        paste(SOURCE);
        const table = screen.getByTestId('bitflags-table').textContent ?? '';
        expect(table).toContain('READ');
        expect(table).toContain('0x1');
        expect(table).toContain('ALL');
        expect(table).toContain('alias');
        expect(table).toContain('SPEED_MASK');
        expect(table).toContain('mask');
    });

    it('reports the parse count and lists a line it could not read', () => {
        render(<BitFlagDecoderCard />);
        paste('enum E {\n  A = 1 << 0,\n  B = NOT_DEFINED_ANYWHERE,\n};');
        expect(screen.getByTestId('bitflags-parse-status').textContent).toContain('1 skipped');
        expect(screen.getByTestId('bitflags-skipped').textContent).toContain('NOT_DEFINED_ANYWHERE');
        // Never a blank card — the good definition still renders.
        expect(screen.getByTestId('bitflags-row-A')).toBeTruthy();
    });

    it('warns when the paste looks like a sequential enum', () => {
        render(<BitFlagDecoderCard />);
        paste('enum Color { RED, GREEN, BLUE };');
        expect(screen.getAllByTestId('bitflags-warning').length).toBeGreaterThan(0);
    });
});

describe('BitFlagDecoderCard — decoding', () => {
    it('lists matched flags, mask fields and the leftover bits', () => {
        render(<BitFlagDecoderCard />);
        paste(SOURCE);
        type('0x85');
        expect(screen.getByTestId('bitflags-decoded-flag-READ').textContent).toContain('bit 0');
        expect(screen.getByTestId('bitflags-decoded-flag-EXEC').textContent).toContain('bit 2');
        expect(screen.getByTestId('bitflags-decoded-unknown').textContent).toContain('0x80 (bit 7)');
        expect(summary()).toBe('READ | EXEC | unknown 0x80');
    });

    it('accepts a C-style expression, not just a literal', () => {
        render(<BitFlagDecoderCard />);
        paste(SOURCE);
        type('0x1 | 4');
        expect(summary()).toBe('READ | EXEC');
    });

    it('shows an empty state for zero rather than an error', () => {
        render(<BitFlagDecoderCard />);
        paste(SOURCE);
        type('0');
        expect(screen.getByTestId('bitflags-empty').textContent).toContain('no flags set');
        expect(screen.queryByTestId('bitflags-error')).toBeNull();
    });

    it('lists an alias only when all of its bits are present', () => {
        render(<BitFlagDecoderCard />);
        paste(SOURCE);
        type('0x3');
        expect(screen.queryByTestId('bitflags-decoded-alias-ALL')).toBeNull();
        type('0x7');
        expect(screen.getByTestId('bitflags-decoded-alias-ALL')).toBeTruthy();
    });

    it('reads a mask as a shifted-down sub-field', () => {
        render(<BitFlagDecoderCard />);
        paste(SOURCE);
        type('0x30');
        expect(screen.getByTestId('bitflags-decoded-field-SPEED_MASK').textContent).toContain('3');
        expect(summary()).toBe('SPEED_MASK=3');
    });

    it('reports a bad expression inline and keeps the last good value', () => {
        render(<BitFlagDecoderCard />);
        paste(SOURCE);
        type('0x5');
        type('0x5 +');
        expect(screen.getByTestId('bitflags-error')).toBeTruthy();
        expect(summary()).toBe('READ | EXEC');
    });
});

describe('BitFlagDecoderCard — encoding', () => {
    it('ticking two flags ORs their values into the number box', () => {
        render(<BitFlagDecoderCard />);
        paste(SOURCE);
        fireEvent.click(screen.getByTestId('bitflags-check-READ'));
        fireEvent.click(screen.getByTestId('bitflags-check-EXEC'));
        expect(numberBox().value).toBe('0x5');
        fireEvent.click(screen.getByTestId('bitflags-check-EXEC'));
        expect(numberBox().value).toBe('0x1');
        expect(summary()).toBe('READ');
    });

    it('unticking a flag covered by a matched alias still clears the bit', () => {
        render(<BitFlagDecoderCard />);
        paste(SOURCE);
        type('0x7');
        expect((screen.getByTestId('bitflags-check-ALL') as HTMLInputElement).checked).toBe(true);
        fireEvent.click(screen.getByTestId('bitflags-check-READ'));
        expect(numberBox().value).toBe('0x6');
        expect((screen.getByTestId('bitflags-check-ALL') as HTMLInputElement).checked).toBe(false);
    });

    it('ticking an alias sets every constituent bit', () => {
        render(<BitFlagDecoderCard />);
        paste(SOURCE);
        fireEvent.click(screen.getByTestId('bitflags-check-ALL'));
        expect(numberBox().value).toBe('0x7');
        expect((screen.getByTestId('bitflags-check-WRITE') as HTMLInputElement).checked).toBe(true);
    });

    it('typing a number ticks every flag it covers', () => {
        render(<BitFlagDecoderCard />);
        paste(SOURCE);
        type('0xFF');
        for (const flag of ['READ', 'WRITE', 'EXEC', 'ALL']) {
            expect((screen.getByTestId(`bitflags-check-${flag}`) as HTMLInputElement).checked).toBe(true);
        }
    });

    it('writes a sub-field through its numeric input, shifted into the mask', () => {
        render(<BitFlagDecoderCard />);
        paste(SOURCE);
        fireEvent.change(screen.getByTestId('bitflags-field-SPEED_MASK'), { target: { value: '2' } });
        expect(numberBox().value).toBe('0x20');
        expect((screen.getByTestId('bitflags-field-SPEED_MASK') as HTMLInputElement).value).toBe('2');
    });

    it('truncates the value to the selected width', () => {
        render(<BitFlagDecoderCard />);
        paste(SOURCE);
        type('0x1FF');
        fireEvent.change(screen.getByTestId('bitflags-width'), { target: { value: '8' } });
        expect(summary()).toBe('READ | WRITE | EXEC | SPEED_MASK=3 | unknown 0xC8');
    });
});

describe('BitFlagDecoderCard — saved sets', () => {
    it('saves a pasted set and restores it on remount', () => {
        const first = render(<BitFlagDecoderCard />);
        paste(SOURCE);
        fireEvent.change(screen.getByTestId('bitflags-set-name'), { target: { value: 'Perm' } });
        fireEvent.click(screen.getByTestId('bitflags-save'));
        first.unmount();

        render(<BitFlagDecoderCard />);
        expect((screen.getByTestId('bitflags-source') as HTMLTextAreaElement).value).toBe(SOURCE);
        expect((screen.getByTestId('bitflags-set-name') as HTMLInputElement).value).toBe('Perm');
        type('0x1');
        expect(summary()).toBe('READ');
    });

    it('switches the decode output when a different set is selected', () => {
        render(<BitFlagDecoderCard />);
        paste(SOURCE);
        fireEvent.change(screen.getByTestId('bitflags-set-name'), { target: { value: 'Perm' } });
        fireEvent.click(screen.getByTestId('bitflags-save'));

        fireEvent.click(screen.getByTestId('bitflags-new'));
        paste('#define NET_UP 0x01');
        fireEvent.change(screen.getByTestId('bitflags-set-name'), { target: { value: 'Net' } });
        fireEvent.click(screen.getByTestId('bitflags-save'));

        type('0x1');
        expect(summary()).toBe('NET_UP');

        const select = screen.getByTestId('bitflags-set-select') as HTMLSelectElement;
        const perm = [...select.options].find(o => o.textContent === 'Perm')!;
        fireEvent.change(select, { target: { value: perm.value } });
        expect(summary()).toBe('READ');
    });

    it('renames the selected set', () => {
        render(<BitFlagDecoderCard />);
        paste(SOURCE);
        fireEvent.change(screen.getByTestId('bitflags-set-name'), { target: { value: 'Perm' } });
        fireEvent.click(screen.getByTestId('bitflags-save'));
        fireEvent.change(screen.getByTestId('bitflags-set-name'), { target: { value: 'Permissions' } });
        fireEvent.click(screen.getByTestId('bitflags-rename'));
        expect(screen.getByTestId('bitflags-set-select').textContent).toContain('Permissions');
    });

    it('asks before deleting and keeps the set when the confirm is declined', () => {
        render(<BitFlagDecoderCard />);
        paste(SOURCE);
        fireEvent.click(screen.getByTestId('bitflags-save'));

        const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
        fireEvent.click(screen.getByTestId('bitflags-delete'));
        expect(confirmSpy).toHaveBeenCalled();
        expect((screen.getByTestId('bitflags-source') as HTMLTextAreaElement).value).toBe(SOURCE);

        confirmSpy.mockReturnValue(true);
        fireEvent.click(screen.getByTestId('bitflags-delete'));
        expect((screen.getByTestId('bitflags-source') as HTMLTextAreaElement).value).toBe('');
    });

    it('falls back to an empty list when localStorage holds junk', () => {
        localStorage.setItem(BIT_FLAG_STORAGE_KEY, 'not json at all');
        render(<BitFlagDecoderCard />);
        expect((screen.getByTestId('bitflags-source') as HTMLTextAreaElement).value).toBe('');
        expect(screen.getByTestId('bitflags-set-select').textContent).toContain('(unsaved)');
    });
});

describe('BitFlagDecoderCard — registration', () => {
    it('sits directly after the programmer calculator with searchable keywords', () => {
        const index = DEV_TOOLS.findIndex(tool => tool.id === 'bit-flags');
        expect(index).toBe(DEV_TOOLS.findIndex(tool => tool.id === 'calculator') + 1);
        const tool = DEV_TOOLS[index]!;
        expect(tool.name).toBe('Bit flag decoder');
        for (const keyword of ['flag', 'flags', 'bitflag', 'bitmask', 'mask', 'enum', 'decode', 'bits', 'cpp']) {
            expect(tool.keywords).toContain(keyword);
        }
    });

    it('offers a copy button holding the summary line', () => {
        render(<BitFlagDecoderCard />);
        paste(SOURCE);
        type('0x85');
        expect(screen.getByTestId('bitflags-copy')).toBeTruthy();
        expect(summary()).toBe('READ | EXEC | unknown 0x80');
    });
});
