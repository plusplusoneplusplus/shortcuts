import { Card } from '../ui';

/** Single skeleton card mimicking QueueTaskItem layout. */
export function QueueTaskSkeleton() {
    return (
        <Card className="p-2">
            <div className="flex items-center justify-between gap-1.5">
                <div className="flex items-center gap-1.5 min-w-0 flex-1">
                    <div className="skeleton-shimmer shrink-0 w-3.5 h-3.5 rounded-full" />
                    <div className="skeleton-shimmer h-3 rounded w-2/3" />
                </div>
                <div className="skeleton-shimmer h-2.5 w-10 shrink-0" />
            </div>
            <div className="skeleton-shimmer h-2.5 w-1/2 mt-1" />
        </Card>
    );
}

function SectionSkeleton({ label, count }: { label: string; count: number }) {
    return (
        <div>
            <div className="flex items-center gap-1 text-[11px] uppercase text-[#848484] dark:text-[#a0a0a0] font-medium mb-1">
                ▼ {label} Tasks
            </div>
            <div className="flex flex-col gap-1">
                {Array.from({ length: count }, (_, i) => (
                    <QueueTaskSkeleton key={i} />
                ))}
            </div>
        </div>
    );
}

/** Full skeleton placeholder for the ProcessesView loading state. */
export function ProcessesViewSkeleton({ heightClass }: { heightClass: string }) {
    return (
        <div id="view-processes" className={`${heightClass} p-3 flex flex-col gap-3 overflow-hidden`}>
            <SectionSkeleton label="Running" count={3} />
            <SectionSkeleton label="Queued" count={2} />
        </div>
    );
}
