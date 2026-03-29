#!/usr/bin/env python3
"""
coc_chat.py — CLI helper for accessing CoC conversation process records on disk.

Usage:
    python coc_chat.py workspaces                          List all workspaces
    python coc_chat.py resolve-workspace <name-or-path>    Find workspace by name or rootPath substring
    python coc_chat.py list <workspaceId> [options]        List processes from index
    python coc_chat.py list-all [options]                  List processes across all workspaces
    python coc_chat.py show <workspaceId> <processId>      Show full process metadata + conversation
    python coc_chat.py conversation <workspaceId> <processId>  Print conversation turns only
    python coc_chat.py search <keyword> [--workspace <id>] Search titles/previews across indices
    python coc_chat.py search-content <keyword> [--workspace <id>]  Search inside conversation content
    python coc_chat.py tools <workspaceId> <processId>     Summarize tool usage in a process
    python coc_chat.py tokens <workspaceId> <processId>    Show token usage breakdown
    python coc_chat.py stats [workspaceId]                 Aggregate stats (counts by status/type)
    python coc_chat.py find-process <processId>            Cross-workspace lookup by process ID

Common options for list/list-all:
    --status <s>       Filter by status (completed, failed, running, ...)
    --type <t>         Filter by type (clarification, pipeline-execution, ...)
    --since <iso>      Only processes started after this ISO timestamp
    --limit <n>        Max results (default 20)
    --title <keyword>  Filter by title substring (case-insensitive)
"""

import json
import sys
import os
import re
from pathlib import Path
from datetime import datetime
from collections import Counter

DATA_DIR = Path(os.environ.get("COC_DATA_DIR", Path.home() / ".coc"))
REPOS_DIR = DATA_DIR / "repos"


def load_json(path: Path):
    if not path.exists():
        return None
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def sanitize_id(process_id: str) -> str:
    return re.sub(r"[^a-zA-Z0-9\-_]", "_", process_id)


def iter_workspace_dirs():
    if not REPOS_DIR.is_dir():
        return
    for d in sorted(REPOS_DIR.iterdir()):
        if d.is_dir() and (d / "processes" / "index.json").exists():
            yield d.name, d / "processes"


def load_workspaces():
    ws_file = DATA_DIR / "workspaces.json"
    return load_json(ws_file) or []


def fmt_time(iso: str | None) -> str:
    if not iso:
        return "—"
    try:
        dt = datetime.fromisoformat(iso.replace("Z", "+00:00"))
        return dt.strftime("%Y-%m-%d %H:%M")
    except Exception:
        return iso[:16] if iso else "—"


def fmt_duration(ms: int | None) -> str:
    if not ms:
        return "—"
    secs = ms / 1000
    if secs < 60:
        return f"{secs:.0f}s"
    mins = secs / 60
    if mins < 60:
        return f"{mins:.1f}m"
    return f"{mins / 60:.1f}h"


def load_index(proc_dir: Path) -> list:
    return load_json(proc_dir / "index.json") or []


def load_process(proc_dir: Path, process_id: str):
    path = proc_dir / f"{sanitize_id(process_id)}.json"
    return load_json(path)


# ── Commands ──────────────────────────────────────────────────────────────────

def cmd_workspaces():
    ws_list = load_workspaces()
    if not ws_list:
        print("No workspaces registered.")
        return
    for w in ws_list:
        proc_dir = REPOS_DIR / w["id"] / "processes"
        count = len(load_index(proc_dir)) if proc_dir.exists() else 0
        print(f"  {w['id']}  {w.get('name', '?'):30s}  {count:>4d} chats  {w.get('rootPath', '')}")


def cmd_resolve_workspace(query: str):
    query_lower = query.lower()
    ws_list = load_workspaces()
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


def apply_filters(entries: list, args: list) -> list:
    status = type_filter = since = title_kw = None
    limit = 20
    i = 0
    while i < len(args):
        if args[i] == "--status" and i + 1 < len(args):
            status = args[i + 1]; i += 2
        elif args[i] == "--type" and i + 1 < len(args):
            type_filter = args[i + 1]; i += 2
        elif args[i] == "--since" and i + 1 < len(args):
            since = args[i + 1]; i += 2
        elif args[i] == "--limit" and i + 1 < len(args):
            limit = int(args[i + 1]); i += 2
        elif args[i] == "--title" and i + 1 < len(args):
            title_kw = args[i + 1].lower(); i += 2
        else:
            i += 1

    if status:
        entries = [e for e in entries if e.get("status") == status]
    if type_filter:
        entries = [e for e in entries if e.get("type") == type_filter]
    if since:
        entries = [e for e in entries if (e.get("startTime") or "") >= since]
    if title_kw:
        entries = [e for e in entries if title_kw in (e.get("title") or e.get("promptPreview") or "").lower()]

    entries.sort(key=lambda e: e.get("startTime") or "", reverse=True)
    return entries[:limit]


