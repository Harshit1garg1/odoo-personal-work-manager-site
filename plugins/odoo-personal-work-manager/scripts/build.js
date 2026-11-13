import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
await mkdir(new URL('../dist/', import.meta.url), { recursive: true });
for (const name of ['dashboard', 'setup']) {
  const result = await build({ absWorkingDir: fileURLToPath(new URL('../', import.meta.url)), entryPoints: [`web/${name}.js`], bundle: true, write: false, format: 'esm', minify: true, target: ['es2022'] });
  const html = await readFile(new URL(`../web/${name}.html`, import.meta.url), 'utf8');
  const css = await readFile(new URL('../web/style.css', import.meta.url), 'utf8');
  await writeFile(new URL(`../dist/${name}.html`, import.meta.url), html.replace('/* INLINE_CSS */', () => css).replace('/* INLINE_JS */', () => result.outputFiles[0].text.replaceAll('</script', '<\\/script')));
}
