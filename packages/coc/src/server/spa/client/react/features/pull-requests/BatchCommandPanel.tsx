import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchApi } from '../../hooks/useApi';
import { Button } from '../../ui';
import { SlashCommandMenu } from '../chat/SlashCommandMenu';
import { useSlashCommands } from '../chat/hooks/useSlashCommands';
import type { SkillItem } from '../chat/SlashCommandMenu';
import type { PullRequest } from './pr-utils';
import { ATTENTION_GROUP_CONFIGS, type AttentionGroup } from './pr-attention-groups';

export interface SlashActionTemplate {
    key: string;
    description?: string;
    templateText: string;
}

interface BatchCommandPanelProps {
    selectedPrIds: Set<string>;
    selectedPrs: PullRequest[];
    repoId: string;
    workspaceId: string;
    activeGroup?: AttentionGroup;
    onClearSelection: () => void;
}

function normalizeCommandKey(key: string): string {
    const trimmed = key.trim();
    return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

function commandName(key: string): string {
    return normalizeCommandKey(key).slice(1);
}

function formatPrList(prs: PullRequest[]): string {
    return prs
        .map(pr => {
            const number = pr.number ?? pr.id;
            return `#${number} ${pr.title}`;
        })
        .join('\n');
}

function resolveTemplate(templateText: string, prs: PullRequest[]): string {
    const prNumbers = prs.map(pr => `#${pr.number ?? pr.id}`).join(', ');
    return templateText
        .replace(/\{\{prList\}\}/g, formatPrList(prs))
        .replace(/\{\{prNumbers\}\}/g, prNumbers);
}

function getTemplatesFromResponse(response: unknown): SlashActionTemplate[] {
    if (Array.isArray(response)) {
        return response.filter(isSlashActionTemplate);
    }
    if (response && typeof response === 'object') {
        const templates = (response as { templates?: unknown }).templates;
        if (Array.isArray(templates)) {
            return templates.filter(isSlashActionTemplate);
        }
    }
    return [];
}

function isSlashActionTemplate(value: unknown): value is SlashActionTemplate {
    if (!value || typeof value !== 'object') return false;
    const record = value as Record<string, unknown>;
    return typeof record.key === 'string' && typeof record.templateText === 'string';
}

export function BatchCommandPanel({
    selectedPrIds,
    selectedPrs,
    repoId,
    workspaceId,
    activeGroup,
    onClearSelection,
}: BatchCommandPanelProps) {
    const [commandInput, setCommandInput] = useState('');
    const [resolvedPrompt, setResolvedPrompt] = useState('');
    const [isPromptEdited, setIsPromptEdited] = useState(false);
    const [templates, setTemplates] = useState<SlashActionTemplate[]>([]);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const groupConfig = useMemo(
        () => ATTENTION_GROUP_CONFIGS.find(config => config.group === activeGroup),
        [activeGroup],
    );

    const templateByKey = useMemo(() => {
        const map = new Map<string, SlashActionTemplate>();
        for (const template of templates) {
            map.set(normalizeCommandKey(template.key), template);
        }
        return map;
    }, [templates]);

    const slashSkills: SkillItem[] = useMemo(() => templates.map(template => ({
        name: commandName(template.key),
        description: template.description,
    })), [templates]);

    const slashCommands = useSlashCommands(slashSkills);

    const defaultCommand = useMemo(() => {
        if (groupConfig?.defaultAction) return normalizeCommandKey(groupConfig.defaultAction);
        if (templates[0]?.key) return normalizeCommandKey(templates[0].key);
        return '';
    }, [groupConfig?.defaultAction, templates]);

    useEffect(() => {
        let cancelled = false;
        setTemplates([]);
        setError(null);
        fetchApi(`/repos/${encodeURIComponent(repoId)}/pr-slash-templates`)
            .then(response => {
                if (!cancelled) {
                    setTemplates(getTemplatesFromResponse(response));
                }
            })
            .catch(err => {
                if (!cancelled) {
                    setError(err instanceof Error ? err.message : 'Failed to load PR action templates');
                }
            });
        return () => { cancelled = true; };
    }, [repoId]);

    useEffect(() => {
        setCommandInput(defaultCommand);
        setIsPromptEdited(false);
    }, [defaultCommand]);

    useEffect(() => {
        if (isPromptEdited) return;
        const template = templateByKey.get(normalizeCommandKey(commandInput));
        setResolvedPrompt(template ? resolveTemplate(template.templateText, selectedPrs) : '');
    }, [commandInput, isPromptEdited, selectedPrs, templateByKey]);

    const visiblePrs = selectedPrs.slice(0, 5);
    const overflowCount = Math.max(0, selectedPrs.length - visiblePrs.length);

    const handleCommandChange = useCallback((value: string, cursorPosition: number) => {
        setCommandInput(value);
        slashCommands.handleInputChange(value, cursorPosition);
    }, [slashCommands]);

    const handleSelectCommand = useCallback((name: string) => {
        const nextCommand = `/${name}`;
        setCommandInput(nextCommand);
        slashCommands.dismissMenu();
    }, [slashCommands]);

    const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
        if (!slashCommands.handleKeyDown(e)) return;
        if (e.key === 'Enter' || e.key === 'Tab') {
            const selected = slashCommands.filteredSkills[slashCommands.highlightIndex];
            if (selected) handleSelectCommand(selected.name);
        }
    }, [handleSelectCommand, slashCommands]);

    const handleSubmit = useCallback(async () => {
        const action = commandInput.trim();
        if (!action || submitting) return;

        setSubmitting(true);
        setError(null);
        try {
            await fetchApi('/queue', {
                method: 'POST',
                body: JSON.stringify({
                    type: 'chat',
                    displayName: `PR Batch: ${action} (${selectedPrIds.size} PRs)`,
                    payload: {
                        kind: 'pr-batch',
                        workspaceId,
                        repoId,
                        prNumbers: selectedPrs.map(pr => pr.number ?? pr.id),
                        action,
                        promptText: resolvedPrompt,
                    },
                }),
            });
            onClearSelection();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to queue batch job');
        } finally {
            setSubmitting(false);
        }
    }, [commandInput, onClearSelection, repoId, resolvedPrompt, selectedPrIds.size, selectedPrs, submitting, workspaceId]);

    return (
        <div className="flex h-full flex-col overflow-hidden bg-white text-gray-900 dark:bg-gray-950 dark:text-gray-100" data-testid="batch-command-panel">
            <div className="flex items-center justify-between gap-3 border-b border-gray-200 px-4 py-3 dark:border-gray-800">
                <div className="min-w-0">
                    <div className="text-sm font-semibold" data-testid="batch-command-heading">
                        Batch: {groupConfig?.label ?? 'Selected PRs'}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                        {selectedPrIds.size} PR{selectedPrIds.size !== 1 ? 's' : ''} selected
                    </div>
                </div>
                <Button variant="ghost" size="sm" onClick={onClearSelection} data-testid="batch-clear-selection">
                    Back
                </Button>
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto p-4">
                {error && (
                    <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200" data-testid="batch-command-error">
                        {error}
                    </div>
                )}

                <section>
                    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                        Selected PRs
                    </h3>
                    <ul className="space-y-1 text-sm" data-testid="batch-selected-pr-list">
                        {visiblePrs.map(pr => (
                            <li key={String(pr.number ?? pr.id)} className="truncate rounded bg-gray-50 px-2 py-1 dark:bg-gray-900">
                                <span className="font-medium text-gray-500 dark:text-gray-400">#{pr.number ?? pr.id}</span>{' '}
                                {pr.title}
                            </li>
                        ))}
                    </ul>
                    {overflowCount > 0 && (
                        <div className="mt-1 text-xs text-gray-500 dark:text-gray-400" data-testid="batch-selected-pr-overflow">
                            ...and {overflowCount} more
                        </div>
                    )}
                </section>

                <section>
                    <label htmlFor="batch-command-input" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                        Action
                    </label>
                    <div className="relative">
                        <input
                            id="batch-command-input"
                            value={commandInput}
                            onChange={e => handleCommandChange(e.target.value, e.target.selectionStart ?? e.target.value.length)}
                            onKeyDown={handleKeyDown}
                            disabled={submitting}
                            placeholder="/rerun"
                            className="w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
                            data-testid="batch-command-input"
                        />
                        <SlashCommandMenu
                            skills={slashSkills}
                            filter={slashCommands.menuFilter}
                            onSelect={handleSelectCommand}
                            onDismiss={slashCommands.dismissMenu}
                            visible={slashCommands.menuVisible}
                            highlightIndex={slashCommands.highlightIndex}
                        />
                    </div>
                </section>

                <section>
                    <label htmlFor="batch-prompt-preview" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                        Prompt preview
                    </label>
                    <textarea
                        id="batch-prompt-preview"
                        value={resolvedPrompt}
                        onChange={e => {
                            setResolvedPrompt(e.target.value);
                            setIsPromptEdited(true);
                        }}
                        rows={6}
                        disabled={submitting}
                        className="w-full resize-y rounded border border-gray-300 bg-gray-50 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
                        data-testid="batch-prompt-preview"
                    />
                </section>
            </div>

            <div className="border-t border-gray-200 p-4 dark:border-gray-800">
                <Button
                    className="w-full justify-center"
                    disabled={submitting || commandInput.trim() === ''}
                    loading={submitting}
                    onClick={handleSubmit}
                    data-testid="queue-batch-job"
                >
                    Queue batch job
                </Button>
            </div>
        </div>
    );
}
