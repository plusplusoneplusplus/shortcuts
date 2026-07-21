/**
 * Tests for the redesigned SlashCommandMenu — verifies the "SLASH COMMANDS"
 * card header, the monospace command names, and the return-key indicator on
 * the highlighted row.
 */
/* @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SlashCommandMenu, META_SKILL_ITEMS, getMetaSkillItems, mergeSkillsWithMeta, orderSkillItems, effectiveKind, type SkillItem } from '../../../../src/server/spa/client/react/features/chat/SlashCommandMenu';

/** Read the kind icon's `data-kind` for a given menu row. */
function rowKind(row: Element): string | null {
    return row.querySelector('[data-testid="slash-command-kind-icon"]')?.getAttribute('data-kind') ?? null;
}

/** Read the kind icon's accessible label for a given menu row. */
function rowKindLabel(row: Element): string | null {
    return row.querySelector('[data-testid="slash-command-kind-icon"]')?.getAttribute('aria-label') ?? null;
}

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

    it('META_SKILL_ITEMS includes model and loop with correct shape', () => {
        const model = META_SKILL_ITEMS.find(s => s.name === 'model');
        const loop = META_SKILL_ITEMS.find(s => s.name === 'loop');
        expect(model).toBeDefined();
        expect(model?.description).toBeTruthy();
        expect(loop).toBeDefined();
        expect(loop?.description).toBeTruthy();
        expect(loop?.args).toBe('[interval] <prompt>');
    });

    it('META_SKILL_ITEMS includes compact with description and [instructions] args', () => {
        const compact = META_SKILL_ITEMS.find(s => s.name === 'compact');
        expect(compact).toBeDefined();
        expect(compact?.description).toBe('Compact the conversation to free context');
        expect(compact?.args).toBe('[instructions]');
    });
});

describe('getMetaSkillItems', () => {
    it('includes loop when loops are enabled', () => {
        const items = getMetaSkillItems(true);
        expect(items.find(s => s.name === 'loop')).toBeDefined();
        expect(items.find(s => s.name === 'model')).toBeDefined();
    });

    it('excludes loop when loops are disabled', () => {
        const items = getMetaSkillItems(false);
        expect(items.find(s => s.name === 'loop')).toBeUndefined();
        expect(items.find(s => s.name === 'model')).toBeDefined();
    });

    it('always includes compact regardless of the loops flag', () => {
        expect(getMetaSkillItems(true).find(s => s.name === 'compact')).toBeDefined();
        expect(getMetaSkillItems(false).find(s => s.name === 'compact')).toBeDefined();
    });
});

