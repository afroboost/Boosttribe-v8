/**
 * ✨ EMBELLIR LE VISAGE — le rendu WebGL (navigateur uniquement).
 *
 * Deux passes (Phase caméra 2) :
 *   0. masque « peau » à basse résolution, sur couleur pré-lissée, moyenné dans le temps ;
 *   1. rendu à la PLEINE résolution de sortie, rayon proportionnel à la taille de l'image ;
 *   2. flou BILATÉRAL léger (17 échantillons sur deux anneaux) : les pixels de couleur proche
 *      sont moyennés (pores, ridules), les contours (yeux, bouche, cheveux) sont préservés ;
 *   3. mélange avec l'image d'origine à hauteur de `lissage` × masque — le grain reste ;
 *   4. touche finale : léger éclaircissement + contraste à peine réduit (flatteur, pas délavé).
 *
 *   5. 🎨 LOOK vidéo (lib/looksVideo.ts), même passe, APRÈS l'embellissement (aussi quand il est coupé).
 *
 * Aucune dépendance : ~100 lignes de GLSL. Testé visuellement par `tests/beaute.mesure.cjs`.
 */
import type { ParametresBeaute } from '@/lib/beauteLogic';
import type { ParametresLook } from '@/lib/looksVideo';

const VERTEX = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

// Passe 1 — MASQUE PEAU à basse résolution, sur une couleur PRÉ-LISSÉE (9 échantillons), puis
// MOYENNÉ DANS LE TEMPS avec le masque de l'image précédente (ping-pong). Un pixel de bord ne
// bascule plus d'une image à l'autre avec le bruit du capteur : c'était le scintillement.
const MASQUE = `
precision mediump float;
varying vec2 v_uv;
uniform sampler2D u_tex;
uniform sampler2D u_masquePrecedent;
uniform vec2 u_texel;        // 1 / taille de la source
uniform float u_alpha;       // poids de l'image courante (MASQUE_ALPHA_TEMPOREL)

float lisse(float a, float b, float x) { return smoothstep(a, b, x); }
// Miroir de masquePeauRef (lib/beauteLogic.ts) : transitions élargies.
float masquePeau(vec3 c) {
  float cb = 0.5 - 0.168736 * c.r - 0.331264 * c.g + 0.5 * c.b;
  float cr = 0.5 + 0.5 * c.r - 0.418688 * c.g - 0.081312 * c.b;
  float mCb = lisse(0.26, 0.36, cb) * (1.0 - lisse(0.50, 0.60, cb));
  float mCr = lisse(0.48, 0.58, cr) * (1.0 - lisse(0.66, 0.76, cr));
  return mCb * mCr;
}

void main() {
  vec3 c = vec3(0.0);
  for (int x = -1; x <= 1; x++) {
    for (int y = -1; y <= 1; y++) {
      c += texture2D(u_tex, v_uv + vec2(float(x), float(y)) * u_texel * 2.0).rgb;
    }
  }
  float m = masquePeau(c / 9.0);
  float avant = texture2D(u_masquePrecedent, v_uv).r;
  gl_FragColor = vec4(vec3(mix(avant, m, u_alpha)), 1.0);
}`;

