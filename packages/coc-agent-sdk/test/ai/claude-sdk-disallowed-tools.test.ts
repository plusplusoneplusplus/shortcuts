/**
 * The native `AskUserQuestion` built-in is blocked whenever CoC's own
 * `ask_user` replacement is in the tool array — CoC can service `ask_user` but
 * not the built-in.
 *
 * The array derives purely from `options.tools`, with no chat-mode input. That
 * is what makes the emitted `disallowedTools` constant once CoC registers
 * `ask_user` in every chat mode: the tool block is serialized before `system`
 * and `messages`, so any per-mode difference here would invalidate the whole
 * conversation's prefix cache on a mid-chat mode switch.
 */

import { describe, expect, it } from 'vitest';
import {
    NATIVE_ASK_USER_BUILT_IN_TOOL,
    resolveClaudeDisallowedTools,
} from '../../src/claude-sdk-service';
import type { SendMessageOptions, Tool } from '../../src/types';

function makeTool(name: string): Tool<any> {
    return {
        name,
        description: `${name} description`,
        parameters: { type: 'object', properties: {} },
        handler: async () => 'ok',
    } as unknown as Tool<any>;
}

function makeOptions(tools?: Tool<any>[]): SendMessageOptions {
    return { prompt: 'hi', ...(tools ? { tools } : {}) } as SendMessageOptions;
}

describe('resolveClaudeDisallowedTools', () => {
    it('blocks the native AskUserQuestion when ask_user is registered', () => {
        expect(resolveClaudeDisallowedTools(makeOptions([makeTool('ask_user')])))
            .toEqual([NATIVE_ASK_USER_BUILT_IN_TOOL]);
    });

    it('returns an empty list when ask_user is absent', () => {
        expect(resolveClaudeDisallowedTools(makeOptions([makeTool('search_conversations')])))
            .toEqual([]);
    });

    it('returns an empty list when no tools are passed', () => {
        expect(resolveClaudeDisallowedTools(makeOptions())).toEqual([]);
    });

    it('is independent of tool ordering and unrelated tools', () => {
        const a = resolveClaudeDisallowedTools(makeOptions([
            makeTool('ask_user'), makeTool('cron'), makeTool('search_conversations'),
        ]));
        const b = resolveClaudeDisallowedTools(makeOptions([
            makeTool('search_conversations'), makeTool('cron'), makeTool('ask_user'),
        ]));
        expect(a).toEqual(b);
        expect(a).toEqual([NATIVE_ASK_USER_BUILT_IN_TOOL]);
    });
});
