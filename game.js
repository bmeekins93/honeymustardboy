/* ===========================
   Kissing Kids — Game Logic
   ===========================
   New: Start-screen Settings (music/SFX sliders, saved), K.I.S.R.A.Y. mouth anchor,
        beam pulse + spark particles, win crowd image (hidden when cops video starts).
   Keeps: particles, best score, streaks, assist magnet, kiss-bomb, ghost-audio fixes, etc.
*/

const CONFIG = {
  GAME_DURATION_MS: 120_000,
  START_DELAY_MS: 1_000,
  SPAWN_INTERVAL_MS: 4_995,
  MAX_BABIES: 60,
  PATRICK_KISS_MS: 220,

  // Audio defaults (user-adjustable via settings)
  MUSIC_VOLUME_MENU_DEFAULT: 1.0,   // 100% on menu
  MUSIC_VOLUME_INGAME_DEFAULT: 0.20,// scaled in-game (base multiplier)
  BABY_VOLUME: 1.0,                 // element volume (WebAudio handles gain)
  BABY_GAIN: 1.10,                  // 110% via WebAudio
  MAX_CONCURRENT_CRIES: 4,

  // Sprites
  BABY_FRAME_A: "assets/baby1.png",
  BABY_FRAME_B: "assets/baby1_alt.png",
  VAP_BABY_SRC: "assets/vap_baby.png",

  PATRICK_NORMAL_SRC: "assets/patrick_normal.png",
  PATRICK_KISS_SRC: "assets/patrick_kiss.png",

  BABY_CRY_SRC: "assets/baby_cry.mp3",

  // CHEAT K-I-S (kiss bomb)
  CHEAT_HOLD_MS: 3_000,

  // Streak / multiplier
  STREAK_WINDOW_MS: 1_500,
  STREAK_MAX: 5,

  // Assist magnet
  MAGNET_RADIUS: 60,
  MAGNET_STRENGTH: 0.35,

  // K.I.S.R.A.Y. tuning
  KISRAY_CHARGE_TARGET: 35,           // target charge at x1
  KISRAY_DURATION_MS: 5_000,
  KISRAY_BEAM_HALF_WIDTH: 16,

  // Beam mouth anchor (relative to Patrick image)
  // (0,0) = top-left, (1,1) = bottom-right; defaults put origin over the mouth.
  KISRAY_MOUTH_X_FRAC: 0.50,
  KISRAY_MOUTH_Y_FRAC: 0.62,
  KISRAY_MOUTH_X_PX: 0,
  KISRAY_MOUTH_Y_PX: 0
};

// DOM refs
const gameEl = document.getElementById("game");
const hudEl = document.getElementById("hud");
const patrickEl = document.getElementById("patrick");
const timerEl = document.getElementById("timer");
const scoreEl = document.getElementById("score");
const bestScoreEl = document.getElementById("bestScore");
const streakLabelEl = document.getElementById("streakLabel");
const startScreen = document.getElementById("startScreen");
const endScreen = document.getElementById("endScreen");
const endMessageEl = document.getElementById("endMessage");
const finalScoreEl = document.getElementById("finalScore");
const startBtn = document.getElementById("startBtn");
const muteBtn = document.getElementById("muteBtn");
const kissSfx = document.getElementById("kissSfx");
const introVideo = document.getElementById("introVideo");
const gameVideo = document.getElementById("gameVideo");
const copsVideo = document.getElementById("copsVideo");
const congratsScreen = document.getElementById("congratsScreen");
const arrestText = document.getElementById("arrestText");
const menuMusic = document.getElementById("menuMusic");
const crowdImage = document.getElementById("crowdImage");

// Settings UI refs
const settingsBtn = document.getElementById("settingsBtn");
const settingsPanel = document.getElementById("settingsPanel");
const closeSettings = document.getElementById("closeSettings");
const musicVolSlider = document.getElementById("musicVol");
const musicVolLabel = document.getElementById("musicVolLabel");
const sfxVolSlider = document.getElementById("sfxVol");
const sfxVolLabel = document.getElementById("sfxVolLabel");

// K.I.S.R.A.Y. UI
const kisrayHud = document.getElementById("kisrayHud");
const kisrayBar = document.getElementById("kisrayBar");
const kisrayFill = document.getElementById("kisrayFill");
const kisrayReadyMark = document.getElementById("kisrayReadyMark");
const kisrayStatus = document.getElementById("kisrayStatus");
const kisrayOnline = document.getElementById("kisrayOnline");
const kisrayBeam = document.getElementById("kisrayBeam");

