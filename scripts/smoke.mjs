// Headless boot smoke check: builds the app, serves dist/, loads it in Chrome
// (SwiftShader WebGL), starts a run, walks, opens crafting, plays a two-tab
// multiplayer session over BroadcastChannel (?net=local), and fails on any
// console error or uncaught exception. It also switches the title screen to the
// desert and island maps, plays them, measures frame time, draw calls and memory
// on all three, and saves title and first-person screenshots of each map.
// The multiplayer session runs on an island server.
//
//   npm run smoke                 build + check
//   SMOKE_SHOTS=/some/dir npm run smoke   where the screenshots go (default smoke-shots/)
//   SMOKE_NO_BUILD=1 npm run smoke   reuse the existing dist/
//   CHROME_PATH=/path/to/chrome npm run smoke
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { build, loadEnv, preview } from 'vite';
import puppeteer from 'puppeteer-core';

const PORT = Number(process.env.SMOKE_PORT ?? 5299);
const SHOTS_DIR = resolve(process.env.SMOKE_SHOTS ?? 'smoke-shots');
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

/** Title cards slide in with a CSS animation that only runs once frames render; clicks during it can miss. */
const settleTitle = (page) =>
  page.waitForFunction(() => document.getAnimations().every((a) => a.animationName !== 'rise' || a.playState === 'finished'), { timeout: 20_000, polling: 100 });

/**
 * Frame time over 90 frames (median and 95th percentile, headless software GL), one frame's draw calls and
 * triangles including shadows, live geometries and textures, and the JS heap.
 */
const perfLog = [];
async function measure(page, label) {
  const m = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const g = window.__cozy.game;
        const times = [];
        let last = performance.now();
        let i = 0;
        const f = (now) => {
          times.push(now - last);
          last = now;
          if (++i < 90) return requestAnimationFrame(f);
          times.shift();
          times.sort((a, b) => a - b);
          const r = g.view.renderer.info;
          r.autoReset = false;
          r.reset();
          // Collect first, so the heap is what the map keeps alive rather than garbage from the last one.
          window.gc?.();
          requestAnimationFrame(() => {
            const out = {
              medianMs: +times[Math.floor(times.length / 2)].toFixed(1),
              p95Ms: +times[Math.floor(times.length * 0.95)].toFixed(1),
              calls: r.render.calls,
              triangles: r.render.triangles,
              geometries: r.memory.geometries,
              textures: r.memory.textures,
              heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null,
              trees: g.sim.gen.trees.length,
              resources: g.sim.gen.resources.length,
              animals: g.sim.state.animals.length,
              worldSize: g.sim.terrain.size,
            };
            r.autoReset = true;
            resolve(out);
          });
        };
        requestAnimationFrame(f);
      }),
  );
  const entry = { label, ...m };
  perfLog.push(entry);
  console.log(`  perf ${label}: ${m.medianMs} ms median frame (p95 ${m.p95Ms}), ${m.calls} draw calls, ${m.triangles.toLocaleString()} triangles, ${m.geometries} geometries, heap ${m.heapMB} MB`);
  return entry;
}