// Passe 2 — RENDU à la pleine résolution de sortie : flou bilatéral léger (17 échantillons,
// rayon proportionnel à la taille de l'image), mélangé selon le masque LISSÉ.
const FRAGMENT = `
precision mediump float;
varying vec2 v_uv;
uniform sampler2D u_tex;
uniform sampler2D u_masque;
uniform vec2 u_texel;        // 1 / taille du canvas
uniform float u_lissage;     // 0..0.5
uniform float u_rayon;       // px (réglé pour 720 px de grand côté)
uniform float u_echelle;     // grand côté / 720 (même rendu visuel à toute résolution)
uniform float u_tolerance;   // 0..1
uniform float u_eclair;      // 0..1
uniform float u_contraste;   // ~1
// 🎨 05/10 — LOOK (LUT) appliqué APRÈS l'embellissement, même passe, pleine résolution.
//    Miroir EXACT de appliquerLook (lib/looksVideo.ts). Future LUT .cube : voir l'en-tête de looksVideo.ts.
uniform mat3 u_lookMat;      // matrice couleur (colonnes)
uniform vec3 u_lookDec;      // décalage
uniform vec3 u_lookOmbres;   // teinte des ombres   × (1 − l)²
uniform vec3 u_lookLumieres; // teinte des lumières × l²
uniform float u_lookSat;     // 1 = inchangée, 0 = monochrome
uniform float u_lookCon;     // 1 = inchangé

vec3 appliquerLook(vec3 c) {
  c = u_lookMat * c + u_lookDec;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c += u_lookOmbres * (1.0 - l) * (1.0 - l) + u_lookLumieres * l * l;
  l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, u_lookSat);
  c = (c - 0.5) * u_lookCon + 0.5;
  return clamp(c, 0.0, 1.0);
}

void main() {
  vec3 orig = texture2D(u_tex, v_uv).rgb;
  if (u_lissage <= 0.0) { gl_FragColor = vec4(appliquerLook(orig), 1.0); return; }

  vec3 somme = orig;
  float poids = 1.0;
  float sig = max(u_tolerance, 0.02);
  for (int a = 0; a < 2; a++) {
    float r = u_rayon * u_echelle * (a == 0 ? 1.0 : 2.0);
    float wr = (a == 0) ? 1.0 : 0.6;
    for (int i = 0; i < 8; i++) {
      float ang = float(i) * 0.7853981634 + float(a) * 0.3926990817; // anneaux décalés de 22,5°
      vec2 d = vec2(cos(ang), sin(ang)) * r * u_texel;
      vec3 s = texture2D(u_tex, v_uv + d).rgb;
      float dist = length(s - orig);
      float w = wr * exp(-(dist * dist) / (2.0 * sig * sig));
      somme += s * w;
      poids += w;
    }
  }
  vec3 lisse = somme / poids;

  float m = texture2D(u_masque, v_uv).r;
  vec3 c = mix(orig, lisse, u_lissage * m);

  // Touche finale : contraste à peine réduit + éclaircissement PROPORTIONNEL (jamais un ajout
  // brut : +0,025 sur la peau seule faisait des taches qui papillotaient avec le masque).
  c = (c - 0.5) * u_contraste + 0.5;
  c = c + u_eclair * m * (1.0 - c);
  gl_FragColor = vec4(appliquerLook(clamp(c, 0.0, 1.0)), 1.0);
}`;

export interface RenduBeaute {
  /** Dessine la source (vidéo) dans le canvas avec les paramètres courants. */
  dessiner(source: TexImageSource): void;
  setParametres(p: ParametresBeaute): void;
  /** 🎨 Look (LUT) à chaud — même canvas, même piste publiée, aucune republication. */
  setLook(p: ParametresLook): void;
  redimensionner(largeur: number, hauteur: number): void;
  detruire(): void;
  readonly canvas: HTMLCanvasElement;
}

function compiler(gl: WebGLRenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type);
  if (!sh) throw new Error('shader');
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(sh) || '';
    gl.deleteShader(sh);
    throw new Error('compilation shader : ' + info);
  }
  return sh;
}

/** Look « Original » (identité exacte) — défini ici : le rendu reste sans dépendance d'exécution. */
const LOOK_NEUTRE: ParametresLook = { matrice: [1, 0, 0, 0, 1, 0, 0, 0, 1], decalage: [0, 0, 0], teinteOmbres: [0, 0, 0], teinteLumieres: [0, 0, 0], saturation: 1, contraste: 1 };