def print_index_entries(entries: list, show_workspace=False):
    if not entries:
        print("  (no matching processes)")
        return
    for e in entries:
        ws_col = f"[{e.get('workspaceId', '?')[:12]}] " if show_workspace else ""
        title = e.get("title") or e.get("promptPreview") or "(untitled)"
        if len(title) > 60:
            title = title[:57] + "..."
        dur = fmt_duration(e.get("duration"))
        print(f"  {ws_col}{e['id'][:40]:40s}  {e.get('status', '?'):10s}  {e.get('type', '?'):20s}  {fmt_time(e.get('startTime'))}  {dur:>6s}  {title}")


def cmd_list(workspace_id: str, extra_args: list):
    proc_dir = REPOS_DIR / workspace_id / "processes"
    entries = load_index(proc_dir)
    entries = apply_filters(entries, extra_args)
    print_index_entries(entries)


def cmd_list_all(extra_args: list):
    all_entries = []
    for ws_id, proc_dir in iter_workspace_dirs():
        for e in load_index(proc_dir):
            e["workspaceId"] = ws_id
            all_entries.append(e)
    all_entries = apply_filters(all_entries, extra_args)
    print_index_entries(all_entries, show_workspace=True)


def cmd_show(workspace_id: str, process_id: str):
    proc_dir = REPOS_DIR / workspace_id / "processes"
    data = load_process(proc_dir, process_id)
    if not data:
        print(f"Process {process_id} not found in workspace {workspace_id}.")
        sys.exit(1)
    p = data.get("process", {})
    print(f"Title:     {p.get('title') or '(untitled)'}")
    print(f"ID:        {p.get('id')}")
    print(f"Status:    {p.get('status')}")
    print(f"Type:      {p.get('type')}")
    print(f"Backend:   {p.get('backend', '—')}")
    print(f"Started:   {fmt_time(p.get('startTime'))}")
    print(f"Ended:     {fmt_time(p.get('endTime'))}")
    print(f"WorkDir:   {p.get('workingDirectory', '—')}")
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


def cmd_conversation(workspace_id: str, process_id: str):
    proc_dir = REPOS_DIR / workspace_id / "processes"
    data = load_process(proc_dir, process_id)
    if not data:
        print(f"Process {process_id} not found.")
        sys.exit(1)
    p = data.get("process", {})
    turns = p.get("conversationTurns") or []
    if not turns:
        print("(no conversation turns)")
        return
    for t in turns:
        role = t.get("role", "?").upper()
        ts = fmt_time(t.get("timestamp"))
        print(f"\n[{role}] {ts}")
        print(t.get("content", ""))


def cmd_search(keyword: str, workspace_id: str | None):
    keyword_lower = keyword.lower()
    results = []
    dirs = (
        [(workspace_id, REPOS_DIR / workspace_id / "processes")]
        if workspace_id
        else list(iter_workspace_dirs())
    )
    for ws_id, proc_dir in dirs:
        for e in load_index(proc_dir):
            text = (e.get("title") or "") + " " + (e.get("promptPreview") or "")
            if keyword_lower in text.lower():
                e["workspaceId"] = ws_id
                results.append(e)
    results.sort(key=lambda e: e.get("startTime") or "", reverse=True)
    print(f"Found {len(results)} index match(es) for '{keyword}':")
    print_index_entries(results[:30], show_workspace=(workspace_id is None))


def cmd_search_content(keyword: str, workspace_id: str | None):
    keyword_lower = keyword.lower()
    hits = []
    dirs = (
        [(workspace_id, REPOS_DIR / workspace_id / "processes")]
        if workspace_id
        else list(iter_workspace_dirs())
    )
    for ws_id, proc_dir in dirs:
        if not proc_dir.is_dir():
            continue
        for f in proc_dir.glob("*.json"):
            if f.name == "index.json":
                continue
            try:
                data = load_json(f)
                if not data:
                    continue
                p = data.get("process", {})
                for t in p.get("conversationTurns") or []:
                    if keyword_lower in (t.get("content") or "").lower():
                        title = p.get("title") or p.get("promptPreview") or "(untitled)"
                        hits.append((ws_id, p.get("id"), title, t.get("turnIndex"), t.get("role")))
                        break
            except Exception:
                continue
    print(f"Found {len(hits)} process(es) with content matching '{keyword}':")
    for ws_id, pid, title, turn_idx, role in hits[:30]:
        if len(title) > 50:
            title = title[:47] + "..."
        print(f"  [{ws_id[:12]}] {pid[:36]:36s}  turn {turn_idx} ({role})  {title}")


