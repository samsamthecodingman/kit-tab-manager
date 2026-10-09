"""Runs the real host as a subprocess with a fake extension on its stdin/stdout,
then talks to it over the socket the way the MCP server does."""

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

HOST = Path(__file__).resolve().parent.parent / "host" / "tab_bridge_host.py"


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
            write_native(proc.stdin, {"id": msg["id"], "result": {"tabs": [{"id": 1, "title": "Moodle"}]}})
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
        proc = subprocess.Popen([sys.executable, str(HOST)], stdin=subprocess.PIPE, stdout=subprocess.PIPE, env=env)
        threading.Thread(target=fake_extension, args=(proc,), daemon=True).start()
        path = os.path.join(run, "tab-bridge.sock")
        for _ in range(50):
            if os.path.exists(path):
                break
            time.sleep(0.05)
        assert oct(os.stat(path).st_mode & 0o777) == "0o600"
        assert ask(path, "list_tabs") == {"result": {"tabs": [{"id": 1, "title": "Moodle"}]}}
        assert ask(path, "nope") == {"error": "unknown method nope"}
        proc.stdin.close()  # Firefox going away
        proc.wait(timeout=5)
        assert not os.path.exists(path)
