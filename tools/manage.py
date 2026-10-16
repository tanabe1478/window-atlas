#!/usr/bin/env python3
"""Build/install this extension without sudo or changes to GNOME keybindings."""
from __future__ import annotations

import argparse
import contextlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "extension"
METADATA = json.loads((SOURCE / "metadata.json").read_text())
UUID = METADATA["uuid"]
SCHEMA = METADATA["settings-schema"]
SYSTEM_SCHEMAS = [
    "org.gnome.desktop.wm.keybindings",
    "org.gnome.mutter.keybindings",
    "org.gnome.mutter.wayland.keybindings",
    "org.gnome.shell.keybindings",
    "org.gnome.settings-daemon.plugins.media-keys",
]


def run(*args: str) -> None:
    subprocess.run(args, check=True)


def compile_schemas(directory: Path) -> None:
    run("glib-compile-schemas", "--strict", str(directory / "schemas"))


def copy_payload(destination: Path) -> None:
    for item in SOURCE.rglob("*"):
        if item.is_symlink():
            raise RuntimeError(f"シンボリックリンクは配布できません: {item}")
        if not item.is_file() or item.name == "gschemas.compiled":
            continue
        relative = item.relative_to(SOURCE)
        target = destination / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(item, target)
    shutil.copy2(ROOT / "LICENSE", destination / "LICENSE")
    compile_schemas(destination)


@contextlib.contextmanager
def staged_payload():
    with tempfile.TemporaryDirectory(prefix="atlas-build-") as temporary:
        directory = Path(temporary)
        copy_payload(directory)
        yield directory


def validate() -> None:
    if not METADATA.get("shell-version") or SOURCE.name != "extension":
        raise RuntimeError("metadata.jsonを確認してください。")
    if shutil.which("node"):
        for source in SOURCE.glob("*.js"):
            run("node", "--check", str(source))
    else:
        print("注意: Node.jsがないためJavaScriptの構文チェックはスキップします。")
    with staged_payload():
        pass
    print("検証OK: metadata / JavaScript構文 / GSettingsスキーマ")


def destination() -> Path:
    data_home = Path(os.environ.get("XDG_DATA_HOME", str(Path.home() / ".local/share")))
    if not data_home.is_absolute():
        raise RuntimeError("XDG_DATA_HOMEには絶対パスを指定してください。")
    return data_home / "gnome-shell/extensions" / UUID


def assert_owned(target: Path) -> None:
    if target.is_symlink():
        raise RuntimeError(f"安全のためリンク先は変更しません: {target}")
    if target.exists():
        metadata_file = target / "metadata.json"
        if not metadata_file.is_file() or json.loads(metadata_file.read_text()).get("uuid") != UUID:
            raise RuntimeError(f"別のディレクトリの可能性があるため中止しました: {target}")


def assert_disabled() -> None:
    # Read-only. Failure to access a session bus must not prevent offline installs.
    try:
        from gi.repository import Gio
        source = Gio.SettingsSchemaSource.get_default()
        schema = source.lookup("org.gnome.shell", True)
        if schema and UUID in Gio.Settings.new_full(schema, None, None).get_strv("enabled-extensions"):
            raise RuntimeError(f"先に gnome-extensions disable {UUID} を実行してください。")
    except ImportError:
        pass


def install() -> None:
    if os.geteuid() == 0:
        raise RuntimeError("sudoを使わず、ログイン中のユーザーとして実行してください。")
    target = destination()
    assert_owned(target)
    assert_disabled()
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = Path(tempfile.mkdtemp(prefix=f".{UUID}.new-", dir=target.parent))
    backup = target.with_name(f".{UUID}.previous")
    try:
        copy_payload(temporary)
        if backup.exists():
            raise RuntimeError(f"前回のバックアップを確認してください: {backup}")
        if target.exists():
            target.rename(backup)
        try:
            temporary.rename(target)
        except BaseException:
            if backup.exists():
                backup.rename(target)
            raise
        if backup.exists():
            shutil.rmtree(backup)
    finally:
        if temporary.exists():
            shutil.rmtree(temporary)
    print(f"インストール先: {target}")
    print("GNOME設定・既存ショートカットは変更していません。")
    print("Waylandでは一度ログアウト→ログインしてから、次を実行してください:")
    print(f"  gnome-extensions enable {UUID}")
    print(f"  gnome-extensions prefs {UUID}")


def uninstall() -> None:
    target = destination()
    assert_owned(target)
    assert_disabled()
    if target.exists():
        shutil.rmtree(target)
        print(f"削除しました: {target}")
    else:
        print(f"未インストール: {target}")
    print("ショートカット等の保存設定は残しています。")


def pack() -> None:
    output = ROOT / "dist" / f"{UUID}.shell-extension.zip"
    output.parent.mkdir(parents=True, exist_ok=True)
    with staged_payload() as payload:
        with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
            for path in sorted(payload.rglob("*")):
                if path.is_file():
                    archive.write(path, path.relative_to(payload))
    print(output)


def doctor() -> None:
    print(f"セッション: {os.environ.get('XDG_SESSION_TYPE', '不明')}")
    print(f"デスクトップ: {os.environ.get('XDG_CURRENT_DESKTOP', '不明')}")
    if shutil.which("gnome-shell"):
        run("gnome-shell", "--version")
    print(f"インストール先: {destination()}")
    try:
        import gi
        gi.require_version("Gtk", "4.0")
        from gi.repository import Gio, Gtk
    except ImportError:
        print("競合チェックには python3-gi と gir1.2-gtk-4.0 が必要です。")
        return

    def normalized(accelerator):
        valid, key, modifiers = Gtk.accelerator_parse(accelerator)
        return (key, int(modifiers)) if valid and key else None

    default_source = Gio.SettingsSchemaSource.get_default()
    occupied = {}
    for schema_id in SYSTEM_SCHEMAS:
        schema = default_source.lookup(schema_id, True)
        if not schema or not schema.get_path():
            continue
        settings = Gio.Settings.new_full(schema, None, None)
        for key in schema.list_keys():
            value = settings.get_value(key)
            value_type = value.get_type_string()
            candidates = value.unpack() if value_type == "as" else [value.unpack()] if value_type == "s" else []
            for accelerator in candidates:
                parsed = normalized(accelerator)
                if parsed:
                    occupied.setdefault(parsed, []).append(f"{schema_id} / {key}")
    conflicts = 0
    with staged_payload() as payload:
        source = Gio.SettingsSchemaSource.new_from_directory(str(payload / "schemas"), default_source, False)
        schema = source.lookup(SCHEMA, False)
        settings = Gio.Settings.new_full(schema, None, None)
        for key in sorted(schema.list_keys()):
            if not key.startswith("atlas-"):
                continue
            for accelerator in settings.get_strv(key):
                parsed = normalized(accelerator)
                if not parsed:
                    print(f"無効なキー: {key} = {accelerator}")
                    conflicts += 1
                    continue
                for owner in occupied.get(parsed, []):
                    print(f"競合: {key} ({accelerator}) ↔ {owner}")
                    conflicts += 1
                occupied.setdefault(parsed, []).append(key)
    print(f"検出した競合・無効キー: {conflicts}件")
    print("標準のGNOME設定と本拡張の重複を確認しました。他の拡張やアプリの競合は検出しきれません。")
    print("このコマンドは設定を書き換えません。")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["validate", "pack", "install", "uninstall", "doctor"])
    args = parser.parse_args()
    try:
        globals()[args.command]()
    except (RuntimeError, OSError, subprocess.CalledProcessError, ValueError) as error:
        print(f"エラー: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
