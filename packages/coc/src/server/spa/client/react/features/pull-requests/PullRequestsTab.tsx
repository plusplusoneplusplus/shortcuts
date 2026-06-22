/**
 * PullRequestsTab — fetches and renders the redesigned "PR review
 * command queue" left rail plus the PR detail / batch panel right pane.
 *
 * The queue is grouped into two sections (Needs review / Ready after
 * checks) and filtered via pills (All / Mine / Team / Blocked / Ready,
 * plus optional For You suggestions).
 * Real PR data drives the list plus queue row file count and
 * deterministic risk badges.
 *
 * Desktop: resizable split-panel (queue left, detail right).
 * Mobile: single-pane toggle (queue ↔ detail).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CocApiError } from '@plusplusoneplusplus/coc-client';
import type { PullRequestCoworkerRosterEntry, PrSuggestion, RecentOpenedPullRequestEntry } from '@plusplusoneplusplus/coc-client';
import { getSpaCocClientErrorMessage } from '../../api/cocClient';
import { useCocClient } from '../../repos/cloneRouting';
import { resolveCanonicalOriginId } from '../../repos/originScope';
import { useApp } from '../../contexts/AppContext';
import { cn } from '../../ui';
import { useBreakpoint } from '../../hooks/ui/useBreakpoint';
import { useResizablePanel } from '../../hooks/ui/useResizablePanel';
import {
    isFocusedDiffEnabled,
    isPullRequestsAutoClassifyTeamEnabled,
    isPullRequestsSuggestionsEnabled,
    isSessionContextAttachmentsEnabled,
} from '../../utils/config';
import { SHOW_FOCUSED_DIFF } from '../../featureFlags';
import { PullRequestDetail } from './PullRequestDetail';
import { PullRequestRow, type PrClassificationBadgeStatus } from './PullRequestRow';
import { PrQueueFilters } from './PrQueueFilters';
import { PrQueueGroupSection } from './PrQueueGroupSection';
import { createPullRequestContextDragPayload } from '../chat/sessionContextDrag';

import { ProviderConfigPanel } from './ProviderConfigPanel';
import { BatchCommandPanel } from './BatchCommandPanel';
import {
    QUEUE_SECTION_CONFIGS,
    classifyPr,
    classifyQueueSection,
    type QueueSection,
} from './pr-attention-groups';
import { buildQueueFilterCounts, matchesFilter, scopeForFilter } from './pr-derived-data';
import type { QueueFilter, QueueFilterCounts } from './pr-derived-data';
import {
    buildCoworkerRosterCandidates,
    getCoworkerRosterIdentityKey,
    pullRequestMatchesCoworkerRoster,
    type PullRequest,
    type PrStatus,
} from './pr-utils';
import { matchWorkspaceForPrUrl, parsePrInput, type WorkspaceLike } from './pr-open-utils';

export interface PullRequestsTabProps {
    repoId: string;
    workspaceId: string;
    remoteUrl?: string;
}

const PAGE_SIZE = 25;

interface PrListCacheEntry {
    prs: PullRequest[];
    skip: number;
    hasMore: boolean;
    fetchedAt: number | null;
}

const prListCache = new Map<string, PrListCacheEntry>();

type TeamClassificationLookupStatus = 'none' | 'ready' | 'running';

interface TeamClassificationCounts {
    ready: number;
    running: number;
    missing: number;
}

function getPrSelectionId(pr: PullRequest): string {
    return String(pr.number ?? pr.id);
}

function getPrClassificationIdentifier(pr: PullRequest): string | undefined {
    const prNumber = pr.number;
    const headSha = typeof pr.headSha === 'string' ? pr.headSha.trim() : '';
    if (!headSha || prNumber == null) return undefined;
    if (!Number.isSafeInteger(prNumber) || prNumber <= 0) return undefined;
    return `${prNumber}:${headSha}`;
}

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
    return `${count} ${count === 1 ? singular : plural}`;
}

function formatFetchedAt(ts: number, now: number = Date.now()): string {
    const diffMs = now - ts;
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return 'Updated just now';
    if (diffMin < 60) return `Updated ${diffMin} min ago`;
    return `Updated ${Math.floor(diffMin / 60)} hr ago`;
}

const STATUS_FILTER: PrStatus = 'open';
const QUEUE_COLLAPSED_KEY = 'pr-queue-collapsed';
const QUEUE_COLLAPSED_WIDTH = 44;

function loadQueueCollapsed(): boolean {
    try {
        return localStorage.getItem(QUEUE_COLLAPSED_KEY) === 'true';
    } catch {
        return false;
    }
}

function persistQueueCollapsed(value: boolean): void {
    try {
        localStorage.setItem(QUEUE_COLLAPSED_KEY, String(value));
    } catch { /* ignore */ }
}

class PullRequestOpenError extends Error {
    readonly status: number | undefined;

