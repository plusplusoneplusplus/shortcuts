/**
 * @vitest-environment jsdom
 *
 * Tests for SyncStatusIndicator — compact TopBar pill showing sync state.
 *
 * Covers:
 *   - Hidden when sync is disabled or status is null
 *   - Displays correct label/dot for syncing, error, synced, and never-synced states
 *   - Click triggers onTriggerSync callback
 *   - Button disabled while sync is in progress
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SyncStatusIndicator } from '../../../../../src/server/spa/client/react/layout/SyncStatusIndicator';

vi.mock('@plusplusoneplusplus/forge', () => ({}));

describe('SyncStatusIndicator', () => {
    it('renders nothing when status is null', () => {
        const { container } = render(
            <SyncStatusIndicator status={null} />
        );
        expect(container.innerHTML).toBe('');
    });

    it('renders nothing when sync is disabled', () => {
        const { container } = render(
            <SyncStatusIndicator status={{
                enabled: false, inProgress: false, lastSyncTime: null, lastError: null,
            }} />
        );
        expect(container.innerHTML).toBe('');
    });

    it('shows "Syncing…" with pulse when in progress', () => {
        render(
            <SyncStatusIndicator status={{
                enabled: true, inProgress: true, lastSyncTime: null, lastError: null,
            }} />
        );
        const pill = screen.getByTestId('sync-status-topbar');
        expect(screen.getByTestId('sync-status-topbar-label').textContent).toBe('Syncing…');
        expect(pill).toBeDisabled();
    });

    it('shows "Sync error" when lastError is set', () => {
        const onTrigger = vi.fn();
        render(
            <SyncStatusIndicator status={{
                enabled: true, inProgress: false, lastSyncTime: null, lastError: 'network timeout',
            }} onTriggerSync={onTrigger} />
        );
        expect(screen.getByTestId('sync-status-topbar-label').textContent).toBe('Sync error');
        const pill = screen.getByTestId('sync-status-topbar');
        expect(pill.title).toContain('network timeout');
        expect(pill).not.toBeDisabled();
    });

    it('shows "Synced" when lastSyncTime is set and no error', () => {
        render(
            <SyncStatusIndicator status={{
                enabled: true, inProgress: false,
                lastSyncTime: '2026-01-15T10:30:00Z', lastError: null,
            }} />
        );
        expect(screen.getByTestId('sync-status-topbar-label').textContent).toBe('Synced');
        const pill = screen.getByTestId('sync-status-topbar');
        expect(pill.title).toContain('Last synced');
    });

    it('shows "Sync" when enabled but never synced', () => {
        render(
            <SyncStatusIndicator status={{
                enabled: true, inProgress: false, lastSyncTime: null, lastError: null,
            }} />
        );
        expect(screen.getByTestId('sync-status-topbar-label').textContent).toBe('Sync');
        expect(screen.getByTestId('sync-status-topbar').title).toBe('Sync enabled, never synced');
    });

    it('calls onTriggerSync when clicked', () => {
        const onTrigger = vi.fn();
        render(
            <SyncStatusIndicator status={{
                enabled: true, inProgress: false, lastSyncTime: '2026-01-15T10:30:00Z', lastError: null,
            }} onTriggerSync={onTrigger} />
        );
        fireEvent.click(screen.getByTestId('sync-status-topbar'));
        expect(onTrigger).toHaveBeenCalledTimes(1);
    });

    it('does not call onTriggerSync when disabled (in progress)', () => {
        const onTrigger = vi.fn();
        render(
            <SyncStatusIndicator status={{
                enabled: true, inProgress: true, lastSyncTime: null, lastError: null,
            }} onTriggerSync={onTrigger} />
        );
        fireEvent.click(screen.getByTestId('sync-status-topbar'));
        expect(onTrigger).not.toHaveBeenCalled();
    });

    it('renders mobile dot button', () => {
        render(
            <SyncStatusIndicator status={{
                enabled: true, inProgress: false, lastSyncTime: '2026-01-15T10:30:00Z', lastError: null,
            }} />
        );
        expect(screen.getByTestId('sync-status-topbar-mobile')).toBeTruthy();
    });
});
