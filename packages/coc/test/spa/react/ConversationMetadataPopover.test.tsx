import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import {
    ConversationMetadataPopover,
    getSessionIdFromProcess,
    buildRows,
    buildSummaryItems,
    buildCompactRows,
} from '../../../src/server/spa/client/react/features/chat/conversation/ConversationMetadataPopover';

beforeEach(() => {
    vi.restoreAllMocks();
});

const BASE_PROCESS = {
    id: 'proc-abc-123',
    type: 'chat',
    status: 'completed',
    startTime: '2026-01-15T10:00:00Z',
    endTime: '2026-01-15T10:05:00Z',
    workingDirectory: '/home/user/project',
    workspaceName: 'my-workspace',
    sdkSessionId: 'sdk-sess-789',
    metadata: { queueTaskId: 'qt-456', model: 'gpt-4', backend: 'copilot-sdk', mode: 'autopilot', provider: 'codex' },
};

function renderPopover(process: any = BASE_PROCESS, turnsCount?: number) {
    return render(<ConversationMetadataPopover process={process} turnsCount={turnsCount} />);
}

describe('ConversationMetadataPopover', () => {
    it('renders trigger even when process has only default model row', () => {
        const { container } = renderPopover({});
        expect(container.innerHTML).not.toBe('');
        expect(screen.getByRole('button', { name: /conversation metadata/i })).toBeDefined();
    });

    it('renders the trigger button with "i" text', () => {
        renderPopover();
        const btn = screen.getByRole('button', { name: /conversation metadata/i });
        expect(btn).toBeDefined();
        expect(btn.textContent).toBe('i');
    });

    it('opens popover on trigger click and shows header', async () => {
        renderPopover();
        const trigger = screen.getByRole('button', { name: /conversation metadata/i });

        await act(async () => {
            fireEvent.click(trigger);
        });

        expect(screen.getByText('Conversation metadata')).toBeDefined();
    });

    it('displays compact process metadata rows', async () => {
        renderPopover(BASE_PROCESS, 5);
        const trigger = screen.getByRole('button', { name: /conversation metadata/i });

        await act(async () => {
            fireEvent.click(trigger);
        });

        expect(screen.getByText('Process ID')).toBeDefined();
        expect(screen.getByText('proc-abc-123')).toBeDefined();
        expect(screen.getByText('Queue Task ID')).toBeDefined();
        expect(screen.getByText('qt-456')).toBeDefined();
        expect(screen.queryByText('Type')).toBeNull();
        expect(screen.getByText('chat')).toBeDefined();
        expect(screen.queryByText('Status')).toBeNull();
        expect(screen.getByText('completed')).toBeDefined();
        expect(screen.queryByText('Model')).toBeNull();
        expect(screen.getByText('gpt-4')).toBeDefined();
        expect(screen.queryByText('Mode')).toBeNull();
        expect(screen.getByText('autopilot')).toBeDefined();
        expect(screen.queryByText('Agent Provider')).toBeNull();
        expect(screen.getByText('codex')).toBeDefined();
        expect(screen.getByText('Session ID')).toBeDefined();
        expect(screen.getByText('sdk-sess-789')).toBeDefined();
        expect(screen.getByText('Backend')).toBeDefined();
        expect(screen.getByText('copilot-sdk')).toBeDefined();
        expect(screen.getByText('Time')).toBeDefined();
        expect(screen.getByText(/5m 0s/)).toBeDefined();
        expect(screen.getByText('Workspace')).toBeDefined();
        expect(screen.getByText('my-workspace · /home/user/project · 5 turns')).toBeDefined();
        expect(screen.queryByText('Working Directory')).toBeNull();
        expect(screen.queryByText('Turns')).toBeNull();
    });

    it('renders popover via createPortal into document.body', async () => {
        renderPopover();
        const trigger = screen.getByRole('button', { name: /conversation metadata/i });

        await act(async () => {
            fireEvent.click(trigger);
        });

        const popover = document.querySelector('[class*="z-[10003]"]');
        expect(popover).not.toBeNull();
        expect(popover?.parentElement).toBe(document.body);
    });

    it('closes popover on second trigger click', async () => {
        renderPopover();
        const trigger = screen.getByRole('button', { name: /conversation metadata/i });

        await act(async () => {
            fireEvent.click(trigger);
        });
        expect(screen.getByText('Conversation metadata')).toBeDefined();

        await act(async () => {
            fireEvent.click(trigger);
        });
        expect(screen.queryByText('Conversation metadata')).toBeNull();
    });

    it('closes popover on Escape key', async () => {
        renderPopover();
        const trigger = screen.getByRole('button', { name: /conversation metadata/i });

        await act(async () => {
            fireEvent.click(trigger);
        });
        expect(screen.getByText('Conversation metadata')).toBeDefined();

        await act(async () => {
            fireEvent.keyDown(document, { key: 'Escape' });
        });
        expect(screen.queryByText('Conversation metadata')).toBeNull();
    });

    it('closes popover on outside mousedown', async () => {
        renderPopover();
        const trigger = screen.getByRole('button', { name: /conversation metadata/i });

        await act(async () => {
            fireEvent.click(trigger);
        });
        expect(screen.getByText('Conversation metadata')).toBeDefined();

        await act(async () => {
            fireEvent.mouseDown(document.body);
        });
        expect(screen.queryByText('Conversation metadata')).toBeNull();
    });

    it('does not close popover when clicking inside it', async () => {
        renderPopover();
        const trigger = screen.getByRole('button', { name: /conversation metadata/i });

        await act(async () => {
            fireEvent.click(trigger);
        });

        const header = screen.getByText('Conversation metadata');
        await act(async () => {
            fireEvent.mouseDown(header);
        });
        expect(screen.getByText('Conversation metadata')).toBeDefined();
    });

    it('uses fixed positioning with style top/left', async () => {
        renderPopover();
        const trigger = screen.getByRole('button', { name: /conversation metadata/i });

        await act(async () => {
            fireEvent.click(trigger);
        });

        const popover = document.querySelector('[class*="z-[10003]"]') as HTMLElement;
        expect(popover).not.toBeNull();
        expect(popover.style.top).toBeDefined();
        expect(popover.style.left).toBeDefined();
    });

    it('uses grid layout with label+value columns', async () => {
        renderPopover();
        const trigger = screen.getByRole('button', { name: /conversation metadata/i });

        await act(async () => {
            fireEvent.click(trigger);
        });

        const grid = document.querySelector('.grid');
        expect(grid).not.toBeNull();
    });

    it('omits rows with null/empty values', async () => {
        const sparseProcess = { id: 'p-1', status: 'running' };
        renderPopover(sparseProcess);
        const trigger = screen.getByRole('button', { name: /conversation metadata/i });

        await act(async () => {
            fireEvent.click(trigger);
        });

        expect(screen.getByText('Process ID')).toBeDefined();
        expect(screen.queryByText('Status')).toBeNull();
        expect(screen.getByText('running')).toBeDefined();
        expect(screen.queryByText('Queue Task ID')).toBeNull();
        expect(screen.queryByText('Model')).toBeNull();
        expect(screen.getByText('default')).toBeDefined();
        expect(screen.queryByText('Working Directory')).toBeNull();
    });
});

