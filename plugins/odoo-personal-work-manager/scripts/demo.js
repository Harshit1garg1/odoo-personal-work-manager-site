process.env.DEMO_MODE = '1';
process.env.PUBLIC_URL = `http://127.0.0.1:${process.env.PORT || 8787}`;
await import('./build.js');
const { start } = await import('../server/index.js');
await start();
