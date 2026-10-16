import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {MAX_POSITION_BYTES, PositionDatabase} from './positions.js';

export class PositionStorage {
    constructor() {
        this.file = Gio.File.new_for_path(GLib.build_filenamev([
            GLib.get_user_config_dir(), 'window-atlas', 'positions.json',
        ]));
    }

    load() {
        let info;
        try {
            info = this.file.query_info('standard::size,standard::type', Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
        } catch (error) {
            if (error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND))
                return new PositionDatabase();
            throw error;
        }
        if (info.get_file_type() !== Gio.FileType.REGULAR || info.get_size() > MAX_POSITION_BYTES)
            throw new Error('Window Atlas position file must be a regular file under 1 MiB');
        const [, contents] = this.file.load_contents(null);
        return PositionDatabase.parse(new TextDecoder().decode(contents));
    }

    save(database) {
        const directory = this.file.get_parent();
        try {
            directory.make_directory_with_parents(null);
        } catch (error) {
            if (!error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.EXISTS))
                throw error;
        }
        const info = directory.query_info('standard::type', Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
        if (info.get_file_type() !== Gio.FileType.DIRECTORY)
            throw new Error('Window Atlas configuration directory must not be a symlink');
        directory.set_attribute_uint32('unix::mode', 0o700, Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
        const text = database.stringify();
        if (new TextEncoder().encode(text).length > MAX_POSITION_BYTES)
            throw new Error('Window Atlas position data exceeds 1 MiB');
        // Atomic replacement; do not follow a pre-existing destination symlink.
        this.file.replace_contents(text, null, false,
            Gio.FileCreateFlags.PRIVATE | Gio.FileCreateFlags.REPLACE_DESTINATION, null);
        this.file.set_attribute_uint32('unix::mode', 0o600, Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
    }

    clear() {
        try {
            this.file.delete(null);
        } catch (error) {
            if (!error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND))
                throw error;
        }
    }
}
