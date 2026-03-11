/**
 * AIM GAME 118 — game.js  v3.1
 *
 * Módulos:
 *  1. AntiCheat   — Bloquea zoom, pinch, touch
 *  2. Crosshair   — Cursor DOM preciso, escala proporcional
 *  3. Scale       — Escalado responsivo centrado en viewport
 *  4. Audio       — Sonidos procedurales Web Audio API
 *  5. FX          — Efectos DOM (hitmarker, float score, miss)
 *  6. Diana       — Tipos, spawn, dibujo canvas, movimiento, hitTest
 *  7. HUD         — Actualiza score, precisión, timer, combo, usuario
 *  8. API         — Comunicación con el backend FastAPI
 *  9. Auth        — Login, registro, sesión, invitado
 * 10. Leaderboard — Local (invitados) + Global (usuarios registrados)
 * 11. Game        — Flujo: init → startGame → loop → onShoot → endGame
 */

'use strict';

// URL del backend. Cámbiala si lo despliegas en otro puerto/dominio.
const API_URL = 'http://127.0.0.1:8000';

/* ═══════════════════════════════════════════════
   1. ANTI-CHEAT
   ═══════════════════════════════════════════════ */
const AntiCheat = (() => {
  function init() {
    window.addEventListener('wheel', e => {
      if (e.ctrlKey) e.preventDefault();
    }, { passive: false });

    window.addEventListener('keydown', e => {
      if (e.ctrlKey && ['+', '-', '=', '0', 'Add', 'Subtract'].includes(e.key)) {
        e.preventDefault();
      }
    });

    ['gesturestart', 'gesturechange', 'gestureend'].forEach(name =>
      window.addEventListener(name, e => e.preventDefault(), { passive: false })
    );

    window.addEventListener('touchmove', e => {
      if (e.touches.length > 1) e.preventDefault();
    }, { passive: false });
  }
  return { init };
})();


/* ═══════════════════════════════════════════════
   2. CROSSHAIR
   ═══════════════════════════════════════════════ */
const Crosshair = (() => {
  let el;

  function init() {
    el = document.getElementById('crosshair');
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseleave', () => el.classList.remove('visible'));
  }

  function onMove(e) {
    el.style.left = e.clientX + 'px';
    el.style.top  = e.clientY + 'px';
    el.classList.add('visible');
  }

  function applyScale(s) {
    const BASE  = 32;
    const size  = Math.round(BASE * s);
    const arm   = Math.round(11 * s);
    const thick = Math.max(1, Math.round(2 * s));
    const dot   = Math.max(3, Math.round(4 * s));
    const half  = Math.floor(size / 2);

    el.style.width  = size + 'px';
    el.style.height = size + 'px';

    const lines = {
      '.ch-top':    `width:${thick}px;height:${arm}px;left:${half - 1}px;top:0`,
      '.ch-bottom': `width:${thick}px;height:${arm}px;left:${half - 1}px;bottom:0`,
      '.ch-left':   `height:${thick}px;width:${arm}px;top:${half - 1}px;left:0`,
      '.ch-right':  `height:${thick}px;width:${arm}px;top:${half - 1}px;right:0`,
      '.ch-dot':    `width:${dot}px;height:${dot}px;top:${half - Math.floor(dot/2)}px;left:${half - Math.floor(dot/2)}px;border-radius:50%`,
    };
    for (const [sel, css] of Object.entries(lines)) {
      el.querySelector(sel).style.cssText = css;
    }
  }

  return { init, applyScale };
})();


/* ═══════════════════════════════════════════════
   3. SCALE
   ═══════════════════════════════════════════════ */
