#!/usr/bin/env python3
"""
coc_chat.py — CLI helper for CoC conversation process records via REST API.

Requires a running CoC server (``coc serve``). All commands communicate with
the server's REST API.

Usage:
    python coc_chat.py <command> [args...] [options]

Query Commands:
    workspaces                                List all workspaces
    resolve-workspace <name-or-path>          Find workspace by name or rootPath substring
    list <workspaceId> [options]              List processes
    list-all [options]                        List processes across all workspaces
    show <workspaceId> <processId>            Show full process metadata + conversation
    conversation <workspaceId> <processId>    Print conversation turns only
    search <keyword> [--workspace <id>]       Search titles/previews (index-only)
    search-content <keyword> [opts]           Full-text FTS5 search across turns
                                              (--workspace, --status, --type, --since, --limit)
    tools <workspaceId> <processId>           Summarize tool usage in a process
    tokens <workspaceId> <processId>          Show token usage breakdown
    stats [workspaceId]                       Aggregate stats (counts by status/type)
    find-process <processId>                  Cross-workspace lookup by process ID
    history [--workspace <id>] [--type <t>]   Show completed/failed task history
    token-usage [--days N]                    Show aggregated token usage stats
    output <processId>                        Show raw markdown output file

Submit Commands:
    chat <prompt> [options]                   Submit a chat task
    follow-up <processId> <message> [options] Send follow-up message
    run-workflow <workflowPath> [options]      Run a YAML workflow
    run-script <script> [options]             Run a shell script
    status <processId> [options]              Check process status
    stream <processId> [options]              Stream SSE output (Ctrl+C to stop)
    models [options]                          List available AI models
    queue [options]                           Show current queue

Common options:
    --base-url <url>       Server base URL (default: http://localhost:4000)
    --workspace <id>       Workspace ID (e.g. ws-1a2b3c)
    --workdir <path>       Working directory for the AI session
    --model <model>        AI model override
    --mode <mode>          Chat mode: ask, plan, autopilot (default: autopilot)
    --timeout <seconds>    Execution timeout
    --priority <p>         Task priority: high, normal, low (default: normal)
    --json                 Output raw JSON response

Filter options (for list/list-all):
    --status <s>           Filter by status (completed, failed, running, ...)
    --type <t>             Filter by type (clarification, pipeline-execution, ...)
    --since <iso>          Only processes started after this ISO timestamp
    --limit <n>            Max results (default 20)
    --title <keyword>      Filter by title substring (case-insensitive)

Environment:
    COC_SERVER_URL         Override default server URL (http://localhost:4000)
"""

import json
import sys
import os
import urllib.request
import urllib.error
import urllib.parse
from datetime import datetime
from collections import Counter

DEFAULT_BASE_URL = os.environ.get("COC_SERVER_URL", "http://localhost:4000")


# -- HTTP Helpers --------------------------------------------------------------

def api_url(base: str, path: str) -> str:
    return f"{base.rstrip('/')}/api{path}"


def post_json(url: str, body: dict) -> dict:
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        url, data=data,
        headers={"Content-Type": "application/json"}, method="POST",
    )
    try:
        with urllib.request.urlopen(req) as resp:
            return {"status": resp.status, "body": json.loads(resp.read().decode("utf-8"))}
    except urllib.error.HTTPError as e:
        error_body = e.read().decode("utf-8") if e.fp else ""
        try:
            error_body = json.loads(error_body)
        except Exception:
            pass
        return {"status": e.code, "body": error_body, "error": str(e)}
    except urllib.error.URLError as e:
        return {
            "status": 0, "body": {},
            "error": f"Cannot connect to CoC server at {url}. Is `coc serve` running? ({e.reason})",
        }


def get_json(url: str) -> dict:
    req = urllib.request.Request(url, method="GET")
    try:
        with urllib.request.urlopen(req) as resp:
            return {"status": resp.status, "body": json.loads(resp.read().decode("utf-8"))}
    except urllib.error.HTTPError as e:
        error_body = e.read().decode("utf-8") if e.fp else ""
        try:
            error_body = json.loads(error_body)
        except Exception:
            pass
        return {"status": e.code, "body": error_body, "error": str(e)}
    except urllib.error.URLError as e:
        return {
            "status": 0, "body": {},
            "error": f"Cannot connect to CoC server at {url}. Is `coc serve` running? ({e.reason})",
        }


def require_ok(result: dict, raw_json: bool = False):
    """Check result for errors and exit if connection failed."""
    if result.get("error"):
        if raw_json:
            print(json.dumps(result, indent=2))
        else:
            print(f"Error ({result.get('status', '?')}): {result['error']}")
            body = result.get("body")
            if body and isinstance(body, (dict, list)):
                print(f"  {json.dumps(body, indent=2)}")
        sys.exit(1)


