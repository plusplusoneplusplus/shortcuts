import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
    ConvertDreamCardRequest,
    DreamCard,
    DreamCardCategory,
    DreamCardStatus,
    DreamConversionArtifactType,
    DreamRunResponse,
    PerRepoPreferences,
    WorkItemPriority,
    WorkItemType,
} from '@plusplusoneplusplus/coc-client';
import { DREAM_CONVERSION_ARTIFACT_TYPES } from '@plusplusoneplusplus/coc-client';
import { Button, Card, Spinner, cn } from '../../ui';
import { getSpaCocClient, getSpaCocClientErrorMessage } from '../../api/cocClient';
import { isDreamsEnabled } from '../../utils/config';

type DreamFilterId = 'visible' | 'approved' | 'dismissed' | 'converted' | 'superseded' | 'all';
type DreamNextActionKind = 'skill-hardening-task' | 'note' | 'memory' | 'work-item-create' | 'work-item-update';

interface DreamsPanelProps {
    workspaceId: string;
}

const FILTERS: Array<{ id: DreamFilterId; label: string; statuses?: DreamCardStatus[]; includeHidden?: boolean }> = [
    { id: 'visible', label: 'Visible', statuses: ['visible'] },
    { id: 'approved', label: 'Approved', statuses: ['approved'], includeHidden: true },
    { id: 'dismissed', label: 'Dismissed', statuses: ['dismissed'], includeHidden: true },
    { id: 'converted', label: 'Converted', statuses: ['converted'], includeHidden: true },
    { id: 'superseded', label: 'Superseded', statuses: ['superseded'], includeHidden: true },
    { id: 'all', label: 'History', includeHidden: true },
];

const CATEGORY_LABELS: Record<DreamCardCategory, string> = {
    'skill-or-prompt-improvement': 'Skill / prompt',
    'user-workflow-suggestion': 'Workflow',
    'product-improvement': 'Product',
};

const CATEGORY_STYLES: Record<DreamCardCategory, string> = {
    'skill-or-prompt-improvement': 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
    'user-workflow-suggestion': 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300',
    'product-improvement': 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
};

const STATUS_STYLES: Record<DreamCardStatus, string> = {
    candidate: 'bg-[#f0f0f0] text-[#616161] dark:bg-[#333] dark:text-[#cccccc]',
    visible: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
    approved: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
    dismissed: 'bg-[#f0f0f0] text-[#616161] dark:bg-[#333] dark:text-[#cccccc]',
    converted: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
    superseded: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-900/40 dark:text-zinc-300',
};

const CONVERSION_LABELS: Record<DreamConversionArtifactType, string> = {
    'skill-hardening-task': 'Skill-hardening task',
    note: 'Note',
    memory: 'Memory',
    'work-item': 'Work item',
    other: 'Other',
};

const WORK_ITEM_TYPES: WorkItemType[] = ['work-item', 'bug', 'goal', 'pbi', 'feature', 'epic'];
const WORK_ITEM_PRIORITIES: WorkItemPriority[] = ['normal', 'high', 'low'];

function formatConfidence(confidence: number): string {
    return `${Math.round(confidence * 100)}%`;
}

function formatDate(iso: string | undefined): string {
    if (!iso) return 'unknown';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    return date.toLocaleString();
}

function statusLabel(status: DreamCardStatus): string {
    return status.slice(0, 1).toUpperCase() + status.slice(1);
}

function sourceHash(workspaceId: string, processId: string): string {
    return '#repos/' + encodeURIComponent(workspaceId) + '/activity/' + encodeURIComponent(processId);
}

function noteHash(workspaceId: string, notePath: string): string {
    const encodedPath = notePath.split('/').map(encodeURIComponent).join('/');
    return '#repos/' + encodeURIComponent(workspaceId) + '/notes/' + encodedPath;
}

function workItemHash(workspaceId: string, workItemId: string): string {
    return '#repos/' + encodeURIComponent(workspaceId) + '/work-items/' + encodeURIComponent(workItemId);
}

function nextActionCopy(category: DreamCardCategory): string {
    switch (category) {
        case 'skill-or-prompt-improvement':
            return 'Next action: explicitly launch or queue a skill-hardening-style task.';
        case 'user-workflow-suggestion':
            return 'Next action: explicitly save the suggestion to notes or memory.';
        case 'product-improvement':
            return 'Next action: explicitly create or update a work item.';
    }
}

function truncateText(text: string, maxLength: number): string {
    const normalized = text.trim().replace(/\s+/g, ' ');
    if (normalized.length <= maxLength) {
        return normalized;
    }
    return `${normalized.slice(0, maxLength - 3).trim()}...`;
}

function formatSourceRanges(card: DreamCard): string {
    return card.sourceRanges
        .map(range => `- ${range.processId} turns ${range.startTurnIndex}-${range.endTurnIndex}`)
        .join('\n');
}

function renderDreamMarkdown(card: DreamCard): string {
    return [
        `# Dream card ${card.id}`,
        '',
        `Category: ${CATEGORY_LABELS[card.category]}`,
        `Confidence: ${formatConfidence(card.confidence)}`,
        `Fingerprint: ${card.dedupFingerprint}`,
        '',
        '## Observed pattern',
        card.observedPattern,
        '',
        '## Why it matters',
        card.whyItMatters,
        '',
        '## Recommendation',
        card.recommendation,
        '',
        '## Expected impact',
        card.expectedImpact,
        '',
        '## Not already covered',
        card.notAlreadyCoveredRationale,
        '',
        '## Sources',
        formatSourceRanges(card),
    ].join('\n');
}