// Game state
let running = false;
let startTime = 0;
let endTime = 0;
let timerId = null;
let spawnTimerId = null;
let kisses = 0;       // raw kissed babies
let score = 0;        // points with multiplier
let multiplier = 1;
let lastKissTime = 0;
let muted = false;
let babyIdCounter = 0;

// Audio state (user settings)
const LS_MUSIC_VOL = "kk_music_vol";
const LS_SFX_VOL = "kk_sfx_vol";
let userMusicVol = parseFloat(localStorage.getItem(LS_MUSIC_VOL));
let userSfxVol = parseFloat(localStorage.getItem(LS_SFX_VOL));
if (isNaN(userMusicVol)) userMusicVol = 1.0; // 100%
if (isNaN(userSfxVol)) userSfxVol = 1.0;     // 100%

// Babies & audio tracking
const babies = new Map();        // id -> <img>
const babyAudio = new Map();     // id -> HTMLAudioElement
const audioNodes = new Map();    // id -> {srcNode, gainNode}

// Control concurrent cries
const cryingBabies = new Set();
const cryQueue = [];

// CHEAT: K-I-S
const CHEAT_KEYS = new Set(["k", "i", "s"]);
const keysDown = new Set();
let cheatTimerId = null;
let cheatHoldStart = 0;
let cheatTriggeredThisHold = false;
let suppressKissSfx = false;
let pauseCryAssignment = false;

// Best score
const LS_BEST_KEY = "kk_best_score";
let bestScore = 0;
try { bestScore = Number(localStorage.getItem(LS_BEST_KEY) || 0); } catch {}
if (bestScoreEl) bestScoreEl.textContent = String(bestScore);

// WebAudio for 110% baby cry loudness (and SFX volume control)
let audioCtx = null, babyMasterGain = null;
function ensureAudioContext() {
  if (audioCtx) return;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return;
  audioCtx = new Ctx();
  babyMasterGain = audioCtx.createGain();
  babyMasterGain.gain.value = muted ? 0 : userSfxVol; // SFX slider drives overall baby volume
  babyMasterGain.connect(audioCtx.destination);
}

// ===== Settings panel =====
function applySettingsUI() {
  musicVolSlider.value = Math.round(userMusicVol * 100);
  sfxVolSlider.value = Math.round(userSfxVol * 100);
  musicVolLabel.textContent = `${Math.round(userMusicVol * 100)}%`;
  sfxVolLabel.textContent = `${Math.round(userSfxVol * 100)}%`;
}
function setUserMusicVol(n01) {
  userMusicVol = clamp(n01, 0, 1);
  localStorage.setItem(LS_MUSIC_VOL, String(userMusicVol));
  syncMenuMusicVolume();
}
function setUserSfxVol(n01) {
  userSfxVol = clamp(n01, 0, 1);
  localStorage.setItem(LS_SFX_VOL, String(userSfxVol));
  if (babyMasterGain) babyMasterGain.gain.value = muted ? 0 : userSfxVol;
  // kiss SFX uses element volume:
  kissSfx.volume = muted ? 0 : userSfxVol;
}
settingsBtn.addEventListener("click", () => settingsPanel.classList.remove("hidden"));
closeSettings.addEventListener("click", () => settingsPanel.classList.add("hidden"));
musicVolSlider.addEventListener("input", (e) => {
  const v = Number(e.target.value) / 100;
  musicVolLabel.textContent = `${Math.round(v * 100)}%`;
  setUserMusicVol(v);
});
sfxVolSlider.addEventListener("input", (e) => {
  const v = Number(e.target.value) / 100;
  sfxVolLabel.textContent = `${Math.round(v * 100)}%`;
  setUserSfxVol(v);
});
applySettingsUI();

