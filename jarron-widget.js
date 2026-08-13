// ════════════════════════════════════════════════════════════════
//  WIDGET "JARRÓN DE MONEDAS"
// ════════════════════════════════════════════════════════════════
//  100% independiente de los contadores por nombre (textoLive/{id}).
//  Cada regalo que llega al overlay —le pertenezca o no a una caja
//  contador— suma su cantidad (repeatCount) directo al jarrón.
//  Ningún regalo se pierde: esté mapeado o no, cuenta igual.
//
//  El total vive en Firebase bajo "jarron/total", completamente
//  separado de "textoLive/{id}" (que siguen siendo solo para los
//  contadores por nombre que armás en el editor).
//
//  Archivo aparte para no inflar overlay.html. Lo usan tanto
//  overlay.html (vista final) como index.html (editor, para poder
//  ver / mover / redimensionar el jarrón como cualquier otra caja).
//
//  DISEÑO INTERNO IMPORTANTE:
//  Todo el sistema de canvas (partículas, monedas apiladas, recorte
//  del jarrón) usa medidas FIJAS (no getBoundingClientRect), basadas
//  en el tamaño "natural" del widget (520×854, igual que el
//  prototipo original). La caja que el usuario arrastra/redimensiona
//  en el editor se escala con un solo CSS transform sobre ese bloque
//  natural — el mismo truco que ya usa overlay.html para los iframes
//  de Tikfinity (baseWidth/baseHeight + transform:scale). Así el
//  widget se ve nítido y correcto sin importar el tamaño de caja que
//  elijas, y sin tener que recalcular nada al redimensionar.
// ════════════════════════════════════════════════════════════════

import { database, ref, onValue, runTransaction, set } from "./firebase.js";

// ── Tamaño natural del widget completo (la caja se escala a partir de esto) ──
export const JARRON_NATURAL_WIDTH = 520;
export const JARRON_NATURAL_HEIGHT = 854;
export const JARRON_META_DEFAULT = 25000;

// ── Constantes internas de layout (calcadas del prototipo, fijas) ──
const DPR = Math.min(window.devicePixelRatio || 1, 1.5);
const PARTICLE_W = 300, PARTICLE_H = 460;      // #jarStageArea (300x420) + inset -40px arriba
const JARWRAP_W = 340, JARWRAP_H = 380;        // #jarWrap / #coinCanvas
const JAR_VB_W = 300, JAR_VB_H = 400;          // viewBox del SVG del jarrón

// Cómo encaja el viewBox del SVG (300x400) dentro de #jarWrap (340x380)
// cuando el navegador lo escala de forma uniforme y centrada ("meet").
// Se calcula una sola vez porque las medidas de arriba son fijas.
const JARFIT_SCALE = Math.min(JARWRAP_W / JAR_VB_W, JARWRAP_H / JAR_VB_H);
const JARFIT_OFFX = (JARWRAP_W - JAR_VB_W * JARFIT_SCALE) / 2;
const JARFIT_OFFY = (JARWRAP_H - JAR_VB_H * JARFIT_SCALE) / 2;
function fx(x) { return JARFIT_OFFX + x * JARFIT_SCALE; }
function fy(y) { return JARFIT_OFFY + y * JARFIT_SCALE; }

const PILE_ROWS = 21, PILE_COLS = 12;
const PILE_ROW_SPACING = 11.5;
const PILE_DROP_HEIGHT = 60;
const SETTLE_SPEED = 0.085;
const CONFIG_MAX_PARTICLES = 160;
const CONFIG_MAX_VISUAL_COINS = 25;
const MAX_EVENTS = 6;
const JAR_MOUTH = { x: 150, y: 40 };

// ────────────────────────────────────────────────────────────────
//  API PÚBLICA — sumar / resetear el total (no depende de ninguna
//  instancia visual: escribe directo a Firebase; todas las cajas
//  jarrón que existan reaccionan solas por su listener de "jarron/total")
// ────────────────────────────────────────────────────────────────

// Suma "cantidad" al total del jarrón en Firebase con una transacción,
// para que sea seguro sumar aunque haya más de un proceso escribiendo
// a la vez (nunca se pierde un regalo por una condición de carrera).
export function sumarJarron(cantidad) {
  const n = parseInt(cantidad, 10) || 0;
  if (n <= 0) return Promise.resolve();
  return runTransaction(ref(database, "jarron/total"), (actual) => (actual || 0) + n)
    .catch(err => console.warn("[Jarrón] Error al sumar:", err));
}

// Pone el total del jarrón en 0 (botón "RESET JARRÓN" del editor).
export function resetearJarron() {
  return set(ref(database, "jarron/total"), 0);
}

// Avisa a TODAS las cajas jarrón visibles de un regalo recién llegado,
// para que lo muestren en su panel "EVENTOS EN VIVO". El total en sí
// ya se sincroniza solo vía Firebase; esto es solo para el detalle
// visual de "quién mandó qué".
export function notificarEventoJarron(nombreRegalo, cantidad) {
  Object.values(instancias).forEach(inst => inst.pushEvent(nombreRegalo, cantidad));
}

