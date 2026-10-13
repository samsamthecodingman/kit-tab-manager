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


def test_sign_in_status_and_sign_in(tmp_path, monkeypatch):
    # A stand-in Claude Code that starts signed out and signs in when asked.
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    flag = tmp_path / "signed-in"
    fake = bin_dir / "claude"
    fake.write_text(f"""#!/bin/sh
case "$1 $2" in
  "auth status") [ -f {flag} ] && echo '{{"loggedIn": true}}' || echo '{{"loggedIn": false}}';;
  "auth login") touch {flag};;
esac
""")
    fake.chmod(0o755)
    monkeypatch.setenv("HOME", str(tmp_path))
    kit = load_kit()
    monkeypatch.setattr(kit, "find_program", lambda name: str(fake) if name == "claude" else None)
    claude = kit.AGENTS_BY_ID["claude"]
    assert kit.signed_in(claude) is False
    assert {a["id"]: a for a in kit.agents_status()}["claude"]["can_sign_in"]
    assert kit.sign_in(claude) == (True, "Signed in to Claude Code.")
    assert kit.signed_in(claude) is True
    assert kit.signed_in(kit.AGENTS_BY_ID["cursor"]) is None  # Kit can't tell for apps


def test_find_program_falls_back_to_the_claude_apps_bundled_claude_code(tmp_path, monkeypatch):
    monkeypatch.setenv("HOME", str(tmp_path))
    monkeypatch.setenv("PATH", str(tmp_path / "bin"))
    kit = load_kit()
    monkeypatch.setattr(kit.shutil, "which", lambda name, path=None: None)  # nothing on PATH (or in /usr/bin)
    assert kit.find_program("claude") is None
    app = tmp_path / "Library/Application Support/Claude" if sys.platform == "darwin" else tmp_path / ".config/Claude"
    for version in ("2.1.9", "2.1.284", "2.0.500"):
        binary = app / "claude-code" / version / "claude"
        binary.parent.mkdir(parents=True)
        binary.write_text("#!/bin/sh\n")
        binary.chmod(0o755)
    (app / "claude-code" / "3.0.0").mkdir()  # no binary in it: ignored
    assert kit.find_program("claude") == str(app / "claude-code/2.1.284/claude")  # numeric order, not 2.1.9
    assert kit.find_program("codex") is None  # only claude has a bundled copy
    monkeypatch.setattr(kit.shutil, "which", lambda name, path=None: "/opt/bin/claude")
    assert kit.find_program("claude") == "/opt/bin/claude"  # a claude on PATH wins


def test_agents_status_says_which_model_and_what_is_experimental(tmp_path, monkeypatch):
    monkeypatch.setenv("HOME", str(tmp_path))
    kit = load_kit()
    monkeypatch.setattr(kit, "find_program", lambda name: None)
    status = {a["id"]: a for a in kit.agents_status()}
    assert status["claude"]["model"] == "Sonnet"
    assert all(a["model"] is None for i, a in status.items() if i != "claude")
    assert {i for i, a in status.items() if a["experimental"]} == {"codex", "hermes"}


def fake_assistants(tmp_path, monkeypatch):
    """Stand-in Cursor and Claude Desktop folders, and no CLI assistants; returns (kit, cursor config)."""
    monkeypatch.setenv("HOME", str(tmp_path))
    monkeypatch.setenv("XDG_DATA_HOME", str(tmp_path / "data"))
    kit = load_kit()
    monkeypatch.setattr(kit, "find_program", lambda name: None)
    (tmp_path / ".cursor").mkdir()
    (tmp_path / ".gemini").mkdir()
    return kit, tmp_path / ".cursor" / "mcp.json"


def test_register_is_short_by_default_and_detailed_when_verbose(tmp_path, monkeypatch, capsys):
    kit, cursor = fake_assistants(tmp_path, monkeypatch)
    kit.register_assistants("/usr/bin/python3", yes=True)
    out = capsys.readouterr().out
    assert out.splitlines() == ["✓ Gemini CLI ready", "✓ Cursor ready"]
    assert str(tmp_path) not in out and "mcp" not in out
    kit.register_assistants("/usr/bin/python3", yes=True, verbose=True)
    out = capsys.readouterr().out
    assert f"already connected ({cursor})" in out


