import { useContext, useEffect, useLayoutEffect, useRef, type MouseEvent, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import type { CocClient, SentinelCodaResponse, SentinelTodoItem } from '@plusplusoneplusplus/coc-client';
import { describeCron } from '../../../utils/cron';
import { Button } from '../../../ui/Button';
import { CODA_DETAIL_KEY, RefrainHistoryHostContext } from './SentinelAutomationCard';
import { CodaRunChatLink, RunDetail } from './SentinelCodaHistory';
import type { SentinelTodoOwner } from './sentinelTodoPanelModel';

const MUTED = 'text-[#616161] dark:text-[#9d9d9d]';

type Props = {
    id: string;
    name: string;
    client: CocClient;
    owner: SentinelTodoOwner;
    items: readonly SentinelTodoItem[];
    data: SentinelCodaResponse | null;
    titleRef: RefObject<HTMLButtonElement>;
    onFollowLink: (event: MouseEvent<HTMLAnchorElement>, key: string) => void;
    onClose: () => void;
};

/**
 * Coda's counterpart to the Refrain overview: its schedule plus the current (else latest)
 * run, rendered from the strip's live owner data in To-do's detail column when hosted.
 */
export function SentinelCodaDetails({ id, name, client, owner, items, data, titleRef, onFollowLink, onClose }: Props) {
    const host = useContext(RefrainHistoryHostContext);
    const headingRef = useRef<HTMLHeadingElement>(null);
    const wide = host?.wide ?? true;
    const showing = !host || host.detailOpen;
    useLayoutEffect(() => {
        if (!wide && showing && titleRef.current?.contains(document.activeElement)) headingRef.current?.focus({ preventScroll: true });
    }, [wide, showing]);
    const leave = (clear: boolean) => {
        if (clear) onClose();
        host?.leave(CODA_DETAIL_KEY, clear);
        requestAnimationFrame(() => titleRef.current?.focus({ preventScroll: true }));
    };
    const config = data?.config;
    const active = data?.activeRun;
    const latest = data?.runs[0];
    const details = <section id={id} hidden={!wide && !showing} aria-label={`Details for ${name}`}
        className="sentinel-refrain-run-detail" data-testid="sentinel-coda-details" onKeyDown={event => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            event.stopPropagation();
            leave(true);
        }}>
        <div hidden={wide}><Button size="sm" variant="secondary" onClick={() => leave(false)}>Back to list</Button></div>
        <div className="sentinel-refrain-detail-header">
            <h4 ref={headingRef} tabIndex={-1} className="font-semibold">{name}</h4>
            <Button size="sm" variant="ghost" aria-label="Close Coda details" onClick={() => leave(true)}>×</Button>
        </div>
        {!config ? <p role="status" className={MUTED}>Loading Coda…</p> : <>
            <p className={config.paused ? 'text-[#b5650f] dark:text-[#cca700]' : MUTED}>{config.enabled
                ? config.paused ? `Schedule paused after ${config.consecutiveFailures} failures` : 'Scheduled' : 'Manual only'}</p>
            <dl>
                <div><dt>Schedule</dt><dd>{describeCron(config.cron) || config.cron} (<code>{config.cron}</code>){config.enabled ? '' : ' · off'}</dd></div>
                {config.enabled && !config.paused && config.nextRunAt && <Time label="Next run" value={config.nextRunAt} />}
                <div><dt>Runs</dt><dd>{data.runs.length} retained</dd></div>
            </dl>
            {active ? <>
                <h5 className="font-semibold">Current run: {active.status}</h5>
                <p className={MUTED}>Trigger: {active.trigger} · {active.snapshot.length} item{active.snapshot.length === 1 ? '' : 's'}</p>
                <CodaRunChatLink owner={owner} childProcessId={active.childProcessId} onFollowLink={onFollowLink} />
                <dl>
                    <Time label="Created" value={active.createdAt} />
                    <Time label="Started" value={active.startedAt} />
                </dl>
            </> : latest ? <>
                <h5 className="font-semibold">Latest run: {latest.status.replace(/_/g, ' ')}</h5>
                <RunDetail key={latest.id} client={client} owner={owner} items={items} summary={latest} id={`${id}-latest`} onFollowLink={onFollowLink} />
            </> : <p className={MUTED}>No Coda runs yet. Use Run now to start the first review.</p>}
        </>}
    </section>;
    return host ? host.target ? createPortal(details, host.target) : null : details;
}

/** Leaves the shared host when the strip unmounts or its owner changes. */
export function useLeaveCodaHost() {
    const leave = useContext(RefrainHistoryHostContext)?.leave;
    useEffect(() => () => leave?.(CODA_DETAIL_KEY, true), [leave]);
}

function Time({ label, value }: { label: string; value?: string }): ReactNode {
    return value ? <div><dt>{label}</dt><dd><time dateTime={value}>{new Date(value).toLocaleString()}</time></dd></div> : null;
}
