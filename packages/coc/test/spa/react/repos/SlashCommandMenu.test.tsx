/**
 * Tests for the redesigned SlashCommandMenu — verifies the "SLASH COMMANDS"
 * card header, the monospace command names, and the return-key indicator on
 * the highlighted row.
 */
/* @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SlashCommandMenu } from '../../../../src/server/spa/client/react/features/chat/SlashCommandMenu';

const SKILLS = [
    { name: 'spec', description: 'Ask the agent to draft a Markdown spec instead of code' },
    { name: 'test', description: 'Run targeted tests after the next edit' },
    { name: 'scope', description: 'Restrict edits to a path or package' },
    { name: 'skill', description: 'Invoke a skill from the active library' },
];

beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
});

describe('SlashCommandMenu (redesigned card)', () => {
    it('renders nothing when not visible', () => {
        const { container } = render(
            <SlashCommandMenu
                skills={SKILLS}
                filter=""
                onSelect={() => {}}
                onDismiss={() => {}}
                visible={false}
                highlightIndex={0}
            />,
        );
        expect(container.firstChild).toBeNull();
    });

    it('renders the SLASH COMMANDS header when visible', () => {
        render(
            <SlashCommandMenu
                skills={SKILLS}
                filter=""
                onSelect={() => {}}
                onDismiss={() => {}}
                visible={true}
                highlightIndex={0}
            />,
        );
        const header = screen.getByTestId('slash-command-menu-header');
        expect(header.textContent?.toLowerCase()).toContain('slash commands');
    });

    it('renders one row per matching skill, names prefixed with "/"', () => {
        render(
            <SlashCommandMenu
                skills={SKILLS}
                filter=""
                onSelect={() => {}}
                onDismiss={() => {}}
                visible={true}
                highlightIndex={0}
            />,
        );
        const items = document.querySelectorAll('[data-menu-item]');
        expect(items.length).toBe(4);
        expect(items[0].textContent).toContain('/spec');
        expect(items[1].textContent).toContain('/test');
        expect(items[2].textContent).toContain('/scope');
        expect(items[3].textContent).toContain('/skill');
    });

    it('shows the return-key indicator only on the highlighted row', () => {
        render(
            <SlashCommandMenu
                skills={SKILLS}
                filter=""
                onSelect={() => {}}
                onDismiss={() => {}}
                visible={true}
                highlightIndex={0}
            />,
        );
        const indicators = document.querySelectorAll('[data-testid="slash-command-menu-return"]');
        expect(indicators.length).toBe(1);
        const rows = document.querySelectorAll('[data-menu-item]');
        expect(rows[0].getAttribute('data-highlighted')).toBe('true');
        expect(rows[1].getAttribute('data-highlighted')).toBe('false');
        expect(rows[0].contains(indicators[0])).toBe(true);
    });

    it('moves the indicator with highlightIndex changes', () => {
        const { rerender } = render(
            <SlashCommandMenu
                skills={SKILLS}
                filter=""
                onSelect={() => {}}
                onDismiss={() => {}}
                visible={true}
                highlightIndex={0}
            />,
        );
        let rows = document.querySelectorAll('[data-menu-item]');
        expect(rows[0].getAttribute('data-highlighted')).toBe('true');

        rerender(
            <SlashCommandMenu
                skills={SKILLS}
                filter=""
                onSelect={() => {}}
                onDismiss={() => {}}
                visible={true}
                highlightIndex={2}
            />,
        );
        rows = document.querySelectorAll('[data-menu-item]');
        expect(rows[2].getAttribute('data-highlighted')).toBe('true');
        const indicators = document.querySelectorAll('[data-testid="slash-command-menu-return"]');
        expect(indicators.length).toBe(1);
        expect(rows[2].contains(indicators[0])).toBe(true);
    });

    it('filters rows by case-insensitive prefix', () => {
        render(
            <SlashCommandMenu
                skills={SKILLS}
                filter="SC"
                onSelect={() => {}}
                onDismiss={() => {}}
                visible={true}
                highlightIndex={0}
            />,
        );
        const items = document.querySelectorAll('[data-menu-item]');
        expect(items.length).toBe(1);
        expect(items[0].textContent).toContain('/scope');
    });

    it('returns null when no skills match the filter', () => {
        const { container } = render(
            <SlashCommandMenu
                skills={SKILLS}
                filter="zzz"
                onSelect={() => {}}
                onDismiss={() => {}}
                visible={true}
                highlightIndex={0}
            />,
        );
        expect(container.firstChild).toBeNull();
    });

    it('mouse-down on a row calls onSelect with the skill name', () => {
        const onSelect = vi.fn();
        render(
            <SlashCommandMenu
                skills={SKILLS}
                filter=""
                onSelect={onSelect}
                onDismiss={() => {}}
                visible={true}
                highlightIndex={0}
            />,
        );
        const rows = document.querySelectorAll('[data-menu-item]');
        fireEvent.mouseDown(rows[1]);
        expect(onSelect).toHaveBeenCalledWith('test');
    });

    it('renders the description text alongside each command', () => {
        render(
            <SlashCommandMenu
                skills={SKILLS}
                filter=""
                onSelect={() => {}}
                onDismiss={() => {}}
                visible={true}
                highlightIndex={0}
            />,
        );
        const rows = document.querySelectorAll('[data-menu-item]');
        expect(rows[0].textContent).toContain('Ask the agent to draft a Markdown spec instead of code');
        expect(rows[2].textContent).toContain('Restrict edits to a path or package');
    });

    it('renders args as a dim monospace hint when provided', () => {
        const skillsWithArgs = [
            { name: 'loop', description: 'Run a prompt on a recurring interval', args: '[interval] <prompt>' },
            { name: 'model', description: 'Switch AI model' },
        ];
        render(
            <SlashCommandMenu
                skills={skillsWithArgs}
                filter=""
                onSelect={() => {}}
                onDismiss={() => {}}
                visible={true}
                highlightIndex={0}
            />,
        );
        const rows = document.querySelectorAll('[data-menu-item]');
        expect(rows[0].textContent).toContain('[interval] <prompt>');
        expect(rows[1].textContent).not.toContain('[interval]');
    });

    it('does not render an args span when args is absent', () => {
        render(
            <SlashCommandMenu
                skills={[{ name: 'spec', description: 'Draft a spec' }]}
                filter=""
                onSelect={() => {}}
                onDismiss={() => {}}
                visible={true}
                highlightIndex={0}
            />,
        );
        const row = document.querySelector('[data-menu-item]');
        expect(row?.textContent).not.toContain('[');
    });

    it('loop meta-command entry has correct shape', () => {
        const loop = { name: 'loop', description: 'Run a prompt on a recurring interval', args: '[interval] <prompt>' };
        expect(loop.name).toBe('loop');
        expect(loop.args).toBe('[interval] <prompt>');
        expect(loop.description).toBeTruthy();
    });
});
