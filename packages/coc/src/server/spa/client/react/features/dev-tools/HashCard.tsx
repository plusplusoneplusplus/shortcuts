/**
 * HashCard — SHA-1 / SHA-256 / SHA-512 hex digests of the input's UTF-8 bytes.
 *
 * `crypto.subtle.digest` is async, so the digests are computed in an effect and
 * a stale run is dropped via a cancellation flag — otherwise fast typing can
 * land an older digest on top of a newer one. MD5 is deliberately absent (see
 * `logic/hash.ts`) and the card says so.
 */

import { useEffect, useState } from 'react';
import { CopyButton } from './CopyButton';
import { HASH_ALGORITHMS, type HashAlgorithm, type HashResult, hashAll } from './logic/hash';
import { cardBodyClass, errorClass, mutedClass, readoutClass, textareaClass } from './styles';

type Digests = Partial<Record<HashAlgorithm, HashResult>>;

export function HashCard() {
    const [text, setText] = useState('abc');
    const [digests, setDigests] = useState<Digests>({});

    useEffect(() => {
        let cancelled = false;
        void hashAll(text).then(result => {
            if (!cancelled) setDigests(result);
        });
        return () => {
            cancelled = true;
        };
    }, [text]);

    return (
        <div className={cardBodyClass}>
            <textarea
                value={text}
                onChange={e => setText(e.target.value)}
                spellCheck={false}
                placeholder="Text to hash"
                aria-label="Hash input"
                data-testid="hash-input"
                className={textareaClass}
            />

            <div className="flex flex-col gap-1">
                {HASH_ALGORITHMS.map(algorithm => {
                    const result = digests[algorithm];
                    const id = algorithm.toLowerCase();
                    return (
                        <div key={algorithm} className="flex items-center gap-2">
                            <span className="w-16 flex-shrink-0 text-[10px] uppercase text-[#656d76] dark:text-[#999]">
                                {algorithm}
                            </span>
                            {result && !result.ok ? (
                                <span className={errorClass} data-testid={`hash-error-${id}`}>
                                    {result.error}
                                </span>
                            ) : (
                                <>
                                    <code className={readoutClass} data-testid={`hash-${id}`}>
                                        {result?.ok ? result.value : '…'}
                                    </code>
                                    {result?.ok && (
                                        <CopyButton
                                            text={result.value}
                                            label={`Copy ${algorithm}`}
                                            testId={`hash-copy-${id}`}
                                        />
                                    )}
                                </>
                            )}
                        </div>
                    );
                })}
            </div>

            <p className={mutedClass} data-testid="hash-md5-note">
                MD5 is omitted: WebCrypto does not implement it, and it is unsafe for anything but legacy checksums.
            </p>
        </div>
    );
}
