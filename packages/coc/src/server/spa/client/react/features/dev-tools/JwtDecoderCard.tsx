/**
 * JwtDecoderCard — split a JWT, decode its header and payload, and surface the
 * time claims.
 *
 * The signature is never verified — that would need the issuer's key, which
 * this panel cannot fetch. The card states it inline so nobody mistakes a
 * successful decode for a valid token.
 */

import { useState } from 'react';
import { CopyButton } from './CopyButton';
import { decodeJwt } from './logic/jwt';
import { cardBodyClass, errorClass, mutedClass, readoutClass, textareaClass } from './styles';

const SAMPLE =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkFkYSBMb3ZlbGFjZSIsImFkbWluIjp0cnVlLCJpYXQiOjE3MDAwMDAwMDAsIm5iZiI6MTcwMDAwMDAwMCwiZXhwIjoxNzAwMDAzNjAwfQ.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk';

const preClass =
    'max-h-48 overflow-auto px-2 py-1 rounded bg-[#f6f8fa] dark:bg-[#252526] text-xs font-mono text-[#1e1e1e] dark:text-[#cccccc] whitespace-pre-wrap break-all';

export function JwtDecoderCard() {
    const [nowMs] = useState(() => Date.now());
    const [text, setText] = useState(SAMPLE);

    const result = decodeJwt(text, nowMs);

    return (
        <div className={cardBodyClass}>
            <textarea
                value={text}
                onChange={e => setText(e.target.value)}
                spellCheck={false}
                placeholder="Paste a JWT"
                aria-label="JWT input"
                data-testid="jwt-input"
                className={textareaClass}
            />

            {!result.ok ? (
                <p className={errorClass} data-testid="jwt-error">
                    {result.error}
                </p>
            ) : (
                <>
                    <div className="flex flex-wrap items-center gap-2">
                        <span
                            data-testid="jwt-status"
                            className={
                                result.value.expired || result.value.notYetValid
                                    ? 'px-1.5 py-0.5 rounded text-[10px] bg-[#ffebe9] dark:bg-[#3d1d1d] text-[#cf222e] dark:text-[#f85149]'
                                    : 'px-1.5 py-0.5 rounded text-[10px] bg-[#e6f4ea] dark:bg-[#1d3324] text-[#1a7f37] dark:text-[#3fb950]'
                            }
                        >
                            {result.value.expired
                                ? 'Expired'
                                : result.value.notYetValid
                                  ? 'Not yet valid'
                                  : result.value.expired === null
                                    ? 'No expiry claim'
                                    : 'Unexpired'}
                        </span>
                        {result.value.algorithm && (
                            <span className={mutedClass} data-testid="jwt-alg">
                                alg {result.value.algorithm}
                            </span>
                        )}
                    </div>

                    <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-2">
                            <span className={mutedClass}>Header</span>
                            <CopyButton
                                text={result.value.headerJson}
                                label="Copy JWT header"
                                testId="jwt-copy-header"
                            />
                        </div>
                        <pre className={preClass} data-testid="jwt-header">
                            {result.value.headerJson}
                        </pre>
                    </div>

                    <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-2">
                            <span className={mutedClass}>Payload</span>
                            <CopyButton
                                text={result.value.payloadJson}
                                label="Copy JWT payload"
                                testId="jwt-copy-payload"
                            />
                        </div>
                        <pre className={preClass} data-testid="jwt-payload">
                            {result.value.payloadJson}
                        </pre>
                    </div>

                    {result.value.times.length > 0 && (
                        <div className="flex flex-col gap-1" data-testid="jwt-times">
                            {result.value.times.map(claim => (
                                <div key={claim.name} className="flex items-center gap-2">
                                    <span className="w-10 flex-shrink-0 text-[10px] uppercase text-[#656d76] dark:text-[#999]">
                                        {claim.name}
                                    </span>
                                    <code className={readoutClass} data-testid={`jwt-time-${claim.name}`}>
                                        {claim.local} · {claim.relative}
                                    </code>
                                </div>
                            ))}
                        </div>
                    )}

                    <p className={mutedClass} data-testid="jwt-signature-note">
                        Signature ({result.value.signature.length} chars) is shown but never verified — that needs the
                        issuer&apos;s key.
                    </p>
                </>
            )}
        </div>
    );
}
