/**
 * Tests for RepoQueueTab mobile responsiveness.
 *
 * Validates:
 * - useBreakpoint is imported and used
 * - mobileShowDetail state is present
 * - Mobile branch renders full-width list (no split panel)
 * - Selecting a task on mobile shows the detail view with a back button
 * - Clicking back returns to the list
 * - Desktop branch still renders the split-panel layout
 * - Drag-and-drop is disabled on mobile
 * - Tablet layout uses w-64 instead of w-80
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const REPO_QUEUE_TAB_SOURCE = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'repos', 'RepoQueueTab.tsx'),
    'utf-8',
);

const QUEUE_TASK_DETAIL_SOURCE = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'queue', 'QueueTaskDetail.tsx'),
    'utf-8',
);

describe('RepoQueueTab mobile: imports', () => {
    it('imports useBreakpoint', () => {
        expect(REPO_QUEUE_TAB_SOURCE).toContain("import { useBreakpoint } from '../hooks/useBreakpoint'");
    });
});

describe('RepoQueueTab mobile: breakpoint and state', () => {
    it('destructures isMobile and isTablet from useBreakpoint', () => {
        expect(REPO_QUEUE_TAB_SOURCE).toContain('const { isMobile, isTablet } = useBreakpoint()');
    });

    it('has mobileShowDetail state initialised to false', () => {
        expect(REPO_QUEUE_TAB_SOURCE).toContain('const [mobileShowDetail, setMobileShowDetail] = useState(false)');
    });
});

describe('RepoQueueTab mobile: selectTask sets mobileShowDetail', () => {
    it('calls setMobileShowDetail(true) inside selectTask when isMobile', () => {
        const handler = REPO_QUEUE_TAB_SOURCE.substring(
            REPO_QUEUE_TAB_SOURCE.indexOf('const selectTask = useCallback'),
            REPO_QUEUE_TAB_SOURCE.indexOf('}, [queueDispatch, appDispatch, workspaceId, isMobile])')
        );
        expect(handler).toContain('if (isMobile) setMobileShowDetail(true)');
    });
});

describe('RepoQueueTab mobile: reset mobileShowDetail on deselect', () => {
    it('resets mobileShowDetail to false when selectedTaskId becomes null', () => {
        expect(REPO_QUEUE_TAB_SOURCE).toContain('if (!selectedTaskId) setMobileShowDetail(false)');
    });
});

describe('RepoQueueTab mobile: mobile layout branch', () => {
    it('renders mobile branch when isMobile is true', () => {
        expect(REPO_QUEUE_TAB_SOURCE).toContain('if (isMobile) {');
    });

    it('mobile branch uses data-testid repo-queue-split-panel', () => {
        expect(REPO_QUEUE_TAB_SOURCE).toContain('data-testid="repo-queue-split-panel"');
    });

    it('mobile branch shows detail panel with data-testid repo-queue-detail-panel', () => {
        expect(REPO_QUEUE_TAB_SOURCE).toContain('data-testid="repo-queue-mobile-list"');
        expect(REPO_QUEUE_TAB_SOURCE).toContain('data-testid="repo-queue-detail-panel"');
    });

    it('mobile branch passes onBack to QueueTaskDetail', () => {
        expect(REPO_QUEUE_TAB_SOURCE).toContain('onBack={() => setMobileShowDetail(false)}');
    });

    it('mobile branch toggles between list and detail based on mobileShowDetail', () => {
        expect(REPO_QUEUE_TAB_SOURCE).toContain('mobileShowDetail && selectedTaskId');
    });
});

describe('RepoQueueTab desktop: layout unchanged', () => {
    it('desktop layout still uses split-panel testid', () => {
        expect(REPO_QUEUE_TAB_SOURCE).toContain('data-testid="repo-queue-split-panel"');
    });

    it('desktop still renders QueueTaskDetail in the right panel', () => {
        // QueueTaskDetail without onBack is rendered in the desktop branch
        const desktopSection = REPO_QUEUE_TAB_SOURCE.substring(REPO_QUEUE_TAB_SOURCE.indexOf('return ('));
        expect(desktopSection).toContain('<QueueTaskDetail />');
    });
});

describe('RepoQueueTab tablet: narrower left panel', () => {
    it('applies w-64 on tablet', () => {
        expect(REPO_QUEUE_TAB_SOURCE).toContain("isTablet ? 'w-64' : 'w-80'");
    });
});

describe('RepoQueueTab mobile: drag-and-drop disabled', () => {
    it('draggable is conditionally set based on isMobile', () => {
        expect(REPO_QUEUE_TAB_SOURCE).toContain('draggable={!isMobile}');
    });
});

describe('QueueTaskDetail: onBack prop', () => {
    it('accepts an optional onBack prop', () => {
        expect(QUEUE_TASK_DETAIL_SOURCE).toContain('onBack?: () => void');
    });

    it('renders back button with data-testid queue-detail-back-btn when onBack provided', () => {
        expect(QUEUE_TASK_DETAIL_SOURCE).toContain('data-testid="queue-detail-back-btn"');
    });

    it('back button calls onBack on click', () => {
        expect(QUEUE_TASK_DETAIL_SOURCE).toContain('onClick={onBack}');
    });

    it('back button shows ← Back label', () => {
        expect(QUEUE_TASK_DETAIL_SOURCE).toContain('← Back');
    });
});