# -- Option Parsing ------------------------------------------------------------

def parse_common_opts(args: list) -> dict:
    opts = {"base_url": DEFAULT_BASE_URL, "raw_json": False}
    i = 0
    remaining = []
    while i < len(args):
        if args[i] == "--base-url" and i + 1 < len(args):
            opts["base_url"] = args[i + 1]; i += 2
        elif args[i] == "--workspace" and i + 1 < len(args):
            opts["workspace"] = args[i + 1]; i += 2
        elif args[i] == "--workdir" and i + 1 < len(args):
            opts["workdir"] = args[i + 1]; i += 2
        elif args[i] == "--model" and i + 1 < len(args):
            opts["model"] = args[i + 1]; i += 2
        elif args[i] == "--mode" and i + 1 < len(args):
            opts["mode"] = args[i + 1]; i += 2
        elif args[i] == "--timeout" and i + 1 < len(args):
            opts["timeout"] = int(args[i + 1]); i += 2
        elif args[i] == "--priority" and i + 1 < len(args):
            opts["priority"] = args[i + 1]; i += 2
        elif args[i] == "--status" and i + 1 < len(args):
            opts["status"] = args[i + 1]; i += 2
        elif args[i] == "--type" and i + 1 < len(args):
            opts["type_filter"] = args[i + 1]; i += 2
        elif args[i] == "--since" and i + 1 < len(args):
            opts["since"] = args[i + 1]; i += 2
        elif args[i] == "--limit" and i + 1 < len(args):
            opts["limit"] = int(args[i + 1]); i += 2
        elif args[i] == "--title" and i + 1 < len(args):
            opts["title"] = args[i + 1]; i += 2
        elif args[i] == "--days" and i + 1 < len(args):
            opts["days"] = int(args[i + 1]); i += 2
        elif args[i] == "--json":
            opts["raw_json"] = True; i += 1
        else:
            remaining.append(args[i]); i += 1
    opts["remaining"] = remaining
    return opts


# -- Formatting Helpers --------------------------------------------------------

def fmt_time(iso) -> str:
    if not iso:
        return "\u2014"
    try:
        s = str(iso)
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        return dt.strftime("%Y-%m-%d %H:%M")
    except Exception:
        return str(iso)[:16] if iso else "\u2014"


def fmt_duration(ms) -> str:
    if not ms:
        return "\u2014"
    secs = float(ms) / 1000
    if secs < 60:
        return f"{secs:.0f}s"
    mins = secs / 60
    if mins < 60:
        return f"{mins:.1f}m"
    return f"{mins / 60:.1f}h"


def compute_duration(entry: dict):
    """Compute duration in ms from startTime/endTime if duration field is absent."""
    if entry.get("duration"):
        return entry["duration"]
    start = entry.get("startTime")
    end = entry.get("endTime")
    if start and end:
        try:
            s = datetime.fromisoformat(str(start).replace("Z", "+00:00"))
            e = datetime.fromisoformat(str(end).replace("Z", "+00:00"))
            return int((e - s).total_seconds() * 1000)
        except Exception:
            pass
    return None


def print_index_entries(entries: list, show_workspace=False):
    if not entries:
        print("  (no matching processes)")
        return
    for e in entries:
        ws_col = f"[{(e.get('workspaceId') or '?')[:12]}] " if show_workspace else ""
        title = e.get("title") or e.get("promptPreview") or "(untitled)"
        if len(title) > 60:
            title = title[:57] + "..."
        dur = fmt_duration(compute_duration(e))
        pid = e.get("id", "?")
        print(
            f"  {ws_col}{pid[:40]:40s}  {e.get('status', '?'):10s}"
            f"  {e.get('type', '?'):20s}  {fmt_time(e.get('startTime'))}"
            f"  {dur:>6s}  {title}"
        )


def print_result(result: dict, raw_json: bool):
    if raw_json:
        print(json.dumps(result, indent=2))
        return
    status = result.get("status", "?")
    body = result.get("body", {})
    if result.get("error"):
        print(f"Error ({status}): {result['error']}")
        if body:
            print(f"  {json.dumps(body, indent=2) if isinstance(body, dict) else body}")
        sys.exit(1)
    if isinstance(body, dict):
        task = body.get("task", body)
        task_id = task.get("id", "?")
        process_id = task.get("processId", f"queue_{task_id}")
        print(f"Submitted ({status})")
        print(f"  Task ID:    {task_id}")
        print(f"  Process ID: {process_id}")
        print(f"  Status:     {task.get('status', '?')}")
        if task.get("displayName"):
            print(f"  Name:       {task['displayName']}")
    else:
        print(f"Response ({status}): {body}")


