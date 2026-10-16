// GJS smoke test. Constructs widgets without presenting a window or taking focus.
// Run with GSETTINGS_BACKEND=memory and a staged extension directory as ARGV[0].
import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import GLib from 'gi://GLib';
import System from 'system';

try {
    Gio.resources_register(Gio.Resource.load('/usr/share/gnome-shell/org.gnome.Shell.Extensions.src.gresource'));
    const path = ARGV[0];
    if (!path)
        throw new Error('Pass a staged extension directory');
    const {default: Preferences, findConflict, applyShortcutPreset} = await import(Gio.File.new_for_path(`${path}/prefs.js`).get_uri());
    const {ACTIONS, SHORTCUT_PRESETS} = await import(Gio.File.new_for_path(`${path}/actions.js`).get_uri());
    const {PositionDatabase} = await import(Gio.File.new_for_path(`${path}/positions.js`).get_uri());
    const {PositionStorage} = await import(Gio.File.new_for_path(`${path}/positionStorage.js`).get_uri());
    if (GLib.getenv('GSETTINGS_BACKEND') !== 'memory' || !GLib.getenv('XDG_CONFIG_HOME'))
        throw new Error('Smoke tests require memory settings and an isolated XDG_CONFIG_HOME');
    const storage = new PositionStorage();
    storage.file = storage.file.get_parent().get_child('storage-smoke.json');
    const data = new PositionDatabase();
    data.set({appId: 'desktop:example.desktop', slot: 0, monitorId: 'DP-1',
        area: {x: 0, y: 32, width: 1280, height: 688},
        state: {rect: {x: 0, y: 32, width: 640, height: 688}, monitor: 0, maximized: 0}});
    storage.save(data);
    if (storage.load().size !== 1)
        throw new Error('Persistent position round trip failed');
    const mode = storage.file.query_info('unix::mode', Gio.FileQueryInfoFlags.NONE, null).get_attribute_uint32('unix::mode') & 0o777;
    const dirMode = storage.file.get_parent().query_info('unix::mode', Gio.FileQueryInfoFlags.NONE, null).get_attribute_uint32('unix::mode') & 0o777;
    if (mode !== 0o600 || dirMode !== 0o700)
        throw new Error('Position data permissions are not private');
    storage.file.replace_contents('{"version":99,"positions":[]}', null, false, Gio.FileCreateFlags.PRIVATE, null);
    let rejected = false;
    try { storage.load(); } catch (_error) { rejected = true; }
    if (!rejected)
        throw new Error('Future-version position data was not rejected');
    storage.clear();
    if (storage.load().size)
        throw new Error('Position clear failed');
    print('PASS: persistent file round trip / private permissions / invalid-version rejection / clear');
    const [, contents] = Gio.File.new_for_path(`${path}/metadata.json`).load_contents(null);
    const metadata = JSON.parse(new TextDecoder().decode(contents));
    metadata.path = path;
    metadata.dir = Gio.File.new_for_path(path);
    Adw.init();
    const prefs = new Preferences(metadata);
    const window = new Adw.PreferencesWindow();
    prefs.fillPreferencesWindow(window);
    const settings = prefs.getSettings();
    settings.set_int('gap', 12);
    settings.set_boolean('cycle-sizes', false);
    // Prove both valid and conflicting bindings can be parsed by this GTK.
    if (!findConflict(settings, ACTIONS[1], ACTIONS[0].accelerator))
        throw new Error('Internal duplicate shortcut was not detected');
    if (findConflict(settings, ACTIONS[0], ACTIONS[0].accelerator))
        throw new Error('Default maximize shortcut unexpectedly conflicts');
    const systemSettings = new Gio.Settings({schema_id: 'org.gnome.desktop.wm.keybindings'});
    const systemBefore = JSON.stringify(systemSettings.get_value('switch-to-workspace-right').deep_unpack());
    for (const preset of SHORTCUT_PRESETS) {
        applyShortcutPreset(settings, preset);
        const fresh = prefs.getSettings();
        for (const action of ACTIONS) {
            if (JSON.stringify(fresh.get_strv(action.key)) !== JSON.stringify(preset.bindings[action.key]))
                throw new Error(`Preset not applied: ${preset.id}/${action.id}`);
        }
    }
    const ubuntu = SHORTCUT_PRESETS.find(preset => preset.id === 'ubuntu');
    applyShortcutPreset(settings, ubuntu);
    settings.set_strv(ACTIONS[0].key, ['<Super><Control><Alt>x']);
    if (prefs.getSettings().get_strv(ACTIONS[0].key)[0] !== '<Super><Control><Alt>x')
        throw new Error('Preset application left individual editing in delayed mode');
    applyShortcutPreset(settings, ubuntu);
    if (JSON.stringify(systemSettings.get_value('switch-to-workspace-right').deep_unpack()) !== systemBefore)
        throw new Error('Preset unexpectedly modified GNOME settings');
    print('PASS: both shortcut presets / subsequent edits / OS settings preserved');
    // Only present dialogs when explicitly running inside the private compositor.
    if (GLib.getenv('ATLAS_SMOKE_CAPTURE') === '1') {
        window.present();
        const capture = () => {
            prefs._captureShortcut(window, settings, ACTIONS[0]);
            const controllers = prefs._captureWindow.observe_controllers();
            for (let i = 0; i < controllers.get_n_items(); i++) {
                const controller = controllers.get_item(i);
                if (controller instanceof Gtk.EventControllerKey)
                    return controller;
            }
            throw new Error('Capture dialog has no keyboard controller');
        };
        const modifiers = Gdk.ModifierType.CONTROL_MASK | Gdk.ModifierType.ALT_MASK | Gdk.ModifierType.SUPER_MASK;
        let controller = capture();
        controller.emit('key-pressed', Gdk.KEY_c, 0, modifiers); // conflict with center
        if (settings.get_strv(ACTIONS[0].key)[0] !== ACTIONS[0].accelerator)
            throw new Error('Conflicting key was accepted');
        controller.emit('key-pressed', Gdk.KEY_x, 0, modifiers);
        if (settings.get_strv(ACTIONS[0].key)[0] !== Gtk.accelerator_name(Gdk.KEY_x, modifiers))
            throw new Error('Captured key was not saved');
        if (prefs._captureWindow)
            throw new Error('Capture dialog was not cleaned up');
        controller = capture();
        controller.emit('key-pressed', Gdk.KEY_BackSpace, 0, 0);
        if (settings.get_strv(ACTIONS[0].key).length)
            throw new Error('Backspace did not clear shortcut');
        controller = capture();
        controller.emit('key-pressed', Gdk.KEY_Escape, 0, 0);
        if (prefs._captureWindow)
            throw new Error('Escape did not close dialog');
        const spectacle = SHORTCUT_PRESETS.find(preset => preset.id === 'spectacle');
        let confirmation = prefs._showPresetDialog(window, settings, spectacle);
        confirmation.response('cancel');
        if (settings.get_strv(ACTIONS[0].key).length)
            throw new Error('Cancelling preset dialog changed shortcuts');
        confirmation = prefs._showPresetDialog(window, settings, spectacle);
        confirmation.response('apply');
        if (settings.get_strv('atlas-next-third')[0] !== '<Control><Alt>Right')
            throw new Error('Confirming preset dialog did not apply the preset');
        confirmation = prefs._showPresetDialog(window, settings, ubuntu);
        confirmation.response('apply');
        const clearBefore = settings.get_uint('clear-positions-request');
        let clearDialog = prefs._clearMemoryDialog(window, settings);
        clearDialog.response('cancel');
        if (settings.get_uint('clear-positions-request') !== clearBefore)
            throw new Error('Cancelling position clear modified settings');
        clearDialog = prefs._clearMemoryDialog(window, settings);
        clearDialog.response('clear');
        if (settings.get_uint('clear-positions-request') !== clearBefore + 1)
            throw new Error('Clearing positions did not notify the extension');
        print('PASS: shortcut capture / preset confirmation / memory clear confirmation');
    }
    window.emit('close-request');
    window.destroy();
    while (GLib.MainContext.default().pending())
        GLib.MainContext.default().iteration(false);
    print('PASS: preferences widgets / GSettings bindings / shortcut parsing');
} catch (error) {
    logError(error);
    System.exit(1);
}