// ────────────────────────────────────────────────────────────────
//  CREAR / ACTUALIZAR / ELIMINAR una caja de tipo "jarron"
//  (mismo patrón que crearBoxIframe/crearBoxTexto en overlay.html)
// ────────────────────────────────────────────────────────────────

const instancias = {}; // id de caja -> instancia interna (pushEvent/setMeta/destruir)

export function crearBoxJarron(id, datos) {
  const box = document.createElement("div");
  box.className = "box";
  box.id = id;
  box.dataset.tipo = "jarron";
  box.dataset.meta = datos.meta || JARRON_META_DEFAULT;
  box.style.left = datos.left;
  box.style.top = datos.top;
  box.style.width = datos.width;
  box.style.height = datos.height;
  box.style.overflow = "hidden";

  const stage = document.createElement("div");
  stage.style.position = "absolute";
  stage.style.left = "0";
  stage.style.top = "0";
  stage.style.width = JARRON_NATURAL_WIDTH + "px";
  stage.style.height = JARRON_NATURAL_HEIGHT + "px";
  stage.style.transformOrigin = "top left";
  stage.style.pointerEvents = "none"; // los clicks/drag siempre los resuelve la caja, no el contenido interno
  box.appendChild(stage);

  instancias[id] = construirJarronInterno(stage, parseFloat(box.dataset.meta) || JARRON_META_DEFAULT);
  aplicarEscalaJarron(box, stage);
  return box;
}

export function actualizarBoxJarron(box, datos) {
  box.style.left = datos.left;
  box.style.top = datos.top;
  box.style.width = datos.width;
  box.style.height = datos.height;
  if (datos.meta !== undefined) {
    box.dataset.meta = datos.meta;
    const inst = instancias[box.id];
    if (inst) inst.setMeta(parseFloat(datos.meta) || JARRON_META_DEFAULT);
  }
  aplicarEscalaJarron(box, box.firstChild);
}

// Para usar durante un drag de redimensionado en el editor (Moveable),
// donde solo cambia el tamaño visual, no la meta ni Firebase.
export function escalarJarronBox(box) {
  aplicarEscalaJarron(box, box.firstChild);
}

export function eliminarBoxJarron(id) {
  const inst = instancias[id];
  if (inst) {
    inst.destruir();
    delete instancias[id];
  }
}

function aplicarEscalaJarron(box, stage) {
  const w = parseFloat(box.style.width) || JARRON_NATURAL_WIDTH;
  const h = parseFloat(box.style.height) || JARRON_NATURAL_HEIGHT;
  stage.style.transform = `scale(${w / JARRON_NATURAL_WIDTH}, ${h / JARRON_NATURAL_HEIGHT})`;
}

// ────────────────────────────────────────────────────────────────
//  HELPERS PUROS (sin estado de instancia) — física de partículas
// ────────────────────────────────────────────────────────────────

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

// silueta irregular (3-6 vértices) para que cada esquirla de vidrio sea única y afilada
function makeShardShape() {
  const n = 3 + Math.floor(Math.random() * 4);
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + Math.random() * 0.5;
    const rad = 0.45 + Math.random() * 0.7;
    pts.push({ x: Math.cos(a) * rad, y: Math.sin(a) * rad * (0.7 + Math.random() * 0.6) });
  }
  return pts;
}

function makeParticle(kind) {
  return {
    kind,
    x: JAR_MOUTH.x + (Math.random() * 30 - 15),
    y: JAR_MOUTH.y + (Math.random() * 10 - 30),
    vx: (Math.random() * 2 - 1) * (kind === "coin" ? 1.4 : 3.2),
    vy: -Math.random() * 2 - (kind === "coin" ? 1 : 3),
    rotation: Math.random() * Math.PI * 2,
    rotationSpeed: (Math.random() * 0.2 - 0.1) * (kind === "glass" ? 2.4 : 1),
    gravity: 0.18 + Math.random() * 0.05,
    size: kind === "coin" ? 7 + Math.random() * 3 : (kind === "glass" ? 6 + Math.random() * 9 : 2 + Math.random() * 2),
    life: 1,
    bounced: false,
    shardPoints: kind === "glass" ? makeShardShape() : null,
    hueShift: Math.random()
  };
}

function easeOutBounce(t) {
  const n1 = 7.5625, d1 = 2.75;
  if (t < 1 / d1) return n1 * t * t;
  if (t < 2 / d1) { t -= 1.5 / d1; return n1 * t * t + 0.75; }
  if (t < 2.5 / d1) { t -= 2.25 / d1; return n1 * t * t + 0.9375; }
  t -= 2.625 / d1; return n1 * t * t + 0.984375;
}

