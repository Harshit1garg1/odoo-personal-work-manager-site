import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

test('built dashboard and secure setup contain valid, complete JavaScript', () => {
  for (const name of ['dashboard', 'setup']) {
    const html = readFileSync(new URL(`../dist/${name}.html`, import.meta.url), 'utf8');
    assert.equal(html.includes('/* INLINE_JS */'), false);
    assert.equal(html.includes('/* INLINE_CSS */'), false);
    const scripts = [...html.matchAll(/<script type="module">([\s\S]*?)<\/script>/g)];
    assert.equal(scripts.length, 1);
    const checked = spawnSync(process.execPath, ['--check', '--input-type=module'], { input: scripts[0][1], encoding: 'utf8' });
    assert.equal(checked.status, 0, `${name}: ${checked.stderr}`);
  }
});
