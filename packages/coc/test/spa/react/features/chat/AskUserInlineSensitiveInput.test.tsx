// @vitest-environment jsdom
/**
 * AskUserInline `sensitive-input` questions: the pasted secret goes to the
 * desktop bridge only, and the ask-user response carries just the receipt.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { AskUserInline } from '../../../../../src/server/spa/client/react/features/chat/AskUserInline';
import type { AskUserBatch, AskUserQuestion } from '../../../../../src/server/spa/client/react/features/chat/hooks/useChatSSE';
import { resetCloneRegistryForTests } from '../../../../../src/server/spa/client/react/repos/cloneRegistry';
import { runSensitiveInputSink } from '../../../../../src/server/spa/client/react/features/chat/sensitiveInputSink';

const mocks = vi.hoisted(() => ({
    processes: {
        askUserResponse: vi.fn(),
    },
}));

vi.mock('../../../../../src/server/spa/client/react/api/cocClient', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../../../src/server/spa/client/react/api/cocClient')>();
    return {
        ...actual,
        getSpaCocClient: () => ({ processes: mocks.processes }),
    };
});

const SECRET = 'session=SENSITIVE_MARKER_42; other=SENSITIVE_MARKER_43';

let importCookies: ReturnType<typeof vi.fn>;

function installDesktopBridge(): void {
    (window as unknown as { cocDesktop?: unknown }).cocDesktop = { browser: { importCookies } };
}

beforeEach(() => {
    localStorage.clear();
    resetCloneRegistryForTests();
    mocks.processes.askUserResponse.mockReset().mockResolvedValue({ ok: true });
    importCookies = vi.fn().mockResolvedValue({ ok: true, count: 2 });
});

afterEach(() => {
    cleanup();
    delete (window as unknown as { cocDesktop?: unknown }).cocDesktop;
});

function sensitiveQuestion(overrides: Partial<AskUserQuestion> = {}): AskUserQuestion {
    return {
        batchId: 'batch-s',
        questionId: 'q-s',
        question: 'Paste your cookies for example.com',
        type: 'sensitive-input',
        sink: 'browser.cookies',
        sinkArgs: { domain: 'example.com' },
        turnIndex: 1,
        index: 0,
        batchSize: 1,
        ...overrides,
    };
}

function renderBatch(questions: AskUserQuestion[] = [sensitiveQuestion()]) {
    const batch: AskUserBatch = { batchId: questions[0].batchId, questions };
    const onAnswered = vi.fn();
    render(<AskUserInline batch={batch} processId="proc-s" onAnswered={onAnswered} />);
    return { onAnswered };
}

function sentBody(): string {
    return JSON.stringify(mocks.processes.askUserResponse.mock.calls);
}

describe('AskUserInline sensitive-input', () => {
    it('renders a masked paste box that requires a value before submit', () => {
        installDesktopBridge();
        renderBatch();
        const input = screen.getByTestId('ask-user-sensitive-input') as HTMLInputElement;
        expect(input.type).toBe('password');
        expect(input.autocomplete).toBe('off');
        expect(screen.getByTestId('ask-user-submit-all-btn')).toBeDisabled();
        fireEvent.change(input, { target: { value: SECRET } });
        expect(screen.getByTestId('ask-user-submit-all-btn')).not.toBeDisabled();
    });

    it('sends the value to the desktop bridge and posts only the receipt', async () => {
        installDesktopBridge();
        const { onAnswered } = renderBatch([sensitiveQuestion({ sinkArgs: { domain: 'example.com', viewId: 'view-7' } })]);
        fireEvent.change(screen.getByTestId('ask-user-sensitive-input'), { target: { value: SECRET } });
        fireEvent.click(screen.getByTestId('ask-user-submit-all-btn'));

        await waitFor(() => expect(onAnswered).toHaveBeenCalled());
        expect(importCookies).toHaveBeenCalledWith('view-7', 'example.com', SECRET);
        expect(mocks.processes.askUserResponse).toHaveBeenCalledWith('proc-s', {
            batchId: 'batch-s',
            answers: [{ questionId: 'q-s', receipt: { ok: true, count: 2 } }],
        });
        expect(sentBody()).not.toContain('SENSITIVE_MARKER');
    });

    it('never writes the pasted value to the ask-user draft store', () => {
        installDesktopBridge();
        renderBatch();
        fireEvent.change(screen.getByTestId('ask-user-sensitive-input'), { target: { value: SECRET } });
        expect(JSON.stringify({ ...localStorage })).not.toContain('SENSITIVE_MARKER');
    });

    it('clears the paste box after submit even when the post fails', async () => {
        installDesktopBridge();
        mocks.processes.askUserResponse.mockRejectedValue(new Error('offline'));
        renderBatch();
        const input = screen.getByTestId('ask-user-sensitive-input') as HTMLInputElement;
        fireEvent.change(input, { target: { value: SECRET } });
        fireEvent.click(screen.getByTestId('ask-user-submit-all-btn'));
        await waitFor(() => expect(mocks.processes.askUserResponse).toHaveBeenCalled());
        await waitFor(() => expect(input.value).toBe(''));
    });

    it('reports a bad paste as invalid-input without the desktop message', async () => {
        installDesktopBridge();
        importCookies.mockResolvedValue({ ok: false, reason: 'invalid', message: 'Cookie SENSITIVE_MARKER_42 is invalid' });
        const { onAnswered } = renderBatch();
        fireEvent.change(screen.getByTestId('ask-user-sensitive-input'), { target: { value: SECRET } });
        fireEvent.click(screen.getByTestId('ask-user-submit-all-btn'));
        await waitFor(() => expect(onAnswered).toHaveBeenCalled());
        expect(mocks.processes.askUserResponse.mock.calls[0][1].answers).toEqual([
            { questionId: 'q-s', receipt: { ok: false, reason: 'invalid-input' } },
        ]);
        expect(sentBody()).not.toContain('SENSITIVE_MARKER');
    });

    it('answers unavailable without a desktop bridge', async () => {
        const { onAnswered } = renderBatch();
        expect(screen.queryByTestId('ask-user-sensitive-input')).not.toBeInTheDocument();
        expect(screen.getByTestId('ask-user-sensitive-unavailable')).toHaveTextContent('Open CoC desktop');
        fireEvent.click(screen.getByTestId('ask-user-submit-all-btn'));
        await waitFor(() => expect(onAnswered).toHaveBeenCalled());
        expect(mocks.processes.askUserResponse.mock.calls[0][1].answers).toEqual([
            { questionId: 'q-s', skipped: true, reason: 'unavailable' },
        ]);
    });

    it('keeps skip as a plain skip that never calls the bridge', async () => {
        installDesktopBridge();
        const { onAnswered } = renderBatch();
        fireEvent.click(screen.getByTestId('ask-user-skip-all-btn'));
        await waitFor(() => expect(onAnswered).toHaveBeenCalled());
        expect(importCookies).not.toHaveBeenCalled();
        expect(mocks.processes.askUserResponse.mock.calls[0][1].answers).toEqual([{ questionId: 'q-s', skipped: true }]);
    });
});

describe('runSensitiveInputSink', () => {
    it('maps bridge failures and throws to import-failed', async () => {
        installDesktopBridge();
        importCookies.mockResolvedValueOnce({ ok: false, reason: 'busy' });
        expect(await runSensitiveInputSink(sensitiveQuestion(), 'a=1')).toEqual({ ok: false, reason: 'import-failed' });
        importCookies.mockRejectedValueOnce(new Error('SENSITIVE_MARKER_42'));
        expect(await runSensitiveInputSink(sensitiveQuestion(), 'a=1')).toEqual({ ok: false, reason: 'import-failed' });
        expect(importCookies).toHaveBeenLastCalledWith(null, 'example.com', 'a=1');
    });
});
