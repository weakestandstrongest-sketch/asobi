import { h, settings, saveSettings, closeAllOverlays, unlockAudio, sfx } from './ui.js';
import * as yacht from './games/yacht.js';
import * as hitblow from './games/hitblow.js';
import * as gomoku from './games/gomoku.js';
import * as reversi from './games/reversi.js';
import * as chess from './games/chess.js';
import * as minishogi from './games/minishogi.js';
import * as airhockey from './games/airhockey.js';

const ICONS = {
  yacht: `<svg viewBox="0 0 48 48"><rect x="6" y="6" width="36" height="36" rx="8" fill="#fff"/>
    <g fill="#d33">${[[15, 15], [33, 15], [24, 24], [15, 33], [33, 33]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="4"/>`).join('')}</g></svg>`,
  hitblow: `<svg viewBox="0 0 48 48">${['#ef5350', '#42a5f5', '#66bb6a', '#ffca28'].map((c, i) => `<circle cx="${9 + i * 10}" cy="24" r="4.6" fill="${c}"/>`).join('')}</svg>`,
  gomoku: `<svg viewBox="0 0 48 48"><rect x="3" y="3" width="42" height="42" rx="5" fill="#e3b866"/>
    <g stroke="#6b4a1c" stroke-width="1">${[9, 17, 25, 33, 41].map((v) => `<path d="M${v} 7v34M7 ${v}h34"/>`).join('')}</g>
    ${[9, 17, 25, 33, 41].map((v) => `<circle cx="${v}" cy="${v}" r="3.6" fill="#111"/>`).join('')}</svg>`,
  reversi: `<svg viewBox="0 0 48 48"><rect x="3" y="3" width="42" height="42" rx="5" fill="#2e7d4f"/>
    <circle cx="17" cy="17" r="7" fill="#fff"/><circle cx="31" cy="17" r="7" fill="#111"/>
    <circle cx="17" cy="31" r="7" fill="#111"/><circle cx="31" cy="31" r="7" fill="#fff"/></svg>`,
  chess: `<svg viewBox="0 0 48 48"><text x="24" y="38" text-anchor="middle" font-size="38" fill="#fff" stroke="#000" stroke-width="1.2">♞&#xFE0E;</text></svg>`,
  minishogi: `<svg viewBox="0 0 48 48"><path d="M24 4l12 6 4 32H8l4-32z" fill="#f3d58f" stroke="#7a5520" stroke-width="1.5"/>
    <text x="24" y="33" text-anchor="middle" font-size="17" font-weight="700" fill="#222">将</text></svg>`,
  airhockey: `<svg viewBox="0 0 48 48"><circle cx="18" cy="30" r="12" fill="#ef5350"/><circle cx="18" cy="30" r="5" fill="#b71c1c"/>
    <circle cx="35" cy="15" r="6.5" fill="#222" stroke="#fff" stroke-width="1.5"/></svg>`,
};

export const GAMES = [
  { id: 'yacht', title: 'ヨット', desc: 'サイコロ5つで役をそろえる', mod: yacht },
  { id: 'hitblow', title: 'ヒット&ブロー', desc: '相手の色の並びを推理する', mod: hitblow },
  { id: 'gomoku', title: '五目並べ', desc: '5つ並べたら勝ち', mod: gomoku },
  { id: 'reversi', title: 'リバーシ', desc: 'はさんでひっくり返す', mod: reversi },
  { id: 'chess', title: 'チェス', desc: '相手のキングを追い詰める', mod: chess },
  { id: 'minishogi', title: '5五将棋', desc: '5×5マスの小さな将棋', mod: minishogi },
  { id: 'airhockey', title: 'エアホッケー', desc: '同時に操作するリアルタイム対戦', mod: airhockey },
];

const app = document.getElementById('app');
let cleanup = null;

function renderMenu() {
  document.title = 'あそび2人用';
  const toggle = (key, label, desc) => {
    const input = h('input', { type: 'checkbox', role: 'switch' });
    input.checked = settings[key];
    input.addEventListener('change', () => { settings[key] = input.checked; saveSettings(); sfx('tap'); });
    return h('label', { class: 'setting' },
      h('span', { class: 'setting-text' }, h('strong', {}, label), h('small', {}, desc)),
      input);
  };
  const screen = h('div', { class: 'menu' },
    h('header', { class: 'menu-header' },
      h('h1', {}, 'あそび', h('span', {}, '2人用')),
      h('p', {}, 'iPhone 1台をはさんで、ふたりで遊べるゲーム集')),
    h('nav', { class: 'game-grid' },
      GAMES.map((g) => h('a', { class: 'game-card', href: `#/${g.id}`, onclick: unlockAudio },
        h('span', { class: 'game-icon', html: ICONS[g.id] }),
        h('span', { class: 'game-title' }, g.title),
        h('span', { class: 'game-desc' }, g.desc)))),
    h('section', { class: 'settings' },
      h('h2', {}, '設定'),
      toggle('faceToFace', '向かい合わせモード', '上側の人の表示を逆さにして、テーブルをはさんで遊べるようにします'),
      toggle('sound', '効果音', 'マナーモード中は鳴りません')),
    h('p', { class: 'hint' }, 'Safari の共有ボタン →「ホーム画面に追加」で、全画面のアプリとして使えます。'));
  app.append(screen);
}

function route() {
  closeAllOverlays();
  if (cleanup) { cleanup(); cleanup = null; }
  app.replaceChildren();
  const id = location.hash.replace(/^#\/?/, '');
  const game = GAMES.find((g) => g.id === id);
  if (!game) { renderMenu(); return; }
  document.title = `${game.title} - あそび2人用`;
  const screen = h('div', { class: `screen game-${game.id}` });
  app.append(screen);
  cleanup = game.mod.mount(screen) || null;
}

window.addEventListener('hashchange', route);
// iOS でダブルタップやピンチによる拡大を防ぐ
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false });
route();

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
