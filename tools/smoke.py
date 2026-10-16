#!/usr/bin/env python3
"""Optional GJS / isolated GNOME 50 Wayland smoke tests. Never installs on host."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import tempfile
import time

from manage import ROOT, UUID, copy_payload, staged_payload


def prefs_test() -> None:
    with staged_payload() as payload, tempfile.TemporaryDirectory(prefix="atlas-prefs-") as config:
        environment = {
            **os.environ,
            "XDG_CONFIG_HOME": config,
            "GSETTINGS_BACKEND": "memory",
            "GI_TYPELIB_PATH": "/usr/lib/gnome-shell/girepository-1.0:" + os.environ.get("GI_TYPELIB_PATH", ""),
            "LD_LIBRARY_PATH": "/usr/lib/gnome-shell:" + os.environ.get("LD_LIBRARY_PATH", ""),
            "G_DEBUG": "fatal-warnings",
        }
        subprocess.run(["gjs", "-m", str(ROOT / "tests/prefs-smoke.js"), str(payload)],
                       env=environment, check=True, timeout=20)


def shell_test() -> None:
    version = subprocess.check_output(["gnome-shell", "--version"], text=True)
    if not version.startswith("GNOME Shell 50."):
        raise RuntimeError("この分離Shellテスト用fixtureはGNOME 50専用です。")
    with tempfile.TemporaryDirectory(prefix="atlas-shell-smoke-") as temporary:
        directory = Path(temporary)
        for name in ["home", "config", "cache", "runtime", "data"]:
            (directory / name).mkdir(mode=0o700)
        extension_root = directory / "data/gnome-shell/extensions"
        target = extension_root / UUID
        target.mkdir(parents=True)
        copy_payload(target)
        shutil.copytree(ROOT / "tests/shell-probe", extension_root / "window-atlas-smoke@local")
        result_file = directory / "result.json"
        profile = directory / "dconf-profile"
        profile.write_text("user-db:atlas_test\n")
        environment = {**os.environ}
        for key in ["DISPLAY", "WAYLAND_DISPLAY", "DBUS_SESSION_BUS_ADDRESS", "GSETTINGS_BACKEND", "GNOME_SHELL_SESSION_MODE"]:
            environment.pop(key, None)
        environment.update({
            "HOME": str(directory / "home"),
            "XDG_CONFIG_HOME": str(directory / "config"),
            "XDG_CACHE_HOME": str(directory / "cache"),
            "XDG_DATA_HOME": str(directory / "data"),
            "XDG_RUNTIME_DIR": str(directory / "runtime"),
            "XDG_CURRENT_DESKTOP": "GNOME",
            "XDG_SESSION_TYPE": "wayland",
            "GNOME_SHELL_SESSION_MODE": "user",
            "DCONF_PROFILE": str(profile),
            "LIBGL_ALWAYS_SOFTWARE": "1",
            "GSK_RENDERER": "cairo",
            "ATLAS_SMOKE_RESULT": str(result_file),
            "ATLAS_SMOKE_CLIENT": str(ROOT / "tests/gtk-client.js"),
            "ATLAS_SMOKE_PREFS": str(ROOT / "tests/prefs-smoke.js"),
        })
        script = """
set -eu
gsettings set org.gnome.shell enabled-extensions "['window-atlas@tanabe1478', 'window-atlas-smoke@local']"
gsettings set org.gnome.shell disable-user-extensions false
gsettings set org.gnome.desktop.interface enable-animations false
exec gnome-shell --headless --wayland --no-x11 --wayland-display atlas-test --virtual-monitor 1280x720 --virtual-monitor 1600x900
"""
        log_path = ROOT / "dist/shell-smoke.log"
        log_path.parent.mkdir(exist_ok=True)
        with log_path.open("w") as log:
            process = subprocess.Popen(["dbus-run-session", "--", "bash", "-c", script],
                                       env=environment, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
            try:
                deadline = time.monotonic() + 70
                while not result_file.exists() and process.poll() is None and time.monotonic() < deadline:
                    time.sleep(0.1)
            finally:
                if process.poll() is None and result_file.exists():
                    try:
                        process.wait(timeout=4)
                    except subprocess.TimeoutExpired:
                        pass
                if process.poll() is None:
                    os.killpg(process.pid, signal.SIGTERM)
                    try:
                        process.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        os.killpg(process.pid, signal.SIGKILL)
                        process.wait()
                # The document portal can briefly leave a FUSE mount behind
                # after its private D-Bus session terminates. Only unmount the
                # test's own private runtime path, never the host portal.
                time.sleep(0.5)
                if shutil.which("fusermount3"):
                    subprocess.run(["fusermount3", "-uz", str(directory / "runtime/doc")],
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
        if not result_file.exists():
            raise RuntimeError(f"分離Shellが起動しないか、テストがタイムアウトしました。ログ: {log_path}")
        result = json.loads(result_file.read_text())
        if result["status"] != "pass":
            raise RuntimeError(f"{result.get('error')}\nログ: {log_path}")
        print("PASS: isolated GNOME 50 / Wayland / shortcuts / corner cycles / six thirds / anchored resize / presets / history / two monitors / lifecycle")
        print(f"ログ: {log_path}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("target", choices=["prefs", "shell"])
    target = parser.parse_args().target
    if target == "prefs":
        prefs_test()
    else:
        shell_test()


if __name__ == "__main__":
    main()
