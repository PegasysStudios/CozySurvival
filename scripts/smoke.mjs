// Headless boot smoke check: builds the app, serves dist/, loads it in Chrome
// (SwiftShader WebGL), starts a run, walks, opens crafting, and fails on any
// console error or uncaught exception.
//
//   npm run smoke                 build + check
//   SMOKE_NO_BUILD=1 npm run smoke   reuse the existing dist/
//   CHROME_PATH=/path/to/chrome npm run smoke
import { existsSync } from 'node:fs';
import { build, preview } from 'vite';
import puppeteer from 'puppeteer-core';

const PORT = Number(process.env.SMOKE_PORT ?? 5299);
const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/usr/local/bin/google-chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
].filter(Boolean);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const checks = [];
const problems = [];

function check(name, ok, detail = '') {
  checks.push({ name, ok, detail });
  if (!ok) problems.push(`${name}${detail ? `: ${detail}` : ''}`);
}

async function main() {
  const chrome = CHROME_CANDIDATES.find((p) => existsSync(p));
  if (!chrome) throw new Error('No Chrome/Chromium found. Set CHROME_PATH.');

  if (!process.env.SMOKE_NO_BUILD || !existsSync('dist/index.html')) {
    console.log('• building…');
    await build({ logLevel: 'warn' });
  }
  const server = await preview({ preview: { port: PORT, strictPort: true, host: '127.0.0.1', open: false }, logLevel: 'warn' });
  const url = `http://127.0.0.1:${PORT}/?dev=1`;

  const browser = await puppeteer.launch({
    executablePath: chrome,
    headless: true,
    args: [
      '--no-sandbox',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--ignore-gpu-blocklist',
      '--mute-audio',
      '--autoplay-policy=no-user-gesture-required',
      '--window-size=1280,720',
    ],
  });

  const consoleErrors = [];
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720 });
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`));
    page.on('requestfailed', (req) => consoleErrors.push(`request failed: ${req.url()} ${req.failure()?.errorText ?? ''}`));

    console.log(`• loading ${url}`);
    const t0 = Date.now();
    await page.goto(url, { waitUntil: 'load', timeout: 60_000 });
    await page.waitForFunction(() => window.__cozy?.ready || (window.__cozy?.errors.length ?? 0) > 0, { timeout: 90_000 });
    const bootMs = Date.now() - t0;
    const boot = await page.evaluate(() => ({ ready: window.__cozy.ready, errors: window.__cozy.errors, fatal: !!document.querySelector('.fatal') }));
    check('game boots', boot.ready && !boot.fatal, boot.errors.join(' | '));
    if (!boot.ready) return;
    console.log(`  booted in ${bootMs} ms`);

    await sleep(1200);
    check('title screen shown', await page.$eval('.title-screen', (e) => e.classList.contains('show')));
    check('canvas rendering', await page.evaluate(() => {
      const c = document.querySelector('canvas.view');
      return !!c && c.width > 0 && c.height > 0;
    }));

    await page.click('.title-screen .btn.primary');
    await sleep(400);
    const started = await page.evaluate(() => {
      const g = window.__cozy.game;
      g.input.locked = true;
      return { mode: g.mode, hud: document.querySelector('.hud')?.classList.contains('visible'), day: g.sim.day };
    });
    check('run starts from title', started.mode === 'playing' && started.hud, JSON.stringify(started));

    const before = await page.evaluate(() => {
      const p = window.__cozy.game.sim.state.player;
      return { x: p.x, z: p.z, energy: window.__cozy.game.sim.state.needs.energy };
    });
    await page.keyboard.down('KeyW');
    await page.keyboard.down('ShiftLeft');
    await sleep(1800);
    await page.keyboard.up('ShiftLeft');
    await page.keyboard.up('KeyW');
    const after = await page.evaluate(() => {
      const g = window.__cozy.game;
      const p = g.sim.state.player;
      return { x: p.x, z: p.z, energy: g.sim.state.needs.energy, walked: g.sim.distanceWalked };
    });
    const moved = Math.hypot(after.x - before.x, after.z - before.z);
    check('player walks and sprints', moved > 1, `moved ${moved.toFixed(2)} m`);
    check('sprinting spends energy', after.energy < before.energy, `${before.energy.toFixed(2)} → ${after.energy.toFixed(2)}`);

    await page.mouse.click(640, 360);
    await sleep(300);

    const learned = await page.evaluate(() => {
      const sim = window.__cozy.game.sim;
      sim.devGive('stick', 6);
      sim.devGive('stone', 4);
      sim.devGive('fiber', 6);
      return sim.state.known.length;
    });
    check('gathering teaches recipes', learned > 0, `${learned} known`);
    await sleep(200);

    await page.keyboard.press('KeyC');
    await sleep(300);
    const panel = await page.evaluate(() => ({
      mode: window.__cozy.game.mode,
      shown: document.querySelector('.panel-overlay')?.classList.contains('show'),
      recipes: document.querySelectorAll('.recipe').length,
      ready: document.querySelectorAll('.recipe.ready').length,
    }));
    check('crafting panel opens with recipes', panel.mode === 'panel' && panel.shown && panel.recipes > 0 && panel.ready > 0, JSON.stringify(panel));

    const snapshot = () =>
      page.evaluate(() => {
        const s = window.__cozy.game.sim;
        return JSON.stringify([s.state.inventory.slots, s.state.tools, s.state.gear, !!s.placement]);
      });
    const beforeCraft = await snapshot();
    await page.click('.recipe-detail .btn.primary');
    await sleep(300);
    check('crafting from the panel works', (await snapshot()) !== beforeCraft);

    if (await page.evaluate(() => window.__cozy.game.mode === 'panel')) await page.keyboard.press('Escape');
    await sleep(250);
    await page.evaluate(() => window.__cozy.game.sim.cancelPlacement());
    check('crafting panel closes', await page.evaluate(() => window.__cozy.game.mode === 'playing'));

    await page.evaluate(() => (window.__cozy.game.input.locked = true));
    await page.keyboard.press('Backquote');
    await sleep(200);
    check('dev panel toggles', await page.$eval('.dev-panel', (e) => e.classList.contains('show')));
    await page.keyboard.press('Backquote');
    await sleep(200);

    await page.evaluate(() => (window.__cozy.game.input.locked = true));
    await page.keyboard.press('Tab');
    await sleep(250);
    check('pack panel opens', await page.evaluate(() => document.querySelector('.panel-inventory') !== null));
    await page.keyboard.press('Escape');
    await sleep(200);

    const frames = await page.evaluate(
      () =>
        new Promise((resolve) => {
          let n = 0;
          const start = performance.now();
          const tick = () => {
            n++;
            if (performance.now() - start < 2000) requestAnimationFrame(tick);
            else resolve(n / ((performance.now() - start) / 1000));
          };
          requestAnimationFrame(tick);
        }),
    );
    console.log(`  headless frame rate (software GL, not representative): ${frames.toFixed(1)} fps`);
    const info = await page.evaluate(
      () =>
        new Promise((resolve) => {
          const r = window.__cozy.game.view.renderer.info;
          r.autoReset = false;
          requestAnimationFrame(() => {
            r.reset();
            requestAnimationFrame(() => {
              resolve({ calls: r.render.calls, triangles: r.render.triangles, geometries: r.memory.geometries, programs: r.programs?.length ?? 0 });
              r.autoReset = true;
            });
          });
        }),
    );
    console.log(`  one frame incl. shadows: ${info.calls} draw calls, ${info.triangles.toLocaleString()} triangles, ${info.geometries} geometries, ${info.programs} shader programs`);

    const runtimeErrors = await page.evaluate(() => window.__cozy.errors);
    check('no runtime errors', runtimeErrors.length === 0, runtimeErrors.join(' | '));
  } finally {
    check('no console errors', consoleErrors.length === 0, consoleErrors.slice(0, 8).join(' | '));
    await browser.close();
    await new Promise((r) => server.httpServer.close(r));
  }
}

main()
  .catch((err) => {
    problems.push(String(err?.stack ?? err));
  })
  .finally(() => {
    for (const c of checks) console.log(`${c.ok ? '✓' : '✗'} ${c.name}${c.detail && !c.ok ? ` (${c.detail})` : ''}`);
    if (problems.length) {
      console.error(`\nSmoke check failed:\n- ${problems.join('\n- ')}`);
      process.exit(1);
    }
    console.log('\nSmoke check passed.');
    process.exit(0);
  });