const Scale = (() => {
  const BASE_W = 960;
  const BASE_H = 540;
  const HUD_H  = 52;
  const FTR_H  = 28;
  const MARGIN = 12;

  let s = 1;
  let wrapper, hud, footer;

  function init() {
    wrapper = document.getElementById('canvas-wrapper');
    hud     = document.getElementById('hud');
    footer  = document.getElementById('footer');
    apply();
    window.addEventListener('resize', apply);
  }

  function apply() {
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    const availW = vw - MARGIN * 2;
    const availH = vh - HUD_H - FTR_H - MARGIN * 2;

    const sx = availW / BASE_W;
    const sy = availH / BASE_H;

    s = Math.min(sx, sy, 1);
    s = Math.max(s, 0.48);

    wrapper.style.transform       = `scale(${s})`;
    wrapper.style.transformOrigin = 'top center';
    wrapper.style.marginBottom    = `${(BASE_H * s) - BASE_H}px`;

    const scaledW = Math.round(BASE_W * s);
    hud.style.width    = scaledW + 'px';
    footer.style.width = scaledW + 'px';

    Crosshair.applyScale(s);
  }

  function toLogical(screenX, screenY) {
    const rect = wrapper.getBoundingClientRect();
    return {
      x: (screenX - rect.left) / s,
      y: (screenY - rect.top)  / s,
    };
  }

  function getScale() { return s; }
  function getBaseW() { return BASE_W; }
  function getBaseH() { return BASE_H; }

  return { init, apply, toLogical, getScale, getBaseW, getBaseH };
})();


/* ═══════════════════════════════════════════════
   4. AUDIO
   ═══════════════════════════════════════════════ */
const Audio = (() => {
  let actx = null;

  function ctx() {
    if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume();
    return actx;
  }

  function beep(freq, type, duration, vol) {
    try {
      const c    = ctx();
      const t    = c.currentTime;
      const osc  = c.createOscillator();
      const gain = c.createGain();
      osc.connect(gain);
      gain.connect(c.destination);
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t);
      osc.frequency.exponentialRampToValueAtTime(freq * 0.4, t + duration);
      gain.gain.setValueAtTime(vol, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
      osc.start(t);
      osc.stop(t + duration + 0.01);
    } catch (_) {}
  }

  function playHit(combo) {
    const f = 500 + Math.min(combo * 60, 500);
    beep(f, 'triangle', 0.10, 0.13);
  }
  function playMiss() { beep(200, 'sawtooth', 0.11, 0.07); }

  return { playHit, playMiss };
})();


/* ═══════════════════════════════════════════════
   5. FX
   ═══════════════════════════════════════════════ */
const FX = (() => {
  let layer;

  function init() { layer = document.getElementById('fx-layer'); }

  function hitmarker(lx, ly) {
    const el = document.createElement('div');
    el.className = 'fx-hitmarker';
    el.innerHTML = '<div class="fx-hm-h l"></div><div class="fx-hm-h r"></div>' +
                   '<div class="fx-hm-v t"></div><div class="fx-hm-v b"></div>';
    el.style.left = lx + 'px';
    el.style.top  = ly + 'px';
    layer.appendChild(el);
    setTimeout(() => el.remove(), 280);
  }

  function floatScore(lx, ly, pts, combo) {
    const el = document.createElement('div');
    let cls = 'fx-score';
    if (combo >= 8)      cls += ' fx-mega';
    else if (combo >= 3) cls += ' fx-combo';
    el.className   = cls;
    el.textContent = (combo >= 2 ? `×${combo} ` : '') + '+' + pts;
    el.style.left  = lx + 'px';
    el.style.top   = (ly - 12) + 'px';
    layer.appendChild(el);
    setTimeout(() => el.remove(), 760);
  }

  function miss(lx, ly) {
    const el = document.createElement('div');
    el.className  = 'fx-miss';
    el.style.left = lx + 'px';
    el.style.top  = ly + 'px';
    layer.appendChild(el);
    setTimeout(() => el.remove(), 320);
  }

  return { init, hitmarker, floatScore, miss };
})();


/* ═══════════════════════════════════════════════
   6. DIANA
   ═══════════════════════════════════════════════ */
