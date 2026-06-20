/* @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

import { ComposerMetaStrip } from '../../../../src/server/spa/client/react/features/chat/ComposerMetaStrip';

describe('ComposerMetaStrip', () => {
    it('renders nothing when both cwd and context window are absent', () => {
        const { container } = render(<ComposerMetaStrip />);
        expect(container.firstChild).toBeNull();
    });

    it('renders the cwd chip when working directory is provided', () => {
        render(<ComposerMetaStrip workingDirectory="/Users/yh/proj/shortcuts" />);
        const chip = screen.getByTestId('composer-cwd-chip');
        expect(chip).toBeTruthy();
        // Path shown in chip content (full path or shortened version)
        expect(chip.textContent).toContain('shortcuts');
        // Title carries the full working directory for hover detail
        expect(chip.getAttribute('title')).toBe('Working directory: /Users/yh/proj/shortcuts');
    });

    it('shortens long paths from the head', () => {
        const long = '/Users/yihengtao/Documents/Projects/shortcuts/a/very/deep/path/that/keeps/going/and/going';
        render(<ComposerMetaStrip workingDirectory={long} />);
        const chip = screen.getByTestId('composer-cwd-chip');
        // Full path stored in title for inspection
        expect(chip.getAttribute('title')).toContain(long);
        // Visual chip text has an ellipsis prefix indicating truncation
        const code = chip.querySelector('code');
        expect(code?.textContent?.startsWith('…')).toBe(true);
    });

    it('renders the ctx fuel gauge when token limit is provided', () => {
        render(<ComposerMetaStrip sessionTokenLimit={200_000} sessionCurrentTokens={84_300} />);
        expect(screen.getByTestId('composer-ctx-fuel')).toBeTruthy();
        const pct = screen.getByTestId('composer-ctx-pct');
        expect(pct.textContent).toBe('42%');
        const fill = screen.getByTestId('composer-ctx-fill');
        // 42% rounded fill width
        expect(fill.getAttribute('style')).toContain('width: 42');
    });

    it('uses green fill at low usage (<60%)', () => {
        render(<ComposerMetaStrip sessionTokenLimit={200_000} sessionCurrentTokens={50_000} />);
        const fill = screen.getByTestId('composer-ctx-fill');
        expect(fill.className).toContain('bg-[#16825d]');
    });

    it('uses amber fill in the warn range (60-80%)', () => {
        render(<ComposerMetaStrip sessionTokenLimit={200_000} sessionCurrentTokens={140_000} />);
        const fill = screen.getByTestId('composer-ctx-fill');
        expect(fill.className).toContain('bg-[#e8912d]');
    });

    it('uses red fill in the error range (>80%)', () => {
        render(<ComposerMetaStrip sessionTokenLimit={200_000} sessionCurrentTokens={180_000} />);
        const fill = screen.getByTestId('composer-ctx-fill');
        expect(fill.className).toContain('bg-[#f14c4c]');
    });

    it('clamps fill width to 100% when usage exceeds limit', () => {
        render(<ComposerMetaStrip sessionTokenLimit={100_000} sessionCurrentTokens={250_000} />);
        const fill = screen.getByTestId('composer-ctx-fill');
        const styleAttr = fill.getAttribute('style') ?? '';
        const match = styleAttr.match(/width:\s*(\d+)/);
        const width = match ? parseInt(match[1], 10) : NaN;
        expect(width).toBeLessThanOrEqual(100);
    });

    it('renders a non-zero fill width even when usage is 0', () => {
        render(<ComposerMetaStrip sessionTokenLimit={200_000} sessionCurrentTokens={0} />);
        const fill = screen.getByTestId('composer-ctx-fill');
        const styleAttr = fill.getAttribute('style') ?? '';
        const match = styleAttr.match(/width:\s*(\d+)/);
        const width = match ? parseInt(match[1], 10) : 0;
        // Floor of 2% so the bar is visible at 0% usage
        expect(width).toBeGreaterThanOrEqual(2);
    });

    it('hides the ctx fuel gauge when token limit is missing', () => {
        render(<ComposerMetaStrip workingDirectory="/x" sessionCurrentTokens={50_000} />);
        expect(screen.queryByTestId('composer-ctx-fuel')).toBeNull();
        expect(screen.getByTestId('composer-cwd-chip')).toBeTruthy();
    });

    it('renders both chips with a divider when both are present', () => {
        render(<ComposerMetaStrip workingDirectory="/x" sessionTokenLimit={100_000} sessionCurrentTokens={10_000} />);
        const root = screen.getByTestId('composer-meta-strip');
        // The divider is the only span with a fixed-width separator
        const divider = root.querySelector('span[aria-hidden="true"][class*="bg-[#e0e0e0]"]');
        expect(divider).toBeTruthy();
    });

    it('omits the divider when only one chip renders', () => {
        render(<ComposerMetaStrip sessionTokenLimit={100_000} sessionCurrentTokens={10_000} />);
        const root = screen.getByTestId('composer-meta-strip');
        const divider = root.querySelector('span[aria-hidden="true"][class*="bg-[#e0e0e0]"]');
        expect(divider).toBeNull();
    });

    it('includes the model name in the ctx aria-label when provided', () => {
        render(<ComposerMetaStrip sessionTokenLimit={200_000} sessionCurrentTokens={100_000} sessionModel="sonnet-4.5" />);
        const fuel = screen.getByTestId('composer-ctx-fuel');
        const label = fuel.getAttribute('aria-label') ?? '';
        expect(label).toContain('sonnet-4.5');
        expect(label).toContain('200');
        expect(label).toContain('100');
    });

    it('renders Codex provider badge when activeProvider is "codex"', () => {
        render(<ComposerMetaStrip workingDirectory="/x" activeProvider="codex" />);
        const badge = screen.getByTestId('composer-provider-badge');
        expect(badge).toBeTruthy();
        expect(badge.textContent).toContain('Codex');
        expect(badge.getAttribute('title')).toContain('Codex');
    });

    it('renders Claude provider badge when activeProvider is "claude"', () => {
        render(<ComposerMetaStrip workingDirectory="/x" activeProvider="claude" />);
        const badge = screen.getByTestId('composer-provider-badge');
        expect(badge).toBeTruthy();
        expect(badge.textContent).toContain('Claude');
        expect(badge.getAttribute('title')).toContain('Claude');
    });

    it('does not render provider badge when activeProvider is "copilot"', () => {
        render(<ComposerMetaStrip workingDirectory="/x" activeProvider="copilot" />);
        expect(screen.queryByTestId('composer-provider-badge')).toBeNull();
    });

    it('treats an all-whitespace working directory as empty', () => {
        const { container } = render(<ComposerMetaStrip workingDirectory="   " />);
        // Strip should render nothing (no cwd, no ctx)
        expect(container.firstChild).toBeNull();
    });

    // — Segmented bar (breakdown props) —————————————————————————————————

    it('renders coloured segments when breakdown props are provided', () => {
        render(
            <ComposerMetaStrip
                sessionTokenLimit={200000}
                sessionCurrentTokens={70000}
                sessionSystemTokens={12000}
                sessionToolTokens={8000}
                sessionConversationTokens={47000}
            />,
        );
        expect(screen.getByTestId('composer-ctx-segment-system')).toBeTruthy();
        expect(screen.getByTestId('composer-ctx-segment-tools')).toBeTruthy();
        expect(screen.getByTestId('composer-ctx-segment-conversation')).toBeTruthy();
        // Single fill should not be present when breakdown is shown
        expect(screen.queryByTestId('composer-ctx-fill')).toBeNull();
    });

    it('system segment uses purple colour', () => {
        render(
            <ComposerMetaStrip
                sessionTokenLimit={200000}
                sessionCurrentTokens={30000}
                sessionSystemTokens={10000}
                sessionToolTokens={10000}
                sessionConversationTokens={10000}
            />,
        );
        const seg = screen.getByTestId('composer-ctx-segment-system');
        expect(seg.className).toContain('bg-purple-500');
    });

    it('renders other segment when currentTokens exceeds sum of breakdown tokens', () => {
        render(
            <ComposerMetaStrip
                sessionTokenLimit={200000}
                sessionCurrentTokens={75000}
                sessionSystemTokens={10000}
                sessionToolTokens={10000}
                sessionConversationTokens={50000}
            />,
        );
        expect(screen.getByTestId('composer-ctx-segment-other')).toBeTruthy();
        const seg = screen.getByTestId('composer-ctx-segment-other');
        expect(seg.className).toContain('bg-gray-400');
    });

    it('falls back to single-fill bar when breakdown props are absent', () => {
        render(<ComposerMetaStrip sessionTokenLimit={200000} sessionCurrentTokens={50000} />);
        expect(screen.getByTestId('composer-ctx-fill')).toBeTruthy();
        expect(screen.queryByTestId('composer-ctx-segment-system')).toBeNull();
    });

    // — Breakdown popover ——————————————————————————————————————————————

    it('shows breakdown popover on hover when breakdown is available', () => {
        render(
            <ComposerMetaStrip
                sessionTokenLimit={200000}
                sessionCurrentTokens={70000}
                sessionSystemTokens={12000}
                sessionToolTokens={8000}
                sessionConversationTokens={47000}
            />,
        );
        expect(screen.queryByTestId('composer-ctx-breakdown-popover')).toBeNull();
        fireEvent.mouseEnter(screen.getByTestId('composer-ctx-fuel'));
        expect(screen.getByTestId('composer-ctx-breakdown-popover')).toBeTruthy();
    });

    it('hides breakdown popover on mouse leave', () => {
        render(
            <ComposerMetaStrip
                sessionTokenLimit={200000}
                sessionCurrentTokens={70000}
                sessionSystemTokens={12000}
                sessionToolTokens={8000}
                sessionConversationTokens={47000}
            />,
        );
        const fuel = screen.getByTestId('composer-ctx-fuel');
        fireEvent.mouseEnter(fuel);
        fireEvent.mouseLeave(fuel);
        expect(screen.queryByTestId('composer-ctx-breakdown-popover')).toBeNull();
    });

    it('shows simple popover with total when breakdown props are absent', () => {
        render(<ComposerMetaStrip sessionTokenLimit={200000} sessionCurrentTokens={70000} />);
        fireEvent.mouseEnter(screen.getByTestId('composer-ctx-fuel'));
        const popover = screen.getByTestId('composer-ctx-breakdown-popover');
        expect(popover).toBeTruthy();
        expect(popover.textContent).toContain('Total');
        expect(popover.textContent).not.toContain('System prompt');
    });

    it('shows model name in popover when sessionModel is provided', () => {
        render(<ComposerMetaStrip sessionTokenLimit={200000} sessionCurrentTokens={70000} sessionModel="claude-opus-4.8" />);
        fireEvent.mouseEnter(screen.getByTestId('composer-ctx-fuel'));
        const popover = screen.getByTestId('composer-ctx-breakdown-popover');
        expect(popover.textContent).toContain('claude-opus-4.8');
    });

    it('does not show model name in popover when sessionModel is absent', () => {
        render(<ComposerMetaStrip sessionTokenLimit={200000} sessionCurrentTokens={70000} />);
        fireEvent.mouseEnter(screen.getByTestId('composer-ctx-fuel'));
        expect(screen.queryByTestId('composer-ctx-model-name')).toBeNull();
    });

    it('popover lists all four categories', () => {
        render(
            <ComposerMetaStrip
                sessionTokenLimit={200000}
                sessionCurrentTokens={72300}
                sessionSystemTokens={12000}
                sessionToolTokens={8000}
                sessionConversationTokens={47000}
            />,
        );
        fireEvent.mouseEnter(screen.getByTestId('composer-ctx-fuel'));
        const popover = screen.getByTestId('composer-ctx-breakdown-popover');
        expect(popover.textContent).toContain('System prompt');
        expect(popover.textContent).toContain('Tool definitions');
        expect(popover.textContent).toContain('Conversation');
        expect(popover.textContent).toContain('Other');
        expect(popover.textContent).toContain('Total');
    });

    it('right-anchors the breakdown popover so it is not clipped on the right edge', () => {
        // The ctx fuel gauge sits on the right side of the composer toolbar, so
        // the popover must open leftward (right-0) rather than overflow past the
        // panel boundary (which clipped the "% of limit" column). Regression test.
        render(<ComposerMetaStrip sessionTokenLimit={200000} sessionCurrentTokens={70000} />);
        fireEvent.mouseEnter(screen.getByTestId('composer-ctx-fuel'));
        const popover = screen.getByTestId('composer-ctx-breakdown-popover');
        expect(popover.className).toContain('right-0');
        expect(popover.className).not.toContain('left-0');
    });
});
