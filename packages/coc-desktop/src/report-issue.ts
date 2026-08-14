/**
 * CoC Desktop — "Report an Issue…" modal (Help menu).
 *
 * The compact, fixed-size modal opened from the native **Help → Report an Issue…**
 * item. It owns a Title field, a Description field, a read-only Environment
 * preview, and Submit/Cancel actions. Submit does NOT talk to GitHub: the main
 * process builds a `https://github.com/plusplusoneplusplus/shortcuts/issues/new`
 * URL with the title and body prefilled and hands it to the default browser, so
 * the user stays the author and presses GitHub's own "Submit new issue" button.
 * CoC never authenticates to GitHub and never uploads anything itself.
 *
 * The body carries a `### Screenshot` placeholder (the user pastes an image
 * straight into GitHub's editor — CoC handles no images at all) and an
 * auto-generated `### Environment` block holding versions/platform only: no logs,
 * no filesystem paths, no workspace names, no prompt text. The target repository
 * is public, so the modal says so in visible copy and shows the Environment block
 * read-only before submit.
 *
 * Like `devtunnel-modal.ts` and `splash.ts`, this module imports NOTHING from
 * `electron` and renders to an inline `data:` URL. The interaction logic lives in
 * the pure {@link wireReportIssueModal} function — unit-tested against a fake DOM
 * AND embedded verbatim into the modal's inline script via `.toString()`, so
 * there is a single source of truth for the Submit/Cancel behaviour.
 */

/** IPC channel: modal renderer → main, "open GitHub with this report prefilled". */
export const REPORT_ISSUE_SUBMIT_CHANNEL = 'coc-desktop:report-issue-submit';
/** IPC channel: modal renderer → main, "cancel — do nothing". */
export const REPORT_ISSUE_CANCEL_CHANNEL = 'coc-desktop:report-issue-cancel';

/** DOM id of the single-line Title field. */
export const REPORT_ISSUE_TITLE_ID = 'coc-report-title';
/** DOM id of the multi-line Description field. */
export const REPORT_ISSUE_DESCRIPTION_ID = 'coc-report-description';
/** DOM id of the live character counter under the Description field. */
export const REPORT_ISSUE_COUNTER_ID = 'coc-report-counter';
/** DOM id of the read-only Environment preview. */
export const REPORT_ISSUE_ENVIRONMENT_ID = 'coc-report-environment';
/** DOM id of the Submit button. */
export const REPORT_ISSUE_SUBMIT_ID = 'coc-report-submit';
/** DOM id of the Cancel button. */
export const REPORT_ISSUE_CANCEL_ID = 'coc-report-cancel';

/** The public repository issues are filed against (matches `git remote -v`). */
export const REPORT_ISSUE_NEW_URL = 'https://github.com/plusplusoneplusplus/shortcuts/issues/new';

/** Soft cap on the Description field, surfaced by the live counter. */
export const REPORT_ISSUE_DESCRIPTION_MAX = 6000;
/** Hard cap on the Title field (enforced by `maxlength` in the markup). */
export const REPORT_ISSUE_TITLE_MAX = 200;
/** Safe length for the fully-encoded GitHub URL; past this we fall back to the clipboard. */
export const REPORT_ISSUE_URL_MAX = 8000;

/** Placeholder inviting the user to paste a screenshot into GitHub's own editor. */
export const REPORT_ISSUE_SCREENSHOT_PLACEHOLDER =
    '<!-- Paste your screenshot here (Ctrl+V / Cmd+V) -->';

/** Visible copy warning that the report becomes a public GitHub issue. */
export const REPORT_ISSUE_PUBLIC_NOTICE =
    'This report is posted as a public issue on github.com/plusplusoneplusplus/shortcuts. ' +
    'Do not include passwords, tokens, or anything private.';

/** The environment facts appended to every report. Injected, never read here. */
export interface ReportIssueEnvironment {
    /** `app.getVersion()`. */
    appVersion: string;
    /** `process.versions.electron`. */
    electronVersion: string;
    /** `process.versions.node`. */
    nodeVersion: string;
    /** `process.platform`. */
    platform: string;
    /** `os.release()`. */
    release: string;
    /** `process.arch`. */
    arch: string;
}

/**
 * Build the `### Environment` block: app/Electron/Node versions, OS platform +
 * release, and arch. Deliberately nothing else — the target repo is public and
 * log lines routinely carry paths, workspace names, and prompt text.
 */
export function buildEnvironmentBlock(env: ReportIssueEnvironment): string {
    return [
        '### Environment',
        '',
        `- App version: ${env.appVersion}`,
        `- Electron: ${env.electronVersion}`,
        `- Node: ${env.nodeVersion}`,
        `- OS: ${env.platform} ${env.release}`,
        `- Arch: ${env.arch}`,
    ].join('\n');
}

