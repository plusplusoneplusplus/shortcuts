import { parseRemoteCloneKey } from '../repos/cloneIdentity';
import { hashSegments, decodeSegment, encodeSegment } from './routePath';

export type WorkResourceKind = 'work-items' | 'pull-requests';
export interface WorkResourceRoute { scopeId: string; ownerId: string; kind: WorkResourceKind; path: string }
export function buildWorkResourceHash(scopeId: string, kind: WorkResourceKind, ownerId = scopeId, path = ''): string {
    return `#repos/${encodeSegment(scopeId)}/panel/${kind}/${encodeSegment(ownerId)}${path ? '/' + path : ''}`;
}
export function parseWorkResourceRoute(hash: string): WorkResourceRoute | null {
    const p = hashSegments(hash);
    if (p[0] !== 'repos' || !p[1] || p[2] !== 'panel' || (p[3] !== 'work-items' && p[3] !== 'pull-requests') || !p[4]) return null;
    const scopeId = decodeSegment(p[1]);
    const ownerId = decodeSegment(p[4]);
    // A panel can never borrow an owner on a different server.
    if (parseRemoteCloneKey(scopeId)?.serverId !== parseRemoteCloneKey(ownerId)?.serverId) return null;
    return { scopeId, ownerId, kind: p[3], path: p.slice(5).join('/') };
}
