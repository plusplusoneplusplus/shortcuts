#!/usr/bin/env python3
"""
Tests for the unified coc_chat.py CLI helper.

Covers: HTTP helpers, option parsing, formatting, query commands, submit commands,
connectivity checks, and the CLI dispatch.
"""

import json
import os
import sys
import unittest
from io import StringIO
from unittest.mock import patch, MagicMock
from urllib.error import URLError, HTTPError

# Add scripts dir to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__)))

import coc_chat


# -- Test Fixtures -------------------------------------------------------------

MOCK_WORKSPACES = {
    "workspaces": [
        {"id": "ws-abc123", "name": "my-project", "rootPath": "/home/user/my-project", "isGitRepo": True},
        {"id": "ws-def456", "name": "other-repo", "rootPath": "/home/user/other-repo", "isGitRepo": False},
    ]
}

MOCK_SUMMARIES = {
    "summaries": [
        {
            "id": "clarification-1-123456",
            "status": "completed",
            "type": "clarification",
            "startTime": "2026-03-23T10:15:00.000Z",
            "endTime": "2026-03-23T10:17:30.000Z",
            "promptPreview": "Explain how workflows work",
            "title": "Workflow Architecture",
            "workspaceId": "ws-abc123",
        },
        {
            "id": "pipeline-2-789012",
            "status": "failed",
            "type": "pipeline-execution",
            "startTime": "2026-03-22T08:00:00.000Z",
            "promptPreview": "Run pipeline",
            "title": "Pipeline Run",
            "workspaceId": "ws-abc123",
        },
    ],
    "total": 2,
    "limit": 20,
    "offset": 0,
}

MOCK_PROCESS = {
    "process": {
        "id": "clarification-1-123456",
        "type": "clarification",
        "status": "completed",
        "title": "Workflow Architecture",
        "fullPrompt": "Explain how workflows work in this codebase",
        "startTime": "2026-03-23T10:15:00.000Z",
        "endTime": "2026-03-23T10:17:30.000Z",
        "backend": "copilot-sdk",
        "workingDirectory": "/home/user/my-project",
        "tokenLimit": 200000,
        "currentTokens": 45000,
        "metadata": {"type": "clarification", "workspaceId": "ws-abc123"},
        "cumulativeTokenUsage": {"inputTokens": 10000, "outputTokens": 5000},
        "conversationTurns": [
            {
                "role": "user",
                "content": "Explain how workflows work",
                "timestamp": "2026-03-23T10:15:00.000Z",
                "turnIndex": 0,
                "toolCalls": [],
                "tokenUsage": {"inputTokens": 100, "outputTokens": 0},
            },
            {
                "role": "assistant",
                "content": "Workflows are DAG-based execution graphs...",
                "timestamp": "2026-03-23T10:16:00.000Z",
                "turnIndex": 1,
                "toolCalls": [
                    {"name": "read_file", "status": "completed"},
                    {"name": "read_file", "status": "completed"},
                    {"name": "grep", "status": "failed"},
                ],
                "tokenUsage": {"inputTokens": 5000, "outputTokens": 3000},
            },
        ],
    },
    "children": [],
    "total": 0,
}

MOCK_STATS = {
    "totalProcesses": 42,
    "byStatus": {"completed": 30, "failed": 8, "running": 2, "cancelled": 2, "queued": 0},
    "byWorkspace": [
        {"workspaceId": "ws-abc123", "name": "my-project", "count": 30},
        {"workspaceId": "ws-def456", "name": "other-repo", "count": 12},
    ],
}

MOCK_HISTORY = {
    "history": [
        {"id": "task-1", "status": "completed", "type": "chat", "displayName": "My Chat"},
        {"id": "task-2", "status": "failed", "type": "run-workflow", "displayName": "Pipeline"},
    ]
}

MOCK_TOKEN_USAGE = {
    "entries": [
        {
            "date": "2026-03-23",
            "byModel": {
                "gpt-4": {
                    "inputTokens": 30000,
                    "outputTokens": 12000,
                    "totalTokens": 42000,
                    "turnCount": 6,
                },
                "claude-sonnet": {
                    "inputTokens": 10000,
                    "outputTokens": 5000,
                    "totalTokens": 15000,
                    "turnCount": 3,
                },
            },
            "dayTotal": {
                "inputTokens": 40000,
                "outputTokens": 17000,
                "totalTokens": 57000,
                "turnCount": 9,
            },
        },
        {
            "date": "2026-03-22",
            "byModel": {
                "gpt-4": {
                    "inputTokens": 10000,
                    "outputTokens": 3000,
                    "totalTokens": 13000,
                    "turnCount": 4,
                },
            },
            "dayTotal": {
                "inputTokens": 10000,
                "outputTokens": 3000,
                "totalTokens": 13000,
                "turnCount": 4,
            },
        },
    ],
    "models": ["claude-sonnet", "gpt-4"],
    "generatedAt": "2026-03-23T11:00:00.000Z",
    "totalDays": 2,
}

