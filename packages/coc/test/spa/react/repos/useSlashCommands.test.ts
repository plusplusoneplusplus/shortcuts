/**
 * Tests for useSlashCommands hook — slash-command autocomplete state management.
 *
 * Covers selectSkill with/without RichTextInput ref, handleKeyDown type
 * compatibility, and handleInputChange menu control.
 */

import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSlashCommands } from '../../../../src/server/spa/client/react/features/chat/hooks/useSlashCommands';
import type { SkillItem } from '../../../../src/server/spa/client/react/features/chat/SlashCommandMenu';
import type { RichTextInputHandle } from '../../../../src/server/spa/client/react/shared/RichTextInput';

const skills: SkillItem[] = [
    { name: 'impl', description: 'Implement code changes with tests' },
    { name: 'draft', description: 'Draft a UX specification' },
    { name: 'go-deep', description: 'Advanced research and verification' },
];

const skillsWithMeta: SkillItem[] = [
    ...skills,
    { name: 'loop', description: 'Run a prompt on a recurring interval', args: '[interval] <prompt>' },
    { name: 'model', description: 'Switch AI model' },
];

/** Trigger the menu by simulating typing "/im" at position 3 */
function openMenu(result: ReturnType<typeof useSlashCommands>) {
    act(() => {
        result.handleInputChange('/im', 3);
    });
}

