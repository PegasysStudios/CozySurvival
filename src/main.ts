import './styles.css';
import { Game } from './game/game';

interface CozyDebug {
  ready: boolean;
  game: Game | null;
  errors: string[];
}

declare global {
  interface Window {
    __cozy?: CozyDebug;
  }
}

const debug: CozyDebug = { ready: false, game: null, errors: [] };
window.__cozy = debug;
window.addEventListener('error', (e) => debug.errors.push(String(e.message)));
window.addEventListener('unhandledrejection', (e) => debug.errors.push(String(e.reason)));

function showFatal(root: HTMLElement, err: unknown): void {
  const box = document.createElement('div');
  box.className = 'fatal';
  const webgl = /webgl|context/i.test(String(err));
  box.innerHTML = `<div class="fatal-card"><div class="logo">CozySurvival</div><h2>The forest couldn't load</h2><p>${
    webgl ? 'Your browser or device could not start WebGL. Try a recent Chrome, Edge, Firefox or Safari with hardware acceleration turned on.' : 'Something went wrong while starting the game. Reloading usually fixes it.'
  }</p><button class="btn primary" type="button">Reload</button></div>`;
  box.querySelector('button')!.addEventListener('click', () => location.reload());
  root.append(box);
}

async function boot(): Promise<void> {
  const root = document.getElementById('app')!;
  // Let the static boot screen paint before the synchronous world build.
  await new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 0)));
  const devMode = import.meta.env.DEV || new URLSearchParams(location.search).has('dev');
  try {
    const game = new Game(root, devMode);
    debug.game = game;
    game.start();
    debug.ready = true;
  } catch (err) {
    console.error(err);
    debug.errors.push(String(err));
    showFatal(root, err);
  } finally {
    document.getElementById('boot')?.remove();
  }
}

void boot();
