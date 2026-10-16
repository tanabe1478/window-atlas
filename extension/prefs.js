import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import {ACTIONS, GROUPS, SHORTCUT_PRESETS} from './actions.js';
import {PositionStorage} from './positionStorage.js';

// Best-effort detection of GNOME's standard keybindings. Other apps can grab
// shortcuts outside GSettings, so a complete global conflict check isn't possible.
const SYSTEM_SCHEMAS = [
    'org.gnome.desktop.wm.keybindings',
    'org.gnome.mutter.keybindings',
    'org.gnome.mutter.wayland.keybindings',
    'org.gnome.shell.keybindings',
    'org.gnome.settings-daemon.plugins.media-keys',
];

function parseShortcut(accelerator) {
    const [valid, keyval, modifiers] = Gtk.accelerator_parse(accelerator);
    return valid ? `${Gdk.keyval_to_lower(keyval)}:${modifiers}` : null;
}

export function findConflict(settings, action, accelerator) {
    const candidate = parseShortcut(accelerator);
    for (const other of ACTIONS) {
        if (other.id !== action.id && settings.get_strv(other.key).some(key => parseShortcut(key) === candidate))
            return `「${other.title}」に割り当て済みです。先にそちらを解除してください。`;
    }
    return findSystemConflict(accelerator);
}

export function findSystemConflict(accelerator) {
    const candidate = parseShortcut(accelerator);
    if (!candidate)
        return '無効なショートカットです。';
    const source = Gio.SettingsSchemaSource.get_default();
    for (const schemaId of SYSTEM_SCHEMAS) {
        const schema = source.lookup(schemaId, true);
        if (!schema || !schema.get_path())
            continue;
        const otherSettings = new Gio.Settings({settings_schema: schema});
        for (const key of schema.list_keys()) {
            const value = otherSettings.get_value(key);
            const type = value.get_type_string();
            const accelerators = type === 'as' ? value.deep_unpack()
                : type === 's' ? [value.deep_unpack()] : [];
            if (accelerators.some(item => item && parseShortcut(item) === candidate))
                return `GNOMEの ${schemaId} / ${key} と重複しています。別のキーを指定してください。`;
        }
    }
    return null;
}

export function applyShortcutPreset(settings, preset) {
    if (!SHORTCUT_PRESETS.includes(preset))
        throw new Error('Unknown shortcut preset');
    // Use a separate delayed writer. Delaying the UI's settings instance would
    // otherwise leave subsequent individual edits unapplied.
    const writer = new Gio.Settings({settings_schema: settings.settings_schema});
    writer.delay();
    for (const action of ACTIONS)
        writer.set_strv(action.key, preset.bindings[action.key]);
    writer.apply();
}

