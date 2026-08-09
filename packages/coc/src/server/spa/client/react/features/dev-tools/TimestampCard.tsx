/**
 * TimestampCard — epoch seconds/milliseconds ↔ ISO 8601 ↔ local string.
 *
 * The card is the only place that reads the wall clock: `logic/timestamp.ts`
 * takes `nowMs` as an argument so it stays deterministic under test. The clock
 * is sampled when the user presses "Now" (and once on mount) rather than on
 * every render, which also keeps the relative label stable while typing.
 */

import { useState } from 'react';
import { CopyButton } from './CopyButton';
import { parseTimestamp } from './logic/timestamp';
import { cardBodyClass, errorClass, inputClass, mutedClass, readoutClass } from './styles';

const ROWS: readonly { key: 'epochSeconds' | 'epochMs' | 'iso' | 'local'; label: string }[] = [
    { key: 'epochSeconds', label: 'Epoch s' },
    { key: 'epochMs', label: 'Epoch ms' },
    { key: 'iso', label: 'ISO 8601' },
    { key: 'local', label: 'Local' },
];

export function TimestampCard() {
    const [nowMs, setNowMs] = useState(() => Date.now());
    const [text, setText] = useState(() => String(Math.trunc(Date.now() / 1000)));

    const result = parseTimestamp(text, nowMs);

    const setNow = () => {
        const stamp = Date.now();
        setNowMs(stamp);
        setText(String(Math.trunc(stamp / 1000)));
    };

    return (
        <div className={cardBodyClass}>
            <div className="flex flex-wrap items-center gap-2">
                <input
                    type="text"
                    value={text}
                    onChange={e => setText(e.target.value)}
                    spellCheck={false}
                    placeholder="Epoch seconds/ms, or an ISO date"
                    aria-label="Timestamp"
                    data-testid="timestamp-input"
                    className={`${inputClass} flex-1 min-w-[220px] font-mono`}
                />
                <button
                    type="button"
                    onClick={setNow}
                    aria-label="Use current time"
                    data-testid="timestamp-now"
                    className={`${inputClass} px-2 cursor-pointer`}
                >
                    Now
                </button>
            </div>

            {!result.ok ? (
                <p className={errorClass} data-testid="timestamp-error">
                    {result.error}
                </p>
            ) : (
                <>
                    <p className={mutedClass} data-testid="timestamp-detected">
                        Read as {result.value.detectedUnit} · {result.value.relative}
                    </p>
                    <div className="flex flex-col gap-1">
                        {ROWS.map(row => {
                            const value =
                                row.key === 'epochMs'
                                    ? String(result.value.epochMs)
                                    : row.key === 'epochSeconds'
                                      ? String(result.value.epochSeconds)
                                      : result.value[row.key];
                            return (
                                <div key={row.key} className="flex items-center gap-2">
                                    <span className="w-16 flex-shrink-0 text-[10px] uppercase text-[#656d76] dark:text-[#999]">
                                        {row.label}
                                    </span>
                                    <code className={readoutClass} data-testid={`timestamp-${row.key}`}>
                                        {value}
                                    </code>
                                    <CopyButton
                                        text={value}
                                        label={`Copy ${row.label}`}
                                        testId={`timestamp-copy-${row.key}`}
                                    />
                                </div>
                            );
                        })}
                    </div>
                </>
            )}
        </div>
    );
}
