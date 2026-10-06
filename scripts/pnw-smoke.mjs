// Runtime-only browser checks for PNW terrain, wildlife and fishing. No screenshots, pixel reads or visual inspection.
// Build first with npm run build, then run npm run smoke:pnw.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
import { preview } from 'vite';

const chrome = [process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((path) => path && existsSync(path));
assert.ok(chrome, 'Set CHROME_PATH to an installed Chrome or Chromium executable.');
const server = await preview({ preview: { port: Number(process.env.SMOKE_PORT ?? 5300), strictPort: true, host: '127.0.0.1' }, logLevel: 'warn' });
let browser;
const errors = [];
try {
  browser = await puppeteer.launch({ executablePath: chrome, headless: true,
    args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--mute-audio'] });
  const page = await browser.newPage();
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.evaluateOnNewDocument(() => localStorage.setItem('cozysurvival.v1.meta', JSON.stringify({ version: 1, worldSeed: 42, best: null, deaths: 0, settings: {} })));
  const address = server.httpServer.address();
  await page.goto(`http://127.0.0.1:${address.port}/?dev=1`, { waitUntil: 'load', timeout: 90_000 });
  await page.waitForFunction(() => window.__cozy?.ready, { timeout: 90_000 });
  const frames = () => page.evaluate(() => new Promise((resolve) => {
    let n = 0;
    const tick = () => ++n === 4 ? resolve() : requestAnimationFrame(tick);
    requestAnimationFrame(tick);
  }));
  const inspect = () => page.evaluate(() => {
    const game = window.__cozy.game, sim = game.sim, info = game.view.renderer.info;
    return { biome: sim.biome, size: sim.terrain.size, generation: sim.state.pnwGen ?? 1, season: sim.season,
      trees: sim.gen.trees.length, resources: sim.gen.resources.length,
      chunks: game.view.forestTerrain?.group.children.length ?? 0,
      depthWidth: game.view.water.material.uniforms.uGrid?.value.x,
      half: game.view.water.material.uniforms.uHalf?.value,
      squirrels: sim.state.animals.filter((a) => a.species === 'squirrel').length,
      ambient: !!game.view.ambience,
      calls: info.render.calls, triangles: info.render.triangles, errors: window.__cozy.errors };
  });
  const initial = await inspect();
  assert.equal(initial.size, 616);
  assert.equal(initial.generation, 2);
  console.log('New PNW preview:', JSON.stringify(initial));

  // Reuse the same seed across old and new worlds: renderer reuse must include generation, not just seed/biome.
  for (const generation of [1, 2]) {
    await page.evaluate((revision) => {
      const game = window.__cozy.game;
      game.run.selectBiome('pnw');
      game.beginPlay(game.run.newRun(42, revision), true);
      game.input.locked = true;
    }, generation);
    await frames();
    const state = await inspect();
    assert.equal(state.size, generation === 1 ? 320 : 616);
    assert.equal(state.half, state.size / 2);
    assert.equal(state.depthWidth, state.size / 2 + 1);
    assert.equal(state.chunks > 0, generation === 2);
    assert.equal(state.squirrels, generation === 2 ? 128 : 32);
    assert.equal(state.ambient, true);
    assert.equal(state.errors.length, 0);
    console.log(`PNW generation ${generation}:`, JSON.stringify(state));
    const roundtrip = await page.evaluate(() => {
      const game = window.__cozy.game;
      game.sim.state.trees[0].hp = 1;
      game.sim.state.resources[0].charges = 0;
      game.run.save(game.sim);
      const loaded = game.run.loadCurrent();
      return { size: loaded.terrain.size, tree: loaded.state.trees[0].hp, charges: loaded.state.resources[0].charges };
    });
    assert.deepEqual(roundtrip, { size: state.size, tree: 1, charges: 0 });
  }

  for (const season of ['summer', 'fall', 'winter', 'spring']) {
    await page.evaluate((id) => {
      const game = window.__cozy.game;
      game.sim.devSetSeason(id);
      game.view.setWorld(game.sim);
    }, season);
    await frames();
    assert.equal((await inspect()).season, season);
  }
  const traverse = await page.evaluate(() => {
    const game = window.__cozy.game, sim = game.sim;
    const meadow = sim.terrain.pnw.meadow;
    Object.assign(sim.state.player, { x: meadow.x, z: meadow.z, y: sim.terrain.heightAt(meadow.x, meadow.z), vx: 0, vy: 0, vz: 0, grounded: true });
    const start = { x: sim.state.player.x, z: sim.state.player.z };
    for (let i = 0; i < 120; i++) sim.step(1 / 60, { moveX: 1, moveZ: 0, yaw: 0, pitch: 0 });
    game.syncCameraToPlayer();
    return { distance: Math.hypot(sim.state.player.x - start.x, sim.state.player.z - start.z), inBounds: sim.terrain.inPlayBounds(sim.state.player.x, sim.state.player.z) };
  });
  assert.ok(traverse.distance > 5 && traverse.inBounds, 'Player moves on the expanded meadow.');
  await frames();
  const wildlife = await page.evaluate(() => {
    const game = window.__cozy.game, sim = game.sim;
    sim.devSetSeason('summer');
    sim.state.weather.id = 'sunny';
    game.view.setWorld(sim);
    const ambient = game.view.ambience, bloom = game.view.nature.flowerPerches[0];
    sim.state.totalHours = 6; // Game time begins at 06:00, so this is noon.
    ambient.update(1, 5, bloom.x, bloom.z, sim.state);
    game.view.renderer.compile(game.view.scene, game.view.camera);
    game.view.renderer.render(game.view.scene, game.view.camera);
    const daylight = ambient.insects.filter((s) => s.rig.root.visible).length;
    const insectsAtScale = ambient.insects.filter((s) => s.rig.root.visible).every((s) => s.bodyMat.opacity > 0 && s.rig.root.scale.x === 1);
    sim.state.totalHours = 14; // 20:00
    ambient.update(1, 6, bloom.x, bloom.z, sim.state);
    const night = ambient.insects.filter((s) => s.rig.root.visible).length;
    const tree = sim.gen.trees.find((t) => sim.terrain.inPlayBounds(t.x, t.z, 30)
      && sim.terrain.slopeAt(t.x, t.z) < 0.5 && sim.terrain.field(t.x, t.z, 1) > 0.6);
    const wisps = [];
    for (const hours of [6, 18]) {
      sim.state.totalHours = hours;
      ambient.update(1, 7, tree.x, tree.z, sim.state);
      game.view.renderer.render(game.view.scene, game.view.camera);
      wisps.push(ambient.wisps.filter((w) => w.sprite.visible && w.sprite.material.opacity > 0).length);
    }
    const a = sim.state.animals.find((a) => a.species === 'squirrel'), tr = sim.gen.trees[0];
    Object.assign(a, { x: tr.x + tr.trunkR + 0.04, z: tr.z, y: sim.terrain.heightAt(tr.x, tr.z) + 4, tree: 0, climbHeight: 6, mode: 'climb' });
    game.view.entities.update(sim, 0.016, 8, a.x, a.z);
    const model = game.view.entities.animals.get(a.id).rig.root;
    const climbing = { y: model.position.y, tilt: model.rotation.x, visible: model.visible };
    a.mode = 'hide';
    game.view.entities.update(sim, 0.016, 8, a.x, a.z);
    const hidden = !model.visible;
    game.run.save(sim);
    const loaded = game.run.loadCurrent(), saved = loaded.state.animals.find((o) => o.id === a.id);
    return { daylight, night, wisps, insectsAtScale, caps: [ambient.insects.length, ambient.wisps.length], climbing, hidden,
      saved: { tree: saved.tree, mode: saved.mode, y: saved.y }, expectedY: a.y };
  });
  assert.ok(wildlife.daylight > 0);
  assert.equal(wildlife.insectsAtScale, true);
  assert.equal(wildlife.night, 0);
  assert.ok(wildlife.wisps.every((n) => n > 0 && n <= 2));
  assert.deepEqual(wildlife.caps, [16, 2]);
  assert.equal(wildlife.climbing.y, wildlife.expectedY);
  assert.equal(wildlife.climbing.tilt, -Math.PI / 2);
  assert.equal(wildlife.climbing.visible, true);
  assert.equal(wildlife.hidden, true);
  assert.deepEqual(wildlife.saved, { tree: 0, mode: 'hide', y: wildlife.expectedY });
  console.log('PNW wildlife runtime:', JSON.stringify(wildlife));
  // Observe actual world-camera draw submissions and projection sizes, rather than just Object3D.visible.
  // These checks do not capture, inspect, or read any pixels.
  const encounters = await page.evaluate(() => {
    const game = window.__cozy.game;
    const results = [];
    for (const generation of [1, 2]) for (const season of ['spring', 'summer']) {
      game.beginPlay(game.run.newRun(42, generation), true);
      game.mode = 'paused'; game.input.locked = false;
      const sim = game.sim, view = game.view, p = sim.state.player;
      const pose = { x: p.x, y: p.y + 1.6, z: p.z, yaw: p.yaw, pitch: 0, roll: 0, fov: 75 };
      sim.devSetSeason(season); sim.state.weather.id = 'sunny'; sim.state.totalHours = 6;
      view.setWorld(sim);
      const ambient = view.ambience, drawn = { butterfly: new Set(), dragonfly: new Set(), wisp: new Set(), squirrel: new Set() };
      for (const [i, s] of ambient.insects.entries()) s.rig.root.traverse((o) => {
        if (o.isMesh) o.onBeforeRender = (_r, _s, camera) => { if (camera === view.camera) drawn[s.rig.root.userData.kind].add(i); };
      });
      for (const [i, w] of ambient.wisps.entries()) w.sprite.onBeforeRender = (_r, _s, camera) => { if (camera === view.camera) drawn.wisp.add(i); };
      const warm = (hours, cameraPose) => {
        sim.state.totalHours = hours;
        for (let i = 0; i < 360; i++) ambient.update(1 / 60, i / 60, cameraPose.x, cameraPose.z, sim.state, cameraPose.yaw);
        for (const set of Object.values(drawn)) set.clear();
        view.frame(sim, 0, 6, cameraPose, null);
        return Object.fromEntries(Object.entries(drawn).map(([kind, set]) => [kind, set.size]));
      };
      const noon = warm(6, pose);
      const focal = view.renderer.domElement.clientHeight / (2 * Math.tan(view.camera.fov * Math.PI / 360));
      const projected = (position, size) => size * focal / -position.clone().applyMatrix4(view.camera.matrixWorldInverse).z;
      const readable = ambient.insects.filter((s, i) => drawn[s.rig.root.userData.kind].has(i) && projected(s.rig.root.position, 0.085) >= 3).length;
      const wispPixels = ambient.wisps.filter((w, i) => drawn.wisp.has(i)).map((w) => projected(w.sprite.position, 0.38));
      view.prepareCamera(sim);
      const unblockedWisps = ambient.wisps.filter((w, i) => {
        if (!drawn.wisp.has(i)) return false;
        const delta = w.sprite.position.clone().sub(view.camera.position), distance = delta.length();
        return view.cameraWorld.meshDistance(view.camera.position, delta.normalize(), distance) >= distance;
      }).length;
      const night = warm(18, pose);
      sim.state.weather.id = 'rainy';
      const rain = warm(6, pose);
      const squirrels = sim.state.animals.filter((a) => a.species === 'squirrel')
        .sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z));
      for (const a of squirrels) view.entities.animals.get(a.id).rig.root.traverse((o) => {
        if (o.isMesh) o.onBeforeRender = (_r, _s, camera) => { if (camera === view.camera) drawn.squirrel.add(a.id); };
      });
      const a = squirrels[0], distance = Math.hypot(a.x - p.x, a.z - p.z);
      const look = { ...pose, yaw: Math.atan2(-(a.x - p.x), -(a.z - p.z)), pitch: Math.atan2(a.y + 0.2 - pose.y, distance) };
      sim.state.weather.id = 'sunny';
      const forest = warm(6, look);
      results.push({ generation, season, noon, night, rain, readable, wispPixels, unblockedWisps, forestSquirrels: forest.squirrel, nearestSquirrel: distance });
    }
    return results;
  });
  for (const e of encounters) {
    assert.ok(e.noon.butterfly >= 2 && e.noon.dragonfly >= 2 && e.readable >= 4, `${e.season}: small insects reach the world camera at an encounter distance.`);
    assert.equal(e.noon.wisp, 2);
    assert.ok(e.wispPixels.every((p) => p >= 12));
    assert.ok(e.unblockedWisps >= 1, 'A wisp has an unobstructed ray through the world geometry.');
    assert.equal(e.night.butterfly + e.night.dragonfly, 0);
    assert.equal(e.night.wisp, 2);
    assert.equal(e.rain.butterfly + e.rain.dragonfly, 0);
    assert.ok(e.forestSquirrels >= 1 && e.nearestSquirrel >= 8 && e.nearestSquirrel <= 20);
  }
  console.log('PNW camera encounter runtime:', JSON.stringify(encounters));
  const fishing = await page.evaluate(() => {
    const game = window.__cozy.game, results = [];
    for (const generation of [1, 2]) {
      game.beginPlay(game.run.newRun(42, generation), true);
      game.mode = 'paused'; game.input.locked = false;
      const sim = game.sim, p = sim.state.player, catches = [new Set(), new Set()];
      sim.state.animals = []; sim.state.spawnCheckAt = Infinity;
      sim.state.inventory.slots.fill(null);
      sim.state.tools.push('rod'); sim.selectTool('rod');
      sim.state.skills.fishing = 1e6; sim.state.toolLevels.rod = 3;
      const step = (seconds, input = {}) => {
        const events = [];
        for (let i = 0; i < Math.round(seconds * 60); i++) {
          sim.step(1 / 60, { moveX: 0, moveZ: 0, yaw: p.yaw, pitch: 0, ...input });
          events.push(...sim.takeEvents([]));
        }
        return events;
      };
      for (const lakeIndex of [0, 1]) {
        const lake = sim.terrain.lakes[lakeIndex];
        let radius = 0;
        while (sim.terrain.heightAt(lake.x + radius, lake.z) < 0.3) radius += 0.25;
        Object.assign(p, { x: lake.x + radius, z: lake.z, y: sim.terrain.heightAt(lake.x + radius, lake.z), vx: 0, vy: 0, vz: 0, grounded: true, yaw: Math.PI / 2 });
        // Use a fresh pole for each body; leave the normal wear rules active while casting.
        delete sim.state.toolWear.rod;
        for (let cast = 0; cast < (lakeIndex === 0 ? 24 : 6); cast++) {
          Object.assign(sim.state.needs, { hunger: 100, thirst: 100, health: 100, warmth: 100, energy: 100 });
          step(1 / 60, { primary: true, primaryPressed: true });
          step(1.2, { primary: true });
          step(1 / 60, { primaryReleased: true });
          for (let i = 0; i < 510 && sim.fishing?.phase !== 'bite'; i++) step(1 / 60);
          if (sim.fishing?.phase !== 'bite') throw new Error(`Generation ${generation}, lake ${lakeIndex}: cast did not reach a bite.`);
          const species = sim.fishing.catch;
          if (step(1 / 60, { primary: true, primaryPressed: true }).some((e) => e.type === 'fishDone' && e.result === 'caught')) catches[lakeIndex].add(species);
          step(0.5);
        }
      }
      game.run.save(sim);
      const loaded = game.run.loadCurrent();
      game.panels.open('inventory');
      const packIcons = Array.from(game.panels.root.querySelectorAll('img')).map((img) => img.getAttribute('src'));
      // The new meals follow the existing day-1 crafting limit and become available on day 2.
      sim.state.totalHours = 24;
      game.panels.open('crafting', { tab: 'cooking' });
      const recipes = ['grilledBass', 'grilledSalmon'].map((id) => game.panels.root.querySelector(`[data-key="r:${id}"]`)?.getAttribute('aria-label'));
      const craftChecks = ['grilledBass', 'grilledSalmon'].map((id) => sim.canCraft(id).reason);
      game.panels.close();
      results.push({ generation, fishableLakes: sim.terrain.fishLakes.length, main: [...catches[0]].sort(), secondary: [...catches[1]],
        savedPack: JSON.stringify(loaded.state.inventory) === JSON.stringify(sim.state.inventory), recipes, craftChecks,
        bassIcon: packIcons.includes('/icons/additional-icons/fish-bass.png'), salmonIcon: packIcons.includes('/icons/additional-icons/fish-salmon.png') });
    }
    return results;
  });
  for (const f of fishing) {
    assert.ok(f.fishableLakes >= 2);
    assert.deepEqual(f.main, ['bass', 'salmon', 'trout']);
    assert.deepEqual(f.secondary, ['trout']);
    assert.equal(f.savedPack, true);
    assert.deepEqual(f.recipes, ['Grilled Bass', 'Grilled Salmon']);
    assert.deepEqual(f.craftChecks, ['station', 'station']);
    assert.ok(f.bassIcon && f.salmonIcon);
  }
  for (const name of ['fish-bass.png', 'fish-salmon.png', 'food-fish-cooked.png']) {
    assert.equal(await page.evaluate(async (file) => (await fetch(`/icons/additional-icons/${file}`)).ok, name), true);
  }
  console.log('PNW fishing runtime:', JSON.stringify(fishing));
  await frames();
  for (const biome of ['desert', 'island']) {
    await page.evaluate((id) => {
      const game = window.__cozy.game;
      game.run.selectBiome(id);
      game.beginPlay(game.run.newRun(42), true);
      game.input.locked = true;
    }, biome);
    await frames();
    const state = await inspect();
    assert.equal(state.size, biome === 'desert' ? 320 : 960);
    assert.equal(state.chunks, 0);
    assert.equal(state.squirrels, 0);
    assert.equal(state.ambient, false);
    assert.equal(state.errors.length, 0);
    console.log(`${biome}:`, JSON.stringify(state));
  }
  assert.deepEqual(errors, [], 'No browser, WebGL or shader errors.');
  console.log('PNW runtime smoke passed; no visual checks performed.');
} finally {
  await browser?.close();
  await new Promise((resolve) => server.httpServer.close(resolve));
}