# -- Query Commands ------------------------------------------------------------

def cmd_workspaces(opts: dict):
    url = api_url(opts["base_url"], "/workspaces")
    result = get_json(url)
    if opts["raw_json"]:
        print(json.dumps(result, indent=2)); return
    require_ok(result)
    ws_list = result["body"].get("workspaces", [])
    if not ws_list:
        print("No workspaces registered.")
        return
    for w in ws_list:
        print(f"  {w['id']}  {w.get('name', '?'):30s}  {w.get('rootPath', '')}")


def cmd_resolve_workspace(query: str, opts: dict):
    url = api_url(opts["base_url"], "/workspaces")
    result = get_json(url)
    if opts["raw_json"]:
        print(json.dumps(result, indent=2)); return
    require_ok(result)
    query_lower = query.lower()
    ws_list = result["body"].get("workspaces", [])
    matches = [
        w for w in ws_list
        if query_lower in w.get("name", "").lower()
        or query_lower in w.get("rootPath", "").lower()
        or query_lower == w.get("id", "").lower()
    ]
    if not matches:
        print(f"No workspace matching '{query}'.")
        sys.exit(1)
    for w in matches:
        print(f"  {w['id']}  {w.get('name', '?')}  {w.get('rootPath', '')}")


def _build_summaries_params(opts: dict, workspace_id=None) -> dict:
    """Build query params for /api/processes/summaries from parsed opts."""
    params = {}
    ws = workspace_id or opts.get("workspace")
    if ws:
        params["workspace"] = ws
    if opts.get("status"):
        params["status"] = opts["status"]
    if opts.get("type_filter"):
        params["type"] = opts["type_filter"]
    if opts.get("since"):
        params["since"] = opts["since"]
    limit = opts.get("limit", 20)
    params["limit"] = str(limit)
    return params


def _title_filter(entries: list, opts: dict) -> list:
    """Client-side title substring filter (server doesn't support it)."""
    title_kw = opts.get("title", "").lower() if opts.get("title") else None
    if title_kw:
        entries = [
            e for e in entries
            if title_kw in (e.get("title") or e.get("promptPreview") or "").lower()
        ]
    return entries


def cmd_list(workspace_id: str, opts: dict):
    params = _build_summaries_params(opts, workspace_id)
    qs = f"?{urllib.parse.urlencode(params)}" if params else ""
    url = api_url(opts["base_url"], f"/processes/summaries{qs}")
    result = get_json(url)
    if opts["raw_json"]:
        print(json.dumps(result, indent=2)); return
    require_ok(result)
    entries = _title_filter(result["body"].get("summaries", []), opts)
    print_index_entries(entries)


def cmd_list_all(opts: dict):
    params = _build_summaries_params(opts)
    qs = f"?{urllib.parse.urlencode(params)}" if params else ""
    url = api_url(opts["base_url"], f"/processes/summaries{qs}")
    result = get_json(url)
    if opts["raw_json"]:
        print(json.dumps(result, indent=2)); return
    require_ok(result)
    entries = _title_filter(result["body"].get("summaries", []), opts)
    print_index_entries(entries, show_workspace=True)


def _fetch_process(opts: dict, process_id: str, workspace_id=None) -> dict:
    """Fetch a single process by ID, optionally scoped to a workspace."""
    params = {}
    if workspace_id:
        params["workspace"] = workspace_id
    qs = f"?{urllib.parse.urlencode(params)}" if params else ""
    encoded_id = urllib.parse.quote(process_id, safe="")
    url = api_url(opts["base_url"], f"/processes/{encoded_id}{qs}")
    return get_json(url)