MOCK_SEARCH_RESULTS = {
    "results": [
        {
            "processId": "queue_proc-1",
            "turnIndex": 2,
            "role": "user",
            "snippet": "Explain the <mark>DAG</mark> executor pipeline",
            "rank": -3.14,
            "processTitle": "Workflow DAG Discussion",
            "promptPreview": "Walk me through the DAG executor",
            "processStatus": "completed",
            "processType": "chat",
            "workspaceId": "ws-abc123",
            "startTime": "2026-03-23T10:15:00.000Z",
        },
        {
            "processId": "queue_proc-2",
            "turnIndex": 0,
            "role": "user",
            "snippet": "What is the <mark>DAG</mark>?",
            "rank": -2.0,
            "processTitle": None,
            "promptPreview": "DAG question",
            "processStatus": "completed",
            "processType": "chat",
            "workspaceId": "ws-abc123",
            "startTime": "2026-03-22T08:00:00.000Z",
        },
    ],
    "total": 2,
    "query": "DAG",
    "limit": 30,
    "offset": 0,
}

MOCK_OUTPUT = {"content": "# Conversation Output\n\nHello world", "format": "markdown"}

MOCK_QUEUE_SUBMIT = {"task": {"id": "t-1", "processId": "queue_t-1", "status": "queued", "displayName": "Test"}}

MOCK_QUEUE_LIST = {
    "queued": [{"id": "t-1", "status": "queued", "type": "chat", "displayName": "Task 1"}],
    "running": [{"id": "t-2", "status": "running", "type": "run-workflow", "displayName": "Task 2"}],
    "stats": {},
}

MOCK_MODELS = {"models": [{"id": "gpt-4"}, {"id": "claude-sonnet"}]}


def _mock_get_json(responses: dict):
    """Create a mock get_json that returns different responses based on URL patterns."""
    def mock_fn(url: str) -> dict:
        for pattern, response in responses.items():
            if pattern in url:
                return {"status": 200, "body": response}
        return {"status": 404, "body": {}, "error": "Not found"}
    return mock_fn


def _mock_post_json(response: dict):
    def mock_fn(url: str, body: dict) -> dict:
        return {"status": 201, "body": response}
    return mock_fn


# -- Tests: Helpers ------------------------------------------------------------

class TestApiUrl(unittest.TestCase):
    def test_basic(self):
        self.assertEqual(coc_chat.api_url("http://localhost:4000", "/workspaces"),
                         "http://localhost:4000/api/workspaces")

    def test_trailing_slash(self):
        self.assertEqual(coc_chat.api_url("http://localhost:4000/", "/stats"),
                         "http://localhost:4000/api/stats")


class TestFmtTime(unittest.TestCase):
    def test_none(self):
        self.assertEqual(coc_chat.fmt_time(None), "\u2014")

    def test_iso_string(self):
        result = coc_chat.fmt_time("2026-03-23T10:15:00.000Z")
        self.assertIn("2026", result)
        self.assertIn("10:15", result)

    def test_invalid(self):
        result = coc_chat.fmt_time("not-a-date")
        self.assertEqual(result, "not-a-date")


class TestFmtDuration(unittest.TestCase):
    def test_none(self):
        self.assertEqual(coc_chat.fmt_duration(None), "\u2014")

    def test_seconds(self):
        self.assertEqual(coc_chat.fmt_duration(30000), "30s")

    def test_minutes(self):
        self.assertEqual(coc_chat.fmt_duration(150000), "2.5m")

    def test_hours(self):
        self.assertEqual(coc_chat.fmt_duration(7200000), "2.0h")


class TestComputeDuration(unittest.TestCase):
    def test_has_duration(self):
        self.assertEqual(coc_chat.compute_duration({"duration": 5000}), 5000)

    def test_computes_from_times(self):
        entry = {
            "startTime": "2026-03-23T10:00:00.000Z",
            "endTime": "2026-03-23T10:02:30.000Z",
        }
        self.assertEqual(coc_chat.compute_duration(entry), 150000)

    def test_missing_times(self):
        self.assertIsNone(coc_chat.compute_duration({}))


