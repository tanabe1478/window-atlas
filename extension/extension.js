import Clutter from 'gi://Clutter';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {ACTIONS, ACTION_BY_ID, GROUPS} from './actions.js';
import {WindowController} from './controller.js';
import {MutterAdapter} from './mutterAdapter.js';
import {PositionMemory} from './positionMemory.js';

export default class WindowAtlasExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._adapter = new MutterAdapter();
        this._controller = new WindowController(this._adapter, () => ({
            cycleSizes: this._settings.get_boolean('cycle-sizes'),
            gap: this._settings.get_int('gap'),
            resizeStep: this._settings.get_int('resize-step'),
            historyLimit: this._settings.get_int('history-limit'),
        }));
        this._memory = new PositionMemory(this._settings, this._adapter, this._controller);
        this._bindings = [];
        for (const action of ACTIONS) {
            const result = Main.wm.addKeybinding(
                action.key, this._settings, Meta.KeyBindingFlags.IGNORE_AUTOREPEAT,
                Shell.ActionMode.NORMAL, () => this._execute(action.id));
            this._bindings.push(action.key);
            if (result === Meta.KeyBindingAction.NONE && this._settings.get_strv(action.key).length)
                console.warn(`[${this.uuid}] ショートカットを登録できません: ${action.id}`);
        }
        this._focusSignal = global.display.connect('notify::focus-window', () => this._rememberFocus());
        this._rememberFocus();
        this._settingsSignal = this._settings.connect('changed::show-indicator', () => this._syncIndicator());
        this._syncIndicator();
    }

    _isNormalWindow(window) {
        return this._adapter?.isAlive(window) &&
            window.get_window_type() === Meta.WindowType.NORMAL &&
            !window.is_skip_taskbar() && window.allows_move();
    }

    _rememberFocus() {
        const window = global.display.focus_window;
        if (this._isNormalWindow(window))
            this._lastWindow = window;
    }

    _execute(id, fromMenu = false) {
        if (id === 'remember-all' || id === 'recall-all') {
            this._memoryAction(id, null).catch(error => this._reportError(id, error));
            return;
        }
        let window = global.display.focus_window;
        if (!this._isNormalWindow(window) && fromMenu)
            window = this._lastWindow;
        if (!this._isNormalWindow(window))
            return;
        if (window.is_fullscreen()) {
            Main.notify(this.metadata.name, 'アプリの全画面表示を解除してから操作してください。');
            return;
        }
        const needsResize = ACTION_BY_ID.get(id)?.layouts || ['maximize', 'larger', 'smaller', 'next-third', 'previous-third'].includes(id);
        if (needsResize && !window.allows_resize() && !this._adapter.snapshot(window).maximized) {
            Main.notify(this.metadata.name, 'このウィンドウはサイズ変更に対応していません。');
            return;
        }
        const task = id === 'remember-window' || id === 'recall-window'
            ? this._memoryAction(id, window) : this._controller.dispatch(window, id);
        task.catch(error => this._reportError(id, error));
    }

    _reportError(id, error) {
        console.error(`[${this.metadata.name}] ${id}: ${error.message ?? error}\n${error.stack ?? ''}`);
        Main.notify(this.metadata.name, '操作できませんでした。ログを確認してください。');
    }

    async _memoryAction(id, window) {
        switch (id) {
        case 'remember-window':
            Main.notify(this.metadata.name, this._memory.remember(window)
                ? 'このウィンドウの位置を記憶しました。' : 'ウィンドウを識別中です。少し待ってから再実行してください。');
            break;
        case 'recall-window':
            if (!await this._memory.recall(window))
                Main.notify(this.metadata.name, 'このウィンドウには記憶した位置がありません。');
            break;
        case 'remember-all':
            Main.notify(this.metadata.name, `${this._memory.rememberAll()}個のウィンドウの配置を記憶しました。`);
            break;
        case 'recall-all':
            Main.notify(this.metadata.name, `${await this._memory.recallAll()}個のウィンドウへ復元を要求しました。`);
            break;
        }
    }

    _syncIndicator() {
        this._indicator?.destroy();
        this._indicator = null;
        if (!this._settings.get_boolean('show-indicator'))
            return;
        const indicator = new PanelMenu.Button(0.0, this.metadata.name);
        indicator.add_child(new St.Icon({
            icon_name: 'view-grid-symbolic', style_class: 'system-status-icon',
        }));
        for (const [group, title] of GROUPS) {
            const submenu = new PopupMenu.PopupSubMenuMenuItem(title);
            for (const action of ACTIONS.filter(item => item.group === group)) {
                const item = new PopupMenu.PopupMenuItem(action.title);
                item.connect('activate', () => this._execute(action.id, true));
                submenu.menu.addMenuItem(item);
            }
            indicator.menu.addMenuItem(submenu);
        }
        indicator.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        const prefs = new PopupMenu.PopupMenuItem('設定・ショートカット…');
        prefs.connect('activate', () => this.openPreferences());
        indicator.menu.addMenuItem(prefs);
        // Avoid an expanding icon hit area in panels with other extensions.
        indicator.set_x_expand(false);
        indicator.set_y_align(Clutter.ActorAlign.CENTER);
        Main.panel.addToStatusArea(this.uuid, indicator);
        this._indicator = indicator;
    }

    disable() {
        if (this._focusSignal)
            global.display.disconnect(this._focusSignal);
        this._focusSignal = 0;
        this._lastWindow = null;
        if (this._settingsSignal)
            this._settings.disconnect(this._settingsSignal);
        this._settingsSignal = 0;
        for (const key of this._bindings ?? [])
            Main.wm.removeKeybinding(key);
        this._bindings = [];
        this._indicator?.destroy();
        this._indicator = null;
        this._memory?.dispose();
        this._memory = null;
        this._controller?.dispose();
        this._adapter?.dispose();
        this._controller = null;
        this._adapter = null;
        this._settings = null;
    }
}
