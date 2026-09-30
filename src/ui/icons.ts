import { ICON_DIR, iconFile, toolTier, type IconId } from '../data/icons';
import type { GearId, ItemId, ToolId } from '../data/items';
import type { PrefabId } from '../data/prefabs';

const svg = (body: string) => `<svg viewBox="0 0 32 32" aria-hidden="true">${body}</svg>`;

const ITEM_ICONS: Record<ItemId, string> = {
  stick: svg('<path d="M6 26 26 6" stroke="#8a5a2b" stroke-width="4" stroke-linecap="round"/><path d="M15 17l6 2" stroke="#8a5a2b" stroke-width="2.5" stroke-linecap="round"/><path d="M20 12l-1-5" stroke="#6f4722" stroke-width="2" stroke-linecap="round"/>'),
  stone: svg('<path d="M6 21c0-6 5-11 11-11 6 0 9 4 9 9 0 4-4 7-10 7S6 25 6 21z" fill="#9aa0a6"/><path d="M10 17c2-3 5-4 8-4" stroke="#c4c9cd" stroke-width="2" fill="none" stroke-linecap="round"/>'),
  fiber: svg('<path d="M9 27C9 17 12 10 16 5M16 27c0-9 1-15 5-21M23 27c-1-8-4-14-10-19" stroke="#7fae5a" stroke-width="2.5" fill="none" stroke-linecap="round"/>'),
  berries: svg('<circle cx="12" cy="18" r="6" fill="#f08a3c"/><circle cx="21" cy="20" r="5" fill="#e8683a"/><circle cx="17" cy="11" r="4.5" fill="#f5a04a"/><path d="M17 7c2-3 5-3 7-2" stroke="#5f8f40" stroke-width="2" fill="none" stroke-linecap="round"/>'),
  mushroom: svg('<path d="M5 14c2-6 20-6 22 0-4 3-18 3-22 0z" fill="#f2b441"/><path d="M13 16h6l-1 11h-4z" fill="#e9c98a"/>'),
  onion: svg('<path d="M16 28c-6 0-8-4-8-8 0-5 5-8 8-12 3 4 8 7 8 12 0 4-2 8-8 8z" fill="#d9c2e6"/><path d="M16 8V3M13 8l-3-4M19 8l3-4" stroke="#6f9a4a" stroke-width="2" stroke-linecap="round"/>'),
  bark: svg('<path d="M7 8c6-3 12-3 18 0v16c-6 3-12 3-18 0z" fill="#efe7da"/><path d="M10 13h5M17 18h5M11 21h4" stroke="#3b342e" stroke-width="2" stroke-linecap="round"/>'),
  log: svg('<rect x="4" y="11" width="22" height="11" rx="3" fill="#8a5a33"/><ellipse cx="26" cy="16.5" rx="3.5" ry="5.5" fill="#d2ab78"/><ellipse cx="26" cy="16.5" rx="1.5" ry="2.5" fill="#a47a4a"/>'),
  cordage: svg('<path d="M8 10c8-4 16 0 16 4s-16 0-16 5 16 4 16 0" stroke="#c9b27a" stroke-width="3" fill="none" stroke-linecap="round"/>'),
  rawMeat: svg('<path d="M6 17c0-6 6-10 12-10 5 0 9 3 9 8 0 7-7 11-13 11-5 0-8-4-8-9z" fill="#c8574f"/><path d="M12 15c3-3 8-3 10 0" stroke="#f0c2b8" stroke-width="2.5" fill="none" stroke-linecap="round"/>'),
  rawFish: svg('<path d="M4 16c5-7 14-7 19 0-5 7-14 7-19 0z" fill="#8fb3c9"/><path d="M23 16l6-5v10z" fill="#6d93ab"/><circle cx="9" cy="15" r="1.4" fill="#1e2a30"/><path d="M11 18c3 1 6 1 9 0" stroke="#d98a7a" stroke-width="1.8" fill="none"/>'),
  hide: svg('<path d="M8 6l4 3h8l4-3 2 7-3 3 3 7-5 4h-10l-5-4 3-7-3-3z" fill="#b98a5a"/><path d="M12 13h8M12 19h8" stroke="#8a6038" stroke-width="1.6" stroke-linecap="round"/>'),
  lakeWater: svg('<path d="M16 4c5 7 9 11 9 16a9 9 0 0 1-18 0c0-5 4-9 9-16z" fill="#6fb3d6"/><path d="M12 20a4 4 0 0 0 4 4" stroke="#d6eefa" stroke-width="2" fill="none" stroke-linecap="round"/>'),
  boiledWater: svg('<path d="M8 12h16v11a5 5 0 0 1-5 5h-6a5 5 0 0 1-5-5z" fill="#a9dcef"/><path d="M24 15h2a3 3 0 0 1 0 6h-2" stroke="#7a9aa8" stroke-width="2" fill="none"/><path d="M12 9c0-2 2-2 2-4M18 9c0-2 2-2 2-4" stroke="#e8f4f8" stroke-width="1.8" fill="none" stroke-linecap="round"/>'),
  cookedMeat: svg('<path d="M6 17c0-6 6-10 12-10 5 0 9 3 9 8 0 7-7 11-13 11-5 0-8-4-8-9z" fill="#9c5a36"/><path d="M11 13l9 8M15 11l8 7" stroke="#6a3a22" stroke-width="2" stroke-linecap="round"/>'),
  grilledTrout: svg('<path d="M4 16c5-7 14-7 19 0-5 7-14 7-19 0z" fill="#d9a56b"/><path d="M23 16l6-5v10z" fill="#b4834e"/><path d="M9 12l3 8M13 11l3 10M17 12l3 8" stroke="#8a5a30" stroke-width="1.8" stroke-linecap="round"/>'),
  skewer: svg('<path d="M4 28 28 4" stroke="#8a5a2b" stroke-width="2.5" stroke-linecap="round"/><circle cx="11" cy="21" r="4" fill="#d99a3c"/><circle cx="16.5" cy="15.5" r="3.5" fill="#d9c2e6"/><circle cx="21.5" cy="10.5" r="4" fill="#e0982a"/>'),
  forageSkewer: svg('<path d="M4 28 28 4" stroke="#8a5a2b" stroke-width="2.5" stroke-linecap="round"/><circle cx="10.5" cy="21.5" r="3.6" fill="#f08a3c"/><circle cx="15.5" cy="16.5" r="3.4" fill="#d9c2e6"/><circle cx="20.5" cy="11.5" r="3.6" fill="#e8683a"/>'),
  berryTea: svg('<path d="M7 12h16v10a6 6 0 0 1-6 6h-4a6 6 0 0 1-6-6z" fill="#e0664d"/><path d="M23 15h2a3 3 0 0 1 0 6h-2" stroke="#b8503c" stroke-width="2" fill="none"/><path d="M11 9c0-2 2-2 2-4M17 9c0-2 2-2 2-4" stroke="#f4d8cf" stroke-width="1.8" fill="none" stroke-linecap="round"/>'),
  stew: svg('<path d="M4 15h24c0 7-5 12-12 12S4 22 4 15z" fill="#7a5a3e"/><ellipse cx="16" cy="15" rx="12" ry="3" fill="#a86d3b"/><circle cx="12" cy="15" r="1.6" fill="#f2b441"/><circle cx="19" cy="14.5" r="1.6" fill="#c8574f"/><path d="M11 10c0-2 2-2 2-4M18 10c0-2 2-2 2-4" stroke="#e8e2d8" stroke-width="1.8" fill="none" stroke-linecap="round"/>'),
  cedarTrout: svg('<path d="M5 20c4-8 18-8 22 0-4 6-18 6-22 0z" fill="#efe7da"/><path d="M8 18c4-5 12-5 16 0" fill="#c98b52"/><path d="M10 22h12" stroke="#3b342e" stroke-width="1.6" stroke-linecap="round"/>'),
  troutChowder: svg('<path d="M4 15h24c0 7-5 12-12 12S4 22 4 15z" fill="#8a6a4a"/><ellipse cx="16" cy="15" rx="12" ry="3" fill="#e3c9a0"/><path d="M10 14.5c2-1.5 4-1.5 6 0" stroke="#d9a56b" stroke-width="2" fill="none" stroke-linecap="round"/><circle cx="20" cy="15" r="1.5" fill="#f2b441"/><path d="M11 10c0-2 2-2 2-4M18 10c0-2 2-2 2-4" stroke="#e8e2d8" stroke-width="1.8" fill="none" stroke-linecap="round"/>'),
  troutSkewer: svg('<path d="M4 28 28 4" stroke="#8a5a2b" stroke-width="2.5" stroke-linecap="round"/><path d="M8 20c3-5 9-7 12-6-1 4-6 9-12 6z" fill="#d9a56b"/><circle cx="21" cy="10" r="3" fill="#f08a3c"/><circle cx="24.5" cy="6.5" r="2.4" fill="#e8683a"/>'),
  smokedTrout: svg('<path d="M6 10h20l-2 5H8z" fill="#b0643c"/><path d="M8 18h18l-3 5H10z" fill="#9a5533"/><path d="M10 12h12M11 20h11" stroke="#e8c49a" stroke-width="1.4" stroke-linecap="round"/><path d="M14 7c0-2 2-2 2-4M20 7c0-2 2-2 2-4" stroke="#b9b2a8" stroke-width="1.6" fill="none" stroke-linecap="round"/>'),
  charredMeal: svg('<path d="M6 17c0-6 6-10 12-10 5 0 9 3 9 8 0 7-7 11-13 11-5 0-8-4-8-9z" fill="#4a352a"/><path d="M11 14l3 2M17 12l4 3M13 20l5 1" stroke="#2a1d17" stroke-width="2" stroke-linecap="round"/><path d="M20 6c0-2 2-2 2-4" stroke="#b9b2a8" stroke-width="1.6" fill="none" stroke-linecap="round"/>'),
  arrow: svg('<path d="M6 26 24 8" stroke="#b08a5a" stroke-width="2.5" stroke-linecap="round"/><path d="M27 5l-7 2 5 5z" fill="#6f757b"/><path d="M5 21l2 6 6 2" stroke="#e9e2d4" stroke-width="2.5" fill="none" stroke-linecap="round"/>'),
  pricklyPear: svg('<ellipse cx="11" cy="18" rx="6" ry="9" fill="#6f9a4a" transform="rotate(-18 11 18)"/><path d="M16 27c-4 0-6-3-6-7 0-5 3-9 6-11 3 2 6 6 6 11 0 4-2 7-6 7z" fill="#c2306b"/><path d="M13 9c1 1 5 1 6 0" stroke="#8a1f4a" stroke-width="2" stroke-linecap="round"/><g fill="#f4d58a"><circle cx="14" cy="16" r="0.9"/><circle cx="18" cy="15" r="0.9"/><circle cx="16" cy="20" r="0.9"/><circle cx="19" cy="22" r="0.9"/><circle cx="13" cy="22" r="0.9"/></g>'),
  chollaBuds: svg('<ellipse cx="11" cy="19" rx="4.5" ry="6" fill="#8fae4a"/><ellipse cx="20" cy="16" rx="4.5" ry="6.5" fill="#a3b84e"/><path d="M8 14l-2-2M11 12V9M14 14l2-2M17 10l-1-3M20 9V6M23 10l1-3M24 16h3M5 19H3" stroke="#f1e6c8" stroke-width="1.3" stroke-linecap="round"/><path d="M19 10c1-2 3-2 3 0" fill="#e0664d"/>'),
  agaveHeart: svg('<path d="M16 28c-7 0-10-4-10-9s4-9 10-9 10 4 10 9-3 9-10 9z" fill="#dfe0b4"/><path d="M10 14 6 4M14 11l-1-8M18 11l1-8M22 14l4-10" stroke="#6f9a6a" stroke-width="3" stroke-linecap="round"/><path d="M9 20c4 2 10 2 14 0M10 24c4 1.5 8 1.5 12 0" stroke="#b9ba86" stroke-width="1.6" fill="none" stroke-linecap="round"/>'),
  chiaSeeds: svg('<path d="M5 26c3-5 19-5 22 0z" fill="#8a8078"/><g fill="#4a4540"><circle cx="11" cy="24" r="1"/><circle cx="15" cy="23" r="1"/><circle cx="19" cy="24" r="1"/><circle cx="22" cy="25" r="0.9"/><circle cx="13" cy="25.5" r="0.9"/></g><path d="M16 21V9" stroke="#6f9a4a" stroke-width="1.8" stroke-linecap="round"/><circle cx="16" cy="8" r="4" fill="#6a78d6"/><circle cx="16" cy="15" r="3" fill="#7d8ae0"/>'),
  wolfberries: svg('<path d="M5 25 26 8M11 20l-4-4M18 14l1-5M22 11l4 1" stroke="#7a6a58" stroke-width="1.8" stroke-linecap="round"/><ellipse cx="10" cy="23" rx="2.6" ry="3.6" fill="#e0452f"/><ellipse cx="16" cy="18" rx="2.6" ry="3.6" fill="#ec5a34"/><ellipse cx="22" cy="14" rx="2.4" ry="3.4" fill="#d83c2a"/><path d="M9 21.5l1.4 1M15 16.5l1.4 1" stroke="#f7b6a2" stroke-width="1" stroke-linecap="round"/>'),
  mesquitePods: svg('<path d="M4 24C9 14 18 7 28 6c-2 3-6 5-10 8S9 22 4 24z" fill="#d6b56a"/><path d="M6 27c6-8 14-14 22-15-2 3-6 5-10 7s-8 6-12 8z" fill="#c49a52"/><g fill="#a07a3a"><circle cx="11" cy="17" r="1"/><circle cx="15" cy="13.5" r="1"/><circle cx="20" cy="10.5" r="1"/><circle cx="12" cy="22" r="1"/><circle cx="17" cy="18.5" r="1"/></g>'),
  pinonNuts: svg('<path d="M10 26c-3 0-5-3-4-7s4-6 5-9c2 3 4 6 4 10s-2 6-5 6z" fill="#8a5a33"/><path d="M21 27c-3 0-5-3-4-7s4-6 5-9c2 3 4 6 4 10s-2 6-5 6z" fill="#9c6a3c"/><path d="M16 17c-2 0-4-2-3-5s3-4 4-6c1 2 3 4 3 7s-2 4-4 4z" fill="#7a4e2c"/><path d="M8 20c1-2 2-3 3-4M19 21c1-2 2-3 3-4" stroke="#e0c09a" stroke-width="1.3" stroke-linecap="round"/>'),
  desertSkewer: svg('<path d="M4 28 28 4" stroke="#8a5a2b" stroke-width="2.5" stroke-linecap="round"/><ellipse cx="10.5" cy="21.5" rx="3.4" ry="4" fill="#c2306b" transform="rotate(45 10.5 21.5)"/><circle cx="16" cy="16" r="3.2" fill="#8fae4a"/><ellipse cx="21.5" cy="10.5" rx="3.4" ry="4" fill="#b02a60" transform="rotate(45 21.5 10.5)"/><path d="M14.5 15l3 2" stroke="#5f7a2e" stroke-width="1.2"/>'),
  roastAgave: svg('<path d="M16 28c-7 0-10-4-10-9s4-9 10-9 10 4 10 9-3 9-10 9z" fill="#b8733a"/><path d="M9 17l4 6M14 14l5 8M20 14l3 5" stroke="#6a3a22" stroke-width="2" stroke-linecap="round"/><path d="M12 8c0-2 2-2 2-4M18 8c0-2 2-2 2-4" stroke="#e8e2d8" stroke-width="1.8" fill="none" stroke-linecap="round"/>'),
  mesquiteCakes: svg('<ellipse cx="16" cy="23" rx="11" ry="4" fill="#a8804a"/><ellipse cx="16" cy="20" rx="11" ry="4" fill="#d4ad6a"/><ellipse cx="16" cy="14" rx="9" ry="3.4" fill="#a8804a"/><ellipse cx="16" cy="11.5" rx="9" ry="3.4" fill="#e0bd7a"/><g fill="#b58a4c"><circle cx="12" cy="11" r="0.9"/><circle cx="17" cy="12" r="0.9"/><circle cx="20" cy="10.5" r="0.9"/><circle cx="11" cy="20" r="0.9"/><circle cx="19" cy="21" r="0.9"/></g>'),
  chiaFresca: svg('<path d="M8 6h16l-2 20a3 3 0 0 1-3 2h-6a3 3 0 0 1-3-2z" fill="#e8f4f8" opacity="0.9"/><path d="M9 11h14l-1.6 15a2 2 0 0 1-2 1.6h-6.8a2 2 0 0 1-2-1.6z" fill="#e05a8a"/><g fill="#3e3438"><circle cx="13" cy="15" r="0.9"/><circle cx="18" cy="17" r="0.9"/><circle cx="15" cy="20" r="0.9"/><circle cx="19" cy="23" r="0.9"/><circle cx="13" cy="24" r="0.9"/></g><path d="M20 4l-2 9" stroke="#6f9a4a" stroke-width="1.8" stroke-linecap="round"/>'),
  wolfberryTea: svg('<path d="M7 12h16v10a6 6 0 0 1-6 6h-4a6 6 0 0 1-6-6z" fill="#d8452f"/><path d="M23 15h2a3 3 0 0 1 0 6h-2" stroke="#a8341f" stroke-width="2" fill="none"/><ellipse cx="12" cy="15" rx="1.4" ry="2" fill="#f28a5a"/><ellipse cx="17" cy="16" rx="1.4" ry="2" fill="#f28a5a"/><path d="M11 9c0-2 2-2 2-4M17 9c0-2 2-2 2-4" stroke="#f4d8cf" stroke-width="1.8" fill="none" stroke-linecap="round"/>'),
  roastPinon: svg('<path d="M4 25c2-4 22-4 24 0-4 3-20 3-24 0z" fill="#6e4a30"/><g fill="#5a3620"><ellipse cx="10" cy="22" rx="2.2" ry="3" transform="rotate(-20 10 22)"/><ellipse cx="15" cy="20" rx="2.2" ry="3" transform="rotate(10 15 20)"/><ellipse cx="20" cy="22" rx="2.2" ry="3" transform="rotate(30 20 22)"/><ellipse cx="17" cy="23.5" rx="2" ry="2.6"/></g><path d="M9 19l1-1.4M14.4 17.4l1 -1.2" stroke="#d9b48a" stroke-width="1" stroke-linecap="round"/><path d="M12 12c0-2 2-2 2-4M19 12c0-2 2-2 2-4" stroke="#e8e2d8" stroke-width="1.8" fill="none" stroke-linecap="round"/>'),
  desertStew: svg('<path d="M4 15h24c0 7-5 12-12 12S4 22 4 15z" fill="#a0583a"/><ellipse cx="16" cy="15" rx="12" ry="3" fill="#c9793e"/><circle cx="11" cy="15" r="1.6" fill="#8fae4a"/><circle cx="16.5" cy="14.4" r="1.6" fill="#c8574f"/><path d="M19 15.6l4-1" stroke="#d6b56a" stroke-width="1.8" stroke-linecap="round"/><path d="M11 10c0-2 2-2 2-4M18 10c0-2 2-2 2-4" stroke="#e8e2d8" stroke-width="1.8" fill="none" stroke-linecap="round"/>'),
  pinonTrout: svg('<path d="M4 16c5-7 14-7 19 0-5 7-14 7-19 0z" fill="#d9a56b"/><path d="M23 16l6-5v10z" fill="#b4834e"/><g fill="#6e4424"><ellipse cx="10" cy="14.5" rx="1.2" ry="1.7"/><ellipse cx="14" cy="17" rx="1.2" ry="1.7"/><ellipse cx="17.5" cy="14" rx="1.2" ry="1.7"/><ellipse cx="11" cy="18.5" rx="1.1" ry="1.5"/><ellipse cx="19" cy="17.5" rx="1.1" ry="1.5"/></g>'),
  pearTroutSkewer: svg('<path d="M4 28 28 4" stroke="#8a5a2b" stroke-width="2.5" stroke-linecap="round"/><path d="M8 20c3-5 9-7 12-6-1 4-6 9-12 6z" fill="#d9a56b"/><ellipse cx="21.5" cy="10.5" rx="2.6" ry="3.2" fill="#c2306b" transform="rotate(45 21.5 10.5)"/><ellipse cx="25" cy="7" rx="2.2" ry="2.8" fill="#b02a60" transform="rotate(45 25 7)"/>'),
};

