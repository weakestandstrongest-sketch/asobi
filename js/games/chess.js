import { h, gameShell, playerPanel, modal, sfx, settings, fitBox } from '../ui.js';
import * as C from './chess-logic.js';

const RULES = `
<p>相手のキングを逃げられない状態 (チェックメイト) にしたら勝ちです。白が先手です。</p>
<ul>
<li>自分の駒をタップすると動ける場所が表示されます。行き先をタップして移動します。</li>
<li><b>キャスリング</b>: キングを2マス横に動かすと、ルークが自動で反対側に移ります。</li>
<li><b>アンパッサン</b>・<b>プロモーション (昇格)</b> にも対応しています。昇格時は駒を選べます。</li>
<li>ステイルメイト・駒不足・50手ルール・同一局面3回は引き分けです。</li>
</ul>`;

// 黒い字形を両陣営で使い、色は CSS で塗る (U+FE0E で絵文字化を防ぐ)
const GLYPH = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };
const VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const NAMES = { w: '白', b: '黒' };
const FILES = 'abcdefgh';

const glyph = (t) => GLYPH[t] + '︎';
const pieceEl = (p) => h('span', { class: `piece ${p.c}` }, glyph(p.t));

export function mount(root) {
  let state, history, keys, selected, over, lastMove;
  const ui = gameShell(root, { title: 'チェス', rules: RULES, onUndo: undo, onRestart: restart });
  const top = playerPanel({ name: '黒', mark: h('span', { class: 'piece b mini' }, glyph('k')), flip: settings.faceToFace });
  const bottom = playerPanel({ name: '白', mark: h('span', { class: 'piece w mini' }, glyph('k')) });
  const panels = { w: bottom, b: top };
  const board = h('div', { class: `chess-board ${settings.faceToFace ? 'f2f' : ''}` });
  const wrap = h('div', { class: 'board-wrap' }, board);
  ui.main.append(top.el, wrap, bottom.el);
  const unfit = fitBox(wrap, board);

  const squares = [];
  for (let i = 0; i < 64; i++) {
    const r = i >> 3, c = i & 7;
    const sq = h('button', { class: `sq ${(r + c) % 2 ? 'dark' : 'light'}`, 'aria-label': C.squareName(i), onclick: () => tap(i) });
    squares.push(sq);
    board.append(sq);
  }

  function restart() {
    state = C.initialState();
    history = [];
    keys = [C.positionKey(state)];
    selected = null;
    over = false;
    lastMove = null;
    render();
  }

  function undo() {
    if (!history.length) return;
    ({ state, lastMove } = history.pop());
    keys.pop();
    selected = null;
    over = false;
    render();
  }

  async function tap(i) {
    if (over) return;
    const legal = C.legalMoves(state);
    if (selected !== null) {
      const candidates = legal.filter((m) => m.from === selected && m.to === i);
      if (candidates.length) {
        let move = candidates[0];
        if (candidates.length > 1) {
          const promo = await askPromotion(state.turn);
          if (!promo) return;
          move = candidates.find((m) => m.promo === promo);
        }
        play(move);
        return;
      }
    }
    const p = state.board[i];
    if (p && p.c === state.turn && selected !== i) {
      selected = i;
      sfx('tap');
    } else {
      selected = null;
    }
    render();
  }

  function askPromotion(color) {
    return modal({
      title: '昇格する駒を選んでください',
      flip: settings.faceToFace && color === 'b',
      buttons: ['q', 'r', 'b', 'n'].map((t) => ({ label: h('span', { class: `piece ${color} promo` }, glyph(t)), value: t })),
      className: 'promo-modal',
    });
  }

  function play(move) {
    history.push({ state, lastMove });
    const next = C.makeMove(state, move);
    state = next;
    keys.push(C.positionKey(state));
    lastMove = move;
    selected = null;
    const status = C.gameStatus(state, keys);
    sfx(next.captured ? 'capture' : 'place');
    if (status.over) {
      over = true;
      render(status);
      setTimeout(() => {
        sfx('win');
        modal({
          title: status.winner ? `${NAMES[status.winner]}の勝ち！` : '引き分け',
          body: h('p', {}, status.reason),
          buttons: [{ label: '閉じる', value: false }, { label: 'もう一度', value: true, primary: true }],
        }).then((again) => { if (again) restart(); });
      }, 450);
      return;
    }
    if (status.check) setTimeout(() => sfx('check'), 120);
    render(status);
  }

  function render(status = C.gameStatus(state, keys)) {
    const targets = new Map();
    if (selected !== null) {
      for (const m of C.legalMoves(state)) if (m.from === selected) targets.set(m.to, m);
    }
    const checkSq = C.inCheck(state) ? C.kingSquare(state.board, state.turn) : -1;
    state.board.forEach((p, i) => {
      const sq = squares[i];
      const r = i >> 3, c = i & 7;
      sq.replaceChildren();
      if (c === 0) sq.append(h('span', { class: 'coord rank' }, 8 - r));
      if (r === 7) sq.append(h('span', { class: 'coord file' }, FILES[c]));
      if (p) sq.append(pieceEl(p));
      if (targets.has(i)) sq.append(h('span', { class: p || targets.get(i).ep ? 'target capture' : 'target' }));
      sq.classList.toggle('selected', i === selected);
      sq.classList.toggle('last', !!lastMove && (i === lastMove.from || i === lastMove.to));
      sq.classList.toggle('check', i === checkSq);
    });

    // 取った駒と駒得
    const captures = [...history.map((e) => e.state.captured), state.captured].filter(Boolean);
    const order = 'qrbnp';
    for (const color of ['w', 'b']) {
      const enemy = C.other(color);
      const taken = captures.filter((p) => p.c === enemy).sort((a, b) => order.indexOf(a.t) - order.indexOf(b.t))
        .map((p) => h('span', { class: `piece ${enemy} tiny` }, glyph(p.t)));
      const adv = material(color) - material(enemy);
      panels[color].setInfo(h('span', { class: 'captured' }, taken, adv > 0 ? h('small', {}, ` +${adv}`) : null));
      const active = !over && state.turn === color;
      panels[color].setActive(active);
      panels[color].setStatus(active ? (status.check ? 'チェック！' : 'あなたの番') : '');
    }
    ui.setUndoEnabled(history.length > 0);
  }

  function material(color) {
    return state.board.reduce((a, p) => a + (p && p.c === color ? VALUE[p.t] : 0), 0);
  }

  restart();
  return () => unfit();
}
