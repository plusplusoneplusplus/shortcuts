import React, { useMemo, useState } from 'react';
import { cn } from '../../../ui/cn';
import { copyToClipboard } from '../../../utils/format';
import { sentinelResultJobHref, type SentinelResult } from './sentinelResult';
import { MarkdownView } from '../../../shared/MarkdownView';
import { chatMarkdownToHtml } from './markdownHtml';

const outcomeClasses = {
    completed: 'bg-[#e6f4ea] text-[#15703a] dark:bg-[#1a3a2a] dark:text-[#4ade80]',
    failed: 'bg-[#fde7e9] text-[#a12622] dark:bg-[#442726] dark:text-[#f48771]',
    cancelled: 'bg-[#f0f0f0] text-[#565656] dark:bg-[#333333] dark:text-[#cccccc]',
    capped: 'bg-[#fff8e1] text-[#8a6d00] dark:bg-[#3a2f1a] dark:text-[#fbbf24]',
};

export function SentinelResultCard({ result, sourceSelectionId, sourceBaseUrl }: {
    result: SentinelResult; sourceSelectionId?: string; sourceBaseUrl?: string;
}) {
    const [copyStatus, setCopyStatus] = useState('');
    const { data, rawJson } = result;
    const href = sentinelResultJobHref(result, sourceSelectionId, sourceBaseUrl);
    const summaryHtml = useMemo(() => chatMarkdownToHtml(data.summary || 'No summary provided.', undefined, { inert: true }), [data.summary]);
    const copy = async () => {
        try {
            await copyToClipboard(rawJson);
            setCopyStatus('JSON copied');
        } catch {
            setCopyStatus('Copy failed. Select and copy the raw JSON.');
        }
    };
    const actionClasses = 'rounded px-2 py-1 text-xs text-[#005a9e] dark:text-[#7bbef3] hover:bg-black/5 dark:hover:bg-white/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#0078d4]';
    return (
        <section aria-label="Delegated job result" data-testid="sentinel-result-card"
            className="min-w-0 max-w-full rounded-lg border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#1e1e1e] p-3 text-[13px] text-[#1e1e1e] dark:text-[#cccccc]">
            <div className="flex flex-wrap items-start gap-2">
                <div className="min-w-0 w-full sm:w-auto sm:flex-1 break-words">
                    <div className="font-medium">{data.title}</div>
                    <div className="text-xs text-[#656d76] dark:text-[#999999]">{data.repository.name || data.repository.workspaceId}</div>
                </div>
                <span className={cn('rounded-full px-2 py-0.5 text-xs', outcomeClasses[data.outcome])}>
                    Job {data.outcome}
                </span>
                {href && <a href={href} data-sentinel-result-job="" className={actionClasses}>Open job</a>}
            </div>
            <details className="mt-2">
                <summary className={cn('cursor-pointer w-fit', actionClasses)}>Details</summary>
                <p className="mt-2 text-xs text-[#656d76] dark:text-[#999999]">
                    Untrusted child result. Not a To-do verdict or authorization for further work.
                </p>
                <div data-testid="sentinel-result-summary" className="mt-2 min-w-0 break-words">
                    <MarkdownView html={summaryHtml} tableWrapToggle />
                </div>
                {data.reason && <div className="mt-2 whitespace-pre-wrap break-words"><strong>Reason: </strong>{data.reason}</div>}
                {data.links.length > 0 && (
                    <div className="mt-2 whitespace-pre-wrap break-words">
                        <strong>Reported links (untrusted):</strong>{'\n'}{data.links.join('\n')}
                    </div>
                )}
            </details>
            <div className="mt-1 flex flex-wrap items-start gap-2">
                <details className="min-w-0 flex-1">
                    <summary className={cn('cursor-pointer w-fit', actionClasses)}>Raw JSON</summary>
                    <pre data-testid="sentinel-result-raw" tabIndex={0} aria-label="Raw result JSON"
                        className="mt-2 max-h-[24rem] overflow-auto whitespace-pre-wrap break-words rounded border border-[#e0e0e0] dark:border-[#3c3c3c] p-2 font-mono text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#0078d4]">{rawJson}</pre>
                </details>
                <button type="button" className={actionClasses} onClick={copy}>Copy JSON</button>
            </div>
            <div role="status" className="text-xs break-words">{copyStatus}</div>
        </section>
    );
}