const Diana = (() => {
  const TYPES = [
    { id:'cerca', r:24, mult:1.0, moveChance:0.18, speedLo:0.5, speedHi:1.1 },
    { id:'media', r:16, mult:1.2, moveChance:0.32, speedLo:0.9, speedHi:1.9 },
    { id:'lejos', r:10, mult:1.5, moveChance:0.48, speedLo:1.4, speedHi:2.8 },
  ];
  const WSUM = [0.40, 0.75, 1.00];
  const PAD_BETWEEN = 10;
  const PAD_EDGE    = 6;

  function pickType() {
    const r = Math.random();
    return TYPES[WSUM.findIndex(w => r < w)];
  }

  function overlaps(x, y, r, list) {
    for (const d of list) {
      const dx = x - d.x, dy = y - d.y;
      if (dx*dx + dy*dy < (r + d.r + PAD_BETWEEN) ** 2) return true;
    }
    return false;
  }

  function safePos(r, list) {
    const W = Scale.getBaseW(), H = Scale.getBaseH();
    const lo = r + PAD_EDGE;
    for (let i = 0; i < 500; i++) {
      const x = lo + Math.random() * (W - lo * 2);
      const y = lo + Math.random() * (H - lo * 2);
      if (!overlaps(x, y, r, list)) return { x, y };
    }
    return { x: lo + Math.random() * (W - lo*2), y: lo + Math.random() * (H - lo*2) };
  }

  function create(list) {
    const t   = pickType();
    const pos = safePos(t.r, list);
    const mov = Math.random() < t.moveChance;
    const spd = mov ? t.speedLo + Math.random() * (t.speedHi - t.speedLo) : 0;
    return { ...pos, r: t.r, type: t, isMoving: mov, speed: spd,
             angle: Math.random() * Math.PI * 2 };
  }

  function draw(ctx2d, d) {
    const { x, y, r, isMoving } = d;
    ctx2d.save();
    if (isMoving) {
      ctx2d.shadowColor = 'rgba(251,146,60,.70)';
      ctx2d.shadowBlur  = 7;
    }
    const rings = [
      { f: 1.00, fill: '#b91c1c' },
      { f: 0.76, fill: '#f3f4f6' },
      { f: 0.54, fill: '#dc2626' },
      { f: 0.33, fill: '#f3f4f6' },
      { f: 0.16, fill: '#ef4444' },
    ];
    rings.forEach(ring => {
      ctx2d.beginPath();
      ctx2d.arc(x, y, r * ring.f, 0, Math.PI * 2);
      ctx2d.fillStyle = ring.fill;
      ctx2d.fill();
      ctx2d.strokeStyle = 'rgba(0,0,0,.30)';
      ctx2d.lineWidth   = 0.7;
      ctx2d.stroke();
    });
    const pr = Math.max(1.2, r * 0.09);
    ctx2d.beginPath();
    ctx2d.arc(x, y, pr, 0, Math.PI * 2);
    ctx2d.fillStyle = '#111';
    ctx2d.fill();
    ctx2d.restore();
  }

  function move(d) {
    if (!d.isMoving) return;
    const W = Scale.getBaseW(), H = Scale.getBaseH();
    d.x += Math.cos(d.angle) * d.speed;
    d.y += Math.sin(d.angle) * d.speed;
    if (d.x - d.r < 0)  { d.x = d.r;    d.angle = Math.PI - d.angle; }
    if (d.x + d.r > W)  { d.x = W - d.r; d.angle = Math.PI - d.angle; }
    if (d.y - d.r < 0)  { d.y = d.r;     d.angle = -d.angle; }
    if (d.y + d.r > H)  { d.y = H - d.r; d.angle = -d.angle; }
  }

  function hitTest(d, px, py) {
    const dx = px - d.x, dy = py - d.y;
    return dx*dx + dy*dy <= d.r * d.r;
  }

  function baseScore(d) { return Math.round(100 * d.type.mult); }

  function drawPreviews() {
    document.querySelectorAll('.legend-canvas').forEach(cnv => {
      const ctx2d = cnv.getContext('2d');
      const cx = cnv.width / 2, cy = cnv.height / 2;
      const drawR = Math.min(cx, cy) - 4;
      draw(ctx2d, { x: cx, y: cy, r: drawR, isMoving: false });
    });
  }

  return { create, draw, move, hitTest, baseScore, drawPreviews };
})();


