import { Dialog } from '../../../ui/Dialog';
import { Button } from '../../../ui/Button';
import type { ConcreteChatProvider } from '../../../utils/providerSelection';

const PROVIDER_LABELS: Record<ConcreteChatProvider, string> = {
    copilot: 'Copilot',
    codex: 'Codex',
    claude: 'Claude',
    opencode: 'OpenCode',
};

export interface ProviderSwitchConfirmDialogProps {
    source: ConcreteChatProvider;
    target: ConcreteChatProvider | null;
    onConfirm: () => void;
    onCancel: () => void;
}

export function ProviderSwitchConfirmDialog({ source, target, onConfirm, onCancel }: ProviderSwitchConfirmDialogProps) {
    const sourceLabel = PROVIDER_LABELS[source];
    const targetLabel = target ? PROVIDER_LABELS[target] : '';
    return (
        <Dialog
            id="provider-switch-confirm-dialog"
            open={target !== null}
            onClose={onCancel}
            title={`Switch from ${sourceLabel} to ${targetLabel}?`}
            footer={
                <>
                    <Button variant="secondary" data-testid="provider-switch-cancel" onClick={onCancel}>Cancel</Button>
                    <Button variant="primary" data-testid="provider-switch-confirm" onClick={onConfirm}>
                        Switch to {targetLabel}
                    </Button>
                </>
            }
        >
            <div
                className="space-y-3"
                role="alertdialog"
                aria-label={`Switch from ${sourceLabel} to ${targetLabel}? This transfer is not lossless.`}
            >
                <p>
                    This starts a new {targetLabel} session. CoC will pass a bounded reconstruction of this conversation,
                    but the transfer is not lossless.
                </p>
                <p>
                    Some earlier details, tool results, images, or provider-specific state may be omitted. The new
                    provider may interpret the remaining context differently.
                </p>
                <p>
                    Your visible chat history, workspace files, and git state will not be changed by switching.
                </p>
            </div>
        </Dialog>
    );
}