function renderSkillHardeningPrompt(card: DreamCard): string {
    return [
        'Use the skill-hardening process to turn this approved dream into a concrete skill or prompt improvement proposal.',
        '',
        renderDreamMarkdown(card),
        '',
        'Do not edit skills or prompts without an explicit user confirmation in that task.',
    ].join('\n');
}

function renderMemoryFact(card: DreamCard): string {
    return [
        `Observed workflow pattern: ${card.observedPattern}`,
        `Recommendation: ${card.recommendation}`,
        `Expected impact: ${card.expectedImpact}`,
    ].join('\n');
}

function defaultWorkItemTitle(card: DreamCard): string {
    return truncateText(card.recommendation, 96);
}

function renderWorkItemDescription(card: DreamCard): string {
    return [
        renderDreamMarkdown(card),
        '',
        'This work item was created from an explicitly approved dream card.',
    ].join('\n');
}

function renderWorkItemUpdateAppendix(card: DreamCard): string {
    return [
        `## Dream recommendation ${card.id}`,
        '',
        `Observed pattern: ${card.observedPattern}`,
        '',
        `Recommendation: ${card.recommendation}`,
        '',
        `Expected impact: ${card.expectedImpact}`,
        '',
        `Source ranges: ${card.sourceRanges.map(range => `${range.processId}:${range.startTurnIndex}-${range.endTurnIndex}`).join(', ')}`,
    ].join('\n');
}

function defaultNextActionKind(card: DreamCard): DreamNextActionKind {
    switch (card.category) {
        case 'skill-or-prompt-improvement':
            return 'skill-hardening-task';
        case 'user-workflow-suggestion':
            return 'note';
        case 'product-improvement':
            return 'work-item-create';
    }
}

function availableNextActions(card: DreamCard): Array<{ kind: DreamNextActionKind; label: string }> {
    switch (card.category) {
        case 'skill-or-prompt-improvement':
            return [{ kind: 'skill-hardening-task', label: 'Queue skill-hardening task' }];
        case 'user-workflow-suggestion':
            return [
                { kind: 'note', label: 'Save to notes' },
                { kind: 'memory', label: 'Save to memory' },
            ];
        case 'product-improvement':
            return [
                { kind: 'work-item-create', label: 'Create work item' },
                { kind: 'work-item-update', label: 'Update existing work item' },
            ];
    }
}

function filterOptions(filterId: DreamFilterId) {
    const filter = FILTERS.find(entry => entry.id === filterId) ?? FILTERS[0];
    return {
        ...(filter.includeHidden ? { includeHidden: true } : {}),
        ...(filter.statuses ? { statuses: filter.statuses } : {}),
    };
}

async function runDreamsRequest<T>(request: () => Promise<T>, fallback: string): Promise<T> {
    try {
        return await request();
    } catch (error) {
        throw new Error(getSpaCocClientErrorMessage(error, fallback));
    }
}

function SummaryMetric({ label, value }: { label: string; value: string | number }) {
    return (
        <div className="rounded-md border border-[#e0e0e0] bg-white px-3 py-2 text-sm dark:border-[#3c3c3c] dark:bg-[#252526]">
            <div className="text-[11px] uppercase tracking-wide text-[#848484]">{label}</div>
            <div className="font-semibold text-[#1e1e1e] dark:text-[#cccccc]">{value}</div>
        </div>
    );
}

function EmptyState({ ranWithoutCards }: { ranWithoutCards: boolean }) {
    return (
        <div
            className="flex flex-1 items-center justify-center rounded-lg border border-dashed border-[#d0d7de] p-8 text-center dark:border-[#3c3c3c]"
            data-testid="dreams-empty-state"
        >
            <div className="max-w-md space-y-2">
                <div className="text-sm font-semibold text-[#1e1e1e] dark:text-[#cccccc]">
                    {ranWithoutCards ? 'No new dreams from the latest run' : 'No dreams to review'}
                </div>
                <p className="text-xs text-[#616161] dark:text-[#999]">
                    Dreaming only shows high-confidence, deduplicated ideas. Vague, duplicate, or unactionable
                    candidates stay hidden from this review list.
                </p>
            </div>
        </div>
    );
}

interface ConvertDialogProps {
    card: DreamCard;
    onClose: () => void;
    onSubmit: (request: ConvertDreamCardRequest) => Promise<void>;
}