/** WebGL 1 n'accepte pas `transpose = true` : la matrice (lignes) est passée en colonnes. */
export function matriceColonnes(m: ParametresLook['matrice']): Float32Array {
  return new Float32Array([m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]]);
}

/** Taille du masque : petite (le masque est une zone, pas un détail) — 1/4 de la source, ≤ 480 px. */
function tailleMasque(l: number, h: number): [number, number] {
  const k = Math.min(0.25, 480 / Math.max(l, h, 1));
  return [Math.max(2, Math.round(l * k)), Math.max(2, Math.round(h * k))];
}

/** Crée le rendu WebGL sur un canvas (détaché du DOM). Lève si WebGL est indisponible. */
export function creerRenduBeaute(largeur: number, hauteur: number, params: ParametresBeaute, alphaMasque = 0.3,
  lookInitial: ParametresLook = LOOK_NEUTRE): RenduBeaute {
  const canvas = document.createElement('canvas');
  canvas.width = largeur;
  canvas.height = hauteur;
  const gl = (canvas.getContext('webgl', { premultipliedAlpha: false, preserveDrawingBuffer: false, antialias: false })
    || canvas.getContext('experimental-webgl')) as WebGLRenderingContext | null;
  if (!gl) throw new Error('WebGL indisponible');

  const programme = (fragment: string) => {
    const prog = gl.createProgram();
    if (!prog) throw new Error('programme');
    gl.attachShader(prog, compiler(gl, gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(prog, compiler(gl, gl.FRAGMENT_SHADER, fragment));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('link : ' + (gl.getProgramInfoLog(prog) || ''));
    return prog;
  };
  const progMasque = programme(MASQUE);
  const prog = programme(FRAGMENT);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const brancherSommets = (p: WebGLProgram) => {
    const aPos = gl.getAttribLocation(p, 'a_pos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
  };

  const nouvelleTexture = () => {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    return t;
  };
  const tex = nouvelleTexture();
  // La vidéo arrive avec l'origine en haut : on retourne verticalement à l'envoi.
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);

  // Ping-pong du masque : deux textures + deux framebuffers à la taille du masque.
  let [ml, mh] = tailleMasque(largeur, hauteur);
  const masques = [nouvelleTexture(), nouvelleTexture()];
  const fbos = [gl.createFramebuffer(), gl.createFramebuffer()];
  const allouerMasques = () => {
    masques.forEach((t, k) => {
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, ml, mh, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbos[k]);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    });
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  };
  allouerMasques();
  let ecrit = 0;

  const uM = {
    tex: gl.getUniformLocation(progMasque, 'u_tex'), prec: gl.getUniformLocation(progMasque, 'u_masquePrecedent'),
    texel: gl.getUniformLocation(progMasque, 'u_texel'), alpha: gl.getUniformLocation(progMasque, 'u_alpha'),
  };
  const u = {
    tex: gl.getUniformLocation(prog, 'u_tex'), masque: gl.getUniformLocation(prog, 'u_masque'),
    texel: gl.getUniformLocation(prog, 'u_texel'), lissage: gl.getUniformLocation(prog, 'u_lissage'),
    rayon: gl.getUniformLocation(prog, 'u_rayon'), echelle: gl.getUniformLocation(prog, 'u_echelle'),
    tolerance: gl.getUniformLocation(prog, 'u_tolerance'), eclair: gl.getUniformLocation(prog, 'u_eclair'),
    contraste: gl.getUniformLocation(prog, 'u_contraste'),
    lookMat: gl.getUniformLocation(prog, 'u_lookMat'), lookDec: gl.getUniformLocation(prog, 'u_lookDec'),
    lookOmbres: gl.getUniformLocation(prog, 'u_lookOmbres'), lookLumieres: gl.getUniformLocation(prog, 'u_lookLumieres'),
    lookSat: gl.getUniformLocation(prog, 'u_lookSat'), lookCon: gl.getUniformLocation(prog, 'u_lookCon'),
  };

  let courant = params;
  let look = lookInitial;
  let detruit = false;
  return {
    canvas,
    dessiner(source) {
      if (detruit) return;
      try {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, source);
        const pleine = Math.max(canvas.width, canvas.height);
        if (courant.lissage > 0) {
          // Passe 1 : nouveau masque = mix(masque précédent, masque courant, alpha)
          const lire = ecrit, ecrire = 1 - ecrit;
          gl.useProgram(progMasque); brancherSommets(progMasque);
          gl.bindFramebuffer(gl.FRAMEBUFFER, fbos[ecrire]);
          gl.viewport(0, 0, ml, mh);
          gl.uniform1i(uM.tex, 0);
          gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, masques[lire]); gl.uniform1i(uM.prec, 1);
          gl.uniform2f(uM.texel, 1 / canvas.width, 1 / canvas.height);
          gl.uniform1f(uM.alpha, alphaMasque);
          gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
          gl.bindFramebuffer(gl.FRAMEBUFFER, null);
          ecrit = ecrire;
        }
        // Passe 2 : rendu pleine résolution
        gl.useProgram(prog); brancherSommets(prog);
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(u.tex, 0);
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, masques[ecrit]); gl.uniform1i(u.masque, 1);
        gl.uniform2f(u.texel, 1 / canvas.width, 1 / canvas.height);
        gl.uniform1f(u.lissage, courant.lissage);
        gl.uniform1f(u.rayon, courant.rayon);
        gl.uniform1f(u.echelle, Math.max(1, pleine / 720));
        gl.uniform1f(u.tolerance, courant.tolerance);
        gl.uniform1f(u.eclair, courant.eclaircissement);
        gl.uniform1f(u.contraste, courant.contraste);
        gl.uniformMatrix3fv(u.lookMat, false, matriceColonnes(look.matrice));
        gl.uniform3f(u.lookDec, look.decalage[0], look.decalage[1], look.decalage[2]);
        gl.uniform3f(u.lookOmbres, look.teinteOmbres[0], look.teinteOmbres[1], look.teinteOmbres[2]);
        gl.uniform3f(u.lookLumieres, look.teinteLumieres[0], look.teinteLumieres[1], look.teinteLumieres[2]);
        gl.uniform1f(u.lookSat, look.saturation);
        gl.uniform1f(u.lookCon, look.contraste);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      } catch { /* image pas encore prête (readyState < 2) : on saute l'image */ }
    },
    setParametres(p) { courant = p; },
    setLook(p) { look = p; },
    redimensionner(l, h) {
      if (canvas.width === l && canvas.height === h) return;
      canvas.width = l; canvas.height = h;
      [ml, mh] = tailleMasque(l, h);
      allouerMasques();
    },
    detruire() {
      detruit = true;
      try {
        gl.deleteTexture(tex); masques.forEach((t) => gl.deleteTexture(t)); fbos.forEach((f) => gl.deleteFramebuffer(f));
        gl.deleteBuffer(buf); gl.deleteProgram(prog); gl.deleteProgram(progMasque);
      } catch { /* ignore */ }
      try { gl.getExtension('WEBGL_lose_context')?.loseContext(); } catch { /* ignore */ }
    },
  };
}

/** Sonde de support : canvas capturable + WebGL réellement disponible sur cet appareil. */
export function sonderSupportBeaute(): { captureStream: boolean; webgl: boolean } {
  try {
    const c = document.createElement('canvas');
    const captureStream = typeof (c as HTMLCanvasElement & { captureStream?: unknown }).captureStream === 'function';
    const gl = c.getContext('webgl') || c.getContext('experimental-webgl');
    const webgl = !!gl;
    try { (gl as WebGLRenderingContext | null)?.getExtension('WEBGL_lose_context')?.loseContext(); } catch { /* ignore */ }
    return { captureStream, webgl };
  } catch {
    return { captureStream: false, webgl: false };
  }
}
