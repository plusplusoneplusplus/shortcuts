/**
 * @vitest-environment jsdom
 *
 * Verifies the flat work-item section's right-click menu has a "Copy" entry whose
 * submenu copies the right text to the clipboard, reports via a toast, and closes.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
    grouped: vi.fn(),
}));

vi.mock('../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({
        workItems: {
            groupedForOrigin: mocks.grouped,
            listForOrigin: vi.fn(),
            pinForOrigin: vi.fn(),
            archiveForOrigin: vi.fn(),
            deleteForOrigin: vi.fn(),
        },
    }),
    getSpaCocClientErrorMessage: (error: unknown, fallback: string) =>
        error instanceof Error ? error.message : fallback,
}));

vi.mock('../../../../src/server/spa/client/react/utils/config', () => ({
    isSessionContextAttachmentsEnabled: () => false,
}));

import { WorkItemProvider, type WorkItemSummary } from '../../../../src/server/spa/client/react/contexts/WorkItemContext';
import { ToastContext } from '../../../../src/server/spa/client/react/contexts/ToastContext';
import { WorkItemSection } from '../../../../src/server/spa/client/react/features/work-items/WorkItemSection';

const ITEM_ID = 'uuid-wi-7';

function makeItem(): WorkItemSummary {
    return {
        id: ITEM_ID,
        workItemNumber: 7,
        title: 'Flat copy me',
        status: 'created',
        type: 'work-item',
        createdAt: '2026-06-12T00:00:00.000Z',
        updatedAt: '2026-06-12T00:00:00.000Z',
    };
}

const addToast = vi.fn();
const writeText = vi.fn().mockResolvedValue(undefined);

function renderSection() {
    return render(
        <ToastContext.Provider value={{ addToast, removeToast: vi.fn(), toasts: [] }}>
            <WorkItemProvider>
                <WorkItemSection workspaceId="ws-1" onSelectWorkItem={vi.fn()} />
            </WorkItemProvider>
        </ToastContext.Provider>,
    );
}

function openCopySubmenu() {
    const haspopup = document.querySelector('[aria-haspopup="true"]') as HTMLElement | null;
    expect(haspopup).toBeTruthy();
    const wrapper = haspopup!.closest('[data-testid^="context-menu-item-"]') as HTMLElement;
    fireEvent.mouseEnter(wrapper);
}

describe('WorkItemSection Copy context menu', () => {
    beforeEach(() => {
        addToast.mockReset();
        writeText.mockReset().mockResolvedValue(undefined);
        mocks.grouped.mockReset();
        mocks.grouped.mockResolvedValue({
            groups: { created: { items: [makeItem()], total: 1, hasMore: false } },
        });
        Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    });

    afterEach(() => {
        cleanup();
        vi.clearAllMocks();
    });

    it('copies the identifier from the Copy submenu and closes the menu', async () => {
        renderSection();
        await screen.findByText('Flat copy me');

        fireEvent.contextMenu(screen.getByTestId(`work-item-card-${ITEM_ID}`));
        expect(screen.getByTestId('context-menu')).toBeInTheDocument();
        expect(screen.getByText('Copy')).toBeInTheDocument();

        openCopySubmenu();
        fireEvent.click(screen.getByText('Copy ID'));
        expect(writeText).toHaveBeenCalledWith('WI-7');
        await waitFor(() => expect(addToast).toHaveBeenCalledWith('Copied ID', 'success'));
        await waitFor(() => expect(screen.queryByTestId('context-menu')).toBeNull());
    });

    it('copies the info block including identifier, title, and mapped status', async () => {
        renderSection();
        await screen.findByText('Flat copy me');

        fireEvent.contextMenu(screen.getByTestId(`work-item-card-${ITEM_ID}`));
        openCopySubmenu();
        fireEvent.click(screen.getByText('Copy info'));

        const infoText = writeText.mock.calls.at(-1)![0] as string;
        expect(infoText).toContain('WI-7');
        expect(infoText).toContain('Flat copy me');
        expect(infoText).toContain('Type: Work Item · Status: Created');
        expect(infoText).toContain(`ID: ${ITEM_ID}`);
        await waitFor(() => expect(addToast).toHaveBeenCalledWith('Copied info', 'success'));
    });
});
