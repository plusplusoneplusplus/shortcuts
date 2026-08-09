/**
 * ByteSizeCard — one size in, both unit families out.
 *
 * Decimal (KB = 1000 B) and binary (KiB = 1024 B) columns are always shown side
 * by side, since the whole point of the tool is telling the two apart.
 */

import { useState } from 'react';
import { CopyButton } from './CopyButton';
import { convertByteSize, type ByteSizeRow } from './logic/byteSize';
import { cardBodyClass, errorClass, inputClass, mutedClass, readoutClass } from './styles';

function UnitColumn({ title, rows, family }: { title: string; rows: ByteSizeRow[]; family: string }) {
    return (
        <div className="flex-1 min-w-[160px] flex flex-col gap-1" data-testid={`bytes-${family}`}>
            <span className={mutedClass}>{title}</span>
            {rows.map(row => (
                <div key={row.unit} className="flex items-center gap-2">
                    <span className="w-10 flex-shrink-0 text-[10px] text-[#656d76] dark:text-[#999]">
                        {row.unit}
                    </span>
                    {/* The family prefix keeps the two "B" rows from colliding on one testid. */}
                    <code className={readoutClass} data-testid={`bytes-${family}-${row.unit.toLowerCase()}`}>
                        {row.text}
                    </code>
                </div>
            ))}
        </div>
    );
}

export function ByteSizeCard() {
    const [text, setText] = useState('1536');
    const result = convertByteSize(text);

    return (
        <div className={cardBodyClass}>
            <div className="flex flex-wrap items-center gap-2">
                <input
                    type="text"
                    value={text}
                    onChange={e => setText(e.target.value)}
                    spellCheck={false}
                    placeholder="e.g. 1536, 1.5 MiB, 2GB"
                    aria-label="Size"
                    data-testid="bytes-input"
                    className={`${inputClass} flex-1 min-w-[180px] font-mono`}
                />
                {result.ok && (
                    <CopyButton
                        text={String(result.value.bytes)}
                        label="Copy byte count"
                        testId="bytes-copy"
                    />
                )}
            </div>

            {!result.ok ? (
                <p className={errorClass} data-testid="bytes-error">
                    {result.error}
                </p>
            ) : (
                <>
                    <p className={mutedClass} data-testid="bytes-summary">
                        {result.value.bytes} bytes · {result.value.humanDecimal} ·{' '}
                        {result.value.humanBinary}
                    </p>
                    <div className="flex flex-wrap gap-4">
                        <UnitColumn title="Decimal (×1000)" rows={result.value.decimal} family="decimal" />
                        <UnitColumn title="Binary (×1024)" rows={result.value.binary} family="binary" />
                    </div>
                </>
            )}
        </div>
    );
}