const TOOL_ICONS: Record<ToolId, string> = {
  hands: svg('<path d="M10 28v-9l-3-5c-1-2 1-3 2-2l3 4V7c0-2 3-2 3 0v7-9c0-2 3-2 3 0v9-7c0-2 3-2 3 0v8-5c0-2 3-2 3 0v11c0 5-3 9-8 9z" fill="#e0ad8a"/>'),
  axe: svg('<path d="M9 28 22 6" stroke="#8a6440" stroke-width="3" stroke-linecap="round"/><path d="M17 6c4-3 10-1 11 4-4 1-8 0-10-2z" fill="#8c9196"/><path d="M18 11l2 1" stroke="#c9b27a" stroke-width="3"/>'),
  spear: svg('<path d="M5 27 22 10" stroke="#9a7048" stroke-width="2.6" stroke-linecap="round"/><path d="M28 4l-4 10-4-4z" fill="#6f757b"/><path d="M20 12l2 2" stroke="#c9b27a" stroke-width="3"/>'),
  bow: svg('<path d="M9 4c12 3 15 21 0 24" stroke="#8a5f3a" stroke-width="3" fill="none" stroke-linecap="round"/><path d="M9 4v24" stroke="#e8dfcc" stroke-width="1.2"/><path d="M6 16h18" stroke="#b08a5a" stroke-width="2" stroke-linecap="round"/><path d="M26 16l-4-2v4z" fill="#6f757b"/>'),
  torch: svg('<path d="M14 29l2-15" stroke="#7a5534" stroke-width="3" stroke-linecap="round"/><path d="M16 3c3 4 6 6 6 10a6 6 0 0 1-12 0c0-3 3-5 6-10z" fill="#ffb347"/><path d="M16 8c2 3 3 4 3 6a3 3 0 0 1-6 0c0-2 1-3 3-6z" fill="#ffe08a"/>'),
  rod: svg('<path d="M5 28 24 5" stroke="#9a7048" stroke-width="2.6" stroke-linecap="round"/><path d="M24 5c3 6 3 12 1 17" stroke="#e8dfcc" stroke-width="1.2" fill="none"/><circle cx="25" cy="24" r="2.6" fill="#e0664d"/><path d="M22.4 24h5.2" stroke="#f4ede0" stroke-width="1.6"/><circle cx="9" cy="23" r="2" fill="#6f757b"/>'),
};

