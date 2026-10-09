"""Runs kit.py for real: as the Firefox host with a fake extension on its stdin/stdout, and as the
MCP server talking to that host over the socket, the way an AI assistant would."""

import json
import os
import socket
import struct
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

KIT = Path(__file__).resolve().parent.parent / "kit.py"


def read_native(stream):
    header = stream.read(4)
    if len(header) < 4:
        return None
    (n,) = struct.unpack("<I", header)
    return json.loads(stream.read(n))


def write_native(stream, obj):
    data = json.dumps(obj).encode()
    stream.write(struct.pack("<I", len(data)) + data)
    stream.flush()


def fake_extension(proc):
    while (msg := read_native(proc.stdout)) is not None:
        if msg["method"] == "list_tabs":
            write_native(proc.stdin, {"id": msg["id"], "result": {"tabs": [{"id": 1, "title": "Example"}]}})
        else:
            write_native(proc.stdin, {"id": msg["id"], "error": f"unknown method {msg['method']}"})


def ask(path, method):
    s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    s.connect(path)
    with s, s.makefile("rwb") as f:
        f.write((json.dumps({"method": method, "params": {}}) + "\n").encode())
        f.flush()
        return json.loads(f.readline())


def test_round_trip_and_cleanup():
    with tempfile.TemporaryDirectory() as run:
        env = {**os.environ, "XDG_RUNTIME_DIR": run}
        proc = subprocess.Popen([sys.executable, str(KIT)], stdin=subprocess.PIPE, stdout=subprocess.PIPE, env=env)
        threading.Thread(target=fake_extension, args=(proc,), daemon=True).start()
        path = os.path.join(run, "tab-bridge.sock")
        for _ in range(50):
            if os.path.exists(path):
                break
            time.sleep(0.05)
        assert oct(os.stat(path).st_mode & 0o777) == "0o600"
        assert ask(path, "list_tabs") == {"result": {"tabs": [{"id": 1, "title": "Example"}]}}
        assert ask(path, "nope") == {"error": "unknown method nope"}
        proc.stdin.close()  # Firefox going away
        proc.wait(timeout=5)
        assert not os.path.exists(path)


def start_host(run):
    env = {**os.environ, "XDG_RUNTIME_DIR": run}
    proc = subprocess.Popen([sys.executable, str(KIT)], stdin=subprocess.PIPE, stdout=subprocess.PIPE, env=env)
    threading.Thread(target=fake_extension, args=(proc,), daemon=True).start()
    path = os.path.join(run, "tab-bridge.sock")
    for _ in range(50):
        if os.path.exists(path):
            break
        time.sleep(0.05)
    return proc, env


def mcp_session(env, messages):
    """Sends JSON-RPC messages to `kit.py mcp` and returns its replies, in order."""
    lines = "".join(json.dumps(m) + "\n" for m in messages)
    out = subprocess.run([sys.executable, str(KIT), "mcp"], input=lines, capture_output=True, text=True, env=env, timeout=20)
    return [json.loads(line) for line in out.stdout.splitlines()]


def test_mcp_handshake_and_tools():
    with tempfile.TemporaryDirectory() as run:
        replies = mcp_session({**os.environ, "XDG_RUNTIME_DIR": run}, [
            {"jsonrpc": "2.0", "id": 1, "method": "initialize",
             "params": {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "test", "version": "1"}}},
            {"jsonrpc": "2.0", "method": "notifications/initialized"},
            {"jsonrpc": "2.0", "id": 2, "method": "tools/list"},
            {"jsonrpc": "2.0", "id": 3, "method": "nope"},
        ])
    assert [r["id"] for r in replies] == [1, 2, 3]  # no reply to the notification
    assert replies[0]["result"]["protocolVersion"] == "2025-06-18"
    assert replies[0]["result"]["capabilities"] == {"tools": {}}
    names = [t["name"] for t in replies[1]["result"]["tools"]]
    assert names == ["list_tabs", "list_groups", "group_tabs", "ungroup_tabs", "update_group",
                     "move_tabs", "activate_tab", "close_tabs", "read_tab"]
    assert replies[2]["error"]["code"] == -32601