// ---------- Utility ----------
function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
function formatMMSS(msRemaining) {
  const totalSeconds = Math.max(0, Math.ceil(msRemaining / 1000));
  const mm = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const ss = String(totalSeconds % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}
function rectsOverlap(a, b) { return !(a.right < b.left || a.left > b.right || a.bottom < b.top || a.top > b.bottom); }
function centerOfRect(r) { return { x: r.left + r.width/2, y: r.top + r.height/2 }; }
function getPatrickRect() { return patrickEl.getBoundingClientRect(); }
function updateHUD() {
  scoreEl.textContent = String(score);
  if (streakLabelEl) streakLabelEl.textContent = "x" + multiplier;
}
function updateBestScore() {
  if (score > (bestScore || 0)) {
    bestScore = score;
    try { localStorage.setItem(LS_BEST_KEY, String(bestScore)); } catch {}
    if (bestScoreEl) bestScoreEl.textContent = String(bestScore);
  }
}

// ---------- Music (menu + in-game) ----------
function syncMenuMusicVolume() {
  if (!menuMusic) return;
  if (muted) {
    menuMusic.volume = 0;
    return;
  }
  const base = userMusicVol;
  // In-game is lower to keep SFX readable
  const vol = running
    ? CONFIG.MUSIC_VOLUME_INGAME_DEFAULT * base
    : CONFIG.MUSIC_VOLUME_MENU_DEFAULT * base;
  menuMusic.volume = clamp(vol, 0, 1);
}
function startMenuMusic() {
  if (!menuMusic) return;
  menuMusic.loop = true;
  syncMenuMusicVolume();
  menuMusic.play().catch(() => {/* will re-attempt on pointer */});
}
function stopMenuMusic() {
  if (!menuMusic) return;
  try { menuMusic.pause(); menuMusic.currentTime = 0; } catch {}
}

// ---------- Audio ----------
function playKiss() {
  if (muted || suppressKissSfx) return;
  try {
    kissSfx.volume = muted ? 0 : userSfxVol;
    kissSfx.playbackRate = 0.95 + Math.random() * 0.10;
    kissSfx.currentTime = 0;
    kissSfx.play();
  } catch {}
}

function makeBabyCry(id) {
  const a = new Audio(CONFIG.BABY_CRY_SRC);
  a.loop = true;
  a.volume = 1.0; // element stays 1; WebAudio handles gain
  ensureAudioContext();
  if (audioCtx) {
    const srcNode = audioCtx.createMediaElementSource(a);
    const gainNode = audioCtx.createGain();
    gainNode.gain.value = CONFIG.BABY_GAIN; // 110% “preamp”
    srcNode.connect(gainNode).connect(babyMasterGain);
    audioNodes.set(id, { srcNode, gainNode });
  }
  setTimeout(() => { a.play().catch(() => {}); }, 5);
  return a;
}

function setMuted(value) {
  muted = value;
  muteBtn.setAttribute("aria-pressed", value ? "true" : "false");
  muteBtn.textContent = value ? "🔇" : "🔊";

  // babies via WebAudio master gain
  if (babyMasterGain) babyMasterGain.gain.value = muted ? 0 : userSfxVol;
  // menu/game music
  syncMenuMusicVolume();
}

// Cry slots
function startBabyCry(id) {
  if (!babies.has(id) || cryingBabies.has(id)) return;
  if (pauseCryAssignment) return;
  if (cryingBabies.size >= CONFIG.MAX_CONCURRENT_CRIES) return;
  const a = makeBabyCry(id);
  cryingBabies.add(id);
  babyAudio.set(id, a);
}
function stopBabyCry(id) {
  const a = babyAudio.get(id);
  if (a) { try { a.pause(); a.currentTime = 0; } catch {} }
  babyAudio.delete(id);
  cryingBabies.delete(id);
  const nodes = audioNodes.get(id);
  if (nodes) {
    try { nodes.srcNode.disconnect(); } catch {}
    try { nodes.gainNode.disconnect(); } catch {}
    audioNodes.delete(id);
  }
}
function assignCryToNextBaby() {
  if (pauseCryAssignment) return;
  while (cryingBabies.size < CONFIG.MAX_CONCURRENT_CRIES && cryQueue.length > 0) {
    const nextId = cryQueue.shift();
    if (!babies.has(nextId)) continue;
    startBabyCry(nextId);
  }
}

// ---------- Particles & Popups ----------
function spawnHearts(x, y, n = 6) {
  for (let i = 0; i < n; i++) {
    const h = document.createElement("div");
    h.className = "particle-heart";
    const dx = (Math.random() - 0.5) * 60;
    const dy = -30 - Math.random() * 60;
    h.style.left = x + "px";
    h.style.top  = y + "px";
    h.style.setProperty("--dx", dx + "px");
    h.style.setProperty("--dy", dy + "px");
    gameEl.appendChild(h);
    h.addEventListener("animationend", () => h.remove());
  }
}
function spawnHeartsAtEl(el, n = 6) {
  const cr = gameEl.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  const cx = r.left - cr.left + r.width / 2;
  const cy = r.top  - cr.top  + r.height / 2;
  spawnHearts(cx, cy, n);
}
function spawnScorePopupAtEl(el, text) {
  const cr = gameEl.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  const x = r.left - cr.left + r.width / 2;
  const y = r.top  - cr.top  + r.height / 2;
  const p = document.createElement("div");
  p.className = "score-popup";
  p.textContent = text;
  p.style.left = x + "px";
  p.style.top  = y + "px";
  gameEl.appendChild(p);
  p.addEventListener("animationend", () => p.remove());
}

// ---------- K.I.S.R.A.Y. charge & beam ----------
let kisrayCharge = 0;
let kisrayReady = false;
let kisrayActive = false;
let kisrayEndTime = 0;
let kisrayRaf = null;
let kisraySparkInterval = null;

// cursor tracking for beam aim
let cursorX = 0, cursorY = 0;
gameEl.addEventListener("pointermove", (e) => {
  const rect = gameEl.getBoundingClientRect();
  cursorX = e.clientX - rect.left;
  cursorY = e.clientY - rect.top;
});

function addKisrayCharge(amount) {
  if (amount <= 0 || kisrayActive) return;
  kisrayCharge = clamp(kisrayCharge + amount, 0, CONFIG.KISRAY_CHARGE_TARGET);
  const pct = (kisrayCharge / CONFIG.KISRAY_CHARGE_TARGET) * 100;
  if (kisrayFill) kisrayFill.style.width = `${pct}%`;

  if (!kisrayReady && kisrayCharge >= CONFIG.KISRAY_CHARGE_TARGET) {
    kisrayReady = true;
    kisrayReadyMark.classList.remove("hidden");
    if (kisrayStatus) kisrayStatus.textContent = "Online";
    if (kisrayOnline) {
      kisrayOnline.classList.remove("hidden");
      setTimeout(() => kisrayOnline.classList.add("hidden"), 1400);
    }
  } else if (!kisrayReady) {
    if (kisrayStatus) kisrayStatus.textContent = "Charging";
  }
}
function resetKisrayCharge() {
  kisrayCharge = 0;
  kisrayReady = false;
  if (kisrayFill) kisrayFill.style.width = "0%";
  if (kisrayReadyMark) kisrayReadyMark.classList.add("hidden");
  if (kisrayStatus) kisrayStatus.textContent = "Offline";
}

function beamOriginAtMouth() {
  // compute beam origin anchored to Patrick's mouth
  const cr = gameEl.getBoundingClientRect();
  const pr = getPatrickRect();
  const x = pr.left - cr.left + pr.width * CONFIG.KISRAY_MOUTH_X_FRAC + CONFIG.KISRAY_MOUTH_X_PX;
  const y = pr.top  - cr.top  + pr.height * CONFIG.KISRAY_MOUTH_Y_FRAC + CONFIG.KISRAY_MOUTH_Y_PX;
  return { x, y };
}

function beamLengthToEdge(cx, cy, angle) {
  const w = gameEl.clientWidth, h = gameEl.clientHeight;
  const dx = Math.cos(angle), dy = Math.sin(angle);
  const ts = [];
  if (dx > 0) ts.push((w - cx) / dx);
  if (dx < 0) ts.push((0 - cx) / dx);
  if (dy > 0) ts.push((h - cy) / dy);
  if (dy < 0) ts.push((0 - cy) / dy);
  const t = Math.min(...ts.filter(v => v > 0));
  return Math.max(0, t);
}

function vaporizeBaby(id) {
  const el = babies.get(id);
  if (!el) return;
  stopBabyCry(id);
  if (el._removeHandlers) el._removeHandlers();
  el.src = CONFIG.VAP_BABY_SRC;
  // Score +1 per zap; no particles/SFX spam
  score += 1;
  kisses += 1;
  updateHUD();
  setTimeout(() => {
    el.remove();
    babies.delete(id);
    assignCryToNextBaby();
  }, 120);
}

function spawnKisraySpark(originX, originY, angle) {
  const s = document.createElement("div");
  s.className = "kisray-spark";
  s.style.left = originX + "px";
  s.style.top  = originY + "px";
  const dist = 60 + Math.random() * 180;
  const dx = Math.cos(angle) * dist;
  const dy = Math.sin(angle) * dist;
  s.style.setProperty("--dx", dx + "px");
  s.style.setProperty("--dy", dy + "px");
  gameEl.appendChild(s);
  s.addEventListener("animationend", () => s.remove());
}

function runKisrayFrame() {
  if (!kisrayActive) return;
  const now = performance.now();
  if (now >= kisrayEndTime) {
    cancelKisray();
    return;
  }

  const { x: pcx, y: pcy } = beamOriginAtMouth();
  const angle = Math.atan2(cursorY - pcy, cursorX - pcx) || 0;
  const len = beamLengthToEdge(pcx, pcy, angle);

  // position & size beam
  if (kisrayBeam) {
    kisrayBeam.style.transform = `translate(${pcx}px, ${pcy}px) rotate(${angle}rad)`;
    kisrayBeam.style.width = `${len}px`;
    kisrayBeam.classList.remove("hidden");
  }

  // hit test babies (beam as line segment with half-width)
  const ux = Math.cos(angle), uy = Math.sin(angle);
  const w = CONFIG.KISRAY_BEAM_HALF_WIDTH;
  const toZap = [];
  const cr = gameEl.getBoundingClientRect();
  babies.forEach((el, id) => {
    const br = el.getBoundingClientRect();
    const bx = br.left - cr.left + br.width/2;
    const by = br.top  - cr.top  + br.height/2;
    const vx = bx - pcx, vy = by - pcy;
    const t = vx*ux + vy*uy;
    if (t < 0 || t > len) return;
    const perp = Math.abs(vx*uy - vy*ux);
    if (perp <= w) toZap.push(id);
  });
  toZap.forEach(vaporizeBaby);

  kisrayRaf = requestAnimationFrame(runKisrayFrame);
}

function activateKisray() {
  if (!kisrayReady || kisrayActive || !running) return;
  kisrayActive = true;
  kisrayEndTime = performance.now() + CONFIG.KISRAY_DURATION_MS;

  // Patrick holds kiss face during ray
  patrickEl.src = CONFIG.PATRICK_KISS_SRC;
  kisrayBeam.classList.remove("hidden");

  // start sparks
  if (kisraySparkInterval) clearInterval(kisraySparkInterval);
  kisraySparkInterval = setInterval(() => {
    const { x: pcx, y: pcy } = beamOriginAtMouth();
    const angle = Math.atan2(cursorY - pcy, cursorX - pcx) || 0;
    spawnKisraySpark(pcx, pcy, angle);
  }, 110);

  if (kisrayRaf) cancelAnimationFrame(kisrayRaf);
  runKisrayFrame();
}
function cancelKisray() {
  if (!kisrayActive) return;
  kisrayActive = false;
  kisrayBeam.classList.add("hidden");
  patrickEl.src = CONFIG.PATRICK_NORMAL_SRC;
  resetKisrayCharge();
  if (kisrayRaf) cancelAnimationFrame(kisrayRaf);
  if (kisraySparkInterval) { clearInterval(kisraySparkInterval); kisraySparkInterval = null; }
}

// ---------- Babies ----------
function spawnOneBaby() {
  const id = ++babyIdCounter;
  const el = document.createElement("img");
  el.className = "baby";
  el.alt = "Crying baby";
  el.src = CONFIG.BABY_FRAME_A;
  el.dataset.baseSrc = CONFIG.BABY_FRAME_A;
  el.dataset.altSrc = CONFIG.BABY_FRAME_B;
  el.setAttribute("data-id", String(id));
  el.draggable = false;
  el.style.left = "0px";
  el.style.top = "0px";
  gameEl.appendChild(el);

  const pos = randomPositionAvoidingPatrick(el);
  const containerRect = gameEl.getBoundingClientRect();
  el.style.left = (pos.left - containerRect.left) + "px";
  el.style.top  = (pos.top  - containerRect.top)  + "px";

  babies.set(id, el);

  if (cryingBabies.size < CONFIG.MAX_CONCURRENT_CRIES && !pauseCryAssignment) {
    startBabyCry(id);
  } else {
    cryQueue.push(id);
  }

  attachDragHandlers(el);

  if (babies.size > CONFIG.MAX_BABIES) {
    gameOver(false, "Overwhelmed! Too many crying babies.");
  }
}

function randomPositionAvoidingPatrick(babyEl) {
  const containerRect = gameEl.getBoundingClientRect();
  const patrickRect = getPatrickRect();
  const babyRect = babyEl.getBoundingClientRect();
  const bw = babyRect.width || 80;
  const bh = babyRect.height || 80;

  const leftMin = containerRect.left;
  const topMin = containerRect.top;
  const leftMax = containerRect.right - bw;
  const topMax = containerRect.bottom - bh;

  for (let i = 0; i < 25; i++) {
    const left = Math.random() * (leftMax - leftMin) + leftMin;
    const top = Math.random() * (topMax - topMin) + topMin;
    const pretend = new DOMRect(left, top, bw, bh);
    if (!rectsOverlap(pretend, patrickRect)) return { left, top };
  }
  return {
    left: Math.random() * (leftMax - leftMin) + leftMin,
    top: Math.random() * (topMax - topMin) + topMin
  };
}

function attachDragHandlers(el) {
  let dragging = false;
  let offsetX = 0, offsetY = 0;
  let flickerTimer = null;
  const id = Number(el.getAttribute("data-id"));

  const startFlicker = () => {
    if (flickerTimer) return;
    const base = el.dataset.baseSrc;
    const alt = el.dataset.altSrc;
    let toggle = false;
    flickerTimer = setInterval(() => {
      el.src = toggle ? base : alt;
      toggle = !toggle;
    }, 70);
    el._flickerTimer = flickerTimer;
  };
  const stopFlicker = () => {
    if (flickerTimer) { clearInterval(flickerTimer); flickerTimer = null; }
    el._flickerTimer = null;
    el.src = el.dataset.baseSrc;
  };

  const onPointerDown = (e) => {
    if (!running) return;
    dragging = true;
    el.setPointerCapture(e.pointerId);
    const rect = el.getBoundingClientRect();
    offsetX = e.clientX - rect.left;
    offsetY = e.clientY - rect.top;
    startFlicker();
  };

  const onPointerMove = (e) => {
    if (!dragging) return;
    const containerRect = gameEl.getBoundingClientRect();
    let left = e.clientX - containerRect.left - offsetX;
    let top  = e.clientY - containerRect.top  - offsetY;

    const r = el.getBoundingClientRect();
    const w = r.width, h = r.height;
    left = clamp(left, 0, containerRect.width - w);
    top  = clamp(top,  0, containerRect.height - h);

    // Assist magnet
    const patrickR = getPatrickRect();
    const pC = centerOfRect(patrickR);
    const bC = { x: left + w/2 + containerRect.left, y: top + h/2 + containerRect.top };
    const dx = pC.x - bC.x;
    const dy = pC.y - bC.y;
    const dist = Math.hypot(dx, dy);
    if (dist < CONFIG.MAGNET_RADIUS && dist > 0) {
      const strength = CONFIG.MAGNET_STRENGTH * (1 - dist / CONFIG.MAGNET_RADIUS);
      left += dx * strength;
      top  += dy * strength;
      left = clamp(left, 0, containerRect.width - w);
      top  = clamp(top,  0, containerRect.height - h);
    }

    el.style.left = left + "px";
    el.style.top  = top  + "px";

    const babyRect = el.getBoundingClientRect();
    if (rectsOverlap(babyRect, patrickR)) {
      kissBaby(id);
    }
  };

  const onPointerUp = (e) => {
    dragging = false;
    stopFlicker();
    try { el.releasePointerCapture(e.pointerId); } catch {}
  };

  el.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);

  el._removeHandlers = () => {
    el.removeEventListener("pointerdown", onPointerDown);
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    stopFlicker();
  };
}