class TestParseCommonOpts(unittest.TestCase):
    def test_defaults(self):
        opts = coc_chat.parse_common_opts([])
        self.assertEqual(opts["base_url"], coc_chat.DEFAULT_BASE_URL)
        self.assertFalse(opts["raw_json"])
        self.assertEqual(opts["remaining"], [])

    def test_all_flags(self):
        opts = coc_chat.parse_common_opts([
            "--base-url", "http://custom:9000",
            "--workspace", "ws-test",
            "--workdir", "/tmp",
            "--model", "gpt-4",
            "--mode", "ask",
            "--timeout", "60",
            "--priority", "high",
            "--status", "completed",
            "--type", "clarification",
            "--since", "2026-01-01",
            "--limit", "10",
            "--title", "workflow",
            "--days", "7",
            "--json",
            "positional-arg",
        ])
        self.assertEqual(opts["base_url"], "http://custom:9000")
        self.assertEqual(opts["workspace"], "ws-test")
        self.assertEqual(opts["workdir"], "/tmp")
        self.assertEqual(opts["model"], "gpt-4")
        self.assertEqual(opts["mode"], "ask")
        self.assertEqual(opts["timeout"], 60)
        self.assertEqual(opts["priority"], "high")
        self.assertEqual(opts["status"], "completed")
        self.assertEqual(opts["type_filter"], "clarification")
        self.assertEqual(opts["since"], "2026-01-01")
        self.assertEqual(opts["limit"], 10)
        self.assertEqual(opts["title"], "workflow")
        self.assertEqual(opts["days"], 7)
        self.assertTrue(opts["raw_json"])
        self.assertEqual(opts["remaining"], ["positional-arg"])


class TestRequireOk(unittest.TestCase):
    def test_no_error_passes(self):
        # Should not raise
        coc_chat.require_ok({"status": 200, "body": {}})

    def test_error_exits(self):
        with self.assertRaises(SystemExit):
            coc_chat.require_ok({"status": 0, "error": "Connection failed", "body": {}})


# -- Tests: Connection Check ---------------------------------------------------

class TestConnectionError(unittest.TestCase):
    @patch("coc_chat.get_json")
    def test_connection_error_message(self, mock_get):
        mock_get.return_value = {
            "status": 0, "body": {},
            "error": "Cannot connect to CoC server at http://localhost:4000/api/workspaces. Is `coc serve` running? (Connection refused)",
        }
        opts = {"base_url": "http://localhost:4000", "raw_json": False}
        captured = StringIO()
        with patch("sys.stdout", captured), self.assertRaises(SystemExit):
            coc_chat.cmd_workspaces(opts)
        output = captured.getvalue()
        self.assertIn("Cannot connect", output)
        self.assertIn("coc serve", output)


# -- Tests: Query Commands -----------------------------------------------------

class TestCmdWorkspaces(unittest.TestCase):
    @patch("coc_chat.get_json")
    def test_lists_workspaces(self, mock_get):
        mock_get.return_value = {"status": 200, "body": MOCK_WORKSPACES}
        opts = {"base_url": "http://localhost:4000", "raw_json": False}
        captured = StringIO()
        with patch("sys.stdout", captured):
            coc_chat.cmd_workspaces(opts)
        output = captured.getvalue()
        self.assertIn("ws-abc123", output)
        self.assertIn("my-project", output)
        self.assertIn("ws-def456", output)

    @patch("coc_chat.get_json")
    def test_empty_workspaces(self, mock_get):
        mock_get.return_value = {"status": 200, "body": {"workspaces": []}}
        opts = {"base_url": "http://localhost:4000", "raw_json": False}
        captured = StringIO()
        with patch("sys.stdout", captured):
            coc_chat.cmd_workspaces(opts)
        self.assertIn("No workspaces", captured.getvalue())

    @patch("coc_chat.get_json")
    def test_json_output(self, mock_get):
        mock_get.return_value = {"status": 200, "body": MOCK_WORKSPACES}
        opts = {"base_url": "http://localhost:4000", "raw_json": True}
        captured = StringIO()
        with patch("sys.stdout", captured):
            coc_chat.cmd_workspaces(opts)
        parsed = json.loads(captured.getvalue())
        self.assertIn("body", parsed)


class TestCmdResolveWorkspace(unittest.TestCase):
    @patch("coc_chat.get_json")
    def test_finds_by_name(self, mock_get):
        mock_get.return_value = {"status": 200, "body": MOCK_WORKSPACES}
        opts = {"base_url": "http://localhost:4000", "raw_json": False}
        captured = StringIO()
        with patch("sys.stdout", captured):
            coc_chat.cmd_resolve_workspace("my-project", opts)
        self.assertIn("ws-abc123", captured.getvalue())

    @patch("coc_chat.get_json")
    def test_no_match_exits(self, mock_get):
        mock_get.return_value = {"status": 200, "body": MOCK_WORKSPACES}
        opts = {"base_url": "http://localhost:4000", "raw_json": False}
        with self.assertRaises(SystemExit):
            coc_chat.cmd_resolve_workspace("nonexistent", opts)