def cmd_tools(workspace_id: str, process_id: str):
    proc_dir = REPOS_DIR / workspace_id / "processes"
    data = load_process(proc_dir, process_id)
    if not data:
        print(f"Process {process_id} not found.")
        sys.exit(1)
    p = data.get("process", {})
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


def cmd_tokens(workspace_id: str, process_id: str):
    proc_dir = REPOS_DIR / workspace_id / "processes"
    data = load_process(proc_dir, process_id)
    if not data:
        print(f"Process {process_id} not found.")
        sys.exit(1)
    p = data.get("process", {})
    print(f"Token usage for '{p.get('title') or p.get('id')}':\n")
    tl = p.get("tokenLimit")
    tc = p.get("currentTokens")
    if tl:
        pct = (tc or 0) / tl * 100
        print(f"  Context window: {tc or 0:,} / {tl:,} ({pct:.1f}%)")
    cum = p.get("cumulativeTokenUsage")
    if cum:
        print(f"  Cumulative:     input={cum.get('inputTokens', 0):,}  output={cum.get('outputTokens', 0):,}")
    print(f"\n  Per-turn breakdown:")
    for t in p.get("conversationTurns") or []:
        tu = t.get("tokenUsage")
        if tu:
            print(f"    Turn {t.get('turnIndex', '?'):>3}  ({t.get('role'):9s})  in={tu.get('inputTokens', 0):>8,}  out={tu.get('outputTokens', 0):>8,}")


def cmd_stats(workspace_id: str | None):
    dirs = (
        [(workspace_id, REPOS_DIR / workspace_id / "processes")]
        if workspace_id
        else list(iter_workspace_dirs())
    )
    status_counts: Counter = Counter()
    type_counts: Counter = Counter()
    total = 0
    for _, proc_dir in dirs:
        for e in load_index(proc_dir):
            status_counts[e.get("status", "unknown")] += 1
            type_counts[e.get("type", "unknown")] += 1
            total += 1
    scope = f"workspace {workspace_id}" if workspace_id else "all workspaces"
    print(f"Stats for {scope} ({total} total processes):\n")
    print("  By status:")
    for s, c in status_counts.most_common():
        print(f"    {s:15s}  {c:>5d}")
    print("\n  By type:")
    for t, c in type_counts.most_common():
        print(f"    {t:25s}  {c:>5d}")


def cmd_find_process(process_id: str):
    for ws_id, proc_dir in iter_workspace_dirs():
        for e in load_index(proc_dir):
            if e.get("id") == process_id:
                print(f"Found in workspace: {ws_id}")
                print(f"  Title:  {e.get('title') or e.get('promptPreview') or '(untitled)'}")
                print(f"  Status: {e.get('status')}")
                print(f"  Date:   {fmt_time(e.get('startTime'))}")
                print(f"  File:   {proc_dir / (sanitize_id(process_id) + '.json')}")
                return
    print(f"Process {process_id} not found in any workspace.")
    sys.exit(1)


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(0)

    cmd = sys.argv[1]

    if cmd == "workspaces":
        cmd_workspaces()
    elif cmd == "resolve-workspace" and len(sys.argv) >= 3:
        cmd_resolve_workspace(sys.argv[2])
    elif cmd == "list" and len(sys.argv) >= 3:
        cmd_list(sys.argv[2], sys.argv[3:])
    elif cmd == "list-all":
        cmd_list_all(sys.argv[2:])
    elif cmd == "show" and len(sys.argv) >= 4:
        cmd_show(sys.argv[2], sys.argv[3])
    elif cmd == "conversation" and len(sys.argv) >= 4:
        cmd_conversation(sys.argv[2], sys.argv[3])
    elif cmd == "search" and len(sys.argv) >= 3:
        ws = None
        if "--workspace" in sys.argv:
            idx = sys.argv.index("--workspace")
            ws = sys.argv[idx + 1]
        cmd_search(sys.argv[2], ws)
    elif cmd == "search-content" and len(sys.argv) >= 3:
        ws = None
        if "--workspace" in sys.argv:
            idx = sys.argv.index("--workspace")
            ws = sys.argv[idx + 1]
        cmd_search_content(sys.argv[2], ws)
    elif cmd == "tools" and len(sys.argv) >= 4:
        cmd_tools(sys.argv[2], sys.argv[3])
    elif cmd == "tokens" and len(sys.argv) >= 4:
        cmd_tokens(sys.argv[2], sys.argv[3])
    elif cmd == "stats":
        cmd_stats(sys.argv[2] if len(sys.argv) >= 3 else None)
    elif cmd == "find-process" and len(sys.argv) >= 3:
        cmd_find_process(sys.argv[2])
    else:
        print(__doc__)
        sys.exit(1)


if __name__ == "__main__":
    main()