const GEAR_ICONS: Record<GearId, string> = {
  basket: svg('<path d="M5 13h22l-3 14H8z" fill="#c9a86a"/><path d="M8 17h16M9 21h14M10 13l2 14M16 13v14M22 13l-2 14" stroke="#9a7a44" stroke-width="1.5"/><path d="M9 13c0-8 14-8 14 0" stroke="#9a7a44" stroke-width="2" fill="none"/>'),
  backpack: svg('<rect x="7" y="8" width="18" height="20" rx="5" fill="#b98a5a"/><rect x="10" y="17" width="12" height="7" rx="2" fill="#8a6038"/><path d="M12 8c0-5 8-5 8 0" stroke="#8a6038" stroke-width="2.4" fill="none"/>'),
  canteen: svg('<circle cx="16" cy="18" r="10" fill="#efe7da"/><circle cx="16" cy="18" r="6" fill="#d9cfbf"/><rect x="13" y="3" width="6" height="6" rx="1" fill="#8a6440"/>'),
};

export const NEED_ICONS = {
  health: svg('<path d="M16 27S4 20 4 11a6 6 0 0 1 12-2 6 6 0 0 1 12 2c0 9-12 16-12 16z" fill="currentColor"/>'),
  hunger: svg('<path d="M9 4v10a3 3 0 0 0 6 0V4M12 4v24M22 4c-3 2-4 7-4 11h4v13" stroke="currentColor" stroke-width="2.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'),
  thirst: svg('<path d="M16 3c5 7 9 11 9 17a9 9 0 0 1-18 0c0-6 4-10 9-17z" fill="currentColor"/>'),
  warmth: svg('<path d="M16 3c2 5 8 8 8 15a8 8 0 0 1-16 0c0-4 2-6 4-8 0 3 1 5 3 5 0-5-1-8 1-12z" fill="currentColor"/>'),
  energy: svg('<path d="M18 3 7 18h8l-2 11 12-16h-8z" fill="currentColor"/>'),
};