const shots = [];
async function shoot(page, name) {
  mkdirSync(SHOTS_DIR, { recursive: true });
  const path = join(SHOTS_DIR, `${name}.png`);
  await page.screenshot({ path });
  shots.push(path);
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
      '--enable-precise-memory-info',
      '--js-flags=--expose-gc',
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
    const picker = await page.evaluate(() => ({
      arrows: document.querySelectorAll('.title-screen .title-row > .map-arrow').length,
      name: document.querySelector('.title-screen .map-name')?.textContent ?? '',
      biome: window.__cozy.game.sim.biome,
    }));
    check('title shows the map picker on the Pacific Northwest', picker.arrows === 2 && picker.name === 'Pacific Northwest' && picker.biome === 'pnw', JSON.stringify(picker));
    await settleTitle(page);
    await shoot(page, 'title-pnw');
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
    await shoot(page, 'gameplay-pnw');

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
    const dayOne = await page.evaluate(() => {
      const tiles = [...document.querySelectorAll('.tile-grid .recipe')];
      const axe = document.querySelector('.tile[data-key="r:axe"]');
      return {
        day: window.__cozy.game.sim.day,
        head: document.querySelector('.panel')?.textContent.includes('Day 1: only what your onboarding steps have reached'),
        tiles: tiles.length,
        locked: document.querySelectorAll('.tile-grid .tile-badge.locked').length,
        axeLocked: !!axe?.querySelector('.tile-badge.locked') && axe.classList.contains('greyed'),
      };
    });
    check('on day 1 recipes the onboarding has not reached are locked until tomorrow', dayOne.day === 1 && dayOne.head && dayOne.locked === dayOne.tiles && dayOne.axeLocked, JSON.stringify(dayOne));
    await page.keyboard.press('Escape');
    await sleep(250);
    await page.evaluate(() => {
      window.__cozy.game.input.locked = true;
      window.__cozy.game.sim.devNextMorning();
    });
    await page.waitForFunction(() => window.__cozy.game.sim.day === 2, { timeout: 15_000, polling: 100 });
    await page.keyboard.press('KeyC');
    await sleep(300);
    const panel = await page.evaluate(() => {
      const tabs = [...document.querySelectorAll('.craft-left > .craft-tabs > .craft-tab')];
      const out = {
        mode: window.__cozy.game.mode,
        shown: document.querySelector('.panel-overlay')?.classList.contains('show'),
        tabs: tabs.map((t) => t.dataset.tab),
        active: [...document.querySelectorAll('.craft-tab.active')].map((t) => t.dataset.tab),
        recipes: 0, ready: 0, greyed: 0, jonIcons: 0,
      };
      for (const id of out.tabs.filter((t) => t !== 'upgrades')) {
        document.querySelector(`.craft-tab[data-tab="${id}"]`).click();
        out.recipes += document.querySelectorAll('.tile-grid .recipe').length;
        out.ready += document.querySelectorAll('.recipe.ready').length;
        out.greyed += document.querySelectorAll('.recipe.greyed').length;
        out.jonIcons += document.querySelectorAll('.tile .icon-img').length;
      }
      document.querySelector('.craft-tab[data-tab="tools"]').click();
      return out;
    });
    check('crafting panel opens as a grid with every recipe across its tabs, greyed where materials are short', panel.mode === 'panel' && panel.shown && panel.recipes >= 26 && panel.ready > 0 && panel.greyed > 0 && panel.jonIcons > 0, JSON.stringify(panel));
    check('crafting tabs are six icon tabs, opening on Tools', panel.tabs.join() === 'tools,structures,cooking,upgrades,gear,materials' && panel.active.join() === 'tools', JSON.stringify(panel.tabs));
    await sleep(300);
    const tabLayout = () =>
      page.evaluate(() => {
        const box = (e) => e.getBoundingClientRect();
        const row = [...document.querySelectorAll('.craft-tab')].map(box);
        const icons = [...document.querySelectorAll('.craft-tab img')];
        return {
          rowRight: Math.max(...row.map((b) => b.right)),
          leftRight: box(document.querySelector('.craft-left')).right,
          detailLeft: box(document.querySelector('.craft-body > .recipe-detail')).left,
          rows: new Set(row.map((b) => Math.round(b.top))).size,
          icon: icons.map((i) => `${i.offsetWidth}x${i.offsetHeight}`).filter((v, k, a) => a.indexOf(v) === k),
          loaded: icons.every((i) => i.complete && i.naturalWidth > 0),
        };
      });
    const wide = await tabLayout();
    check('tab icons load, and the tab row sits in the left column clear of the detail panel', wide.loaded && wide.rows === 1 && wide.rowRight <= wide.leftRight + 0.5 && wide.rowRight < wide.detailLeft && wide.icon.join() === '40x40', JSON.stringify(wide));
    await page.setViewport({ width: 800, height: 600 });
    await sleep(200);
    const narrow = await tabLayout();
    check('in a narrow window the detail panel gives way, not the tab icons', narrow.rows === 1 && narrow.rowRight <= narrow.leftRight + 0.5 && narrow.rowRight < narrow.detailLeft && narrow.icon.join() === '40x40', JSON.stringify(narrow));
    await page.setViewport({ width: 1280, height: 720 });
    await sleep(200);
    const hoverTip = await page.evaluate(() => {
      document.querySelector('.craft-tab[data-tab="cooking"]').dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      const tip = document.querySelector('.tile-tip');
      return { text: tip.textContent, show: tip.classList.contains('show') };
    });
    check('hovering a tab names its category', hoverTip.text === 'Cooking' && hoverTip.show, JSON.stringify(hoverTip));

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
    const pnwPerf = await measure(page, 'Pacific Northwest');

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
    await page.evaluate(() => {
      document.querySelector('.craft-tab[data-tab="structures"]').click();
      [...document.querySelectorAll('.recipe')].find((r) => r.textContent.includes('Campfire'))?.click();
    });
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

    // Round 8: the canteen's Drink button, the repair workbench and the storage bin, through their menus.
    await page.evaluate(() => {
      const sim = window.__cozy.game.sim;
      if (!sim.state.gear.includes('canteen')) sim.state.gear.push('canteen');
      sim.devGive('lakeWater', 3);
      sim.state.needs.thirst = 40;
    });
    await lock();
    await page.keyboard.press('Tab');
    await sleep(250);
    await page.evaluate(() => [...document.querySelectorAll('.inv-section .tile')].find((t) => t.querySelector('.dur.water'))?.click());
    await sleep(150);
    const sip = await page.evaluate(() => {
      const s = window.__cozy.game.sim.state;
      const before = { water: s.canteen.lakeWater, thirst: s.needs.thirst, meter: !!document.querySelector('.canteen-detail .canteen-meter') };
      document.querySelector('.canteen-detail .btn.primary')?.click();
      return { before, after: { water: s.canteen.lakeWater, thirst: s.needs.thirst } };
    });
    check('the canteen opens an info panel whose Drink button takes one serving and quenches thirst', sip.before.meter && sip.after.water === sip.before.water - 1 && sip.after.thirst > sip.before.thirst, JSON.stringify(sip));
    await page.keyboard.press('Escape');
    await sleep(200);

    const build = (id, inputs) =>
      page.evaluate(
        ([prefab, give]) => {
          const sim = window.__cozy.game.sim;
          const s = sim.state;
          s.inventory.slots.fill(null);
          for (const [item, n] of Object.entries(give)) sim.devGive(item, n);
          if (!sim.beginPlacement(prefab)) return null;
          const p = s.player;
          for (let r = 2.5; r < 8; r += 0.5) {
            for (let a = 0; a < Math.PI * 2; a += Math.PI / 12) {
              sim.setPlacementAt(p.x + Math.cos(a) * r, p.z + Math.sin(a) * r);
              if (sim.placement?.valid && sim.confirmPlacement()) return s.structures[s.structures.length - 1].id;
            }
          }
          sim.cancelPlacement();
          return null;
        },
        [id, inputs],
      );
    const openStructure = (id) => page.evaluate((sid) => window.__cozy.game.sim.perform({ kind: 'structure', id: sid, dist: 1 }), id);

    const benchId = await build('workbench', { log: 8, stick: 12, stone: 10, cordage: 4 });
    check('the repair workbench can be built', benchId !== null);
    if (benchId !== null) {
      await page.evaluate(() => {
        const sim = window.__cozy.game.sim;
        const s = sim.state;
        for (const tool of ['axe', 'spear']) if (!s.tools.includes(tool)) s.tools.push(tool);
        s.toolWear.axe = { dur: 2, max: Math.max(10, s.toolWear.axe?.max ?? 10) };
        s.toolWear.spear = { dur: 1, max: Math.max(10, s.toolWear.spear?.max ?? 10) };
        s.inventory.slots.fill(null);
        for (const item of ['stick', 'stone', 'fiber']) sim.devGive(item, 1);
        Object.assign(s.needs, { health: 100, hunger: 100, thirst: 100 });
      });
      await openStructure(benchId);
      await waitFrames(3);
      const menu = await page.evaluate(() => {
        const tile = (tool) => document.querySelector(`.panel .tile-grid .tile[data-key="w:${tool}"]`);
        return {
          mode: window.__cozy.game.mode,
          tiles: [...document.querySelectorAll('.panel .tile-grid .tile')].map((t) => t.dataset.key),
          axe: { ready: tile('axe')?.classList.contains('ready') ?? false, greyed: tile('axe')?.classList.contains('greyed') ?? true, dur: !!tile('axe')?.querySelector('.dur i') },
          spearGreyed: tile('spear')?.classList.contains('greyed') ?? false,
          oldLayout: !!document.querySelector('.workbench-info, .repair-table, .repair-row'),
        };
      });
      check('the workbench menu is an icon grid of carried tools with durability bars, greyed without repair materials, and no how-repairs-work section', menu.mode === 'panel' && menu.tiles.includes('w:axe') && menu.axe.ready && !menu.axe.greyed && menu.axe.dur && menu.spearGreyed && !menu.oldLayout, JSON.stringify(menu));
      await page.click('.panel .tile-grid .tile[data-key="w:spear"]');
      await waitFrames(2);
      const spear = await page.evaluate(() => {
        const d = document.querySelector('.panel .repair-detail');
        return { tool: d?.dataset.tool, disabled: d?.querySelector('.btn.primary')?.disabled ?? false, missing: d?.querySelectorAll('.ingredient.missing').length ?? 0 };
      });
      check('clicking the greyed spear shows its missing materials and a disabled Repair button', spear.tool === 'spear' && spear.disabled && spear.missing > 0, JSON.stringify(spear));
      await page.click('.panel .tile-grid .tile[data-key="w:axe"]');
      await waitFrames(2);
      const detail = await page.evaluate(() => {
        const d = document.querySelector('.panel .repair-detail');
        return {
          tool: d?.dataset.tool,
          durability: d?.querySelector('.repair-cond span')?.textContent ?? '',
          counts: [...(d?.querySelectorAll('.ingredient b') ?? [])].map((b) => b.textContent),
          time: d?.querySelector('.repair-time')?.textContent ?? '',
          ready: d ? !d.querySelector('.btn.primary')?.disabled : false,
        };
      });
      check('clicking the axe shows its durability, materials as have/need, repair time and an enabled Repair button', detail.tool === 'axe' && /^\d+%$/.test(detail.durability) && detail.counts.length === 3 && detail.counts.every((c) => c === '1/1') && /\d s/.test(detail.time) && detail.ready, JSON.stringify(detail));
      await page.click('.panel .repair-detail .btn.primary');
      await waitFrames(3);
      const started = await page.evaluate(() => ({
        mode: window.__cozy.game.mode,
        repair: !!window.__cozy.game.sim.state.repair,
        ring: document.querySelector('.repair-ring')?.classList.contains('show') ?? false,
        x: window.__cozy.game.sim.state.player.x,
        z: window.__cozy.game.sim.state.player.z,
      }));
      check('pressing Repair closes the menu and shows the circular progress ring', started.mode === 'playing' && started.repair && started.ring, JSON.stringify(started));
      await lock();
      await page.keyboard.down('KeyW');
      await sleep(600);
      await page.keyboard.up('KeyW');
      const held = await page.evaluate(() => ({ x: window.__cozy.game.sim.state.player.x, z: window.__cozy.game.sim.state.player.z, repair: !!window.__cozy.game.sim.state.repair }));
      check('walking is locked while the repair runs', held.repair && Math.hypot(held.x - started.x, held.z - started.z) < 0.05, JSON.stringify({ started, held }));
      const mended = await page.evaluate(
        () =>
          new Promise((resolve) => {
            const t0 = performance.now();
            const poll = () => {
              const s = window.__cozy.game.sim.state;
              if (!s.repair || performance.now() - t0 > 45000) {
                resolve({ repair: !!s.repair, dur: s.toolWear.axe?.dur, max: s.toolWear.axe?.max, ring: document.querySelector('.repair-ring')?.classList.contains('show') ?? false });
              } else requestAnimationFrame(poll);
            };
            poll();
          }),
      );
      check('the repair finishes and restores full condition', !mended.repair && mended.dur > mended.max - 0.5 && !mended.ring, JSON.stringify(mended));
    }

    const binId = await build('storageBin', { stick: 24, fiber: 20, cordage: 3 });
    check('the storage bin can be built', binId !== null);
    if (binId !== null) {
      await page.evaluate(() => {
        const sim = window.__cozy.game.sim;
        sim.state.inventory.slots.fill(null);
        sim.devGive('stick', 5);
      });
      await openStructure(binId);
      await waitFrames(3);
      const binMenu = await page.evaluate(() => ({ mode: window.__cozy.game.mode, store: document.querySelectorAll('.store-grid .slot').length, pack: !!document.querySelector('.pack-grid .slot[data-item="stick"]') }));
      check('the storage bin opens with ten slots and the pack', binMenu.mode === 'panel' && binMenu.store === 10 && binMenu.pack, JSON.stringify(binMenu));
      const layout = await page.evaluate(() => {
        const box = (sel) => document.querySelector(sel)?.getBoundingClientRect() ?? null;
        const store = box('.storage-left > .store-col');
        const pack = box('.storage-left > .pack-col');
        const upgrade = box('.storage-body > .structure-upgrade');
        const slots = [...document.querySelectorAll('.store-grid .slot, .pack-grid .slot')].map((s) => Math.round(s.getBoundingClientRect().width));
        return {
          stacked: !!store && !!pack && pack.top >= store.bottom - 1 && Math.abs(pack.left - store.left) < 1,
          upgradeRight: !!upgrade && !!store && upgrade.left >= store.right,
          title: document.querySelector('.storage-body > .structure-upgrade h3')?.textContent ?? '',
          upgradeButton: !!document.querySelector('.storage-body > .structure-upgrade .btn.primary'),
          minSlot: Math.min(...slots),
        };
      });
      check('the bin menu stacks In storage over Your pack on the left, with the upgrade panel on the right and full-size slots', layout.stacked && layout.upgradeRight && /Upgrade to/.test(layout.title) && layout.upgradeButton && layout.minSlot >= 64, JSON.stringify(layout));
      await page.click('.pack-grid .slot[data-item="stick"]');
      await sleep(150);
      const stored = await page.evaluate((id) => {
        const s = window.__cozy.game.sim.state;
        const st = s.structures.find((x) => x.id === id);
        const count = (slots) => slots.reduce((n, x) => n + (x && x.item === 'stick' ? x.count : 0), 0);
        return { bin: count(st.store), pack: count(s.inventory.slots), shown: document.querySelectorAll('.store-grid .slot[data-item="stick"]').length };
      }, binId);
      check('clicking a pack stack moves it into the bin', stored.bin === 5 && stored.pack === 0 && stored.shown === 1, JSON.stringify(stored));
      await page.keyboard.press('Escape');
      await sleep(150);
      await page.evaluate(() => {
        const sim = window.__cozy.game.sim;
        for (const [item, n] of Object.entries({ log: 8, stick: 16, cordage: 6 })) sim.devGive(item, n);
      });
      await openStructure(binId);
      await waitFrames(3);
      await page.click('.storage-body > .structure-upgrade .btn.primary');
      await sleep(150);
      const grown = await page.evaluate((id) => {
        const st = window.__cozy.game.sim.state.structures.find((x) => x.id === id);
        return { prefab: st.prefab, slots: st.store.length, sticks: st.store.reduce((n, x) => n + (x && x.item === 'stick' ? x.count : 0), 0), shown: document.querySelectorAll('.store-grid .slot').length };
      }, binId);
      check('upgrading the bin in place grows it to fifteen slots and keeps what is inside', grown.prefab === 'storageCrate' && grown.slots === 15 && grown.sticks === 5 && grown.shown === 15, JSON.stringify(grown));
      await page.keyboard.press('Escape');
      await sleep(150);
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
    const deathDay = await page.evaluate(() => {
      window.__cozy.game.sim.state.totalHours += 3;
      return window.__cozy.game.sim.day;
    });
    const firstDeath = await die();
    check(
      'death screen shows days survived, best record and three options',
      firstDeath.buttons.length === 3 && /Retry the day/.test(firstDeath.buttons[0]) && /Restart from day 1/.test(firstDeath.buttons[1]) && /Start from scratch/.test(firstDeath.buttons[2]) && /Survived/.test(firstDeath.text) && firstDeath.text.includes(`Day ${deathDay}`) && /best/i.test(firstDeath.text),
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

    // Desert: pick the map on the title screen, play it, and come back to the Pacific Northwest run.
    // Players reach the title through the pause menu, which has already released the pointer lock.
    const quit = () => page.evaluate(() => {
      const g = window.__cozy.game;
      g.expectUnlock = true;
      document.exitPointerLock();
      g.input.locked = false;
      g.quitToTitle();
    });
    const titleState = () => page.evaluate(() => {
      const g = window.__cozy.game;
      return {
        mode: g.mode, run: g.run.biome, biome: g.sim.biome, seed: g.sim.state.seed, runId: g.sim.state.runId,
        name: document.querySelector('.title-screen .map-name')?.textContent ?? '',
        tagline: document.querySelector('.title-screen .tagline')?.textContent ?? '',
        primary: document.querySelector('.title-screen .btn.primary')?.textContent ?? '',
        fading: !!document.querySelector('.map-fade'),
      };
    });
    await quit();
    await settleTitle(page);
    const pnwBefore = await titleState();
    const pnwSave = await page.evaluate(() => localStorage.getItem('cozysurvival.v1.save'));
    await page.evaluate(() => {
      window.__fadeSeen = false;
      new MutationObserver(() => {
        if (document.querySelector('.map-fade')) window.__fadeSeen = true;
      }).observe(document.getElementById('app') ?? document.body, { childList: true, subtree: true });
    });
    await page.click('.title-screen .map-arrow.next');
    await page.waitForFunction(() => window.__cozy.game.run.biome === 'desert' && !document.querySelector('.map-fade'), { timeout: 20_000, polling: 100 }).catch(() => {});
    await settleTitle(page);
    const fadeStarted = await page.evaluate(() => window.__fadeSeen);
    const desertTitle = await titleState();
    check(
      'the right arrow cross-fades the title to the desert map',
      fadeStarted && !desertTitle.fading && desertTitle.mode === 'title' && desertTitle.run === 'desert' && desertTitle.biome === 'desert' && desertTitle.name === 'Arizona Desert' && /^Stranded in the Arizona desert/.test(desertTitle.tagline) && /Start surviving/.test(desertTitle.primary),
      JSON.stringify({ fadeStarted, ...desertTitle }),
    );
    await shoot(page, 'title-desert');
    await page.click('.title-screen .btn.primary');
    await sleep(500);
    await lock();
    const desertRun = await page.evaluate(() => {
      const g = window.__cozy.game;
      return { mode: g.mode, biome: g.sim.biome, day: g.sim.day, lakes: g.sim.terrain.lakes.map((l) => l.kind), saved: !!localStorage.getItem('cozysurvival.v1.save.desert'), pnwSave: localStorage.getItem('cozysurvival.v1.save') };
    });
    check(
      'a new desert run starts with its own save and leaves the forest save alone',
      desertRun.mode === 'playing' && desertRun.biome === 'desert' && desertRun.day === 1 && desertRun.lakes.includes('spring') && desertRun.lakes.includes('alkali') && desertRun.saved && desertRun.pnwSave === pnwSave,
      JSON.stringify({ ...desertRun, pnwSave: desertRun.pnwSave === pnwSave }),
    );
    await page.keyboard.down('KeyW');
    await sleep(1200);
    await page.keyboard.up('KeyW');
    await waitFrames(4);
    await shoot(page, 'gameplay-desert');
    await measure(page, 'Arizona Desert');
    await lock();
    await page.keyboard.press('KeyC');
    await sleep(300);
    const desertKeys = await page.evaluate(() => {
      const keys = [];
      for (const tab of document.querySelectorAll('.craft-tab')) {
        tab.click();
        keys.push(...[...document.querySelectorAll('.tile.recipe')].map((t) => t.dataset.key));
      }
      return keys;
    });
    check(
      'desert crafting offers the desert dishes and none of the forest-only ones',
      desertKeys.includes('r:desertSkewer') && desertKeys.includes('r:chiaFresca') && desertKeys.includes('r:campfire') && !desertKeys.includes('r:skewer') && !desertKeys.includes('r:stew'),
      desertKeys.join(','),
    );
    await page.keyboard.press('Escape');
    await sleep(200);
    await quit();
    await settleTitle(page);
    await page.keyboard.press('ArrowLeft');
    await page.waitForFunction(() => window.__cozy.game.sim.biome === 'pnw' && !document.querySelector('.map-fade'), { timeout: 20_000, polling: 100 }).catch(() => {});
    const backToPnw = await titleState();
    check(
      'ArrowLeft goes back to the forest, whose run still continues',
      backToPnw.biome === 'pnw' && backToPnw.name === 'Pacific Northwest' && backToPnw.seed === pnwBefore.seed && backToPnw.runId === pnwBefore.runId && /Continue/.test(backToPnw.primary),
      JSON.stringify(backToPnw),
    );
    await page.keyboard.press('ArrowRight');
    await page.waitForFunction(() => window.__cozy.game.sim.biome === 'desert' && !document.querySelector('.map-fade'), { timeout: 20_000, polling: 100 }).catch(() => {});
    const desertAgain = await titleState();
    check('the desert run can be continued too', desertAgain.biome === 'desert' && /Continue/.test(desertAgain.primary), JSON.stringify(desertAgain));

    // Island: the third map on the carousel, with its own save; it has to stay smooth at four times the area.
    const desertSave = await page.evaluate(() => localStorage.getItem('cozysurvival.v1.save.desert'));
    const pnwSaveNow = await page.evaluate(() => localStorage.getItem('cozysurvival.v1.save'));
    await page.evaluate(() => (window.__fadeSeen = false));
    const switchStart = Date.now();
    await page.click('.title-screen .map-arrow.next');
    await page.waitForFunction(() => window.__cozy.game.run.biome === 'island' && !document.querySelector('.map-fade'), { timeout: 30_000, polling: 100 }).catch(() => {});
    const switchMs = Date.now() - switchStart;
    await settleTitle(page);
    const islandTitle = await titleState();
    const islandFade = await page.evaluate(() => window.__fadeSeen);
    check(
      'the right arrow cross-fades the title to the island, the third map',
      islandFade && islandTitle.mode === 'title' && islandTitle.run === 'island' && islandTitle.biome === 'island' && islandTitle.name === 'Tropical Island' && /^Stranded on a tropical island/.test(islandTitle.tagline) && /Start surviving/.test(islandTitle.primary),
      JSON.stringify({ islandFade, ...islandTitle }),
    );
    const dots = await page.evaluate(() => ({ n: document.querySelectorAll('.title-screen .map-dots i').length, on: [...document.querySelectorAll('.title-screen .map-dots i')].findIndex((d) => d.classList.contains('on')) }));
    check('the map dots show three maps with the island third', dots.n === 3 && dots.on === 2, JSON.stringify(dots));
    console.log(`  switching the title to the island (world generation, terrain, water and nature) took ${switchMs} ms`);
    await shoot(page, 'title-island');
    await page.click('.title-screen .btn.primary');
    await sleep(500);
    await lock();
    const islandRun = await page.evaluate(() => {
      const g = window.__cozy.game;
      const isl = g.sim.terrain.island;
      return {
        mode: g.mode, biome: g.sim.biome, day: g.sim.day, size: g.sim.terrain.size,
        streams: isl?.streams.length ?? 0, caves: isl?.caves.length ?? 0, pools: g.sim.terrain.lakes.map((l) => l.kind),
        saved: !!localStorage.getItem('cozysurvival.v1.save.island'),
        desertSave: localStorage.getItem('cozysurvival.v1.save.desert'), pnwSave: localStorage.getItem('cozysurvival.v1.save'),
        objective: g.sim.currentObjective()?.title ?? '',
      };
    });
    check(
      'a new island run starts with its own save and leaves the forest and desert saves alone',
      islandRun.mode === 'playing' && islandRun.biome === 'island' && islandRun.day === 1 && islandRun.size > 320 && islandRun.streams >= 2 && islandRun.caves >= 2 && islandRun.pools.includes('plunge') && islandRun.saved && islandRun.desertSave === desertSave && islandRun.pnwSave === pnwSaveNow,
      JSON.stringify({ ...islandRun, desertSave: islandRun.desertSave === desertSave, pnwSave: islandRun.pnwSave === pnwSaveNow }),
    );
    check('island onboarding starts with finding fresh water', /fresh water/i.test(islandRun.objective), islandRun.objective);
    await page.keyboard.down('KeyW');
    await sleep(1400);
    await page.keyboard.up('KeyW');
    await waitFrames(4);
    await shoot(page, 'gameplay-island');
    const islandPerf = await measure(page, 'Tropical Island');
    check(
      'the island (four times the area) renders within twice the forest\'s frame time and draw calls',
      islandPerf.medianMs <= pnwPerf.medianMs * 2 && islandPerf.calls <= pnwPerf.calls * 2.5,
      JSON.stringify({ island: islandPerf, pnw: pnwPerf }),
    );
    const salt = await page.evaluate(() => {
      const sim = window.__cozy.game.sim;
      const p = sim.state.player;
      for (let r = 2; r < 80; r += 1) {
        for (let k = 0; k < 32; k++) {
          const x = p.x + Math.cos((k / 32) * Math.PI * 2) * r;
          const z = p.z + Math.sin((k / 32) * Math.PI * 2) * r;
          if (sim.terrain.heightAt(x, z) < -0.3 && sim.terrain.lakeAt(x, z)?.kind === 'sea') {
            const thirst = sim.state.needs.thirst;
            sim.target = { kind: 'water', dist: 1, x, z };
            const info = sim.describeTarget();
            sim.actionCooldown = 0;
            sim.perform(sim.target);
            return { info, thirst: [thirst, sim.state.needs.thirst], refused: sim.state.stats.events.saltRefused ?? 0 };
          }
        }
      }
      return null;
    });
    check('sea water is salt: it can\'t be drunk and says so', !!salt && salt.info?.enabled === false && /salt/i.test(salt.info.action) && salt.refused === 1 && salt.thirst[1] <= salt.thirst[0], JSON.stringify(salt));
    await lock();
    await page.keyboard.press('KeyC');
    await sleep(300);
    const islandKeys = await page.evaluate(() => {
      const keys = [];
      for (const tab of document.querySelectorAll('.craft-tab')) {
        tab.click();
        keys.push(...[...document.querySelectorAll('.tile.recipe')].map((t) => t.dataset.key));
      }
      return keys;
    });
    check(
      'island crafting offers the island dishes and none of the forest or desert ones',
      islandKeys.includes('r:beachSkewer') && islandKeys.includes('r:coconutFish') && islandKeys.includes('r:poi') && islandKeys.includes('r:campfire') && islandKeys.includes('r:knife') && !islandKeys.includes('r:skewer') && !islandKeys.includes('r:desertSkewer'),
      islandKeys.join(','),
    );
    await page.keyboard.press('Escape');
    await sleep(200);
    await quit();
    await settleTitle(page);
    await page.keyboard.press('ArrowLeft');
    await page.waitForFunction(() => window.__cozy.game.sim.biome === 'desert' && !document.querySelector('.map-fade'), { timeout: 30_000, polling: 100 }).catch(() => {});
    const desertBack = await titleState();
    await page.keyboard.press('ArrowRight');
    await page.waitForFunction(() => window.__cozy.game.sim.biome === 'island' && !document.querySelector('.map-fade'), { timeout: 30_000, polling: 100 }).catch(() => {});
    const islandAgain = await titleState();
    check(
      'the desert and the island each continue their own run',
      desertBack.biome === 'desert' && /Continue/.test(desertBack.primary) && islandAgain.biome === 'island' && /Continue/.test(islandAgain.primary),
      JSON.stringify({ desertBack, islandAgain }),
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
    const hostWorld = await hostTab.evaluate(() => ({ seed: window.__cozy.game.sim.state.seed, biome: window.__cozy.game.sim.biome, name: window.__cozy.game.mp.profile.name }));
    check('host creates a server with a brand-new world on the selected map (the island)', hostWorld.name === 'Ana' && hostWorld.biome === 'island', JSON.stringify(hostWorld));

    await guestTab.bringToFront();
    const listed = await guestTab
      .waitForFunction(() => [...document.querySelectorAll('.mp-server')].some((r) => r.textContent.includes('Smoke camp') && r.textContent.includes('Tropical Island')), { timeout: 20_000, polling: 250 })
      .then(() => true, () => false);
    check('the server shows up in the other tab\'s server list with its map', listed);
    if (listed) {
      await guestTab.evaluate(() => [...document.querySelectorAll('.mp-server')].find((r) => r.textContent.includes('Smoke camp')).querySelector('.mp-join').click());
      await fillForm(guestTab, 'Ben');
      const joined = await guestTab
        .waitForFunction(() => window.__cozy.game.mp?.role === 'guest' && window.__cozy.game.mode === 'playing', { timeout: 30_000, polling: 250 })
        .then(() => true, () => false);
      const guestWorld = await guestTab.evaluate(() => ({ seed: window.__cozy.game.sim.state.seed, biome: window.__cozy.game.sim.biome, trees: window.__cozy.game.sim.state.trees.length }));
      check('guest joins from the list and gets the host\'s world and map', joined && guestWorld.seed === hostWorld.seed && guestWorld.biome === hostWorld.biome, JSON.stringify({ joined, guestWorld, host: hostWorld }));

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
    const missing = ['title-pnw', 'title-desert', 'title-island', 'gameplay-pnw', 'gameplay-desert', 'gameplay-island'].map((n) => join(SHOTS_DIR, `${n}.png`)).filter((f) => !shots.includes(f) || !existsSync(f) || statSync(f).size < 10_000);
    if (perfLog.length) {
      mkdirSync(SHOTS_DIR, { recursive: true });
      writeFileSync(join(SHOTS_DIR, 'perf.json'), JSON.stringify(perfLog, null, 2) + '\n');
    }
    check('screenshots saved', missing.length === 0, `missing ${missing.join(', ')}`);
    for (const f of shots) console.log(`  screenshot: ${f}`);
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
