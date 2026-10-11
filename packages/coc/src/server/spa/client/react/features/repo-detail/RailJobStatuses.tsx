import { ChatStatusPill } from '../chat/ChatStatusPill';
import { getTaskDef } from '../../../../../tasks/task-types';
import type { QueueJob } from '../../queue/hooks/useRepoQueueStats';
import { queueJobHash } from '../../queue/queueJobRoute';
import { RailHoverPreview, RailPreviewRow, type RailControls, type RailPreviewControl } from './RailHoverPreview';

type Status = 'running' | 'queued';

export interface RailJobPreview {
    running: readonly QueueJob[];
    queued: readonly QueueJob[];
    scopeLabel: string;
    /** Concrete dashboard selection, including the owning server for clones. */
    routeId: string;
    /** Includes the transport identity; changing it disposes the preview. */
    scopeKey: string;
}

interface Props extends RailControls {
    runningCount: number;
    queuedCount: number;
    preview?: RailJobPreview;
}

export function RailJobStatuses({ runningCount, queuedCount, preview, ...rail }: Props) {
    const counts = preview
        ? { running: preview.running.length, queued: preview.queued.length }
        : { running: runningCount, queued: queuedCount };
    const control = (status: Status): RailPreviewControl => {
        const running = status === 'running';
        const count = counts[status];
        return {
            key: status,
            count,
            label: `${count} ${status} ${count === 1 ? 'job' : 'jobs'}`,
            heading: running ? 'Running jobs' : 'Queued jobs',
            className: running
                ? 'border-[#b9d9f7] bg-[#eaf4ff] text-[#1878c8] hover:bg-[#dceeff] dark:border-[#245c88] dark:bg-[#152d40] dark:text-[#4daaf0] dark:hover:bg-[#19384f]'
                : 'border-[#efd99c] bg-[#fff8e7] text-[#a06b00] hover:bg-[#fff1cc] dark:border-[#70551c] dark:bg-[#382d16] dark:text-[#e0aa36] dark:hover:bg-[#44371b]',
            badgeClassName: running ? 'bg-[#1878c8]' : 'bg-[#b77900]',
            icon: running ? (
                <span className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none rounded-full border-2 border-current border-r-transparent" aria-hidden="true" />
            ) : (
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M3.5 2h7M3.5 12h7M4 2c0 2.3 1.6 2.7 3 5-1.4 2.3-3 2.7-3 5M10 2c0 2.3-1.6 2.7-3 5 1.4 2.3 3 2.7 3 5" />
                </svg>
            ),
            renderRows: dismiss => preview?.[status].map(job => {
                const pauseMarker = job.kind === 'pause-marker';
                const title = job.displayName || (pauseMarker ? 'Queue pause' : getTaskDef(job.type ?? '')?.label || job.type || 'Job');
                return (
                    <RailPreviewRow
                        key={job.id}
                        title={title}
                        href={pauseMarker ? undefined : queueJobHash(preview.routeId, job)}
                        onOpen={() => dismiss()}
                        meta={<>
                            <ChatStatusPill status={status} showDuration={false} className="!h-[18px] !text-[10px]" />
                            <span>{getTaskDef(job.type ?? '')?.label || job.type}</span>
                            {job.payload?.mode && <span>{job.payload.mode}</span>}
                        </>}
                    />
                );
            }),
        };
    };
    return <RailHoverPreview controls={[control('running'), control('queued')]} scopeLabel={preview?.scopeLabel} {...rail} />;
}
