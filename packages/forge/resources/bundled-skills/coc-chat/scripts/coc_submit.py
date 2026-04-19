#!/usr/bin/env python3
"""
coc_submit.py — CLI helper for submitting tasks to a running CoC server via REST API.

Usage:
    python coc_submit.py chat <prompt> [options]           Submit a chat task
    python coc_submit.py follow-up <processId> <message> [options]  Send follow-up message
    python coc_submit.py run-workflow <workflowPath> [options]      Run a YAML workflow
    python coc_submit.py run-script <script> [options]              Run a shell script
    python coc_submit.py status <processId> [options]      Check process status
    python coc_submit.py stream <processId> [options]      Stream SSE output (Ctrl+C to stop)
    python coc_submit.py models [options]                  List available AI models
    python coc_submit.py queue [options]                   Show current queue

Common options:
    --base-url <url>       Server base URL (default: http://localhost:4000)
    --workspace <id>       Workspace ID (e.g. ws-1a2b3c)
    --workdir <path>       Working directory for the AI session
    --model <model>        AI model override
    --mode <mode>          Chat mode: ask, plan, autopilot (default: autopilot)
    --timeout <seconds>    Execution timeout
    --priority <p>         Task priority: high, normal, low (default: normal)
    --json                 Output raw JSON response
"""

import json
import sys
import os
import urllib.request
import urllib.error
import urllib.parse

DEFAULT_BASE_URL = os.environ.get("COC_SERVER_URL", "http://localhost:4000")


def api_url(base: str, path: str) -> str:
    return f"{base.rstrip('/')}/api{path}"


def post_json(url: str, body: dict) -> dict:
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"}, method="POST")
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
        return {"status": 0, "body": {}, "error": f"Connection failed: {e.reason}"}


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
        return {"status": 0, "body": {}, "error": f"Connection failed: {e.reason}"}


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
        elif args[i] == "--json":
            opts["raw_json"] = True; i += 1
        else:
            remaining.append(args[i]); i += 1
    opts["remaining"] = remaining
    return opts


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


# ── Commands ──────────────────────────────────────────────────────────────────

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

    url = api_url(opts["base_url"], f"/processes/{process_id}/message{qs}")
    result = post_json(url, body)
    if opts["raw_json"]:
        print(json.dumps(result, indent=2))
    else:
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

    params = opts.get("remaining", [])
    if params:
        kv = {}
        for p in params:
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
    params = {}
    if opts.get("workspace"):
        params["workspace"] = opts["workspace"]
    qs = f"?{urllib.parse.urlencode(params)}" if params else ""

    url = api_url(opts["base_url"], f"/processes/{process_id}{qs}")
    result = get_json(url)
    if opts["raw_json"]:
        print(json.dumps(result, indent=2))
        return
    if result.get("error"):
        print(f"Error ({result['status']}): {result['error']}")
        sys.exit(1)
    p = result.get("body", {})
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

    url = api_url(opts["base_url"], f"/processes/{process_id}/stream{qs}")
    req = urllib.request.Request(url, headers={"Accept": "text/event-stream"})
    try:
        with urllib.request.urlopen(req) as resp:
            print(f"Streaming process {process_id} (Ctrl+C to stop)...\n")
            event_type = ""
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
                        try:
                            d = json.loads(data_str)
                            print(f"\n\n--- Done ({d.get('status', '?')}) ---")
                        except Exception:
                            print(f"\n\n--- Done ---")
                        break
                    elif event_type == "status":
                        try:
                            d = json.loads(data_str)
                            print(f"\n[status: {d.get('status', '?')}]", flush=True)
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
                                print(f"\n  [tokens: in={tu.get('inputTokens', 0):,} out={tu.get('outputTokens', 0):,}]", flush=True)
                        except Exception:
                            pass
    except KeyboardInterrupt:
        print("\n\n--- Streaming stopped ---")
    except urllib.error.HTTPError as e:
        print(f"Error ({e.code}): {e.read().decode('utf-8')}")
        sys.exit(1)
    except urllib.error.URLError as e:
        print(f"Connection failed: {e.reason}")
        sys.exit(1)


def cmd_models(opts: dict):
    url = api_url(opts["base_url"], "/queue/models")
    result = get_json(url)
    if opts["raw_json"]:
        print(json.dumps(result, indent=2))
        return
    if result.get("error"):
        print(f"Error ({result['status']}): {result['error']}")
        sys.exit(1)
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
    if result.get("error"):
        print(f"Error ({result['status']}): {result['error']}")
        sys.exit(1)
    body = result.get("body", {})
    tasks = body.get("tasks", body if isinstance(body, list) else [])
    if not tasks:
        print("Queue is empty.")
        return
    for t in tasks:
        tid = t.get("id", "?")[:30]
        status = t.get("status", "?")
        ttype = t.get("type", "?")
        name = t.get("displayName", "")[:40]
        print(f"  {tid:30s}  {status:10s}  {ttype:15s}  {name}")


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(0)

    cmd = sys.argv[1]
    rest = sys.argv[2:]
    opts = parse_common_opts(rest)
    positional = opts.pop("remaining", [])

    if cmd == "chat" and positional:
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
