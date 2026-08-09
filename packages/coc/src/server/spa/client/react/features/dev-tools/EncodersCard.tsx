/**
 * EncodersCard — Base64, URL-component and HTML-entity encode/decode over one
 * shared input box, with the transform picked from a mode row.
 */

import { useState } from 'react';
import { CopyButton } from './CopyButton';
import { ENCODER_MODES, runEncoder, type EncoderMode } from './logic/encoders';
import { cardBodyClass, errorClass, readoutClass, textareaClass } from './styles';

export function EncodersCard() {
    const [mode, setMode] = useState<EncoderMode>('base64-encode');
    const [text, setText] = useState('');

    const result = text ? runEncoder(mode, text) : ({ ok: true, value: '' } as const);

    return (
        <div className={cardBodyClass}>
            <div className="flex flex-wrap gap-1" data-testid="encoder-modes">
                {ENCODER_MODES.map(option => (
                    <button
                        key={option.id}
                        type="button"
                        onClick={() => setMode(option.id)}
                        aria-pressed={mode === option.id}
                        data-testid={`encoder-mode-${option.id}`}
                        className={`px-2 py-0.5 rounded text-[11px] border ${
                            mode === option.id
                                ? 'bg-[#0078d4] border-[#0078d4] text-white'
                                : 'bg-white dark:bg-[#1e1e1e] border-[#e0e0e0] dark:border-[#3c3c3c] text-[#656d76] dark:text-[#999]'
                        }`}
                    >
                        {option.label}
                    </button>
                ))}
            </div>

            <textarea
                value={text}
                onChange={e => setText(e.target.value)}
                spellCheck={false}
                placeholder="Text to transform…"
                aria-label="Encoder input"
                data-testid="encoder-input"
                className={textareaClass}
            />

            {!result.ok && (
                <p className={errorClass} data-testid="encoder-error">
                    {result.error}
                </p>
            )}

            <div className="flex items-start gap-2">
                <code className={readoutClass} data-testid="encoder-output">
                    {result.ok ? result.value : ''}
                </code>
                <CopyButton
                    text={result.ok ? result.value : ''}
                    label="Copy encoder output"
                    testId="encoder-copy"
                />
            </div>
        </div>
    );
}