export default class WindowAtlasPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        window.set_default_size(760, 780);
        const settings = this.getSettings();
        const page = new Adw.PreferencesPage({title: 'Window Atlas', icon_name: 'view-grid-symbolic'});
        window.add(page);
        const general = new Adw.PreferencesGroup({
            title: '動作',
            description: '通常のウィンドウが対象です。既存のGNOME設定は変更しません。',
        });
        page.add(general);
        for (const [key, title, subtitle] of [
            ['show-indicator', 'パネルにメニューを表示', 'ショートカットを使わずに配置できます'],
            ['cycle-sizes', '半分・四隅の配置サイズを切り替える', '1/2 → 2/3 → 1/3 → 1/2。四隅は高さを半分に保って幅を切り替えます'],
        ]) {
            const row = new Adw.SwitchRow({title, subtitle});
            settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
            general.add(row);
        }
        for (const [key, title, lower, upper] of [
            ['gap', '配置時のすき間（論理px）', 0, 64],
            ['resize-step', '拡大・縮小のステップ（論理px）', 5, 200],
            ['history-limit', 'ウィンドウごとの履歴件数', 10, 100],
        ]) {
            const row = new Adw.SpinRow({
                title,
                adjustment: new Gtk.Adjustment({lower, upper, step_increment: 1, page_increment: 5}),
                digits: 0,
            });
            settings.bind(key, row, 'value', Gio.SettingsBindFlags.DEFAULT);
            general.add(row);
        }
        const memory = new Adw.PreferencesGroup({
            title: '位置の記憶・復元',
            description: 'アプリ別に位置・サイズ・モニターをローカル保存します。同じアプリの複数ウィンドウは開いた順で対応します。',
        });
        for (const [key, title, subtitle] of [
            ['remember-positions', '移動・サイズ変更時に位置を自動記憶', '無効にしてもメニューやショートカットから手動で記憶できます'],
            ['restore-on-open', '新しく開いたウィンドウを記憶した位置へ復元', '既定では無効です。閉じたアプリを起動する機能ではありません'],
        ]) {
            const row = new Adw.SwitchRow({title, subtitle});
            settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
            memory.add(row);
        }
        const clearRow = new Adw.ActionRow({title: '記憶したすべての位置を削除',
            subtitle: new PositionStorage().file.get_path()});
        const clearMemory = new Gtk.Button({label: '削除…', valign: Gtk.Align.CENTER});
        clearMemory.connect('clicked', () => this._clearMemoryDialog(window, settings));
        clearRow.add_suffix(clearMemory);
        memory.add(clearRow);
        page.add(memory);
        const signals = [];
        for (const [groupId, title] of GROUPS) {
            const group = new Adw.PreferencesGroup({
                title,
                description: groupId === 'basic'
                    ? 'キー表示を押して変更。Ctrl・Alt・Superのいずれかを含めてください。'
                    : null,
            });
            page.add(group);
            for (const action of ACTIONS.filter(item => item.group === groupId)) {
                const row = new Adw.ActionRow({title: action.title});
                const button = new Gtk.Button({valign: Gtk.Align.CENTER});
                const label = new Gtk.ShortcutLabel({disabled_text: '未設定'});
                button.set_child(label);
                button.set_tooltip_text('クリックしてショートカットを変更');
                button.connect('clicked', () => this._captureShortcut(window, settings, action));
                row.add_suffix(button);
                row.set_activatable_widget(button);
                const clear = new Gtk.Button({
                    icon_name: 'edit-clear-symbolic', valign: Gtk.Align.CENTER,
                    tooltip_text: '割り当てを解除', css_classes: ['flat'],
                });
                clear.connect('clicked', () => settings.set_strv(action.key, []));
                row.add_suffix(clear);
                const refresh = () => {
                    const keys = settings.get_strv(action.key);
                    label.set_accelerator(keys[0] ?? '');
                    // gsettings can assign multiple accelerators, even though
                    // the interactive editor intentionally creates just one.
                    button.set_tooltip_text(keys.join(' / ') || 'クリックして設定');
                    clear.set_sensitive(keys.length > 0);
                };
                refresh();
                signals.push(settings.connect(`changed::${action.key}`, refresh));
                group.add(row);
            }
        }
        const presets = new Adw.PreferencesGroup({
            title: 'キー配列プリセット',
            description: '適用前に確認します。本拡張の全キー割り当てを置き換えますが、OSや他の拡張の設定は変更しません。',
        });
        for (const preset of SHORTCUT_PRESETS) {
            const row = new Adw.ActionRow({title: preset.title, subtitle: preset.description});
            const button = new Gtk.Button({label: '適用…', valign: Gtk.Align.CENTER});
            button.connect('clicked', () => this._showPresetDialog(window, settings, preset));
            row.add_suffix(button);
            presets.add(row);
        }
        page.add(presets);
        window.connect('close-request', () => {
            for (const signal of signals)
                settings.disconnect(signal);
            this._captureWindow?.destroy();
            this._captureWindow = null;
            return false;
        });
    }

    _clearMemoryDialog(parent, settings) {
        const dialog = new Adw.MessageDialog({
            transient_for: parent, modal: true, heading: '記憶した位置をすべて削除しますか？',
            body: '保存済みの位置・サイズ・モニター情報を削除します。現在のウィンドウ配置やショートカットは変更しません。',
        });
        dialog.add_response('cancel', 'キャンセル');
        dialog.add_response('clear', '削除');
        dialog.set_response_appearance('clear', Adw.ResponseAppearance.DESTRUCTIVE);
        dialog.set_default_response('cancel');
        dialog.set_close_response('cancel');
        dialog.connect('response', (_dialog, response) => {
            if (response !== 'clear')
                return;
            try {
                new PositionStorage().clear();
                settings.set_uint('clear-positions-request', (settings.get_uint('clear-positions-request') + 1) >>> 0);
            } catch (error) {
                const failure = new Adw.MessageDialog({transient_for: parent, modal: true,
                    heading: '記憶した位置を削除できませんでした', body: error.message});
                failure.add_response('close', '閉じる');
                failure.present();
            }
        });
        dialog.present();
        return dialog;
    }

    _showPresetDialog(parent, settings, preset) {
        const conflicts = ACTIONS.flatMap(action => preset.bindings[action.key].flatMap(accelerator => {
            const conflict = findSystemConflict(accelerator);
            return conflict ? [`${action.title}: ${conflict}`] : [];
        }));
        let body = '本拡張のショートカットをすべて置き換えます。GNOMEや他の拡張の設定は変更しません。';
        if (preset.id === 'spectacle')
            body += '\n原版にない位置記憶・直接1/3配置・最初の状態への復元は未設定になります。';
        if (conflicts.length) {
            body += `\n\n標準設定との競合 ${conflicts.length}件:\n${conflicts.slice(0, 6).join('\n')}`;
            if (conflicts.length > 6)
                body += `\nほか ${conflicts.length - 6}件`;
            body += '\n競合する操作は動かない場合があります。必要に応じてOS側で割り当てを変更してください。';
        } else {
            body += '\n\n標準設定との競合は検出されませんでした。他の拡張との競合は別途確認してください。';
        }
        const dialog = new Adw.MessageDialog({
            transient_for: parent, modal: true,
            heading: `「${preset.title}」を適用しますか？`, body,
        });
        dialog.add_response('cancel', 'キャンセル');
        dialog.add_response('apply', '適用');
        dialog.set_response_appearance('apply', Adw.ResponseAppearance.SUGGESTED);
        dialog.set_default_response('cancel');
        dialog.set_close_response('cancel');
        dialog.connect('response', (_dialog, response) => {
            if (response === 'apply')
                applyShortcutPreset(settings, preset);
        });
        dialog.present();
        return dialog;
    }

    _captureShortcut(parent, settings, action) {
        if (this._captureWindow) {
            this._captureWindow.present();
            return;
        }
        const dialog = new Adw.Window({
            title: action.title, transient_for: parent, modal: true,
            default_width: 500, default_height: 240, resizable: false,
        });
        this._captureWindow = dialog;
        const box = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL});
        box.append(new Adw.HeaderBar());
        const title = new Gtk.Label({
            label: action.title, css_classes: ['title-2'], margin_top: 16,
        });
        box.append(title);
        const message = new Gtk.Label({
            label: '新しいキーの組み合わせを押してください。\nEsc: キャンセル　Backspace / Delete: 解除',
            wrap: true, margin_top: 20, margin_bottom: 28, margin_start: 24, margin_end: 24,
        });
        box.append(message);
        dialog.set_content(box);
        const closeDialog = () => {
            if (this._captureWindow === dialog)
                this._captureWindow = null;
            dialog.destroy();
        };
        const controller = new Gtk.EventControllerKey({propagation_phase: Gtk.PropagationPhase.CAPTURE});
        controller.connect('key-pressed', (_controller, keyval, _keycode, state) => {
            let modifiers = state & Gtk.accelerator_get_default_mod_mask();
            modifiers &= ~Gdk.ModifierType.LOCK_MASK;
            if (!modifiers && keyval === Gdk.KEY_Escape) {
                closeDialog();
                return Gdk.EVENT_STOP;
            }
            if (!modifiers && [Gdk.KEY_BackSpace, Gdk.KEY_Delete].includes(keyval)) {
                settings.set_strv(action.key, []);
                closeDialog();
                return Gdk.EVENT_STOP;
            }
            if (!(modifiers & (Gdk.ModifierType.CONTROL_MASK | Gdk.ModifierType.ALT_MASK | Gdk.ModifierType.SUPER_MASK)) ||
                !Gtk.accelerator_valid(keyval, modifiers))
                return Gdk.EVENT_STOP;
            if (keyval === Gdk.KEY_ISO_Left_Tab)
                keyval = Gdk.KEY_Tab;
            keyval = Gdk.keyval_to_lower(keyval);
            const accelerator = Gtk.accelerator_name(keyval, modifiers);
            const conflict = findConflict(settings, action, accelerator);
            if (conflict) {
                message.set_label(conflict);
                return Gdk.EVENT_STOP;
            }
            settings.set_strv(action.key, [accelerator]);
            closeDialog();
            return Gdk.EVENT_STOP;
        });
        dialog.add_controller(controller);
        dialog.connect('close-request', () => {
            if (this._captureWindow === dialog)
                this._captureWindow = null;
            return false;
        });
        dialog.present();
    }
}
