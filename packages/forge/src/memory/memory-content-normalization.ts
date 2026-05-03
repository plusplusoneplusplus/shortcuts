import { createHash } from 'crypto';

export function normalizeMemoryCandidateContent(content: string): string {
    return content.trim().replace(/\s+/g, ' ');
}

export function hashMemoryCandidateContent(content: string): string {
    return createHash('sha256').update(normalizeMemoryCandidateContent(content)).digest('hex');
}