function drawCoin(c, p) {
  c.save();
  c.translate(p.x, p.y);
  c.rotate(p.rotation);
  c.globalAlpha = p.life;
  const grad = c.createLinearGradient(-p.size, -p.size, p.size, p.size);
  grad.addColorStop(0, "#ffe9a8");
  grad.addColorStop(1, "#b8791a");
  c.fillStyle = grad;
  c.beginPath();
  c.ellipse(0, 0, p.size, p.size * 0.75, 0, 0, Math.PI * 2);
  c.fill();
  c.font = `800 ${p.size * 1.0}px Georgia, serif`;
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.fillStyle = "rgba(70,42,6,0.85)";
  c.fillText("$", 0.5, 0.9);
  c.fillStyle = "#6b3f0a";
  c.fillText("$", 0, 0);
  c.fillStyle = "rgba(255,240,200,0.45)";
  c.fillText("$", -0.4, -0.5);
  c.restore();
}

function drawGlass(c, p) {
  c.save();
  c.translate(p.x, p.y);
  c.rotate(p.rotation);
  c.globalAlpha = Math.min(1, p.life) * 0.92;
  const pts = p.shardPoints || [{ x: 0, y: -1 }, { x: 1, y: 0.4 }, { x: -0.6, y: 1 }];
  const scaled = pts.map(pt => ({ x: pt.x * p.size, y: pt.y * p.size }));
  c.beginPath();
  scaled.forEach((pt, i) => { if (i === 0) c.moveTo(pt.x, pt.y); else c.lineTo(pt.x, pt.y); });
  c.closePath();
  const tint = p.hueShift > 0.6 ? "180,150,255" : "220,232,255";
  const grad = c.createLinearGradient(-p.size, -p.size, p.size, p.size);
  grad.addColorStop(0, `rgba(255,255,255,0.9)`);
  grad.addColorStop(0.45, `rgba(${tint},0.5)`);
  grad.addColorStop(1, `rgba(${tint},0.18)`);
  c.fillStyle = grad;
  c.fill();
  c.lineWidth = 0.9;
  c.strokeStyle = "rgba(255,255,255,0.75)";
  c.stroke();
  const mid = scaled[Math.floor(scaled.length / 2)];
  c.beginPath();
  c.moveTo(scaled[0].x * 0.25, scaled[0].y * 0.25);
  c.lineTo(mid.x * 0.7, mid.y * 0.7);
  c.strokeStyle = `rgba(255,255,255,${0.55 + 0.35 * Math.max(0, Math.sin(p.rotation * 2))})`;
  c.lineWidth = 0.7;
  c.stroke();
  c.restore();
}

function drawSpark(c, p) {
  c.save();
  c.globalAlpha = p.life;
  c.fillStyle = "#fff3d0";
  c.beginPath();
  c.arc(p.x, p.y, p.size, 0, Math.PI * 2);
  c.fill();
  c.restore();
}

function formatNumber(n) { return n.toLocaleString("es-PE"); }

// ────────────────────────────────────────────────────────────────
//  ESTILOS (inyectados UNA sola vez en el documento, con clases
//  prefijadas "jr-" para no chocar con nada del resto del proyecto)
// ────────────────────────────────────────────────────────────────