function ConvertDialog({ card, onClose, onSubmit }: ConvertDialogProps) {
    const [artifactType, setArtifactType] = useState<DreamConversionArtifactType>(
        card.category === 'product-improvement'
            ? 'work-item'
            : card.category === 'user-workflow-suggestion'
                ? 'note'
                : 'skill-hardening-task',
    );
    const [artifactId, setArtifactId] = useState('');
    const [artifactUrl, setArtifactUrl] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function handleSubmit() {
        const trimmedId = artifactId.trim();
        if (!trimmedId) {
            setError('Artifact ID is required.');
            return;
        }
        setSaving(true);
        setError(null);
        try {
            await onSubmit({
                artifactType,
                artifactId: trimmedId,
                ...(artifactUrl.trim() ? { artifactUrl: artifactUrl.trim() } : {}),
            });
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setSaving(false);
        }
    }

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
            onClick={event => { if (event.target === event.currentTarget) onClose(); }}
            data-testid="dream-convert-dialog"
        >
            <div className="w-full max-w-lg rounded-lg border border-[#d0d7de] bg-white p-4 shadow-xl dark:border-[#3c3c3c] dark:bg-[#252526]">
                <div className="mb-3">
                    <h3 className="text-sm font-semibold text-[#1e1e1e] dark:text-[#cccccc]">Record conversion</h3>
                    <p className="mt-1 text-xs text-[#616161] dark:text-[#999]">
                        This only links the dream card to an artifact you explicitly created elsewhere.
                    </p>
                </div>
                <div className="space-y-3">
                    <label className="block text-xs font-medium text-[#616161] dark:text-[#999]">
                        Artifact type
                        <select
                            className="mt-1 w-full rounded border border-[#d0d7de] bg-white px-2 py-1 text-sm text-[#1e1e1e] dark:border-[#3c3c3c] dark:bg-[#1e1e1e] dark:text-[#cccccc]"
                            value={artifactType}
                            onChange={event => setArtifactType(event.target.value as DreamConversionArtifactType)}
                            data-testid="dream-convert-artifact-type"
                        >
                            {DREAM_CONVERSION_ARTIFACT_TYPES.map(type => (
                                <option key={type} value={type}>{CONVERSION_LABELS[type]}</option>
                            ))}
                        </select>
                    </label>
                    <label className="block text-xs font-medium text-[#616161] dark:text-[#999]">
                        Artifact ID
                        <input
                            className="mt-1 w-full rounded border border-[#d0d7de] bg-white px-2 py-1 text-sm text-[#1e1e1e] dark:border-[#3c3c3c] dark:bg-[#1e1e1e] dark:text-[#cccccc]"
                            value={artifactId}
                            onChange={event => setArtifactId(event.target.value)}
                            placeholder="WI-123, memory fact id, note path, task id"
                            data-testid="dream-convert-artifact-id"
                        />
                    </label>
                    <label className="block text-xs font-medium text-[#616161] dark:text-[#999]">
                        Artifact URL (optional)
                        <input
                            className="mt-1 w-full rounded border border-[#d0d7de] bg-white px-2 py-1 text-sm text-[#1e1e1e] dark:border-[#3c3c3c] dark:bg-[#1e1e1e] dark:text-[#cccccc]"
                            value={artifactUrl}
                            onChange={event => setArtifactUrl(event.target.value)}
                            placeholder="https://..."
                            data-testid="dream-convert-artifact-url"
                        />
                    </label>
                    {error && <div className="text-xs text-red-600 dark:text-red-400" role="alert">{error}</div>}
                </div>
                <div className="mt-4 flex items-center justify-end gap-2">
                    <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>Cancel</Button>
                    <Button size="sm" onClick={handleSubmit} loading={saving} data-testid="dream-convert-submit">
                        Record conversion
                    </Button>
                </div>
            </div>
        </div>
    );
}

interface NextActionDialogProps {
    card: DreamCard;
    workspaceId: string;
    onClose: () => void;
    onConverted: (request: ConvertDreamCardRequest) => Promise<void>;
}