class TestCmdList(unittest.TestCase):
    @patch("coc_chat.get_json")
    def test_lists_processes(self, mock_get):
        mock_get.return_value = {"status": 200, "body": MOCK_SUMMARIES}
        opts = {"base_url": "http://localhost:4000", "raw_json": False, "limit": 20}
        captured = StringIO()
        with patch("sys.stdout", captured):
            coc_chat.cmd_list("ws-abc123", opts)
        output = captured.getvalue()
        self.assertIn("clarification-1-123456", output)
        self.assertIn("completed", output)

    @patch("coc_chat.get_json")
    def test_title_filter(self, mock_get):
        mock_get.return_value = {"status": 200, "body": MOCK_SUMMARIES}
        opts = {"base_url": "http://localhost:4000", "raw_json": False, "limit": 20, "title": "Pipeline"}
        captured = StringIO()
        with patch("sys.stdout", captured):
            coc_chat.cmd_list("ws-abc123", opts)
        output = captured.getvalue()
        self.assertIn("Pipeline Run", output)
        self.assertNotIn("Workflow Architecture", output)

    @patch("coc_chat.get_json")
    def test_sends_correct_params(self, mock_get):
        mock_get.return_value = {"status": 200, "body": MOCK_SUMMARIES}
        opts = {
            "base_url": "http://localhost:4000", "raw_json": False,
            "limit": 5, "status": "completed", "type_filter": "clarification",
            "since": "2026-01-01",
        }
        coc_chat.cmd_list("ws-abc123", opts)
        url = mock_get.call_args[0][0]
        self.assertIn("workspace=ws-abc123", url)
        self.assertIn("limit=5", url)
        self.assertIn("status=completed", url)
        self.assertIn("type=clarification", url)
        self.assertIn("since=2026-01-01", url)


class TestCmdShow(unittest.TestCase):
    @patch("coc_chat.get_json")
    def test_shows_process(self, mock_get):
        mock_get.return_value = {"status": 200, "body": MOCK_PROCESS}
        opts = {"base_url": "http://localhost:4000", "raw_json": False}
        captured = StringIO()
        with patch("sys.stdout", captured):
            coc_chat.cmd_show("ws-abc123", "clarification-1-123456", opts)
        output = captured.getvalue()
        self.assertIn("Workflow Architecture", output)
        self.assertIn("completed", output)
        self.assertIn("copilot-sdk", output)
        self.assertIn("45,000 / 200,000", output)
        self.assertIn("--- Conversation (2 turns) ---", output)
        self.assertIn("[USER]", output)
        self.assertIn("[ASSISTANT]", output)


class TestCmdConversation(unittest.TestCase):
    @patch("coc_chat.get_json")
    def test_prints_turns(self, mock_get):
        mock_get.return_value = {"status": 200, "body": MOCK_PROCESS}
        opts = {"base_url": "http://localhost:4000", "raw_json": False}
        captured = StringIO()
        with patch("sys.stdout", captured):
            coc_chat.cmd_conversation("ws-abc123", "clarification-1-123456", opts)
        output = captured.getvalue()
        self.assertIn("[USER]", output)
        self.assertIn("Explain how workflows work", output)
        self.assertIn("[ASSISTANT]", output)
        self.assertIn("DAG-based", output)


class TestCmdSearch(unittest.TestCase):
    @patch("coc_chat.get_json")
    def test_finds_matching(self, mock_get):
        mock_get.return_value = {"status": 200, "body": MOCK_SUMMARIES}
        opts = {"base_url": "http://localhost:4000", "raw_json": False}
        captured = StringIO()
        with patch("sys.stdout", captured):
            coc_chat.cmd_search("workflow", opts)
        output = captured.getvalue()
        self.assertIn("1 index match", output)
        self.assertIn("Workflow Architecture", output)

    @patch("coc_chat.get_json")
    def test_no_matches(self, mock_get):
        mock_get.return_value = {"status": 200, "body": MOCK_SUMMARIES}
        opts = {"base_url": "http://localhost:4000", "raw_json": False}
        captured = StringIO()
        with patch("sys.stdout", captured):
            coc_chat.cmd_search("nonexistent-term-xyz", opts)
        self.assertIn("0 index match", captured.getvalue())