describe('useSlashCommands', () => {
    // T1: selectSkill with no ref calls setText with the replacement string
    it('selectSkill with no ref calls setText', () => {
        const { result } = renderHook(() => useSlashCommands(skills));
        const setText = vi.fn();

        // Open the menu so slashStartRef is set
        openMenu(result.current);

        act(() => {
            result.current.selectSkill('impl', '/im', setText);
        });

        expect(setText).toHaveBeenCalledWith('/impl ');
    });

    // T2: selectSkill with a ref calls both ref.current.setValue AND setText (with cursor position)
    it('selectSkill with a ref calls ref.current.setValue and setText', () => {
        const { result } = renderHook(() => useSlashCommands(skills));
        const setText = vi.fn();
        const ref: React.RefObject<RichTextInputHandle> = {
            current: {
                setValue: vi.fn(),
                getValue: vi.fn(() => ''),
                focus: vi.fn(),
            },
        };

        openMenu(result.current);

        act(() => {
            result.current.selectSkill('impl', '/im', setText, ref);
        });

        // cursor = start(0) + 1('/') + name.length(4) + 1(' ') = 6
        expect(ref.current!.setValue).toHaveBeenCalledWith('/impl ', 6);
        expect(setText).toHaveBeenCalledWith('/impl ');
    });

    // T3: selectSkill with a ref where ref.current is null falls back to setText
    it('selectSkill with null ref.current falls back to setText', () => {
        const { result } = renderHook(() => useSlashCommands(skills));
        const setText = vi.fn();
        const ref: React.RefObject<RichTextInputHandle> = { current: null };

        openMenu(result.current);

        act(() => {
            result.current.selectSkill('impl', '/im', setText, ref);
        });

        expect(setText).toHaveBeenCalledWith('/impl ');
    });

    // T4: After selectSkill (either path), menuVisible is false
    it('menuVisible is false after selectSkill', () => {
        const { result } = renderHook(() => useSlashCommands(skills));
        const setText = vi.fn();

        openMenu(result.current);
        expect(result.current.menuVisible).toBe(true);

        act(() => {
            result.current.selectSkill('impl', '/im', setText);
        });

        expect(result.current.menuVisible).toBe(false);
    });

    // T5: handleKeyDown accepts React.KeyboardEvent<HTMLElement> (compile-time check)
    it('handleKeyDown accepts HTMLElement keyboard events', () => {
        const { result } = renderHook(() => useSlashCommands(skills));

        openMenu(result.current);

        // Create a keyboard event typed as HTMLElement (not HTMLTextAreaElement)
        const event: React.KeyboardEvent<HTMLElement> = {
            key: 'Escape',
            preventDefault: vi.fn(),
        } as unknown as React.KeyboardEvent<HTMLElement>;

        let consumed = false;
        act(() => {
            consumed = result.current.handleKeyDown(event);
        });

        expect(consumed).toBe(true);
        expect(event.preventDefault).toHaveBeenCalled();
    });

    // T6: handleInputChange + menu visibility smoke test
    it('handleInputChange drives menu visibility correctly', () => {
        const { result } = renderHook(() => useSlashCommands(skills));

        // Initially menu is hidden
        expect(result.current.menuVisible).toBe(false);

        // Typing a slash command opens the menu
        act(() => {
            result.current.handleInputChange('/d', 2);
        });
        expect(result.current.menuVisible).toBe(true);
        expect(result.current.menuFilter).toBe('d');
        expect(result.current.filteredSkills).toHaveLength(1);
        expect(result.current.filteredSkills[0].name).toBe('draft');

        // Typing non-slash text closes the menu
        act(() => {
            result.current.handleInputChange('hello', 5);
        });
        expect(result.current.menuVisible).toBe(false);
    });

    // T7: cursor is placed after the inserted skill name + space (regression: was jumping to start)
    it('selectSkill passes cursor position after /${name}<space> to setValue', () => {
        const { result } = renderHook(() => useSlashCommands(skills));
        const setText = vi.fn();
        const setValue = vi.fn();
        const ref: React.RefObject<RichTextInputHandle> = {
            current: { setValue, getValue: vi.fn(() => ''), focus: vi.fn() },
        };

        // Simulate "/go-" typed at start, cursor at 4
        act(() => { result.current.handleInputChange('/go-', 4); });
        act(() => { result.current.selectSkill('go-deep', '/go-', setText, ref); });

        // cursor = 0 + 1 + 7 + 1 = 9
        expect(setValue).toHaveBeenCalledWith('/go-deep ', 9);
    });

    // activeCommandHint tests
    describe('activeCommandHint', () => {
        it('is null when input is empty', () => {
            const { result } = renderHook(() => useSlashCommands(skillsWithMeta));
            expect(result.current.activeCommandHint).toBeNull();
        });

        it('returns args when input is exactly /loop', () => {
            const { result } = renderHook(() => useSlashCommands(skillsWithMeta));
            act(() => { result.current.handleInputChange('/loop', 5); });
            expect(result.current.activeCommandHint).toBe('[interval] <prompt>');
        });

        it('returns args when input is /loop with trailing space (separator)', () => {
            const { result } = renderHook(() => useSlashCommands(skillsWithMeta));
            act(() => { result.current.handleInputChange('/loop ', 6); });
            expect(result.current.activeCommandHint).toBe('[interval] <prompt>');
        });

        it('is null when user has typed an argument after /loop', () => {
            const { result } = renderHook(() => useSlashCommands(skillsWithMeta));
            act(() => { result.current.handleInputChange('/loop 5m', 8); });
            expect(result.current.activeCommandHint).toBeNull();
        });

        it('is null for /model (no args defined)', () => {
            const { result } = renderHook(() => useSlashCommands(skillsWithMeta));
            act(() => { result.current.handleInputChange('/model', 6); });
            expect(result.current.activeCommandHint).toBeNull();
        });

        it('is null when skills list has no loop entry', () => {
            const { result } = renderHook(() => useSlashCommands(skills));
            act(() => { result.current.handleInputChange('/loop', 5); });
            expect(result.current.activeCommandHint).toBeNull();
        });

        it('clears after typing a real argument', () => {
            const { result } = renderHook(() => useSlashCommands(skillsWithMeta));
            act(() => { result.current.handleInputChange('/loop ', 6); });
            expect(result.current.activeCommandHint).toBe('[interval] <prompt>');
            act(() => { result.current.handleInputChange('/loop 5m', 8); });
            expect(result.current.activeCommandHint).toBeNull();
        });
    });

    // filteredSkills must be built-in-first so the hook's highlightIndex→item
    // mapping stays aligned with SlashCommandMenu's rendered row order.
    it('orders filteredSkills built-in-first (matches menu render order)', () => {
        const mixed: SkillItem[] = [
            { name: 'compact-notes', description: 'a skill', kind: 'skill' },
            { name: 'compact', description: 'Compact the conversation', kind: 'builtin' },
        ];
        const { result } = renderHook(() => useSlashCommands(mixed));
        // "/comp" matches both; builtin must come first
        act(() => { result.current.handleInputChange('/comp', 5); });
        expect(result.current.filteredSkills.map(s => s.name)).toEqual(['compact', 'compact-notes']);
    });

    // T8: cursor accounts for text before the slash
    it('selectSkill cursor is offset when slash is mid-string', () => {
        const { result } = renderHook(() => useSlashCommands(skills));
        const setText = vi.fn();
        const setValue = vi.fn();
        const ref: React.RefObject<RichTextInputHandle> = {
            current: { setValue, getValue: vi.fn(() => ''), focus: vi.fn() },
        };

        // Simulate "hello /dr" with slash at index 6, cursor at 9
        act(() => { result.current.handleInputChange('hello /dr', 9); });
        act(() => { result.current.selectSkill('draft', 'hello /dr', setText, ref); });

        // cursor = 6 + 1 + 5 + 1 = 13
        expect(setValue).toHaveBeenCalledWith('hello /draft ', 13);
    });
});