function inyectarEstilosUnaVez() {
  if (document.getElementById("jr-widget-styles")) return;
  const style = document.createElement("style");
  style.id = "jr-widget-styles";
  style.textContent = `
.jr-stage{
  --gold-1:#ffe9a8; --gold-2:#f4c247; --gold-3:#b8791a;
  --purple:#9b5de5; --purple-glow: rgba(150,90,220,0.22);
  --glass-edge: rgba(255,255,255,0.55); --ink:#fff6df; --panel-bg: rgba(18,14,26,0.72);
  position:relative; width:520px; height:854px; padding:26px 22px; box-sizing:border-box;
  font-family:'Segoe UI',system-ui,sans-serif; color:var(--ink); overflow:hidden;
}
.jr-header{ display:flex; align-items:center; gap:10px; }
.jr-coinIcon{ width:30px;height:30px;border-radius:50%; background:radial-gradient(circle at 35% 30%, var(--gold-1), var(--gold-3)); box-shadow:0 0 10px rgba(255,200,90,0.6); flex:none; }
.jr-titleBlock{ display:flex; flex-direction:column; }
.jr-titleText{ font-size:13px; letter-spacing:3px; font-weight:700; opacity:0.85; }
.jr-goalNums{ font-size:22px; font-weight:800; color:var(--gold-1); text-shadow:0 0 10px rgba(255,200,90,0.5); }
.jr-goalNums small{ font-size:14px; color:#cfc2e6; font-weight:600; }
.jr-progressTrack{ width:100%; height:8px; border-radius:5px; background:rgba(255,255,255,0.1); margin-top:10px; overflow:hidden; box-shadow: inset 0 0 4px rgba(0,0,0,0.4); }
.jr-progressFill{ height:100%; width:0%; border-radius:5px; background:linear-gradient(90deg,#7b2ff7,var(--purple)); box-shadow:0 0 8px rgba(155,93,229,0.8); transition:width .4s ease; }
.jr-progressPct{ text-align:center; font-size:11px; color:#d7c8f2; margin-top:4px; letter-spacing:1px; }
.jr-eventsPanel{ position:absolute; left:22px; top:120px; width:170px; background:var(--panel-bg); border:1px solid rgba(255,255,255,0.08); border-radius:10px; padding:10px; backdrop-filter: blur(4px); }
.jr-eventsPanel h5{ margin:0 0 8px; font-size:10px; letter-spacing:2px; color:#c9bbe6; font-weight:700; opacity:0.85; }
.jr-eventsList{ display:flex; flex-direction:column; gap:7px; max-height:280px; overflow:hidden; }
.jr-eventRow{ display:flex; align-items:center; gap:6px; font-size:11px; color:#f1e9ff; opacity:0; transform:translateX(-6px); animation:jrEventIn .35s ease forwards; }
@keyframes jrEventIn{ to{ opacity:1; transform:translateX(0);} }
.jr-eventRow .jr-giftIcon{ width:16px;height:16px;border-radius:50%; display:flex;align-items:center;justify-content:center; font-size:10px; flex:none; background:rgba(255,255,255,0.08); }
.jr-eventRow .jr-amt{ margin-left:auto; color:var(--gold-1); font-weight:700; }
.jr-jarStageArea{ position:relative; width:300px; height:420px; margin:26px auto 0; display:grid; justify-items:center; align-items:end; }
.jr-particleCanvas{ position:absolute; inset:-40px 0 0 0; width:300px; height:460px; grid-row:1; grid-column:1; z-index:4; }
.jr-jarWrap{ position:relative; width:340px; height:380px; filter: drop-shadow(0 0 28px var(--purple-glow)); grid-row:1; grid-column:1; z-index:2; }
.jr-jarSvg{ position:absolute; inset:0; width:100%; height:100%; }
.jr-coinCanvas{ position:absolute; inset:0; width:340px; height:380px; }
.jr-jarWrap.jr-shake{ animation: jrShakeJar .35s ease-in-out infinite; }
@keyframes jrShakeJar{ 0%,100%{ transform: translateX(0) rotate(0deg); } 25%{ transform: translateX(-3px) rotate(-0.6deg); } 75%{ transform: translateX(3px) rotate(0.6deg); } }
.jr-jarWrap.jr-shatter{ opacity:0; transition: opacity .5s ease-out; }
.jr-flash{ position:absolute; inset:-40px; border-radius:50%; background: radial-gradient(circle, rgba(255,255,255,0.9), rgba(255,220,150,0) 60%); opacity:0; }
.jr-flash.jr-pop{ animation: jrFlashPop .5s ease-out; }
@keyframes jrFlashPop{ 0%{ opacity:0; transform:scale(.6);} 30%{ opacity:1; transform:scale(1);} 100%{ opacity:0; transform:scale(1.4);} }
.jr-metaOverlay{ position:relative; width:340px; height:380px; grid-row:1; grid-column:1; z-index:5; }
.jr-metaText{ position:absolute; top:34%; left:50%; transform:translate(-50%,-50%) scale(0.7); text-align:center; color:var(--gold-1); font-weight:800; font-size:24px; letter-spacing:1px; opacity:0; text-shadow: 0 0 18px rgba(255,200,90,0.8); width:max-content; }
.jr-metaText.jr-show{ animation: jrMetaPop 5s ease forwards; }
.jr-metaText .jr-sub{ display:block; font-size:13px; font-weight:500; opacity:0.85; margin-top:6px; letter-spacing:3px; }
@keyframes jrMetaPop{ 0%{ opacity:0; transform:translate(-50%,-50%) scale(0.6); } 15%{ opacity:1; transform:translate(-50%,-50%) scale(1.08); } 25%{ transform:translate(-50%,-50%) scale(1); } 85%{ opacity:1; } 100%{ opacity:0; } }
.jr-totalBox{ width:220px; margin:16px auto 0; background:var(--panel-bg); border:1px solid rgba(255,255,255,0.08); border-radius:10px; padding:8px 14px; display:flex; align-items:center; justify-content:center; gap:8px; }
.jr-totalBox .jr-lbl{ font-size:10px; letter-spacing:2px; opacity:0.7; margin-right:auto; }
.jr-totalBox .jr-val{ font-size:18px; font-weight:800; color:var(--gold-1); display:flex; align-items:center; gap:5px; }
.jr-totalBox .jr-pct{ font-size:13px; color:var(--purple); font-weight:700; }
`;
  document.head.appendChild(style);
}

