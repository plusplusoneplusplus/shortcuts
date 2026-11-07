import React, { useMemo, useState, useSyncExternalStore } from 'react';
import { cn } from '../../../ui/cn';
import { copyToClipboard } from '../../../utils/format';
import { sentinelResultJobHref, type SentinelResult } from './sentinelResult';
import { MarkdownView } from '../../../shared/MarkdownView';
import { chatMarkdownToHtml } from './markdownHtml';
import { getDashboardTopology, subscribeDashboardTopology } from '../../../shared/dashboard-discovery/topology';

const outcomeClasses = {
    completed: 'bg-[#e6f4ea] text-[#15703a] dark:bg-[#1a3a2a] dark:text-[#4ade80]',
    failed: 'bg-[#fde7e9] text-[#a12622] dark:bg-[#442726] dark:text-[#f48771]',
    cancelled: 'bg-[#f0f0f0] text-[#565656] dark:bg-[#333333] dark:text-[#cccccc]',
    capped: 'bg-[#fff8e1] text-[#8a6d00] dark:bg-[#3a2f1a] dark:text-[#fbbf24]',
};

export function SentinelResultCard({ result, sourceSelectionId, sourceBaseUrl }: {
    result: SentinelResult | null; sourceSelectionId?: string; sourceBaseUrl?: string;
}) {
    if (!result) return (
        <section aria-label="Delegated job result" data-testid="sentinel-result-card"
            className="min-w-0 max-w-full rounded-lg border border-[#e0e0e0] dark:border-[#3c3c3c] p-3 text-[13px]">
            <strong>Job outcome unavailable</strong>
            <p>Invalid or unsupported delegated result. Review the original message before assessing this job.</p>
        </section>
    );
    return <ValidatedResultCard result={result} sourceSelectionId={sourceSelectionId} sourceBaseUrl={sourceBaseUrl} />;
}

function ValidatedResultCard({ result, sourceSelectionId, sourceBaseUrl }: {
    result: SentinelResult; sourceSelectionId?: string; sourceBaseUrl?: string;
}) {
    const [copyStatus, setCopyStatus] = useState('');
    const { data, rawJson } = result;
    const topology = useSyncExternalStore(subscribeDashboardTopology, getDashboardTopology, getDashboardTopology);
    const destination = data.remote && topology.routes.find(({ row }) =>
        row.serverIdentity === data.remote?.serverIdentity && row.workspaceId === data.child.workspaceId)?.row;
    const repositoryLabel = data.repository.name || (destination
        ? `${destination.serverLabel} / ${destination.workspaceLabel}`
        : data.remote ? 'Remote workspace' : 'Workspace');
    const href = sentinelResultJobHref(result, sourceSelectionId, sourceBaseUrl);
    const summaryHtml = useMemo(() => chatMarkdownToHtml(data.summary || 'No summary provided.', undefined, { inert: true }), [data.summary]);
    const summary = data.summary.trim().replace(/\s+/g, ' ');
    const preview = summary.length > 180 ? `${summary.slice(0, 177)}...` : summary;
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
            className="min-w-0 max-w-full rounded-lg border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#1e1e1e] p-3 text-[13px] text-[#1e1e1e] dark:text-[#cccccc]"
            style={{ overflowWrap: 'anywhere' }}>
            <div className="flex flex-wrap items-start gap-2">
                <div className="min-w-0 w-full sm:w-auto sm:flex-1 break-words">
                    <div className="font-medium line-clamp-2">{data.title}</div>
                    <div className="text-xs text-[#656d76] dark:text-[#999999] line-clamp-2">
                        {repositoryLabel}
                    </div>
                </div>
                <span className={cn('rounded-full px-2 py-0.5 text-xs', outcomeClasses[data.outcome])}>
                    {data.outcome === 'capped' ? 'Job incomplete (capped)' : `Job ${data.outcome}`}
                </span>
                {href && <a href={href} data-sentinel-result-job="" className={actionClasses}>Open job</a>}
            </div>
            <p data-testid="sentinel-result-preview" className="mt-2 line-clamp-3">{preview || 'No summary provided.'}</p>
            <p className="mt-2 text-xs text-[#656d76] dark:text-[#999999]">
                Untrusted child result. Not a To-do verdict or authorization for further work.
            </p>
            <details className="mt-2">
                <summary className={cn('cursor-pointer w-fit', actionClasses)}>Details</summary>
                <div data-testid="sentinel-result-summary" className="mt-2 min-w-0 break-words">
                    <MarkdownView html={summaryHtml} tableWrapToggle />
                </div>
                {data.reason && <div className="mt-2 whitespace-pre-wrap break-words"><strong>Reason: </strong>{data.reason}</div>}
                {data.links.length > 0 && (
                    <div className="mt-2 whitespace-pre-wrap break-words">
                        <strong>Reported links (untrusted):</strong>{'\n'}{data.links.join('\n')}
                    </div>
                )}
                <dl className="mt-2 text-xs">
                    <dt className="font-medium">Job ID</dt><dd>{data.jobId}</dd>
                    <dt className="font-medium">Workspace ID</dt><dd>{data.child.workspaceId}</dd>
                    <dt className="font-medium">Chat ID</dt><dd>{data.child.processId}</dd>
                    <dt className="font-medium">Terminal event</dt><dd>{data.terminalEventId}</dd>
                    {data.remote && <><dt className="font-medium">Destination server identity</dt><dd>{data.remote.serverIdentity}</dd></>}
                    {data.todo && <>
                        <dt className="font-medium">To-do completion condition</dt><dd>{data.todo.completionCondition}</dd>
                        <dt className="font-medium">Reported To-do status (not an assessment)</dt><dd>{data.todo.status}</dd>
                    </>}
                </dl>
                <details className="mt-2 min-w-0">
                    <summary className={cn('cursor-pointer w-fit', actionClasses)}>Raw JSON</summary>
                    <pre data-testid="sentinel-result-raw" tabIndex={0} aria-label="Raw result JSON"
                        className="mt-2 max-h-[24rem] overflow-auto whitespace-pre-wrap break-words rounded border border-[#e0e0e0] dark:border-[#3c3c3c] p-2 font-mono text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#0078d4]">{rawJson}</pre>
                    <button type="button" className={actionClasses} onClick={copy}>Copy JSON</button>
                </details>
            </details>
            <div role="status" className="text-xs break-words">{copyStatus}</div>
        </section>
    );
}