describe('mergeSkillsWithMeta', () => {
    it('appends meta items when no overlap with server skills', () => {
        const serverSkills = [{ name: 'impl', description: 'Implement code' }];
        const meta = [{ name: 'model', description: 'Switch AI model' }];
        const merged = mergeSkillsWithMeta(serverSkills, meta);
        expect(merged).toHaveLength(2);
        expect(merged[0].name).toBe('impl');
        expect(merged[1].name).toBe('model');
    });

    it('deduplicates when server skill has same name as meta item', () => {
        const serverSkills = [
            { name: 'loop', description: 'Rich loop description from SKILL.md' },
            { name: 'impl', description: 'Implement code' },
        ];
        const meta = [
            { name: 'loop', description: 'Run a prompt on a recurring interval', args: '[interval] <prompt>' },
            { name: 'model', description: 'Switch AI model' },
        ];
        const merged = mergeSkillsWithMeta(serverSkills, meta);
        expect(merged).toHaveLength(3);
        const loopEntries = merged.filter(s => s.name === 'loop');
        expect(loopEntries).toHaveLength(1);
    });

    it('preserves server description but overlays meta args when server lacks args', () => {
        const serverSkills = [
            { name: 'loop', description: 'Rich loop description from SKILL.md' },
        ];
        const meta = [
            { name: 'loop', description: 'Run a prompt on a recurring interval', args: '[interval] <prompt>' },
        ];
        const merged = mergeSkillsWithMeta(serverSkills, meta);
        const loop = merged.find(s => s.name === 'loop')!;
        expect(loop.description).toBe('Rich loop description from SKILL.md');
        expect(loop.args).toBe('[interval] <prompt>');
    });

    it('keeps server args when server skill already has args', () => {
        const serverSkills = [
            { name: 'loop', description: 'Rich description', args: '<server-args>' },
        ];
        const meta = [
            { name: 'loop', description: 'Meta description', args: '[interval] <prompt>' },
        ];
        const merged = mergeSkillsWithMeta(serverSkills, meta);
        const loop = merged.find(s => s.name === 'loop')!;
        expect(loop.args).toBe('<server-args>');
    });

    it('uses meta item as fallback when loop is NOT in server skills', () => {
        const serverSkills = [{ name: 'impl', description: 'Implement code' }];
        const meta = [
            { name: 'loop', description: 'Run a prompt on a recurring interval', args: '[interval] <prompt>' },
        ];
        const merged = mergeSkillsWithMeta(serverSkills, meta);
        expect(merged).toHaveLength(2);
        const loop = merged.find(s => s.name === 'loop')!;
        expect(loop.description).toBe('Run a prompt on a recurring interval');
        expect(loop.args).toBe('[interval] <prompt>');
    });

    it('handles empty server skills list', () => {
        const meta = META_SKILL_ITEMS;
        const merged = mergeSkillsWithMeta([], meta);
        expect(merged).toHaveLength(meta.length);
    });

    it('handles empty meta list', () => {
        const serverSkills = [{ name: 'impl', description: 'Implement code' }];
        const merged = mergeSkillsWithMeta(serverSkills, []);
        expect(merged).toEqual([{ name: 'impl', description: 'Implement code', kind: 'skill' }]);
    });

    it('tags server skills as kind "skill" and appended meta items as kind "builtin"', () => {
        const serverSkills = [{ name: 'impl', description: 'Implement code' }];
        const meta = [{ name: 'model', description: 'Switch AI model', kind: 'builtin' as const }];
        const merged = mergeSkillsWithMeta(serverSkills, meta);
        expect(merged.find(s => s.name === 'impl')?.kind).toBe('skill');
        expect(merged.find(s => s.name === 'model')?.kind).toBe('builtin');
    });

    it('tags an overlapping server+meta name (e.g. loop) as kind "builtin"', () => {
        const serverSkills = [{ name: 'loop', description: 'Rich loop description from SKILL.md' }];
        const meta = [{ name: 'loop', description: 'Run a prompt on a recurring interval', args: '[interval] <prompt>', kind: 'builtin' as const }];
        const merged = mergeSkillsWithMeta(serverSkills, meta);
        const loop = merged.find(s => s.name === 'loop')!;
        expect(loop.kind).toBe('builtin');
        // dedup + description/args semantics still hold
        expect(merged.filter(s => s.name === 'loop')).toHaveLength(1);
        expect(loop.description).toBe('Rich loop description from SKILL.md');
        expect(loop.args).toBe('[interval] <prompt>');
    });
});

describe('effectiveKind', () => {
    it('returns "builtin" for items explicitly tagged builtin', () => {
        expect(effectiveKind({ name: 'model', kind: 'builtin' })).toBe('builtin');
    });

    it('returns "skill" for items explicitly tagged skill', () => {
        expect(effectiveKind({ name: 'impl', kind: 'skill' })).toBe('skill');
    });

    it('defaults a missing kind to "skill"', () => {
        expect(effectiveKind({ name: 'impl' })).toBe('skill');
    });
});

describe('orderSkillItems', () => {
    it('places built-in items before skill items', () => {
        const items: SkillItem[] = [
            { name: 'apple', kind: 'skill' },
            { name: 'model', kind: 'builtin' },
            { name: 'banana', kind: 'skill' },
            { name: 'loop', kind: 'builtin' },
        ];
        const ordered = orderSkillItems(items).map(s => s.name);
        expect(ordered).toEqual(['model', 'loop', 'apple', 'banana']);
    });

    it('is stable within each bucket (preserves relative order)', () => {
        const items: SkillItem[] = [
            { name: 'zeta', kind: 'skill' },
            { name: 'alpha', kind: 'skill' },
            { name: 'compact', kind: 'builtin' },
            { name: 'model', kind: 'builtin' },
        ];
        expect(orderSkillItems(items).map(s => s.name)).toEqual(['compact', 'model', 'zeta', 'alpha']);
    });

    it('treats a missing kind as a skill (sorts after builtins)', () => {
        const items: SkillItem[] = [
            { name: 'nokind' },
            { name: 'model', kind: 'builtin' },
        ];
        expect(orderSkillItems(items).map(s => s.name)).toEqual(['model', 'nokind']);
    });

    it('is idempotent (re-sorting an ordered list is a no-op)', () => {
        const items: SkillItem[] = [
            { name: 'apple', kind: 'skill' },
            { name: 'model', kind: 'builtin' },
        ];
        const once = orderSkillItems(items);
        const twice = orderSkillItems(once);
        expect(twice.map(s => s.name)).toEqual(once.map(s => s.name));
    });

    it('does not mutate its input', () => {
        const items: SkillItem[] = [
            { name: 'apple', kind: 'skill' },
            { name: 'model', kind: 'builtin' },
        ];
        orderSkillItems(items);
        expect(items.map(s => s.name)).toEqual(['apple', 'model']);
    });
});

