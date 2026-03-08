---
name: browser-test-with-restart
description: Debug and verify web UI issues by opening pages in a real browser, checking for errors, applying code fixes, restarting the coc dev server, and re-testing. Use when the user asks to debug a web page, verify a UI fix in the browser, or test a localhost page after code changes.
---

# Browser Test with Server Restart

Workflow for debugging SPA dashboard issues end-to-end: inspect the page in a real browser, fix code, rebuild, restart the server, and verify the fix.

## Project context

- SPA source: `packages/coc/src/server/spa/client/react/`
- Client build: `npm run build:client` (in `packages/coc/`)
- Copy to dist: `npm run build:copy-client` (in `packages/coc/`)
- Server restart: `POST http://localhost:4000/api/admin/restart`
- Default port: 4000

## Workflow

### 1. Open the page and capture initial state

Use the `browser-use` subagent to navigate to the URL:

- Take a screenshot
- Check the browser console for JavaScript errors (`PAGE ERROR` and `CONSOLE ERROR` events)
- Report what is visible and any errors found

```
Example subagent prompt:

Navigate to <URL> and take a screenshot.
Report:
1. What you see on the page (describe the screenshot)
2. Any JavaScript errors in the browser console
3. The full URL in the address bar
```

### 2. Diagnose from browser evidence

- **Blank page / crash** → JS error in console; stack trace points to the broken component
- **Wrong content rendered** → routing or conditional rendering mismatch
- **Missing data** → API call failure, missing props, or race condition
- **Layout broken** → CSS classes or responsive breakpoints

### 3. Apply the code fix

Fix the source files under `packages/coc/src/server/spa/client/react/`.

### 4. Rebuild and restart

```bash
cd packages/coc
npm run build:client
npm run build:copy-client
```

Then restart the server and wait for it to come back:

```bash
curl -s -X POST http://localhost:4000/api/admin/restart
sleep 10
```

Verify the server is up by hitting any lightweight endpoint:

```bash
curl -s http://localhost:4000/api/queue
```

### 5. Verify the fix in the browser

Use the `browser-use` subagent again to revisit the same URL:

- Take a screenshot
- Confirm **zero** JavaScript errors in the console
- Describe what the page now shows

Compare before/after to confirm the fix.

### 6. Iterate if needed

If the browser still shows issues, capture the new errors and loop back to step 2.

## Tips

- **Always rebuild before restarting.** The server serves the bundled SPA from `dist/`; a restart alone won't pick up source changes.
- **Check console errors first.** A blank page is almost always a JS crash — the error message and stack trace are the fastest path to the root cause.
- **Clean up browser artifacts.** The browser subagent may create screenshot files or helper scripts in the workspace. Remove them before committing.
- **Test cold-load deep links.** Navigate directly to the URL rather than clicking through the UI — deep-linked pages may have race conditions that only appear on initial load.