function plantillaJarron(uid) {
  return `
<div class="jr-header">
  <div class="jr-coinIcon"></div>
  <div class="jr-titleBlock">
    <div class="jr-titleText">JARRÓN DE MONEDAS</div>
    <div class="jr-goalNums"><span class="jr-headTotal">0</span> <small>/ <span class="jr-headGoal">25,000</span></small></div>
  </div>
</div>
<div class="jr-progressTrack"><div class="jr-progressFill"></div></div>
<div class="jr-progressPct"><span class="jr-progressPctVal">0%</span></div>

<div class="jr-eventsPanel">
  <h5>EVENTOS EN VIVO</h5>
  <div class="jr-eventsList"></div>
</div>

<div class="jr-jarStageArea">
  <div class="jr-jarWrap">
    <div class="jr-flash"></div>
    <canvas class="jr-coinCanvas"></canvas>
    <svg class="jr-jarSvg" viewBox="0 0 300 400" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="jr-glassGrad-${uid}" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="rgba(255,255,255,0.35)"/>
          <stop offset="45%" stop-color="rgba(180,150,255,0.05)"/>
          <stop offset="100%" stop-color="rgba(255,255,255,0.12)"/>
        </linearGradient>
        <radialGradient id="jr-purpleGlow-${uid}" cx="50%" cy="30%" r="70%">
          <stop offset="0%" stop-color="rgba(160,100,230,0.25)"/>
          <stop offset="100%" stop-color="rgba(160,100,230,0)"/>
        </radialGradient>
      </defs>
      <ellipse cx="150" cy="150" rx="165" ry="150" fill="url(#jr-purpleGlow-${uid})"/>
      <path d="M70,60 L230,60 L230,90 Q280,95 280,140 L280,330 Q280,370 220,370 L80,370 Q20,370 20,330 L20,140 Q20,95 70,90 Z"
            fill="url(#jr-glassGrad-${uid})" stroke="var(--glass-edge)" stroke-width="2.5"/>
      <path d="M55,110 L100,110 L70,340 L35,340 Z" fill="rgba(255,255,255,0.16)" opacity="0.7"/>
      <path d="M115,100 L135,100 L112,350 L94,350 Z" fill="rgba(255,255,255,0.28)" opacity="0.8"/>
      <rect x="65" y="45" width="170" height="20" rx="6" fill="rgba(255,255,255,0.25)" stroke="var(--glass-edge)" stroke-width="2"/>
      <rect x="55" y="35" width="190" height="14" rx="7" fill="rgba(255,255,255,0.35)" stroke="var(--glass-edge)" stroke-width="2"/>
      <path d="M40,100 Q32,220 42,350" stroke="rgba(255,255,255,0.55)" stroke-width="7" fill="none" stroke-linecap="round" opacity="0.55"/>
      <path d="M260,110 Q270,220 258,340" stroke="rgba(255,255,255,0.25)" stroke-width="4" fill="none" stroke-linecap="round" opacity="0.4"/>
      <ellipse cx="95" cy="140" rx="14" ry="34" fill="rgba(255,255,255,0.35)" opacity="0.6"/>
    </svg>
  </div>
  <canvas class="jr-particleCanvas"></canvas>
  <div class="jr-metaOverlay">
    <div class="jr-metaText">¡GRACIAS POR TU APOYO! 🎉<span class="jr-sub jr-metaTotal">META CUMPLIDA: 25.000 MONEDAS</span></div>
  </div>
</div>

<div class="jr-totalBox">
  <div class="jr-lbl">MONEDAS TOTALES</div>
  <div class="jr-val">🪙 <span class="jr-coinTotalValue">0</span></div>
  <div class="jr-pct jr-totalPct"></div>
</div>`;
}

// ────────────────────────────────────────────────────────────────
//  CONSTRUCCIÓN DE UNA INSTANCIA VISUAL (una por caja jarrón)
// ────────────────────────────────────────────────────────────────

let uidCounter = 0;

