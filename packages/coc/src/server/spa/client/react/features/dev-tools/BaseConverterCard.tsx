/**
 * BaseConverterCard — convert an integer between any two bases from 2 to 36.
 *
 * All parsing lives in `logic/baseConverter.ts`; this file only wires the
 * inputs to it and renders the inline error.
 */

import { useState } from 'react';
import { CopyButton } from './CopyButton';
import {
    COMMON_BASES,
    MAX_BASE,
    MIN_BASE,
    convertBase,
    formatInBase,
    parseInBase,
} from './logic/baseConverter';
import { cardBodyClass, errorClass, inputClass, labelClass, mutedClass, readoutClass } from './styles';

export function BaseConverterCard() {
    const [text, setText] = useState('255');
    const [fromBase, setFromBase] = useState(10);
    const [toBase, setToBase] = useState(16);

    const result = convertBase(text, fromBase, toBase);
    const parsed = parseInBase(text, fromBase);
    // The preset row is a convenience readout, so it only renders once the
    // input actually parses.
    const presets = parsed.ok
        ? COMMON_BASES.map(base => ({ base, text: formatInBase(parsed.value, base) }))
        : [];

    const baseInput = (value: number, onChange: (n: number) => void, label: string, testId: string) => (
        <label className={labelClass}>
            {label}
            <input
                type="number"
                min={MIN_BASE}
                max={MAX_BASE}
                value={value}
                onChange={e => onChange(Number(e.target.value))}
                aria-label={label}
                data-testid={testId}
                className={`${inputClass} w-16`}
            />
        </label>
    );

    return (
        <div className={cardBodyClass}>
            <div className="flex flex-wrap items-center gap-2">
                <input
                    type="text"
                    value={text}
                    onChange={e => setText(e.target.value)}
                    spellCheck={false}
                    placeholder="e.g. ff"
                    aria-label="Value"
                    data-testid="base-input"
                    className={`${inputClass} flex-1 min-w-[160px] font-mono`}
                />
                {baseInput(fromBase, setFromBase, 'From base', 'base-from')}
                {baseInput(toBase, setToBase, 'To base', 'base-to')}
                <button
                    type="button"
                    onClick={() => {
                        if (result.ok) setText(result.value);
                        setFromBase(toBase);
                        setToBase(fromBase);
                    }}
                    aria-label="Swap bases"
                    data-testid="base-swap"
                    className={`${inputClass} px-2 cursor-pointer`}
                >
                    Swap
                </button>
            </div>

            {!result.ok && (
                <p className={errorClass} data-testid="base-error">
                    {result.error}
                </p>
            )}

            <div className="flex items-center gap-2">
                <span className="w-16 flex-shrink-0 text-[10px] uppercase text-[#656d76] dark:text-[#999]">
                    Base {toBase}
                </span>
                <code className={readoutClass} data-testid="base-output">
                    {result.ok ? result.value : '—'}
                </code>
                <CopyButton
                    text={result.ok ? result.value : ''}
                    label="Copy converted value"
                    testId="base-copy"
                />
            </div>

            {presets.length > 0 && (
                <div className={`flex flex-wrap gap-x-4 gap-y-1 ${mutedClass}`} data-testid="base-presets">
                    {presets.map(preset => (
                        <span key={preset.base} className="font-mono">
                            <span className="uppercase">b{preset.base}</span>{' '}
                            {preset.text.ok ? preset.text.value : '—'}
                        </span>
                    ))}
                </div>
            )}
        </div>
    );
}
