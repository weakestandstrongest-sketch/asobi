// 画面部品・設定・効果音など、各ゲームで共通して使うもの

const SVG_NS = 'http://www.w3.org/2000/svg';

export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  applyProps(el, props);
  appendChildren(el, children);
  return el;
}

export function s(tag, props = {}, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  applyProps(el, props);
  appendChildren(el, children);
  return el;
}

function applyProps(el, props) {
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.setAttribute('class', v);
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
}

function appendChildren(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

// ---- 設定 (端末内に保存) ----

const SETTINGS_KEY = 'asobi.settings.v1';
const DEFAULTS = { faceToFace: false, sound: true };

function loadSettings() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') };
  } catch {
    return { ...DEFAULTS };
  }
}

export const settings = loadSettings();

export function saveSettings() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* 保存できなくても遊べる */ }
}

export function loadPref(key, fallback) {
  try {
    const v = localStorage.getItem('asobi.' + key);
    return v === null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
}

export function savePref(key, value) {
  try { localStorage.setItem('asobi.' + key, JSON.stringify(value)); } catch { /* 無視 */ }
}

// ---- 効果音 (Web Audio で合成) ----

let audio = null;

export function unlockAudio() {
  try {
    if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === 'suspended') audio.resume();
  } catch {
    audio = null;
  }
}

function tone(freq, dur, { type = 'sine', gain = 0.15, delay = 0, slide = 0 } = {}) {
  const t0 = audio.currentTime + delay;
  const osc = audio.createOscillator();
  const g = audio.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slide) osc.frequency.exponentialRampToValueAtTime(freq * slide, t0 + dur);
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(audio.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

export function sfx(name, strength = 1) {
  if (!settings.sound) return;
  unlockAudio();
  if (!audio) return;
  try {
    switch (name) {
      case 'tap': tone(660, 0.05, { type: 'triangle', gain: 0.08 }); break;
      case 'place': tone(320, 0.09, { type: 'triangle', gain: 0.22, slide: 0.6 }); break;
      case 'flip': tone(520, 0.05, { type: 'triangle', gain: 0.08 }); break;
      case 'capture': tone(220, 0.12, { type: 'square', gain: 0.08, slide: 0.5 }); break;
      case 'roll':
        for (let i = 0; i < 6; i++) tone(300 + Math.random() * 500, 0.03, { type: 'square', gain: 0.04, delay: i * 0.05 });
        break;
      case 'hit': tone(900, 0.06, { type: 'square', gain: 0.05 + 0.1 * Math.min(1, strength) }); break;
      case 'wall': tone(420, 0.05, { type: 'triangle', gain: 0.06 + 0.1 * Math.min(1, strength) }); break;
      case 'goal': [523, 659, 784].forEach((f, i) => tone(f, 0.18, { type: 'triangle', gain: 0.15, delay: i * 0.09 })); break;
      case 'win': [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.3, { type: 'triangle', gain: 0.15, delay: i * 0.12 })); break;
      case 'error': tone(140, 0.15, { type: 'sawtooth', gain: 0.06 }); break;
      case 'check': tone(880, 0.12, { type: 'triangle', gain: 0.12, delay: 0 }); tone(660, 0.16, { type: 'triangle', gain: 0.12, delay: 0.1 }); break;
      default: break;
    }
  } catch { /* 音が鳴らなくても遊べる */ }
}

// ---- アイコン ----

const ICONS = {
  back: 'M15 5l-7 7 7 7',
  undo: 'M9 14L4 9l5-5M4 9h10a6 6 0 010 12h-3',
  restart: 'M4 12a8 8 0 108-8 8.5 8.5 0 00-6 2.5L4 8M4 3v5h5',
  help: 'M9.1 9a3 3 0 015.8 1c0 2-3 3-3 3M12 17h.01',
  pause: 'M9 5v14M15 5v14',
};

export function icon(name) {
  const svg = s('svg', { viewBox: '0 0 24 24', class: 'icon', 'aria-hidden': 'true' });
  if (name === 'help') svg.append(s('circle', { cx: 12, cy: 12, r: 9.5 }));
  svg.append(s('path', { d: ICONS[name] }));
  return svg;
}

// ---- モーダル・トースト ----

const openOverlays = new Set();

export function closeAllOverlays() {
  for (const o of openOverlays) o.close(undefined);
}

