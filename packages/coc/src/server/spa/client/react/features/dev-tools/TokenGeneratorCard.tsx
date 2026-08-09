/**
 * TokenGeneratorCard — UUID v4 and random hex/base64 tokens.
 *
 * The values are generated on demand (mount and every Generate click) and held
 * in state, so a re-render never silently reshuffles what the user is copying.
 */

import { useState } from 'react';
import { CopyButton } from './CopyButton';
import {
    MAX_TOKEN_BYTES,
    MAX_TOKEN_COUNT,
    MIN_TOKEN_BYTES,
    MIN_TOKEN_COUNT,
    TOKEN_KINDS,
    type TokenKind,
    cryptoRandomSource,
    generateTokens,
} from './logic/tokens';
import { cardBodyClass, errorClass, inputClass, labelClass, mutedClass, readoutClass } from './styles';

export function TokenGeneratorCard() {
    const [kind, setKind] = useState<TokenKind>('uuid');
    const [byteLength, setByteLength] = useState(16);
    const [count, setCount] = useState(1);
    const [result, setResult] = useState(() =>
        generateTokens({ kind: 'uuid', byteLength: 16, count: 1 }, cryptoRandomSource),
    );

    const regenerate = (next: { kind?: TokenKind; byteLength?: number; count?: number }) => {
        const request = {
            kind: next.kind ?? kind,
            byteLength: next.byteLength ?? byteLength,
            count: next.count ?? count,
        };
        setResult(generateTokens(request, cryptoRandomSource));
    };

    const values = result.ok ? result.value : [];

    return (
        <div className={cardBodyClass}>
            <div className="flex flex-wrap items-center gap-2">
                <div className="flex flex-wrap gap-1">
                    {TOKEN_KINDS.map(option => (
                        <button
                            key={option.id}
                            type="button"
                            onClick={() => {
                                setKind(option.id);
                                regenerate({ kind: option.id });
                            }}
                            data-testid={`token-kind-${option.id}`}
                            aria-pressed={kind === option.id}
                            className={`px-2 py-1 rounded text-[11px] border ${
                                kind === option.id
                                    ? 'border-[#0078d4] text-[#0078d4]'
                                    : 'border-[#e0e0e0] dark:border-[#3c3c3c] text-[#656d76] dark:text-[#999]'
                            }`}
                        >
                            {option.label}
                        </button>
                    ))}
                </div>

                {kind !== 'uuid' && (
                    <label className={labelClass}>
                        Bytes
                        <input
                            type="number"
                            min={MIN_TOKEN_BYTES}
                            max={MAX_TOKEN_BYTES}
                            value={byteLength}
                            onChange={e => {
                                const next = Number(e.target.value);
                                setByteLength(next);
                                regenerate({ byteLength: next });
                            }}
                            aria-label="Token length in bytes"
                            data-testid="token-bytes"
                            className={`${inputClass} w-20`}
                        />
                    </label>
                )}

                <label className={labelClass}>
                    Count
                    <input
                        type="number"
                        min={MIN_TOKEN_COUNT}
                        max={MAX_TOKEN_COUNT}
                        value={count}
                        onChange={e => {
                            const next = Number(e.target.value);
                            setCount(next);
                            regenerate({ count: next });
                        }}
                        aria-label="How many to generate"
                        data-testid="token-count"
                        className={`${inputClass} w-16`}
                    />
                </label>

                <button
                    type="button"
                    onClick={() => regenerate({})}
                    data-testid="token-generate"
                    className={`${inputClass} px-2 cursor-pointer`}
                >
                    Generate
                </button>
            </div>

            {!result.ok ? (
                <p className={errorClass} data-testid="token-error">
                    {result.error}
                </p>
            ) : (
                <>
                    <div className="flex flex-col gap-1" data-testid="token-list">
                        {values.map((value, i) => (
                            <div key={`${i}-${value}`} className="flex items-center gap-2">
                                <code className={readoutClass} data-testid={`token-value-${i}`}>
                                    {value}
                                </code>
                                <CopyButton text={value} label={`Copy value ${i + 1}`} testId={`token-copy-${i}`} />
                            </div>
                        ))}
                    </div>
                    {values.length > 1 && (
                        <div className="flex items-center gap-2">
                            <span className={mutedClass}>{values.length} values</span>
                            <CopyButton
                                text={values.join('\n')}
                                label="Copy all values"
                                testId="token-copy-all"
                            />
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