def test_register_dry_run_changes_nothing(tmp_path, monkeypatch, capsys):
    kit, cursor = fake_assistants(tmp_path, monkeypatch)
    kit.register_assistants("/usr/bin/python3", dry_run=True)
    out = capsys.readouterr().out
    assert "Would connect Kit to Cursor" in out and str(cursor) in out
    assert not cursor.exists() and not (tmp_path / ".gemini" / "settings.json").exists()


def test_register_asks_once_and_a_no_changes_nothing(tmp_path, monkeypatch, capsys):
    kit, cursor = fake_assistants(tmp_path, monkeypatch)
    questions = []
    monkeypatch.setattr(kit, "ask", lambda q, default=True: questions.append(q) or False)
    kit.register_assistants("/usr/bin/python3")
    assert questions == ["Connect Kit to Gemini CLI and Cursor?"]
    assert not cursor.exists()
    monkeypatch.setattr(kit, "ask", lambda q, default=True: None)  # no terminal: goes ahead, and says so
    kit.register_assistants("/usr/bin/python3")
    assert "No terminal to ask on" in capsys.readouterr().out and cursor.exists()


def test_register_only_offers_sign_in_to_assistants_that_connected(tmp_path, monkeypatch, capsys):
    kit, _ = fake_assistants(tmp_path, monkeypatch)
    claude = kit.AGENTS_BY_ID["claude"]
    monkeypatch.setitem(claude, "installed", lambda: True)
    monkeypatch.setitem(claude, "connect", lambda python, remove: (False, "couldn't update Claude Code"))
    monkeypatch.setitem(claude, "signed_in", lambda: False)
    questions = []
    monkeypatch.setattr(kit, "ask", lambda q, default=True: questions.append(q) or False)
    kit.register_assistants("/usr/bin/python3", yes=True)
    out = capsys.readouterr().out
    assert "! Claude Code couldn't be connected" in out and "sign in" not in out.lower() and not questions
    monkeypatch.setitem(claude, "connect", lambda python, remove: (True, "connected"))
    kit.register_assistants("/usr/bin/python3", yes=True)
    assert "! Claude Code is connected but needs you to sign in" in capsys.readouterr().out
    assert questions == ["Sign in to Claude Code now? It opens your browser."]


def test_unregister_lists_leftovers_and_deletes_only_when_asked(tmp_path, monkeypatch, capsys):
    kit, cursor = fake_assistants(tmp_path, monkeypatch)
    kit.register_assistants("/usr/bin/python3", yes=True)
    backup = cursor.with_name("mcp.json.before-kit")
    cursor.write_text(json.dumps({"mcpServers": {"firefox-tabs": {"command": "x"}}}))
    backup.write_text("{}")
    kit.DATA_DIR.mkdir(parents=True)
    (kit.DATA_DIR / "organise.log").write_text("")
    monkeypatch.setattr(kit, "ask", lambda q, default=True: None)  # no terminal: only prints the commands
    kit.register_assistants("/usr/bin/python3", remove=True, yes=True)
    out = capsys.readouterr().out
    assert f"rm {backup}" in out and f"rm -rf {kit.DATA_DIR}" in out and backup.exists() and kit.DATA_DIR.exists()
    monkeypatch.setattr(kit, "ask", lambda q, default=True: (q == "Delete these too?" and default is False) and False)
    kit.register_assistants("/usr/bin/python3", remove=True, yes=True)
    assert backup.exists()  # declined
    monkeypatch.setattr(kit, "ask", lambda q, default=True: True)
    kit.register_assistants("/usr/bin/python3", remove=True, yes=True)
    assert not backup.exists() and not kit.DATA_DIR.exists()
