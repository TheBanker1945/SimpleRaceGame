import './ui/styles.css';
import { Game } from './core/Game.ts';

declare global {
  interface Window {
    /** Debug/test handle, only present with `?debug` in the URL. */
    redline?: ReturnType<Game['debugApi']>;
  }
}

const container = document.getElementById('app');
if (!container) throw new Error('#app container missing');

const game = new Game(container);
if (new URLSearchParams(window.location.search).has('debug')) window.redline = game.debugApi();
game.start();
