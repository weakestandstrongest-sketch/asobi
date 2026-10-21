import { h, icon, modal, sfx, showRules, loadPref, savePref } from '../ui.js';

const RULES = `
<p>iPhone を机に置いて、上下に向かい合って遊びます。自分側の半分に指を置くと、マレット (打つ道具) がついてきます。</p>
<ul>
<li>パック (円盤) を打って、相手のゴール (画面の端の明るい部分) に入れたら1点。</li>
<li>二人同時に操作できます。マレットは自分の陣地 (中央線まで) しか動けません。</li>
<li>先に目標点に届いたほうが勝ち。点を取られた側からパックが出ます。</li>
<li>左の一時停止ボタンでいつでも止められます。</li>
</ul>`;

// 盤の論理サイズ。横幅を 100 とし、縦は画面の比率に合わせる
const W = 100;
const PUCK_R = 4.6;
const MALLET_R = 7.8;
const GOAL_HALF = 18;
const MAX_PUCK = 360;      // 論理単位/秒
const MAX_MALLET = 520;
const WALL_E = 0.9;
const MALLET_E = 0.85;
const FRICTION = 0.18;     // 速度の減衰率 /秒
const SUBSTEPS = 8;
const COLORS = ['#4fc3f7', '#ff7a7a'];

export function mount(root) {
  let H = 180;
  let target = loadPref('airhockey.target', 7);
  let score, puck, mallets, phase, phaseTimer, raf, last, scale = 1, paused = false;
  const pointers = new Map(); // pointerId -> player
  const trail = [];

  const canvas = h('canvas', { class: 'ah-canvas' });
  const pauseBtn = h('button', { class: 'ah-pause', 'aria-label': '一時停止', onclick: pause }, icon('pause'));
  const rotateNote = h('div', { class: 'ah-rotate' }, 'iPhone を縦向きにしてください');
  const wrap = h('div', { class: 'ah-wrap' }, canvas, pauseBtn, rotateNote);
  root.append(wrap);
  const ctx = canvas.getContext('2d');

  function resize() {
    const rect = wrap.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    canvas.style.width = rect.width + 'px';
    canvas.style.height = rect.height + 'px';
    const oldH = H;
    scale = rect.width / W;
    H = Math.max(120, rect.height / scale);
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
    wrap.classList.toggle('landscape', rect.width > rect.height);
    if (puck && oldH !== H) {
      const k = H / oldH;
      puck.y *= k;
      for (const m of mallets) { m.y *= k; m.ty *= k; }
    }
  }
  const ro = new ResizeObserver(resize);
  ro.observe(wrap);
  resize();

  function restart() {
    score = [0, 0];
    mallets = [
      { x: W / 2, y: H - 22, tx: W / 2, ty: H - 22, vx: 0, vy: 0 },
      { x: W / 2, y: 22, tx: W / 2, ty: 22, vx: 0, vy: 0 },
    ];
    serve(null);
    paused = false;
  }

  // conceded: 失点した側 (その陣地からパックを出す)。null は中央から
  function serve(conceded) {
    const y = conceded === null ? H / 2 : conceded === 0 ? H * 0.68 : H * 0.32;
    puck = { x: W / 2, y, vx: 0, vy: 0 };
    trail.length = 0;
    phase = 'play';
  }

  // ---- 入力 ----
  const toLogical = (e) => {
    const rect = canvas.getBoundingClientRect();
    return { x: (e.clientX - rect.left) / scale, y: (e.clientY - rect.top) / scale };
  };
  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const p = toLogical(e);
    const player = p.y > H / 2 ? 0 : 1;
    if ([...pointers.values()].includes(player)) return;
    pointers.set(e.pointerId, player);
    setTarget(player, p);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    e.preventDefault();
    setTarget(pointers.get(e.pointerId), toLogical(e));
  });
  const release = (e) => pointers.delete(e.pointerId);
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });

  function setTarget(player, p) {
    mallets[player].tx = p.x;
    mallets[player].ty = p.y;
  }

  // ---- 物理 ----
  function clampMallet(m, player) {
    m.x = Math.min(W - MALLET_R, Math.max(MALLET_R, m.x));
    const minY = player === 0 ? H / 2 + MALLET_R : MALLET_R;
    const maxY = player === 0 ? H - MALLET_R : H / 2 - MALLET_R;
    m.y = Math.min(maxY, Math.max(minY, m.y));
  }

  function step(dt) {
    mallets.forEach((m, player) => {
      const ox = m.x, oy = m.y;
      const dx = m.tx - m.x, dy = m.ty - m.y;
      const dist = Math.hypot(dx, dy);
      const move = Math.min(dist, MAX_MALLET * dt);
      if (dist > 1e-6) { m.x += (dx / dist) * move; m.y += (dy / dist) * move; }
      clampMallet(m, player);
      m.vx = (m.x - ox) / dt;
      m.vy = (m.y - oy) / dt;
    });

    puck.x += puck.vx * dt;
    puck.y += puck.vy * dt;

    mallets.forEach((m, player) => collideMallet(m, player));
    collideWalls();
    // 壁と挟まってめり込んだらマレットのほうを押し戻す
    mallets.forEach((m, player) => {
      const dx = puck.x - m.x, dy = puck.y - m.y;
      const d = Math.hypot(dx, dy), min = PUCK_R + MALLET_R;
      if (d < min && d > 1e-6) {
        m.x = puck.x - (dx / d) * min;
        m.y = puck.y - (dy / d) * min;
        clampMallet(m, player);
      }
    });

    const decay = Math.exp(-FRICTION * dt);
    puck.vx *= decay;
    puck.vy *= decay;
    const sp = Math.hypot(puck.vx, puck.vy);
    if (sp > MAX_PUCK) { puck.vx *= MAX_PUCK / sp; puck.vy *= MAX_PUCK / sp; }

    const inMouth = Math.abs(puck.x - W / 2) < GOAL_HALF;
    if (puck.y < 0) { if (inMouth) return goal(0); puck.y = PUCK_R; }
    if (puck.y > H) { if (inMouth) return goal(1); puck.y = H - PUCK_R; }
    return null;
  }

  function collideMallet(m, player) {
    let dx = puck.x - m.x, dy = puck.y - m.y;
    let d = Math.hypot(dx, dy);
    const min = PUCK_R + MALLET_R;
    if (d >= min) return;
    if (d < 1e-6) { dx = 0; dy = player === 0 ? -1 : 1; d = 1; }
    const nx = dx / d, ny = dy / d;
    puck.x = m.x + nx * min;
    puck.y = m.y + ny * min;
    const rel = (puck.vx - m.vx) * nx + (puck.vy - m.vy) * ny;
    if (rel < 0) {
      puck.vx -= (1 + MALLET_E) * rel * nx;
      puck.vy -= (1 + MALLET_E) * rel * ny;
      sfx('hit', -rel / 300);
    }
  }

  function collideWalls() {
    let hit = 0;
    if (puck.x < PUCK_R) { puck.x = PUCK_R; if (puck.vx < 0) { hit = -puck.vx; puck.vx = -puck.vx * WALL_E; } }
    if (puck.x > W - PUCK_R) { puck.x = W - PUCK_R; if (puck.vx > 0) { hit = puck.vx; puck.vx = -puck.vx * WALL_E; } }
    const inMouth = Math.abs(puck.x - W / 2) < GOAL_HALF;
    if (!inMouth) {
      if (puck.y < PUCK_R) { puck.y = PUCK_R; if (puck.vy < 0) { hit = -puck.vy; puck.vy = -puck.vy * WALL_E; } }
      if (puck.y > H - PUCK_R) { puck.y = H - PUCK_R; if (puck.vy > 0) { hit = puck.vy; puck.vy = -puck.vy * WALL_E; } }
    }
    // ゴールポスト (ゴール口の両端) は点として跳ね返す
    for (const py of [0, H]) {
      for (const px of [W / 2 - GOAL_HALF, W / 2 + GOAL_HALF]) {
        const dx = puck.x - px, dy = puck.y - py;
        const d = Math.hypot(dx, dy);
        if (d >= PUCK_R || d < 1e-6) continue;
        const nx = dx / d, ny = dy / d;
        puck.x = px + nx * PUCK_R;
        puck.y = py + ny * PUCK_R;
        const rel = puck.vx * nx + puck.vy * ny;
        if (rel < 0) { puck.vx -= (1 + WALL_E) * rel * nx; puck.vy -= (1 + WALL_E) * rel * ny; hit = -rel; }
      }
    }
    if (hit > 20) sfx('wall', hit / 300);
  }

  function goal(scorer) {
    score[scorer]++;
    sfx('goal');
    phase = score[scorer] >= target ? 'over' : 'goal';
    phaseTimer = 1.3;
    puck.vx = puck.vy = 0;
    if (phase === 'over') setTimeout(() => showResult(scorer), 700);
    return scorer;
  }

  async function showResult(winner) {
    sfx('win');
    const again = await modal({
      title: `${winner === 0 ? '下' : '上'}の人の勝ち！`,
      body: h('p', { class: 'result-score' }, `${score[0]} − ${score[1]}`),
      flip: winner === 1,
      buttons: [{ label: 'メニューへ', value: 'menu' }, { label: 'もう一度', value: 'again', primary: true }],
      dismissible: false,
    });
    if (again === 'again') restart();
    else if (again === 'menu') location.hash = '#/';
  }

  async function pause() {
    if (phase === 'over') return;
    paused = true;
    sfx('tap');
    const choice = await modal({
      title: '一時停止中',
      body: h('div', {},
        h('p', {}, `${score[0]} − ${score[1]}（${target}点先取）`),
        h('div', { class: 'segmented' }, [5, 7, 10].map((n) => h('button', {
          class: n === target ? 'on' : '',
          onclick: (e) => {
            target = n;
            savePref('airhockey.target', n);
            e.currentTarget.parentNode.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === e.currentTarget));
          },
        }, `${n}点先取`)))),
      buttons: [
        { label: 'メニューへ', value: 'menu' },
        { label: 'ルール', value: 'rules' },
        { label: '最初から', value: 'restart' },
        { label: '再開', value: 'resume', primary: true },
      ],
    });
    if (choice === 'menu') { location.hash = '#/'; return; }
    if (choice === 'restart') restart();
    if (choice === 'rules') await showRules('エアホッケー', RULES);
    pointers.clear();
    paused = false;
    last = performance.now();
  }

  // ---- 描画 ----
  function draw() {
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#0b1f33';
    ctx.fillRect(0, 0, W, H);
    // 陣地の色
    const grad0 = ctx.createLinearGradient(0, H, 0, H / 2);
    grad0.addColorStop(0, 'rgba(79,195,247,0.16)');
    grad0.addColorStop(1, 'rgba(79,195,247,0)');
    ctx.fillStyle = grad0;
    ctx.fillRect(0, H / 2, W, H / 2);
    const grad1 = ctx.createLinearGradient(0, 0, 0, H / 2);
    grad1.addColorStop(0, 'rgba(255,122,122,0.16)');
    grad1.addColorStop(1, 'rgba(255,122,122,0)');
    ctx.fillStyle = grad1;
    ctx.fillRect(0, 0, W, H / 2);

    ctx.lineWidth = 0.6;
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath();
    ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(W / 2, H / 2, 14, 0, Math.PI * 2);
    ctx.stroke();
    for (const [py, color, start] of [[0, COLORS[1], 0], [H, COLORS[0], Math.PI]]) {
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.6;
      ctx.beginPath();
      ctx.arc(W / 2, py, GOAL_HALF + 6, start, start + Math.PI);
      ctx.stroke();
      ctx.globalAlpha = 1;
      // ゴール口
      ctx.lineWidth = 2.2;
      ctx.strokeStyle = '#fff';
      ctx.shadowColor = color;
      ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.moveTo(W / 2 - GOAL_HALF, py); ctx.lineTo(W / 2 + GOAL_HALF, py);
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.lineWidth = 0.6;
    }
    // 枠
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 1.2;
    ctx.strokeRect(0.6, 0.6, W - 1.2, H - 1.2);

    // 得点 (上の人は逆さに)
    ctx.font = '700 13px -apple-system, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(79,195,247,0.85)';
    ctx.fillText(score[0], W - 6, H / 2 + 12);
    ctx.save();
    ctx.translate(W - 6, H / 2 - 12);
    ctx.rotate(Math.PI);
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(255,122,122,0.85)';
    ctx.fillText(score[1], 0, 0);
    ctx.restore();

    // パックの軌跡
    trail.forEach((t, i) => {
      ctx.globalAlpha = (i / trail.length) * 0.25;
      ctx.fillStyle = '#ffe066';
      ctx.beginPath();
      ctx.arc(t.x, t.y, PUCK_R * (0.5 + 0.5 * i / trail.length), 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;

    if (phase === 'play' || phase === 'over' || phase === 'goal') {
      ctx.fillStyle = '#ffe066';
      ctx.shadowColor = '#ffe066';
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(puck.x, puck.y, PUCK_R, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.arc(puck.x, puck.y, PUCK_R * 0.6, 0, Math.PI * 2);
      ctx.stroke();
    }

    mallets.forEach((m, i) => {
      ctx.fillStyle = COLORS[i];
      ctx.shadowColor = COLORS[i];
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.arc(m.x, m.y, MALLET_R, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.beginPath();
      ctx.arc(m.x, m.y, MALLET_R * 0.62, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = COLORS[i];
      ctx.beginPath();
      ctx.arc(m.x, m.y, MALLET_R * 0.42, 0, Math.PI * 2);
      ctx.fill();
    });

    if (phase === 'goal' || phase === 'over') {
      // 得点した側から読める向きで表示
      const scorer = goalScorer;
      ctx.save();
      ctx.translate(W / 2, H / 2 + (scorer === 0 ? 30 : -30));
      if (scorer === 1) ctx.rotate(Math.PI);
      ctx.font = '800 15px -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = COLORS[scorer];
      ctx.fillText(phase === 'over' ? 'WIN!' : 'GOAL!', 0, 0);
      ctx.restore();
    }
  }

  let goalScorer = 0;

  function frame(now) {
    raf = requestAnimationFrame(frame);
    const elapsed = Math.min(0.033, (now - (last ?? now)) / 1000);
    last = now;
    if (!paused && !document.hidden) {
      if (phase === 'play' && elapsed > 0) {
        const dt = elapsed / SUBSTEPS;
        for (let i = 0; i < SUBSTEPS; i++) {
          const scored = step(dt);
          if (scored !== null) { goalScorer = scored; break; }
        }
        trail.push({ x: puck.x, y: puck.y });
        if (trail.length > 8) trail.shift();
      } else if (phase === 'goal') {
        phaseTimer -= elapsed;
        if (phaseTimer <= 0) serve(1 - goalScorer);
      }
    }
    draw();
  }

  restart();
  raf = requestAnimationFrame(frame);
  return () => {
    cancelAnimationFrame(raf);
    ro.disconnect();
  };
}
