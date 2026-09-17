/**
 * ✨ EMBELLIR LE VISAGE — le rendu WebGL (navigateur uniquement).
 *
 * Un seul programme : pour chaque pixel,
 *   1. masque « peau » doux (chrominance Cb/Cr dans la plage des carnations, toutes teintes) ;
 *   2. flou BILATÉRAL léger (17 échantillons sur deux anneaux) : les pixels de couleur proche
 *      sont moyennés (pores, ridules), les contours (yeux, bouche, cheveux) sont préservés ;
 *   3. mélange avec l'image d'origine à hauteur de `lissage` × masque — le grain reste ;
 *   4. touche finale : léger éclaircissement + contraste à peine réduit (flatteur, pas délavé).
 *
 * Aucune dépendance : ~100 lignes de GLSL. Testé visuellement par `tests/beaute.mesure.cjs`.
 */
import type { ParametresBeaute } from '@/lib/beauteLogic';

const VERTEX = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

const FRAGMENT = `
precision mediump float;
varying vec2 v_uv;
uniform sampler2D u_tex;
uniform vec2 u_texel;        // 1 / taille du canvas
uniform float u_lissage;     // 0..0.5
uniform float u_rayon;       // px
uniform float u_tolerance;   // 0..1
uniform float u_eclair;      // 0..1
uniform float u_contraste;   // ~1

// Masque peau : Cb/Cr (BT.601) dans la plage des carnations, bords adoucis.
float masquePeau(vec3 c) {
  float cb = 0.5 - 0.168736 * c.r - 0.331264 * c.g + 0.5 * c.b;
  float cr = 0.5 + 0.5 * c.r - 0.418688 * c.g - 0.081312 * c.b;
  float mCb = smoothstep(0.30, 0.36, cb) * (1.0 - smoothstep(0.50, 0.56, cb));
  float mCr = smoothstep(0.50, 0.55, cr) * (1.0 - smoothstep(0.68, 0.74, cr));
  return mCb * mCr;
}

void main() {
  vec3 orig = texture2D(u_tex, v_uv).rgb;
  if (u_lissage <= 0.0) { gl_FragColor = vec4(orig, 1.0); return; }

  // Flou bilatéral : deux anneaux de 8 échantillons (rayon r et 2r) + centre.
  vec3 somme = orig;
  float poids = 1.0;
  float sig = max(u_tolerance, 0.02);
  for (int a = 0; a < 2; a++) {
    float r = u_rayon * (a == 0 ? 1.0 : 2.0);
    float wr = (a == 0) ? 1.0 : 0.6;
    for (int i = 0; i < 8; i++) {
      float ang = float(i) * 0.7853981634; // 45°
      vec2 d = vec2(cos(ang), sin(ang)) * r * u_texel;
      vec3 s = texture2D(u_tex, v_uv + d).rgb;
      float dist = length(s - orig);
      float w = wr * exp(-(dist * dist) / (2.0 * sig * sig));
      somme += s * w;
      poids += w;
    }
  }
  vec3 lisse = somme / poids;

  float m = masquePeau(orig);
  vec3 c = mix(orig, lisse, u_lissage * m);

  // Touche finale (sur toute l'image, très légère) : éclaircissement + contraste.
  c = (c - 0.5) * u_contraste + 0.5 + u_eclair * m;
  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

export interface RenduBeaute {
  /** Dessine la source (vidéo) dans le canvas avec les paramètres courants. */
  dessiner(source: TexImageSource): void;
  setParametres(p: ParametresBeaute): void;
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

/** Crée le rendu WebGL sur un canvas (détaché du DOM). Lève si WebGL est indisponible. */
export function creerRenduBeaute(largeur: number, hauteur: number, params: ParametresBeaute): RenduBeaute {
  const canvas = document.createElement('canvas');
  canvas.width = largeur;
  canvas.height = hauteur;
  const gl = (canvas.getContext('webgl', { premultipliedAlpha: false, preserveDrawingBuffer: false, antialias: false })
    || canvas.getContext('experimental-webgl')) as WebGLRenderingContext | null;
  if (!gl) throw new Error('WebGL indisponible');

  const prog = gl.createProgram();
  if (!prog) throw new Error('programme');
  gl.attachShader(prog, compiler(gl, gl.VERTEX_SHADER, VERTEX));
  gl.attachShader(prog, compiler(gl, gl.FRAGMENT_SHADER, FRAGMENT));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('link : ' + (gl.getProgramInfoLog(prog) || ''));
  gl.useProgram(prog);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(prog, 'a_pos');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  // La vidéo arrive avec l'origine en haut : on retourne verticalement à l'envoi.
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);

  const u = {
    texel: gl.getUniformLocation(prog, 'u_texel'),
    lissage: gl.getUniformLocation(prog, 'u_lissage'),
    rayon: gl.getUniformLocation(prog, 'u_rayon'),
    tolerance: gl.getUniformLocation(prog, 'u_tolerance'),
    eclair: gl.getUniformLocation(prog, 'u_eclair'),
    contraste: gl.getUniformLocation(prog, 'u_contraste'),
  };
  gl.uniform1i(gl.getUniformLocation(prog, 'u_tex'), 0);

  let courant = params;
  const appliquer = () => {
    gl.uniform2f(u.texel, 1 / canvas.width, 1 / canvas.height);
    gl.uniform1f(u.lissage, courant.lissage);
    gl.uniform1f(u.rayon, courant.rayon);
    gl.uniform1f(u.tolerance, courant.tolerance);
    gl.uniform1f(u.eclair, courant.eclaircissement);
    gl.uniform1f(u.contraste, courant.contraste);
  };
  appliquer();
  gl.viewport(0, 0, canvas.width, canvas.height);

  let detruit = false;
  return {
    canvas,
    dessiner(source) {
      if (detruit) return;
      try {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, source);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      } catch { /* image pas encore prête (readyState < 2) : on saute l'image */ }
    },
    setParametres(p) { courant = p; appliquer(); },
    redimensionner(l, h) {
      if (canvas.width === l && canvas.height === h) return;
      canvas.width = l; canvas.height = h;
      gl.viewport(0, 0, l, h);
      appliquer();
    },
    detruire() {
      detruit = true;
      try { gl.deleteTexture(tex); gl.deleteBuffer(buf); gl.deleteProgram(prog); } catch { /* ignore */ }
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