def test_mcp_tool_call_through_the_host():
    with tempfile.TemporaryDirectory() as run:
        proc, env = start_host(run)
        try:
            replies = mcp_session(env, [
                {"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": "list_tabs", "arguments": {}}},
                {"jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": {"name": "read_tab", "arguments": {"tab_id": 1}}},
            ])
        finally:
            proc.stdin.close()
            proc.wait(timeout=5)
    ok, failed = replies
    assert json.loads(ok["result"]["content"][0]["text"]) == {"tabs": [{"id": 1, "title": "Example"}]}
    assert failed["result"]["isError"] is True  # the fake extension doesn't know read_tab
    assert "unknown method read_tab" in failed["result"]["content"][0]["text"]


def test_mcp_tool_call_without_firefox():
    with tempfile.TemporaryDirectory() as run:
        (reply,) = mcp_session({**os.environ, "XDG_RUNTIME_DIR": run}, [
            {"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": "list_groups", "arguments": {}}},
        ])
    assert reply["result"]["isError"] is True
    assert "Firefox isn't connected" in reply["result"]["content"][0]["text"]


def load_kit():
    import importlib.util
    spec = importlib.util.spec_from_file_location("kit", KIT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_connecting_other_assistants_edits_configs_safely(tmp_path):
    kit = load_kit()
    entry = {"command": "/usr/bin/python3", "args": ["/kit.py", "mcp"]}
    config = tmp_path / "settings.json"
    config.write_text(json.dumps({"theme": "dark", "mcpServers": {"other": {"command": "x"}}}))

    assert kit.update_config(config, entry) == "connected"
    data = json.loads(config.read_text())
    assert data["theme"] == "dark" and data["mcpServers"]["other"] == {"command": "x"}  # the rest is untouched
    assert data["mcpServers"]["firefox-tabs"] == entry
    assert json.loads((tmp_path / "settings.json.before-kit").read_text())["mcpServers"] == {"other": {"command": "x"}}

    assert kit.update_config(config, entry) == "already connected"
    assert kit.update_config(config, None) == "removed"
    assert "firefox-tabs" not in json.loads(config.read_text())["mcpServers"]

    fresh = tmp_path / "new" / "mcp.json"
    fresh.parent.mkdir()
    assert kit.update_config(fresh, entry) == "connected"
    assert json.loads(fresh.read_text()) == {"mcpServers": {"firefox-tabs": entry}}

    commented = tmp_path / "commented.json"
    commented.write_text('{ // my settings\n "mcpServers": {} }')
    assert kit.update_config(commented, entry).startswith("skipped")
    assert commented.read_text() == '{ // my settings\n "mcpServers": {} }'


def test_mcp_organise_mode_only_has_grouping_tools():
    with tempfile.TemporaryDirectory() as run:
        env = {**os.environ, "XDG_RUNTIME_DIR": run}
        lines = "".join(json.dumps(m) + "\n" for m in [
            {"jsonrpc": "2.0", "id": 1, "method": "tools/list"},
            {"jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": {"name": "close_tabs", "arguments": {"tab_ids": [1]}}},
        ])
        out = subprocess.run([sys.executable, str(KIT), "mcp", "--organise"], input=lines, capture_output=True, text=True, env=env, timeout=20)
    listed, refused = [json.loads(line) for line in out.stdout.splitlines()]
    assert [t["name"] for t in listed["result"]["tools"]] == ["list_tabs", "list_groups", "group_tabs", "ungroup_tabs", "update_group", "move_tabs"]
    assert refused["error"]["code"] == -32602  # close_tabs doesn't exist in organise mode


def test_agents_status_in_an_empty_home(tmp_path, monkeypatch):
    monkeypatch.setenv("HOME", str(tmp_path))
    monkeypatch.setenv("PATH", str(tmp_path / "bin"))  # no assistants on PATH
    kit = load_kit()
    monkeypatch.setattr(kit, "find_program", lambda name: None)
    (tmp_path / ".cursor").mkdir()
    status = {a["id"]: a for a in kit.agents_status()}
    assert set(status) == {"claude", "codex", "hermes", "gemini", "cursor", "windsurf", "claude-desktop"}
    assert status["cursor"]["installed"] and not status["cursor"]["connected"]
    assert not status["claude"]["installed"]
    assert {i for i, a in status.items() if a["can_organise"]} == {"claude", "codex", "hermes"}
    ok, message = kit.connect_agent(kit.AGENTS_BY_ID["cursor"], "/usr/bin/python3")
    assert ok and message.startswith("connected")
    assert {a["id"]: a for a in kit.agents_status()}["cursor"]["connected"]
