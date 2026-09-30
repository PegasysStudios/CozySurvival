// Headless boot smoke check: builds the app, serves dist/, loads it in Chrome
// (SwiftShader WebGL), starts a run, walks, opens crafting, plays a two-tab
// multiplayer session over BroadcastChannel (?net=local), and fails on any
// console error or uncaught exception.
//
//   npm run smoke                 build + check
//   SMOKE_NO_BUILD=1 npm run smoke   reuse the existing dist/
//   CHROME_PATH=/path/to/chrome npm run smoke
import { existsSync } from 'node:fs';
import { build, loadEnv, preview } from 'vite';
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
    const env = loadEnv('production', process.cwd(), 'VITE_');
    const mpConfigured = !!(env.VITE_SUPABASE_URL && env.VITE_SUPABASE_PUBLISHABLE_KEY);
    const mpTitle = await page.evaluate(() => {
      const s = document.querySelector('.title-screen .mp-section');
      return { found: !!s, off: !!s?.classList.contains('off'), createDisabled: !!s?.querySelector('.mp-create')?.disabled, text: s?.textContent ?? '' };
    });
    if (mpConfigured) check('multiplayer section is live on the title screen', mpTitle.found && !mpTitle.off, JSON.stringify(mpTitle));
    else check('without Supabase env vars multiplayer is greyed out with a "not set up" note', mpTitle.found && mpTitle.off && mpTitle.createDisabled && /not set up/i.test(mpTitle.text), JSON.stringify(mpTitle));
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

    await page.evaluate(() => {
      const sim = window.__cozy.game.sim;
      sim.devGive('stick', 6);
      sim.devGive('stone', 6);
      sim.devGive('fiber', 6);
    });
    await sleep(200);

    await page.keyboard.press('KeyC');
    await sleep(300);
    const panel = await page.evaluate(() => ({
      mode: window.__cozy.game.mode,
      shown: document.querySelector('.panel-overlay')?.classList.contains('show'),
      recipes: document.querySelectorAll('.tile-grid .recipe').length,
      ready: document.querySelectorAll('.recipe.ready').length,
      greyed: document.querySelectorAll('.recipe.greyed').length,
      jonIcons: document.querySelectorAll('.tile .icon-img').length,
    }));
    check('crafting panel opens as a grid with every recipe, greyed where materials are short', panel.mode === 'panel' && panel.shown && panel.recipes >= 24 && panel.ready > 0 && panel.greyed > 0 && panel.jonIcons > 0, JSON.stringify(panel));

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
      // a campfire's 25 stone, 20 sticks and 5 fiber fill a starting pack on their own
      sim.state.inventory.slots.fill(null);
      sim.devGive('stone', 25);
      sim.devGive('stick', 20);
      sim.devGive('fiber', 5);
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
        placed.structures === good.structures + 1 && placed.stone === good.stone - 25 && placed.stick === good.stick - 20 && placed.fiber === good.fiber - 5 && !placed.placing,
        JSON.stringify({ before: [good.structures, good.stone, good.stick, good.fiber], after: [placed.structures, placed.stone, placed.stick, placed.fiber] }),
      );

      // The campfire opens its own menu, and Esc closes it without opening pause.
      await page.evaluate(() => {
        const sim = window.__cozy.game.sim;
        const fire = sim.state.structures[sim.state.structures.length - 1];
        sim.perform({ kind: 'structure', id: fire.id, dist: 1 });
      });
      await waitFrames(3);
      const fireMenu = await page.evaluate(() => ({
        mode: window.__cozy.game.mode,
        campfire: !!document.querySelector('.panel-campfire .fuel-meter'),
        fuelButtons: document.querySelectorAll('.panel-campfire .fuel-btn').length,
        tabs: document.querySelectorAll('.panel-campfire .tab').length,
      }));
      check('campfire opens its own menu with a fuel meter', fireMenu.mode === 'panel' && fireMenu.campfire && fireMenu.fuelButtons === 2 && fireMenu.tabs === 0, JSON.stringify(fireMenu));
      await page.keyboard.press('Escape');
      await waitFrames(3);
      const afterEsc = await page.evaluate(() => ({ mode: window.__cozy.game.mode, paused: document.querySelector('.pause-screen')?.classList.contains('show') ?? false }));
      check('Esc closes the campfire menu without pausing', afterEsc.mode === 'playing' && !afterEsc.paused, JSON.stringify(afterEsc));
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
    await page.close();

    // Multiplayer over BroadcastChannel: two tabs, host creates through the UI, guest joins from the list.
    const mpUrl = `http://127.0.0.1:${PORT}/?net=local&dev=1`;
    const openTab = async () => {
      const p = await browser.newPage();
      await p.setViewport({ width: 1100, height: 660 });
      p.on('console', (msg) => {
        if (msg.type() === 'error') consoleErrors.push(msg.text());
      });
      p.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`));
      await p.goto(mpUrl, { waitUntil: 'load', timeout: 60_000 });
      await p.waitForFunction(() => window.__cozy?.ready, { timeout: 90_000 });
      return p;
    };
    const fillForm = async (p, name, serverName) => {
      await p.waitForSelector('.mp-screen.show input[name="name"]', { timeout: 10_000 });
      await p.$eval('.mp-screen input[name="name"]', (e) => (e.value = ''));
      await p.type('.mp-screen input[name="name"]', name);
      if (serverName) await p.type('.mp-screen input[name="server"]', serverName);
      await p.click('.mp-screen .mp-avatar:nth-child(2)');
      await p.click('.mp-screen .mp-actions .btn.primary');
    };
    const hostTab = await openTab();
    const guestTab = await openTab();
    const mpTitleLocal = await hostTab.evaluate(() => document.querySelector('.mp-section .mp-pill')?.textContent ?? '');
    check('?net=local enables multiplayer in local test mode', /local test mode/i.test(mpTitleLocal), mpTitleLocal);

    await hostTab.bringToFront();
    await hostTab.click('.mp-section .mp-create');
    await fillForm(hostTab, 'Ana', 'Smoke camp');
    await hostTab.waitForFunction(() => window.__cozy.game.mp?.role === 'host' && window.__cozy.game.mode === 'playing', { timeout: 20_000, polling: 250 });
    const hostWorld = await hostTab.evaluate(() => ({ seed: window.__cozy.game.sim.state.seed, name: window.__cozy.game.mp.profile.name }));
    check('host creates a server with a brand-new world from the menu', hostWorld.name === 'Ana', JSON.stringify(hostWorld));

    await guestTab.bringToFront();
    const listed = await guestTab
      .waitForFunction(() => [...document.querySelectorAll('.mp-server')].some((r) => r.textContent.includes('Smoke camp')), { timeout: 20_000, polling: 250 })
      .then(() => true, () => false);
    check('the server shows up in the other tab\'s server list', listed);
    if (listed) {
      await guestTab.evaluate(() => [...document.querySelectorAll('.mp-server')].find((r) => r.textContent.includes('Smoke camp')).querySelector('.mp-join').click());
      await fillForm(guestTab, 'Ben');
      const joined = await guestTab
        .waitForFunction(() => window.__cozy.game.mp?.role === 'guest' && window.__cozy.game.mode === 'playing', { timeout: 30_000, polling: 250 })
        .then(() => true, () => false);
      const guestWorld = await guestTab.evaluate(() => ({ seed: window.__cozy.game.sim.state.seed, trees: window.__cozy.game.sim.state.trees.length }));
      check('guest joins from the list and gets the host\'s world', joined && guestWorld.seed === hostWorld.seed, JSON.stringify({ joined, guestWorld, host: hostWorld.seed }));

      const seeEach = async (p, other) => {
        await p.bringToFront();
        return p.waitForFunction((n) => {
          const g = window.__cozy.game;
          const peer = [...g.mp.peers.values()].find((q) => q.name === n);
          return !!peer?.target && g.view.avatars.group.children.length === 1;
        }, { timeout: 15_000, polling: 250 }, other).then(() => true, () => false);
      };
      check('host and guest see each other\'s avatars', (await seeEach(hostTab, 'Ben')) && (await seeEach(guestTab, 'Ana')));

      // Switching tabs drops pointer lock, which opens the (non-pausing) settings overlay.
      await guestTab.evaluate(() => {
        const g = window.__cozy.game;
        if (g.mode === 'paused') g.resume();
        g.input.locked = true;
      });
      await guestTab.keyboard.press('Enter');
      await guestTab.waitForSelector('.mp-chat.open .mp-input', { timeout: 5000 });
      await guestTab.keyboard.type('hello from the lake');
      await guestTab.keyboard.press('Enter');
      const chatArrived = await hostTab
        .waitForFunction(() => [...document.querySelectorAll('.mp-line')].some((l) => l.textContent.includes('hello from the lake')), { timeout: 10_000, polling: 250 })
        .then(() => true, () => false);
      check('chat typed in one tab arrives in the other', chatArrived);

      const gathered = await guestTab.evaluate(() => {
        const sim = window.__cozy.game.sim;
        const p = sim.state.player;
        const order = sim.state.resources
          .map((r, i) => ({ r, i, d: Math.hypot(sim.gen.resources[i].x - p.x, sim.gen.resources[i].z - p.z) }))
          .filter((o) => o.r.charges > 1)
          .sort((a, b) => a.d - b.d);
        for (const { r, i } of order.slice(0, 12)) {
          const before = r.charges;
          sim.perform({ kind: 'resource', index: i, dist: 1 });
          if (sim.state.resources[i].charges < before) return { index: i, charges: sim.state.resources[i].charges };
        }
        return null;
      });
      const synced = gathered && (await hostTab
        .waitForFunction((g) => window.__cozy.game.sim.state.resources[g.index].charges === g.charges, { timeout: 10_000, polling: 250 }, gathered)
        .then(() => true, () => false));
      check('a guest\'s gathering changes the host\'s world', !!synced, JSON.stringify(gathered));

      await hostTab.evaluate(() => window.__cozy.game.leaveMp(null));
      const closed = await guestTab
        .waitForFunction(() => window.__cozy.game.mode === 'title' && !window.__cozy.game.mp && /host closed the server/i.test(document.querySelector('.mp-notice')?.textContent ?? ''), { timeout: 10_000, polling: 250 })
        .then(() => true, () => false);
      check('closing the server sends the guest back to the menu with a note', closed);
      const hostBack = await hostTab.evaluate(() => ({ mode: window.__cozy.game.mode, mp: !!window.__cozy.game.mp }));
      check('the host returns to their single-player title screen', hostBack.mode === 'title' && !hostBack.mp, JSON.stringify(hostBack));
    }
    for (const p of [hostTab, guestTab]) runtimeErrors.push(...(await p.evaluate(() => window.__cozy?.errors ?? [])));

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