function kissBaby(id) {
  const el = babies.get(id);
  if (!el) return;

  if (!suppressKissSfx && !kisrayActive) {
    spawnHeartsAtEl(el, 6);
  }

  // Streak logic & charge (bomb/ray do not add charge)
  const now = performance.now();
  const inWindow = (now - lastKissTime) <= CONFIG.STREAK_WINDOW_MS;
  multiplier = inWindow ? Math.min(CONFIG.STREAK_MAX, multiplier + 1) : 1;
  lastKissTime = now;

  const points = 1 * multiplier;
  score += points;
  kisses++;
  if (!suppressKissSfx) {
    spawnScorePopupAtEl(el, points > 1 ? `+${points} (x${multiplier})` : `+${points}`);
  }
  updateHUD();

  if (!suppressKissSfx && !kisrayActive) {
    addKisrayCharge(multiplier);
  }

  // Stop flicker if active
  if (el._flickerTimer) { clearInterval(el._flickerTimer); el._flickerTimer = null; }

  stopBabyCry(id);

  if (el._removeHandlers) el._removeHandlers();
  el.remove();
  babies.delete(id);

  assignCryToNextBaby();

  if (!kisrayActive) {
    patrickEl.classList.add("kissing");
    patrickEl.src = CONFIG.PATRICK_KISS_SRC;
    playKiss();
    setTimeout(() => {
      patrickEl.src = CONFIG.PATRICK_NORMAL_SRC;
      patrickEl.classList.remove("kissing");
    }, CONFIG.PATRICK_KISS_MS);
  }
}

