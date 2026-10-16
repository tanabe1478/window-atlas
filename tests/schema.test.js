import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {ACTIONS, GROUPS} from '../extension/actions.js';

const xml = await readFile(new URL('../extension/schemas/org.gnome.shell.extensions.window-atlas.gschema.xml', import.meta.url), 'utf8');
const unescape = text => text.replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');
const entries = [...xml.matchAll(/<key name="([^"]+)" type="([^"]+)">([\s\S]*?)<\/key>/g)];

test('every action has exactly one matching schema entry with the correct default', () => {
    const schemas = new Map(entries.map(([, name, type, body]) => [name, {type, body}]));
    assert.equal(new Set(ACTIONS.map(action => action.key)).size, ACTIONS.length);
    assert.equal(entries.length, ACTIONS.length + 8);
    const accelerators = new Set();
    for (const action of ACTIONS) {
        const schema = schemas.get(action.key);
        assert(schema, action.key);
        assert.equal(schema.type, 'as');
        const expected = action.accelerator ? `['${action.accelerator}']` : '[]';
        assert.equal(unescape(schema.body.match(/<default>(.*?)<\/default>/)[1]), expected);
        assert(GROUPS.some(([id]) => id === action.group));
        if (action.accelerator) {
            assert(!accelerators.has(action.accelerator));
            accelerators.add(action.accelerator);
        }
    }
});

test('metadata uses a unique settings namespace and explicitly supports the host GNOME', async () => {
    const metadata = JSON.parse(await readFile(new URL('../extension/metadata.json', import.meta.url), 'utf8'));
    assert.equal(metadata.uuid, 'window-atlas@tanabe1478');
    assert(xml.includes(`id="${metadata['settings-schema']}"`));
    assert(metadata['shell-version'].includes('50'));
});