describe('compact metadata helpers', () => {
    it('moves short categorical fields into a summary strip', () => {
        const rows = buildRows(BASE_PROCESS, 5);
        expect(buildSummaryItems(rows)).toEqual(['chat', 'completed', 'autopilot', 'codex', 'gpt-4', 'effort Default']);
    });

    it('includes reasoning effort as a compact summary item', () => {
        const rows = buildRows({ ...BASE_PROCESS, config: { reasoningEffort: 'high' } });
        expect(buildSummaryItems(rows)).toContain('effort High');
    });

    it('merges time, workspace, and Ralph fields into compact rows', () => {
        const rows = buildRows({
            ...BASE_PROCESS,
            payload: { context: { ralph: {
                phase: 'executing',
                sessionId: 'ralph-session-1',
                currentIteration: 2,
                originalGoal: 'Make metadata easier to scan',
            } } },
        }, 5);

        const compactRows = buildCompactRows(rows);
        const labels = compactRows.map(row => row.label);
        expect(labels).toContain('Time');
        expect(labels).toContain('Workspace');
        expect(labels).toContain('Ralph');
        expect(labels).toContain('Goal');
        expect(labels).not.toContain('Started');
        expect(labels).not.toContain('Ended');
        expect(labels).not.toContain('Duration');
        expect(labels).not.toContain('Working Directory');
        expect(labels).not.toContain('Turns');
        expect(labels).not.toContain('Ralph · Phase');
        expect(labels).not.toContain('Ralph · Session ID');
        expect(labels).not.toContain('Ralph · Iteration');
        expect(labels).not.toContain('Ralph · Goal');

        expect(compactRows.find(row => row.label === 'Time')!.value).toContain('5m 0s');
        expect(compactRows.find(row => row.label === 'Workspace')!.value).toBe('my-workspace · /home/user/project · 5 turns');
        expect(compactRows.find(row => row.label === 'Ralph')!.value).toBe('executing · iteration 2 · ralph-session-1');
        expect(compactRows.find(row => row.label === 'Goal')!.value).toBe('Make metadata easier to scan');
    });
});