    constructor(message: string, status?: number) {
        super(message);
        this.name = 'PullRequestOpenError';
        this.status = status;
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function extractRecentPrWebUrl(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    if (!trimmed) return undefined;

    try {
        const parsed = new URL(trimmed);
        if ((parsed.protocol === 'http:' || parsed.protocol === 'https:') && !parsed.username && !parsed.password) {
            return trimmed;
        }
    } catch {
        return undefined;
    }
    return undefined;
}

function buildRecentOpenedRecord(pr: unknown, prNumber: number): { number: number; title: string; webUrl?: string } {
    const record = isRecord(pr) ? pr : {};
    const rawTitle = record.title;
    const title = typeof rawTitle === 'string' && rawTitle.trim()
        ? rawTitle.trim()
        : `Pull request #${prNumber}`;
    const webUrl = extractRecentPrWebUrl(record.webUrl) ?? extractRecentPrWebUrl(record.url);
    return {
        number: prNumber,
        title,
        ...(webUrl ? { webUrl } : {}),
    };
}

export function PullRequestsTab({ repoId, workspaceId, remoteUrl }: PullRequestsTabProps) {
    const { state, dispatch } = useApp();
    // Provider-backed PR list/detail calls use origin routes with explicit
    // selected-clone metadata; durable PR state shares the same origin key.
    const cloneClient = useCocClient(workspaceId);
    const originId = useMemo(
        () => resolveCanonicalOriginId({ workspaceId, remoteUrl }),
        [workspaceId, remoteUrl],
    );
    const sessionContextDragEnabled = isSessionContextAttachmentsEnabled();
    const [prs, setPrs] = useState<PullRequest[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [unconfigured, setUnconfigured] = useState<{ detected: string | null; remoteUrl?: string; noCredentials?: boolean } | null>(null);
    const [activeFilter, setActiveFilter] = useState<QueueFilter>('mine');
    const [searchText, setSearchText] = useState('');
    const [hasMore, setHasMore] = useState(false);
    const [fetchedAt, setFetchedAt] = useState<number | null>(null);
    const { isMobile } = useBreakpoint();
    const { width: leftPanelWidth, isDragging, handleMouseDown, handleTouchStart } = useResizablePanel({
        initialWidth: 276,
        minWidth: 200,
        maxWidth: 600,
        storageKey: 'pr-left-panel-width',
    });
    const [mobileShowDetail, setMobileShowDetail] = useState(false);
    const [selectedPrIds, setSelectedPrIds] = useState<Set<string>>(new Set());
    const [anchorPrId, setAnchorPrId] = useState<string | null>(null);
    const [batchMode, setBatchMode] = useState(false);
    const [queueCollapsed, setQueueCollapsed] = useState<boolean>(() => loadQueueCollapsed());
    const [now, setNow] = useState(() => Date.now());

    // ── Open PR by number or URL ────────────────────────────────
    const [openPrInput, setOpenPrInput] = useState('');
    const [openPrError, setOpenPrError] = useState<string | null>(null);
    const [openPrLoading, setOpenPrLoading] = useState(false);
    const [recentOpenedPrs, setRecentOpenedPrs] = useState<RecentOpenedPullRequestEntry[]>([]);
    const [coworkerRoster, setCoworkerRoster] = useState<PullRequestCoworkerRosterEntry[]>([]);
    const [inactiveCoworkerKeys, setInactiveCoworkerKeys] = useState<Set<string>>(new Set());
    const [coworkerPickerKey, setCoworkerPickerKey] = useState('');
    const [coworkerRosterError, setCoworkerRosterError] = useState<string | null>(null);
    const [coworkerRosterSavingKey, setCoworkerRosterSavingKey] = useState<string | null>(null);

    // ── PR suggestions state ─────────────────────────────────────
    const suggestionsEnabled = isPullRequestsSuggestionsEnabled();
    const teamAutoClassificationEnabled = SHOW_FOCUSED_DIFF && isFocusedDiffEnabled() && isPullRequestsAutoClassifyTeamEnabled();
    const [suggestions, setSuggestions] = useState<PrSuggestion[]>([]);
    const [suggestionsLoading, setSuggestionsLoading] = useState(false);
    const [suggestionsStatus, setSuggestionsStatus] = useState<string | null>(null);
    const [suggestionsInfo, setSuggestionsInfo] = useState<string | null>(null);
    const [suggestionsError, setSuggestionsError] = useState<string | null>(null);
    const [suggestionsRankedAt, setSuggestionsRankedAt] = useState<string | null>(null);
    const [teamClassificationStatuses, setTeamClassificationStatuses] = useState<Record<string, TeamClassificationLookupStatus>>({});
    const [teamClassificationLoading, setTeamClassificationLoading] = useState(false);
    const [teamClassificationQueueing, setTeamClassificationQueueing] = useState(false);
    const [teamClassificationError, setTeamClassificationError] = useState<string | null>(null);

    const suggestedPrNumbers = useMemo(
        () => new Set(suggestions.map(s => s.prNumber)),
        [suggestions],
    );

    // Live ticker: refresh the "Updated X min ago" label every 30 s.
    useEffect(() => {
        const id = setInterval(() => setNow(Date.now()), 30_000);
        return () => clearInterval(id);
    }, []);

    const toggleQueueCollapsed= useCallback(() => {
        setQueueCollapsed(prev => {
            const next = !prev;
            persistQueueCollapsed(next);
            if (next) {
                setBatchMode(false);
                setSelectedPrIds(new Set());
                setAnchorPrId(null);
            }
            return next;
        });
    }, []);

    const skipRef = useRef(0);
    const abortRef = useRef<AbortController | null>(null);

    const effectiveScope = scopeForFilter(activeFilter);

    const cacheKey = useMemo(
        () => `${originId}|${STATUS_FILTER}|${effectiveScope}`,
        [originId, effectiveScope],
    );

    const fetchPrs = useCallback((reset = false, force = false) => {
        if (force) {
            prListCache.delete(cacheKey);
        }

        if (reset && !force) {
            const cached = prListCache.get(cacheKey);
            if (cached) {
                setPrs(cached.prs);
                skipRef.current = cached.skip;
                setHasMore(cached.hasMore);
                setFetchedAt(cached.fetchedAt);
                setError(null);
                setUnconfigured(null);
                setLoading(false);
                return;
            }
        }

        if (abortRef.current) abortRef.current.abort();
        const controller = new AbortController();
        abortRef.current = controller;

        const offset = reset ? 0 : skipRef.current;
        setLoading(true);
        if (reset) {
            setError(null);
            setUnconfigured(null);
            setPrs([]);
            skipRef.current = 0;
        }

        cloneClient.pullRequests.listForOrigin(
            originId,
            {
                workspaceId,
                repoId,
                status: STATUS_FILTER,
                scope: effectiveScope,
                top: PAGE_SIZE,
                skip: offset,
                force: force || undefined,
            },
            { signal: controller.signal },
        )
            .then(data => {
                const newPrs = (data.pullRequests ?? []) as PullRequest[];
                const nextSkip = offset + newPrs.length;
                const nextHasMore = newPrs.length === PAGE_SIZE;
                const ts = data.fetchedAt ?? null;

                if (reset) {
                    setPrs(newPrs);
                    prListCache.set(cacheKey, { prs: newPrs, skip: nextSkip, hasMore: nextHasMore, fetchedAt: ts });
                } else {
                    setPrs(prev => {
                        const accumulated = [...prev, ...newPrs];
                        prListCache.set(cacheKey, { prs: accumulated, skip: nextSkip, hasMore: nextHasMore, fetchedAt: ts });
                        return accumulated;
                    });
                }
                skipRef.current = nextSkip;
                setHasMore(nextHasMore);
                setFetchedAt(ts);
            })
            .catch(err => {
                if (err.name === 'AbortError') return;
                if (err instanceof CocApiError && err.status === 401) {
                    const body = err.body as Record<string, unknown> | undefined;
                    if (body?.error === 'unconfigured') {
                        setUnconfigured({ detected: (body.detected as string) ?? null, remoteUrl: body.remoteUrl as string | undefined });
                    } else if (body?.error === 'no-ado-credentials') {
                        setUnconfigured({ detected: 'ADO', noCredentials: true });
                    } else {
                        setError(err.message ?? 'Failed to load pull requests');
                    }
                } else {
                    setError(getSpaCocClientErrorMessage(err, 'Failed to load pull requests'));
                }
            })
            .finally(() => setLoading(false));
    }, [repoId, workspaceId, originId, effectiveScope, cacheKey, cloneClient]);

    // Re-fetch from scratch whenever the active scope changes.
    useEffect(() => {
        fetchPrs(true);
    }, [fetchPrs]);

    useEffect(() => {
        let cancelled = false;
        setRecentOpenedPrs([]);
        cloneClient.pullRequests.listRecentOpenedForOrigin(originId, { workspaceId, repoId })
            .then(data => {
                if (!cancelled) {
                    setRecentOpenedPrs(data.entries ?? []);
                }
            })
            .catch(err => {
                if (!cancelled) {
                    console.warn('Failed to load recently opened pull requests', err);
                }
            });
        return () => { cancelled = true; };
    }, [repoId, workspaceId, originId, cloneClient]);

    useEffect(() => {
        let cancelled = false;
        setCoworkerRoster([]);
        setInactiveCoworkerKeys(new Set());
        setCoworkerPickerKey('');
        setCoworkerRosterError(null);
        cloneClient.pullRequests.listCoworkerRosterForOrigin(originId, { workspaceId, repoId })
            .then(data => {
                if (!cancelled) {
                    setCoworkerRoster(data.entries ?? []);
                }
            })
            .catch(err => {
                if (!cancelled) {
                    console.warn('Failed to load pull request Team roster', err);
                }
            });
        return () => { cancelled = true; };
    }, [repoId, workspaceId, originId, cloneClient]);

    useEffect(() => {
        const rosterKeys = new Set(coworkerRoster.map(getCoworkerRosterIdentityKey));
        setInactiveCoworkerKeys(prev => {
            let changed = false;
            const next = new Set<string>();
            for (const key of prev) {
                if (rosterKeys.has(key)) {
                    next.add(key);
                } else {
                    changed = true;
                }
            }
            return changed ? next : prev;
        });
    }, [coworkerRoster]);

    // Fetch cached suggestions on mount when feature is enabled.
    useEffect(() => {
        if (!suggestionsEnabled) return;
        cloneClient.pullRequests.getSuggestionsForOrigin(originId, { workspaceId, repoId })
            .then(data => {
                setSuggestions(data.suggestions ?? []);
                setSuggestionsRankedAt(data.rankedAt ?? null);
            })
            .catch(() => { /* non-fatal */ });
    }, [repoId, workspaceId, originId, suggestionsEnabled, cloneClient]);

    const handleRefreshSuggestions = useCallback(() => {
        if (suggestionsLoading) return;
        setSuggestionsLoading(true);
        setSuggestionsInfo(null);
        setSuggestionsError(null);
        setSuggestionsStatus('Fetching review history...');
        const client = cloneClient.pullRequests;
        client.refreshReviewHistoryForOrigin(originId, { workspaceId, repoId })
            .then(history => {
                if ((history.reviews ?? []).length === 0) {
                    setSuggestions([]);
                    setSuggestionsRankedAt(null);
                    setSuggestionsStatus(null);
                    setSuggestionsInfo('No past reviewed PRs found yet. Suggestions need review history to learn from.');
                    return null;
                }
                setSuggestionsStatus('Ranking open PRs...');
                return client.refreshSuggestionsForOrigin(originId, { workspaceId, repoId });
            })
            .then(data => {
                if (!data) return;
                setSuggestions(data.suggestions ?? []);
                setSuggestionsRankedAt(data.rankedAt ?? null);
                setSuggestionsStatus('Updated just now');
            })
            .catch(err => {
                setSuggestionsStatus(null);
                setSuggestionsInfo(null);
                setSuggestionsError(getSpaCocClientErrorMessage(err, 'Failed to generate PR suggestions.'));
            })
            .finally(() => setSuggestionsLoading(false));
    }, [repoId, workspaceId, originId, suggestionsLoading, cloneClient]);

    const filteredBySearch = useMemo(() => {
        if (!searchText) return prs;
        const query = searchText.toLowerCase();
        return prs.filter(pr => pr.title.toLowerCase().includes(query));
    }, [prs, searchText]);

    const activeCoworkerRoster = useMemo(
        () => coworkerRoster.filter(entry => !inactiveCoworkerKeys.has(getCoworkerRosterIdentityKey(entry))),
        [coworkerRoster, inactiveCoworkerKeys],
    );

    const coworkerFilterRoster = activeFilter === 'team' ? activeCoworkerRoster : coworkerRoster;

    const coworkerRosterKeys = useMemo(
        () => new Set(coworkerRoster.map(getCoworkerRosterIdentityKey)),
        [coworkerRoster],
    );

    const coworkerCandidates = useMemo(
        () => buildCoworkerRosterCandidates(prs),
        [prs],
    );

    const addableCoworkerCandidates = useMemo(
        () => coworkerCandidates.filter(candidate => !coworkerRosterKeys.has(getCoworkerRosterIdentityKey(candidate))),
        [coworkerCandidates, coworkerRosterKeys],
    );

    const teamAutoClassificationPrs = useMemo(
        () => coworkerRoster.length === 0
            ? []
            : prs.filter(pr => pr.status === 'open' && pullRequestMatchesCoworkerRoster(pr, coworkerRoster)),
        [prs, coworkerRoster],
    );

    const teamAutoClassificationIdentifiers = useMemo(() => {
        const seen = new Set<string>();
        const identifiers: string[] = [];
        for (const pr of teamAutoClassificationPrs) {
            const identifier = getPrClassificationIdentifier(pr);
            if (!identifier || seen.has(identifier)) continue;
            seen.add(identifier);
            identifiers.push(identifier);
        }
        return identifiers;
    }, [teamAutoClassificationPrs]);

    const teamAutoClassificationIdentifiersKey = useMemo(
        () => teamAutoClassificationIdentifiers.join(','),
        [teamAutoClassificationIdentifiers],
    );

    const teamAutoClassificationSkippedMissingHeadSha = useMemo(
        () => teamAutoClassificationPrs.filter(pr => pr.number != null && !getPrClassificationIdentifier(pr)).length,
        [teamAutoClassificationPrs],
    );

    const teamClassificationCounts = useMemo<TeamClassificationCounts>(() => {
        const counts: TeamClassificationCounts = { ready: 0, running: 0, missing: 0 };
        for (const identifier of teamAutoClassificationIdentifiers) {
            const status = teamClassificationStatuses[identifier] ?? 'none';
            if (status === 'ready') counts.ready++;
            else if (status === 'running') counts.running++;
            else counts.missing++;
        }
        return counts;
    }, [teamAutoClassificationIdentifiers, teamClassificationStatuses]);

    const teamClassificationBadgeByPrId = useMemo(() => {
        const badges = new Map<string, PrClassificationBadgeStatus>();
        if (!teamAutoClassificationEnabled) return badges;
        for (const pr of teamAutoClassificationPrs) {
            const identifier = getPrClassificationIdentifier(pr);
            if (!identifier) continue;
            const status = teamClassificationStatuses[identifier] ?? 'none';
            badges.set(getPrSelectionId(pr), status === 'none' ? 'missing' : status);
        }
        return badges;
    }, [teamAutoClassificationEnabled, teamAutoClassificationPrs, teamClassificationStatuses]);

    const teamClassificationMode = !teamAutoClassificationEnabled
        ? 'disabled'
        : teamClassificationQueueing
            ? 'queueing'
            : teamClassificationCounts.running > 0
                ? 'running'
                : teamClassificationCounts.ready > 0 && teamClassificationCounts.missing === 0
                    ? 'ready'
                    : 'idle';

    const teamClassificationSummary = useMemo(() => {
        if (!teamAutoClassificationEnabled) {
            return 'Auto-classification is off in settings.';
        }
        if (teamClassificationQueueing) {
            return 'Queueing Team classifications...';
        }
        if (teamClassificationLoading && teamAutoClassificationIdentifiers.length > 0) {
            return 'Checking classification status...';
        }
        if (teamAutoClassificationPrs.length === 0) {
            return coworkerRoster.length === 0
                ? 'Add Team roster entries to enable auto-classification.'
                : 'No loaded Team PRs to classify.';
        }
        if (teamClassificationCounts.running > 0) {
            return `${pluralize(teamClassificationCounts.running, 'Team PR')} currently classifying.`;
        }
        if (teamClassificationCounts.missing > 0) {
            return `${pluralize(teamClassificationCounts.missing, 'Team PR')} missing classification.`;
        }
        if (teamClassificationCounts.ready > 0) {
            return `${pluralize(teamClassificationCounts.ready, 'cached classification')} available.`;
        }
        if (teamAutoClassificationSkippedMissingHeadSha > 0) {
            return `${pluralize(teamAutoClassificationSkippedMissingHeadSha, 'Team PR')} waiting for a head SHA.`;
        }
        return 'Auto-classification idle.';
    }, [
        coworkerRoster.length,
        teamAutoClassificationEnabled,
        teamAutoClassificationIdentifiers.length,
        teamAutoClassificationPrs.length,
        teamAutoClassificationSkippedMissingHeadSha,
        teamClassificationCounts.missing,
        teamClassificationCounts.ready,
        teamClassificationCounts.running,
        teamClassificationLoading,
        teamClassificationQueueing,
    ]);

    const loadTeamClassificationStatuses = useCallback(async () => {
        if (!teamAutoClassificationEnabled) {
            setTeamClassificationStatuses({});
            setTeamClassificationLoading(false);
            setTeamClassificationError(null);
            return;
        }
        if (teamAutoClassificationIdentifiers.length === 0) {
            setTeamClassificationStatuses({});
            setTeamClassificationLoading(false);
            setTeamClassificationError(null);
            return;
        }

        setTeamClassificationLoading(true);
        setTeamClassificationError(null);
        try {
            const data = await cloneClient.pullRequests.getClassificationBatchStatusForOrigin(originId, {
                type: 'pr',
                identifiers: teamAutoClassificationIdentifiers,
                workspaceId,
                repoId,
            });
            setTeamClassificationStatuses(data.statuses ?? {});
        } catch (err) {
            console.warn('Failed to load Team PR classification status', err);
            setTeamClassificationError(getSpaCocClientErrorMessage(err, 'Failed to load Team classification status.'));
        } finally {
            setTeamClassificationLoading(false);
        }
    }, [repoId, originId, teamAutoClassificationEnabled, teamAutoClassificationIdentifiers, teamAutoClassificationIdentifiersKey, workspaceId, cloneClient]);

    useEffect(() => {
        void loadTeamClassificationStatuses();
    }, [loadTeamClassificationStatuses]);

    const handleClassifyTeamNow = useCallback(async () => {
        if (!teamAutoClassificationEnabled || teamClassificationQueueing || teamAutoClassificationPrs.length === 0) return;

        setTeamClassificationQueueing(true);
        setTeamClassificationError(null);
        try {
            const result = await cloneClient.pullRequests.autoClassifyTeamForOrigin(originId, {
                workspaceId,
                repoId,
                pullRequests: teamAutoClassificationPrs,
            });
            if (result.errors.length > 0) {
                setTeamClassificationError(result.errors[0]?.message ?? 'Some Team classifications could not be queued.');
            }
            await loadTeamClassificationStatuses();
        } catch (err) {
            console.warn('Failed to queue Team PR classifications', err);
            setTeamClassificationError(getSpaCocClientErrorMessage(err, 'Failed to queue Team classifications.'));
        } finally {
            setTeamClassificationQueueing(false);
        }
    }, [
        loadTeamClassificationStatuses,
        repoId,
        originId,
        teamAutoClassificationEnabled,
        teamAutoClassificationPrs,
        teamClassificationQueueing,
        workspaceId,
        cloneClient,
    ]);

    useEffect(() => {
        if (!coworkerPickerKey) return;
        if (addableCoworkerCandidates.some(candidate => getCoworkerRosterIdentityKey(candidate) === coworkerPickerKey)) return;
        setCoworkerPickerKey('');
    }, [addableCoworkerCandidates, coworkerPickerKey]);

    const filteredByPill = useMemo(
        () => filteredBySearch.filter(pr => matchesFilter(pr, activeFilter, { suggestedPrNumbers, coworkerRoster: coworkerFilterRoster })),
        [filteredBySearch, activeFilter, suggestedPrNumbers, coworkerFilterRoster],
    );

    const groupedPrs = useMemo(() => {
        const buckets = new Map<QueueSection, PullRequest[]>();
        for (const config of QUEUE_SECTION_CONFIGS) buckets.set(config.section, []);
        for (const pr of filteredByPill) {
            buckets.get(classifyQueueSection(pr))?.push(pr);
        }
        return QUEUE_SECTION_CONFIGS.map(config => ({
            config,
            prs: buckets.get(config.section) ?? [],
        }));
    }, [filteredByPill]);

    const filterCounts: QueueFilterCounts = useMemo(() => {
        return buildQueueFilterCounts(filteredBySearch, { effectiveScope, suggestedPrNumbers, coworkerRoster: coworkerFilterRoster });
    }, [filteredBySearch, effectiveScope, suggestedPrNumbers, coworkerFilterRoster]);

    const selectedPrs = useMemo(
        () => prs.filter(pr => selectedPrIds.has(getPrSelectionId(pr))),
        [prs, selectedPrIds],
    );

    const dominantGroup = useMemo(() => {
        if (selectedPrs.length === 0) return undefined;
        const tally = new Map<AttentionGroup, number>();
        for (const pr of selectedPrs) {
            const group = classifyPr(pr);
            tally.set(group, (tally.get(group) ?? 0) + 1);
        }
        let bestGroup: AttentionGroup | undefined;
        let bestCount = -1;
        for (const [group, count] of tally) {
            if (count > bestCount) {
                bestGroup = group;
                bestCount = count;
            }
        }
        return bestGroup;
    }, [selectedPrs]);

    function handleFilterChange(next: QueueFilter) {
        setActiveFilter(next);
    }

    function handleToggleCoworker(entry: Pick<PullRequestCoworkerRosterEntry, 'id' | 'displayName'>) {
        const key = getCoworkerRosterIdentityKey(entry);
        if (!key) return;
        setInactiveCoworkerKeys(prev => {
            const next = new Set(prev);
            if (next.has(key)) {
                next.delete(key);
            } else {
                next.add(key);
            }
            return next;
        });
    }

    const handleAddCoworker = useCallback(async () => {
        if (!coworkerPickerKey) {
            setCoworkerRosterError('Select a coworker from loaded pull request authors.');
            return;
        }

        const candidate = addableCoworkerCandidates.find(item => getCoworkerRosterIdentityKey(item) === coworkerPickerKey);
        if (!candidate) {
            setCoworkerRosterError('That coworker is no longer available in the loaded pull requests.');
            setCoworkerPickerKey('');
            return;
        }

        setCoworkerRosterSavingKey('add');
        setCoworkerRosterError(null);
        try {
            const data = await cloneClient.pullRequests.addCoworkerToRosterForOrigin(originId, {
                id: candidate.id,
                displayName: candidate.displayName,
                ...(candidate.email ? { email: candidate.email } : {}),
                ...(candidate.avatarUrl ? { avatarUrl: candidate.avatarUrl } : {}),
            }, { workspaceId, repoId });
            setCoworkerRoster(data.entries ?? []);
            setCoworkerPickerKey('');
        } catch (err) {
            setCoworkerRosterError(getSpaCocClientErrorMessage(err, 'Failed to add coworker to Team roster.'));
        } finally {
            setCoworkerRosterSavingKey(null);
        }
    }, [addableCoworkerCandidates, coworkerPickerKey, repoId, workspaceId, originId, cloneClient]);

    const handleRemoveCoworker = useCallback(async (entry: Pick<PullRequestCoworkerRosterEntry, 'id' | 'displayName'>) => {
        const key = getCoworkerRosterIdentityKey(entry);
        if (!key) {
            setCoworkerRosterError('Cannot remove a coworker without an identity key.');
            return;
        }

        setCoworkerRosterSavingKey(`remove:${key}`);
        setCoworkerRosterError(null);
        try {
            const data = await cloneClient.pullRequests.removeCoworkerFromRosterForOrigin(originId, key, { workspaceId, repoId });
            setCoworkerRoster(data.entries ?? []);
            setInactiveCoworkerKeys(prev => {
                if (!prev.has(key)) return prev;
                const next = new Set(prev);
                next.delete(key);
                return next;
            });
        } catch (err) {
            setCoworkerRosterError(getSpaCocClientErrorMessage(err, 'Failed to remove coworker from Team roster.'));
        } finally {
            setCoworkerRosterSavingKey(null);
        }
    }, [repoId, workspaceId, originId, cloneClient]);

    function handleToggleBatchMode() {
        setBatchMode(prev => {
            if (prev) {
                setSelectedPrIds(new Set());
                setAnchorPrId(null);
            }
            return !prev;
        });
    }

    function handleRowClick(pr: PullRequest) {
        const prNumber = pr.number ?? pr.id;
        dispatch({ type: 'SET_SELECTED_PR', prId: prNumber });
        dispatch({ type: 'SET_PR_DETAIL_TAB', tab: 'overview' });
        window.location.hash = `#repos/${encodeURIComponent(repoId)}/pull-requests/${prNumber}/overview`;
        if (isMobile) setMobileShowDetail(true);
    }

    /** Navigate to a PR detail page after validating that the PR exists. */
    const openPrInRepo = useCallback(async (targetRepoId: string, targetWorkspaceId: string, prNumber: number): Promise<unknown> => {
        const targetWorkspace = (state.workspaces ?? []).find((ws: WorkspaceLike) => ws.id === targetWorkspaceId);
        const targetOriginId = resolveCanonicalOriginId({
            workspaceId: targetWorkspaceId,
            remoteUrl: targetWorkspace?.remoteUrl ?? (targetWorkspaceId === workspaceId ? remoteUrl : undefined),
        });
        let pr: unknown;
        try {
            pr = await cloneClient.pullRequests.getForOrigin(targetOriginId, String(prNumber), {
                workspaceId: targetWorkspaceId,
                repoId: targetRepoId,
            });
        } catch (err) {
            if (err instanceof CocApiError && err.status === 404) {
                throw new PullRequestOpenError(`Pull request #${prNumber} not found.`, 404);
            }
            throw new PullRequestOpenError(getSpaCocClientErrorMessage(err, `Failed to open pull request #${prNumber}.`));
        }
        dispatch({ type: 'SET_SELECTED_PR', prId: prNumber });
        dispatch({ type: 'SET_PR_DETAIL_TAB', tab: 'overview' });
        window.location.hash = `#repos/${encodeURIComponent(targetRepoId)}/pull-requests/${prNumber}/overview`;
        if (isMobile) setMobileShowDetail(true);
        return pr;
    }, [dispatch, isMobile, remoteUrl, state.workspaces, workspaceId, cloneClient]);

    const recordRecentOpenedPr = useCallback(async (
        targetRepoId: string,
        targetWorkspaceId: string,
        prNumber: number,
        pr: unknown,
    ) => {
        const targetWorkspace = (state.workspaces ?? []).find((ws: WorkspaceLike) => ws.id === targetWorkspaceId);
        const targetOriginId = resolveCanonicalOriginId({
            workspaceId: targetWorkspaceId,
            remoteUrl: targetWorkspace?.remoteUrl ?? (targetWorkspaceId === workspaceId ? remoteUrl : undefined),
        });
        const data = await cloneClient.pullRequests.recordRecentOpenedForOrigin(
            targetOriginId,
            buildRecentOpenedRecord(pr, prNumber),
            { workspaceId: targetWorkspaceId, repoId: targetRepoId },
        );
        if (targetOriginId === originId) {
            setRecentOpenedPrs(data.entries ?? []);
        }
    }, [repoId, workspaceId, remoteUrl, originId, state.workspaces, cloneClient]);

    const removeRecentOpenedPr = useCallback(async (entry: RecentOpenedPullRequestEntry) => {
        const data = await cloneClient.pullRequests.removeRecentOpenedForOrigin(
            originId,
            entry.number,
            { workspaceId: entry.workspaceId, repoId: entry.repoId },
        );
        setRecentOpenedPrs(data.entries ?? []);
    }, [originId, cloneClient]);

    const handleRecentOpenedClick = useCallback(async (entry: RecentOpenedPullRequestEntry) => {
        if (openPrLoading) return;
        setOpenPrError(null);
        setOpenPrLoading(true);
        try {
            await openPrInRepo(entry.repoId, entry.workspaceId, entry.number);
        } catch (err) {
            setOpenPrError(err instanceof Error ? err.message : String(err));
            if (err instanceof PullRequestOpenError && err.status === 404) {
                try {
                    await removeRecentOpenedPr(entry);
                } catch (removeErr) {
                    console.warn('Failed to remove stale recently opened pull request', removeErr);
                }
            }
        } finally {
            setOpenPrLoading(false);
        }
    }, [openPrInRepo, openPrLoading, removeRecentOpenedPr]);

    const handleOpenPr = useCallback(async () => {
        if (openPrLoading) return;
        setOpenPrError(null);
        const parsed = parsePrInput(openPrInput);
        if (parsed.kind === 'invalid') {
            setOpenPrError(parsed.reason);
            return;
        }

        let targetRepoId: string;
        let targetWorkspaceId: string;
        let prNumber: number;
        if (parsed.kind === 'number') {
            targetRepoId = repoId;
            targetWorkspaceId = workspaceId;
            prNumber = parsed.number;
        } else {
            const ws = matchWorkspaceForPrUrl(
                (state.workspaces ?? []) as WorkspaceLike[],
                parsed,
            );
            if (!ws) {
                setOpenPrError('Repository is not registered as a workspace.');
                return;
            }
            targetRepoId = ws.id;
            targetWorkspaceId = ws.id;
            prNumber = parsed.number;
        }

        setOpenPrLoading(true);
        try {
            const pr = await openPrInRepo(targetRepoId, targetWorkspaceId, prNumber);
            try {
                await recordRecentOpenedPr(targetRepoId, targetWorkspaceId, prNumber, pr);
            } catch (err) {
                setOpenPrError(getSpaCocClientErrorMessage(err, 'Opened PR, but failed to update Recently opened.'));
            }
            setOpenPrInput('');
        } catch (err) {
            setOpenPrError(err instanceof Error ? err.message : String(err));
        } finally {
            setOpenPrLoading(false);
        }
    }, [openPrInput, openPrLoading, openPrInRepo, recordRecentOpenedPr, repoId, state.workspaces, workspaceId]);

    function handlePrSelect(id: string, checked: boolean, shiftKey: boolean, sectionPrs: PullRequest[]) {
        const sectionIds = sectionPrs.map(getPrSelectionId);
        const anchorIndex = anchorPrId === null ? -1 : sectionIds.indexOf(anchorPrId);
        const targetIndex = sectionIds.indexOf(id);
        const shouldSelectRange = shiftKey && anchorIndex !== -1 && targetIndex !== -1;

        setSelectedPrIds(prev => {
            const next = new Set(prev);
            if (shouldSelectRange) {
                const start = Math.min(anchorIndex, targetIndex);
                const end = Math.max(anchorIndex, targetIndex);
                for (const rangeId of sectionIds.slice(start, end + 1)) {
                    next.add(rangeId);
                }
            } else if (checked) {
                next.add(id);
            } else {
                next.delete(id);
            }
            return next;
        });

        if (!shouldSelectRange) {
            setAnchorPrId(id);
        }
    }

    const queueHeader = (
        <div
            className={cn(
                'flex shrink-0 items-center border-b border-gray-200 dark:border-gray-700',
                queueCollapsed
                    ? 'justify-center gap-0 px-1 py-1'
                    : 'gap-1.5 px-2.5 py-1',
            )}
            data-testid="pr-queue-header"
            data-collapsed={queueCollapsed}
        >
            {!queueCollapsed && (
                <span className="min-w-0 truncate text-xs font-semibold text-gray-900 dark:text-gray-100">
                    PR queue
                </span>
            )}
            {!queueCollapsed && fetchedAt != null && !loading && (
                <span className="min-w-0 truncate text-[10px] text-gray-400 dark:text-gray-500" data-testid="fetched-at">
                    · {formatFetchedAt(fetchedAt, now)}
                </span>
            )}
            {!queueCollapsed && <span className="flex-1" />}
            <button
                type="button"
                onClick={toggleQueueCollapsed}
                aria-expanded={!queueCollapsed}
                aria-label={queueCollapsed ? 'Expand PR queue' : 'Collapse PR queue'}
                aria-controls="pr-queue-content"
                title={queueCollapsed ? 'Expand PR queue' : 'Collapse PR queue'}
                data-testid="pr-queue-toggle"
                className="inline-grid h-6 w-6 shrink-0 place-items-center rounded-md border border-gray-300 bg-white text-xs font-semibold text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
            >
                {queueCollapsed ? '>' : '<'}
            </button>
        </div>
    );

    const queuePanel = (
        <>
            {queueHeader}
            {!queueCollapsed && (
                <div
                    className="flex shrink-0 flex-col gap-1 border-b border-gray-200 px-2.5 py-1 dark:border-gray-700"
                    data-testid="pr-open-row"
                >
                    <div className="flex items-center gap-1.5">
                        <input
                            className="min-w-0 flex-1 rounded-md border border-gray-300 bg-white px-1.5 py-0.5 text-xs text-gray-900 outline-none placeholder:text-gray-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                            placeholder="Open PR by # or URL"
                            value={openPrInput}
                            disabled={openPrLoading}
                            onChange={e => {
                                setOpenPrInput(e.target.value);
                                if (openPrError) setOpenPrError(null);
                            }}
                            onKeyDown={e => {
                                if (e.key === 'Enter') {
                                    e.preventDefault();
                                    void handleOpenPr();
                                }
                            }}
                            data-testid="open-pr-input"
                        />
                        <button
                            type="button"
                            onClick={() => { void handleOpenPr(); }}
                            disabled={openPrLoading || openPrInput.trim().length === 0}
                            data-testid="open-pr-button"
                            className="inline-flex h-[22px] shrink-0 items-center rounded-md border border-blue-500 bg-blue-50 px-1.5 text-[11px] font-semibold text-blue-700 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-blue-500 dark:bg-blue-900/30 dark:text-blue-300 dark:hover:bg-blue-900/50"
                        >
                            {openPrLoading ? 'Opening…' : 'Open'}
                        </button>
                    </div>
                    {openPrError && (
                        <div
                            className="text-[11px] text-red-600 dark:text-red-400"
                            data-testid="open-pr-error"
                            role="alert"
                        >
                            {openPrError}
                        </div>
                    )}
                </div>
            )}
            {!queueCollapsed && recentOpenedPrs.length > 0 && (
                <div
                    className="flex shrink-0 flex-col gap-1 border-b border-gray-200 px-2.5 py-1 dark:border-gray-700"
                    data-testid="recent-opened-prs"
                >
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                        Recently opened
                    </div>
                    <div className="flex flex-col gap-0.5">
                        {recentOpenedPrs.map(entry => (
                            <button
                                key={`${entry.workspaceId}:${entry.repoId}:${entry.number}`}
                                type="button"
                                onClick={() => { void handleRecentOpenedClick(entry); }}
                                disabled={openPrLoading}
                                title={`Open pull request #${entry.number}: ${entry.title}`}
                                aria-label={`Open pull request #${entry.number}: ${entry.title}`}
                                data-testid="recent-opened-pr-entry"
                                className="group flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-0.5 text-left text-[11px] text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-60 dark:text-gray-300 dark:hover:bg-gray-800"
                            >
                                <span className="shrink-0 font-semibold text-blue-600 dark:text-blue-300">
                                    #{entry.number}
                                </span>
                                <span className="min-w-0 flex-1 truncate">
                                    {entry.title}
                                </span>
                            </button>
                        ))}
                    </div>
                </div>
            )}
            {!queueCollapsed && (
                <div
                    className="flex shrink-0 items-center gap-1.5 border-b border-gray-200 px-2.5 py-1.5 dark:border-gray-700"
                    data-testid="pr-queue-toolbar"
                >
                    <input
                        className="min-w-0 flex-1 rounded-md border border-gray-300 bg-white px-1.5 py-0.5 text-xs text-gray-900 outline-none placeholder:text-gray-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                        placeholder="Search PRs…"
                        value={searchText}
                        onChange={e => setSearchText(e.target.value)}
                        data-testid="search-input"
                    />
                    <button
                        type="button"
                        onClick={() => fetchPrs(true, true)}
                        disabled={loading}
                        title="Refresh pull requests"
                        data-testid="refresh-button"
                        className="inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-md border border-gray-300 bg-white text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
                    >
                        <svg
                            className={loading ? 'animate-spin' : ''}
                            width="12" height="12" viewBox="0 0 24 24"
                            fill="none" stroke="currentColor" strokeWidth="2"
                            strokeLinecap="round" strokeLinejoin="round"
                        >
                            <path d="M21 2v6h-6" />
                            <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
                            <path d="M3 22v-6h6" />
                            <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
                        </svg>
                    </button>
                    <button
                        type="button"
                        onClick={handleToggleBatchMode}
                        aria-pressed={batchMode}
                        data-testid="select-mode-button"
                        className={cn(
                            'inline-flex h-[22px] shrink-0 items-center rounded-md border px-1.5 text-[11px] font-semibold transition-colors',
                            batchMode
                                ? 'border-blue-500 bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-300'
                                : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700',
                        )}
                    >
                        {batchMode ? 'Cancel' : 'Select'}
                    </button>
                </div>
            )}

            <div id="pr-queue-content" className="flex min-h-0 flex-1 flex-col">
                {!queueCollapsed && (
                    <PrQueueFilters
                        active={activeFilter}
                        counts={filterCounts}
                        onChange={handleFilterChange}
                        suggestionsEnabled={suggestionsEnabled}
                    />
                )}

                {!queueCollapsed && activeFilter === 'team' && (
                    <div
                        className="flex shrink-0 flex-col gap-1.5 border-b border-blue-100 bg-blue-50/70 px-2.5 py-2 text-[11px] text-blue-900 dark:border-blue-900/60 dark:bg-blue-950/30 dark:text-blue-100"
                        data-testid="team-roster-toolbar"
                    >
                        <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0">
                                <span className="font-semibold">Team roster</span>
                                <span className="ml-1 text-blue-700/80 dark:text-blue-200/80">
                                    {activeCoworkerRoster.length} of {coworkerRoster.length} active
                                </span>
                            </div>
                        </div>

                        {coworkerRoster.length === 0 ? (
                            <div className="rounded-md border border-dashed border-blue-200 bg-white/70 px-2 py-1 text-blue-800 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-100" data-testid="team-roster-empty">
                                Add coworkers from loaded PR authors to build your Team filter.
                            </div>
                        ) : (
                            <div className="flex flex-wrap gap-1" data-testid="team-coworker-chips">
                                {coworkerRoster.map(entry => {
                                    const key = getCoworkerRosterIdentityKey(entry);
                                    const isActive = !inactiveCoworkerKeys.has(key);
                                    const isRemoving = coworkerRosterSavingKey === `remove:${key}`;
                                    return (
                                        <span
                                            key={key}
                                            className={cn(
                                                'inline-flex max-w-full items-center overflow-hidden rounded-full border text-[11px] font-semibold',
                                                isActive
                                                    ? 'border-blue-300 bg-white text-blue-800 dark:border-blue-700 dark:bg-blue-950/60 dark:text-blue-100'
                                                    : 'border-gray-300 bg-white/70 text-gray-500 opacity-75 dark:border-gray-700 dark:bg-gray-900/60 dark:text-gray-400',
                                            )}
                                            data-testid="team-coworker-chip"
                                            data-active={isActive}
                                        >
                                            <button
                                                type="button"
                                                onClick={() => handleToggleCoworker(entry)}
                                                aria-pressed={isActive}
                                                aria-label={`${isActive ? 'Hide' : 'Show'} ${entry.displayName} in Team filter`}
                                                className="inline-flex min-w-0 items-center gap-1 px-2 py-0.5"
                                                disabled={isRemoving}
                                            >
                                                {entry.avatarUrl && (
                                                    <img
                                                        src={entry.avatarUrl}
                                                        alt=""
                                                        className="h-4 w-4 rounded-full"
                                                    />
                                                )}
                                                <span className="truncate">{entry.displayName}</span>
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => { void handleRemoveCoworker(entry); }}
                                                disabled={isRemoving}
                                                aria-label={`Remove ${entry.displayName} from Team roster`}
                                                className="border-l border-current/20 px-1.5 py-0.5 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-60 dark:hover:bg-blue-900/40"
                                                data-testid="team-coworker-remove"
                                            >
                                                {isRemoving ? '...' : 'x'}
                                            </button>
                                        </span>
                                    );
                                })}
                            </div>
                        )}

                        <div
                            className={cn(
                                'flex items-center justify-between gap-2 rounded-md border bg-white/80 px-2 py-1 dark:bg-blue-950/40',
                                teamClassificationMode === 'disabled'
                                    ? 'border-gray-200 text-gray-600 dark:border-gray-700 dark:text-gray-300'
                                    : teamClassificationMode === 'queueing' || teamClassificationMode === 'running'
                                        ? 'border-blue-300 text-blue-900 dark:border-blue-700 dark:text-blue-100'
                                        : teamClassificationMode === 'ready'
                                            ? 'border-emerald-200 text-emerald-800 dark:border-emerald-800 dark:text-emerald-100'
                                            : 'border-blue-200 text-blue-800 dark:border-blue-800 dark:text-blue-100',
                            )}
                            data-testid="team-auto-classification-status"
                            data-status-mode={teamClassificationMode}
                            role="status"
                            aria-live="polite"
                        >
                            <div className="min-w-0">
                                <div className="font-semibold">Team AI classification</div>
                                <div className="truncate text-[10px]" data-testid="team-auto-classification-summary">
                                    {teamClassificationSummary}
                                </div>
                                {teamAutoClassificationEnabled && teamAutoClassificationIdentifiers.length > 0 && (
                                    <div className="mt-0.5 flex flex-wrap gap-1 text-[10px]">
                                        <span data-testid="team-auto-classification-ready-count">{teamClassificationCounts.ready} cached</span>
                                        <span data-testid="team-auto-classification-running-count">{teamClassificationCounts.running} running</span>
                                        <span data-testid="team-auto-classification-missing-count">{teamClassificationCounts.missing} missing</span>
                                    </div>
                                )}
                                {teamClassificationError && (
                                    <div className="mt-0.5 text-[10px] text-red-600 dark:text-red-300" data-testid="team-auto-classification-error">
                                        {teamClassificationError}
                                    </div>
                                )}
                            </div>
                            {teamAutoClassificationEnabled && (
                                <button
                                    type="button"
                                    onClick={() => { void handleClassifyTeamNow(); }}
                                    disabled={
                                        teamClassificationQueueing ||
                                        teamAutoClassificationIdentifiers.length === 0 ||
                                        teamClassificationCounts.missing === 0
                                    }
                                    aria-label="Classify Team pull requests now"
                                    className="inline-flex h-[24px] shrink-0 items-center rounded-md border border-blue-300 bg-white px-2 text-[11px] font-semibold text-blue-700 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-blue-700 dark:bg-blue-950/40 dark:text-blue-100 dark:hover:bg-blue-900/50"
                                    data-testid="team-auto-classification-button"
                                >
                                    {teamClassificationQueueing ? 'Queueing...' : 'Classify now'}
                                </button>
                            )}
                        </div>

                        <div className="flex items-center gap-1.5">
                            <select
                                value={coworkerPickerKey}
                                onChange={e => {
                                    setCoworkerPickerKey(e.target.value);
                                    if (coworkerRosterError) setCoworkerRosterError(null);
                                }}
                                disabled={addableCoworkerCandidates.length === 0 || coworkerRosterSavingKey != null}
                                aria-label="Add coworker from loaded pull request authors"
                                className="min-w-0 flex-1 rounded-md border border-blue-200 bg-white px-1.5 py-0.5 text-[11px] text-blue-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30 disabled:cursor-not-allowed disabled:opacity-60 dark:border-blue-800 dark:bg-blue-950/60 dark:text-blue-100"
                                data-testid="team-coworker-picker"
                            >
                                <option value="">
                                    {addableCoworkerCandidates.length > 0 ? 'Add coworker...' : 'No loaded authors to add'}
                                </option>
                                {addableCoworkerCandidates.map(candidate => {
                                    const key = getCoworkerRosterIdentityKey(candidate);
                                    return (
                                        <option key={key} value={key}>
                                            {candidate.displayName}{candidate.prCount > 1 ? ` (${candidate.prCount})` : ''}
                                        </option>
                                    );
                                })}
                            </select>
                            <button
                                type="button"
                                onClick={() => { void handleAddCoworker(); }}
                                disabled={!coworkerPickerKey || coworkerRosterSavingKey != null}
                                className="inline-flex h-[24px] shrink-0 items-center rounded-md border border-blue-300 bg-white px-2 text-[11px] font-semibold text-blue-700 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-blue-700 dark:bg-blue-950/40 dark:text-blue-100 dark:hover:bg-blue-900/50"
                                data-testid="team-coworker-add"
                            >
                                {coworkerRosterSavingKey === 'add' ? 'Adding...' : 'Add'}
                            </button>
                        </div>

                        {coworkerRosterError && (
                            <div className="text-[11px] text-red-700 dark:text-red-300" role="alert" data-testid="team-roster-error">
                                {coworkerRosterError}
                            </div>
                        )}
                    </div>
                )}

                {!queueCollapsed && suggestionsEnabled && activeFilter === 'foryou' && (
                    <div
                        className="flex items-center justify-between gap-2 border-b border-yellow-100 bg-yellow-50 px-2.5 py-1 text-[11px] text-yellow-800 dark:border-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-200"
                        data-testid="suggestions-toolbar"
                    >
                        <div className="min-w-0">
                            <span className="font-medium">AI-suggested PRs</span>
                            <span className="ml-1 text-yellow-700/80 dark:text-yellow-200/80" data-testid="suggestions-status">
                                {suggestionsLoading
                                    ? suggestionsStatus
                                    : suggestionsStatus ?? (suggestionsRankedAt ? 'Updated' : 'Generate suggestions to rank open PRs')}
                            </span>
                        </div>
                        <button
                            type="button"
                            onClick={handleRefreshSuggestions}
                            disabled={suggestionsLoading}
                            className="text-xs font-semibold text-yellow-700 hover:underline disabled:cursor-not-allowed disabled:opacity-50 dark:text-yellow-300"
                            data-testid="refresh-suggestions-button"
                        >
                            {suggestionsLoading ? 'Generating...' : suggestions.length > 0 ? 'Refresh' : 'Generate suggestions'}
                        </button>
                    </div>
                )}

                {!queueCollapsed && batchMode && selectedPrIds.size > 0 && (
                    <div
                        className="flex items-center justify-between border-b border-blue-100 bg-blue-50 px-2.5 py-0.5 text-[11px] font-medium text-blue-700 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-300"
                        data-testid="selection-count-bar"
                    >
                        <span>{selectedPrIds.size} PR{selectedPrIds.size !== 1 ? 's' : ''} selected</span>
                        <button
                            className="text-xs text-blue-600 hover:underline dark:text-blue-400"
                            onClick={() => {
                                setSelectedPrIds(new Set());
                                setAnchorPrId(null);
                            }}
                            data-testid="clear-selection"
                        >
                            Clear
                        </button>
                    </div>
                )}

                {!queueCollapsed && unconfigured && (
                    <ProviderConfigPanel
                        detected={unconfigured.detected}
                        remoteUrl={unconfigured.remoteUrl}
                        noCredentials={unconfigured.noCredentials}
                        onConfigured={() => fetchPrs(true)}
                    />
                )}

                {!queueCollapsed && error && (
                    <div className="px-4 py-2 text-sm text-red-500 dark:text-red-400" data-testid="error-message">
                        {error}
                    </div>
                )}

                {!queueCollapsed && suggestionsEnabled && activeFilter === 'foryou' && suggestionsError && (
                    <div className="border-b border-red-100 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300" data-testid="suggestions-error">
                        {suggestionsError}
                    </div>
                )}

                {!queueCollapsed && suggestionsEnabled && activeFilter === 'foryou' && suggestionsInfo && (
                    <div className="border-b border-yellow-100 bg-yellow-50 px-3 py-2 text-xs text-yellow-800 dark:border-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-200" data-testid="suggestions-info">
                        {suggestionsInfo}
                    </div>
                )}

                {!queueCollapsed && loading && prs.length === 0 && (
                    <div className="flex items-center justify-center py-8" data-testid="loading-spinner">
                        <span className="text-sm text-gray-500">Loading pull requests…</span>
                    </div>
                )}

                <div className="flex-1 overflow-y-auto" data-testid="pr-list">
                    {!error && !unconfigured && !(loading && prs.length === 0) && filteredByPill.length > 0 && (
                        groupedPrs
                            .filter(({ prs: sectionPrs }) => sectionPrs.length > 0)
                            .map(({ config, prs: sectionPrs }) => (
                                <PrQueueGroupSection
                                    key={config.section}
                                    section={config.section}
                                    label={config.label}
                                    compact={queueCollapsed}
                                >
                                    {sectionPrs.map(pr => {
                                        const sessionContextPayload = sessionContextDragEnabled
                                            ? createPullRequestContextDragPayload(pr, { activeWorkspaceId: workspaceId })
                                            : null;
                                        return (
                                            <PullRequestRow
                                                key={pr.id}
                                                pr={pr}
                                                onClick={() => handleRowClick(pr)}
                                                isSelected={state.selectedPrId != null && String(pr.number ?? pr.id) === String(state.selectedPrId)}
                                                isChecked={selectedPrIds.has(getPrSelectionId(pr))}
                                                onSelect={(id, checked, shiftKey) =>
                                                    handlePrSelect(id, checked, shiftKey, sectionPrs)
                                                }
                                                batchMode={batchMode && !queueCollapsed}
                                                 compact={queueCollapsed}
                                                 isSuggested={suggestionsEnabled && suggestedPrNumbers.has(pr.number ?? 0)}
                                                 sessionContextPayload={sessionContextPayload}
                                                 classificationStatus={teamClassificationBadgeByPrId.get(getPrSelectionId(pr))}
                                             />
                                         );
                                     })}
                                </PrQueueGroupSection>
                            ))
                    )}
                    {!queueCollapsed && !loading && !error && !unconfigured && suggestionsEnabled && activeFilter === 'foryou' && prs.length > 0 && filteredByPill.length === 0 && suggestions.length === 0 && (
                        <div className="m-3 rounded-lg border border-yellow-200 bg-yellow-50 p-3 text-sm text-yellow-900 dark:border-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-100" data-testid="suggestions-empty-state">
                            <div className="font-semibold">Find PRs for you</div>
                            <div className="mt-1 text-xs text-yellow-800 dark:text-yellow-200">
                                CoC can suggest open PRs based on your past review history.
                            </div>
                            <button
                                type="button"
                                onClick={handleRefreshSuggestions}
                                disabled={suggestionsLoading}
                                className="mt-2 rounded-md border border-yellow-300 bg-white px-2 py-1 text-xs font-semibold text-yellow-800 hover:bg-yellow-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-yellow-700 dark:bg-yellow-950/40 dark:text-yellow-100 dark:hover:bg-yellow-900/40"
                                data-testid="generate-suggestions-empty-button"
                            >
                                {suggestionsLoading ? 'Generating...' : 'Generate suggestions'}
                            </button>
                        </div>
                    )}
                    {!queueCollapsed && !loading && !error && !unconfigured && !(suggestionsEnabled && activeFilter === 'foryou' && suggestions.length === 0) && prs.length > 0 && filteredByPill.length === 0 && (
                        <div className="px-4 py-6 text-center text-sm text-gray-500" data-testid="no-results">
                            {activeFilter === 'team'
                                ? coworkerRoster.length === 0
                                    ? 'Add coworkers from loaded PR authors to build your Team filter.'
                                    : activeCoworkerRoster.length === 0
                                        ? 'Choose at least one Team coworker chip to show matching pull requests.'
                                        : 'No loaded pull requests are authored by the active Team roster.'
                                : 'No pull requests match your filters.'}
                        </div>
                    )}
                    {!queueCollapsed && !loading && !error && !unconfigured && prs.length === 0 && (
                        <div className="pr-empty-state px-4 py-6 text-center text-sm text-gray-500" data-testid="empty-state">
                            No pull requests found.
                        </div>
                    )}
                </div>

                {!queueCollapsed && hasMore && !loading && (
                    <div className="border-t border-gray-200 px-2.5 py-1.5 dark:border-gray-700">
                        <button
                            className="w-full py-0.5 text-xs text-blue-600 hover:underline dark:text-blue-400"
                            onClick={() => fetchPrs(false)}
                            data-testid="load-more"
                        >
                            Load more
                        </button>
                    </div>
                )}

                {!queueCollapsed && loading && prs.length > 0 && (
                    <div className="px-2.5 py-1.5 text-center text-xs text-gray-500" data-testid="loading-more">
                        Loading…
                    </div>
                )}


            </div>
        </>
    );

    const detailContent = batchMode && selectedPrIds.size > 0 ? (
        <BatchCommandPanel
            selectedPrIds={selectedPrIds}
            selectedPrs={selectedPrs}
            repoId={repoId}
            workspaceId={workspaceId}
            activeGroup={dominantGroup}
            onClearSelection={() => {
                setSelectedPrIds(new Set());
                setAnchorPrId(null);
            }}
        />
    ) : state.selectedPrId != null ? (
        <PullRequestDetail
            repoId={repoId}
            remoteUrl={remoteUrl}
            prId={state.selectedPrId}
            onBack={() => { if (isMobile) setMobileShowDetail(false); }}
            isMobile={isMobile}
        />
    ) : (
        <div
            className="flex items-center justify-center h-full text-sm text-gray-500"
            data-testid="pr-empty-state"
        >
            Select a pull request
        </div>
    );

    if (isMobile) {
        return (
            <div className="flex flex-col h-full overflow-hidden" data-testid="pr-split-panel">
                {mobileShowDetail ? (
                    <div className="flex-1 flex flex-col overflow-hidden" data-testid="pr-detail-panel">
                        {detailContent}
                    </div>
                ) : (
                    <div className="flex-1 flex flex-col overflow-hidden bg-white dark:bg-gray-900" data-testid="pr-list-panel">
                        {queuePanel}
                    </div>
                )}
            </div>
        );
    }

    const effectiveLeftPanelWidth = queueCollapsed ? QUEUE_COLLAPSED_WIDTH : leftPanelWidth;

    return (
        <div className={cn('flex h-full overflow-hidden', isDragging && 'select-none')} data-testid="pr-split-panel">
            <div
                className="flex-shrink-0 border-r border-gray-200 flex flex-col overflow-hidden bg-white dark:border-gray-700 dark:bg-gray-900"
                style={{ width: effectiveLeftPanelWidth }}
                data-testid="pr-list-panel"
                data-collapsed={queueCollapsed}
            >
                {queuePanel}
            </div>

            {!queueCollapsed && (
                <div
                    className="flex items-center justify-center w-1 cursor-col-resize hover:bg-blue-400/30 active:bg-blue-400/50 transition-colors flex-shrink-0"
                    onMouseDown={handleMouseDown}
                    onTouchStart={handleTouchStart}
                    data-testid="pr-resize-handle"
                    role="separator"
                    aria-orientation="vertical"
                    aria-label="Resize pull requests panel"
                    tabIndex={0}
                />
            )}

            <div className="flex-1 min-w-0 overflow-y-auto" data-testid="pr-detail-panel">
                {detailContent}
            </div>
        </div>
    );
}
