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

    if (type === 'follow-prompt') {
        const hasFollowMeta = payload.skillName || payload.planFilePath || payload.promptFilePath;
        return (
            <div>
                {hasFollowMeta && (
                    <div className="grid grid-cols-[140px_1fr] gap-x-4 gap-y-2 text-sm mb-3">
                        {payload.skillName && <MetaRow label="Skill Name" value={payload.skillName} />}
                        {payload.promptFilePath && <FilePathValue label="Prompt File" value={payload.promptFilePath} />}
                        {payload.planFilePath && <FilePathValue label="Plan File" value={payload.planFilePath} />}
                    </div>
                )}
                {payload.promptContent && (
                    <>
                        <h3 className="text-sm font-semibold text-[#1e1e1e] dark:text-[#cccccc] mb-2">Prompt</h3>
                        <pre className="max-h-96 overflow-auto p-3 rounded-md text-xs whitespace-pre-wrap break-words bg-[#f3f3f3] dark:bg-[#252526] border border-[#e0e0e0] dark:border-[#3c3c3c]">
                            {payload.promptContent}
                        </pre>
                    </>
                )}
                {payload.additionalContext && (
                    <details className="mt-3">
                        <summary className="cursor-pointer text-sm font-semibold text-[#1e1e1e] dark:text-[#cccccc]">Additional Context</summary>
                        <pre className="max-h-72 overflow-auto p-3 rounded-md text-xs whitespace-pre-wrap break-words bg-[#f3f3f3] dark:bg-[#252526] border border-[#e0e0e0] dark:border-[#3c3c3c] mt-2">
                            {payload.additionalContext}
                        </pre>
                    </details>
                )}
                {imagesSection}
            </div>
        );
    }

    if (type === 'resolve-comments') {
        const commentIds = Array.isArray(payload.commentIds) ? payload.commentIds : [];
        return (
            <div>
                <h3 className="text-sm font-semibold text-[#1e1e1e] dark:text-[#cccccc] mb-2">Resolve Comments Details</h3>
                <div className="grid grid-cols-[140px_1fr] gap-x-4 gap-y-2 text-sm mb-3">
                    {payload.filePath && <FilePathValue label="Document" value={payload.filePath} />}
                    {commentIds.length > 0 && (
                        <MetaRow
                            label="Comments"
                            value={`${commentIds.length} (${commentIds.join(', ')})`}
                            breakAll
                        />
                    )}
                </div>
                {payload.promptTemplate && (
                    <details>
                        <summary className="cursor-pointer text-sm font-semibold text-[#1e1e1e] dark:text-[#cccccc]">Prompt</summary>
                        <pre className="max-h-96 overflow-auto p-3 rounded-md text-xs whitespace-pre-wrap break-words bg-[#f3f3f3] dark:bg-[#252526] border border-[#e0e0e0] dark:border-[#3c3c3c] mt-2">
                            {payload.promptTemplate}
                        </pre>
                    </details>
                )}
                {imagesSection}
            </div>
        );
    }

    if (type === 'chat') {
        return (
            <div>
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

    if (type === 'chat' && payload?.processId) {
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
                {payload.processId && (
                    <div className="grid grid-cols-[140px_1fr] gap-x-4 gap-y-2 text-sm mt-3">
                        <MetaRow label="Parent Process" value={String(payload.processId)} />
                    </div>
                )}
                {imagesSection}
            </div>
        );
    }

    if (type === 'ai-clarification') {
        const hasClariMeta = payload.skillName || payload.instructionType || payload.model || payload.nearestHeading || payload.filePath;
        return (
            <div>
                {hasClariMeta && (
                    <div className="grid grid-cols-[140px_1fr] gap-x-4 gap-y-2 text-sm mb-3">
                        {payload.filePath && <FilePathValue label="File" value={payload.filePath} />}
                        {payload.skillName && <MetaRow label="Skill Name" value={payload.skillName} />}
                        {payload.instructionType && <MetaRow label="Instruction Type" value={payload.instructionType} />}
                        {payload.model && <MetaRow label="Model" value={payload.model} />}
                        {payload.nearestHeading && <MetaRow label="Nearest Heading" value={payload.nearestHeading} />}
                    </div>
                )}
                {payload.selectedText && (
                    <div className="text-xs text-[#848484] mb-2">
                        Selected: <code className="bg-[#f3f3f3] dark:bg-[#252526] px-1 rounded">
                            {payload.selectedText.length > 200 ? payload.selectedText.substring(0, 200) + '...' : payload.selectedText}
                        </code>
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
                {payload.customInstruction && (
                    <details className="mt-3">
                        <summary className="cursor-pointer text-sm font-semibold text-[#1e1e1e] dark:text-[#cccccc]">Custom Instruction</summary>
                        <pre className="max-h-72 overflow-auto p-3 rounded-md text-xs whitespace-pre-wrap break-words bg-[#f3f3f3] dark:bg-[#252526] border border-[#e0e0e0] dark:border-[#3c3c3c] mt-2">
                            {payload.customInstruction}
                        </pre>
                    </details>
                )}
                {imagesSection}
            </div>
        );
    }

    if (type === 'task-generation' || (payload && payload.kind === 'task-generation')) {
        return (
            <div>
                <h3 className="text-sm font-semibold text-[#1e1e1e] dark:text-[#cccccc] mb-2">Task Generation Details</h3>
                <div className="grid grid-cols-[140px_1fr] gap-x-4 gap-y-2 text-sm mb-3">
                    {payload.name && <MetaRow label="Task Name" value={payload.name} />}
                    {payload.targetFolder && <FilePathValue label="Target Folder" value={payload.targetFolder} />}
                    {payload.depth && <MetaRow label="Depth" value={payload.depth} />}
                    {payload.mode && <MetaRow label="Mode" value={payload.mode} />}
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

    if (type === 'code-review') {
        return (
            <div>
                <h3 className="text-sm font-semibold text-[#1e1e1e] dark:text-[#cccccc] mb-2">Code Review Details</h3>
                <div className="grid grid-cols-[140px_1fr] gap-x-4 gap-y-2 text-sm">
                    {payload.commitSha && <MetaRow label="Commit SHA" value={payload.commitSha} />}
                    {payload.diffType && <MetaRow label="Diff Type" value={payload.diffType} />}
                    {payload.rulesFolder && <FilePathValue label="Rules Folder" value={payload.rulesFolder} />}
                </div>
                {imagesSection}
            </div>
        );
    }

    if (type === 'custom' && payload.data) {
        return (
            <div>
                <h3 className="text-sm font-semibold text-[#1e1e1e] dark:text-[#cccccc] mb-2">Payload</h3>
                <pre className="max-h-96 overflow-auto p-3 rounded-md text-xs whitespace-pre-wrap break-words bg-[#f3f3f3] dark:bg-[#252526] border border-[#e0e0e0] dark:border-[#3c3c3c]">
                    {JSON.stringify(payload.data, null, 2)}
                </pre>
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