describe('ConversationMetadataPopover – token and cost rows', () => {
    const TOKEN_USAGE = {
        inputTokens: 1_234,
        outputTokens: 567,
        cacheReadTokens: 89,
        cacheWriteTokens: 10,
        totalTokens: 1_801,
        turnCount: 2,
    };

    it('shows total tokens from cumulativeTokenUsage and expands to the breakdown', async () => {
        renderPopover({ ...BASE_PROCESS, cumulativeTokenUsage: TOKEN_USAGE });
        const trigger = screen.getByRole('button', { name: /conversation metadata/i });

        await act(async () => {
            fireEvent.click(trigger);
        });

        expect(screen.getByText('Tokens')).toBeDefined();
        const tokenButton = screen.getByRole('button', { name: 'Total: 1,801' });
        expect(tokenButton).toHaveAttribute('aria-expanded', 'false');

        await act(async () => {
            fireEvent.click(tokenButton);
        });

        expect(tokenButton).toHaveAttribute('aria-expanded', 'true');
        expect(screen.getByText(/Input: 1,234/)).toBeDefined();
        expect(screen.getByText(/Output: 567/)).toBeDefined();
        expect(screen.getByText(/Cache read: 89/)).toBeDefined();
        expect(screen.getByText(/Cache write: 10/)).toBeDefined();
        expect(screen.getByText(/Total: 1,801/)).toBeDefined();
    });

    it('shows a priced estimated USD cost with Stats-page USD formatting and text pricing source', async () => {
        renderPopover({
            ...BASE_PROCESS,
            cumulativeTokenUsage: TOKEN_USAGE,
            conversationCostEstimate: {
                estimatedUsdCost: 42.314,
                displayedUsdCost: 42.314,
                displayedUsdCostSource: 'estimated',
                costBreakdown: { inputUsd: 10, cachedInputUsd: 0.25, cacheWriteUsd: 0.064, outputUsd: 32 },
                pricingSource: 'Copilot pricing table',
                unpricedTurnCount: 0,
                pricingUnavailable: false,
            },
        });
        const trigger = screen.getByRole('button', { name: /conversation metadata/i });

        await act(async () => {
            fireEvent.click(trigger);
        });

        expect(screen.getByText('USD cost')).toBeDefined();
        expect(screen.getByText(/\$42\.31 \(pricing estimate\)/)).toBeDefined();
        expect(screen.getByText(/Source: Copilot pricing table/)).toBeDefined();
        expect(screen.getByTitle(/Displayed USD: \$42\.31 \(pricing estimate\)/)).toBeDefined();
    });

    it('renders URL pricing sources as compact links without showing the full URL', async () => {
        const pricingSource = 'https://docs.github.com/en/enterprise-cloud@latest/copilot/reference/copilot-billing/models-and-pricing';
        renderPopover({
            ...BASE_PROCESS,
            cumulativeTokenUsage: TOKEN_USAGE,
            conversationCostEstimate: {
                estimatedUsdCost: 1.72,
                displayedUsdCost: 1.72,
                displayedUsdCostSource: 'estimated',
                costBreakdown: { inputUsd: 0.5, cachedInputUsd: 0.02, cacheWriteUsd: 0, outputUsd: 1.2 },
                pricingSource,
                unpricedTurnCount: 0,
                pricingUnavailable: false,
            },
        });
        const trigger = screen.getByRole('button', { name: /conversation metadata/i });

        await act(async () => {
            fireEvent.click(trigger);
        });

        expect(screen.getByText(/\$1\.72 \(pricing estimate\)/)).toBeDefined();
        expect(document.body.textContent).not.toContain(pricingSource);
        const link = screen.getByRole('link', { name: 'Source' }) as HTMLAnchorElement;
        expect(link.href).toBe(pricingSource);
        expect(link.title).toBe(pricingSource);
    });

    it('uses sub-cent USD formatting for small estimated costs', async () => {
        renderPopover({
            ...BASE_PROCESS,
            cumulativeTokenUsage: TOKEN_USAGE,
            conversationCostEstimate: {
                estimatedUsdCost: 0.0042,
                displayedUsdCost: 0.0042,
                displayedUsdCostSource: 'estimated',
                costBreakdown: { inputUsd: 0.001, cachedInputUsd: 0.0002, cacheWriteUsd: 0, outputUsd: 0.003 },
                pricingSource: 'Copilot pricing table',
                unpricedTurnCount: 0,
                pricingUnavailable: false,
            },
        });
        const trigger = screen.getByRole('button', { name: /conversation metadata/i });

        await act(async () => {
            fireEvent.click(trigger);
        });

        expect(screen.getByText(/\$0\.0042 \(pricing estimate\)/)).toBeDefined();
    });

    it('uses Claude native USD ahead of the pricing-table estimate', async () => {
        renderPopover({
            ...BASE_PROCESS,
            metadata: { ...BASE_PROCESS.metadata, provider: 'claude', model: 'claude-sonnet-4.6' },
            cumulativeTokenUsage: {
                ...TOKEN_USAGE,
                actualUsdCost: 0.1234,
                estimatedUsdCost: 42.314,
            },
            conversationCostEstimate: {
                actualUsdCost: 0.1234,
                estimatedUsdCost: 42.314,
                displayedUsdCost: 0.1234,
                displayedUsdCostSource: 'native',
                costBreakdown: { inputUsd: 10, cachedInputUsd: 0.25, cacheWriteUsd: 0.064, outputUsd: 32 },
                pricingSource: 'Copilot pricing table',
                unpricedTurnCount: 0,
                pricingUnavailable: false,
            },
        });
        const trigger = screen.getByRole('button', { name: /conversation metadata/i });

        await act(async () => {
            fireEvent.click(trigger);
        });

        expect(screen.getByText('USD cost')).toBeDefined();
        expect(screen.getByText(/\$0\.12 \(native reported\)/)).toBeDefined();
        expect(screen.queryByText(/\$42\.31 \(pricing estimate\)/)).toBeNull();
        expect(screen.getByTitle(/Displayed USD: \$0\.12 \(native reported\)/)).toBeDefined();
        expect(screen.getByTitle(/Pricing-table estimate: \$42\.31/)).toBeDefined();
    });

    it('uses estimated USD for Codex and Copilot when no native USD is present', async () => {
        const cases = [
            { provider: 'codex', model: 'gpt-5.3-codex', expected: '$1.50' },
            { provider: 'copilot', model: 'gpt-5.5', expected: '$2.25' },
        ];

        for (const item of cases) {
            const { unmount } = renderPopover({
                ...BASE_PROCESS,
                metadata: { ...BASE_PROCESS.metadata, provider: item.provider, model: item.model },
                cumulativeTokenUsage: TOKEN_USAGE,
                conversationCostEstimate: {
                    estimatedUsdCost: item.provider === 'codex' ? 1.5 : 2.25,
                    displayedUsdCost: item.provider === 'codex' ? 1.5 : 2.25,
                    displayedUsdCostSource: 'estimated',
                    costBreakdown: { inputUsd: 0.5, cachedInputUsd: 0, cacheWriteUsd: 0, outputUsd: item.provider === 'codex' ? 1 : 1.75 },
                    pricingSource: 'Copilot pricing table',
                    unpricedTurnCount: 0,
                    pricingUnavailable: false,
                },
            });
            const trigger = screen.getByRole('button', { name: /conversation metadata/i });

            await act(async () => {
                fireEvent.click(trigger);
            });

            expect(screen.getByText(new RegExp(`\\${item.expected} \\(pricing estimate\\)`))).toBeDefined();
            expect(screen.getByTitle(new RegExp(`Displayed USD: \\${item.expected} \\(pricing estimate\\)`))).toBeDefined();
            unmount();
        }
    });

    it('omits the token and cost section when cumulativeTokenUsage is missing', async () => {
        renderPopover({
            ...BASE_PROCESS,
            conversationCostEstimate: {
                estimatedUsdCost: 1,
                costBreakdown: { inputUsd: 1, cachedInputUsd: 0, cacheWriteUsd: 0, outputUsd: 0 },
                pricingSource: 'Copilot pricing table',
                unpricedTurnCount: 0,
                pricingUnavailable: false,
            },
        });
        const trigger = screen.getByRole('button', { name: /conversation metadata/i });

        await act(async () => {
            fireEvent.click(trigger);
        });

        expect(screen.queryByText('Tokens')).toBeNull();
        expect(screen.queryByText('USD cost')).toBeNull();
    });

    it('shows pricing unavailable when all usage-bearing turns are unpriced', async () => {
        renderPopover({
            ...BASE_PROCESS,
            cumulativeTokenUsage: TOKEN_USAGE,
            conversationCostEstimate: {
                estimatedUsdCost: 0,
                costBreakdown: { inputUsd: 0, cachedInputUsd: 0, cacheWriteUsd: 0, outputUsd: 0 },
                unpricedTurnCount: 1,
                pricingUnavailable: true,
            },
        });
        const trigger = screen.getByRole('button', { name: /conversation metadata/i });

        await act(async () => {
            fireEvent.click(trigger);
        });

        expect(screen.getByText(/pricing unavailable/)).toBeDefined();
        expect(screen.getByText(/1 turn unpriced/)).toBeDefined();
    });

    it('shows a partial caveat when priced and unpriced turns are mixed', async () => {
        renderPopover({
            ...BASE_PROCESS,
            cumulativeTokenUsage: TOKEN_USAGE,
            conversationCostEstimate: {
                estimatedUsdCost: 1.234,
                displayedUsdCost: 1.234,
                displayedUsdCostSource: 'estimated',
                costBreakdown: { inputUsd: 0.5, cachedInputUsd: 0.034, cacheWriteUsd: 0, outputUsd: 0.7 },
                pricingSource: 'Copilot pricing table',
                unpricedTurnCount: 2,
                pricingUnavailable: false,
            },
        });
        const trigger = screen.getByRole('button', { name: /conversation metadata/i });

        await act(async () => {
            fireEvent.click(trigger);
        });

        expect(screen.getByText(/\$1\.23 \(pricing estimate\)/)).toBeDefined();
        expect(screen.getByText(/partial — 2 turns unpriced/)).toBeDefined();
    });
});

