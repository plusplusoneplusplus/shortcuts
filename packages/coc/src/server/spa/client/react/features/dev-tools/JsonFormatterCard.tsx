/**
 * JsonFormatterCard — pretty-print, minify and validate JSON.
 *
 * JSON only: the repo has no YAML parser and the panel adds no dependencies,
 * so the card is named for what it actually does.
 */

import { useState } from 'react';
import { CopyButton } from './CopyButton';
import {
    MAX_JSON_INDENT,
    MIN_JSON_INDENT,
    describeJson,
    formatJson,
    minifyJson,
    parseJson,
} from './logic/jsonFormatter';
import { cardBodyClass, errorClass, inputClass, labelClass, mutedClass, textareaClass } from './styles';

const SAMPLE = '{"name":"coc","tags":["dev","tools"],"nested":{"ok":true}}';

export function JsonFormatterCard() {
    const [text, setText] = useState(SAMPLE);
    const [indent, setIndent] = useState(2);
    const [mode, setMode] = useState<'format' | 'minify'>('format');

    const result = mode === 'minify' ? minifyJson(text) : formatJson(text, indent);
    const parsed = parseJson(text);
    const stats = parsed.ok && result.ok ? describeJson(parsed.value, result.value) : null;

    return (
        <div className={cardBodyClass}>
            <textarea
                value={text}
                onChange={e => setText(e.target.value)}
                spellCheck={false}
                placeholder="Paste JSON"
                aria-label="JSON input"
                data-testid="json-input"
                className={textareaClass}
            />

            <div className="flex flex-wrap items-center gap-2">
                <button
                    type="button"
                    onClick={() => setMode('format')}
                    aria-pressed={mode === 'format'}
                    data-testid="json-mode-format"
                    className={`${inputClass} px-2 cursor-pointer ${mode === 'format' ? 'border-[#0078d4] text-[#0078d4]' : ''}`}
                >
                    Format
                </button>
                <button
                    type="button"
                    onClick={() => setMode('minify')}
                    aria-pressed={mode === 'minify'}
                    data-testid="json-mode-minify"
                    className={`${inputClass} px-2 cursor-pointer ${mode === 'minify' ? 'border-[#0078d4] text-[#0078d4]' : ''}`}
                >
                    Minify
                </button>
                {mode === 'format' && (
                    <label className={labelClass}>
                        Indent
                        <input
                            type="number"
                            min={MIN_JSON_INDENT}
                            max={MAX_JSON_INDENT}
                            value={indent}
                            onChange={e => setIndent(Number(e.target.value))}
                            aria-label="Indent width"
                            data-testid="json-indent"
                            className={`${inputClass} w-16`}
                        />
                    </label>
                )}
                {result.ok && <CopyButton text={result.value} label="Copy JSON output" testId="json-copy" />}
            </div>

            {!result.ok ? (
                <p className={errorClass} data-testid="json-error">
                    {result.error}
                </p>
            ) : (
                <>
                    <pre
                        className="max-h-64 overflow-auto px-2 py-1 rounded bg-[#f6f8fa] dark:bg-[#252526] text-xs font-mono text-[#1e1e1e] dark:text-[#cccccc] whitespace-pre-wrap break-all"
                        data-testid="json-output"
                    >
                        {result.value}
                    </pre>
                    {stats && (
                        <p className={mutedClass} data-testid="json-stats">
                            {stats.bytes} bytes · {stats.keys} keys · depth {stats.depth}
                        </p>
                    )}
                </>
            )}
        </div>
    );
}
