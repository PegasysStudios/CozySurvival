// Build first (npm run build). Checks real PNW dialog input, quests, stations, persistence and map isolation.
// Optional screenshots: SMOKE_SHOTS=smoke-shots/oruun npm run smoke:oruun.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import puppeteer from 'puppeteer-core';
import { preview } from 'vite';

const chrome = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((p) => p && existsSync(p));
assert.ok(chrome, 'Set CHROME_PATH to Chrome or Chromium.');
const shots = process.env.SMOKE_SHOTS ? resolve(process.env.SMOKE_SHOTS) : null;
if (shots) mkdirSync(shots, { recursive: true });
const server = await preview({ preview: { port: Number(process.env.SMOKE_PORT ?? 5301), strictPort: true, host: '127.0.0.1' }, logLevel: 'warn' });
let browser;
const errors = [];
try {
  browser = await puppeteer.launch({ executablePath: chrome, headless: true,
    args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--mute-audio'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?dev=1`, { waitUntil: 'load', timeout: 90_000 });
  await page.waitForFunction(() => window.__cozy?.ready, { timeout: 90_000 });
  const frames = () => page.evaluate(() => new Promise((resolve) => {
    let n = 0;
    const frame = () => ++n === 4 ? resolve() : requestAnimationFrame(frame);
    requestAnimationFrame(frame);
  }));
  const screenshot = async (name) => { if (shots) { await frames(); await page.screenshot({ path: join(shots, `${name}.png`) }); } };
  const camp = await page.evaluate(() => {
    const game = window.__cozy.game;
    game.run.selectBiome('pnw'); game.beginPlay(game.run.newRun(42), false);
    game.mode = 'paused'; game.input.locked = false;
    const sim = game.sim, camp = sim.state.settlements[0], spawn = { ...sim.state.player };
    sim.devSetSeason('spring'); sim.state.totalHours = 6; sim.state.weather.id = 'sunny';
    Object.assign(sim.state.player, { x: camp.x, z: camp.z + 20, y: sim.terrain.heightAt(camp.x, camp.z) + 4, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: -0.24 });
    game.syncCameraToPlayer(); game.hud.setVisible(false);
    return { tribe: camp.tribe, members: camp.members.length, prefabs: camp.structures.map((st) => st.prefab),
      distance: Math.hypot(camp.x - spawn.x, camp.z - spawn.z), opposite: camp.x * spawn.x + camp.z * spawn.z <= 0 };
  });
  assert.equal(camp.members, 5); assert.ok(camp.distance > 300 && camp.opposite);
  assert.deepEqual(camp.prefabs, ['campfire', 'hideTent', 'hideTent', 'storageBin', 'workbench']);
  await screenshot('camp');

  if (shots) for (const member of ['aven', 'neri', 'tor', 'sela', 'lio']) {
    await page.evaluate((id) => {
      const game = window.__cozy.game, sim = game.sim, n = sim.state.settlements[0].members.find((v) => v.id === id);
      n.heading = 0;
      Object.assign(sim.state.player, { x: n.x, z: n.z + 3.3, y: n.y, yaw: 0, pitch: -0.12 });
      game.syncCameraToPlayer();
    }, member);
    await screenshot(member);
  }

  // Reach the elder and left-click through the actual canvas/Input/Game/Simulation event path.
  await page.evaluate(() => {
    const game = window.__cozy.game, sim = game.sim, n = sim.state.settlements[0].members[0];
    Object.assign(sim.state.player, { x: n.x, z: n.z + 2.3, y: sim.terrain.heightAt(n.x, n.z + 2.3), yaw: 0, pitch: 0 });
    game.syncCameraToPlayer(); game.hud.setVisible(true); game.mode = 'playing'; game.input.locked = true;
  });
  await page.click('canvas.view');
  await page.waitForSelector('.panel-dialog [data-quest-action="accept"]');
  assert.ok(await page.$eval('.dialog-speech', (el) => el.textContent.includes('twelve sticks')));
  await screenshot('offer');
  await page.$$eval('.dialog-actions button', (buttons) => buttons.find((b) => b.textContent === 'No').click());
  assert.equal(await page.evaluate(() => !!window.__cozy.game.sim.state.questLog.active), false);
  await page.evaluate(() => {
    const game = window.__cozy.game; game.sim.actionCooldown = 0; game.sim.talkTo('oruun', 'aven');
  });
  await page.waitForSelector('.panel-dialog [data-quest-action="accept"]');
  await page.locator('[data-quest-action="accept"]').click();
  assert.equal(await page.evaluate(() => window.__cozy.game.sim.state.questLog.active.id), 'oruun-firewood');
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.__cozy.game.sim.talkTo('oruun', 'aven'));
  await page.waitForSelector('[data-quest-action="deliver"]');
  assert.equal(await page.$eval('[data-quest-action="deliver"]', (b) => b.disabled), true);
  await page.evaluate(() => { const game = window.__cozy.game; game.sim.devGive('stick', 12); game.panels.refresh(); });
  await page.locator('[data-quest-action="deliver"]').click();
  const quest = await page.evaluate(() => {
    const game = window.__cozy.game;
    game.run.save(game.sim);
    const loaded = game.run.loadCurrent();
    return { log: loaded.state.questLog, campCount: loaded.state.settlements.length, ownBuilds: loaded.state.structures.length };
  });
  assert.deepEqual(quest.log.tribes.oruun, { discovered: true, completed: 1, reputation: 3 });
  assert.equal(quest.campCount, 1); assert.equal(quest.ownBuilds, 0);
  await screenshot('thanks');
  await page.keyboard.press('Escape');
  await page.keyboard.press('KeyC');
  await page.waitForSelector('.menu-section[data-section="skills"]');
  await page.locator('.menu-section[data-section="skills"]').click();
  assert.ok(await page.$eval('[data-reputation="oruun"]', (el) => el.textContent.includes('3 / 100') && el.textContent.includes('Sela')));
  await page.$eval('[data-reputation="oruun"]', (el) => el.scrollIntoView({ block: 'center' }));
  await screenshot('skills');

  // Station menus retain the established cooking/repair behavior, and village storage is informational.
  const stations = await page.evaluate(() => {
    const game = window.__cozy.game, sim = game.sim, camp = sim.state.settlements[0], results = [];
    for (const prefab of ['campfire', 'workbench', 'storageBin', 'hideTent']) {
      const st = camp.structures.find((v) => v.prefab === prefab);
      sim.perform({ kind: 'structure', id: st.id, dist: 1 });
      results.push({ prefab, opens: sim.takeEvents([]).filter((e) => ['openCooking', 'openStructure', 'openTribeStation'].includes(e.type)).map((e) => e.type) });
    }
    return results;
  });
  assert.deepEqual(stations.map((v) => v.opens[0]), ['openCooking', 'openStructure', 'openTribeStation', 'openTribeStation']);

  for (const biome of ['desert', 'island']) {
    await page.evaluate((id) => {
      const game = window.__cozy.game; game.run.selectBiome(id); game.beginPlay(game.run.newRun(42), false);
      game.mode = 'paused'; game.input.locked = false; game.panels.open('crafting', { section: 'skills' });
    }, biome);
    await frames();
    assert.equal(await page.evaluate(() => window.__cozy.game.sim.state.settlements?.length ?? 0), 0);
    assert.equal(await page.$('[data-reputation]'), null);
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(await page.evaluate(() => window.__cozy.errors), []);
  console.log('Oruun browser checks passed:', JSON.stringify({ camp, progress: quest.log.tribes.oruun, shots }));
} finally {
  await browser?.close();
  await new Promise((resolve) => server.httpServer.close(resolve));
}