def cmd_show(workspace_id: str, process_id: str, opts: dict):
    result = _fetch_process(opts, process_id, workspace_id)
    if opts["raw_json"]:
        print(json.dumps(result, indent=2)); return
    require_ok(result)
    p = result["body"].get("process", {})
    print(f"Title:     {p.get('title') or '(untitled)'}")
    print(f"ID:        {p.get('id')}")
    print(f"Status:    {p.get('status')}")
    print(f"Type:      {p.get('type')}")
    print(f"Backend:   {p.get('backend', '\u2014')}")
    print(f"Started:   {fmt_time(p.get('startTime'))}")
    print(f"Ended:     {fmt_time(p.get('endTime'))}")
    print(f"WorkDir:   {p.get('workingDirectory', '\u2014')}")
    turns = p.get("conversationTurns") or []
    print(f"Turns:     {len(turns)}")
    tl = p.get("tokenLimit")
    tc = p.get("currentTokens")
    if tl:
        print(f"Tokens:    {tc or 0:,} / {tl:,}")
    if p.get("error"):
        print(f"Error:     {p['error']}")
    print()
    if p.get("fullPrompt"):
        preview = p["fullPrompt"][:200]
        if len(p["fullPrompt"]) > 200:
            preview += "..."
        print(f"Prompt:    {preview}")
    print()
    print(f"--- Conversation ({len(turns)} turns) ---")
    for t in turns:
        role = t.get("role", "?").upper()
        ts = fmt_time(t.get("timestamp"))
        tc_list = t.get("toolCalls") or []
        tool_summary = f"  [{len(tc_list)} tool call(s)]" if tc_list else ""
        content = t.get("content", "")
        if len(content) > 500:
            content = content[:497] + "..."
        print(f"\n[{role}] {ts}{tool_summary}")
        print(content)


def cmd_conversation(workspace_id: str, process_id: str, opts: dict):
    result = _fetch_process(opts, process_id, workspace_id)
    if opts["raw_json"]:
        print(json.dumps(result, indent=2)); return
    require_ok(result)
    p = result["body"].get("process", {})
    turns = p.get("conversationTurns") or []
    if not turns:
        print("(no conversation turns)")
        return
    for t in turns:
        role = t.get("role", "?").upper()
        ts = fmt_time(t.get("timestamp"))
        print(f"\n[{role}] {ts}")
        print(t.get("content", ""))


def cmd_search(keyword: str, opts: dict):
    keyword_lower = keyword.lower()
    ws = opts.get("workspace")
    params = {"limit": "200"}
    if ws:
        params["workspace"] = ws
    qs = f"?{urllib.parse.urlencode(params)}"
    url = api_url(opts["base_url"], f"/processes/summaries{qs}")
    result = get_json(url)
    if opts["raw_json"]:
        print(json.dumps(result, indent=2)); return
    require_ok(result)
    entries = result["body"].get("summaries", [])
    matches = []
    for e in entries:
        text = (e.get("title") or "") + " " + (e.get("promptPreview") or "")
        if keyword_lower in text.lower():
            matches.append(e)
    matches.sort(key=lambda e: e.get("startTime") or "", reverse=True)
    print(f"Found {len(matches)} index match(es) for '{keyword}':")
    print_index_entries(matches[:30], show_workspace=(ws is None))


def cmd_search_content(keyword: str, opts: dict):
    # Uses the server's FTS5 full-text search endpoint:
    # GET /api/processes/search?q=<kw>&workspace=<id>&status=<s>&type=<t>&limit=<n>
    # The server returns one row per matching turn, with snippet+rank.
    params: dict = {"q": keyword}
    if opts.get("workspace"):
        params["workspace"] = opts["workspace"]
    if opts.get("status"):
        params["status"] = opts["status"]
    if opts.get("type_filter"):
        params["type"] = opts["type_filter"]
    if opts.get("since"):
        params["since"] = opts["since"]
    limit = opts.get("limit", 30)
    params["limit"] = str(limit)
    qs = f"?{urllib.parse.urlencode(params)}"
    url = api_url(opts["base_url"], f"/processes/search{qs}")
    result = get_json(url)
    if opts["raw_json"]:
        print(json.dumps(result, indent=2)); return
    require_ok(result)
    body = result["body"]
    hits = body.get("results", []) or []
    total = body.get("total", len(hits))
    if not hits:
        print(f"No content matches for '{keyword}'.")
        return
    suffix = "" if total == len(hits) else f" (showing top {len(hits)} of {total})"
    print(f"Found {total} match(es) for '{keyword}'{suffix}:")
    for r in hits:
        ws_id = r.get("workspaceId", "") or "?"
        pid = str(r.get("processId", "?"))
        title = r.get("processTitle") or r.get("promptPreview") or "(untitled)"
        if len(title) > 50:
            title = title[:47] + "..."
        snippet = (r.get("snippet") or "").replace("\n", " ").strip()
        # FTS5 wraps matches in <mark>...</mark>; strip for plain terminal output.
        snippet = snippet.replace("<mark>", "").replace("</mark>", "")
        if len(snippet) > 120:
            snippet = snippet[:117] + "..."
        print(
            f"  [{str(ws_id)[:12]}] {pid[:36]:36s}"
            f"  turn {r.get('turnIndex')} ({r.get('role')})  {title}"
        )
        if snippet:
            print(f"    {snippet}")