describe('getSessionIdFromProcess', () => {
    it('returns null for null/undefined process', () => {
        expect(getSessionIdFromProcess(null)).toBeNull();
        expect(getSessionIdFromProcess(undefined)).toBeNull();
    });

    it('returns sdkSessionId when available', () => {
        expect(getSessionIdFromProcess({ sdkSessionId: 'sdk-123' })).toBe('sdk-123');
    });

    it('returns sessionId when sdkSessionId is absent', () => {
        expect(getSessionIdFromProcess({ sessionId: 'sess-456' })).toBe('sess-456');
    });

    it('parses sessionId from result JSON string', () => {
        const process = { result: JSON.stringify({ sessionId: 'from-result' }) };
        expect(getSessionIdFromProcess(process)).toBe('from-result');
    });

    it('prefers sdkSessionId over sessionId', () => {
        expect(getSessionIdFromProcess({ sdkSessionId: 'sdk', sessionId: 'sess' })).toBe('sdk');
    });

    it('returns null when no session ID found', () => {
        expect(getSessionIdFromProcess({ id: 'proc-1' })).toBeNull();
    });

    it('returns null for invalid result JSON', () => {
        expect(getSessionIdFromProcess({ result: 'not-json' })).toBeNull();
    });

    it('returns null for empty string values', () => {
        expect(getSessionIdFromProcess({ sdkSessionId: '', sessionId: '  ' })).toBeNull();
    });
});

