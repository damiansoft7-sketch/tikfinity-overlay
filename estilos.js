// ═══════════════════════════════════════════════════════
//  estilos.js
//  Módulo compartido para aplicar estilos visuales a una caja de texto
//  (fuente, tamaño, color, fondo, alineación).
//  Usado por index.html (editor) y overlay.html (render final),
//  para que ambos apliquen exactamente la misma lógica.
// ═══════════════════════════════════════════════════════

export function hexToRgb(hex){
  const h = hex.replace("#","");
  const r = parseInt(h.slice(0,2),16);
  const g = parseInt(h.slice(2,4),16);
  const b = parseInt(h.slice(4,6),16);
  return {r,g,b};
}

/**
 * Aplica un objeto de estilos a un elemento .texto-contenido.
 * Acepta bold/italic/shadow como boolean o como string "true"/"false"
 * (el editor los guarda como boolean en `pe`, Firebase a veces los
 * devuelve como string desde el dataset), por eso la comparación doble.
 * @param {HTMLElement} contenido
 * @param {Object} estilos - { font, size, bold, italic, shadow, color, bgcolor, alpha, align, valign }
 */
export function aplicarEstilosAElemento(contenido, estilos){
  if(!estilos) return;
  const font    = estilos.font    || "sans-serif";
  const size    = parseInt(estilos.size)  || 48;
  const bold    = estilos.bold    === true || estilos.bold === "true";
  const italic  = estilos.italic  === true || estilos.italic === "true";
  const shadow  = estilos.shadow  === true || estilos.shadow === "true";
  const color   = estilos.color   || "#ffffff";
  const bgcolor = estilos.bgcolor || "#000000";
  const alpha   = estilos.alpha   !== undefined ? parseInt(estilos.alpha) : 100;
  const align   = estilos.align   || "center";
  const valign  = estilos.valign  || "center";

  const {r,g,b} = hexToRgb(bgcolor);
  const a = alpha / 100;

  contenido.style.fontFamily     = font;
  contenido.style.fontSize       = size + "px";
  contenido.style.fontWeight     = bold   ? "700" : "400";
  contenido.style.fontStyle      = italic ? "italic" : "normal";
  contenido.style.textShadow     = shadow ? "2px 2px 8px rgba(0,0,0,0.9)" : "none";
  contenido.style.color          = color;
  contenido.style.background     = alpha === 0 ? "transparent" : `rgba(${r},${g},${b},${a})`;
  contenido.style.textAlign      = align;
  contenido.style.justifyContent = align === "left" ? "flex-start" : align === "right" ? "flex-end" : "center";
  contenido.style.alignItems     = valign;
}
