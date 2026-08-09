/**
 * CronCard — explain a 5-field cron expression and list its next 5 runs.
 *
 * `logic/cron.ts` takes the clock as an argument; this card is the only place
 * that reads it, sampled on mount and on "Refresh" rather than per render so
 * the run list does not shuffle while typing.
 */

import { useState } from 'react';
import { CopyButton } from './CopyButton';
import { explainCron } from './logic/cron';
import { cardBodyClass, errorClass, inputClass, mutedClass, readoutClass } from './styles';

const EXAMPLES = ['0 9 * * 1-5', '*/15 * * * *', '30 3 1 * *'];

export function CronCard() {
    const [nowMs, setNowMs] = useState(() => Date.now());
    const [text, setText] = useState(EXAMPLES[0]!);

    const result = explainCron(text, nowMs, 5);

    return (
        <div className={cardBodyClass}>
            <div className="flex flex-wrap items-center gap-2">
                <input
                    type="text"
                    value={text}
                    onChange={e => setText(e.target.value)}
                    spellCheck={false}
                    placeholder="minute hour day-of-month month day-of-week"
                    aria-label="Cron expression"
                    data-testid="cron-input"
                    className={`${inputClass} flex-1 min-w-[220px] font-mono`}
                />
                <button
                    type="button"
                    onClick={() => setNowMs(Date.now())}
                    aria-label="Recompute next runs from the current time"
                    data-testid="cron-refresh"
                    className={`${inputClass} px-2 cursor-pointer`}
                >
                    Refresh
                </button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
                <span className={mutedClass}>Examples</span>
                {EXAMPLES.map(example => (
                    <button
                        key={example}
                        type="button"
                        onClick={() => setText(example)}
                        data-testid={`cron-example-${example.replace(/[^a-z0-9]+/gi, '-')}`}
                        className={`${inputClass} h-6 px-1.5 text-[11px] font-mono cursor-pointer`}
                    >
                        {example}
                    </button>
                ))}
            </div>

            {!result.ok ? (
                <p className={errorClass} data-testid="cron-error">
                    {result.error}
                </p>
            ) : (
                <>
                    <div className="flex items-center gap-2">
                        <code className={readoutClass} data-testid="cron-description">
                            {result.value.description}
                        </code>
                        <CopyButton
                            text={result.value.description}
                            label="Copy cron description"
                            testId="cron-copy-description"
                        />
                    </div>
                    <div className="flex flex-col gap-1" data-testid="cron-runs">
                        <span className={mutedClass}>Next 5 runs (local time)</span>
                        {result.value.runs.length === 0 ? (
                            <span className={mutedClass} data-testid="cron-runs-empty">
                                This expression never fires
                            </span>
                        ) : (
                            result.value.runs.map((run, index) => (
                                <code key={run.epochMs} className={readoutClass} data-testid={`cron-run-${index}`}>
                                    {run.local}
                                </code>
                            ))
                        )}
                    </div>
                </>
            )}

            <p className={mutedClass}>
                Five fields only — seconds and Quartz-style sixth fields are not supported.
            </p>
        </div>
    );
}
