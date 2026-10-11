import { getTaskDef, isRalphTask } from '../../../../../tasks/task-types';
import { normalizeChatMode, WORKFLOW_REGISTRY } from '../../repos/modeConfig';
import { ChatStatusPill } from './ChatStatusPill';
import { getChatRowModeBadgeClasses } from './chat-row-style';
import { getRalphSessionId } from './ralph-session-grouping';

interface JobMetadata {
    type?: string;
    status?: string;
    executionMode?: string | null;
    mode?: string;
    ralph?: { sessionId: string };
    payload?: { mode?: string; context?: unknown };
    metadata?: { mode?: string; ralph?: unknown };
}

/** Shared status/type/mode metadata for running, queued and pinned rail previews. */
export function RailJobMetadata({ job, status = job.status }: { job: JobMetadata; status?: string }) {
    const mode = job.type === 'chat'
        ? job.executionMode !== undefined
            ? normalizeChatMode(job.executionMode)
            : isRalphTask(job) || getRalphSessionId(job) ? 'ralph' : normalizeChatMode(job.metadata?.mode ?? job.mode ?? job.payload?.mode)
        : undefined;
    const entry = WORKFLOW_REGISTRY.find(candidate => candidate.mode === mode);
    const badgeKey = mode === 'autopilot' ? 'auto'
        : mode === 'ask' || mode === 'ralph' || mode === 'sentinel' ? mode : undefined;
    const typeLabel = getTaskDef(job.type ?? '')?.label || job.type;
    return <>
        {status && <ChatStatusPill status={status} type={job.type} showDuration={false} className="!h-[18px] !text-[10px]" />}
        {entry && <span title={`${entry.label} mode`} data-testid="rail-job-mode"
            className={`${badgeKey ? getChatRowModeBadgeClasses(badgeKey) : `inline-flex items-center border ${entry.border} ${entry.text}`}
                !w-auto !rounded-full !py-0.5 px-1.5 shrink-0 whitespace-nowrap !font-sans !font-medium !normal-case !tracking-normal !text-[10px]`}>
            {entry.label}
        </span>}
        {typeLabel && <span>{typeLabel}</span>}
    </>;
}