export function modal({ title, body, buttons = [{ label: 'OK', value: true, primary: true }], flip = false, dismissible = true, className = '' }) {
  document.querySelector('.toast')?.remove();
  return new Promise((resolve) => {
    const panel = h('div', { class: `modal ${className}`, role: 'dialog', 'aria-modal': 'true' },
      title && h('h2', {}, title),
      body && h('div', { class: 'modal-body' }, body),
      h('div', { class: 'modal-buttons' },
        buttons.map((b) => h('button', {
          class: `btn ${b.primary ? 'primary' : ''} ${b.danger ? 'danger' : ''}`,
          onclick: () => { sfx('tap'); close(b.value); },
        }, b.label))));
    if (flip) panel.classList.add('flip');
    const overlay = h('div', { class: 'overlay' }, panel);
    if (dismissible) {
      overlay.addEventListener('click', (e) => { if (e.target === overlay) close(undefined); });
    }
    const entry = { close };
    function close(value) {
      if (!openOverlays.has(entry)) return;
      openOverlays.delete(entry);
      overlay.classList.add('closing');
      setTimeout(() => overlay.remove(), 160);
      resolve(value);
    }
    openOverlays.add(entry);
    document.body.append(overlay);
  });
}

export const confirm = (message, okLabel = 'はい') =>
  modal({
    body: h('p', {}, message),
    buttons: [{ label: 'いいえ', value: false }, { label: okLabel, value: true, primary: true }],
  }).then((v) => v === true);

let toastTimer = null;
export function toast(message, { flip = false, duration = 1600 } = {}) {
  document.querySelector('.toast')?.remove();
  const el = h('div', { class: `toast ${flip ? 'flip' : ''}` }, message);
  document.body.append(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.classList.add('closing');
    setTimeout(() => el.remove(), 250);
  }, duration);
}

// ---- ゲーム画面の共通レイアウト ----

export function gameShell(root, { title, rules, onUndo, onRestart }) {
  const undoBtn = onUndo && h('button', { class: 'icon-btn', 'aria-label': '待った', onclick: () => { sfx('tap'); onUndo(); } }, icon('undo'));
  const header = h('header', { class: 'topbar' },
    h('button', { class: 'icon-btn', 'aria-label': 'メニューに戻る', onclick: () => { location.hash = '#/'; } }, icon('back')),
    h('h1', {}, title),
    h('div', { class: 'topbar-actions' },
      undoBtn,
      onRestart && h('button', {
        class: 'icon-btn',
        'aria-label': '最初から',
        onclick: async () => { if (await confirm('最初からやり直しますか？')) onRestart(); },
      }, icon('restart')),
      rules && h('button', { class: 'icon-btn', 'aria-label': 'ルール', onclick: () => showRules(title, rules) }, icon('help'))));
  const main = h('main', { class: 'game-main' });
  root.append(header, main);
  return {
    header,
    main,
    setUndoEnabled(on) { if (undoBtn) undoBtn.disabled = !on; },
  };
}

export function showRules(title, rules) {
  return modal({ title: `${title}のルール`, body: h('div', { class: 'rules', html: rules }), className: 'wide' });
}

// プレイヤー情報の帯。flip すると上側の人から読める向きになる
export function playerPanel({ name, mark, flip = false }) {
  const info = h('div', { class: 'pp-info' });
  const status = h('div', { class: 'pp-status' });
  const el = h('div', { class: `player-panel ${flip ? 'flip' : ''}` },
    h('div', { class: 'pp-main' }, mark, h('span', { class: 'pp-name' }, name)),
    info,
    status);
  return {
    el,
    setActive(on) { el.classList.toggle('active', on); },
    setInfo(content) { info.replaceChildren(...[content].flat().filter((c) => c != null)); },
    setStatus(text) { status.textContent = text || ''; },
    setFlip(on) { el.classList.toggle('flip', on); },
  };
}

// 要素を、親の空き領域に収まる最大の正方形 (または aspect の長方形) にする
export function fitBox(wrap, el, aspect = 1) {
  const update = () => {
    const w = wrap.clientWidth, hgt = wrap.clientHeight;
    if (!w || !hgt) return;
    let width = Math.min(w, hgt / aspect);
    width = Math.floor(width);
    el.style.width = width + 'px';
    el.style.height = Math.floor(width * aspect) + 'px';
  };
  const ro = new ResizeObserver(update);
  ro.observe(wrap);
  update();
  return () => ro.disconnect();
}

export function stone(color, extraClass = '') {
  return h('span', { class: `stone-mark ${color} ${extraClass}` });
}