/**
 * Compose the full issue body: the user's description, the `### Screenshot`
 * placeholder, and the `### Environment` block.
 */
export function buildIssueBody(description: string, env: ReportIssueEnvironment): string {
    return [
        description.trim(),
        '',
        '### Screenshot',
        '',
        REPORT_ISSUE_SCREENSHOT_PLACEHOLDER,
        '',
        buildEnvironmentBlock(env),
        '',
    ].join('\n');
}

/** Input for {@link buildIssueUrl}. */
export interface ReportIssueInput {
    title: string;
    description: string;
    environment: ReportIssueEnvironment;
}

/** Result of {@link buildIssueUrl}. */
export interface ReportIssueUrl {
    /** The URL to open in the external browser. */
    url: string;
    /** The full composed body — the clipboard payload when `overflow` is true. */
    body: string;
    /**
     * True when the prefilled URL would exceed {@link REPORT_ISSUE_URL_MAX}. The
     * caller then copies `body` to the clipboard and opens the bare `issues/new`
     * page — never silently truncating the user's text.
     */
    overflow: boolean;
}

/**
 * Build the prefilled GitHub new-issue URL. When the fully-encoded URL would run
 * past the safe limit, flag `overflow` and return the bare `issues/new` URL so the
 * caller can fall back to copy-to-clipboard plus a notice.
 */
export function buildIssueUrl(input: ReportIssueInput): ReportIssueUrl {
    const title = input.title.trim();
    const body = buildIssueBody(input.description, input.environment);
    const params = new URLSearchParams({ title, body });
    const url = `${REPORT_ISSUE_NEW_URL}?${params.toString()}`;
    if (url.length > REPORT_ISSUE_URL_MAX) {
        return { url: REPORT_ISSUE_NEW_URL, body, overflow: true };
    }
    return { url, body, overflow: false };
}

/** The minimal element surface {@link wireReportIssueModal} drives. */
export interface ReportIssueElement {
    value?: string;
    disabled?: boolean;
    textContent?: string | null;
    addEventListener(type: string, listener: (event: ReportIssueEvent) => void): void;
    focus?(): void;
}

/** The minimal `document` surface {@link wireReportIssueModal} needs. */
export interface ReportIssueDocument {
    getElementById(id: string): ReportIssueElement | null;
    addEventListener?(type: string, listener: (event: ReportIssueEvent) => void): void;
}

/** The minimal event surface (Enter/Escape handling). */
export interface ReportIssueEvent {
    key?: string;
    preventDefault?(): void;
}

/** The main-process bridge the modal calls to report the user's choice. */
export interface ReportIssueBridge {
    submit(title: string, description: string): void;
    cancel(): void;
}

/**
 * Wire the Submit/Cancel behaviour of the Report an Issue… modal.
 *
 * Submit reads the trimmed title and description and calls `bridge.submit`; an
 * empty title disables Submit and is never submitted (an empty description is
 * allowed). Cancel — button or Escape — calls `bridge.cancel`. Enter in the Title
 * field submits; Enter in the Description field inserts a newline as usual. The
 * character counter tracks the description on every input.
 *
 * NOTE: this function is embedded verbatim into the modal's inline script via
 * `.toString()`, so keep it free of TypeScript-only *values*, of template
 * literals (backticks / `${...}`), and of any reference to module-scope
 * identifiers — the element ids and caps below are hard-coded literals for that
 * reason.
 */
