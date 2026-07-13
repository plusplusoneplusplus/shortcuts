/**
 * CoC Desktop — DevTunnel "Configure…" modal (AC-01).
 *
 * The compact, fixed-size modal opened from the native **Dev Tunnel → Configure…**
 * menu item. It owns a single tunnel-ID field (prefilled with the current or
 * default `<computer-name>-coc` ID), concise private-access guidance, and
 * Save/Cancel actions. It renders to an inline `data:` URL — like `splash.ts`,
 * no bundled asset file — using the same dark desktop-shell palette while the
 * menu itself keeps standard Windows native styling.
 *
 * Save/Cancel are relayed to the main process over two IPC channels; the main
 * process (see `main.ts`) creates the modal `BrowserWindow`, exposes the
 * `window.cocDesktop.devtunnelModal` bridge through the preload, and persists the
 * chosen tunnel ID via `setDevTunnelId` before reconfiguring the host.
 *
 * Like `splash.ts` and `find-in-page.ts`, this module imports NOTHING from
 * `electron`. The interaction logic lives in the pure, dependency-free
 * {@link wireDevTunnelModal} function — unit-tested here against a fake DOM AND
 * embedded verbatim into the modal's inline script via `.toString()`, so there is
 * a single source of truth for the Save/Cancel behaviour.
 */

/** IPC channel: modal renderer → main, "save this tunnel ID". */
export const DEVTUNNEL_MODAL_SUBMIT_CHANNEL = 'coc-desktop:devtunnel-modal-submit';
/** IPC channel: modal renderer → main, "cancel — leave the config unchanged". */
export const DEVTUNNEL_MODAL_CANCEL_CHANNEL = 'coc-desktop:devtunnel-modal-cancel';

/** DOM id of the tunnel-ID text field. */
export const DEVTUNNEL_MODAL_INPUT_ID = 'coc-tunnel-id';
/** DOM id of the Save button. */
export const DEVTUNNEL_MODAL_SAVE_ID = 'coc-tunnel-save';
/** DOM id of the Cancel button. */
export const DEVTUNNEL_MODAL_CANCEL_ID = 'coc-tunnel-cancel';

/**
 * Concise private-access guidance shown under the field. It states that the
 * tunnel stays private/authenticated (no anonymous access) — matching the AC-02
 * "authenticated/private default" decision — without exposing any credential or
 * command output.
 */
export const DEVTUNNEL_PRIVATE_ACCESS_GUIDANCE =
    'This tunnel stays private: only your authenticated Microsoft DevTunnel account ' +
    'can reach it. No anonymous or public access is enabled.';

/** The minimal element surface {@link wireDevTunnelModal} drives. */
export interface DevTunnelModalElement {
    value?: string;
    disabled?: boolean;
    addEventListener(type: string, listener: (event: DevTunnelModalEvent) => void): void;
    focus?(): void;
    select?(): void;
}

/** The minimal `document` surface {@link wireDevTunnelModal} needs. */
export interface DevTunnelModalDocument {
    getElementById(id: string): DevTunnelModalElement | null;
}

/** The minimal event surface (Enter/Escape handling). */
export interface DevTunnelModalEvent {
    key?: string;
    preventDefault?(): void;
}

/** The main-process bridge the modal calls to report the user's choice. */
export interface DevTunnelModalBridge {
    submit(tunnelId: string): void;
    cancel(): void;
}

/**
 * Wire the Save/Cancel behaviour of the Configure… modal.
 *
 * Save reads the trimmed field value and, when non-empty, calls `bridge.submit`;
 * an empty field disables Save and is never submitted. Cancel (button or Escape)
 * calls `bridge.cancel`. Enter in the field submits. The Save button's enabled
 * state tracks the field on every input.
 *
 * NOTE: this function is embedded verbatim into the modal's inline script via
 * `.toString()`, so keep it free of TypeScript-only *values*, of template
 * literals (backticks / `${...}`), and of any reference to module-scope
 * identifiers — the element ids below are hard-coded literals for that reason.
 */
