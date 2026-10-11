import { createContext, useContext } from 'react';
import type { SentinelScrubFinding, SentinelScrubFindingRecord, SentinelTodoItem } from '@plusplusoneplusplus/coc-client';
import { Button } from '../../../ui/Button';

type FindingAction = 'accept' | 'dismiss' | 'undo';
export const ScrubberFindingsContext = createContext<{
    findings: ReadonlyMap<string, SentinelScrubFindingRecord>;
    busy: boolean;
    act: (record: SentinelScrubFindingRecord, action: FindingAction) => Promise<void>;
    proposalCount: number;
    acceptAll: () => Promise<void>;
}>({ findings: new Map(), busy: false, act: async () => {}, proposalCount: 0, acceptAll: async () => {} });

export function AcceptAllScrubProposals() {
    const { proposalCount, busy, acceptAll } = useContext(ScrubberFindingsContext);
    if (!proposalCount) return null;
    return <Button size="sm" variant="secondary" disabled={busy} onClick={() => { void acceptAll(); }}>Accept all proposals</Button>;
}

const verdictLabels = { done: 'Done', obsolete: 'Obsolete', in_progress: 'In progress', needs_attention: 'Needs attention', unchanged: 'Unchanged', unverified: 'Unverified' };
const demotionLabels = {
    superseded: 'Superseded: item changed during run', user_verdict: 'Newer user verdict',
    manual: 'Manual item: proposal only', evidence_gate: 'Evidence does not meet the auto-Done requirements',
};

/** Finding links are untrusted output; IDs and non-web references remain plain text. */
function webLink(ref: string): string | undefined {
    try { const url = new URL(ref); return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : undefined; }
    catch { return undefined; }
}

export function SentinelTodoScrubFinding({ item }: { item: SentinelTodoItem }) {
    const { findings, busy, act } = useContext(ScrubberFindingsContext);
    const record = findings.get(item.id);
    if (!record || !['applied', 'proposed', 'unverified'].includes(record.state)) return null;
    const appliedRevision = record.audit.find(entry => entry.action === 'applied')?.after?.revision;
    if (record.state === 'applied' && (appliedRevision === undefined || appliedRevision !== item.revision)) return null;
    const stale = record.state === 'proposed' && record.itemRevision !== item.revision;
    const finding = record.finding;
    return <div role="group" aria-label={`Scrubber finding for ${item.title}`} className="flex flex-col gap-1 px-2 pb-1.5 text-[11px]">
        <div className="flex flex-wrap items-center gap-1">
            <span>{record.state === 'applied' ? '✓ Done by scrubber' : record.state === 'proposed'
                ? `◇ Proposal: ${verdictLabels[finding.verdict]} (${finding.confidence})` : '? Unverified'}</span>
            <span>· {record.state === 'unverified' ? finding.unverifiedReason ?? finding.summary : finding.summary}</span>
            {record.state === 'proposed' && <>
                <Button size="sm" variant="secondary" disabled={busy || stale} onClick={() => { void act(record, 'accept'); }}>Accept</Button>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => { void act(record, 'dismiss'); }}>Dismiss</Button>
            </>}
            {record.state === 'applied' && <Button size="sm" variant="secondary" disabled={busy} onClick={() => { void act(record, 'undo'); }}>Undo</Button>}
        </div>
        {stale && <p role="status">Item changed since this proposal. Run a fresh scrub.</p>}
        {record.demotedBecause && <p>{demotionLabels[record.demotedBecause]}</p>}
        <ScrubFindingEvidence finding={finding} />
    </div>;
}

export function ScrubFindingEvidence({ finding }: { finding: SentinelScrubFinding }) {
    return <details>
        <summary className="cursor-pointer rounded focus-visible:ring-1 focus-visible:ring-[#0078d4]">Evidence</summary>
        <p>Confidence: {finding.confidence} · {finding.rationale}</p>
        <ul className="flex flex-col gap-1">
            {finding.evidence.map((entry, index) => {
                const href = webLink(entry.ref);
                return <li key={index} className="break-words">
                    {entry.kind} · {href ? <a href={href} target="_blank" rel="noopener noreferrer" className="text-[#0078d4] hover:underline dark:text-[#3794ff]">{entry.ref}</a> : entry.ref}
                    {' · '}{entry.state.replaceAll('_', ' ')} · checked <time dateTime={entry.checkedAt}>{new Date(entry.checkedAt).toLocaleString()}</time>
                    {entry.observedAt && <> · observed <time dateTime={entry.observedAt}>{new Date(entry.observedAt).toLocaleString()}</time></>}
                </li>;
            })}
        </ul>
    </details>;
}
