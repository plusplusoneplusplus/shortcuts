import { describe, expect, it } from 'vitest';
import { TABLE_CELL_COLORS, tableCellBackgroundVar, tableCellColorFromStyle } from '../src/table/cellBackground.js';

describe('generic table color variables', () => {
    it.each(TABLE_CELL_COLORS)('round-trips the $token variable and palette hex', ({ token, swatch }) => {
        const variable = tableCellBackgroundVar(token);
        expect(variable).toBe(`--rich-editor-table-bg-${token}`);
        expect(tableCellColorFromStyle(`background-color: var(${variable});`)).toBe(token);
        expect(tableCellColorFromStyle(`background-color: ${swatch};`)).toBe(token);
    });

    it('rejects unknown color tokens', () => {
        expect(tableCellColorFromStyle('background-color: var(--rich-editor-table-bg-chartreuse);')).toBeNull();
    });
});
