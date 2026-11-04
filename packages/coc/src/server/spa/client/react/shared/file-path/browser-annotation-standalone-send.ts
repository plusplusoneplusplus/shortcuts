import { getCocClientFor } from '../../api/cocClient';
import { parseRemoteCloneKey } from '../../repos/cloneIdentity';
import { resolveCloneRoute } from '../../repos/cloneRegistry';
import { sameChatOwner } from './browser-demo';
import { acknowledgeBrowserAnnotationChips, buildBrowserAnnotationAttachments, formatBrowserAnnotationChips,
    newChatBrowserAnnotationOwner, type BrowserAnnotationChip } from './browser-annotation-chips';

/** Submit to an unmounted linked chat without reading or changing any composer draft. */
export async function sendStandaloneBrowserAnnotation(chip: BrowserAnnotationChip, checkCurrent: () => void): Promise<void> {
    const { workspaceId, routingRef, processId } = chip.owner;
    const unavailable = () => new Error('Open the annotation chat to send this queued comment.');
    if (processId === newChatBrowserAnnotationOwner(workspaceId, routingRef).processId) throw unavailable();
    // Bare local references stay local even when another server has the same workspace ID.
    const route = () => routingRef.startsWith('remote:')
        ? parseRemoteCloneKey(routingRef) ? resolveCloneRoute(routingRef) : { kind: 'unresolved-remote' as const }
        : { kind: 'local' as const };
    const initial = route();
    if (initial.kind === 'unresolved-remote') throw unavailable();
    const client = getCocClientFor(initial.kind === 'remote' ? initial.baseUrl : undefined);
    const attachments = buildBrowserAnnotationAttachments([chip], 0);
    const content = formatBrowserAnnotationChips([chip]);
    const { process } = await client.processes.get(processId, {
        workspace: workspaceId, exclude: ['conversation', 'toolCalls'],
    }, { signal: AbortSignal.timeout(10_000) });
    checkCurrent();
    const current = route();
    if (current.kind !== initial.kind || (initial.kind === 'remote'
        && (current.kind !== 'remote' || current.baseUrl !== initial.baseUrl))) throw unavailable();
    const compaction = process?.metadata?.compaction;
    if (!process || !sameChatOwner(chip.owner, { ...chip.owner, processId: process.id }) || process.metadata?.workspaceId !== workspaceId
        || process.type !== 'chat' || process.status === 'queued' || process.status === 'cancelling'
        || (compaction && typeof compaction === 'object' && 'state' in compaction
            && (compaction.state === 'queued' || compaction.state === 'running'))
        || process.metadata?.mode === 'ralph') throw unavailable();
    // The owning server resolves mode/provider/session and performs final admission.
    // A rejected or uncertain POST leaves the snapshot queued; never retry here.
    await client.processes.sendMessage(process.id, {
        content, deliveryMode: 'enqueue', attachments,
        ...(attachments.length ? { images: attachments.map(image => image.dataUrl) } : {}),
    }, { workspace: workspaceId });
    try { await acknowledgeBrowserAnnotationChips([chip]); }
    catch { throw new Error('Annotation sent, but its page pin could not be removed.'); }
}