class TestCmdSearchContent(unittest.TestCase):
    @patch("coc_chat.get_json")
    def test_finds_content_match(self, mock_get):
        mock_get.return_value = {"status": 200, "body": MOCK_SEARCH_RESULTS}
        opts = {"base_url": "http://localhost:4000", "raw_json": False}
        captured = StringIO()
        with patch("sys.stdout", captured):
            coc_chat.cmd_search_content("DAG", opts)
        output = captured.getvalue()
        self.assertIn("2 match(es)", output)
        self.assertIn("queue_proc-1", output)
        self.assertIn("turn 2 (user)", output)
        self.assertIn("Workflow DAG Discussion", output)
        self.assertIn("Explain the DAG executor pipeline", output)
        # <mark> tags should be stripped for terminal output
        self.assertNotIn("<mark>", output)

    @patch("coc_chat.get_json")
    def test_hits_fts5_endpoint_with_filters(self, mock_get):
        mock_get.return_value = {"status": 200, "body": {"results": [], "total": 0}}
        opts = {
            "base_url": "http://localhost:4000",
            "raw_json": False,
            "workspace": "ws-abc123",
            "status": "completed",
            "type_filter": "chat",
            "limit": 5,
        }
        with patch("sys.stdout", StringIO()):
            coc_chat.cmd_search_content("foo bar", opts)
        called_url = mock_get.call_args[0][0]
        self.assertIn("/api/processes/search?", called_url)
        self.assertIn("q=foo+bar", called_url)
        self.assertIn("workspace=ws-abc123", called_url)
        self.assertIn("status=completed", called_url)
        self.assertIn("type=chat", called_url)
        self.assertIn("limit=5", called_url)

    @patch("coc_chat.get_json")
    def test_no_matches(self, mock_get):
        mock_get.return_value = {"status": 200, "body": {"results": [], "total": 0}}
        opts = {"base_url": "http://localhost:4000", "raw_json": False}
        captured = StringIO()
        with patch("sys.stdout", captured):
            coc_chat.cmd_search_content("nope", opts)
        self.assertIn("No content matches", captured.getvalue())


class TestCmdTools(unittest.TestCase):
    @patch("coc_chat.get_json")
    def test_summarizes_tools(self, mock_get):
        mock_get.return_value = {"status": 200, "body": MOCK_PROCESS}
        opts = {"base_url": "http://localhost:4000", "raw_json": False}
        captured = StringIO()
        with patch("sys.stdout", captured):
            coc_chat.cmd_tools("ws-abc123", "clarification-1-123456", opts)
        output = captured.getvalue()
        self.assertIn("3 total calls", output)
        self.assertIn("read_file", output)
        self.assertIn("2 ok", output)
        self.assertIn("grep", output)
        self.assertIn("1 failed", output)


class TestCmdTokens(unittest.TestCase):
    @patch("coc_chat.get_json")
    def test_shows_token_usage(self, mock_get):
        mock_get.return_value = {"status": 200, "body": MOCK_PROCESS}
        opts = {"base_url": "http://localhost:4000", "raw_json": False}
        captured = StringIO()
        with patch("sys.stdout", captured):
            coc_chat.cmd_tokens("ws-abc123", "clarification-1-123456", opts)
        output = captured.getvalue()
        self.assertIn("Context window:", output)
        self.assertIn("45,000", output)
        self.assertIn("200,000", output)
        self.assertIn("Cumulative:", output)
        self.assertIn("Per-turn breakdown:", output)


class TestCmdStats(unittest.TestCase):
    @patch("coc_chat.get_json")
    def test_all_workspaces(self, mock_get):
        mock_get.return_value = {"status": 200, "body": MOCK_STATS}
        opts = {"base_url": "http://localhost:4000", "raw_json": False}
        captured = StringIO()
        with patch("sys.stdout", captured):
            coc_chat.cmd_stats(opts)
        output = captured.getvalue()
        self.assertIn("42 total processes", output)
        self.assertIn("completed", output)
        self.assertIn("30", output)
        self.assertIn("By workspace:", output)

    @patch("coc_chat.get_json")
    def test_single_workspace(self, mock_get):
        mock_get.return_value = {"status": 200, "body": MOCK_STATS}
        opts = {"base_url": "http://localhost:4000", "raw_json": False, "workspace": "ws-abc123"}
        captured = StringIO()
        with patch("sys.stdout", captured):
            coc_chat.cmd_stats(opts)
        output = captured.getvalue()
        self.assertIn("workspace ws-abc123", output)
        self.assertIn("30 processes", output)


class TestCmdFindProcess(unittest.TestCase):
    @patch("coc_chat.get_json")
    def test_finds_process(self, mock_get):
        mock_get.return_value = {"status": 200, "body": MOCK_PROCESS}
        opts = {"base_url": "http://localhost:4000", "raw_json": False}
        captured = StringIO()
        with patch("sys.stdout", captured):
            coc_chat.cmd_find_process("clarification-1-123456", opts)
        output = captured.getvalue()
        self.assertIn("Found in workspace:", output)
        self.assertIn("Workflow Architecture", output)


