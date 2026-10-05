import { nextSeason, SEASON_DAYS, SEASON_NAMES, type Season } from '../sim/seasons';
import type { Simulation } from '../sim/simulation';
import { el, setText } from './dom';

const svg = (body: string) => `<svg viewBox="0 0 32 32" aria-hidden="true">${body}</svg>`;
const icons: Record<Season, string> = {
  spring: svg('<path d="M16 28V15m0 9c-6 0-8-3-8-5 5-1 8 2 8 5" fill="none" stroke="#94be74" stroke-width="2.5"/><g fill="#d9a6d8"><ellipse cx="16" cy="10" rx="4" ry="8"/><ellipse cx="16" cy="10" rx="8" ry="4"/></g><circle cx="16" cy="10" r="3" fill="#f6d578"/>'),
  summer: svg('<g stroke="#efc56b" stroke-width="2" stroke-linecap="round"><path d="M16 2v4m0 20v4M2 16h4m20 0h4M6 6l3 3m14 14 3 3M6 26l3-3M23 9l3-3"/></g><circle cx="16" cy="16" r="7" fill="#efc56b"/>'),
  fall: svg('<path d="m16 2 4 8 6-3-1 7 5 2-10 8-4 1-4-1L2 16l5-2-1-7 6 3z" fill="#df854d"/><path d="M16 12v18m0-9-5-5m5 2 5-5" fill="none" stroke="#f6c17e" stroke-width="1.5"/>'),
  winter: svg('<g fill="none" stroke="#b9dce9" stroke-width="2" stroke-linecap="round"><path d="M16 2v28M4 9l24 14M4 23 28 9M12 4l4 4 4-4M12 28l4-4 4 4M4 14l6-2-1-6M28 18l-6 2 1 6M9 26l1-6-6-2M23 6l-1 6 6 2"/></g>'),
};

export class SeasonDisplay {
  readonly root = el('div', 'hud-season');
  private readonly name = el('div', 'season-name');
  private readonly current = el('span', 'season-icon');
  private readonly next = el('span', 'season-icon');
  private readonly track = el('div', 'season-track');
  private readonly fill = el('div', 'season-fill');
  private readonly marker = el('span', 'season-day');
  private shown: Season | null = null;

  constructor() {
    const row = el('div', 'season-row');
    this.track.append(this.fill, this.marker);
    this.track.setAttribute('role', 'progressbar');
    this.track.setAttribute('aria-valuemin', '1');
    this.track.setAttribute('aria-valuemax', String(SEASON_DAYS));
    row.append(this.current, this.track, this.next);
    this.root.append(this.name, row);
    this.root.hidden = true;
  }

  update(sim: Simulation): void {
    const id = sim.season;
    this.root.hidden = !id;
    if (!id) return;
    const next = nextSeason(id);
    if (id !== this.shown) {
      this.shown = id;
      setText(this.name, SEASON_NAMES[id]);
      this.current.innerHTML = icons[id];
      this.next.innerHTML = icons[next];
      this.current.title = SEASON_NAMES[id];
      this.next.title = `Next: ${SEASON_NAMES[next]}`;
      this.root.dataset.season = id;
    }
    const day = sim.seasonDay;
    const progress = ((day - 1) / (SEASON_DAYS - 1)) * 100;
    this.marker.style.left = `${progress}%`;
    this.fill.style.width = `${progress}%`;
    setText(this.marker, String(day));
    this.track.title = `Day ${day} of ${SEASON_DAYS} · ${SEASON_NAMES[next]} next`;
    this.track.setAttribute('aria-valuenow', String(day));
    this.track.setAttribute('aria-valuetext', `${SEASON_NAMES[id]}, day ${day} of ${SEASON_DAYS}`);
    this.track.setAttribute('aria-label', 'Season progress');
  }
}
