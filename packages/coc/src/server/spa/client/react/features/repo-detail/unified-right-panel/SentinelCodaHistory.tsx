import { useEffect, useId, useState, type MouseEvent } from 'react';
import type { CocClient, SentinelScrubItemState, SentinelScrubRunDetail, SentinelScrubRunSummary, SentinelTodoItem } from '@plusplusoneplusplus/coc-client';
import { Button } from '../../../ui/Button';
import { Spinner } from '../../../ui/Spinner';
import { ScrubFindingEvidence } from './SentinelCodaFinding';
import type { SentinelTodoOwner } from './sentinelTodoPanelModel';

type ChatLinkProps = {
    owner: SentinelTodoOwner;
    childProcessId?: string;
    onFollowLink: (event: MouseEvent<HTMLAnchorElement>, key: string) => void;
};

export function CodaRunChatLink({ owner, childProcessId, onFollowLink }: ChatLinkProps) {
    if (!childProcessId) return null;
    const key = `scrubber:${childProcessId}`;
    const href = `#repos/${encodeURIComponent(owner.ownerRoutingRef ?? owner.ownerWorkspaceId)}/chats/${encodeURIComponent(childProcessId)}`;
    return <a href={href} data-todo-link={key} onClick={event => onFollowLink(event, key)}
        className="text-[#0078d4] hover:underline focus-visible:ring-1 dark:text-[#3794ff]">Open chat</a>;
}

type Props = Omit<ChatLinkProps, 'childProcessId'> & {
    client: CocClient;
    runs: readonly SentinelScrubRunSummary[];
    items: readonly SentinelTodoItem[];
};

export function SentinelCodaHistory({ runs, ...props }: Props) {
    const [selected, setSelected] = useState<string | null>(null);
    const detailId = useId();
    const run = runs.find(entry => entry.id === selected);
    return <section aria-label="Coda run history" className="flex flex-col gap-2 rounded border border-[#e0e0e0] p-2 dark:border-[#3c3c3c]">
        <h3 className="m-0 text-xs font-semibold">Run history ({runs.length})</h3>
        {!runs.length && <p>No Coda runs yet.</p>}
        <ul className="flex max-h-48 flex-col gap-2 overflow-auto">
            {runs.map(entry => <li key={entry.id} className="flex flex-col gap-1">
                <div><time dateTime={entry.createdAt}>{new Date(entry.createdAt).toLocaleString()}</time>
                    {' · '}{entry.trigger} · {entry.status.replaceAll('_', ' ')}
                    {entry.skipReason && <> · skipped: {entry.skipReason}</>}</div>
                <div>{entry.counts.done} done · {entry.counts.proposals} proposals · {entry.counts.unverified} unverified
                    {' · '}{entry.itemCount} assessed · {entry.deferredCount} deferred · {entry.awaitingReviewCount} awaiting Sentinel review</div>
                {entry.error && <p className="text-[#c72e2e] dark:text-[#f48771]">{entry.error}</p>}
                <div className="flex flex-wrap items-center gap-2">
                    <CodaRunChatLink {...props} childProcessId={entry.childProcessId} />
                    <Button size="sm" variant="secondary" aria-expanded={entry.id === run?.id} aria-controls={detailId}
                        onClick={() => setSelected(selected === entry.id ? null : entry.id)}>Details and change log</Button>
                </div>
            </li>)}
        </ul>
        {run && <RunDetail key={run.id} {...props} summary={run} id={detailId} />}
    </section>;
}