class TestCmdHistory(unittest.TestCase):
    @patch("coc_chat.get_json")
    def test_shows_history(self, mock_get):
        mock_get.return_value = {"status": 200, "body": MOCK_HISTORY}
        opts = {"base_url": "http://localhost:4000", "raw_json": False, "limit": 20}
        captured = StringIO()
        with patch("sys.stdout", captured):
            coc_chat.cmd_history(opts)
        output = captured.getvalue()
        self.assertIn("task-1", output)
        self.assertIn("My Chat", output)
        self.assertIn("completed", output)

    @patch("coc_chat.get_json")
    def test_empty_history(self, mock_get):
        mock_get.return_value = {"status": 200, "body": {"history": []}}
        opts = {"base_url": "http://localhost:4000", "raw_json": False, "limit": 20}
        captured = StringIO()
        with patch("sys.stdout", captured):
            coc_chat.cmd_history(opts)
        self.assertIn("No history", captured.getvalue())


class TestCmdTokenUsage(unittest.TestCase):
    @patch("coc_chat.get_json")
    def test_shows_token_usage(self, mock_get):
        mock_get.return_value = {"status": 200, "body": MOCK_TOKEN_USAGE}
        opts = {"base_url": "http://localhost:4000", "raw_json": False}
        captured = StringIO()
        with patch("sys.stdout", captured):
            coc_chat.cmd_token_usage(opts)
        output = captured.getvalue()
        self.assertIn("Token Usage Summary:", output)
        # Totals are summed across all entries' dayTotal.
        self.assertIn("50,000", output)   # total input  (40k + 10k)
        self.assertIn("20,000", output)   # total output (17k + 3k)
        self.assertIn("70,000", output)   # total tokens (57k + 13k)
        # Per-model section aggregates across days.
        self.assertIn("gpt-4", output)
        self.assertIn("40,000", output)   # gpt-4 input (30k + 10k)
        self.assertIn("claude-sonnet", output)
        # Daily breakdown lists each date.
        self.assertIn("Daily breakdown", output)
        self.assertIn("2026-03-23", output)
        self.assertIn("2026-03-22", output)

    @patch("coc_chat.get_json")
    def test_empty_entries(self, mock_get):
        mock_get.return_value = {
            "status": 200,
            "body": {"entries": [], "models": [], "totalDays": 0, "generatedAt": "x"},
        }
        opts = {"base_url": "http://localhost:4000", "raw_json": False}
        captured = StringIO()
        with patch("sys.stdout", captured):
            coc_chat.cmd_token_usage(opts)
        output = captured.getvalue()
        self.assertIn("Token Usage Summary:", output)
        self.assertIn("Total input:              0", output)
        self.assertNotIn("By model:", output)
        self.assertNotIn("Daily breakdown", output)

    @patch("coc_chat.get_json")
    def test_days_param_forwarded(self, mock_get):
        mock_get.return_value = {
            "status": 200,
            "body": {"entries": [], "models": [], "totalDays": 0, "generatedAt": "x"},
        }
        opts = {"base_url": "http://localhost:4000", "raw_json": False, "days": 7}
        with patch("sys.stdout", StringIO()):
            coc_chat.cmd_token_usage(opts)
        called_url = mock_get.call_args[0][0]
        self.assertIn("/api/stats/token-usage?days=7", called_url)


class TestCmdOutput(unittest.TestCase):
    @patch("coc_chat.get_json")
    def test_shows_output(self, mock_get):
        mock_get.return_value = {"status": 200, "body": MOCK_OUTPUT}
        opts = {"base_url": "http://localhost:4000", "raw_json": False}
        captured = StringIO()
        with patch("sys.stdout", captured):
            coc_chat.cmd_output("clarification-1-123456", opts)
        output = captured.getvalue()
        self.assertIn("# Conversation Output", output)
        self.assertIn("Hello world", output)

    @patch("coc_chat.get_json")
    def test_no_output(self, mock_get):
        mock_get.return_value = {"status": 200, "body": {"content": ""}}
        opts = {"base_url": "http://localhost:4000", "raw_json": False}
        captured = StringIO()
        with patch("sys.stdout", captured):
            coc_chat.cmd_output("some-id", opts)
        self.assertIn("no output file", captured.getvalue())


# -- Tests: Submit Commands ----------------------------------------------------

