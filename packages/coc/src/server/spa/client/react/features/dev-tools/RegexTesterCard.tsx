/**
 * RegexTesterCard — pattern + flags + subject, with the matches highlighted in
 * place and listed with their capture groups.
 */

import { useState } from 'react';
import { REGEX_FLAGS, runRegex } from './logic/regexTester';
import { cardBodyClass, errorClass, inputClass, labelClass, mutedClass, textareaClass } from './styles';

const DEFAULT_PATTERN = '(\\w+)@(\\w+)\\.com';
const DEFAULT_SUBJECT = 'mail ada@example.com or grace@test.com';

export function RegexTesterCard() {
    const [pattern, setPattern] = useState(DEFAULT_PATTERN);
    const [flags, setFlags] = useState('g');
    const [subject, setSubject] = useState(DEFAULT_SUBJECT);

    const result = runRegex(pattern, flags, subject);

    const toggleFlag = (flag: string) => {
        setFlags(current => (current.includes(flag) ? current.replace(flag, '') : current + flag));
    };

    return (
        <div className={cardBodyClass}>
            <div className="flex flex-wrap items-center gap-2">
                <input
                    type="text"
                    value={pattern}
                    onChange={e => setPattern(e.target.value)}
                    spellCheck={false}
                    placeholder="pattern"
                    aria-label="Pattern"
                    data-testid="regex-pattern"
                    className={`${inputClass} flex-1 min-w-[200px] font-mono`}
                />
                <div className="flex flex-wrap gap-1" data-testid="regex-flags">
                    {REGEX_FLAGS.map(option => (
                        <button
                            key={option.flag}
                            type="button"
                            onClick={() => toggleFlag(option.flag)}
                            title={option.label}
                            aria-label={`Flag ${option.flag} (${option.label})`}
                            aria-pressed={flags.includes(option.flag)}
                            data-testid={`regex-flag-${option.flag}`}
                            className={`w-7 h-7 rounded text-[11px] font-mono border ${
                                flags.includes(option.flag)
                                    ? 'border-[#0078d4] text-[#0078d4]'
                                    : 'border-[#e0e0e0] dark:border-[#3c3c3c] text-[#656d76] dark:text-[#999]'
                            }`}
                        >
                            {option.flag}
                        </button>
                    ))}
                </div>
            </div>

            <label className={`${labelClass} flex-col items-stretch gap-1`}>
                Test string
                <textarea
                    value={subject}
                    onChange={e => setSubject(e.target.value)}
                    spellCheck={false}
                    aria-label="Test string"
                    data-testid="regex-subject"
                    className={textareaClass}
                />
            </label>

            {!result.ok ? (
                <p className={errorClass} data-testid="regex-error">
                    {result.error}
                </p>
            ) : (
                <>
                    <p className={mutedClass} data-testid="regex-count">
                        {result.value.matches.length} match
                        {result.value.matches.length === 1 ? '' : 'es'}
                    </p>

                    <p
                        className="px-2 py-1 rounded bg-[#f6f8fa] dark:bg-[#252526] text-xs font-mono whitespace-pre-wrap break-all text-[#1e1e1e] dark:text-[#cccccc]"
                        data-testid="regex-highlight"
                    >
                        {result.value.segments.map((segment, i) =>
                            segment.match ? (
                                <mark
                                    key={i}
                                    className="rounded bg-[#fff8c5] dark:bg-[#3f2e00] text-[#1e1e1e] dark:text-[#e3b341]"
                                >
                                    {segment.text}
                                </mark>
                            ) : (
                                <span key={i}>{segment.text}</span>
                            ),
                        )}
                    </p>

                    {result.value.matches.length > 0 && (
                        <div className="flex flex-col gap-1" data-testid="regex-matches">
                            {result.value.matches.map((match, i) => (
                                <div key={i} className="flex flex-wrap items-baseline gap-2 text-xs font-mono">
                                    <span className={mutedClass}>@{match.start}</span>
                                    <span
                                        className="text-[#1e1e1e] dark:text-[#cccccc]"
                                        data-testid={`regex-match-${i}`}
                                    >
                                        {match.text}
                                    </span>
                                    {match.captures.map(capture => (
                                        <span
                                            key={capture.index}
                                            className={mutedClass}
                                            data-testid={`regex-match-${i}-group-${capture.index}`}
                                        >
                                            ${capture.index}={capture.text ?? '—'}
                                        </span>
                                    ))}
                                </div>
                            ))}
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