function RunDetail({ client, owner, items, summary, id, onFollowLink }: Omit<Props, 'runs'> & { summary: SentinelScrubRunSummary; id: string }) {
    const [detail, setDetail] = useState<SentinelScrubRunDetail | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [retry, setRetry] = useState(0);
    useEffect(() => {
        const controller = new AbortController();
        setDetail(null);
        setError(null);
        void client.sentinelTodos.scrubber.getRun(owner.ownerWorkspaceId, owner.processId, summary.id, { signal: controller.signal })
            .then(value => { if (!controller.signal.aborted) setDetail(value); })
            .catch(failure => {
                if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Could not load run details.');
            });
        return () => controller.abort();
    }, [client, owner.ownerWorkspaceId, owner.processId, summary, retry]);
    const title = (itemId: string) => items.find(item => item.id === itemId)?.title ?? itemId;
    return <section id={id} aria-label="Coda run detail" className="flex flex-col gap-2 border-t border-[#e0e0e0] pt-2 dark:border-[#3c3c3c]">
        <h4 className="m-0 text-xs font-semibold">Run {summary.id}</h4>
        {error ? <p role="alert">Could not load run details: {error} <Button size="sm" variant="secondary" onClick={() => setRetry(value => value + 1)}>Retry details</Button></p>
            : !detail ? <div role="status" className="flex items-center gap-1"><Spinner size="sm" /> Loading run details...</div>
                : <>
                    <p>{detail.trigger} · {detail.status.replaceAll('_', ' ')}
                        {detail.skipReason && <> · skipped: {detail.skipReason}</>}</p>
                    <CodaRunChatLink owner={owner} childProcessId={detail.childProcessId} onFollowLink={onFollowLink} />
                    {detail.startedAt && <p>Started <time dateTime={detail.startedAt}>{new Date(detail.startedAt).toLocaleString()}</time></p>}
                    {detail.finishedAt && <p>Finished <time dateTime={detail.finishedAt}>{new Date(detail.finishedAt).toLocaleString()}</time></p>}
                    {detail.error && <p className="text-[#c72e2e] dark:text-[#f48771]">{detail.error}</p>}
                    {['cancelled', 'failed', 'timed_out', 'interrupted'].includes(detail.status) && <p>No findings applied by this run.</p>}
                    {detail.deferredItemIds.length > 0 && <p>Deferred to next run: {detail.deferredItemIds.map(title).join(', ')}</p>}
                    {detail.awaitingReviewItemIds.length > 0 && <p>Awaiting Sentinel review: {detail.awaitingReviewItemIds.map(title).join(', ')}</p>}
                    <h4 className="m-0 text-xs font-semibold">Findings and change log</h4>
                    {!detail.findings.length && <p>No findings recorded.</p>}
                    <ul className="flex flex-col gap-2">
                        {detail.findings.map(record => <li key={record.itemId} className="flex flex-col gap-1 rounded border border-[#e0e0e0] p-2 dark:border-[#3c3c3c]">
                            <strong>{title(record.itemId)}</strong>
                            <p>{record.finding.verdict.replaceAll('_', ' ')} · {record.state} · snapshot revision {record.itemRevision}</p>
                            <p>{record.finding.summary}</p>
                            {record.demotedBecause && <p>Proposal only: {record.demotedBecause.replaceAll('_', ' ')}</p>}
                            {record.finding.unverifiedReason && <p>Unverified: {record.finding.unverifiedReason}</p>}
                            <ScrubFindingEvidence finding={record.finding} />
                            {!record.audit.length && <p>No changes recorded for this finding.</p>}
                            <ol className="flex flex-col gap-1">
                                {record.audit.map((entry, index) => <li key={index}>
                                    <p>{entry.action} by {entry.actor} · <time dateTime={entry.at}>{new Date(entry.at).toLocaleString()}</time></p>
                                    {entry.before && <AuditState label="Before" state={entry.before} />}
                                    {entry.after && <AuditState label="After" state={entry.after} />}
                                </li>)}
                            </ol>
                        </li>)}
                    </ul>
                </>}
    </section>;
}

function AuditState({ label, state }: { label: string; state: SentinelScrubItemState }) {
    return <p>{label}: {state.status.replaceAll('_', ' ')} · {state.archived ? 'archived' : 'not archived'} · revision {state.revision}
        {' · '}Outcome: {state.outcome ?? 'None'}</p>;
}
