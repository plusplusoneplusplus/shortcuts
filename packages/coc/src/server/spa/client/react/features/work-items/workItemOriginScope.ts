import type { RepoData } from '../../repos/repoGrouping';
import {
    resolveCanonicalOriginId,
    resolveOriginScope,
    resolveRepoOriginScope,
    type OriginScope,
    type OriginScopeInput,
} from '../../repos/originScope';

export type WorkItemOriginScopeInput = OriginScopeInput;

export type WorkItemOriginScope = OriginScope;

export function resolveWorkItemOriginId(input: WorkItemOriginScopeInput): string {
    return resolveCanonicalOriginId(input);
}

export function resolveWorkItemOriginScope(input: WorkItemOriginScopeInput): WorkItemOriginScope {
    return resolveOriginScope(input);
}

export function resolveRepoWorkItemOriginScope(repo: RepoData): WorkItemOriginScope {
    return resolveRepoOriginScope(repo);
}