def cmd_tools(workspace_id: str, process_id: str, opts: dict):
    result = _fetch_process(opts, process_id, workspace_id)
    if opts["raw_json"]:
        print(json.dumps(result, indent=2)); return
    require_ok(result)
    p = result["body"].get("process", {})
    tool_counts: Counter = Counter()
    tool_statuses: Counter = Counter()
    total = 0
    for t in p.get("conversationTurns") or []:
        for tc in t.get("toolCalls") or []:
            name = tc.get("name", "unknown")
            status = tc.get("status", "unknown")
            tool_counts[name] += 1
            tool_statuses[f"{name}:{status}"] += 1
            total += 1
    print(f"Tool usage in '{p.get('title') or p.get('id')}' ({total} total calls):\n")
    for name, count in tool_counts.most_common():
        ok = tool_statuses.get(f"{name}:completed", 0)
        fail = tool_statuses.get(f"{name}:failed", 0)
        print(f"  {name:30s}  {count:>4d} calls  ({ok} ok, {fail} failed)")


def cmd_tokens(workspace_id: str, process_id: str, opts: dict):
    result = _fetch_process(opts, process_id, workspace_id)
    if opts["raw_json"]:
        print(json.dumps(result, indent=2)); return
    require_ok(result)
    p = result["body"].get("process", {})
    print(f"Token usage for '{p.get('title') or p.get('id')}':\n")
    tl = p.get("tokenLimit")
    tc = p.get("currentTokens")
    if tl:
        pct = (tc or 0) / tl * 100
        print(f"  Context window: {tc or 0:,} / {tl:,} ({pct:.1f}%)")
    cum = p.get("cumulativeTokenUsage")
    if cum:
        print(
            f"  Cumulative:     input={cum.get('inputTokens', 0):,}"
            f"  output={cum.get('outputTokens', 0):,}"
        )
    print("\n  Per-turn breakdown:")
    for t in p.get("conversationTurns") or []:
        tu = t.get("tokenUsage")
        if tu:
            print(
                f"    Turn {t.get('turnIndex', '?'):>3}"
                f"  ({t.get('role'):9s})"
                f"  in={tu.get('inputTokens', 0):>8,}"
                f"  out={tu.get('outputTokens', 0):>8,}"
            )


def cmd_stats(opts: dict):
    ws = opts.get("workspace")
    url = api_url(opts["base_url"], "/stats")
    result = get_json(url)
    if opts["raw_json"]:
        print(json.dumps(result, indent=2)); return
    require_ok(result)
    body = result["body"]
    total = body.get("totalProcesses", 0)
    by_status = body.get("byStatus", {})
    by_workspace = body.get("byWorkspace", [])
    if ws:
        ws_entry = next((w for w in by_workspace if w.get("workspaceId") == ws), None)
        scope = f"workspace {ws}"
        if ws_entry:
            print(f"Stats for {scope} ({ws_entry.get('count', 0)} processes):")
        else:
            print(f"Stats for {scope} (not found in stats)")
    else:
        print(f"Stats for all workspaces ({total} total processes):\n")
    print("  By status:")
    for s, c in sorted(by_status.items(), key=lambda x: -x[1]):
        print(f"    {s:15s}  {c:>5d}")
    if not ws:
        print("\n  By workspace:")
        for w in by_workspace:
            print(f"    {w.get('name', w.get('workspaceId', '?')):30s}  {w.get('count', 0):>5d}")


def cmd_find_process(process_id: str, opts: dict):
    result = _fetch_process(opts, process_id)
    if opts["raw_json"]:
        print(json.dumps(result, indent=2)); return
    require_ok(result)
    p = result["body"].get("process", {})
    ws = (p.get("metadata") or {}).get("workspaceId", "?")
    print(f"Found in workspace: {ws}")
    print(f"  Title:  {p.get('title') or p.get('promptPreview') or '(untitled)'}")
    print(f"  Status: {p.get('status')}")
    print(f"  Date:   {fmt_time(p.get('startTime'))}")


def cmd_history(opts: dict):
    params = {}
    if opts.get("workspace"):
        params["repoId"] = opts["workspace"]
    if opts.get("type_filter"):
        params["type"] = opts["type_filter"]
    qs = f"?{urllib.parse.urlencode(params)}" if params else ""
    url = api_url(opts["base_url"], f"/queue/history{qs}")
    result = get_json(url)
    if opts["raw_json"]:
        print(json.dumps(result, indent=2)); return
    require_ok(result)
    history = result["body"].get("history", [])
    if not history:
        print("No history entries.")
        return
    limit = opts.get("limit", 20)
    for h in history[:limit]:
        hid = str(h.get("id", "?"))[:30]
        status = h.get("status", "?")
        htype = h.get("type", "?")
        name = (h.get("displayName") or "")[:40]
        print(f"  {hid:30s}  {status:10s}  {htype:15s}  {name}")


