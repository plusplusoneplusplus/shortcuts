import { z } from 'zod';
import { normalizeSentinelTodoReferenceUrl, parsePullRequestUrl } from '@plusplusoneplusplus/coc-client';

export const MAX_TODO_EXTERNAL_REFERENCES = 20;

export const externalReferenceSchema = z.object({
    kind: z.enum(['pr', 'email', 'teams', 'slack', 'link']),
    url: z.string().trim().min(1).max(2_000),
    title: z.string().trim().min(1).max(200).optional(),
}).strict().transform((reference, ctx) => {
    const invalid = () => {
        ctx.addIssue({ code: 'custom', path: ['url'], message: 'A safe supported URL is required for this reference kind' });
        return z.NEVER;
    };
    const url = normalizeSentinelTodoReferenceUrl(reference);
    return url ? { ...reference, url } : invalid();
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
