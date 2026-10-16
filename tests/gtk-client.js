// Only launched inside the isolated, headless Wayland test compositor.
import Gtk from 'gi://Gtk?version=4.0';
const app = new Gtk.Application({application_id: 'io.github.tanabe1478.WindowAtlas.SmokeTest'});
app.connect('activate', () => {
    const window = new Gtk.ApplicationWindow({
        application: app, title: 'Window Atlas smoke window',
        default_width: 640, default_height: 400,
    });
    window.set_child(new Gtk.Label({label: 'Isolated Wayland test client'}));
    window.present();
});
app.run([]);