describe('SlashCommandMenu — per-row kind icons', () => {
    const MIXED: SkillItem[] = [
        { name: 'apple', description: 'a skill', kind: 'skill' },
        { name: 'model', description: 'Switch AI model', kind: 'builtin' },
        { name: 'banana', description: 'another skill', kind: 'skill' },
    ];

    it('renders one kind icon per row', () => {
        render(
            <SlashCommandMenu
                skills={MIXED}
                filter=""
                onSelect={() => {}}
                onDismiss={() => {}}
                visible={true}
                highlightIndex={0}
            />,
        );
        expect(document.querySelectorAll('[data-testid="slash-command-kind-icon"]').length).toBe(3);
    });

    it('built-in rows carry the built-in icon with a "Command" accessible label', () => {
        render(
            <SlashCommandMenu
                skills={MIXED}
                filter=""
                onSelect={() => {}}
                onDismiss={() => {}}
                visible={true}
                highlightIndex={0}
            />,
        );
        const rows = document.querySelectorAll('[data-menu-item]');
        const modelRow = Array.from(rows).find(r => r.textContent?.includes('/model'))!;
        expect(rowKind(modelRow)).toBe('builtin');
        expect(rowKindLabel(modelRow)).toBe('Command');
    });

    it('skill rows carry the skill icon with a "Skill" accessible label', () => {
        render(
            <SlashCommandMenu
                skills={MIXED}
                filter=""
                onSelect={() => {}}
                onDismiss={() => {}}
                visible={true}
                highlightIndex={0}
            />,
        );
        const rows = document.querySelectorAll('[data-menu-item]');
        const appleRow = Array.from(rows).find(r => r.textContent?.includes('/apple'))!;
        expect(rowKind(appleRow)).toBe('skill');
        expect(rowKindLabel(appleRow)).toBe('Skill');
    });

    it('renders built-in rows before skill rows regardless of input order', () => {
        render(
            <SlashCommandMenu
                skills={MIXED}
                filter=""
                onSelect={() => {}}
                onDismiss={() => {}}
                visible={true}
                highlightIndex={0}
            />,
        );
        const rows = Array.from(document.querySelectorAll('[data-menu-item]'));
        expect(rows[0].textContent).toContain('/model');
        expect(rowKind(rows[0])).toBe('builtin');
        expect(rowKind(rows[1])).toBe('skill');
        expect(rowKind(rows[2])).toBe('skill');
    });

    it('defaults an item with no kind to the skill icon', () => {
        render(
            <SlashCommandMenu
                skills={[{ name: 'nokind', description: 'no discriminator' }]}
                filter=""
                onSelect={() => {}}
                onDismiss={() => {}}
                visible={true}
                highlightIndex={0}
            />,
        );
        const row = document.querySelector('[data-menu-item]')!;
        expect(rowKind(row)).toBe('skill');
        expect(rowKindLabel(row)).toBe('Skill');
    });

    it('keeps icons correct per kind when the list is filtered', () => {
        // "/co" narrows to compact (builtin) + coc-chat (skill); order builtin-first.
        render(
            <SlashCommandMenu
                skills={[
                    { name: 'coc-chat', description: 'chat skill', kind: 'skill' },
                    { name: 'compact', description: 'Compact the conversation', kind: 'builtin' },
                    { name: 'impl', description: 'unrelated', kind: 'skill' },
                ]}
                filter="co"
                onSelect={() => {}}
                onDismiss={() => {}}
                visible={true}
                highlightIndex={0}
            />,
        );
        const rows = Array.from(document.querySelectorAll('[data-menu-item]'));
        expect(rows.length).toBe(2);
        expect(rows[0].textContent).toContain('/compact');
        expect(rowKind(rows[0])).toBe('builtin');
        expect(rows[1].textContent).toContain('/coc-chat');
        expect(rowKind(rows[1])).toBe('skill');
    });
});