def cmd_token_usage(opts: dict):
    params = {}
    if opts.get("days"):
        params["days"] = str(opts["days"])
    qs = f"?{urllib.parse.urlencode(params)}" if params else ""
    url = api_url(opts["base_url"], f"/stats/token-usage{qs}")
    result = get_json(url)
    if opts["raw_json"]:
        print(json.dumps(result, indent=2)); return
    require_ok(result)
    body = result["body"]
    # Server shape: { entries: [{ date, byModel: {model: TokenUsage},
    #                             dayTotal: TokenUsage }], models, generatedAt, totalDays }
    entries = body.get("entries", []) or []
    total_in = total_out = total_all = 0
    model_totals: dict = {}
    for entry in entries:
        day_total = entry.get("dayTotal") or {}
        total_in += day_total.get("inputTokens", 0) or 0
        total_out += day_total.get("outputTokens", 0) or 0
        total_all += day_total.get("totalTokens", 0) or 0
        for model, usage in (entry.get("byModel") or {}).items():
            agg = model_totals.setdefault(
                model, {"inputTokens": 0, "outputTokens": 0, "turnCount": 0},
            )
            agg["inputTokens"] += usage.get("inputTokens", 0) or 0
            agg["outputTokens"] += usage.get("outputTokens", 0) or 0
            agg["turnCount"] += usage.get("turnCount", 0) or 0
    print("Token Usage Summary:")
    print(f"  Total input:   {total_in:>12,}")
    print(f"  Total output:  {total_out:>12,}")
    print(f"  Total:         {total_all:>12,}")
    if model_totals:
        print("\n  By model:")
        for model in sorted(model_totals.keys()):
            stats = model_totals[model]
            print(
                f"    {model:30s}"
                f"  in={stats['inputTokens']:>10,}"
                f"  out={stats['outputTokens']:>10,}"
                f"  turns={stats['turnCount']}"
            )
    if entries:
        recent = entries[:10]
        print(
            f"\n  Daily breakdown ({len(entries)} day(s),"
            f" showing {len(recent)} most recent):"
        )
        for day in recent:
            day_total = day.get("dayTotal") or {}
            print(
                f"    {day.get('date', '?'):12s}"
                f"  in={day_total.get('inputTokens', 0) or 0:>10,}"
                f"  out={day_total.get('outputTokens', 0) or 0:>10,}"
            )


def cmd_output(process_id: str, opts: dict):
    params = {}
    if opts.get("workspace"):
        params["workspace"] = opts["workspace"]
    qs = f"?{urllib.parse.urlencode(params)}" if params else ""
    encoded_id = urllib.parse.quote(process_id, safe="")
    url = api_url(opts["base_url"], f"/processes/{encoded_id}/output{qs}")
    result = get_json(url)
    if opts["raw_json"]:
        print(json.dumps(result, indent=2)); return
    require_ok(result)
    content = result["body"].get("content", "")
    if not content:
        print("(no output file)")
        return
    print(content)


# -- Submit Commands -----------------------------------------------------------

def cmd_chat(prompt: str, opts: dict):
    payload: dict = {
        "kind": "chat",
        "mode": opts.get("mode", "autopilot"),
        "prompt": prompt,
    }
    if opts.get("workspace"):
        payload["workspaceId"] = opts["workspace"]
    if opts.get("workdir"):
        payload["workingDirectory"] = opts["workdir"]

    body: dict = {
        "type": "chat",
        "payload": payload,
        "config": {},
    }
    if opts.get("model"):
        body["config"]["model"] = opts["model"]
    if opts.get("timeout"):
        body["config"]["timeoutMs"] = opts["timeout"] * 1000
    if opts.get("priority"):
        body["priority"] = opts["priority"]

    result = post_json(api_url(opts["base_url"], "/queue"), body)
    print_result(result, opts["raw_json"])


def cmd_follow_up(process_id: str, message: str, opts: dict):
    params = {}
    if opts.get("workspace"):
        params["workspace"] = opts["workspace"]
    qs = f"?{urllib.parse.urlencode(params)}" if params else ""

    body: dict = {"content": message}
    if opts.get("mode"):
        body["mode"] = opts["mode"]

    encoded_id = urllib.parse.quote(process_id, safe="")
    url = api_url(opts["base_url"], f"/processes/{encoded_id}/message{qs}")
    result = post_json(url, body)
    if opts["raw_json"]:
        print(json.dumps(result, indent=2))
        return
    status = result.get("status", "?")
    resp = result.get("body", {})
    if result.get("error"):
        print(f"Error ({status}): {result['error']}")
        sys.exit(1)
    print(f"Follow-up sent ({status})")
    if isinstance(resp, dict):
        print(f"  Process ID: {resp.get('processId', process_id)}")
        print(f"  Turn Index: {resp.get('turnIndex', '?')}")


