#!/usr/bin/env python3
"""Kit's MCP server, as AI assistants run it (`kit_mcp.py [--organise]`).

Each open assistant session keeps one of these running, so it is deliberately small: it passes
each JSON-RPC line to Kit's helper app (the kit.py that Firefox runs), which does the work, and
writes back the reply. If the helper isn't running (Firefox is closed), it answers with kit.py
itself, which says Firefox isn't connected for anything that needs the browser. Only the standard
library's os, socket and sys are loaded until then.
"""
import os
import socket
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ORGANISE = "--organise" in sys.argv[1:]  # only the grouping tools, for "Organise with AI"
HELLO = b'{"mcp": {"organise": true}}\n' if ORGANISE else b'{"mcp": {"organise": false}}\n'


def socket_path():
    """Where the helper listens; the same rules as kit.py's socket_path."""
    runtime = os.environ.get("XDG_RUNTIME_DIR")
    if runtime:
        return os.path.join(runtime, "tab-bridge.sock")
    base = "/tmp/tab-bridge-%d" % os.getuid()
    st = os.stat(base)  # in shared /tmp, only trust a folder that is ours alone
    if st.st_uid != os.getuid() or st.st_mode & 0o077:
        raise OSError("Kit's folder in /tmp isn't private")
    return os.path.join(base, "tab-bridge.sock")


class Relay:
    def __init__(self):
        self.stream = None
        self.kit = None

    def ask_helper(self, line):
        if self.stream is None:
            conn = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            conn.settimeout(150)  # longer than any single browser request
            conn.connect(socket_path())
            self.stream = conn.makefile("rwb")
            self.stream.write(HELLO)
        self.stream.write(line)
        self.stream.flush()
        reply = self.stream.readline()
        if not reply:
            raise OSError("the helper closed the connection")
        return reply

    def answer_here(self, line):
        """No helper: load kit.py and answer with it (it reports that Firefox isn't connected)."""
        if self.kit is None:
            sys.path.insert(0, HERE)
            import kit
            if ORGANISE:
                kit.ALLOWED_TOOLS.intersection_update(kit.ORGANISE_TOOLS)
            self.kit = kit
        json = self.kit.json
        try:
            msg = json.loads(line)
        except ValueError:
            return json.dumps({"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": "parse error"}}).encode() + b"\n"
        reply = self.kit.mcp_handle(msg) if isinstance(msg, dict) else None
        return json.dumps(reply).encode() + b"\n"

    def handle(self, line):
        try:
            return self.ask_helper(line)
        except (OSError, socket.timeout):
            if self.stream is not None:
                try:
                    self.stream.close()
                except OSError:
                    pass
                self.stream = None  # try the helper again on the next request
            return self.answer_here(line)


def main():
    relay = Relay()
    out = sys.stdout.buffer
    for line in sys.stdin.buffer:
        if not line.strip():
            continue
        if not line.endswith(b"\n"):
            line += b"\n"
        reply = relay.handle(line)
        if reply.strip() != b"null":  # notifications get no reply
            out.write(reply)
            out.flush()


if __name__ == "__main__":
    main()
