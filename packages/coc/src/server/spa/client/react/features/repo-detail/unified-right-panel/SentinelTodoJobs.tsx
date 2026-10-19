import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore, type MouseEvent, type ReactNode } from 'react';
import type { CocClient, RuntimeDashboardConfig, SentinelScheduledJob, SentinelScheduledJobRun, SentinelScheduledJobInput } from '@plusplusoneplusplus/coc-client';
import { useCocClient } from '../../../repos/cloneRouting';
import { resolveCloneRoute } from '../../../repos/cloneRegistry';
import { DASHBOARD_CONFIG_UPDATED_EVENT, isFeatureEnabled } from '../../../utils/config';
import { describeCron } from '../../../utils/cron';
import { Button } from '../../../ui/Button';
import { Dialog } from '../../../ui/Dialog';
import { Spinner } from '../../../ui/Spinner';
import { SentinelTodoJobDialog } from './SentinelTodoJobDialog';
import { SentinelTodoScrubber, type SentinelTodoScrubberProps } from './SentinelTodoScrubber';
import { sentinelTodoOwnerKey, type SentinelTodoOwner } from './sentinelTodoPanelModel';

const MUTED = 'text-[#616161] dark:text-[#9d9d9d]';
const CARD = 'flex min-w-0 flex-col gap-2 rounded border border-[#e0e0e0] p-2 dark:border-[#3c3c3c]';
function subscribeConfig(listener: () => void) {
    window.addEventListener(DASHBOARD_CONFIG_UPDATED_EVENT, listener);
    return () => window.removeEventListener(DASHBOARD_CONFIG_UPDATED_EVENT, listener);
}
const localPolicy = () => [isFeatureEnabled('sentinelEnabled') && isFeatureEnabled('sentinelTodoJobsEnabled'),
    isFeatureEnabled('sentinelTodoScrubberEnabled'), isFeatureEnabled('effortLevelsEnabled')].join(':');
type Policy = { jobs: boolean; scrubber: boolean; effortLevels: boolean };
function place(children: SentinelTodoScrubberProps['children'], node: ReactNode) {
    return typeof children === 'function' ? children(node) : <>{node}{children}</>;
}

/** Policy and requests stay on the exact ledger owner, including group members. */
export function SentinelTodoJobs(props: SentinelTodoScrubberProps) {
    const ref = props.owner.ownerRoutingRef === null ? undefined : props.owner.ownerRoutingRef ?? props.owner.ownerWorkspaceId;
    const client = useCocClient(ref);
    const route = resolveCloneRoute(ref);
    return <OwnedAutomation key={`${sentinelTodoOwnerKey(props.owner)}:${route.kind === 'remote' ? route.baseUrl : route.kind}`}
        {...props} client={client} routeKind={route.kind} baseUrl={route.kind === 'remote' ? route.baseUrl : undefined} />;
}

function OwnedAutomation(props: SentinelTodoScrubberProps & { client: CocClient; routeKind: string; baseUrl?: string }) {
    const local = useSyncExternalStore(subscribeConfig, localPolicy, localPolicy);
    const [remote, setRemote] = useState<Policy | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [retry, setRetry] = useState(0);
    useEffect(() => {
        if (props.routeKind !== 'remote' || props.ready === false) return;
        let generation = 0;
        let disposed = false;
        let read: AbortController | undefined;
        const load = async () => {
            const run = ++generation;
            read?.abort();
            const controller = new AbortController();
            read = controller;
            try {
                const result = await props.client.request<RuntimeDashboardConfig>('/config/runtime', { signal: controller.signal });
                if (!disposed && !controller.signal.aborted && run === generation) {
                    setRemote({ jobs: result.features?.sentinelEnabled === true && result.features?.sentinelTodoJobsEnabled === true,
                        scrubber: result.features?.sentinelTodoScrubberEnabled === true,
                        effortLevels: result.features?.effortLevelsEnabled === true });
                    setError(null);
                }
            } catch (failure) {
                if (!disposed && !controller.signal.aborted && run === generation) {
                    setRemote(null);
                    setError(failure instanceof Error ? failure.message : String(failure));
                }
            }
        };
        const refresh = () => { void load(); };
        refresh();
        const timer = setInterval(refresh, 30_000);
        window.addEventListener(DASHBOARD_CONFIG_UPDATED_EVENT, refresh);
        return () => { disposed = true; generation++; read?.abort(); clearInterval(timer); window.removeEventListener(DASHBOARD_CONFIG_UPDATED_EVENT, refresh); };
    }, [props.client, props.routeKind, props.ready, retry]);
    const [localJobs, localScrubber, localEffortLevels] = local.split(':');
    const policy = props.routeKind === 'local'
        ? { jobs: localJobs === 'true', scrubber: localScrubber === 'true', effortLevels: localEffortLevels === 'true' } : remote;
    if (props.ready === false && props.routeKind !== 'local') return <SentinelTodoScrubber {...props} enabledOverride={false} />;
    if (props.routeKind === 'unresolved-remote' || (props.routeKind === 'remote' && !policy)) {
        return <>{props.toolbar}{place(props.children, <p role={error ? 'alert' : 'status'} className={MUTED}>
            {props.routeKind === 'unresolved-remote' ? 'Jobs unavailable: owning server is not connected.'
                : error ? <>Jobs unavailable: {error} <Button size="sm" variant="secondary" onClick={() => setRetry(value => value + 1)}>Retry jobs</Button></>
                    : 'Loading owning-server automation settings...'}
        </p>)}</>;
    }
    if (!policy?.jobs) return <SentinelTodoScrubber {...props} enabledOverride={policy?.scrubber} />;
    return <SentinelTodoScrubber {...props} builtInRow enabledOverride={policy.scrubber}>
        {scrubber => place(props.children, props.ready === false ? null : <JobsList client={props.client} owner={props.owner} scrubber={scrubber}
            baseUrl={props.baseUrl} effortLevelsEnabled={policy.effortLevels} onFollowLink={props.onFollowLink} />)}
    </SentinelTodoScrubber>;
}