// ---------- Spawning schedule ----------
function babiesPerTick(nowMs) {
  const elapsed = nowMs - startTime;
  return Math.floor(elapsed / 10_000) + 1;
}
function startSpawning() {
  setTimeout(() => {
    if (!running) return;
    spawnNow();
    spawnTimerId = setInterval(spawnNow, CONFIG.SPAWN_INTERVAL_MS);
  }, CONFIG.START_DELAY_MS);
}
function spawnNow() {
  if (!running) return;
  const count = babiesPerTick(performance.now());
  for (let i = 0; i < count; i++) spawnOneBaby();
}

// ---------- Cheat (K-I-S) ----------
function resetCheat() {
  if (cheatTimerId) { clearInterval(cheatTimerId); cheatTimerId = null; }
  cheatHoldStart = 0;
  cheatTriggeredThisHold = false;
}
function startCheatHoldIfReady() {
  if (!running || cheatTriggeredThisHold) return;
  for (const k of CHEAT_KEYS) if (!keysDown.has(k)) return;
  if (cheatTimerId) return;
  cheatHoldStart = performance.now();
  cheatTimerId = setInterval(() => {
    if (!running) { resetCheat(); return; }
    for (const k of CHEAT_KEYS) if (!keysDown.has(k)) { resetCheat(); return; }
    if (performance.now() - cheatHoldStart >= CONFIG.CHEAT_HOLD_MS) {
      resetCheat();
      cheatTriggeredThisHold = true;
      kissBomb();
    }
  }, 50);
}
function kissBomb() {
  pauseCryAssignment = true;
  babyAudio.forEach(a => { try { a.pause(); a.currentTime = 0; } catch {} });
  babyAudio.clear();
  cryingBabies.clear();

  suppressKissSfx = true;
  const ids = Array.from(babies.keys());
  for (const id of ids) kissBaby(id);
  suppressKissSfx = false;

  cryQueue.length = 0;
  pauseCryAssignment = false;

  const cx = gameEl.clientWidth / 2;
  const cy = gameEl.clientHeight / 2;
  spawnHearts(cx, cy, Math.min(40, Math.max(12, ids.length * 2)));
  playKiss();
}