describe('buildRows – Session ID link', () => {
    it('includes a link property for the Session ID row when session ID is present', () => {
        const rows = buildRows({ id: 'p-1', sdkSessionId: 'sess-abc' });
        const sessionRow = rows.find(r => r.label === 'Session ID');
        expect(sessionRow).toBeDefined();
        expect(sessionRow!.link).toBe('#logs?sessionId=sess-abc');
    });

    it('URL-encodes the session ID in the link', () => {
        const rows = buildRows({ id: 'p-1', sdkSessionId: 'sess/special chars&more' });
        const sessionRow = rows.find(r => r.label === 'Session ID');
        expect(sessionRow).toBeDefined();
        expect(sessionRow!.link).toBe('#logs?sessionId=' + encodeURIComponent('sess/special chars&more'));
    });

    it('does not include a link when no session ID exists', () => {
        const rows = buildRows({ id: 'p-1', status: 'running' });
        const sessionRow = rows.find(r => r.label === 'Session ID');
        expect(sessionRow).toBeUndefined();
    });

    it('sets breakAll and mono on the Session ID row', () => {
        const rows = buildRows({ id: 'p-1', sdkSessionId: 'sess-xyz' });
        const sessionRow = rows.find(r => r.label === 'Session ID');
        expect(sessionRow!.breakAll).toBe(true);
        expect(sessionRow!.mono).toBe(true);
    });
});