type JobsProps = {
    client: CocClient; owner: SentinelTodoOwner; scrubber: ReactNode; baseUrl?: string;
    /** The owning server's `effortLevels.enabled`, never the page's. */
    effortLevelsEnabled: boolean;
    onFollowLink: (event: MouseEvent<HTMLAnchorElement>, key: string) => void;
};
function JobsList({ client, owner, scrubber, baseUrl, effortLevelsEnabled, onFollowLink }: JobsProps) {
    const id = useId();
    const [open, setOpen] = useState(true);
    const [jobs, setJobs] = useState<SentinelScheduledJob[] | null>(null);
    const [readError, setReadError] = useState<string | null>(null);
    const [actionError, setActionError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [editor, setEditor] = useState<SentinelScheduledJob | 'new' | null>(null);
    const [deleting, setDeleting] = useState<SentinelScheduledJob | null>(null);
    const live = useRef(false);
    const pending = useRef(false);
    const sequence = useRef(0);
    const read = useRef<AbortController | null>(null);
    const api = client.sentinelTodos.jobs;
    const load = useCallback(async (afterMutation = false) => {
        if (!live.current || (pending.current && !afterMutation)) return;
        read.current?.abort();
        const controller = new AbortController();
        read.current = controller;
        const seq = ++sequence.current;
        try {
            const value = await api.list(owner.ownerWorkspaceId, owner.processId, { signal: controller.signal });
            if (live.current && !controller.signal.aborted && seq === sequence.current) {
                setJobs(value.jobs);
                setReadError(null);
            }
        } catch (failure) {
            if (live.current && !controller.signal.aborted && seq === sequence.current) {
                setReadError(failure instanceof Error ? failure.message : String(failure));
            }
        }
    }, [api, owner.ownerWorkspaceId, owner.processId]);
    useEffect(() => {
        live.current = true;
        void load();
        const connection = client.events.connect({ workspaceId: owner.ownerWorkspaceId, onMessage: message => {
            const event = message as { type?: string; workspaceId?: string; processId?: string };
            if (event.type === 'sentinel-jobs-changed' && event.workspaceId === owner.ownerWorkspaceId && event.processId === owner.processId) void load();
        } });
        const timer = setInterval(() => { if (document.visibilityState !== 'hidden') void load(); }, 30_000);
        return () => { live.current = false; sequence.current++; read.current?.abort(); connection.close(); clearInterval(timer); };
    }, [client, load, owner.ownerWorkspaceId, owner.processId]);
    const mutate = async (action: () => Promise<unknown>, success?: () => void): Promise<boolean> => {
        if (pending.current || !live.current) return false;
        pending.current = true;
        read.current?.abort();
        sequence.current++;
        setBusy(true);
        setActionError(null);
        let saved = false;
        try {
            await action();
            if (!live.current) return false;
            saved = true;
            success?.();
        } catch (failure) {
            if (live.current) {
                const conflict = failure !== null && typeof failure === 'object' && 'status' in failure && failure.status === 409;
                setActionError(conflict ? 'Job changed. Review the refreshed job before trying again; your draft is preserved.'
                    : failure instanceof Error ? failure.message : String(failure));
            }
        } finally {
            if (live.current) await load(true);
            pending.current = false;
            if (live.current) setBusy(false);
        }
        return saved;
    };
    const save = (input: SentinelScheduledJobInput) => {
        if (!editor) return Promise.resolve(false);
        return mutate(() => editor === 'new' ? api.create(owner.ownerWorkspaceId, owner.processId, input)
            : api.update(owner.ownerWorkspaceId, owner.processId, editor.id, { ...input, expectedRevision: editor.revision }), () => setEditor(null));
    };
    return <section aria-label="Jobs" data-testid="sentinel-todo-jobs" className="mt-2 flex min-w-0 flex-col gap-2 border-t border-[#e0e0e0] pt-2 text-xs dark:border-[#3c3c3c]">
        <div className="flex flex-wrap items-center gap-2">
            <h3 className="mr-auto font-semibold"><button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen(value => !value)}>
                {open ? '\u25be' : '\u25b8'} Jobs{jobs && ` (${jobs.length}/10)`}
            </button></h3>
            <Button size="sm" variant="secondary" disabled={!jobs || busy || !!readError || jobs.length >= 10} onClick={() => setEditor('new')}>New job</Button>
        </div>
        <div id={id} hidden={!open} className="flex min-w-0 flex-col gap-2">
            {scrubber && <div data-testid="sentinel-jobs-built-in">{scrubber}</div>}
            <p className={MUTED}>Results return to this Sentinel. Schedules use the owning server&apos;s local time; missed runs are not caught up.</p>
            {readError && <p role="alert">Could not load jobs: {readError} <Button size="sm" variant="secondary" onClick={() => void load()}>Refresh jobs</Button></p>}
            {actionError && <p role="alert">{actionError}</p>}
            {!jobs && !readError && <div role="status" className="flex items-center gap-1"><Spinner size="sm" /> Loading jobs...</div>}
            {jobs?.length === 0 && <p className={MUTED}>No user jobs yet. Create a job to run a prompt here on demand or on a schedule.</p>}
            {jobs?.length === 10 && <p role="status" className={MUTED}>10-job limit reached. Delete a job before creating another.</p>}
            {jobs?.map(job => <JobRow key={job.id} job={job} owner={owner} onFollowLink={onFollowLink} disabled={busy || !!readError}
                onEdit={() => { setActionError(null); setEditor(job); }} onDelete={() => { setActionError(null); setDeleting(job); }}
                onRun={() => void mutate(() => api.start(owner.ownerWorkspaceId, owner.processId, job.id))}
                onCancel={() => { if (job.activeRun) void mutate(() => api.cancel(owner.ownerWorkspaceId, owner.processId, job.id, job.activeRun!.id)); }}
                onToggle={() => void mutate(() => api.update(owner.ownerWorkspaceId, owner.processId, job.id, { enabled: !job.enabled, expectedRevision: job.revision }))} />)}
        </div>
        {editor && <SentinelTodoJobDialog key={editor === 'new' ? 'new' : editor.id} job={editor === 'new' ? undefined : editor}
            client={client} baseUrl={baseUrl} effortLevelsEnabled={effortLevelsEnabled} busy={busy} error={actionError} onSave={save} onClose={() => { if (!pending.current) { setEditor(null); setActionError(null); } }} />}
        <Dialog open={!!deleting} title="Delete job" trapFocus onClose={() => { if (!pending.current) setDeleting(null); }} disableClose={busy}>
            <p>Delete {deleting?.name}? Its schedule and retained run history will be removed. Its chat remains available.</p>
            {actionError && <p role="alert">{actionError}</p>}
            <div className="mt-3 flex justify-end gap-2">
                <Button variant="secondary" disabled={busy} onClick={() => setDeleting(null)}>Keep job</Button>
                <Button disabled={busy} onClick={() => {
                    if (deleting) void mutate(() => api.delete(owner.ownerWorkspaceId, owner.processId, deleting.id, { expectedRevision: deleting.revision }), () => setDeleting(null));
                }}>Delete job</Button>
            </div>
        </Dialog>
    </section>;
}