def cmd_run_workflow(workflow_path: str, opts: dict):
    payload: dict = {
        "kind": "run-workflow",
        "workflowPath": workflow_path,
        "workingDirectory": opts.get("workdir", os.getcwd()),
    }
    if opts.get("workspace"):
        payload["workspaceId"] = opts["workspace"]
    if opts.get("model"):
        payload["model"] = opts["model"]

    remaining = opts.get("remaining", [])
    if remaining:
        kv = {}
        for p in remaining:
            if "=" in p:
                k, v = p.split("=", 1)
                kv[k] = v
        if kv:
            payload["params"] = kv

    body: dict = {
        "type": "run-workflow",
        "payload": payload,
        "config": {},
    }
    if opts.get("timeout"):
        body["config"]["timeoutMs"] = opts["timeout"] * 1000
    if opts.get("priority"):
        body["priority"] = opts["priority"]

    result = post_json(api_url(opts["base_url"], "/queue"), body)
    print_result(result, opts["raw_json"])


def cmd_run_script(script: str, opts: dict):
    payload: dict = {
        "kind": "run-script",
        "script": script,
    }
    if opts.get("workdir"):
        payload["workingDirectory"] = opts["workdir"]

    body: dict = {
        "type": "run-script",
        "payload": payload,
        "config": {},
    }
    if opts.get("priority"):
        body["priority"] = opts["priority"]

    result = post_json(api_url(opts["base_url"], "/queue"), body)
    print_result(result, opts["raw_json"])


def cmd_status(process_id: str, opts: dict):
    result = _fetch_process(opts, process_id, opts.get("workspace"))
    if opts["raw_json"]:
        print(json.dumps(result, indent=2))
        return
    require_ok(result)
    p = result["body"].get("process", {})
    print(f"Title:     {p.get('title') or '(untitled)'}")
    print(f"ID:        {p.get('id')}")
    print(f"Status:    {p.get('status')}")
    print(f"Type:      {p.get('type')}")
    turns = p.get("conversationTurns") or []
    print(f"Turns:     {len(turns)}")
    if p.get("error"):
        print(f"Error:     {p['error']}")
    if p.get("result"):
        preview = p["result"][:300]
        if len(p["result"]) > 300:
            preview += "..."
        print(f"\nResult:\n{preview}")


def cmd_stream(process_id: str, opts: dict):
    params = {}
    if opts.get("workspace"):
        params["workspace"] = opts["workspace"]
    qs = f"?{urllib.parse.urlencode(params)}" if params else ""

    encoded_id = urllib.parse.quote(process_id, safe="")
    url = api_url(opts["base_url"], f"/processes/{encoded_id}/stream{qs}")
    req = urllib.request.Request(url, headers={"Accept": "text/event-stream"})
    try:
        with urllib.request.urlopen(req) as resp:
            print(f"Streaming process {process_id} (Ctrl+C to stop)...\n")
            event_type = ""
            last_status = None
            for raw_line in resp:
                line = raw_line.decode("utf-8").rstrip("\n\r")
                if line.startswith("event: "):
                    event_type = line[7:]
                elif line.startswith("data: "):
                    data_str = line[6:]
                    if event_type == "chunk":
                        try:
                            d = json.loads(data_str)
                            print(d.get("content", ""), end="", flush=True)
                        except Exception:
                            print(data_str, end="", flush=True)
                    elif event_type == "done":
                        # The server's `done` event payload is { processId } —
                        # the terminal status was delivered in a preceding
                        # `status` event, so reuse that.
                        if last_status:
                            print(f"\n\n--- Done ({last_status}) ---")
                        else:
                            print("\n\n--- Done ---")
                        break
                    elif event_type == "status":
                        try:
                            d = json.loads(data_str)
                            status = d.get("status")
                            if status:
                                last_status = status
                                print(f"\n[status: {status}]", flush=True)
                        except Exception:
                            pass
                    elif event_type in ("tool-start", "tool-complete", "tool-failed"):
                        try:
                            d = json.loads(data_str)
                            name = d.get("toolName") or d.get("name", "?")
                            if event_type == "tool-start":
                                print(f"\n  [tool: {name}]", end="", flush=True)
                            elif event_type == "tool-failed":
                                print(f" FAILED: {d.get('error', '?')}", flush=True)
                        except Exception:
                            pass
                    elif event_type == "token-usage":
                        try:
                            d = json.loads(data_str)
                            tu = d.get("tokenUsage", {})
                            if tu:
                                print(
                                    f"\n  [tokens:"
                                    f" in={tu.get('inputTokens', 0):,}"
                                    f" out={tu.get('outputTokens', 0):,}]",
                                    flush=True,
                                )
                        except Exception:
                            pass
    except KeyboardInterrupt:
        print("\n\n--- Streaming stopped ---")
    except urllib.error.HTTPError as e:
        print(f"Error ({e.code}): {e.read().decode('utf-8')}")
        sys.exit(1)
    except urllib.error.URLError as e:
        print(f"Cannot connect to CoC server. Is `coc serve` running? ({e.reason})")
        sys.exit(1)