class TestCmdChat(unittest.TestCase):
    @patch("coc_chat.post_json")
    def test_submits_chat(self, mock_post):
        mock_post.return_value = {"status": 201, "body": MOCK_QUEUE_SUBMIT}
        opts = {
            "base_url": "http://localhost:4000", "raw_json": False,
            "mode": "ask", "workspace": "ws-abc123",
        }
        captured = StringIO()
        with patch("sys.stdout", captured):
            coc_chat.cmd_chat("Hello world", opts)
        output = captured.getvalue()
        self.assertIn("Submitted (201)", output)
        self.assertIn("queue_t-1", output)
        # Verify payload
        call_body = mock_post.call_args[0][1]
        self.assertEqual(call_body["payload"]["prompt"], "Hello world")
        self.assertEqual(call_body["payload"]["mode"], "ask")
        self.assertEqual(call_body["payload"]["workspaceId"], "ws-abc123")


class TestCmdFollowUp(unittest.TestCase):
    @patch("coc_chat.post_json")
    def test_sends_follow_up(self, mock_post):
        mock_post.return_value = {"status": 202, "body": {"processId": "p-1", "turnIndex": 3}}
        opts = {"base_url": "http://localhost:4000", "raw_json": False, "workspace": "ws-abc123"}
        captured = StringIO()
        with patch("sys.stdout", captured):
            coc_chat.cmd_follow_up("p-1", "What about DAG?", opts)
        output = captured.getvalue()
        self.assertIn("Follow-up sent (202)", output)
        self.assertIn("Turn Index: 3", output)


class TestCmdStatus(unittest.TestCase):
    @patch("coc_chat.get_json")
    def test_shows_status_with_envelope(self, mock_get):
        """Test that cmd_status correctly reads body.process (envelope fix)."""
        mock_get.return_value = {"status": 200, "body": MOCK_PROCESS}
        opts = {"base_url": "http://localhost:4000", "raw_json": False, "workspace": "ws-abc123"}
        captured = StringIO()
        with patch("sys.stdout", captured):
            coc_chat.cmd_status("clarification-1-123456", opts)
        output = captured.getvalue()
        self.assertIn("Workflow Architecture", output)
        self.assertIn("completed", output)
        self.assertIn("Turns:     2", output)


class TestCmdQueue(unittest.TestCase):
    @patch("coc_chat.get_json")
    def test_shows_queue(self, mock_get):
        mock_get.return_value = {"status": 200, "body": MOCK_QUEUE_LIST}
        opts = {"base_url": "http://localhost:4000", "raw_json": False}
        captured = StringIO()
        with patch("sys.stdout", captured):
            coc_chat.cmd_queue(opts)
        output = captured.getvalue()
        self.assertIn("t-1", output)
        self.assertIn("queued", output)
        self.assertIn("t-2", output)
        self.assertIn("running", output)

    @patch("coc_chat.get_json")
    def test_empty_queue(self, mock_get):
        mock_get.return_value = {"status": 200, "body": {"queued": [], "running": []}}
        opts = {"base_url": "http://localhost:4000", "raw_json": False}
        captured = StringIO()
        with patch("sys.stdout", captured):
            coc_chat.cmd_queue(opts)
        self.assertIn("Queue is empty", captured.getvalue())


class TestCmdModels(unittest.TestCase):
    @patch("coc_chat.get_json")
    def test_lists_models(self, mock_get):
        mock_get.return_value = {"status": 200, "body": MOCK_MODELS}
        opts = {"base_url": "http://localhost:4000", "raw_json": False}
        captured = StringIO()
        with patch("sys.stdout", captured):
            coc_chat.cmd_models(opts)
        output = captured.getvalue()
        self.assertIn("gpt-4", output)
        self.assertIn("claude-sonnet", output)


def _sse_response(events):
    """Build a fake urlopen() return value yielding SSE lines for the given (event, data) pairs."""
    lines = []
    for event_type, data in events:
        if event_type:
            lines.append(f"event: {event_type}\n".encode("utf-8"))
        if data is not None:
            lines.append(f"data: {json.dumps(data)}\n".encode("utf-8"))
        lines.append(b"\n")
    fake = MagicMock()
    fake.__enter__.return_value = iter(lines)
    fake.__exit__.return_value = False
    return fake


