// ═══════════════════════════════════════════════════════
//  animaciones.js
//  Módulo compartido de animaciones de texto para cajas
//  Modos soportados: "ninguna" | "marquee" | "palabras"
//  Usado por index.html (preview en editor) y overlay.html (render final)
//
//  OPTIMIZACIÓN: todos los marquees activos comparten UN solo bucle de
//  requestAnimationFrame (en vez de uno por caja) y se actualizan a un
//  techo de ~30fps en vez de 60 — para texto que se desliza no se nota
//  la diferencia visual, pero es la mitad del trabajo para CPU/GPU.
//  El bucle también se pausa solo cuando la pestaña queda oculta.
// ═══════════════════════════════════════════════════════

const estados = new Map(); // boxId -> { tipo, intervalId, span, timeoutId, contenido, velocidad, x }

const FPS_MARQUEE = 30;
const INTERVALO_MARQUEE_MS = 1000 / FPS_MARQUEE;
let rafCompartidoId = null;
let ultimoTiempoCompartido = null;

function bucleMarqueeCompartido(t){
  rafCompartidoId = requestAnimationFrame(bucleMarqueeCompartido);

  if(document.hidden) { ultimoTiempoCompartido = null; return; } // pausado si no se ve

  if(ultimoTiempoCompartido === null) ultimoTiempoCompartido = t;
  const dtDesdeUltimoFrame = t - ultimoTiempoCompartido;
  if(dtDesdeUltimoFrame < INTERVALO_MARQUEE_MS) return; // aún no toca actualizar (techo de ~30fps)

  const dt = dtDesdeUltimoFrame / 1000;
  ultimoTiempoCompartido = t;

  estados.forEach(estado=>{
    if(estado.tipo !== "marquee") return;
    const { contenido, span } = estado;
    estado.x -= estado.velocidad * dt;
    const anchoTexto = span.offsetWidth || 0;
    if(estado.x < -anchoTexto){
      estado.x = contenido.clientWidth;
    }
    span.style.transform = `translateX(${estado.x}px) translateY(-50%)`;
  });
}

function asegurarBucleCompartidoActivo(){
  if(rafCompartidoId === null){
    ultimoTiempoCompartido = null;
    rafCompartidoId = requestAnimationFrame(bucleMarqueeCompartido);
  }
}

function detenerBucleCompartidoSiNoHaceFalta(){
  const quedanMarquees = Array.from(estados.values()).some(e => e.tipo === "marquee");
  if(!quedanMarquees && rafCompartidoId !== null){
    cancelAnimationFrame(rafCompartidoId);
    rafCompartidoId = null;
  }
}

export function detenerAnimacion(boxId){
  const estado = estados.get(boxId);
  if(!estado) return;
  if(estado.intervalId) clearInterval(estado.intervalId);
  if(estado.timeoutId) clearTimeout(estado.timeoutId);
  estados.delete(boxId);
  detenerBucleCompartidoSiNoHaceFalta();
}

// Limpia estilos/nodos que pudo haber dejado un modo anterior.
// No toca justifyContent/textAlign/alignItems: esos los maneja quien llama
// (el panel de estilos / aplicarEstilosAContenido), según la alineación elegida por el usuario.
function limpiarContenido(contenido){
  contenido.innerHTML = "";
  contenido.style.whiteSpace = "";
  contenido.style.position = "";
  contenido.style.overflow = "";
  contenido.style.transition = "";
  contenido.style.opacity = "";
  delete contenido._actualizarTextoAnimado;
}

/**
 * Aplica el modo de animación configurado a una caja de texto.
 * @param {HTMLElement} box - el elemento .box
 * @param {HTMLElement} contenido - el .texto-contenido dentro de la caja
 * @param {Object} config - { modo, velocidad, palabras, intervalo }
 * @param {string} valorInicial - texto/valor actual a mostrar (ej: valor del contador)
 */
export function aplicarAnimacion(box, contenido, config, valorInicial){
  detenerAnimacion(box.id);
  limpiarContenido(contenido);

  const modo = (config && config.modo) || "ninguna";
  const texto = valorInicial !== undefined ? String(valorInicial) : (contenido.dataset.valorActual || "");
  contenido.dataset.valorActual = texto;
  contenido.dataset.animModo = modo;

  if(modo === "marquee"){
    iniciarMarquee(box, contenido, config, texto);
  } else if(modo === "palabras"){
    iniciarPalabras(box, contenido, config);
  } else {
    contenido.textContent = texto;
  }
}

/**
 * Actualiza el valor mostrado (ej: cuando cambia un contador en Firebase)
 * sin reiniciar la animación desde cero cuando es posible.
 */
export function actualizarValorAnimado(contenido, nuevoValor){
  const texto = String(nuevoValor);
  contenido.dataset.valorActual = texto;
  if(contenido._actualizarTextoAnimado){
    contenido._actualizarTextoAnimado(texto);
  } else if(contenido.dataset.animModo !== "palabras"){
    // modo "ninguna" (las "palabras" ignoran el valor externo, usan su propia lista)
    contenido.textContent = texto;
  }
}

// ── MODO: MARQUEE (texto corredizo, de derecha a izquierda) ──
function iniciarMarquee(box, contenido, config, textoInicial){
  const velocidad = Math.max(10, Number(config && config.velocidad) || 120); // px/segundo

  contenido.style.overflow = "hidden";
  contenido.style.whiteSpace = "nowrap";
  contenido.style.justifyContent = "flex-start";
  contenido.style.position = "relative";

  const span = document.createElement("span");
  span.style.display = "inline-block";
  span.style.position = "absolute";
  span.style.top = "50%";
  span.style.left = "0";
  span.style.whiteSpace = "nowrap";
  span.style.willChange = "transform";
  span.textContent = textoInicial;
  contenido.appendChild(span);

  estados.set(box.id, {
    tipo: "marquee",
    contenido, span,
    velocidad,
    x: contenido.clientWidth
  });
  asegurarBucleCompartidoActivo();

  contenido._actualizarTextoAnimado = (nuevoTexto)=>{
    span.textContent = nuevoTexto;
  };
}

// ── MODO: PALABRAS CAMBIANTES (fade in / fade out) ──
const FADE_MS = 400;

function iniciarPalabras(box, contenido, config){
  let palabras = Array.isArray(config && config.palabras)
    ? config.palabras.map(p => String(p).trim()).filter(Boolean)
    : [];
  if(palabras.length === 0){
    palabras = [contenido.dataset.valorActual || ""];
  }
  const intervalo = Math.max(500, Number(config && config.intervalo) || 2000);

  contenido.style.transition = `opacity ${FADE_MS}ms ease`;
  contenido.style.opacity = "1";

  let idx = 0;
  contenido.textContent = palabras[0];

  const intervalId = setInterval(()=>{
    contenido.style.opacity = "0";
    const timeoutId = setTimeout(()=>{
      idx = (idx + 1) % palabras.length;
      contenido.textContent = palabras[idx];
      contenido.style.opacity = "1";
    }, FADE_MS);
    const estadoActual = estados.get(box.id) || {};
    estadoActual.timeoutId = timeoutId;
    estados.set(box.id, estadoActual);
  }, intervalo);

  estados.set(box.id, { tipo: "palabras", intervalId });
}
