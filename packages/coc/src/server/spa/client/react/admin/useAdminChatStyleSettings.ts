/**
 * useAdminChatStyleSettings — controller for the "Chat Style" settings card.
 *
 * The Chat Style section owns settings that do not fit the registry-driven
 * Features card: `features.defaultChatStyle` (a select the Features card no
 * longer renders) and, later, the per-style prompt overrides. State, dirty
 * tracking, and the `PUT /api/admin/config` payload all live here so the card
 * stays presentational.
 */
import { useCallback, useState } from 'react';
import type { ChatStyle } from '@plusplusoneplusplus/coc-client';
import { getSpaCocClient, getSpaCocClientErrorMessage } from '../api/cocClient';
import { applyRuntimeConfigPatch } from '../utils/config';
import {
    ADMIN_SETTING_DEFINITIONS,
    readAdminSettingValue,
} from '../../../../../config/admin-setting-definitions';

const DEFAULT_CHAT_STYLE_KEY = 'features.defaultChatStyle';

function readDefaultChatStyle(resolved: unknown): ChatStyle {
    const def = ADMIN_SETTING_DEFINITIONS.find(d => d.key === DEFAULT_CHAT_STYLE_KEY);
    if (!def) return 'default';
    return readAdminSettingValue(def, resolved) as ChatStyle;
}

export interface AdminChatStyleSettings {
    defaultChatStyle: ChatStyle;
    setDefaultChatStyle: (style: ChatStyle) => void;
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
    const [saving, setSaving] = useState(false);

    const hydrate = useCallback((resolved: unknown) => {
        const loaded = readDefaultChatStyle(resolved);
        setDefaultChatStyle(loaded);
        setSnapshot(loaded);
    }, []);

    const dirty = defaultChatStyle !== snapshot;

    const handleSave = useCallback(async () => {
        setSaving(true);
        try {
            await getSpaCocClient().admin.updateConfig({ [DEFAULT_CHAT_STYLE_KEY]: defaultChatStyle });
            addToast('Settings saved', 'success');
            // The Features card no longer carries this key, so its runtime flag
            // has to be patched from here to keep the SPA in sync without a reload.
            applyRuntimeConfigPatch({ defaultChatStyle });
            setSnapshot(defaultChatStyle);
        } catch (err: unknown) {
            addToast(getSpaCocClientErrorMessage(err, 'Save failed'), 'error');
        } finally {
            setSaving(false);
        }
    }, [defaultChatStyle, addToast]);

    const handleCancel = useCallback(() => {
        setDefaultChatStyle(snapshot);
    }, [snapshot]);

    return { defaultChatStyle, setDefaultChatStyle, saving, dirty, handleSave, handleCancel, hydrate };
}
