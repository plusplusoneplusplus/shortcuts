/**
 * ChatStyleSettingsCard — the "Chat Style" settings section.
 *
 * Chat styles get their own section rather than a slot on the Features card:
 * the per-style prompt text is multiline free text, which the registry-driven
 * `AdminSettingUiSpec.control` shapes cannot express. The section is only
 * reachable while `features.chatStyleSelector` is on (AdminPanel hides the
 * sub-tab otherwise), so nothing here re-checks that flag — it is mirrored
 * read-only just so the dependency is discoverable from here.
 *
 * Pure presentation; state and the save payload live in
 * `useAdminChatStyleSettings`.
 */
import { CHAT_STYLES, CHAT_STYLE_LABELS, type ChatStyle } from '@plusplusoneplusplus/coc-client';
import { SettingsCard } from './SettingsCard';
import { AdminRow, SourceBadge } from './adminControls';
import {
    CHAT_STYLE_PROMPT_MAX_LENGTH,
    EDITABLE_CHAT_STYLES,
    type EditableChatStyle,
} from '../../../../../config/chat-style-prompts';
import type { ChatStylePromptDraft } from './useAdminChatStyleSettings';

export interface ChatStyleSettingsCardProps {
    defaultChatStyle: ChatStyle;
    setDefaultChatStyle: (style: ChatStyle) => void;
    /** Current value of `features.chatStyleSelector`, mirrored read-only. */
    selectorEnabled: boolean;
    /** Effective prompt text per editable style. */
    prompts: ChatStylePromptDraft;
    setPrompt: (style: EditableChatStyle, text: string) => void;
    resetPrompt: (style: EditableChatStyle) => void;
    isPromptCustomized: (style: EditableChatStyle) => boolean;
    dirty: boolean;
    saving: boolean;
    onSave: () => void;
    onCancel: () => void;
    sources: Record<string, string>;
    isDefaultValue: (key: string) => boolean | undefined;
}

export function ChatStyleSettingsCard({
    defaultChatStyle,
    setDefaultChatStyle,
    selectorEnabled,
    prompts,
    setPrompt,
    resetPrompt,
    isPromptCustomized,
    dirty,
    saving,
    onSave,
    onCancel,
    sources,
    isDefaultValue,
}: ChatStyleSettingsCardProps) {
    return (
        <SettingsCard
            title="Chat Style"
            description="How chat answers are written. Style controls presentation only — never the provider, model, reasoning effort, or tools."
            dirty={dirty}
            saving={saving}
            onSave={onSave}
            onCancel={onCancel}
            data-testid="settings-chat-style"
        >
            <AdminRow
                name="Default chat style"
                hint='Style new conversations start on. "Default" adds no style instruction. Applies server-wide — chats submitted through the API with no style use this too. A user who explicitly picks Default in the composer still gets no instruction.'
            >
                <SourceBadge
                    source={sources['features.defaultChatStyle']}
                    isDefault={isDefaultValue('features.defaultChatStyle')}
                />
                <select
                    className="ar-select ar-med"
                    value={defaultChatStyle}
                    onChange={e => setDefaultChatStyle(e.target.value as ChatStyle)}
                    data-testid="select-default-chat-style"
                >
                    {CHAT_STYLES.map(style => (
                        <option key={style} value={style}>{CHAT_STYLE_LABELS[style]}</option>
                    ))}
                </select>
            </AdminRow>

            {EDITABLE_CHAT_STYLES.map(style => (
                <AdminRow
                    key={style}
                    name={`${CHAT_STYLE_LABELS[style]} prompt`}
                    hint={`Instruction injected when a chat switches to ${CHAT_STYLE_LABELS[style]}. Takes effect on the next chat that switches style — conversations already running keep the text they were given. Leave it blank to fall back to the built-in wording.`}
                >
                    <div className="ar-stack" style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1, minWidth: 0 }}>
                        <textarea
                            className="ar-input"
                            rows={4}
                            value={prompts[style] ?? ''}
                            maxLength={CHAT_STYLE_PROMPT_MAX_LENGTH}
                            onChange={e => setPrompt(style, e.target.value)}
                            data-testid={`textarea-chat-style-prompt-${style}`}
                            style={{ width: '100%', resize: 'vertical', fontFamily: 'inherit' }}
                        />
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span className="ar-muted" style={{ fontSize: 12 }} data-testid={`chat-style-prompt-state-${style}`}>
                                {isPromptCustomized(style) ? 'Customized' : 'Built-in default'}
                            </span>
                            <button
                                type="button"
                                className="ar-btn ar-btn-ghost ar-btn-sm"
                                disabled={!isPromptCustomized(style)}
                                onClick={() => resetPrompt(style)}
                                data-testid={`reset-chat-style-prompt-${style}`}
                            >
                                Reset to default
                            </button>
                        </div>
                    </div>
                </AdminRow>
            ))}

            <AdminRow
                name="Style selector"
                hint="The composer style dropdown is a feature flag, edited on the Features tab. This whole section is hidden while it is off."
            >
                <span className="ar-muted" data-testid="chat-style-selector-mirror" style={{ fontSize: 12.5 }}>
                    {selectorEnabled ? 'Enabled' : 'Disabled'}
                </span>
                <a className="ar-btn ar-btn-ghost ar-btn-sm" href="#admin/settings/features">
                    Features
                </a>
            </AdminRow>
        </SettingsCard>
    );
}