function NextActionDialog({ card, workspaceId, onClose, onConverted }: NextActionDialogProps) {
    const [actionKind, setActionKind] = useState<DreamNextActionKind>(defaultNextActionKind(card));
    const [skillPrompt, setSkillPrompt] = useState(renderSkillHardeningPrompt(card));
    const [notePath, setNotePath] = useState(`Dreams/${card.id}.md`);
    const [noteContent, setNoteContent] = useState(renderDreamMarkdown(card));
    const [memoryContent, setMemoryContent] = useState(renderMemoryFact(card));
    const [workItemTitle, setWorkItemTitle] = useState(defaultWorkItemTitle(card));
    const [workItemDescription, setWorkItemDescription] = useState(renderWorkItemDescription(card));
    const [workItemType, setWorkItemType] = useState<WorkItemType>('work-item');
    const [workItemPriority, setWorkItemPriority] = useState<WorkItemPriority>('normal');
    const [existingWorkItemId, setExistingWorkItemId] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const actionOptions = availableNextActions(card);

    async function handleSubmit() {
        setSaving(true);
        setError(null);
        try {
            const client = getSpaCocClient();
            if (actionKind === 'skill-hardening-task') {
                const prompt = skillPrompt.trim();
                if (!prompt) throw new Error('Skill-hardening prompt is required.');
                const result = await client.queue.enqueue({
                    type: 'chat',
                    priority: 'normal',
                    repoId: workspaceId,
                    displayName: `Dream next action: ${truncateText(card.recommendation, 48)}`,
                    payload: {
                        kind: 'chat',
                        mode: 'ask',
                        prompt,
                        workspaceId,
                        context: {
                            skills: ['skill-hardening'],
                            dreamCardId: card.id,
                            sourceRanges: card.sourceRanges,
                        },
                    },
                });
                await onConverted({
                    artifactType: 'skill-hardening-task',
                    artifactId: result.task.id,
                });
            } else if (actionKind === 'note') {
                const path = notePath.trim();
                const content = noteContent.trim();
                if (!path) throw new Error('Note path is required.');
                if (!content) throw new Error('Note content is required.');
                await client.notes.saveContent(workspaceId, path, content);
                await onConverted({
                    artifactType: 'note',
                    artifactId: path,
                    artifactUrl: noteHash(workspaceId, path),
                });
            } else if (actionKind === 'memory') {
                const content = memoryContent.trim();
                if (!content) throw new Error('Memory content is required.');
                const fact = await client.memoryV2.createFact(workspaceId, content, {
                    importance: Math.max(0.1, Math.min(1, card.confidence)),
                    tags: ['dream'],
                    sourceProcessId: card.sourceRanges[0]?.processId,
                });
                await onConverted({
                    artifactType: 'memory',
                    artifactId: fact.id,
                });
            } else if (actionKind === 'work-item-create') {
                const title = workItemTitle.trim();
                if (!title) throw new Error('Work item title is required.');
                const item = await client.workItems.create(workspaceId, {
                    title,
                    description: workItemDescription.trim() || undefined,
                    type: workItemType,
                    priority: workItemPriority,
                    tags: ['dream'],
                    source: 'manual',
                    sourceId: card.id,
                });
                await onConverted({
                    artifactType: 'work-item',
                    artifactId: item.id,
                    artifactUrl: workItemHash(workspaceId, item.id),
                });
            } else {
                const workItemId = existingWorkItemId.trim();
                if (!workItemId) throw new Error('Existing work item ID is required.');
                const existing = await client.workItems.get(workspaceId, workItemId);
                const appendix = renderWorkItemUpdateAppendix(card);
                const description = existing.description.trim()
                    ? `${existing.description.trim()}\n\n---\n\n${appendix}`
                    : appendix;
                const tags = Array.from(new Set([...(existing.tags ?? []), 'dream']));
                const item = await client.workItems.update(workspaceId, workItemId, {
                    description,
                    tags,
                });
                await onConverted({
                    artifactType: 'work-item',
                    artifactId: item.id,
                    artifactUrl: workItemHash(workspaceId, item.id),
                });
            }
            onClose();
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setSaving(false);
        }
    }

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
            onClick={event => { if (event.target === event.currentTarget) onClose(); }}
            data-testid="dream-next-action-dialog"
        >
            <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-[#d0d7de] bg-white p-4 shadow-xl dark:border-[#3c3c3c] dark:bg-[#252526]">
                <div className="mb-3">
                    <h3 className="text-sm font-semibold text-[#1e1e1e] dark:text-[#cccccc]">Take approved next action</h3>
                    <p className="mt-1 text-xs text-[#616161] dark:text-[#999]">
                        This performs the selected action only after you confirm here, then records the resulting conversion on the dream card.
                    </p>
                </div>
                <div className="space-y-3">
                    <label className="block text-xs font-medium text-[#616161] dark:text-[#999]">
                        Action
                        <select
                            className="mt-1 w-full rounded border border-[#d0d7de] bg-white px-2 py-1 text-sm text-[#1e1e1e] dark:border-[#3c3c3c] dark:bg-[#1e1e1e] dark:text-[#cccccc]"
                            value={actionKind}
                            onChange={event => setActionKind(event.target.value as DreamNextActionKind)}
                            data-testid="dream-next-action-kind"
                        >
                            {actionOptions.map(option => (
                                <option key={option.kind} value={option.kind}>{option.label}</option>
                            ))}
                        </select>
                    </label>

                    {actionKind === 'skill-hardening-task' && (
                        <label className="block text-xs font-medium text-[#616161] dark:text-[#999]">
                            Skill-hardening task prompt
                            <textarea
                                className="mt-1 h-56 w-full rounded border border-[#d0d7de] bg-white px-2 py-1 font-mono text-xs text-[#1e1e1e] dark:border-[#3c3c3c] dark:bg-[#1e1e1e] dark:text-[#cccccc]"
                                value={skillPrompt}
                                onChange={event => setSkillPrompt(event.target.value)}
                                data-testid="dream-next-action-skill-prompt"
                            />
                        </label>
                    )}

                    {actionKind === 'note' && (
                        <>
                            <label className="block text-xs font-medium text-[#616161] dark:text-[#999]">
                                Note path
                                <input
                                    className="mt-1 w-full rounded border border-[#d0d7de] bg-white px-2 py-1 text-sm text-[#1e1e1e] dark:border-[#3c3c3c] dark:bg-[#1e1e1e] dark:text-[#cccccc]"
                                    value={notePath}
                                    onChange={event => setNotePath(event.target.value)}
                                    data-testid="dream-next-action-note-path"
                                />
                            </label>
                            <label className="block text-xs font-medium text-[#616161] dark:text-[#999]">
                                Note content
                                <textarea
                                    className="mt-1 h-56 w-full rounded border border-[#d0d7de] bg-white px-2 py-1 font-mono text-xs text-[#1e1e1e] dark:border-[#3c3c3c] dark:bg-[#1e1e1e] dark:text-[#cccccc]"
                                    value={noteContent}
                                    onChange={event => setNoteContent(event.target.value)}
                                    data-testid="dream-next-action-note-content"
                                />
                            </label>
                        </>
                    )}

                    {actionKind === 'memory' && (
                        <label className="block text-xs font-medium text-[#616161] dark:text-[#999]">
                            Memory content
                            <textarea
                                className="mt-1 h-40 w-full rounded border border-[#d0d7de] bg-white px-2 py-1 text-sm text-[#1e1e1e] dark:border-[#3c3c3c] dark:bg-[#1e1e1e] dark:text-[#cccccc]"
                                value={memoryContent}
                                onChange={event => setMemoryContent(event.target.value)}
                                data-testid="dream-next-action-memory-content"
                            />
                        </label>
                    )}

                    {actionKind === 'work-item-create' && (
                        <>
                            <label className="block text-xs font-medium text-[#616161] dark:text-[#999]">
                                Work item title
                                <input
                                    className="mt-1 w-full rounded border border-[#d0d7de] bg-white px-2 py-1 text-sm text-[#1e1e1e] dark:border-[#3c3c3c] dark:bg-[#1e1e1e] dark:text-[#cccccc]"
                                    value={workItemTitle}
                                    onChange={event => setWorkItemTitle(event.target.value)}
                                    data-testid="dream-next-action-work-item-title"
                                />
                            </label>
                            <div className="grid gap-3 md:grid-cols-2">
                                <label className="block text-xs font-medium text-[#616161] dark:text-[#999]">
                                    Type
                                    <select
                                        className="mt-1 w-full rounded border border-[#d0d7de] bg-white px-2 py-1 text-sm text-[#1e1e1e] dark:border-[#3c3c3c] dark:bg-[#1e1e1e] dark:text-[#cccccc]"
                                        value={workItemType}
                                        onChange={event => setWorkItemType(event.target.value as WorkItemType)}
                                        data-testid="dream-next-action-work-item-type"
                                    >
                                        {WORK_ITEM_TYPES.map(type => <option key={type} value={type}>{type}</option>)}
                                    </select>
                                </label>
                                <label className="block text-xs font-medium text-[#616161] dark:text-[#999]">
                                    Priority
                                    <select
                                        className="mt-1 w-full rounded border border-[#d0d7de] bg-white px-2 py-1 text-sm text-[#1e1e1e] dark:border-[#3c3c3c] dark:bg-[#1e1e1e] dark:text-[#cccccc]"
                                        value={workItemPriority}
                                        onChange={event => setWorkItemPriority(event.target.value as WorkItemPriority)}
                                        data-testid="dream-next-action-work-item-priority"
                                    >
                                        {WORK_ITEM_PRIORITIES.map(priority => <option key={priority} value={priority}>{priority}</option>)}
                                    </select>
                                </label>
                            </div>
                            <label className="block text-xs font-medium text-[#616161] dark:text-[#999]">
                                Description
                                <textarea
                                    className="mt-1 h-56 w-full rounded border border-[#d0d7de] bg-white px-2 py-1 font-mono text-xs text-[#1e1e1e] dark:border-[#3c3c3c] dark:bg-[#1e1e1e] dark:text-[#cccccc]"
                                    value={workItemDescription}
                                    onChange={event => setWorkItemDescription(event.target.value)}
                                    data-testid="dream-next-action-work-item-description"
                                />
                            </label>
                        </>
                    )}

                    {actionKind === 'work-item-update' && (
                        <label className="block text-xs font-medium text-[#616161] dark:text-[#999]">
                            Existing work item ID
                            <input
                                className="mt-1 w-full rounded border border-[#d0d7de] bg-white px-2 py-1 text-sm text-[#1e1e1e] dark:border-[#3c3c3c] dark:bg-[#1e1e1e] dark:text-[#cccccc]"
                                value={existingWorkItemId}
                                onChange={event => setExistingWorkItemId(event.target.value)}
                                placeholder="WI-123 or work item UUID"
                                data-testid="dream-next-action-existing-work-item-id"
                            />
                            <span className="mt-1 block text-[11px] text-[#848484]">
                                The dream recommendation will be appended to the existing description and tagged for history.
                            </span>
                        </label>
                    )}

                    {error && <div className="text-xs text-red-600 dark:text-red-400" role="alert">{error}</div>}
                </div>
                <div className="mt-4 flex items-center justify-end gap-2">
                    <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>Cancel</Button>
                    <Button size="sm" onClick={handleSubmit} loading={saving} data-testid="dream-next-action-submit">
                        Confirm and record conversion
                    </Button>
                </div>
            </div>
        </div>
    );
}