// ---------- Timer / Game flow ----------
function startGame() {
  if (running) return;

  ensureAudioContext();

  // If autoplay was blocked, try to start menu music now
  if (menuMusic && menuMusic.paused) startMenuMusic();

  running = true;
  kisses = 0;
  score = 0;
  multiplier = 1;
  lastKissTime = 0;
  updateHUD();

  // Clean up end-state visuals
  endScreen.classList.add("hidden");
  congratsScreen.classList.add("hidden");
  congratsScreen.classList.remove("fade-out");
  copsVideo.classList.add("hidden");
  arrestText.classList.add("hidden");
  crowdImage.classList.add("hidden");

  // Music: scale down for in-game
  syncMenuMusicVolume();

  // Neutral face + clear leftovers
  patrickEl.src = CONFIG.PATRICK_NORMAL_SRC;
  cleanupBabies();
  resetKisrayCharge();

  // Timer
  startTime = performance.now();
  endTime = startTime + CONFIG.GAME_DURATION_MS;
  timerEl.textContent = formatMMSS(CONFIG.GAME_DURATION_MS);
  timerId = setInterval(updateTimer, 100);

  // Video
  if (introVideo) { try { introVideo.pause(); introVideo.currentTime = 0; } catch {} }
  if (gameVideo) { gameVideo.classList.remove("hidden"); try { gameVideo.play(); } catch {} }

  // Hide start screen
  startScreen.classList.add("hidden");

  // Spawns
  startSpawning();
}
function updateTimer() {
  const now = performance.now();
  const remaining = endTime - now;
  timerEl.textContent = formatMMSS(remaining);
  if (remaining <= 0) {
    handleWin();
  }
}
function stopGameCore() {
  if (timerId) { clearInterval(timerId); timerId = null; }
  if (spawnTimerId) { clearInterval(spawnTimerId); spawnTimerId = null; }
  running = false;

  // Stop all baby audio
  babyAudio.forEach(a => { try { a.pause(); a.currentTime = 0; } catch {} });
  babyAudio.clear();
  cryingBabies.clear();
  cryQueue.length = 0;

  // Stop gameplay background video
  if (gameVideo) { try { gameVideo.pause(); gameVideo.currentTime = 0; } catch {} gameVideo.classList.add("hidden"); }

  // Stop menu/game music entirely at end, will restart on menu
  stopMenuMusic();

  // Cancel beam if needed
  cancelKisray();

  // Reset cheat state
  resetCheat();
  keysDown.clear();
}
function gameOver(won, message) {
  stopGameCore();
  updateBestScore();
  endMessageEl.textContent = message || (won ? "You Win!" : "Game Over");
  finalScoreEl.textContent = String(score);
  endScreen.classList.remove("hidden");
}
function handleWin() {
  if (!running && (timerId === null)) return;

  stopGameCore();
  cleanupBabies();
  updateBestScore();

  // Show congrats + cheering crowd behind it
  crowdImage.classList.remove("hidden");
  hudEl.classList.add("hidden");
  congratsScreen.classList.remove("hidden");

  // After 10s, fade congrats away
  const CONGRATS_MS = 10_000;
  setTimeout(() => { congratsScreen.classList.add("fade-out"); }, CONGRATS_MS);

  // After congrats fades, hide it, then start cops video and hide crowd bg
  setTimeout(() => { congratsScreen.classList.add("hidden"); }, CONGRATS_MS + 900);
  setTimeout(() => {
    crowdImage.classList.add("hidden"); // hide before cops video
    if (copsVideo) { copsVideo.classList.remove("hidden"); try { copsVideo.play(); } catch {} }
    arrestText.classList.remove("hidden");
  }, CONGRATS_MS + 1_000);
}
function cleanupBabies() {
  babies.forEach((el) => {
    if (el._removeHandlers) el._removeHandlers();
    el.remove();
  });
  babies.clear();
  babyAudio.forEach(a => { try { a.pause(); a.currentTime = 0; } catch {} });
  babyAudio.clear();
  cryingBabies.clear();
  cryQueue.length = 0;
}

