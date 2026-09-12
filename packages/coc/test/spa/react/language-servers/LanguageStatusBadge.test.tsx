// @vitest-environment jsdom
/**
 * The editor's language badge. Rendering only — the wording it shows is pinned
 * in `languageStatus.test.ts`. What matters here is that the retry reaches the
 * host, and that it is not offered while a start is already under way.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LanguageStatusBadge } from '../../../../src/server/spa/client/react/features/language-servers/LanguageStatusBadge';
import type { LanguageDocumentSnapshot } from '../../../../src/server/spa/client/react/features/language-servers/documentStore';
import {
    CONTAINER_UNSUPPORTED_REASON,
    type LanguageServerSessionStateView,
} from '../../../../src/server/spa/client/react/features/language-servers/languageServerClient';

function snapshot(
    status: LanguageDocumentSnapshot['status'],
    state: Partial<LanguageServerSessionStateView> | null,
    unavailable?: LanguageDocumentSnapshot['unavailable'],
): LanguageDocumentSnapshot {
    return {
        uri: 'coc-file://ws-1/src/a.ts',
        path: 'src/a.ts',
        version: 1,
        text: '',
        dirty: false,
        status,
        languageId: 'typescript',
        displayName: 'TypeScript',
        unavailable: unavailable
            ?? (status === 'unavailable' ? { reason: 'disabled', detail: 'Language support is off.' } : null),
        state: state ? { status: 'ready', definitionId: 'typescript', displayName: 'TypeScript', ...state } : null,
    };
}

describe('LanguageStatusBadge', () => {
    it('shows the running server and its tooltip', () => {
        render(
            <LanguageStatusBadge
                snapshot={snapshot('ready', { serverVersion: '4.3.3', runtime: 'Workspace TypeScript 5.6.2' })}
                onRestart={() => {}}
            />,
        );

        expect(screen.getByTestId('language-status-label').textContent).toBe('TypeScript');
        expect(screen.getByTestId('language-status').getAttribute('data-tone')).toBe('ready');
        expect(screen.getByTestId('language-status').getAttribute('title'))
            .toContain('Workspace TypeScript 5.6.2');
    });

    it('restarts the server when the user asks', () => {
        const onRestart = vi.fn();
        render(<LanguageStatusBadge snapshot={snapshot('detached', { status: 'failed' })} onRestart={onRestart} />);

        fireEvent.click(screen.getByTestId('language-restart-btn'));

        expect(onRestart).toHaveBeenCalledTimes(1);
    });

    it('opens actionable failure details and copies the recovery command', () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
        render(
            <LanguageStatusBadge
                snapshot={snapshot('detached', {
                    status: 'unavailable',
                    displayName: 'Rust',
                    runtime: 'Server: rustup (stable)',
                    detail: 'rust-analyzer is not installed for the active toolchain',
                    recoveryCommand: 'rustup component add rust-analyzer',
                })}
                onRestart={() => {}}
            />,
        );

        fireEvent.click(screen.getByTestId('language-status-summary'));
        expect(screen.getByTestId('language-status-details').textContent).toContain('active toolchain');
        fireEvent.click(screen.getByTestId('language-copy-recovery'));
        expect(writeText).toHaveBeenCalledWith('rustup component add rust-analyzer');
        expect(screen.getByTestId('language-restart-btn').textContent).toBe('Retry');
    });

    it('offers no retry when the container proxy puts the host out of reach', () => {
        render(
            <LanguageStatusBadge
                snapshot={snapshot('unavailable', null, {
                    reason: CONTAINER_UNSUPPORTED_REASON,
                    detail: 'Language support is not available while this workspace is open through the container agent.',
                })}
                onRestart={() => {}}
            />,
        );

        expect(screen.getByTestId('language-status-label').textContent).toBe('Unavailable in container');
        expect(screen.queryByTestId('language-restart-btn')).toBeNull();
        expect(screen.getByTestId('language-status').getAttribute('data-tone')).toBe('warning');
    });

    it('offers no retry while the server is already starting', () => {
        render(<LanguageStatusBadge snapshot={snapshot('detached', { status: 'starting' })} onRestart={() => {}} />);

        expect(screen.queryByTestId('language-restart-btn')).toBeNull();
        expect(screen.getByTestId('language-status').getAttribute('data-tone')).toBe('pending');
    });

    it('still offers the retry when the host refused the document', () => {
        const onRestart = vi.fn();
        render(<LanguageStatusBadge snapshot={snapshot('unavailable', null)} onRestart={onRestart} />);

        expect(screen.getByTestId('language-status-label').textContent).toBe('Language support off');
        fireEvent.click(screen.getByTestId('language-restart-btn'));
        expect(onRestart).toHaveBeenCalledTimes(1);
    });

    it.each([
        ['ready', snapshot('ready', { status: 'ready' }), 'opacity-[0.55]', true],
        ['pending', snapshot('detached', { status: 'starting' }), 'opacity-100', false],
        ['warning', snapshot('unavailable', null), 'opacity-100', false],
        ['error', snapshot('detached', { status: 'failed' }), 'opacity-100', false],
    ] as const)('uses the expected corner opacity for the %s tone', (_tone, value, opacity, fades) => {
        render(<LanguageStatusBadge snapshot={value} onRestart={() => {}} variant="corner" />);

        const badge = screen.getByTestId('language-status');
        expect(badge.classList.contains(opacity)).toBe(true);
        expect(badge.classList.contains('hover:opacity-100')).toBe(fades);
        expect(badge.classList.contains('focus-within:opacity-100')).toBe(fades);
    });
});
