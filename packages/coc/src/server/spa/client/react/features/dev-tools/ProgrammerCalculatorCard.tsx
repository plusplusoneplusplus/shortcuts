/**
 * ProgrammerCalculatorCard — expression box, DEC/HEX/OCT/BIN readouts and a
 * clickable bit grid.
 *
 * All arithmetic lives in `logic/calculator.ts`; this file only wires inputs to
 * it. When an expression fails to parse the error shows inline and the previous
 * good value stays on screen.
 */

import { useState } from 'react';
import { CopyButton } from './CopyButton';
import {
    CALC_WIDTHS,
    bitsOf,
    evaluate,
    formatBinaryGrouped,
    formatValue,
    toHexLiteral,
    toggleBit,
    truncate,
    type CalcBase,
    type CalcWidth,
} from './logic/calculator';

const INITIAL_EXPRESSION = '0xFF << 4';
const INITIAL_WIDTH: CalcWidth = 64;

const READOUTS: readonly { base: CalcBase; label: string }[] = [
    { base: 'dec', label: 'DEC' },
    { base: 'hex', label: 'HEX' },
    { base: 'oct', label: 'OCT' },
    { base: 'bin', label: 'BIN' },
];

export function ProgrammerCalculatorCard() {
    const [expression, setExpression] = useState(INITIAL_EXPRESSION);
    const [width, setWidth] = useState<CalcWidth>(INITIAL_WIDTH);
    const [signed, setSigned] = useState(false);
    const [value, setValue] = useState(() => {
        const first = evaluate(INITIAL_EXPRESSION, { width: INITIAL_WIDTH, signed: false });
        return first.ok ? first.value : 0n;
    });
    const [error, setError] = useState('');

    const apply = (nextExpression: string, nextWidth: CalcWidth, nextSigned: boolean) => {
        setExpression(nextExpression);
        setWidth(nextWidth);
        setSigned(nextSigned);
        if (!nextExpression.trim()) {
            setError('');
            setValue(prev => truncate(prev, nextWidth));
            return;
        }
        const result = evaluate(nextExpression, { width: nextWidth, signed: nextSigned });
        if (result.ok) {
            setValue(result.value);
            setError('');
        } else {
            // Keep the last good value visible, wrapped to the current width.
            setValue(prev => truncate(prev, nextWidth));
            setError(result.error);
        }
    };

    const onToggleBit = (index: number) => {
        apply(toHexLiteral(toggleBit(value, width, index), width), width, signed);
    };

    const bits = bitsOf(value, width);
    const inputClass =
        'h-8 px-2 rounded border border-[#d0d7de] dark:border-[#3c3c3c] bg-white dark:bg-[#1e1e1e] text-sm text-[#1e1e1e] dark:text-[#cccccc] focus:outline-none focus:border-[#0078d4]';

    return (
        <div className="flex flex-col gap-3 pt-2">
            <div className="flex flex-wrap items-center gap-2">
                <input
                    type="text"
                    value={expression}
                    onChange={e => apply(e.target.value, width, signed)}
                    spellCheck={false}
                    placeholder="e.g. (0xFF << 4) | 0b1010"
                    aria-label="Expression"
                    data-testid="calc-expression"
                    className={`${inputClass} flex-1 min-w-[200px] font-mono`}
                />
                <label className="flex items-center gap-1 text-[11px] text-[#656d76] dark:text-[#999]">
                    Width
                    <select
                        value={width}
                        onChange={e => apply(expression, Number(e.target.value) as CalcWidth, signed)}
                        aria-label="Width"
                        data-testid="calc-width"
                        className={inputClass}
                    >
                        {CALC_WIDTHS.map(w => (
                            <option key={w} value={w}>
                                {w}-bit
                            </option>
                        ))}
                    </select>
                </label>
                <label className="flex items-center gap-1 text-[11px] text-[#656d76] dark:text-[#999]">
                    <input
                        type="checkbox"
                        checked={signed}
                        onChange={e => apply(expression, width, e.target.checked)}
                        aria-label="Signed"
                        data-testid="calc-signed"
                    />
                    Signed
                </label>
            </div>

            {error && (
                <p className="text-xs text-[#cf222e] dark:text-[#f85149]" data-testid="calc-error">
                    {error}
                </p>
            )}

            <div className="flex flex-col gap-1">
                {READOUTS.map(({ base, label }) => {
                    const text = formatValue(value, width, signed, base);
                    const shown = base === 'bin' ? formatBinaryGrouped(value, width) : text;
                    return (
                        <div key={base} className="flex items-center gap-2">
                            <span className="w-8 flex-shrink-0 text-[10px] uppercase text-[#656d76] dark:text-[#999]">
                                {label}
                            </span>
                            <code
                                className="flex-1 min-w-0 px-2 py-1 rounded bg-[#f6f8fa] dark:bg-[#252526] text-xs font-mono text-[#1e1e1e] dark:text-[#cccccc] break-all"
                                data-testid={`calc-readout-${base}`}
                            >
                                {shown}
                            </code>
                            <CopyButton
                                text={text}
                                label={`Copy ${label} value`}
                                testId={`calc-copy-${base}`}
                            />
                        </div>
                    );
                })}
            </div>

            <div className="flex flex-wrap gap-x-3 gap-y-2" data-testid="calc-bit-grid">
                {/* Nibbles, most-significant first, so the grid reads like the BIN readout. */}
                {Array.from({ length: width / 4 }, (_, nibble) => {
                    const high = width - nibble * 4 - 1;
                    return (
                        <div key={high} className="flex flex-col items-center gap-0.5">
                            <div className="flex gap-0.5">
                                {[0, 1, 2, 3].map(offset => {
                                    const index = high - offset;
                                    const on = bits[index];
                                    return (
                                        <button
                                            key={index}
                                            type="button"
                                            onClick={() => onToggleBit(index)}
                                            aria-label={`Bit ${index}`}
                                            aria-pressed={on}
                                            data-testid={`calc-bit-${index}`}
                                            className={`w-5 h-5 rounded-sm text-[11px] font-mono border ${
                                                on
                                                    ? 'bg-[#0078d4] border-[#0078d4] text-white'
                                                    : 'bg-white dark:bg-[#1e1e1e] border-[#e0e0e0] dark:border-[#3c3c3c] text-[#656d76] dark:text-[#999]'
                                            }`}
                                        >
                                            {on ? '1' : '0'}
                                        </button>
                                    );
                                })}
                            </div>
                            <span className="text-[9px] text-[#656d76] dark:text-[#999]">{high}</span>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