describe('ConversationMetadataPopover – log link rendering', () => {
    it('renders an <a> tag with correct href when session ID is present', async () => {
        renderPopover(BASE_PROCESS);
        const trigger = screen.getByRole('button', { name: /conversation metadata/i });

        await act(async () => {
            fireEvent.click(trigger);
        });

        const link = document.querySelector('a[title="View logs for this session"]') as HTMLAnchorElement;
        expect(link).not.toBeNull();
        expect(link.href).toContain('#logs?sessionId=sdk-sess-789');
        expect(link.textContent).toContain('logs');
    });

    it('does not render a log link when no session ID exists', async () => {
        renderPopover({ id: 'p-no-session', status: 'running' });
        const trigger = screen.getByRole('button', { name: /conversation metadata/i });

        await act(async () => {
            fireEvent.click(trigger);
        });

        const link = document.querySelector('a[title="View logs for this session"]');
        expect(link).toBeNull();
    });

    it('wraps value and link in a single grid cell (no overflow children)', async () => {
        renderPopover(BASE_PROCESS);
        const trigger = screen.getByRole('button', { name: /conversation metadata/i });

        await act(async () => {
            fireEvent.click(trigger);
        });

        // Each .contents div should have exactly 2 direct children (label + value/wrapper)
        const contentsDivs = document.querySelectorAll('.contents');
        for (const div of contentsDivs) {
            expect(div.children.length).toBe(2);
        }
    });
});

describe('buildRows – model default fallback', () => {
    it('shows "default" when no model is set', () => {
        const rows = buildRows({ id: 'p-1', status: 'running' });
        const modelRow = rows.find(r => r.label === 'Model');
        expect(modelRow).toBeDefined();
        expect(modelRow!.value).toBe('default');
    });

    it('shows explicit model when metadata.model is set', () => {
        const rows = buildRows({ id: 'p-2', metadata: { model: 'gpt-4o' } });
        const modelRow = rows.find(r => r.label === 'Model');
        expect(modelRow).toBeDefined();
        expect(modelRow!.value).toBe('gpt-4o');
    });

    it('shows config.model when metadata.model is absent', () => {
        const rows = buildRows({ id: 'p-3', config: { model: 'claude-sonnet' } });
        const modelRow = rows.find(r => r.label === 'Model');
        expect(modelRow).toBeDefined();
        expect(modelRow!.value).toBe('claude-sonnet');
    });
});

describe('buildRows – agent name', () => {
    it('shows provider attribution as Agent Provider when present in metadata', () => {
        const rows = buildRows({ id: 'p-agent-1', metadata: { provider: 'copilot' } });
        const agentRow = rows.find(r => r.label === 'Agent Provider');
        expect(agentRow).toBeDefined();
        expect(agentRow!.value).toBe('copilot');
    });

    it('prefers explicit agentName over provider', () => {
        const rows = buildRows({ id: 'p-agent-2', metadata: { agentName: 'codex', provider: 'copilot' } });
        const agentRow = rows.find(r => r.label === 'Agent Provider');
        expect(agentRow).toBeDefined();
        expect(agentRow!.value).toBe('codex');
    });

    it('falls back to top-level provider for projected task rows', () => {
        const rows = buildRows({ id: 'p-agent-3', provider: 'codex' });
        const agentRow = rows.find(r => r.label === 'Agent Provider');
        expect(agentRow).toBeDefined();
        expect(agentRow!.value).toBe('codex');
    });
});

