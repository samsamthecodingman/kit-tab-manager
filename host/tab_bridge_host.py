#!/usr/bin/env python3
"""Native messaging host for the Tab Bridge extension.

Firefox starts this program when the extension connects, and talks to it over
stdin/stdout (a 4-byte little-endian length, then UTF-8 JSON). The host also
listens on a Unix socket that only this user can open; the MCP server sends
one JSON request per line there and gets one JSON reply per line back.
The host forwards each request to the extension and relays the answer.

Standard library only: Firefox runs this with the system python3.
"""

from __future__ import annotations

import json
import os
import socket
import struct
import sys
import threading
import itertools

REQUEST_TIMEOUT = 60.0


def socket_path() -> str:
    base = os.environ.get("XDG_RUNTIME_DIR") or f"/tmp/tab-bridge-{os.getuid()}"
    os.makedirs(base, mode=0o700, exist_ok=True)
    return os.path.join(base, "tab-bridge.sock")


class Bridge:
    def __init__(self, inp, out):
        self._in, self._out = inp, out
        self._write_lock = threading.Lock()
        self._pending: dict[int, tuple[threading.Event, list]] = {}
        self._pending_lock = threading.Lock()
        self._ids = itertools.count(1)
        self.closed = threading.Event()

    # extension side -------------------------------------------------------
    def _send_native(self, obj: dict) -> None:
        data = json.dumps(obj).encode("utf-8")
        with self._write_lock:
            self._out.write(struct.pack("<I", len(data)))
            self._out.write(data)
            self._out.flush()

    def read_native_forever(self) -> None:
        try:
            while True:
                header = self._in.read(4)
                if len(header) < 4:
                    return
                (length,) = struct.unpack("<I", header)
                msg = json.loads(self._in.read(length).decode("utf-8"))
                with self._pending_lock:
                    waiter = self._pending.pop(msg.get("id"), None)
                if waiter is not None:
                    waiter[1].append(msg)
                    waiter[0].set()
        finally:
            self.closed.set()
            with self._pending_lock:
                for event, box in self._pending.values():
                    box.append({"error": "Firefox closed the connection"})
                    event.set()
                self._pending.clear()

    def call(self, method: str, params: dict) -> dict:
        if self.closed.is_set():
            return {"error": "Firefox is not connected"}
        rid = next(self._ids)
        event, box = threading.Event(), []
        with self._pending_lock:
            self._pending[rid] = (event, box)
        self._send_native({"id": rid, "method": method, "params": params})
        if not event.wait(REQUEST_TIMEOUT):
            with self._pending_lock:
                self._pending.pop(rid, None)
            return {"error": "Firefox did not answer in time"}
        reply = box[0]
        return {"error": reply["error"]} if "error" in reply else {"result": reply.get("result")}

    # MCP side --------------------------------------------------------------
    def serve_client(self, conn: socket.socket) -> None:
        with conn, conn.makefile("rwb") as f:
            for line in f:
                try:
                    req = json.loads(line)
                    reply = self.call(str(req["method"]), req.get("params") or {})
                except (ValueError, KeyError, TypeError) as exc:
                    reply = {"error": f"bad request: {exc}"}
                f.write((json.dumps(reply) + "\n").encode("utf-8"))
                f.flush()


def main() -> None:
    bridge = Bridge(sys.stdin.buffer, sys.stdout.buffer)
    path = socket_path()
    try:
        os.unlink(path)
    except FileNotFoundError:
        pass
    old = os.umask(0o177)  # socket file is rw for this user only
    srv = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    srv.bind(path)
    os.umask(old)
    srv.listen(8)

    def accept_forever():
        while True:
            try:
                conn, _ = srv.accept()
            except OSError:
                return
            threading.Thread(target=bridge.serve_client, args=(conn,), daemon=True).start()

    threading.Thread(target=accept_forever, daemon=True).start()
    try:
        bridge.read_native_forever()  # returns when Firefox closes stdin
    finally:
        srv.close()
        try:
            os.unlink(path)
        except FileNotFoundError:
            pass


if __name__ == "__main__":
    main()
