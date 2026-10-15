import { z } from 'zod';
import { parsePullRequestUrl } from '@plusplusoneplusplus/coc-client';

export const MAX_TODO_EXTERNAL_REFERENCES = 20;

export const externalReferenceSchema = z.object({
    kind: z.enum(['pr', 'email', 'link']),
    url: z.string().trim().min(1).max(2_000),
    title: z.string().trim().min(1).max(200).optional(),
}).strict().transform((reference, ctx) => {
    const invalid = () => {
        ctx.addIssue({ code: 'custom', path: ['url'], message: 'A safe supported URL is required for this reference kind' });
        return z.NEVER;
    };
    if (/[\u0000-\u001f\u007f\\]/.test(reference.url)) return invalid();
    if (reference.kind === 'pr') {
        const pr = parsePullRequestUrl(reference.url);
        return pr ? { ...reference, url: pr.url } : invalid();
    }
    let url: URL;
    try { url = new URL(reference.url); } catch { return invalid(); }
    if (url.username || url.password) return invalid();
    if (reference.kind === 'email' && url.protocol === 'mailto:') {
        let recipients: string;
        try { recipients = decodeURIComponent(url.pathname); } catch { return invalid(); }
        if (!recipients.split(',').every(address => /^[^\s<>@,/?#]+@[^\s<>@,/?#]+\.[^\s<>@,/?#]+$/.test(address))
            || /%0[ad]/i.test(reference.url)) return invalid();
    } else if (!['https:', 'http:'].includes(url.protocol) || !url.hostname) {
        return invalid();
    }
    return { ...reference, url: url.href };
});

export const externalReferencesSchema = z.array(externalReferenceSchema).max(MAX_TODO_EXTERNAL_REFERENCES)
    .transform(references => {
        const seen = new Set<string>();
        return references.filter(reference => {
            const pr = reference.kind === 'pr' ? parsePullRequestUrl(reference.url) : null;
            const key = pr ? `pr:${pr.provider}:${pr.host}:${pr.repoPath.toLowerCase()}:${pr.number}`
                : `${reference.kind}:${reference.url}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    });