describe('ConversationMetadataPopover – system prompt row', () => {
    it('shows System Prompt row with char count and view button when systemPrompt is set', async () => {
        const processWithPrompt = {
            ...BASE_PROCESS,
            metadata: { ...BASE_PROCESS.metadata, systemPrompt: 'You are a helpful assistant.' },
        };
        renderPopover(processWithPrompt);
        const trigger = screen.getByRole('button', { name: /conversation metadata/i });

        await act(async () => {
            fireEvent.click(trigger);
        });

        expect(screen.getByText('System')).toBeDefined();
        const charCount = (processWithPrompt.metadata.systemPrompt as string).length;
        expect(screen.getByText(`${charCount.toLocaleString()} chars`)).toBeDefined();
        expect(screen.getByTitle('View full system prompt')).toBeDefined();
    });

    it('does not show System Prompt row when systemPrompt is absent', async () => {
        renderPopover(BASE_PROCESS);
        const trigger = screen.getByRole('button', { name: /conversation metadata/i });

        await act(async () => {
            fireEvent.click(trigger);
        });

        expect(screen.queryByText('System')).toBeNull();
    });

    it('opens system prompt dialog on view button click', async () => {
        const systemPromptText = 'You are a helpful assistant with read-only access.';
        const processWithPrompt = {
            ...BASE_PROCESS,
            metadata: { ...BASE_PROCESS.metadata, systemPrompt: systemPromptText },
        };
        renderPopover(processWithPrompt);
        const trigger = screen.getByRole('button', { name: /conversation metadata/i });

        await act(async () => {
            fireEvent.click(trigger);
        });

        const viewBtn = screen.getByTitle('View full system prompt');
        await act(async () => {
            fireEvent.click(viewBtn);
        });

        // Dialog should show the actual system prompt content in a <pre> block
        expect(screen.getByText(systemPromptText)).toBeDefined();
    });

    it('closes metadata popover when view button is clicked (so dialog is not obscured)', async () => {
        const processWithPrompt = {
            ...BASE_PROCESS,
            metadata: { ...BASE_PROCESS.metadata, systemPrompt: 'Some system prompt.' },
        };
        renderPopover(processWithPrompt);
        const trigger = screen.getByRole('button', { name: /conversation metadata/i });

        await act(async () => {
            fireEvent.click(trigger);
        });

        expect(screen.getByText('Conversation metadata')).toBeDefined();

        const viewBtn = screen.getByTitle('View full system prompt');
        await act(async () => {
            fireEvent.click(viewBtn);
        });

        // Metadata popover should be closed
        expect(screen.queryByText('Conversation metadata')).toBeNull();
        // Dialog should be open
        expect(screen.getByText('Some system prompt.')).toBeDefined();
    });

    it('does not propagate mousedown from inside the popover to document (regression: overflow-menu close)', async () => {
        const processWithPrompt = {
            ...BASE_PROCESS,
            metadata: { ...BASE_PROCESS.metadata, systemPrompt: 'Hello.' },
        };
        renderPopover(processWithPrompt);
        const trigger = screen.getByRole('button', { name: /conversation metadata/i });

        await act(async () => {
            fireEvent.click(trigger);
        });

        // Simulate an outside-click handler like ChatHeaderOverflowMenu registers
        let documentMouseDownFired = false;
        const handler = () => { documentMouseDownFired = true; };
        document.addEventListener('mousedown', handler);

        try {
            // Fire mousedown inside the popover portal
            const viewBtn = screen.getByTitle('View full system prompt');
            await act(async () => {
                fireEvent.mouseDown(viewBtn);
            });

            // The event should NOT have reached the document-level listener
            expect(documentMouseDownFired).toBe(false);
        } finally {
            document.removeEventListener('mousedown', handler);
        }
    });

    it('closes system prompt dialog on Escape key', async () => {
        const processWithPrompt = {
            ...BASE_PROCESS,
            metadata: { ...BASE_PROCESS.metadata, systemPrompt: 'Some system prompt.' },
        };
        renderPopover(processWithPrompt);
        const trigger = screen.getByRole('button', { name: /conversation metadata/i });

        await act(async () => {
            fireEvent.click(trigger);
        });

        const viewBtn = screen.getByTitle('View full system prompt');
        await act(async () => {
            fireEvent.click(viewBtn);
        });

        expect(screen.getByText('Some system prompt.')).toBeDefined();

        await act(async () => {
            fireEvent.keyDown(document, { key: 'Escape' });
        });

        expect(screen.queryByText('Some system prompt.')).toBeNull();
    });
});

describe('buildRows – Ralph orchestration rows', () => {
    it('emits no Ralph rows when ralph context is absent', () => {
        const rows = buildRows({ id: 'p-1', metadata: {} });
        expect(rows.find(r => r.label.startsWith('Ralph'))).toBeUndefined();
    });

    it('emits Ralph · Phase / Session ID / Iteration / Goal when context is present (payload)', () => {
        const rows = buildRows({
            id: 'p-2',
            payload: { context: { ralph: {
                phase: 'executing',
                sessionId: 'ralph-sess-1',
                currentIteration: 3,
                originalGoal: 'Make the tests green',
            } } },
        });
        const get = (label: string) => rows.find(r => r.label === label);
        expect(get('Ralph · Phase')!.value).toBe('executing');
        const sessionRow = get('Ralph · Session ID')!;
        expect(sessionRow.value).toBe('ralph-sess-1');
        expect(sessionRow.breakAll).toBe(true);
        expect(sessionRow.mono).toBe(true);
        expect(get('Ralph · Iteration')!.value).toBe('3');
        expect(get('Ralph · Goal')!.value).toBe('Make the tests green');
    });

    it('reads Ralph context from metadata when payload is absent (history projection)', () => {
        const rows = buildRows({
            id: 'p-3',
            metadata: { ralph: { phase: 'complete', sessionId: 'sess-meta', originalGoal: 'g' } },
        });
        expect(rows.find(r => r.label === 'Ralph · Phase')!.value).toBe('complete');
        expect(rows.find(r => r.label === 'Ralph · Session ID')!.value).toBe('sess-meta');
    });

    it('omits Ralph · Iteration when currentIteration is undefined', () => {
        const rows = buildRows({
            id: 'p-4',
            payload: { context: { ralph: { phase: 'grilling', sessionId: 's', originalGoal: 'g' } } },
        });
        expect(rows.find(r => r.label === 'Ralph · Iteration')).toBeUndefined();
    });

    it('does not emit a Ralph · Progress row (progress lives in the file-backed journal)', () => {
        const rows = buildRows({
            id: 'p-5',
            payload: { context: { ralph: { phase: 'executing', sessionId: 's', originalGoal: 'g' } } },
        });
        expect(rows.find(r => r.label === 'Ralph · Progress')).toBeUndefined();
    });

    it('truncates long originalGoal to ~200 chars with an ellipsis', () => {
        const long = 'x'.repeat(500);
        const rows = buildRows({
            id: 'p-8',
            payload: { context: { ralph: { phase: 'executing', sessionId: 's', originalGoal: long } } },
        });
        const goal = rows.find(r => r.label === 'Ralph · Goal')!.value;
        expect(goal.length).toBe(200);
        expect(goal.endsWith('…')).toBe(true);
    });
});