export function wireReportIssueModal(
    doc: ReportIssueDocument,
    bridge: ReportIssueBridge | null | undefined,
): void {
    var titleInput = doc.getElementById('coc-report-title');
    var descInput = doc.getElementById('coc-report-description');
    var counter = doc.getElementById('coc-report-counter');
    var submitBtn = doc.getElementById('coc-report-submit');
    var cancelBtn = doc.getElementById('coc-report-cancel');
    if (!titleInput || !descInput || !submitBtn || !cancelBtn || !bridge) {
        return;
    }
    function currentTitle(): string {
        return ((titleInput as ReportIssueElement).value || '').trim();
    }
    function currentDescription(): string {
        return ((descInput as ReportIssueElement).value || '').trim();
    }
    function syncSubmitEnabled(): void {
        (submitBtn as ReportIssueElement).disabled = currentTitle().length === 0;
    }
    function syncCounter(): void {
        if (!counter) {
            return;
        }
        var length = ((descInput as ReportIssueElement).value || '').length;
        counter.textContent = String(length) + ' / 6000';
    }
    function submit(): void {
        if (currentTitle().length === 0) {
            return;
        }
        (bridge as ReportIssueBridge).submit(currentTitle(), currentDescription());
    }
    function cancel(): void {
        (bridge as ReportIssueBridge).cancel();
    }
    function onEscape(event: ReportIssueEvent): void {
        if (event.key === 'Escape') {
            if (event.preventDefault) {
                event.preventDefault();
            }
            cancel();
        }
    }
    titleInput.addEventListener('input', syncSubmitEnabled);
    titleInput.addEventListener('keydown', function (event: ReportIssueEvent) {
        if (event.key === 'Enter') {
            if (event.preventDefault) {
                event.preventDefault();
            }
            submit();
        } else {
            onEscape(event);
        }
    });
    descInput.addEventListener('input', syncCounter);
    descInput.addEventListener('keydown', onEscape);
    submitBtn.addEventListener('click', submit);
    cancelBtn.addEventListener('click', cancel);
    if (doc.addEventListener) {
        doc.addEventListener('keydown', onEscape);
    }
    syncSubmitEnabled();
    syncCounter();
    if (titleInput.focus) {
        titleInput.focus();
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

/** Options for rendering the Report an Issue… modal. */
export interface ReportIssueModalOptions {
    /** The environment facts shown read-only, exactly as they will be posted. */
    environment: ReportIssueEnvironment;
}

/**
 * Build the full HTML document for the Report an Issue… modal. The Environment
 * block is HTML-escaped and rendered read-only so the user sees exactly what
 * becomes public before pressing Submit.
 */
export function renderReportIssueHtml(options: ReportIssueModalOptions): string {
    const environment = escapeHtml(buildEnvironmentBlock(options.environment));
    const notice = escapeHtml(REPORT_ISSUE_PUBLIC_NOTICE);
    const script = `(function () {
  var wireReportIssueModal = ${wireReportIssueModal.toString()};
  var bridge = (window.cocDesktop && window.cocDesktop.reportIssue) || null;
  wireReportIssueModal(document, bridge);
})();`;

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';" />
<title>Report an Issue</title>
<style>
  :root { color-scheme: dark; }
  html, body { height: 100%; margin: 0; }
  body {
    display: flex;
    flex-direction: column;
    gap: 10px;
    box-sizing: border-box;
    padding: 20px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background: #0d1117;
    color: #e6edf3;
    user-select: none;
    -webkit-user-select: none;
  }
  h1 { font-size: 15px; font-weight: 600; margin: 0; }
  label { font-size: 12px; color: #8b949e; display: block; margin-bottom: 4px; }
  input, textarea {
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
  input:focus, textarea:focus { border-color: #58a6ff; }
  textarea { resize: none; font-family: inherit; }
  textarea#coc-report-description { height: 120px; }
  pre#coc-report-environment {
    margin: 0;
    padding: 8px;
    border-radius: 6px;
    border: 1px solid #30363d;
    background: #010409;
    color: #8b949e;
    font-size: 11px;
    line-height: 1.4;
    max-height: 96px;
    overflow: auto;
    white-space: pre-wrap;
    user-select: text;
    -webkit-user-select: text;
  }
  .counter { font-size: 11px; color: #6e7681; text-align: right; margin-top: 4px; }
  .notice { font-size: 11px; color: #d29922; line-height: 1.4; }
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
  button#coc-report-submit { background: #238636; border-color: #2ea043; }
  button#coc-report-submit:disabled { background: #21262d; border-color: #30363d; color: #6e7681; cursor: default; }
</style>
</head>
<body>
  <h1>Report an Issue</h1>
  <div>
    <label for="coc-report-title">Title</label>
    <input id="coc-report-title" type="text" spellcheck="false" autocomplete="off" maxlength="${REPORT_ISSUE_TITLE_MAX}" />
  </div>
  <div>
    <label for="coc-report-description">Description</label>
    <textarea id="coc-report-description" spellcheck="true"></textarea>
    <div class="counter" id="coc-report-counter">0 / ${REPORT_ISSUE_DESCRIPTION_MAX}</div>
  </div>
  <div>
    <label for="coc-report-environment">Environment (included in the report)</label>
    <pre id="coc-report-environment">${environment}</pre>
  </div>
  <div class="notice">${notice}</div>
  <div class="actions">
    <button id="coc-report-cancel" type="button">Cancel</button>
    <button id="coc-report-submit" type="button">Submit</button>
  </div>
  <script>${script}</script>
</body>
</html>`;
}

/** Build a `data:` URL for the modal document, ready for `BrowserWindow.loadURL`. */
export function reportIssueDataUrl(options: ReportIssueModalOptions): string {
    return `data:text/html;charset=utf-8,${encodeURIComponent(renderReportIssueHtml(options))}`;
}