function JobRow({ job, owner, onFollowLink, disabled, onEdit, onDelete, onRun, onCancel, onToggle }: {
    job: SentinelScheduledJob; owner: SentinelTodoOwner; onFollowLink: JobsProps['onFollowLink']; disabled: boolean;
    onEdit: () => void; onDelete: () => void; onRun: () => void; onCancel: () => void; onToggle: () => void;
}) {
    const last = job.runs[0];
    return <article aria-label={job.name} className={CARD} data-testid={`sentinel-job-${job.id}`}>
        <div className="flex flex-wrap items-center gap-1">
            <strong className="mr-auto break-words">{job.name}</strong>
            {job.mode === 'autopilot' && <span className="rounded bg-[#e8912d]/15 px-1.5 text-[#b5650f] dark:text-[#cca700]" title="Can change files and run commands">Autopilot</span>}
            {!job.enabled && <span className={MUTED}>Paused</span>}
        </div>
        <p className={MUTED}>{job.provider} / {job.effortTier ? `${job.effortTier} effort tier` : job.model}{job.effort && ` / ${job.effort}`} · {job.cron ? describeCron(job.cron) || job.cron : 'Manual only'}</p>
        {job.enabled && job.nextRunAt && <p className={MUTED}>Next <time dateTime={job.nextRunAt}>{new Date(job.nextRunAt).toLocaleString()}</time></p>}
        {job.activeRun ? <div role="status" className="flex items-center gap-1"><Spinner size="sm" /> Run #{job.activeRun.runNumber} {job.activeRun.status}</div>
            : last && <p className={last.status === 'failed' || last.status === 'interrupted' ? 'text-[#c72e2e] dark:text-[#f48771]' : MUTED}>
                Last run #{last.runNumber}: {last.status}{last.error && `: ${last.error}`}
            </p>}
        <div className="flex flex-wrap items-center gap-1">
            <Button size="sm" disabled={disabled || !!job.activeRun} onClick={onRun}>Run now</Button>
            {job.activeRun && <Button size="sm" variant="secondary" disabled={disabled} onClick={onCancel}>Cancel</Button>}
            <Button size="sm" variant="secondary" disabled={disabled} onClick={onToggle}>{job.enabled ? 'Pause' : 'Resume'}</Button>
            <Button size="sm" variant="ghost" disabled={disabled || !!job.activeRun} onClick={onEdit}>Edit</Button>
            <Button size="sm" variant="ghost" disabled={disabled || !!job.activeRun} onClick={onDelete}>Delete</Button>
            {job.processId && <JobChatLink owner={owner} processId={job.processId} onFollowLink={onFollowLink}>Open chat</JobChatLink>}
        </div>
        <details>
            <summary className="cursor-pointer">History ({job.runs.length})</summary>
            {!job.runs.length && <p className={MUTED}>No runs yet.</p>}
            <ol className="mt-2 flex max-h-64 flex-col gap-2 overflow-auto">
                {job.runs.map(run => <li key={run.id} className="border-t border-[#e0e0e0] pt-1 dark:border-[#3c3c3c]">
                    <p>#{run.runNumber} · {run.trigger} · {run.status}{run.skipReason && `: ${run.skipReason}`}</p>
                    <RunTime label="Created" value={run.createdAt} />
                    <RunTime label="Started" value={run.startedAt} />
                    <RunTime label="Finished" value={run.finishedAt} />
                    {run.durationMs !== undefined && <p>Duration: {(run.durationMs / 1000).toFixed(1)}s</p>}
                    {run.error && <p className="text-[#c72e2e] dark:text-[#f48771]">{run.error}</p>}
                    <div className="flex flex-wrap gap-2">
                        {job.processId && run.jobTurnHref && <JobChatLink owner={owner} processId={job.processId}
                            href={run.jobTurnHref} onFollowLink={onFollowLink}>Job turn</JobChatLink>}
                        {run.sentinelFollowUpHref && <JobChatLink owner={owner} processId={owner.processId}
                            href={run.sentinelFollowUpHref} onFollowLink={onFollowLink}>Sentinel follow-up</JobChatLink>}
                    </div>
                </li>)}
            </ol>
        </details>
    </article>;
}
function RunTime({ label, value }: { label: string; value?: string }) {
    return value ? <p>{label}: <time dateTime={value}>{new Date(value).toLocaleString()}</time></p> : null;
}
function JobChatLink({ owner, processId, href, children, onFollowLink }: {
    owner: SentinelTodoOwner; processId: string; href?: string; children: ReactNode; onFollowLink: JobsProps['onFollowLink'];
}) {
    // Server links name the raw workspace; UI navigation retains the selected clone.
    const suffix = href?.includes('?') ? href.slice(href.indexOf('?')) : '';
    const target = `#repos/${encodeURIComponent(owner.ownerRoutingRef ?? owner.ownerWorkspaceId)}/chats/${encodeURIComponent(processId)}${suffix}`;
    const key = `sentinel-job:${processId}:${suffix}`;
    return <a href={target} data-todo-link={key} onClick={event => onFollowLink(event, key)}
        className="text-[#0078d4] hover:underline dark:text-[#3794ff]">{children}</a>;
}