interface DreamCardViewProps {
    card: DreamCard;
    workspaceId: string;
    busyAction: string | null;
    onApprove: (card: DreamCard) => void;
    onDismiss: (card: DreamCard) => void;
    onConvert: (card: DreamCard) => void;
    onTakeNextAction: (card: DreamCard) => void;
    onSupersede: (card: DreamCard) => void;
}

function DreamCardView({
    card,
    workspaceId,
    busyAction,
    onApprove,
    onDismiss,
    onConvert,
    onTakeNextAction,
    onSupersede,
}: DreamCardViewProps) {
    const canApprove = card.status === 'visible';
    const canDismiss = card.status === 'visible';
    const canTakeNextAction = card.status === 'approved';
    const canConvert = card.status === 'visible' || card.status === 'approved';
    const canSupersede = card.status === 'visible' || card.status === 'candidate';
    const isBusy = busyAction?.startsWith(`${card.id}:`) ?? false;

    return (
        <Card className="bg-white p-4 dark:bg-[#252526]" data-testid={`dream-card-${card.id}`}>
            <div className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center gap-2">
                    <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold', CATEGORY_STYLES[card.category])}>
                        {CATEGORY_LABELS[card.category]}
                    </span>
                    <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold', STATUS_STYLES[card.status])}>
                        {statusLabel(card.status)}
                    </span>
                    <span className="rounded-full bg-[#ddf4ff] px-2 py-0.5 text-[11px] font-semibold text-[#0969da] dark:bg-[#3794ff]/20 dark:text-[#79c0ff]">
                        {formatConfidence(card.confidence)} confidence
                    </span>
                    <span className="text-[11px] text-[#848484]">Updated {formatDate(card.updatedAt)}</span>
                </div>

                <div>
                    <h3 className="text-sm font-semibold text-[#1e1e1e] dark:text-[#cccccc]">Observed pattern</h3>
                    <p className="mt-1 text-sm text-[#1e1e1e] dark:text-[#cccccc]">{card.observedPattern}</p>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                    <section>
                        <h4 className="text-xs font-semibold uppercase tracking-wide text-[#848484]">Why it matters</h4>
                        <p className="mt-1 text-sm text-[#1e1e1e] dark:text-[#cccccc]">{card.whyItMatters}</p>
                    </section>
                    <section>
                        <h4 className="text-xs font-semibold uppercase tracking-wide text-[#848484]">Recommendation</h4>
                        <p className="mt-1 text-sm text-[#1e1e1e] dark:text-[#cccccc]">{card.recommendation}</p>
                    </section>
                    <section>
                        <h4 className="text-xs font-semibold uppercase tracking-wide text-[#848484]">Expected impact</h4>
                        <p className="mt-1 text-sm text-[#1e1e1e] dark:text-[#cccccc]">{card.expectedImpact}</p>
                    </section>
                    <section>
                        <h4 className="text-xs font-semibold uppercase tracking-wide text-[#848484]">Not already covered</h4>
                        <p className="mt-1 text-sm text-[#1e1e1e] dark:text-[#cccccc]">{card.notAlreadyCoveredRationale}</p>
                    </section>
                </div>

                {(card.criticRationale || card.dedupRationale || card.conversion) && (
                    <div className="rounded-md bg-[#f6f8fa] p-3 text-xs text-[#616161] dark:bg-[#1e1e1e] dark:text-[#999]">
                        {card.criticRationale && <p><strong>Critic:</strong> {card.criticRationale}</p>}
                        {card.dedupRationale && <p><strong>Dedup:</strong> {card.dedupRationale}</p>}
                        {card.conversion && (
                            <p>
                                <strong>Converted:</strong> {CONVERSION_LABELS[card.conversion.artifactType]} {card.conversion.artifactId}
                                {card.conversion.artifactUrl && (
                                    <>
                                        {' '}
                                        <a className="text-[#0969da] hover:underline" href={card.conversion.artifactUrl} target="_blank" rel="noreferrer">Open artifact</a>
                                    </>
                                )}
                            </p>
                        )}
                    </div>
                )}

                <div>
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-[#848484]">Sources</h4>
                    <div className="mt-1 flex flex-wrap gap-2">
                        {card.sourceRanges.map(range => (
                            <a
                                key={`${range.processId}:${range.startTurnIndex}:${range.endTurnIndex}`}
                                className="rounded border border-[#d0d7de] px-2 py-1 text-xs text-[#0969da] hover:bg-[#ddf4ff] dark:border-[#3c3c3c] dark:text-[#79c0ff] dark:hover:bg-[#3794ff]/20"
                                href={sourceHash(workspaceId, range.processId)}
                                data-testid="dream-source-link"
                            >
                                {range.processId} turns {range.startTurnIndex}-{range.endTurnIndex}
                            </a>
                        ))}
                    </div>
                </div>

                <div className="flex flex-col gap-2 border-t border-[#e0e0e0] pt-3 dark:border-[#3c3c3c] md:flex-row md:items-center md:justify-between">
                    <div className="min-w-0 text-[11px] text-[#848484]">
                        <div className="truncate font-mono" title={card.dedupFingerprint}>Fingerprint: {card.dedupFingerprint}</div>
                        {card.status === 'approved' && <div className="mt-1">{nextActionCopy(card.category)}</div>}
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {canApprove && (
                            <Button size="sm" onClick={() => onApprove(card)} loading={busyAction === `${card.id}:approve`} disabled={isBusy}>
                                Approve
                            </Button>
                        )}
                        {canDismiss && (
                            <Button size="sm" variant="ghost" onClick={() => onDismiss(card)} loading={busyAction === `${card.id}:dismiss`} disabled={isBusy}>
                                Dismiss
                            </Button>
                        )}
                        {canTakeNextAction && (
                            <Button size="sm" onClick={() => onTakeNextAction(card)} disabled={isBusy} data-testid={`dream-next-action-${card.id}`}>
                                Take next action
                            </Button>
                        )}
                        {canConvert && (
                            <Button size="sm" variant="secondary" onClick={() => onConvert(card)} disabled={isBusy} data-testid={`dream-convert-${card.id}`}>
                                Record conversion
                            </Button>
                        )}
                        {canSupersede && (
                            <Button size="sm" variant="ghost" onClick={() => onSupersede(card)} loading={busyAction === `${card.id}:supersede`} disabled={isBusy}>
                                Supersede
                            </Button>
                        )}
                    </div>
                </div>
            </div>
        </Card>
    );
}

export function DreamsPanel({ workspaceId }: DreamsPanelProps) {
    const globalEnabled = isDreamsEnabled();
    const [preferencesLoading, setPreferencesLoading] = useState(globalEnabled);
    const [preferencesError, setPreferencesError] = useState<string | null>(null);
    const [workspaceEnabled, setWorkspaceEnabled] = useState(false);
    const [enablingWorkspace, setEnablingWorkspace] = useState(false);
    const [activeFilter, setActiveFilter] = useState<DreamFilterId>('visible');
    const [cards, setCards] = useState<DreamCard[]>([]);
    const [cardsLoading, setCardsLoading] = useState(false);
    const [cardsError, setCardsError] = useState<string | null>(null);
    const [runningNow, setRunningNow] = useState(false);
    const [lastRun, setLastRun] = useState<DreamRunResponse | null>(null);
    const [busyAction, setBusyAction] = useState<string | null>(null);
    const [convertCard, setConvertCard] = useState<DreamCard | null>(null);
    const [nextActionCard, setNextActionCard] = useState<DreamCard | null>(null);

    const selectedFilter = useMemo(
        () => FILTERS.find(filter => filter.id === activeFilter) ?? FILTERS[0],
        [activeFilter],
    );

    useEffect(() => {
        if (!globalEnabled) {
            setPreferencesLoading(false);
            setWorkspaceEnabled(false);
            return;
        }

        let cancelled = false;
        setPreferencesLoading(true);
        setPreferencesError(null);
        runDreamsRequest<PerRepoPreferences>(
            () => getSpaCocClient().preferences.getRepo(workspaceId),
            'Failed to load dream preferences',
        )
            .then(preferences => {
                if (!cancelled) {
                    setWorkspaceEnabled(preferences.dreams?.enabled === true);
                }
            })
            .catch(error => {
                if (!cancelled) {
                    setPreferencesError(error instanceof Error ? error.message : String(error));
                    setWorkspaceEnabled(false);
                }
            })
            .finally(() => {
                if (!cancelled) setPreferencesLoading(false);
            });
        return () => { cancelled = true; };
    }, [globalEnabled, workspaceId]);

    const loadCards = useCallback(async () => {
        if (!globalEnabled || !workspaceEnabled) return;
        setCardsLoading(true);
        setCardsError(null);
        try {
            const nextCards = await runDreamsRequest(
                () => getSpaCocClient().dreams.listCards(workspaceId, filterOptions(activeFilter)),
                'Failed to load dream cards',
            );
            setCards(nextCards);
        } catch (error) {
            setCardsError(error instanceof Error ? error.message : String(error));
            setCards([]);
        } finally {
            setCardsLoading(false);
        }
    }, [activeFilter, globalEnabled, workspaceEnabled, workspaceId]);

    useEffect(() => {
        void loadCards();
    }, [loadCards]);

    async function enableWorkspaceDreams() {
        setEnablingWorkspace(true);
        setPreferencesError(null);
        try {
            await runDreamsRequest(
                () => getSpaCocClient().preferences.patchRepo(workspaceId, { dreams: { enabled: true } }),
                'Failed to enable workspace dreams',
            );
            setWorkspaceEnabled(true);
        } catch (error) {
            setPreferencesError(error instanceof Error ? error.message : String(error));
        } finally {
            setEnablingWorkspace(false);
        }
    }

    async function runNow() {
        setRunningNow(true);
        setCardsError(null);
        try {
            const result = await runDreamsRequest(
                () => getSpaCocClient().dreams.runNow(workspaceId),
                'Failed to run dreams',
            );
            setLastRun(result);
            await loadCards();
        } catch (error) {
            setCardsError(error instanceof Error ? error.message : String(error));
        } finally {
            setRunningNow(false);
        }
    }

    async function performCardAction(
        card: DreamCard,
        action: 'approve' | 'dismiss' | 'supersede' | 'convert',
        request: () => Promise<DreamCard>,
    ) {
        setBusyAction(`${card.id}:${action}`);
        setCardsError(null);
        try {
            await runDreamsRequest(request, `Failed to ${action} dream card`);
            await loadCards();
        } catch (error) {
            setCardsError(error instanceof Error ? error.message : String(error));
            throw error;
        } finally {
            setBusyAction(null);
        }
    }

    function supersedeCard(card: DreamCard) {
        const rationale = window.prompt('Why should this dream be superseded?');
        if (!rationale?.trim()) return;
        void performCardAction(card, 'supersede', () =>
            getSpaCocClient().dreams.markSuperseded(workspaceId, card.id, { dedupRationale: rationale.trim() }),
        ).catch(() => undefined);
    }

    const ranWithoutCards = lastRun !== null && lastRun.cards.length === 0;

    if (!globalEnabled) {
        return (
            <div className="flex h-full items-center justify-center p-6" data-testid="dreams-disabled-by-flag">
                <div className="max-w-md rounded-lg border border-[#d0d7de] bg-white p-5 text-center dark:border-[#3c3c3c] dark:bg-[#252526]">
                    <h2 className="text-base font-semibold text-[#1e1e1e] dark:text-[#cccccc]">Dreaming is disabled</h2>
                    <p className="mt-2 text-sm text-[#616161] dark:text-[#999]">
                        Enable the global <code>dreams.enabled</code> feature flag in Admin before reviewing workspace dreams.
                    </p>
                </div>
            </div>
        );
    }

    if (preferencesLoading) {
        return (
            <div className="flex h-full items-center justify-center" data-testid="dreams-loading">
                <Spinner />
            </div>
        );
    }

    if (preferencesError && !workspaceEnabled) {
        return (
            <div className="flex h-full items-center justify-center p-6" data-testid="dreams-error-state">
                <div className="max-w-md rounded-lg border border-red-200 bg-red-50 p-5 text-center text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
                    <h2 className="text-sm font-semibold">Dreams unavailable</h2>
                    <p className="mt-2 text-xs">{preferencesError}</p>
                </div>
            </div>
        );
    }

    if (!workspaceEnabled) {
        return (
            <div className="flex h-full items-center justify-center p-6" data-testid="dreams-workspace-disabled">
                <div className="max-w-lg rounded-lg border border-[#d0d7de] bg-white p-5 text-center dark:border-[#3c3c3c] dark:bg-[#252526]">
                    <h2 className="text-base font-semibold text-[#1e1e1e] dark:text-[#cccccc]">Workspace dreaming is off</h2>
                    <p className="mt-2 text-sm text-[#616161] dark:text-[#999]">
                        Dream cards are opt-in per workspace. Enabling this workspace does not affect any other registered repository.
                    </p>
                    {preferencesError && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{preferencesError}</p>}
                    <div className="mt-4">
                        <Button onClick={enableWorkspaceDreams} loading={enablingWorkspace} data-testid="dreams-enable-workspace">
                            Enable Dreams for this workspace
                        </Button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="flex h-full min-h-0 flex-col bg-[#f6f8fa] dark:bg-[#1e1e1e]" data-testid="dreams-panel">
            <div className="flex flex-col gap-3 border-b border-[#d0d7de] bg-white px-4 py-3 dark:border-[#3c3c3c] dark:bg-[#252526] md:flex-row md:items-center md:justify-between">
                <div>
                    <h2 className="text-base font-semibold text-[#1e1e1e] dark:text-[#cccccc]">Dreams</h2>
                    <p className="text-xs text-[#616161] dark:text-[#999]">
                        Review high-confidence opportunities found during idle workspace reflection.
                    </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <Button variant="secondary" size="sm" onClick={loadCards} loading={cardsLoading && cards.length > 0}>
                        Refresh
                    </Button>
                    <Button size="sm" onClick={runNow} loading={runningNow} data-testid="dreams-run-now">
                        Run dream now
                    </Button>
                </div>
            </div>

            {lastRun && (
                <div className="border-b border-[#d0d7de] bg-[#fff8e1] px-4 py-3 dark:border-[#3c3c3c] dark:bg-amber-950/20" data-testid="dreams-run-summary">
                    <div className="grid gap-2 md:grid-cols-4">
                        <SummaryMetric label="Run" value={lastRun.run.status} />
                        <SummaryMetric label="Sources" value={lastRun.selection.conversationCount} />
                        <SummaryMetric label="Accepted" value={lastRun.analysis.acceptedCandidateCount} />
                        <SummaryMetric label="Rejected" value={lastRun.analysis.rejectedCandidateCount} />
                    </div>
                </div>
            )}

            <div className="flex flex-wrap items-center gap-2 border-b border-[#d0d7de] bg-white px-4 py-2 dark:border-[#3c3c3c] dark:bg-[#252526]">
                {FILTERS.map(filter => {
                    const active = filter.id === activeFilter;
                    return (
                        <button
                            key={filter.id}
                            className={cn(
                                'rounded-full px-3 py-1 text-xs font-semibold transition-colors',
                                active
                                    ? 'bg-[#0969da] text-white dark:bg-[#3794ff] dark:text-[#1e1e1e]'
                                    : 'bg-[#f6f8fa] text-[#616161] hover:bg-[#eaeef2] dark:bg-[#1e1e1e] dark:text-[#999] dark:hover:bg-[#2a2a2a]',
                            )}
                            onClick={() => setActiveFilter(filter.id)}
                            data-testid={`dream-filter-${filter.id}`}
                        >
                            {filter.label}
                        </button>
                    );
                })}
            </div>

            {cardsError && (
                <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300" role="alert">
                    {cardsError}
                </div>
            )}

            <div className="min-h-0 flex-1 overflow-y-auto p-4">
                {cardsLoading && cards.length === 0 ? (
                    <div className="flex h-full items-center justify-center" data-testid="dreams-cards-loading">
                        <Spinner />
                    </div>
                ) : cards.length === 0 ? (
                    <EmptyState ranWithoutCards={ranWithoutCards && selectedFilter.id === 'visible'} />
                ) : (
                    <div className="mx-auto flex max-w-5xl flex-col gap-3">
                        {cards.map(card => (
                            <DreamCardView
                                key={card.id}
                                card={card}
                                workspaceId={workspaceId}
                                busyAction={busyAction}
                                onApprove={approvedCard => void performCardAction(
                                    approvedCard,
                                    'approve',
                                    () => getSpaCocClient().dreams.approve(workspaceId, approvedCard.id),
                                ).catch(() => undefined)}
                                 onDismiss={dismissedCard => void performCardAction(
                                     dismissedCard,
                                     'dismiss',
                                     () => getSpaCocClient().dreams.dismiss(workspaceId, dismissedCard.id, { dedupRationale: 'Dismissed from Dreams review.' }),
                                 ).catch(() => undefined)}
                                 onConvert={setConvertCard}
                                 onTakeNextAction={setNextActionCard}
                                 onSupersede={supersedeCard}
                             />
                         ))}
                    </div>
                )}
            </div>

            {convertCard && (
                <ConvertDialog
                    card={convertCard}
                    onClose={() => setConvertCard(null)}
                    onSubmit={async request => {
                        await performCardAction(
                            convertCard,
                            'convert',
                            () => getSpaCocClient().dreams.convert(workspaceId, convertCard.id, request),
                        );
                        setConvertCard(null);
                    }}
                />
            )}

            {nextActionCard && (
                <NextActionDialog
                    card={nextActionCard}
                    workspaceId={workspaceId}
                    onClose={() => setNextActionCard(null)}
                    onConverted={async request => {
                        await performCardAction(
                            nextActionCard,
                            'convert',
                            () => getSpaCocClient().dreams.convert(workspaceId, nextActionCard.id, request),
                        );
                    }}
                />
            )}
        </div>
    );
}
