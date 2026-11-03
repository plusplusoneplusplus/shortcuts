import { serializeBrowserAnnotations } from '@plusplusoneplusplus/coc-client';
import { useMemo, useSyncExternalStore } from 'react';
import { buildScreenshotAttachment } from '../../features/chat/utils/screenshotAttachment';
import type { AttachmentPayload } from '../../types/attachments';
import type { BrowserDemoOwner } from './browser-bridge';
import { sameChatOwner } from './browser-demo';
import type { BrowserAnnotationDeliveryEvent, BrowserAnnotationImage, BrowserAnnotationSelection, BrowserAnnotationSession } from './browser-annotation';

/**
 * Saved page comments queued in one chat composer. In memory only. Each chip
 * keeps the chat and mode instance it was created in: a later chat switch or
 * navigation never retargets it, and removing it only touches its own pin.
 */
export interface BrowserAnnotationChip {
    /** Unique across modes; pin ids are only unique within one mode. */
    key: string;
    id: string;
    /** Matches the page pin while its mode is live. */
    number: number;
    comment: string;
    selection: BrowserAnnotationSelection;
    image?: BrowserAnnotationImage;
    owner: BrowserDemoOwner;
    session: BrowserAnnotationSession;
}

let chips: readonly BrowserAnnotationChip[] = [];
const MAX_SCREENSHOT_CHARACTERS = 64 * 1024 * 1024;
const listeners = new Set<() => void>();

function set(next: readonly BrowserAnnotationChip[]): void {
    chips = next;
    listeners.forEach(listener => listener());
}

/** Pins renumber after a deletion; keep the same mode's chips in step. */
function withoutChip(gone: BrowserAnnotationChip): BrowserAnnotationChip[] {
    return chips.filter(chip => chip !== gone).map(chip => chip.session === gone.session && chip.number > gone.number
        ? { ...chip, number: chip.number - 1 } : chip);
}

/** Apply one mode's page events to the chat it targeted when the mode started. */
export function applyBrowserAnnotationEvents(owner: BrowserDemoOwner, session: BrowserAnnotationSession,
    events: readonly BrowserAnnotationDeliveryEvent[]): void {
    for (const event of events) {
        if (event.type === 'selection') {
            session.retainCapture(event.captureId, event.image);
        } else if (event.type === 'comment') {
            const existing = chips.find(chip => chip.session === session && chip.id === event.id);
            const image = event.selection.captureId
                ? existing?.selection.captureId === event.selection.captureId && existing.image
                    ? existing.image : session.takeCapture(event.selection.captureId)
                : undefined;
            const total = chips.reduce((size, chip) => size + (chip === existing ? 0 : chip.image?.dataUrl.length ?? 0), 0);
            if (total + (image?.dataUrl.length ?? 0) > MAX_SCREENSHOT_CHARACTERS) {
                throw new Error('Browser annotation screenshots are full. Send or remove queued comments before annotating again.');
            }
            const chip: BrowserAnnotationChip = { key: `${session.identity.requestId}:${event.id}`, id: event.id,
                number: event.number, comment: event.comment, selection: event.selection, image, owner, session };
            set(existing ? chips.map(other => other === existing ? chip : other) : [...chips, chip]);
        } else if (event.type === 'delete') {
            const existing = chips.find(chip => chip.session === session && chip.id === event.id);
            if (existing) set(withoutChip(existing));
        } else if (event.type === 'exit') {
            session.retainCapture(undefined, undefined);
        }
    }
}

/** Removing a chip removes its pin while that mode is still live; a later mode is never touched. */
export function removeBrowserAnnotationChip(key: string): Promise<void> {
    const chip = chips.find(other => other.key === key);
    if (!chip) return Promise.resolve();
    set(withoutChip(chip));
    return chip.session.remove(chip.id);
}

export function subscribeBrowserAnnotationChips(listener: () => void): () => void {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}

export function getBrowserAnnotationChips(owner: BrowserDemoOwner | null | undefined): BrowserAnnotationChip[] {
    return owner ? chips.filter(chip => sameChatOwner(chip.owner, owner)) : [];
}

export function useBrowserAnnotationChips(owner: BrowserDemoOwner | null | undefined): BrowserAnnotationChip[] {
    const all = useSyncExternalStore(subscribeBrowserAnnotationChips, () => chips, () => chips);
    const workspaceId = owner?.workspaceId;
    const routingRef = owner?.routingRef;
    const processId = owner?.processId;
    return useMemo(() => workspaceId && routingRef && processId
        ? all.filter(chip => sameChatOwner(chip.owner, { workspaceId, routingRef, processId })) : [],
    [all, workspaceId, routingRef, processId]);
}

export function resetBrowserAnnotationChipsForTest(): void {
    set([]);
}

function groupChips(snapshot: readonly BrowserAnnotationChip[]): BrowserAnnotationChip[][] {
    const groups = new Map<BrowserAnnotationSession, BrowserAnnotationChip[]>();
    for (const chip of snapshot) {
        const group = groups.get(chip.session) ?? [];
        group.push(chip);
        groups.set(chip.session, group);
    }
    return [...groups.values()];
}

function screenshotName(groupIndex: number, chip: BrowserAnnotationChip): string {
    return `browser-annotation-group-${groupIndex + 1}-pin-${chip.number}.png`;
}

/** Use the composer's screenshot validator without moving images into mutable draft state. */
export function buildBrowserAnnotationAttachments(snapshot: readonly BrowserAnnotationChip[], currentCount: number): AttachmentPayload[] {
    return groupChips(snapshot).flatMap((group, index) => group.filter(chip => chip.image).map(chip => {
        const { attachment, error } = buildScreenshotAttachment(chip.image!.dataUrl, currentCount++);
        if (!attachment) throw new Error(`Browser annotation #${chip.number}: ${error}`);
        return { name: screenshotName(index, chip), mimeType: attachment.mimeType,
            size: attachment.size, dataUrl: attachment.dataUrl };
    }));
}

/** Keep each page mode's pin numbering independent, including chips retained after navigation. */
export function formatBrowserAnnotationChips(snapshot: readonly BrowserAnnotationChip[]): string {
    const groups = groupChips(snapshot);
    return groups.map((group, index) => [
        ...(groups.length > 1 ? [`Browser annotation group ${index + 1}`] : []),
        ...group.filter(chip => chip.image).map(chip => `Pin #${chip.number} screenshot: ${screenshotName(index, chip)}`),
        serializeBrowserAnnotations(group),
    ].join('\n')).join('\n\n');
}

/** Accepted messages consume only unchanged snapshot entries, preserving edits made during admission. */
export async function acknowledgeBrowserAnnotationChips(snapshot: readonly BrowserAnnotationChip[]): Promise<void> {
    const consumed = new Set(snapshot.filter(chip => chips.includes(chip)));
    if (!consumed.size) return;
    const remaining = chips.filter(chip => !consumed.has(chip));
    set(remaining.map(chip => {
        const number = chip.number - [...consumed].filter(gone =>
            gone.session === chip.session && gone.number < chip.number).length;
        return number === chip.number ? chip : { ...chip, number };
    }));
    const results = await Promise.allSettled([...consumed].map(chip => chip.session.remove(chip.id)));
    const failure = results.find(result => result.status === 'rejected');
    if (failure?.status === 'rejected') throw failure.reason;
}