/* ═══════════════════════════════════════════════
   7. HUD
   ═══════════════════════════════════════════════ */
const HUD = (() => {
  let elScore, elAcc, elTimer, elCombo, elUser, elUsername, elSepUser;

  function init() {
    elScore    = document.getElementById('score-display');
    elAcc      = document.getElementById('acc-display');
    elTimer    = document.getElementById('timer-display');
    elCombo    = document.getElementById('combo-display');
    elUser     = document.getElementById('hud-user');
    elUsername = document.getElementById('hud-username-text');
    elSepUser  = document.getElementById('hud-sep-user');
  }

  function update({ score, shots, hits, timeLeft, combo }) {
    elScore.textContent = score.toLocaleString('es-MX');
    elAcc.textContent   = shots > 0 ? Math.round((hits / shots) * 100) + ' %' : '— %';
    elTimer.textContent = timeLeft;
    elTimer.classList.toggle('danger', timeLeft <= 10);
    if (combo >= 2) {
      elCombo.textContent = `COMBO ×${combo}`;
      elCombo.classList.remove('combo-off');
    } else {
      elCombo.classList.add('combo-off');
    }
  }

  function setUser(username) {
    if (username) {
      elUser.style.display    = 'flex';
      elSepUser.style.display = 'block';
      elUsername.textContent  = username;
    } else {
      elUser.style.display    = 'none';
      elSepUser.style.display = 'none';
    }
  }

  return { init, update, setUser };
})();


/* ═══════════════════════════════════════════════
   8. API  — Comunicación con el backend
   ═══════════════════════════════════════════════ */
