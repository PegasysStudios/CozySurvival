import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ADDITIONAL_ICON_DIR, ADDITIONAL_ICON_FILES, ICON_DIR, ICON_FILES, iconFile, toolTier, type IconId } from '../src/data/icons';
import { GEAR, ITEMS, TOOLS } from '../src/data/items';
import { PREFABS } from '../src/data/prefabs';
import { anyIcon, gearIcon, itemIcon, prefabIcon, toolIcon } from '../src/ui/icons';

const src = (html: string) => /<img class="icon-img" src="([^"]+)"/.exec(html)?.[1] ?? null;

describe('UI icon mapping', () => {
  it('maps real ids to files that exist, and item, tool, gear and prefab ids never collide', () => {
    const groups = [ITEMS, TOOLS, GEAR, PREFABS].map((g) => Object.keys(g));
    const all = groups.flat();
    expect(new Set(all).size).toBe(all.length);
    for (const [id, tiers] of Object.entries(ICON_FILES)) {
      expect(all, id).toContain(id);
      for (const file of Object.values(tiers!)) expect(existsSync(`public/${ICON_DIR}${file}`), file).toBe(true);
    }
    for (const [id, file] of Object.entries(ADDITIONAL_ICON_FILES)) {
      expect(all, id).toContain(id);
      expect(existsSync(`public/${ADDITIONAL_ICON_DIR}${file}`), file).toBe(true);
      expect(src(anyIcon(id as IconId)), id).toBe(`/${ADDITIONAL_ICON_DIR}${file}`);
    }
  });

  it('picks the exact tier, else the nearest lower one, else nothing', () => {
    expect(iconFile('axe', 1)).toBe('04.png');
    expect(iconFile('axe', 2)).toBe('05.png');
    expect(iconFile('axe', 3)).toBe('06.png');
    // a level III axe (tier 4) keeps the highest tier Jon drew
    expect(iconFile('axe', 4)).toBe('06.png');
    // a tool with a single icon uses it at every level
    expect(iconFile('bow', toolTier(3))).toBe('08.png');
    expect(iconFile('torch', 1)).toBeNull();
    expect(iconFile('stick')).toBeNull();
  });

  it('tier 1 is the freshly crafted tool, so tier = upgrade level + 1', () => {
    expect([0, 1, 2, 3].map(toolTier)).toEqual([1, 2, 3, 4]);
    expect(src(toolIcon('axe'))).toBe(`/${ICON_DIR}04.png`);
    expect(src(toolIcon('axe', 1))).toBe(`/${ICON_DIR}05.png`);
    expect(src(toolIcon('axe', 2))).toBe(`/${ICON_DIR}06.png`);
    expect(src(toolIcon('axe', 3))).toBe(`/${ICON_DIR}06.png`);
  });

  it('prefers named artwork, then existing artwork, then the built-in SVG', () => {
    for (const id of Object.keys(ITEMS) as (keyof typeof ITEMS)[]) {
      const html = itemIcon(id);
      if (ADDITIONAL_ICON_FILES[id]) expect(src(html), id).toBe(`/${ADDITIONAL_ICON_DIR}${ADDITIONAL_ICON_FILES[id]}`);
      else if (ICON_FILES[id]) expect(src(html), id).toBe(`/${ICON_DIR}${ICON_FILES[id]![1]}`);
      else expect(html.startsWith('<svg'), id).toBe(true);
    }
    expect(src(toolIcon('torch', 3))).toBe(`/${ADDITIONAL_ICON_DIR}tool-torch.png`);
    expect(src(toolIcon('hands', 2))).toBe(`/${ADDITIONAL_ICON_DIR}empty-hand.png`);
    expect(src(gearIcon('canteen'))).toBe(`/${ICON_DIR}09.png`);
    expect(src(gearIcon('basket'))).toBe(`/${ADDITIONAL_ICON_DIR}item-grass-basket.png`);
    expect(src(gearIcon('backpack'))).toBe(`/${ADDITIONAL_ICON_DIR}item-hide-backpack.png`);
    expect(src(prefabIcon('campfire'))).toBe(`/${ADDITIONAL_ICON_DIR}item-campfire.png`);
    const ids: IconId[] = ['log', 'rod', 'backpack', 'campfire'];
    expect(ids.map((id) => anyIcon(id).startsWith('<img'))).toEqual([true, true, true, true]);
  });
});