def cmd_models(opts: dict):
    url = api_url(opts["base_url"], "/queue/models")
    result = get_json(url)
    if opts["raw_json"]:
        print(json.dumps(result, indent=2))
        return
    require_ok(result)
    models = result.get("body", {}).get("models", result.get("body", []))
    if isinstance(models, list):
        for m in models:
            if isinstance(m, dict):
                print(f"  {m.get('id', m.get('name', '?'))}")
            else:
                print(f"  {m}")
    else:
        print(json.dumps(models, indent=2))


def cmd_queue(opts: dict):
    params = {}
    if opts.get("workspace"):
        params["repoId"] = opts["workspace"]
    qs = f"?{urllib.parse.urlencode(params)}" if params else ""

    url = api_url(opts["base_url"], f"/queue{qs}")
    result = get_json(url)
    if opts["raw_json"]:
        print(json.dumps(result, indent=2))
        return
    require_ok(result)
    body = result.get("body", {})
    queued = body.get("queued", [])
    running = body.get("running", [])
    tasks = queued + running
    if not tasks:
        print("Queue is empty.")
        return
    for t in tasks:
        tid = str(t.get("id", "?"))[:30]
        status = t.get("status", "?")
        ttype = t.get("type", "?")
        name = (t.get("displayName") or "")[:40]
        print(f"  {tid:30s}  {status:10s}  {ttype:15s}  {name}")


# -- Main ---------------------------------------------------------------------

def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(0)

    cmd = sys.argv[1]
    rest = sys.argv[2:]
    opts = parse_common_opts(rest)
    positional = opts.pop("remaining", [])

    # Query commands
    if cmd == "workspaces":
        cmd_workspaces(opts)
    elif cmd == "resolve-workspace" and positional:
        cmd_resolve_workspace(positional[0], opts)
    elif cmd == "list" and positional:
        cmd_list(positional[0], opts)
    elif cmd == "list-all":
        cmd_list_all(opts)
    elif cmd == "show" and len(positional) >= 2:
        cmd_show(positional[0], positional[1], opts)
    elif cmd == "conversation" and len(positional) >= 2:
        cmd_conversation(positional[0], positional[1], opts)
    elif cmd == "search" and positional:
        cmd_search(positional[0], opts)
    elif cmd == "search-content" and positional:
        cmd_search_content(positional[0], opts)
    elif cmd == "tools" and len(positional) >= 2:
        cmd_tools(positional[0], positional[1], opts)
    elif cmd == "tokens" and len(positional) >= 2:
        cmd_tokens(positional[0], positional[1], opts)
    elif cmd == "stats":
        if positional:
            opts["workspace"] = positional[0]
        cmd_stats(opts)
    elif cmd == "find-process" and positional:
        cmd_find_process(positional[0], opts)
    elif cmd == "history":
        cmd_history(opts)
    elif cmd == "token-usage":
        cmd_token_usage(opts)
    elif cmd == "output" and positional:
        cmd_output(positional[0], opts)
    # Submit commands
    elif cmd == "chat" and positional:
        cmd_chat(" ".join(positional), opts)
    elif cmd == "follow-up" and len(positional) >= 2:
        cmd_follow_up(positional[0], " ".join(positional[1:]), opts)
    elif cmd == "run-workflow" and positional:
        cmd_run_workflow(positional[0], {**opts, "remaining": positional[1:]})
    elif cmd == "run-script" and positional:
        cmd_run_script(" ".join(positional), opts)
    elif cmd == "status" and positional:
        cmd_status(positional[0], opts)
    elif cmd == "stream" and positional:
        cmd_stream(positional[0], opts)
    elif cmd == "models":
        cmd_models(opts)
    elif cmd == "queue":
        cmd_queue(opts)
    else:
        print(__doc__)
        sys.exit(1)


if __name__ == "__main__":
    main()