const API = (() => {

  async function post(endpoint, body) {
    const res  = await fetch(`${API_URL}${endpoint}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Error del servidor');
    return data;
  }

  async function get(endpoint) {
    const res  = await fetch(`${API_URL}${endpoint}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Error del servidor');
    return data;
  }

  async function register(username, email, password) {
    return post('/register', { username, email, password });
  }

  async function login(email, password) {
    return post('/login', { email, password });
  }

  async function submitScore({ usuarioId, scoreRaw, scoreFinal, precisionPct, aciertos, disparos }) {
    return post('/submit-score', {
      usuario_id:    usuarioId,
      score_raw:     scoreRaw,
      score_final:   scoreFinal,
      precision_pct: precisionPct,
      aciertos,
      disparos,
    });
  }

  async function leaderboard() {
    return get('/leaderboard');
  }

  return { register, login, submitScore, leaderboard };
})();


/* ═══════════════════════════════════════════════
   9. AUTH  — Sesión, login, registro, invitado
   ═══════════════════════════════════════════════ */
const Auth = (() => {
  // Claves en localStorage
  const KEY_ID   = 'aimgame118_uid';
  const KEY_USER = 'aimgame118_username';

  let modal, loginError, registerError, registerSuccess;

  function init() {
    modal           = document.getElementById('auth-modal');
    loginError      = document.getElementById('login-error');
    registerError   = document.getElementById('register-error');
    registerSuccess = document.getElementById('register-success');

    // Permitir cursor dentro del modal
    modal.style.cursor = 'auto';

    // Enter en inputs de login
    ['login-email', 'login-password'].forEach(id => {
      document.getElementById(id).addEventListener('keydown', e => {
        if (e.key === 'Enter') login();
      });
    });
    // Enter en inputs de registro
    ['reg-username', 'reg-email', 'reg-password'].forEach(id => {
      document.getElementById(id).addEventListener('keydown', e => {
        if (e.key === 'Enter') register();
      });
    });
  }

  function getSession() {
    const id       = localStorage.getItem(KEY_ID);
    const username = localStorage.getItem(KEY_USER);
    return id ? { id: parseInt(id), username } : null;
  }

  function saveSession(id, username) {
    localStorage.setItem(KEY_ID,   id);
    localStorage.setItem(KEY_USER, username);
  }

  function clearSession() {
    localStorage.removeItem(KEY_ID);
    localStorage.removeItem(KEY_USER);
  }

  function showModal() {
    modal.style.display = 'flex';
    showTab('login');
  }

  function hideModal() {
    modal.style.display = 'none';
  }

  function showTab(tab) {
    document.getElementById('form-login').style.display    = tab === 'login'    ? 'block' : 'none';
    document.getElementById('form-register').style.display = tab === 'register' ? 'block' : 'none';
    document.getElementById('tab-login').classList.toggle('active',    tab === 'login');
    document.getElementById('tab-register').classList.toggle('active', tab === 'register');
    clearErrors();
  }

  function clearErrors() {
    [loginError, registerError, registerSuccess].forEach(el => {
      el.style.display = 'none';
      el.textContent   = '';
    });
  }

  function setLoading(btnId, loading) {
    const btn = document.getElementById(btnId);
    btn.disabled    = loading;
    btn.textContent = loading
      ? (btnId === 'login-btn' ? 'Entrando...' : 'Creando cuenta...')
      : (btnId === 'login-btn' ? 'Entrar'      : 'Crear cuenta');
  }

  async function login() {
    const email    = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;

    if (!email || !password) {
      showError(loginError, 'Completa todos los campos.');
      return;
    }

    setLoading('login-btn', true);
    try {
      const data = await API.login(email, password);
      saveSession(data.usuario_id, data.username);
      hideModal();
      onSessionChange();
    } catch (err) {
      showError(loginError, err.message);
    } finally {
      setLoading('login-btn', false);
    }
  }

  async function register() {
    const username = document.getElementById('reg-username').value.trim();
    const email    = document.getElementById('reg-email').value.trim();
    const password = document.getElementById('reg-password').value;

    if (!username || !email || !password) {
      showError(registerError, 'Completa todos los campos.');
      return;
    }

    setLoading('register-btn', true);
    try {
      const data = await API.register(username, email, password);
      saveSession(data.usuario_id, data.username);
      registerSuccess.textContent = `¡Cuenta creada! Bienvenido, ${data.username}.`;
      registerSuccess.style.display = 'block';
      setTimeout(() => {
        hideModal();
        onSessionChange();
      }, 1200);
    } catch (err) {
      showError(registerError, err.message);
    } finally {
      setLoading('register-btn', false);
    }
  }

  function playAsGuest() {
    clearSession();
    hideModal();
    onSessionChange();
  }

  function logout() {
    clearSession();
    onSessionChange();
  }

  function showError(el, msg) {
    el.textContent    = msg;
    el.style.display  = 'block';
  }

  // Actualiza HUD, info de sesión, y botones al cambiar sesión
  function onSessionChange() {
    const session = getSession();
    HUD.setUser(session ? session.username : null);

    const infoEl = document.getElementById('start-session-info');
    const logoutBtn = document.getElementById('logout-btn');

    if (session) {
      infoEl.innerHTML = `Jugando como <span class="logged-as">${session.username}</span>`;
      logoutBtn.style.display = 'block';
    } else {
      infoEl.innerHTML = 'Modo invitado — score no se guarda en el servidor';
      logoutBtn.style.display = 'none';
    }
  }

  return {
    init, showModal, hideModal, showTab,
    login, register, playAsGuest, logout,
    getSession, onSessionChange,
  };
})();


/* ═══════════════════════════════════════════════
   10. LEADERBOARD
   — Invitados: localStorage (Top 10 local)
   — Registrados: backend (Top 10 global)
   ═══════════════════════════════════════════════ */
const Leaderboard = (() => {
  const KEY = 'aimgame118_scores';
  const MAX = 10;

  // ── LOCAL (invitados) ────────────────────────
  function loadLocal() {
    try { return JSON.parse(localStorage.getItem(KEY)) || []; }
    catch (_) { return []; }
  }

  function saveLocal(arr) {
    try { localStorage.setItem(KEY, JSON.stringify(arr)); }
    catch (_) {}
  }

  function addLocalEntry(finalScore, acc, hits, shots) {
    const list  = loadLocal();
    const entry = {
      score: finalScore, acc, hits, shots,
      date: new Date().toLocaleDateString('es-MX', { day:'2-digit', month:'2-digit', year:'2-digit' }),
    };
    list.push(entry);
    list.sort((a, b) => b.score - a.score);
    const trimmed = list.slice(0, MAX);
    const idx     = trimmed.indexOf(entry);
    saveLocal(trimmed);
    return idx;
  }

  function renderLocal(newIdx) {
    const list = loadLocal();
    const ol   = document.getElementById('leaderboard-list');
    document.getElementById('lb-header-text').textContent = 'Top 10 — Local';
    ol.innerHTML = '';

    if (!list.length) {
      ol.innerHTML = '<li style="text-align:center;padding:8px;font-size:12px;color:var(--txt-muted)">Sin registros todavía</li>';
      return;
    }
    list.forEach((e, i) => {
      const li = document.createElement('li');
      li.className = 'lb-row' + (i === newIdx ? ' lb-new' : '');
      li.innerHTML =
        `<span class="lb-pos">${i + 1}</span>` +
        `<span class="lb-score">${e.score.toLocaleString('es-MX')}</span>` +
        `<span class="lb-acc">${e.acc}%</span>` +
        `<span class="lb-date">${e.date}</span>`;
      ol.appendChild(li);
    });
  }

  // ── GLOBAL (usuarios registrados) ────────────
  async function renderGlobal(currentUsername) {
    const ol      = document.getElementById('leaderboard-list');
    const header  = document.getElementById('lb-header-text');
    header.textContent = 'Top 10 — Global (cargando...)';
    ol.innerHTML   = '';

    try {
      const data = await API.leaderboard();
      header.textContent = 'Top 10 — Global';
      ol.innerHTML = '';

      if (!data.ranking || !data.ranking.length) {
        ol.innerHTML = '<li style="text-align:center;padding:8px;font-size:12px;color:var(--txt-muted)">Leaderboard vacío</li>';
        return;
      }

      data.ranking.forEach(e => {
        const isMe = e.username === currentUsername;
        const li   = document.createElement('li');
        li.className = 'lb-row lb-global' + (isMe ? ' lb-new' : '');
        const fecha = new Date(e.fecha_mejor).toLocaleDateString('es-MX', { day:'2-digit', month:'2-digit', year:'2-digit' });
        li.innerHTML =
          `<span class="lb-pos">${e.posicion}</span>` +
          `<span class="lb-user">${e.username}</span>` +
          `<span class="lb-score">${e.score_final.toLocaleString('es-MX')}</span>` +
          `<span class="lb-acc">${parseFloat(e.precision_pct).toFixed(0)}%</span>` +
          `<span class="lb-date">${fecha}</span>`;
        ol.appendChild(li);
      });
    } catch (_) {
      header.textContent = 'Top 10 — Global';
      ol.innerHTML = '<li style="text-align:center;padding:8px;font-size:12px;color:var(--txt-muted)">No se pudo cargar el leaderboard global</li>';
    }
  }

  return { addLocalEntry, renderLocal, renderGlobal };
})();


/* ═══════════════════════════════════════════════
   11. GAME — Flujo principal
   ═══════════════════════════════════════════════ */
const Game = (() => {
  const W = 960, H = 540;
  const TOTAL_TIME  = 60;
  const DIANA_COUNT = 5;

  let canvas, ctx;
  let startScreen, endScreen, wrapper;

  let dianas   = [];
  let shots    = 0, hits = 0, rawScore = 0, combo = 0;
  let timeLeft = TOTAL_TIME;
  let running  = false;
  let rafId = null, tickId = null;

  /* ── init ───────────────────────────────────── */
  function init() {
    canvas      = document.getElementById('game-canvas');
    ctx         = canvas.getContext('2d');
    startScreen = document.getElementById('start-screen');
    endScreen   = document.getElementById('end-screen');
    wrapper     = document.getElementById('canvas-wrapper');

    if (isTouchDevice()) {
      document.getElementById('touch-screen').style.display = 'flex';
      return;
    }

    AntiCheat.init();
    Crosshair.init();
    Scale.init();
    FX.init();
    HUD.init();
    Auth.init();
    Diana.drawPreviews();

    document.getElementById('start-btn').addEventListener('click', onStartClick);
    document.getElementById('restart-btn').addEventListener('click', onStartClick);
    canvas.addEventListener('click', onShoot);
    canvas.addEventListener('contextmenu', e => e.preventDefault());

    // Verificar si ya hay sesión activa al cargar
    const session = Auth.getSession();
    if (session) {
      // Ya hay sesión: actualizar UI directamente
      Auth.onSessionChange();
    } else {
      // Sin sesión: mostrar modal de auth
      Auth.showModal();
    }
  }

  function isTouchDevice() {
    return ('ontouchstart' in window || navigator.maxTouchPoints > 0)
        && !window.matchMedia('(pointer: fine)').matches;
  }

  /* Decide si mostrar modal o iniciar directo */
  function onStartClick() {
    startGame();
  }

  /* ── startGame ──────────────────────────────── */
  function startGame() {
    shots = hits = rawScore = combo = 0;
    timeLeft = TOTAL_TIME;
    running  = true;

    startScreen.style.display = 'none';
    endScreen.style.display   = 'none';
    wrapper.classList.remove('danger-glow');

    dianas = [];
    for (let i = 0; i < DIANA_COUNT; i++) dianas.push(Diana.create(dianas));

    HUD.update({ score: rawScore, shots, hits, timeLeft, combo });

    clearInterval(tickId);
    tickId = setInterval(tick, 1000);

    cancelAnimationFrame(rafId);
    loop();
  }

  /* ── tick (1 s) ─────────────────────────────── */
  function tick() {
    if (!running) return;
    timeLeft = Math.max(0, timeLeft - 1);
    HUD.update({ score: rawScore, shots, hits, timeLeft, combo });
    if (timeLeft <= 10) wrapper.classList.add('danger-glow');
    if (timeLeft === 0) endGame();
  }

  /* ── loop (rAF) ─────────────────────────────── */
  function loop() {
    if (!running) return;
    dianas.forEach(d => Diana.move(d));
    render();
    rafId = requestAnimationFrame(loop);
  }

  /* ── render ─────────────────────────────────── */
  function render() {
    ctx.clearRect(0, 0, W, H);
    drawBg();
    dianas.forEach(d => Diana.draw(ctx, d));
  }

  function drawBg() {
    const g = ctx.createRadialGradient(W/2, H/2, 0, W/2, H/2, W * 0.65);
    g.addColorStop(0, '#1e2a38');
    g.addColorStop(1, '#0f1520');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,.025)';
    ctx.lineWidth   = 1;
    const GRID = 80;
    for (let x = GRID; x < W; x += GRID) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke(); }
    for (let y = GRID; y < H; y += GRID) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke(); }
    ctx.restore();
  }

  /* ── onShoot ────────────────────────────────── */
  function onShoot(e) {
    if (!running) return;
    const { x: lx, y: ly } = Scale.toLogical(e.clientX, e.clientY);

    shots++;
    let hit = false;

    for (let i = 0; i < dianas.length; i++) {
      if (Diana.hitTest(dianas[i], lx, ly)) {
        hit = true;
        hits++;
        combo++;
        const comboMult = combo >= 3 ? 1 + (combo - 2) * 0.10 : 1;
        const pts       = Math.round(Diana.baseScore(dianas[i]) * comboMult);
        rawScore += pts;

        FX.hitmarker(lx, ly);
        FX.floatScore(lx, ly, pts, combo);
        Audio.playHit(combo);
        flashAndReplace(i);
        break;
      }
    }

    if (!hit) {
      combo = 0;
      FX.miss(lx, ly);
      Audio.playMiss();
    }

    HUD.update({ score: rawScore, shots, hits, timeLeft, combo });
  }

  /* ── flashAndReplace ────────────────────────── */
  function flashAndReplace(idx) {
    const { x, y, r } = dianas[idx];
    let alpha = 0.80;
    (function doFlash() {
      if (alpha <= 0) return;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.arc(x, y, r * 1.6, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.restore();
      alpha -= 0.18;
      requestAnimationFrame(doFlash);
    })();
    const rest  = dianas.filter((_, i) => i !== idx);
    dianas[idx] = Diana.create(rest);
  }

  /* ── endGame ────────────────────────────────── */
  async function endGame() {
    running = false;
    clearInterval(tickId);
    cancelAnimationFrame(rafId);

    ctx.clearRect(0, 0, W, H);
    drawBg();

    const acc   = shots > 0 ? Math.round((hits / shots) * 100) : 0;
    const final = Math.round(rawScore * (acc / 100));

    document.getElementById('res-raw').textContent   = rawScore.toLocaleString('es-MX');
    document.getElementById('res-acc').textContent   = acc + '%';
    document.getElementById('res-hits').textContent  = hits;
    document.getElementById('res-shots').textContent = shots;
    document.getElementById('res-final').textContent = final.toLocaleString('es-MX');

    const rank = calcRank(acc, final);
    document.getElementById('rank-display').innerHTML =
      `<div class="rank-badge rank-${rank}">RANGO ${rank}</div>`;

    const session   = Auth.getSession();
    const saveEl    = document.getElementById('save-status');

    if (session) {
      // Usuario registrado: guardar en backend y cargar leaderboard global
      saveEl.style.display = 'block';
      saveEl.className     = 'save-status saving';
      saveEl.textContent   = '💾 Guardando partida...';

      try {
        await API.submitScore({
          usuarioId:    session.id,
          scoreRaw:     rawScore,
          scoreFinal:   final,
          precisionPct: acc,
          aciertos:     hits,
          disparos:     shots,
        });
        saveEl.className   = 'save-status saved';
        saveEl.textContent = '✓ Partida guardada en el servidor';
      } catch (err) {
        saveEl.className   = 'save-status error';
        saveEl.textContent = `✗ No se pudo guardar: ${err.message}`;
      }

      await Leaderboard.renderGlobal(session.username);

    } else {
      // Invitado: solo localStorage
      saveEl.style.display = 'block';
      saveEl.className     = 'save-status guest';
      saveEl.textContent   = 'Modo invitado — score guardado localmente';

      const idx = Leaderboard.addLocalEntry(final, acc, hits, shots);
      Leaderboard.renderLocal(idx);
    }

    endScreen.style.display = 'flex';
  }

  function calcRank(acc, score) {
    if (acc >= 90 && score >= 9000) return 'S';
    if (acc >= 75 && score >= 5500) return 'A';
    if (acc >= 55 && score >= 2800) return 'B';
    if (acc >= 35 && score >= 1000) return 'C';
    return 'D';
  }

  return { init };
})();


/* ═══════════════════════════════════════════════
   ENTRY POINT
   ═══════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => Game.init());