export function wireDevTunnelModal(
    doc: DevTunnelModalDocument,
    bridge: DevTunnelModalBridge | null | undefined,
): void {
    var input = doc.getElementById('coc-tunnel-id');
    var saveBtn = doc.getElementById('coc-tunnel-save');
    var cancelBtn = doc.getElementById('coc-tunnel-cancel');
    if (!input || !saveBtn || !cancelBtn || !bridge) {
        return;
    }
    function currentValue(): string {
        return ((input as DevTunnelModalElement).value || '').trim();
    }
    function syncSaveEnabled(): void {
        (saveBtn as DevTunnelModalElement).disabled = currentValue().length === 0;
    }
    function save(): void {
        var value = currentValue();
        if (!value) {
            return;
        }
        (bridge as DevTunnelModalBridge).submit(value);
    }
    function cancel(): void {
        (bridge as DevTunnelModalBridge).cancel();
    }
    input.addEventListener('input', syncSaveEnabled);
    input.addEventListener('keydown', function (event: DevTunnelModalEvent) {
        if (event.key === 'Enter') {
            if (event.preventDefault) {
                event.preventDefault();
            }
            save();
        } else if (event.key === 'Escape') {
            if (event.preventDefault) {
                event.preventDefault();
            }
            cancel();
        }
    });
    saveBtn.addEventListener('click', save);
    cancelBtn.addEventListener('click', cancel);
    syncSaveEnabled();
    if (input.focus) {
        input.focus();
        if (input.select) {
            input.select();
        }
    }
}

/** Escape a string for safe interpolation into HTML text or a quoted attribute. */
function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/** Options for rendering the Configure… modal. */
export interface DevTunnelModalOptions {
    /** The tunnel ID to prefill (current persisted ID, or the default). */
    tunnelId: string;
}

/**
 * Build the full HTML document for the Configure… modal, prefilled with
 * `tunnelId`. The tunnel ID is HTML-escaped so a hand-edited/persisted value can
 * never break out of the `value="…"` attribute or inject markup.
 */
export function renderDevTunnelConfigHtml(options: DevTunnelModalOptions): string {
    const prefill = escapeHtml(options.tunnelId ?? '');
    const guidance = escapeHtml(DEVTUNNEL_PRIVATE_ACCESS_GUIDANCE);
    const script = `(function () {
  var wireDevTunnelModal = ${wireDevTunnelModal.toString()};
  var bridge = (window.cocDesktop && window.cocDesktop.devtunnelModal) || null;
  wireDevTunnelModal(document, bridge);
})();`;

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';" />
<title>Configure Dev Tunnel</title>
<style>
  :root { color-scheme: dark; }
  html, body { height: 100%; margin: 0; }
  body {
    display: flex;
    flex-direction: column;
    gap: 14px;
    box-sizing: border-box;
    padding: 20px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background: #0d1117;
    color: #e6edf3;
    user-select: none;
    -webkit-user-select: none;
  }
  h1 { font-size: 15px; font-weight: 600; margin: 0; }
  label { font-size: 12px; color: #8b949e; }
  input {
    width: 100%;
    box-sizing: border-box;
    padding: 7px 8px;
    border-radius: 6px;
    border: 1px solid #30363d;
    background: #010409;
    color: #e6edf3;
    font-size: 13px;
    outline: none;
    user-select: text;
    -webkit-user-select: text;
  }
  input:focus { border-color: #58a6ff; }
  .guidance { font-size: 12px; color: #8b949e; line-height: 1.4; }
  .actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: auto; }
  button {
    min-width: 76px;
    height: 30px;
    padding: 0 12px;
    border-radius: 6px;
    border: 1px solid #30363d;
    background: #21262d;
    color: #e6edf3;
    font-size: 13px;
    cursor: pointer;
  }
  button#coc-tunnel-save { background: #238636; border-color: #2ea043; }
  button#coc-tunnel-save:disabled { background: #21262d; border-color: #30363d; color: #6e7681; cursor: default; }
</style>
</head>
<body>
  <h1>Configure Dev Tunnel</h1>
  <div>
    <label for="coc-tunnel-id">Tunnel ID</label>
    <input id="coc-tunnel-id" type="text" spellcheck="false" autocomplete="off" value="${prefill}" />
  </div>
  <div class="guidance">${guidance}</div>
  <div class="actions">
    <button id="coc-tunnel-cancel" type="button">Cancel</button>
    <button id="coc-tunnel-save" type="button">Save</button>
  </div>
  <script>${script}</script>
</body>
</html>`;
}

/** Build a `data:` URL for the modal document, ready for `BrowserWindow.loadURL`. */
export function devTunnelConfigDataUrl(options: DevTunnelModalOptions): string {
    return `data:text/html;charset=utf-8,${encodeURIComponent(renderDevTunnelConfigHtml(options))}`;
}