function construirJarronInterno(stage, metaInicial) {
  inyectarEstilosUnaVez();
  const uid = "u" + (uidCounter++);
  stage.classList.add("jr-stage");
  stage.innerHTML = plantillaJarron(uid);

  const $ = (cls) => stage.querySelector(cls);
  const headTotalEl = $(".jr-headTotal");
  const headGoalEl = $(".jr-headGoal");
  const progressFillEl = $(".jr-progressFill");
  const progressPctEl = $(".jr-progressPctVal");
  const eventsListEl = $(".jr-eventsList");
  const jarWrapEl = $(".jr-jarWrap");
  const flashEl = $(".jr-flash");
  const metaTextEl = $(".jr-metaText");
  const metaTotalEl = $(".jr-metaTotal");
  const coinTotalValueEl = $(".jr-coinTotalValue");
  const totalPctEl = $(".jr-totalPct");
  const particleCanvas = $(".jr-particleCanvas");
  const coinCanvas = $(".jr-coinCanvas");

  const particleCtx = particleCanvas.getContext("2d");
  const coinCtx = coinCanvas.getContext("2d");

  function fijarCanvas(c, ctx, w, h) {
    c.width = w * DPR;
    c.height = h * DPR;
    c.style.width = w + "px";
    c.style.height = h + "px";
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }
  fijarCanvas(particleCanvas, particleCtx, PARTICLE_W, PARTICLE_H);
  fijarCanvas(coinCanvas, coinCtx, JARWRAP_W, JARWRAP_H);

  const pileBuffer = document.createElement("canvas");
  const pileBufferCtx = pileBuffer.getContext("2d");
  fijarCanvas(pileBuffer, pileBufferCtx, JARWRAP_W, JARWRAP_H);
  let pileBufferDirty = true;

  let meta = metaInicial > 0 ? metaInicial : JARRON_META_DEFAULT;
  let totalCoins = 0;
  let particles = [];

  headGoalEl.textContent = meta.toLocaleString("es-PE");

  // ---- pila de monedas: posiciones fijas, jitter aleatorio por instancia ----
  const pileCoins = [];
  (function construirPila() {
    for (let r = 0; r < PILE_ROWS; r++) {
      for (let col = 0; col < PILE_COLS; col++) {
        const tilt = Math.random() < 0.3 ? (0.15 + Math.random() * 0.25) : (0.55 + Math.random() * 0.45);
        const neckNarrow = r > 15 ? (col - (PILE_COLS - 1) / 2) * Math.min(1, (r - 15) / 5) * 3 : 0;
        const rawX = 38 + col * 19 + (r % 2 === 0 ? 9 : 0) + (Math.random() * 4 - 2) - neckNarrow;
        const rawBaseY = 330 - r * PILE_ROW_SPACING;
        pileCoins.push({
          row: r, x: fx(rawX), baseY: fy(rawBaseY),
          jitter: (Math.random() * 3 - 1.5) * JARFIT_SCALE,
          rot: Math.random() * Math.PI * 2,
          r: (9 + Math.random() * 2) * JARFIT_SCALE,
          tilt, lightSeed: Math.random() * Math.PI * 2,
          dollarMark: tilt > 0.5,
          revealed: false, settleProgress: 0
        });
      }
    }
  })();

  let revealedCount = 0;
  let shimmerPhase = 0;

  function clipToJarShape(ctx) {
    ctx.beginPath();
    ctx.moveTo(fx(70), fy(60));
    ctx.lineTo(fx(230), fy(60));
    ctx.lineTo(fx(230), fy(90));
    ctx.quadraticCurveTo(fx(280), fy(95), fx(280), fy(140));
    ctx.lineTo(fx(280), fy(330));
    ctx.quadraticCurveTo(fx(280), fy(370), fx(220), fy(370));
    ctx.lineTo(fx(80), fy(370));
    ctx.quadraticCurveTo(fx(20), fy(370), fx(20), fy(330));
    ctx.lineTo(fx(20), fy(140));
    ctx.quadraticCurveTo(fx(20), fy(95), fx(70), fy(90));
    ctx.closePath();
    ctx.clip();
  }

  function drawSingleCoin(ctx, c, y, squashY, alpha) {
    const glow = 0.5 + 0.5 * Math.sin(shimmerPhase + c.row * 0.6 + c.x * 0.05);
    const ry = c.r * c.tilt;
    const lightAngle = Math.sin(shimmerPhase * 0.3 + c.lightSeed);

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(c.x, y);
    ctx.rotate(c.rot);
    ctx.scale(1, squashY);

    if (c.tilt > 0.28) {
      const edgeH = Math.max(2, c.r * 0.42 * c.tilt);
      const bands = 4;
      for (let b = 0; b < bands; b++) {
        const t = b / (bands - 1);
        const shade = 40 + t * 70;
        ctx.fillStyle = `rgb(${Math.round(shade * 2.2)}, ${Math.round(shade * 1.5)}, ${Math.round(shade * 0.4)})`;
        ctx.beginPath();
        ctx.ellipse(0, ry * 0.5 + edgeH * (t * 0.85), c.r, ry * 0.42, 0, 0, Math.PI);
        ctx.fill();
      }
      if (c.tilt < 0.85) {
        ctx.strokeStyle = "rgba(255,225,150,0.25)";
        ctx.lineWidth = 0.6;
        const ticks = 10;
        for (let t = 0; t < ticks; t++) {
          const a = Math.PI * (t / (ticks - 1));
          const px = Math.cos(a) * c.r;
          const py = Math.sin(a) * ry * 0.42 + ry * 0.5;
          ctx.beginPath();
          ctx.moveTo(px, py);
          ctx.lineTo(px, py + edgeH * 0.7);
          ctx.stroke();
        }
      }
    }

    const lx = -c.r * 0.4 * Math.cos(lightAngle);
    const ly = -ry * 0.45 * Math.sin(lightAngle) - ry * 0.2;
    const grad = ctx.createRadialGradient(lx, ly, 0.5, 0, 0, Math.max(c.r, 1) * 1.05);
    grad.addColorStop(0, `rgba(255,250,225,${0.95 + glow * 0.05})`);
    grad.addColorStop(0.22, `rgba(255,224,140,${0.9 + glow * 0.1})`);
    grad.addColorStop(0.55, "#e8a622");
    grad.addColorStop(0.8, "#b9791a");
    grad.addColorStop(1, "#7a4d10");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(0, 0, c.r, ry, 0, 0, Math.PI * 2);
    ctx.fill();

    if (c.tilt > 0.4) {
      ctx.strokeStyle = "rgba(90,55,8,0.6)";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(0, 0, c.r * 0.86, ry * 0.86, 0, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(255,240,200,0.55)";
      ctx.lineWidth = 0.8;
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(0, 0.6, c.r * 0.86, ry * 0.86, 0, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(90,55,8,0.35)";
      ctx.lineWidth = 0.7;
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(0, 0, c.r * 0.62, ry * 0.62, 0, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(120,75,15,0.4)";
      ctx.lineWidth = 0.6;
      ctx.stroke();
    }

    ctx.beginPath();
    ctx.ellipse(lx * 0.8, ly * 0.8, c.r * 0.22, ry * 0.13, -0.4, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255,255,255,${0.65 + glow * 0.3})`;
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(-lx * 0.5, -ly * 0.5, c.r * 0.1, ry * 0.06, -0.4, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255,235,190,${0.3 + glow * 0.2})`;
    ctx.fill();

    if (c.dollarMark && c.tilt > 0.5) {
      ctx.save();
      ctx.scale(1, c.tilt);
      ctx.font = `800 ${c.r * 0.95}px Georgia, serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "rgba(55,32,4,0.8)";
      ctx.fillText("$", 0.6, 1.1);
      ctx.fillStyle = "#6b3f0a";
      ctx.fillText("$", 0, 0);
      ctx.fillStyle = "rgba(255,240,200,0.55)";
      ctx.fillText("$", -0.4, -0.5);
      ctx.restore();
    }
    ctx.restore();
  }

  function rebuildPileBuffer() {
    pileBufferCtx.clearRect(0, 0, JARWRAP_W, JARWRAP_H);
    pileBufferCtx.save();
    clipToJarShape(pileBufferCtx);
    for (let i = 0; i < revealedCount; i++) {
      const c = pileCoins[i];
      if (c.revealed && c.settleProgress >= 1) drawSingleCoin(pileBufferCtx, c, c.baseY + c.jitter, 1, 1);
    }
    pileBufferCtx.restore();
  }

  function drawCoinPile(dt) {
    coinCtx.clearRect(0, 0, JARWRAP_W, JARWRAP_H);
    const progress = Math.min(totalCoins / meta, 1);
    if (progress <= 0 && revealedCount === 0) return;
    shimmerPhase += 0.02 * (dt || 1);
    const targetRevealed = Math.floor(progress * pileCoins.length);

    if (revealedCount < targetRevealed) {
      const step = Math.max(1, Math.ceil((targetRevealed - revealedCount) / 14));
      const newCount = Math.min(targetRevealed, revealedCount + step);
      for (let i = revealedCount; i < newCount; i++) { pileCoins[i].revealed = true; pileCoins[i].settleProgress = 0; }
      revealedCount = newCount;
    } else if (revealedCount > targetRevealed) {
      for (let i = targetRevealed; i < revealedCount; i++) { pileCoins[i].revealed = false; pileCoins[i].settleProgress = 0; }
      revealedCount = targetRevealed;
      pileBufferDirty = true;
    }

    const settling = [];
    for (let i = 0; i < revealedCount; i++) {
      const c = pileCoins[i];
      if (!c.revealed) continue;
      if (c.settleProgress < 1) {
        c.settleProgress = Math.min(1, c.settleProgress + SETTLE_SPEED * (dt || 1));
        settling.push(c);
        if (c.settleProgress >= 1) pileBufferDirty = true;
      }
    }

    if (pileBufferDirty) { rebuildPileBuffer(); pileBufferDirty = false; }

    coinCtx.save();
    clipToJarShape(coinCtx);
    coinCtx.drawImage(pileBuffer, 0, 0, JARWRAP_W, JARWRAP_H);
    for (const c of settling) {
      const bounce = easeOutBounce(c.settleProgress);
      const restY = c.baseY + c.jitter;
      const dropH = PILE_DROP_HEIGHT * JARFIT_SCALE;
      const y = (c.baseY - dropH) + (restY - (c.baseY - dropH)) * bounce;
      const squashY = 0.72 + 0.28 * Math.min(1, c.settleProgress * 1.4);
      const fadeIn = Math.min(1, c.settleProgress * 3.5);
      drawSingleCoin(coinCtx, c, y, squashY, fadeIn);
    }
    coinCtx.restore();
  }

  function spawnCoins(amount) {
    const n = Math.min(amount, CONFIG_MAX_VISUAL_COINS);
    for (let i = 0; i < n; i++) {
      if (particles.length >= CONFIG_MAX_PARTICLES) particles.shift();
      particles.push(makeParticle("coin"));
    }
  }

  function spawnExplosion() {
    const total = Math.min(CONFIG_MAX_PARTICLES, 130);
    const centerX = 150, centerY = 195;
    for (let i = 0; i < total; i++) {
      const r = Math.random();
      const kind = r < 0.55 ? "glass" : (r < 0.72 ? "spark" : "coin");
      const p = makeParticle(kind);
      const angle = Math.random() * Math.PI * 2;
      const edgeBias = 0.35 + Math.random() * 0.75;
      const ox = centerX + Math.cos(angle) * 118 * edgeBias;
      const oy = centerY + Math.sin(angle) * 150 * edgeBias;
      p.x = ox; p.y = oy;
      const dx = ox - centerX, dy = oy - centerY;
      const dist = Math.max(1, Math.hypot(dx, dy));
      const outSpeed = (kind === "glass" ? 5 : kind === "spark" ? 6.5 : 5.5) + Math.random() * 4.5;
      p.vx = (dx / dist) * outSpeed + (Math.random() * 2 - 1);
      p.vy = (dy / dist) * outSpeed - Math.random() * 2.5;
      particles.push(p);
    }
    while (particles.length > CONFIG_MAX_PARTICLES) particles.shift();
  }

  let lastTime = performance.now();
  let rafId = null;
  function tick(now) {
    const dt = Math.min((now - lastTime) / 16.67, 2.5);
    lastTime = now;
    particleCtx.clearRect(0, 0, PARTICLE_W, PARTICLE_H);
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.vy += p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rotation += p.rotationSpeed * dt;
      const floorY = 300;
      if (p.y > floorY && !p.bounced) { p.y = floorY; p.vy *= -0.35; p.vx *= 0.6; p.bounced = true; }
      if (p.bounced) p.life -= 0.012 * dt;
      if (p.kind === "coin") drawCoin(particleCtx, p);
      else if (p.kind === "glass") drawGlass(particleCtx, p);
      else drawSpark(particleCtx, p);
      if (p.life <= 0 || p.y > PARTICLE_H + 40) particles.splice(i, 1);
    }
    drawCoinPile(dt);
    rafId = requestAnimationFrame(tick);
  }
  rafId = requestAnimationFrame(tick);

  function onVisibility() { if (!document.hidden) lastTime = performance.now(); }
  document.addEventListener("visibilitychange", onVisibility);

  function updateJarLevel() {
    const progress = Math.min(totalCoins / meta, 1);
    progressFillEl.style.width = (progress * 100) + "%";
    progressPctEl.textContent = Math.round(progress * 100) + "%";
    headTotalEl.textContent = formatNumber(totalCoins);
    coinTotalValueEl.textContent = formatNumber(totalCoins);
    totalPctEl.textContent = Math.round(progress * 100) + "%";
  }

  function breakJar() {
    jarWrapEl.classList.add("jr-shake");
    setTimeout(() => flashEl.classList.add("jr-pop"), 300);
    setTimeout(() => {
      jarWrapEl.classList.remove("jr-shake");
      jarWrapEl.classList.add("jr-shatter");
      spawnExplosion();
      metaTotalEl.textContent = `META CUMPLIDA: ${formatNumber(totalCoins)} MONEDAS`;
      metaTextEl.classList.add("jr-show");
    }, 650);
  }

  // Deshace la rotura (se usa cuando el total baja de la meta otra vez,
  // p.ej. tras un RESET JARRÓN o si subís la meta manualmente)
  function restaurarJarron() {
    particles = [];
    revealedCount = 0;
    pileCoins.forEach(c => { c.revealed = false; c.settleProgress = 0; });
    pileBufferDirty = true;
    jarWrapEl.classList.remove("jr-shatter");
    jarWrapEl.classList.remove("jr-shake");
    jarWrapEl.style.opacity = "1";
    flashEl.classList.remove("jr-pop");
    metaTextEl.classList.remove("jr-show");
  }

  function pushEvent(nombreRegalo, cantidad) {
    const row = document.createElement("div");
    row.className = "jr-eventRow";
    row.innerHTML = `<span class="jr-giftIcon">🎁</span><span>${escapeHtml(nombreRegalo)}</span><span class="jr-amt">+${parseInt(cantidad, 10) || 0}</span>`;
    eventsListEl.insertBefore(row, eventsListEl.firstChild);
    while (eventsListEl.children.length > MAX_EVENTS) eventsListEl.removeChild(eventsListEl.lastChild);
  }

  // ---- sincronización en vivo con Firebase: única fuente de verdad del total ----
  const unsubscribe = onValue(ref(database, "jarron/total"), (snap) => {
    const nuevoTotal = snap.exists() ? (parseInt(snap.val(), 10) || 0) : 0;
    const delta = nuevoTotal - totalCoins;
    const eraRoto = totalCoins >= meta;
    totalCoins = nuevoTotal;
    updateJarLevel();
    if (delta > 0) spawnCoins(delta);
    const esRotoAhora = totalCoins >= meta;
    if (esRotoAhora && !eraRoto) breakJar();
    else if (!esRotoAhora && eraRoto) restaurarJarron();
  });

  function setMeta(nuevaMeta) {
    meta = nuevaMeta > 0 ? nuevaMeta : JARRON_META_DEFAULT;
    headGoalEl.textContent = meta.toLocaleString("es-PE");
    updateJarLevel();
    const esRotoAhora = totalCoins >= meta;
    const estaRotoVisualmente = jarWrapEl.classList.contains("jr-shatter");
    if (esRotoAhora && !estaRotoVisualmente) breakJar();
    else if (!esRotoAhora && estaRotoVisualmente) restaurarJarron();
  }

  function destruir() {
    cancelAnimationFrame(rafId);
    document.removeEventListener("visibilitychange", onVisibility);
    if (typeof unsubscribe === "function") unsubscribe();
  }

  updateJarLevel();

  return { pushEvent, setMeta, destruir };
}