export const MISC_ICONS = {
  sun: svg('<circle cx="16" cy="16" r="6" fill="#ffd27a"/><g stroke="#ffd27a" stroke-width="2.4" stroke-linecap="round"><path d="M16 3v4M16 25v4M3 16h4M25 16h4M6.8 6.8l2.8 2.8M22.4 22.4l2.8 2.8M6.8 25.2l2.8-2.8M22.4 9.6l2.8-2.8"/></g>'),
  moon: svg('<path d="M21 4a12 12 0 1 0 7 17A10 10 0 0 1 21 4z" fill="#dfe6ff"/>'),
  lock: svg('<rect x="8" y="14" width="16" height="13" rx="3" fill="currentColor"/><path d="M11 14v-3a5 5 0 0 1 10 0v3" stroke="currentColor" stroke-width="2.6" fill="none"/>'),
  fire: svg('<path d="M16 3c3 5 8 8 8 15a8 8 0 0 1-16 0c0-4 2-6 4-8 0 3 1 5 3 5 0-5-1-8 1-12z" fill="#ff9a4d"/>'),
  campfire: svg('<path d="M6 27 26 21M6 21l20 6" stroke="#6e4a30" stroke-width="3" stroke-linecap="round"/><path d="M16 4c3 4 6 6 6 10a6 6 0 0 1-12 0c0-3 3-6 6-10z" fill="#ffb347"/>'),
  leanTo: svg('<path d="M4 26 20 8l8 18z" fill="#4c7a42"/><path d="M4 26 20 8" stroke="#6e4a30" stroke-width="2.5"/><path d="M20 8v18" stroke="#6e4a30" stroke-width="2.5"/>'),
  aFrame: svg('<path d="M16 5 3 27h26z" fill="#4c7a42"/><path d="M16 5 3 27M16 5l13 22" stroke="#6e4a30" stroke-width="2.5"/><path d="M16 14l-4 13h8z" fill="#2a3a2a"/>'),
  barkHut: svg('<path d="M3 15 16 5l13 10z" fill="#e8dfd0"/><path d="M8 11h5M17 9h4M12 13h7" stroke="#3b342e" stroke-width="1.4"/><rect x="6" y="15" width="20" height="12" fill="#8a5a33"/><path d="M6 19h20M6 23h20" stroke="#6e4a30" stroke-width="1.4"/><rect x="13" y="18" width="6" height="9" fill="#3a2a1f"/>'),
  hideTent: svg('<path d="M16 4 4 27h24z" fill="#c9a06a"/><path d="M16 12l-4 15h8z" fill="#3a2a1f"/><path d="M13 2l6 6M19 2l-6 6" stroke="#6e4a30" stroke-width="2"/>'),
  upgrade: svg('<path d="M16 4 6 15h6v12h8V15h6z" fill="currentColor"/>'),
  leaf: svg('<path d="M6 26C6 14 13 6 27 5c0 13-8 21-20 21z" fill="#6f9a4a"/><path d="M7 25 21 11" stroke="#3f6a30" stroke-width="2" stroke-linecap="round"/>'),
  moonBed: svg('<path d="M4 22h24v5H4z" fill="#8a6038"/><path d="M6 22c0-3 3-5 7-5h9c3 0 5 2 5 5z" fill="#c9a172"/><path d="M22 4a6 6 0 1 0 5 9 5 5 0 0 1-5-9z" fill="#dfe6ff"/>'),
  bench: svg('<rect x="4" y="12" width="24" height="6" rx="3" fill="#c9a172"/><path d="M8 18v8M24 18v8" stroke="#5e4330" stroke-width="4" stroke-linecap="round"/>'),
  workbench: svg('<rect x="3" y="12" width="26" height="5" rx="1.5" fill="#b58b5c"/><path d="M7 17v10M25 17v10M7 23h18" stroke="#5e4330" stroke-width="3" stroke-linecap="round"/><path d="M12 12V7h5l2 5" fill="#8e9398"/><path d="M21 5l-4 7" stroke="#6e4a30" stroke-width="2.4" stroke-linecap="round"/>'),
  storageBin: svg('<path d="M6 11h20l-2 16H8z" fill="#c9a86a"/><path d="M7 16h18M8 21h16M11 11l1.5 16M16 11v16M21 11l-1.5 16" stroke="#9a7a44" stroke-width="1.4"/><rect x="5" y="8" width="22" height="4" rx="2" fill="#a88650"/>'),
  storageCrate: svg('<rect x="4" y="10" width="24" height="17" rx="1.5" fill="#9a7048"/><path d="M4 16h24M4 22h24" stroke="#6e4a30" stroke-width="1.6"/><rect x="3" y="7" width="26" height="4" rx="1" fill="#b58b5c"/><path d="M7 7v20M25 7v20" stroke="#5e4330" stroke-width="2.4"/>'),
  storageChest: svg('<path d="M4 15a12 7 0 0 1 24 0z" fill="#b58b5c"/><rect x="4" y="15" width="24" height="12" rx="1.5" fill="#8a5a33"/><path d="M10 8v19M22 8v19" stroke="#c9a06a" stroke-width="2.6"/><rect x="14" y="14" width="4" height="5" rx="1" fill="#8e9398"/>'),
};

export function iconImg(file: string): string {
  return `<img class="icon-img" src="${import.meta.env.BASE_URL}${ICON_DIR}${file}" alt="" draggable="false">`;
}

function pick(id: IconId, builtIn: string, tier = 1): string {
  const file = iconFile(id, tier);
  return file ? iconImg(file) : builtIn;
}

export function itemIcon(id: ItemId): string {
  return pick(id, ITEM_ICONS[id]);
}

/** `level` is the tool's upgrade level (0 = freshly crafted); upgraded tools show that tier's icon when Jon made one. */
export function toolIcon(id: ToolId, level = 0): string {
  return pick(id, TOOL_ICONS[id], toolTier(level));
}

export function gearIcon(id: GearId): string {
  return pick(id, GEAR_ICONS[id]);
}

export function prefabIcon(id: PrefabId): string {
  return pick(id, MISC_ICONS[id]);
}

/** The icon for any item, tool, gear or prefab id. */
export function anyIcon(id: IconId): string {
  if (id in ITEM_ICONS) return itemIcon(id as ItemId);
  if (id in TOOL_ICONS) return toolIcon(id as ToolId);
  if (id in GEAR_ICONS) return gearIcon(id as GearId);
  return prefabIcon(id as PrefabId);
}
