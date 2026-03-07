import { useEffect, useState } from 'react';
import { fetchApi } from '../hooks/useApi';
import { ImageGallery, FilePathLink } from '../shared';

export function MetaRow({ label, value, breakAll }: { label: string; value: string; breakAll?: boolean }) {
    return (
        <>
            <span className="text-[#848484]">{label}</span>
            <span className={`text-[#1e1e1e] dark:text-[#cccccc] ${breakAll ? 'break-all' : ''}`}>{value}</span>
        </>
    );
}

export function FilePathValue({ label, value }: { label: string; value: string }) {
    return (
        <>
            <span className="text-[#848484]">{label}</span>
            <FilePathLink path={value} />
        </>
    );
}

export function PendingTaskPayload({ task }: { task: any }) {
    const payload = task.payload || {};
    const type = task.type || '';
    const [payloadImages, setPayloadImages] = useState<string[]>([]);
    const [payloadImagesLoading, setPayloadImagesLoading] = useState(false);

    useEffect(() => {
        setPayloadImages([]);
        setPayloadImagesLoading(false);
        if (!task?.id || !payload.hasImages || (payload.images && payload.images.length > 0)) return;
        setPayloadImagesLoading(true);
        fetchApi(`/queue/${encodeURIComponent(task.id)}/images`)
            .then((data: any) => { setPayloadImages(data?.images || []); })
            .catch(() => { /* non-fatal */ })
            .finally(() => { setPayloadImagesLoading(false); });
    }, [task?.id, payload.hasImages]);

    const imagesSection = (() => {
        if (payloadImagesLoading) {
            return <ImageGallery images={[]} loading={true} imagesCount={payload.imagesCount} />;
        }
        const imgs = payload.images?.length > 0 ? payload.images : payloadImages;
        if (imgs.length > 0) {
            return <ImageGallery images={imgs} />;
        }
        return null;
    })();

    if (type === 'chat') {
        const ctx = payload.context || {};
        const mode = payload.mode || 'autopilot';
        const hasMeta = ctx.skills?.length || ctx.files?.length || ctx.taskGeneration || ctx.resolveComments || ctx.replication || mode !== 'autopilot';

        // Follow-up message
        if (payload.processId) {
            return (
                <div>
                    {payload.prompt && (
                        <>
                            <h3 className="text-sm font-semibold text-[#1e1e1e] dark:text-[#cccccc] mb-2">Follow-up Message</h3>
                            <pre className="max-h-96 overflow-auto p-3 rounded-md text-xs whitespace-pre-wrap break-words bg-[#f3f3f3] dark:bg-[#252526] border border-[#e0e0e0] dark:border-[#3c3c3c]">
                                {payload.prompt}
                            </pre>
                        </>
                    )}
                    <div className="grid grid-cols-[140px_1fr] gap-x-4 gap-y-2 text-sm mt-3">
                        <MetaRow label="Parent Process" value={String(payload.processId)} />
                    </div>
                    {imagesSection}
                </div>
            );
        }

        // Task generation
        if (ctx.taskGeneration) {
            const tg = ctx.taskGeneration;
            return (
                <div>
                    <h3 className="text-sm font-semibold text-[#1e1e1e] dark:text-[#cccccc] mb-2">Task Generation Details</h3>
                    <div className="grid grid-cols-[140px_1fr] gap-x-4 gap-y-2 text-sm mb-3">
                        {tg.name && <MetaRow label="Task Name" value={tg.name} />}
                        {tg.targetFolder && <FilePathValue label="Target Folder" value={tg.targetFolder} />}
                        {tg.depth && <MetaRow label="Depth" value={tg.depth} />}
                        {tg.mode && <MetaRow label="Mode" value={tg.mode} />}
                        {payload.model && <MetaRow label="Model" value={payload.model} />}
                    </div>
                    {payload.prompt && (
                        <>
                            <h3 className="text-sm font-semibold text-[#1e1e1e] dark:text-[#cccccc] mb-2">Prompt</h3>
                            <pre className="max-h-96 overflow-auto p-3 rounded-md text-xs whitespace-pre-wrap break-words bg-[#f3f3f3] dark:bg-[#252526] border border-[#e0e0e0] dark:border-[#3c3c3c]">
                                {payload.prompt}
                            </pre>
                        </>
                    )}
                    {imagesSection}
                </div>
            );
        }

        // Resolve comments
        if (ctx.resolveComments) {
            const rc = ctx.resolveComments;
            const commentIds = Array.isArray(rc.commentIds) ? rc.commentIds : [];
            return (
                <div>
                    <h3 className="text-sm font-semibold text-[#1e1e1e] dark:text-[#cccccc] mb-2">Resolve Comments Details</h3>
                    <div className="grid grid-cols-[140px_1fr] gap-x-4 gap-y-2 text-sm mb-3">
                        {rc.filePath && <FilePathValue label="Document" value={rc.filePath} />}
                        {commentIds.length > 0 && (
                            <MetaRow
                                label="Comments"
                                value={`${commentIds.length} (${commentIds.join(', ')})`}
                                breakAll
                            />
                        )}
                    </div>
                    {payload.prompt && (
                        <details>
                            <summary className="cursor-pointer text-sm font-semibold text-[#1e1e1e] dark:text-[#cccccc]">Prompt</summary>
                            <pre className="max-h-96 overflow-auto p-3 rounded-md text-xs whitespace-pre-wrap break-words bg-[#f3f3f3] dark:bg-[#252526] border border-[#e0e0e0] dark:border-[#3c3c3c] mt-2">
                                {payload.prompt}
                            </pre>
                        </details>
                    )}
                    {imagesSection}
                </div>
            );
        }

        // Standard chat (with optional context)
        return (
            <div>
                {hasMeta && (
                    <div className="grid grid-cols-[140px_1fr] gap-x-4 gap-y-2 text-sm mb-3">
                        {mode !== 'autopilot' && <MetaRow label="Mode" value={mode} />}
                        {ctx.skills?.length > 0 && <MetaRow label="Skills" value={ctx.skills.join(', ')} />}
                        {ctx.files?.map((f: string, i: number) => <FilePathValue key={i} label={i === 0 ? 'File' : 'Context'} value={f} />)}
                    </div>
                )}
                {payload.prompt && (
                    <>
                        <h3 className="text-sm font-semibold text-[#1e1e1e] dark:text-[#cccccc] mb-2">Prompt</h3>
                        <pre className="max-h-96 overflow-auto p-3 rounded-md text-xs whitespace-pre-wrap break-words bg-[#f3f3f3] dark:bg-[#252526] border border-[#e0e0e0] dark:border-[#3c3c3c]">
                            {payload.prompt}
                        </pre>
                    </>
                )}
                {ctx.blocks?.map((b: any, i: number) => (
                    <details key={i} className="mt-3">
                        <summary className="cursor-pointer text-sm font-semibold text-[#1e1e1e] dark:text-[#cccccc]">{b.label || 'Context'}</summary>
                        <pre className="max-h-72 overflow-auto p-3 rounded-md text-xs whitespace-pre-wrap break-words bg-[#f3f3f3] dark:bg-[#252526] border border-[#e0e0e0] dark:border-[#3c3c3c] mt-2">
                            {b.content}
                        </pre>
                    </details>
                ))}
                {imagesSection}
            </div>
        );
    }

    if (Object.keys(payload).length > 0) {
        return (
            <div>
                <h3 className="text-sm font-semibold text-[#1e1e1e] dark:text-[#cccccc] mb-2">Payload</h3>
                <pre className="max-h-96 overflow-auto p-3 rounded-md text-xs whitespace-pre-wrap break-words bg-[#f3f3f3] dark:bg-[#252526] border border-[#e0e0e0] dark:border-[#3c3c3c]">
                    {JSON.stringify(payload, null, 2)}
                </pre>
                {imagesSection}
            </div>
        );
    }

    return imagesSection;
}
