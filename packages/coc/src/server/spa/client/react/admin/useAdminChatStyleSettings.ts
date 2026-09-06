/**
 * useAdminChatStyleSettings — controller for the "Chat Style" settings card.
 *
 * The Chat Style section owns settings that do not fit the registry-driven
 * Features card: `features.defaultChatStyle` (a select the Features card no
 * longer renders) and `features.chatStylePrompts` (multiline per-style prompt
 * text). State, dirty tracking, and the `PUT /api/admin/config` payload all
 * live here so the card stays presentational.
 *
 * Textareas always hold the *effective* text — the override when one is set,
 * otherwise the built-in default. An override is only sent for a style whose
 * text differs from its built-in default, so "Reset to default" is just
 * "put the built-in text back" and saving drops the key.
 */
import { useCallback, useMemo, useState } from 'react';
import type { ChatStyle } from '@plusplusoneplusplus/coc-client';
import { getSpaCocClient, getSpaCocClientErrorMessage } from '../api/cocClient';
import { applyRuntimeConfigPatch } from '../utils/config';
import {
    ADMIN_SETTING_DEFINITIONS,
    readAdminSettingValue,
} from '../../../../../config/admin-setting-definitions';
import {
    CHAT_STYLE_FOCUS_LINES,
    CHAT_STYLE_PROMPTS_KEY,
    EDITABLE_CHAT_STYLES,
    normalizeChatStylePromptOverrides,
    type ChatStylePromptOverrides,
    type EditableChatStyle,
} from '../../../../../config/chat-style-prompts';

const DEFAULT_CHAT_STYLE_KEY = 'features.defaultChatStyle';

export type ChatStylePromptDraft = Record<EditableChatStyle, string>;

function readDefaultChatStyle(resolved: unknown): ChatStyle {
    const def = ADMIN_SETTING_DEFINITIONS.find(d => d.key === DEFAULT_CHAT_STYLE_KEY);
    if (!def) return 'default';
    return readAdminSettingValue(def, resolved) as ChatStyle;
}

/** Textarea contents for a resolved config: override text, else the built-in. */
function readPromptDraft(resolved: unknown): ChatStylePromptDraft {
    const def = ADMIN_SETTING_DEFINITIONS.find(d => d.key === CHAT_STYLE_PROMPTS_KEY);
    const overrides = normalizeChatStylePromptOverrides(def ? readAdminSettingValue(def, resolved) : undefined);
    const draft = {} as ChatStylePromptDraft;
    for (const style of EDITABLE_CHAT_STYLES) {
        draft[style] = overrides[style] ?? CHAT_STYLE_FOCUS_LINES[style];
    }
    return draft;
}

/** The overrides a draft should persist — built-in / blank text stores nothing. */
export function promptDraftToOverrides(draft: ChatStylePromptDraft): ChatStylePromptOverrides {
    const overrides: ChatStylePromptOverrides = {};
    for (const style of EDITABLE_CHAT_STYLES) {
        const trimmed = (draft[style] ?? '').trim();
        if (trimmed.length > 0 && trimmed !== CHAT_STYLE_FOCUS_LINES[style]) {
            overrides[style] = trimmed;
        }
    }
    return overrides;
}

export interface AdminChatStyleSettings {
    defaultChatStyle: ChatStyle;
    setDefaultChatStyle: (style: ChatStyle) => void;
    /** Effective prompt text per editable style, as shown in the textareas. */
    prompts: ChatStylePromptDraft;
    setPrompt: (style: EditableChatStyle, text: string) => void;
    /** Put the built-in text back, which saves as "no override". */
    resetPrompt: (style: EditableChatStyle) => void;
    /** Whether this style's current text differs from its built-in default. */
    isPromptCustomized: (style: EditableChatStyle) => boolean;
    saving: boolean;
    dirty: boolean;
    handleSave: () => Promise<void>;
    handleCancel: () => void;
    /** Loads current + snapshot values from a freshly-fetched resolved config. */
    hydrate: (resolved: unknown) => void;
}

export function useAdminChatStyleSettings(options: {
    addToast: (message: string, type: 'success' | 'error') => void;
}): AdminChatStyleSettings {
    const { addToast } = options;
    const [defaultChatStyle, setDefaultChatStyle] = useState<ChatStyle>(() => readDefaultChatStyle(undefined));
    const [snapshot, setSnapshot] = useState<ChatStyle>(() => readDefaultChatStyle(undefined));
    const [prompts, setPrompts] = useState<ChatStylePromptDraft>(() => readPromptDraft(undefined));
    const [promptSnapshot, setPromptSnapshot] = useState<ChatStylePromptDraft>(() => readPromptDraft(undefined));
    const [saving, setSaving] = useState(false);

    const hydrate = useCallback((resolved: unknown) => {
        const loaded = readDefaultChatStyle(resolved);
        setDefaultChatStyle(loaded);
        setSnapshot(loaded);
        const draft = readPromptDraft(resolved);
        setPrompts(draft);
        setPromptSnapshot(draft);
    }, []);

    const setPrompt = useCallback((style: EditableChatStyle, text: string) => {
        setPrompts(prev => ({ ...prev, [style]: text }));
    }, []);

    const resetPrompt = useCallback((style: EditableChatStyle) => {
        setPrompts(prev => ({ ...prev, [style]: CHAT_STYLE_FOCUS_LINES[style] }));
    }, []);

    const isPromptCustomized = useCallback(
        (style: EditableChatStyle) => {
            const trimmed = (prompts[style] ?? '').trim();
            return trimmed.length > 0 && trimmed !== CHAT_STYLE_FOCUS_LINES[style];
        },
        [prompts],
    );

    const overrides = useMemo(() => promptDraftToOverrides(prompts), [prompts]);
    const snapshotOverrides = useMemo(() => promptDraftToOverrides(promptSnapshot), [promptSnapshot]);

    const dirty = defaultChatStyle !== snapshot
        || JSON.stringify(overrides) !== JSON.stringify(snapshotOverrides);

    const handleSave = useCallback(async () => {
        setSaving(true);
        try {
            await getSpaCocClient().admin.updateConfig({
                [DEFAULT_CHAT_STYLE_KEY]: defaultChatStyle,
                [CHAT_STYLE_PROMPTS_KEY]: overrides,
            });
            addToast('Settings saved', 'success');
            // The Features card no longer carries this key, so its runtime flag
            // has to be patched from here to keep the SPA in sync without a reload.
            applyRuntimeConfigPatch({ defaultChatStyle });
            setSnapshot(defaultChatStyle);
            setPromptSnapshot(prompts);
        } catch (err: unknown) {
            addToast(getSpaCocClientErrorMessage(err, 'Save failed'), 'error');
        } finally {
            setSaving(false);
        }
    }, [defaultChatStyle, overrides, prompts, addToast]);

    const handleCancel = useCallback(() => {
        setDefaultChatStyle(snapshot);
        setPrompts(promptSnapshot);
    }, [snapshot, promptSnapshot]);

    return {
        defaultChatStyle,
        setDefaultChatStyle,
        prompts,
        setPrompt,
        resetPrompt,
        isPromptCustomized,
        saving,
        dirty,
        handleSave,
        handleCancel,
        hydrate,
    };
}