describe('buildRows – reasoning effort', () => {
    it('shows Reasoning Effort row from config.reasoningEffort', () => {
        const rows = buildRows({ id: 'p-1', config: { reasoningEffort: 'high' } });
        const row = rows.find(r => r.label === 'Reasoning Effort');
        expect(row).toBeDefined();
        expect(row!.value).toBe('High');
    });

    it('shows Reasoning Effort row from metadata.reasoningEffort', () => {
        const rows = buildRows({ id: 'p-2', metadata: { reasoningEffort: 'low' } });
        const row = rows.find(r => r.label === 'Reasoning Effort');
        expect(row).toBeDefined();
        expect(row!.value).toBe('Low');
    });

    it('prefers config.reasoningEffort over metadata.reasoningEffort', () => {
        const rows = buildRows({ id: 'p-3', config: { reasoningEffort: 'medium' }, metadata: { reasoningEffort: 'high' } });
        const row = rows.find(r => r.label === 'Reasoning Effort');
        expect(row!.value).toBe('Medium');
    });

    it('falls back to Default when neither config nor metadata has it', () => {
        const rows = buildRows({ id: 'p-4', metadata: { model: 'gpt-4' } });
        const row = rows.find(r => r.label === 'Reasoning Effort');
        expect(row).toBeDefined();
        expect(row!.value).toBe('Default');
    });

    it('title-cases known effort values', () => {
        expect(buildRows({ id: 'e-low', config: { reasoningEffort: 'low' } }).find(r => r.label === 'Reasoning Effort')!.value).toBe('Low');
        expect(buildRows({ id: 'e-med', config: { reasoningEffort: 'medium' } }).find(r => r.label === 'Reasoning Effort')!.value).toBe('Medium');
        expect(buildRows({ id: 'e-high', config: { reasoningEffort: 'high' } }).find(r => r.label === 'Reasoning Effort')!.value).toBe('High');
        expect(buildRows({ id: 'e-xhigh', config: { reasoningEffort: 'xhigh' } }).find(r => r.label === 'Reasoning Effort')!.value).toBe('X High');
    });

    it('humanizes unknown non-empty effort values safely', () => {
        const rows = buildRows({ id: 'e-unknown', config: { reasoningEffort: 'super_extreme' } });
        expect(rows.find(r => r.label === 'Reasoning Effort')!.value).toBe('Super Extreme');
    });

    it('includes the effort pill as a summary chip with the Default fallback', () => {
        const rows = buildRows({ id: 'p-default' });
        expect(buildSummaryItems(rows)).toContain('effort Default');
    });

    it('appears in the popover summary when set', async () => {
        const proc = { ...BASE_PROCESS, config: { reasoningEffort: 'xhigh' } };
        render(<ConversationMetadataPopover process={proc} />);
        const trigger = screen.getByRole('button', { name: /conversation metadata/i });
        await act(async () => { fireEvent.click(trigger); });
        expect(screen.queryByText('Reasoning Effort')).toBeNull();
        expect(screen.getByText('effort X High')).toBeDefined();
    });

    it('shows the Default effort pill in the popover summary when unset', async () => {
        render(<ConversationMetadataPopover process={BASE_PROCESS} />);
        const trigger = screen.getByRole('button', { name: /conversation metadata/i });
        await act(async () => { fireEvent.click(trigger); });
        expect(screen.getByText('effort Default')).toBeDefined();
    });

    it('is positioned after Agent Provider row', () => {
        const rows = buildRows({ id: 'p-5', metadata: { provider: 'copilot' }, config: { reasoningEffort: 'medium' } });
        const agentIdx = rows.findIndex(r => r.label === 'Agent Provider');
        const effortIdx = rows.findIndex(r => r.label === 'Reasoning Effort');
        expect(effortIdx).toBe(agentIdx + 1);
    });
});
