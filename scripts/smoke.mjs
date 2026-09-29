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

    const runtimeErrors = [];
    const collectRuntimeErrors = async () => runtimeErrors.push(...(await page.evaluate(() => window.__cozy?.errors ?? [])));
    const waitFrames = (n) =>
      page.evaluate(
        (k) =>
          new Promise((resolve) => {
            let i = 0;
            const f = () => (++i >= k ? resolve() : requestAnimationFrame(f));
            requestAnimationFrame(f);
          }),
        n,
      );
    const state = () =>
      page.evaluate(() => {
        const g = window.__cozy.game;
        const s = g.sim.state;
        const count = (id) => s.inventory.slots.reduce((n, x) => n + (x && x.item === id ? x.count : 0), 0);
        return {
          mode: g.mode, dead: s.dead, day: g.sim.day, hours: s.totalHours, runId: s.runId, seed: s.seed,
          structures: s.structures.length, stone: count('stone'), stick: count('stick'), fiber: count('fiber'),
          slots: JSON.stringify(s.inventory.slots), x: s.player.x, z: s.player.z,
          placing: g.sim.placement ? { valid: g.sim.placement.valid, reason: g.sim.placement.reason, rot: g.sim.placement.rot } : null,
          best: g.run.meta.best, deaths: g.run.meta.deaths,
        };
      });
    const lock = () => page.evaluate(() => (window.__cozy.game.input.locked = true));

    // Placement through real input: crafting menu -> ghost -> red/green -> rotate -> click to place.
    await page.evaluate(() => {
      const sim = window.__cozy.game.sim;
      if (!sim.state.known.includes('campfire')) sim.state.known.push('campfire');
      sim.devGive('stone', 5);
      sim.devGive('stick', 4);
      sim.devGive('fiber', 1);
    });
    await lock();
    await page.keyboard.press('KeyC');
    await sleep(250);
    await page.evaluate(() => [...document.querySelectorAll('.recipe')].find((r) => r.textContent.includes('Campfire'))?.click());
    await sleep(200);
    await page.click('.recipe-detail .btn.primary');
    await sleep(250);
    await lock();
    const ghostColor = () => page.evaluate(() => window.__cozy.game.view.ghost.bodyMat.color.getHexString());
    const placeStart = await state();
    check('crafting menu enters placement mode', placeStart.mode === 'playing' && !!placeStart.placing, JSON.stringify(placeStart.placing));

    // Re-centre the cursor while unlocked so the placement clicks below don't register as mouse-look.
    await page.evaluate(() => (window.__cozy.game.input.locked = false));
    await page.mouse.move(640, 360);
    await lock();
    await page.evaluate(() => (window.__cozy.game.pitch = -1.5));
    await waitFrames(3);
    const bad = await state();
    const badColor = await ghostColor();
    check('ghost shows red where placement is blocked', bad.placing && !bad.placing.valid && badColor === 'ff6b5e', `${JSON.stringify(bad.placing)} #${badColor}`);
    await page.mouse.click(640, 360);
    await waitFrames(3);
    const afterBad = await state();
    check('clicking an invalid spot places nothing and spends nothing', afterBad.structures === bad.structures && afterBad.stone === bad.stone && !!afterBad.placing);

    await page.keyboard.press('KeyR');
    await waitFrames(2);
    const rotated = await state();
    check('R rotates the ghost', rotated.placing && Math.abs(rotated.placing.rot - bad.placing.rot - Math.PI / 4) < 1e-6);

    const baseYaw = await page.evaluate(() => window.__cozy.game.sim.state.player.yaw);
    let good = null;
    for (let k = 0; k < 16 && !good; k++) {
      await page.evaluate(([y, p]) => Object.assign(window.__cozy.game, { yaw: y, pitch: p }), [baseYaw + (k * Math.PI) / 8, -0.55]);
      await waitFrames(3);
      const st = await state();
      if (st.placing?.valid) good = st;
    }
    const goodColor = await ghostColor();
    check('ghost shows green on open flat ground', !!good && goodColor === '7be38a', `#${goodColor}`);
    if (good) {
      await page.mouse.click(640, 360);
      await waitFrames(3);
      const placed = await state();
      check(
        'clicking a valid spot builds it and spends the ingredients',
        placed.structures === good.structures + 1 && placed.stone === good.stone - 5 && placed.stick === good.stick - 4 && placed.fiber === good.fiber - 1 && !placed.placing,
        JSON.stringify({ before: [good.structures, good.stone, good.stick, good.fiber], after: [placed.structures, placed.stone, placed.stick, placed.fiber] }),
      );
    }

    // Save survives a reload and Continue resumes the same run.
    await page.evaluate(() => {
      const g = window.__cozy.game;
      g.input.locked = false;
      g.saveNow();
    });
    await waitFrames(2);
    const saved = await state();
    await collectRuntimeErrors();
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => window.__cozy?.ready, { timeout: 90_000 });
    await sleep(600);
    const continueText = await page.$eval('.title-screen .btn.primary', (e) => e.textContent ?? '');
    check('reload offers Continue', /Continue/.test(continueText), continueText);
    await page.click('.title-screen .btn.primary');
    await sleep(300);
    const resumed = await state();
    check(
      'save survives a reload',
      resumed.mode === 'playing' && resumed.runId === saved.runId && Math.abs(resumed.hours - saved.hours) < 0.01 && resumed.slots === saved.slots && resumed.structures === saved.structures && Math.hypot(resumed.x - saved.x, resumed.z - saved.z) < 1e-6,
      JSON.stringify({ saved: [saved.runId, saved.hours, saved.structures], resumed: [resumed.runId, resumed.hours, resumed.structures] }),
    );

    // Death screen and its three options.
    const die = async () => {
      await lock();
      await page.evaluate(() => window.__cozy.game.sim.devDamage(1000));
      await page.waitForFunction(() => document.querySelector('.death-screen')?.classList.contains('show'), { timeout: 60_000 });
      await sleep(150);
      return page.evaluate(() => ({
        buttons: [...document.querySelectorAll('.death-screen .death-actions .btn')].map((b) => b.textContent ?? ''),
        text: document.querySelector('.death-screen')?.textContent ?? '',
      }));
    };
    const snapHours = await page.evaluate(() => JSON.parse(localStorage.getItem('cozysurvival.v1.daySnapshot')).totalHours);
    await page.evaluate(() => (window.__cozy.game.sim.state.totalHours += 3));
    const firstDeath = await die();
    check(
      'death screen shows days survived, best record and three options',
      firstDeath.buttons.length === 3 && /Retry the day/.test(firstDeath.buttons[0]) && /Restart from day 1/.test(firstDeath.buttons[1]) && /Start from scratch/.test(firstDeath.buttons[2]) && /Survived/.test(firstDeath.text) && /Day 1/.test(firstDeath.text) && /best/i.test(firstDeath.text),
      JSON.stringify(firstDeath.buttons),
    );
    const beforeRetry = await state();
    await page.click('.death-screen .death-actions .btn:nth-child(1)');
    await sleep(300);
    const retried = await state();
    check(
      'Retry the day restores the morning snapshot of the same run',
      retried.mode === 'playing' && !retried.dead && retried.runId === beforeRetry.runId && beforeRetry.hours - snapHours > 2.9 && Math.abs(retried.hours - snapHours) < 0.01 && retried.structures === 0 && !!retried.best,
      JSON.stringify({ diedAt: beforeRetry.hours, hours: retried.hours, snapHours, structures: retried.structures }),
    );

    await die();
    const beforeRestart = await state();
    await page.click('.death-screen .death-actions .btn:nth-child(2)');
    await sleep(300);
    const restarted = await state();
    check(
      'Restart from day 1 starts a new run in the same world and keeps the record',
      restarted.mode === 'playing' && !restarted.dead && restarted.day === 1 && restarted.seed === beforeRestart.seed && restarted.runId !== beforeRestart.runId && !!restarted.best && restarted.deaths === 2,
      JSON.stringify({ seed: [beforeRestart.seed, restarted.seed], deaths: restarted.deaths, best: restarted.best }),
    );

    await die();
    const beforeScratch = await state();
    await collectRuntimeErrors();
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => window.__cozy?.ready, { timeout: 90_000 });
    await sleep(400);
    check('a reload on the death screen returns to the death screen', await page.$eval('.death-screen', (e) => e.classList.contains('show')));
    await page.click('.death-screen .death-actions .btn:nth-child(3)');
    await sleep(150);
    const confirmText = await page.$eval('.death-screen .death-actions .btn:nth-child(3)', (e) => e.textContent ?? '');
    await page.click('.death-screen .death-actions .btn:nth-child(3)');
    await sleep(300);
    const scratch = await state();
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('cozysurvival.v1.meta')));
    check(
      'Start from scratch asks to confirm, then wipes records and makes a new world',
      /click again/i.test(confirmText) && scratch.mode === 'playing' && scratch.day === 1 && scratch.seed !== beforeScratch.seed && scratch.best === null && scratch.deaths === 0 && stored.best === null && stored.worldSeed === scratch.seed,
      JSON.stringify({ confirmText, seed: [beforeScratch.seed, scratch.seed], best: scratch.best, deaths: scratch.deaths }),
    );

    await collectRuntimeErrors();
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