// ---------- UI wiring ----------
startBtn.addEventListener("click", () => {
  // unlock audio policy with a tiny SFX gesture
  kissSfx.volume = 0;
  kissSfx.play().then(() => kissSfx.pause()).catch(() => {});
  kissSfx.volume = userSfxVol;

  // ensure menu music starts even if autoplay was blocked
  if (menuMusic && menuMusic.paused) startMenuMusic();

  startGame();
});

muteBtn.addEventListener("click", () => { setMuted(!muted); });

document.addEventListener("visibilitychange", () => {
  if (document.hidden && running) {
    gameOver(false, "Paused/hidden — ending run to prevent chaos.");
  }
});

// Start menu music immediately (or on first interaction if blocked)
startMenuMusic();
if (startScreen) {
  startScreen.addEventListener("pointerdown", () => {
    if (menuMusic && menuMusic.paused) startMenuMusic();
  }, { once: true });
}

// CHEAT: K-I-S detection + K.I.S.R.A.Y. (hold R)
window.addEventListener("keydown", (e) => {
  const key = e.key?.toLowerCase(); if (!key) return;
  if (CHEAT_KEYS.has(key)) { keysDown.add(key); startCheatHoldIfReady(); }
  if (key === "r") { if (kisrayReady && !kisrayActive && running) activateKisray(); }
});
window.addEventListener("keyup", (e) => {
  const key = e.key?.toLowerCase(); if (!key) return;
  if (CHEAT_KEYS.has(key)) { keysDown.delete(key); resetCheat(); }
  if (key === "r") { cancelKisray(); }
});