class TestCmdStream(unittest.TestCase):
    @patch("coc_chat.urllib.request.urlopen")
    def test_uses_last_status_for_done_line(self, mock_urlopen):
        """`done` event payload is just {processId} now — the displayed status
        must come from the most recent `status` event, not the done payload."""
        mock_urlopen.return_value = _sse_response([
            ("chunk", {"content": "hello "}),
            ("chunk", {"content": "world"}),
            ("status", {"status": "completed"}),
            ("done", {"processId": "queue_x"}),
        ])
        opts = {"base_url": "http://localhost:4000", "raw_json": False}
        captured = StringIO()
        with patch("sys.stdout", captured):
            coc_chat.cmd_stream("queue_x", opts)
        output = captured.getvalue()
        self.assertIn("hello world", output)
        self.assertIn("[status: completed]", output)
        self.assertIn("--- Done (completed) ---", output)
        self.assertNotIn("(?)", output)

    @patch("coc_chat.urllib.request.urlopen")
    def test_done_without_prior_status(self, mock_urlopen):
        mock_urlopen.return_value = _sse_response([
            ("chunk", {"content": "x"}),
            ("done", {"processId": "queue_y"}),
        ])
        opts = {"base_url": "http://localhost:4000", "raw_json": False}
        captured = StringIO()
        with patch("sys.stdout", captured):
            coc_chat.cmd_stream("queue_y", opts)
        output = captured.getvalue()
        self.assertIn("--- Done ---", output)
        self.assertNotIn("Done (", output)


class TestCmdRunWorkflow(unittest.TestCase):
    @patch("coc_chat.post_json")
    def test_submits_workflow(self, mock_post):
        mock_post.return_value = {"status": 201, "body": MOCK_QUEUE_SUBMIT}
        opts = {
            "base_url": "http://localhost:4000", "raw_json": False,
            "workspace": "ws-abc123", "remaining": ["key1=val1", "key2=val2"],
        }
        captured = StringIO()
        with patch("sys.stdout", captured):
            coc_chat.cmd_run_workflow("/path/to/workflow", opts)
        call_body = mock_post.call_args[0][1]
        self.assertEqual(call_body["payload"]["workflowPath"], "/path/to/workflow")
        self.assertEqual(call_body["payload"]["params"], {"key1": "val1", "key2": "val2"})


class TestCmdRunScript(unittest.TestCase):
    @patch("coc_chat.post_json")
    def test_submits_script(self, mock_post):
        mock_post.return_value = {"status": 201, "body": MOCK_QUEUE_SUBMIT}
        opts = {"base_url": "http://localhost:4000", "raw_json": False}
        captured = StringIO()
        with patch("sys.stdout", captured):
            coc_chat.cmd_run_script("npm test", opts)
        call_body = mock_post.call_args[0][1]
        self.assertEqual(call_body["payload"]["script"], "npm test")


# -- Tests: Main Dispatch -----------------------------------------------------

class TestMainDispatch(unittest.TestCase):
    @patch("coc_chat.get_json")
    def test_workspaces_dispatch(self, mock_get):
        mock_get.return_value = {"status": 200, "body": MOCK_WORKSPACES}
        captured = StringIO()
        with patch("sys.argv", ["coc_chat.py", "workspaces"]), \
             patch("sys.stdout", captured):
            coc_chat.main()
        self.assertIn("ws-abc123", captured.getvalue())

    @patch("coc_chat.get_json")
    def test_list_dispatch(self, mock_get):
        mock_get.return_value = {"status": 200, "body": MOCK_SUMMARIES}
        captured = StringIO()
        with patch("sys.argv", ["coc_chat.py", "list", "ws-abc123", "--limit", "5"]), \
             patch("sys.stdout", captured):
            coc_chat.main()
        self.assertIn("clarification-1-123456", captured.getvalue())

    @patch("coc_chat.get_json")
    def test_stats_with_workspace_arg(self, mock_get):
        mock_get.return_value = {"status": 200, "body": MOCK_STATS}
        captured = StringIO()
        with patch("sys.argv", ["coc_chat.py", "stats", "ws-abc123"]), \
             patch("sys.stdout", captured):
            coc_chat.main()
        self.assertIn("workspace ws-abc123", captured.getvalue())

    @patch("coc_chat.post_json")
    def test_chat_dispatch(self, mock_post):
        mock_post.return_value = {"status": 201, "body": MOCK_QUEUE_SUBMIT}
        captured = StringIO()
        with patch("sys.argv", ["coc_chat.py", "chat", "Hello", "world"]), \
             patch("sys.stdout", captured):
            coc_chat.main()
        call_body = mock_post.call_args[0][1]
        self.assertEqual(call_body["payload"]["prompt"], "Hello world")

    def test_no_args_shows_help(self):
        with patch("sys.argv", ["coc_chat.py"]), \
             self.assertRaises(SystemExit) as cm:
            coc_chat.main()
        self.assertEqual(cm.exception.code, 0)

    def test_unknown_command_exits(self):
        with patch("sys.argv", ["coc_chat.py", "unknown-cmd"]), \
             self.assertRaises(SystemExit) as cm:
            coc_chat.main()
        self.assertEqual(cm.exception.code, 1)


if __name__ == "__main__":
    unittest.main()
