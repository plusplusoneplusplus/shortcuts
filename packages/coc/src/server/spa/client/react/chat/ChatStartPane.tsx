import { Button } from '../shared';
import { ImagePreviews } from '../shared/ImagePreviews';
import { SlashCommandMenu } from '../repos/SlashCommandMenu';
import type { SkillItem } from '../repos/SlashCommandMenu';

export interface ChatStartPaneProps {
    isMobile: boolean;
    inputValue: string;
    onInputChange: (value: string, selectionStart: number) => void;
    onStartChat: () => void;
    sending: boolean;
    error: string | null;
    readOnly: boolean;
    onReadOnlyChange: (value: boolean) => void;
    model: string;
    models: string[];
    onModelChange: (value: string) => void;
    images: string[];
    onRemoveImage: (index: number) => void;
    onPaste: (e: React.ClipboardEvent) => void;
    skills: SkillItem[];
    slashCommands: {
        menuFilter: string;
        menuVisible: boolean;
        highlightIndex: number;
        filteredSkills: SkillItem[];
        handleKeyDown: (e: React.KeyboardEvent) => boolean;
        selectSkill: (name: string, currentInput: string, setInput: (v: string) => void) => void;
        dismissMenu: () => void;
    };
    onSetInputValue: (value: string) => void;
    onMobileBack?: () => void;
}

export function ChatStartPane({
    isMobile,
    inputValue,
    onInputChange,
    onStartChat,
    sending,
    error,
    readOnly,
    onReadOnlyChange,
    model,
    models,
    onModelChange,
    images,
    onRemoveImage,
    onPaste,
    skills,
    slashCommands,
    onSetInputValue,
    onMobileBack,
}: ChatStartPaneProps) {
    return (
        <div className="flex flex-col items-center justify-center h-full p-8 gap-4">
            {isMobile && onMobileBack && (
                <button
                    className="self-start text-sm text-[#0078d4] hover:text-[#005a9e] dark:text-[#3794ff] dark:hover:text-[#60aeff]"
                    onClick={onMobileBack}
                    data-testid="chat-detail-back-btn"
                >
                    ← Back
                </button>
            )}
            <div className="text-sm font-medium text-[#1e1e1e] dark:text-[#cccccc]">Chat with this repository</div>
            <div className="w-full max-w-md relative">
                <textarea
                    className="w-full border rounded p-2 text-sm resize-none bg-white dark:bg-[#1e1e1e] text-[#1e1e1e] dark:text-[#cccccc] border-[#e0e0e0] dark:border-[#3c3c3c]"
                    rows={3}
                    placeholder="Ask anything… Type / for skills"
                    value={inputValue}
                    onChange={e => {
                        onInputChange(e.target.value, e.target.selectionStart ?? e.target.value.length);
                    }}
                    onKeyDown={e => {
                        if (slashCommands.handleKeyDown(e)) {
                            if (e.key === 'Enter' || e.key === 'Tab') {
                                const selected = slashCommands.filteredSkills[slashCommands.highlightIndex];
                                if (selected) slashCommands.selectSkill(selected.name, inputValue, onSetInputValue);
                            }
                            return;
                        }
                        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); void onStartChat(); }
                    }}
                    onPaste={onPaste}
                />
                <SlashCommandMenu
                    skills={skills}
                    filter={slashCommands.menuFilter}
                    onSelect={name => slashCommands.selectSkill(name, inputValue, onSetInputValue)}
                    onDismiss={slashCommands.dismissMenu}
                    visible={slashCommands.menuVisible}
                    highlightIndex={slashCommands.highlightIndex}
                />
            </div>
            <ImagePreviews images={images} onRemove={onRemoveImage} />
            {error && <div className="text-xs text-red-500">{error}</div>}
            {isMobile ? (
                <div className="space-y-2 w-full max-w-md" data-testid="chat-start-controls">
                    <div className="flex items-center gap-2">
                        <label className="flex items-center gap-1 text-xs text-[#848484] cursor-pointer" data-testid="chat-readonly-toggle">
                            <input
                                type="checkbox"
                                checked={readOnly}
                                onChange={e => onReadOnlyChange(e.target.checked)}
                                className="accent-blue-500"
                            />
                            Read-only
                        </label>
                        <select
                            value={model}
                            onChange={e => onModelChange(e.target.value)}
                            className="flex-1 px-2 py-1.5 text-sm rounded border bg-white dark:bg-[#1e1e1e] text-[#1e1e1e] dark:text-[#cccccc] border-[#e0e0e0] dark:border-[#3c3c3c]"
                            data-testid="chat-model-select"
                        >
                            <option value="">Default</option>
                            {models.map(m => (
                                <option key={m} value={m}>{m}</option>
                            ))}
                        </select>
                    </div>
                    <Button disabled={!inputValue.trim() || sending} onClick={() => void onStartChat()} className="w-full justify-center">
                        {sending ? '...' : 'Start Chat'}
                    </Button>
                </div>
            ) : (
                <div className="flex items-center gap-2" data-testid="chat-start-controls">
                    <label className="flex items-center gap-1 text-xs text-[#848484] cursor-pointer" data-testid="chat-readonly-toggle">
                        <input
                            type="checkbox"
                            checked={readOnly}
                            onChange={e => onReadOnlyChange(e.target.checked)}
                            className="accent-blue-500"
                        />
                        Read-only
                    </label>
                    <select
                        value={model}
                        onChange={e => onModelChange(e.target.value)}
                        className="px-2 py-1.5 text-sm rounded border bg-white dark:bg-[#1e1e1e] text-[#1e1e1e] dark:text-[#cccccc] border-[#e0e0e0] dark:border-[#3c3c3c]"
                        data-testid="chat-model-select"
                    >
                        <option value="">Default</option>
                        {models.map(m => (
                            <option key={m} value={m}>{m}</option>
                        ))}
                    </select>
                    <Button disabled={!inputValue.trim() || sending} onClick={() => void onStartChat()}>
                        {sending ? '...' : 'Start Chat'}
                    </Button>
                </div>
            )}
        </div>
    );
}
