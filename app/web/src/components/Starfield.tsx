/**
 * The room's backdrop, in raw WebGL (no library):
 *  - a slowly drifting nebula (violet, blue, teal and a touch of magenta): fbm noise in a fragment
 *    shader, rendered at a quarter of the viewport's resolution and upscaled (soft by nature, cheap);
 *  - drifting, twinkling stars in three parallax depths: one GL_POINTS draw call.
 * The CSS gradient underneath (.space) is also the whole fallback when WebGL isn't available.
 *
 * Budget: device pixel ratio capped at 1.5, ~30 fps, paused while the tab is hidden, and a single
 * static frame (no drift, no twinkle, no scroll parallax) under prefers-reduced-motion.
 */
import { useEffect, useRef } from "react";

const STAR_VERT = `
attribute vec2 a_pos;
attribute vec4 a_star;   // depth, size, phase, hue
uniform float u_time;
uniform float u_scroll;  // page scroll as a fraction of the viewport height
uniform float u_dpr;
varying float v_alpha;
varying vec3 v_col;
void main() {
  float depth = a_star.x;
  vec2 p = a_pos + vec2(u_time * 0.0042, u_time * 0.0011) * depth;
  p.y -= u_scroll * 0.06 * depth;
  p = fract(p);
  gl_Position = vec4(p.x * 2.0 - 1.0, 1.0 - p.y * 2.0, 0.0, 1.0);
  float speed = 0.6 + fract(a_star.z * 13.7) * 2.0;
  float tw = 0.5 + 0.5 * sin(u_time * speed + a_star.z * 6.2831);
  float twinkly = step(0.3, fract(a_star.z * 7.3));
  v_alpha = (0.4 + 0.8 * depth) * mix(1.0, 0.25 + 0.95 * tw * tw, twinkly);
  vec3 cool = vec3(0.80, 0.88, 1.0);
  vec3 warm = vec3(1.0, 0.86, 0.70);
  vec3 cyan = vec3(0.55, 0.95, 1.0);
  vec3 violet = vec3(0.82, 0.66, 1.0);
  v_col = a_star.w < 0.6 ? cool : (a_star.w < 0.76 ? cyan : (a_star.w < 0.9 ? violet : warm));
  gl_PointSize = a_star.y * u_dpr * (0.6 + depth * 1.0);
}`;

const STAR_FRAG = `
precision mediump float;
varying float v_alpha;
varying vec3 v_col;
void main() {
  float r = length(gl_PointCoord - 0.5) * 2.0;
  float core = smoothstep(1.0, 0.0, r);
  float a = (core * core * 0.9 + smoothstep(0.35, 0.0, r) * 0.8) * v_alpha;
  gl_FragColor = vec4(v_col * a, min(a, 1.0));
}`;

const NEB_VERT = `
attribute vec2 a_quad;
void main() { gl_Position = vec4(a_quad, 0.0, 1.0); }`;

const NEB_FRAG = `
precision mediump float;
uniform vec2 u_res;
uniform float u_time;
uniform float u_scroll;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0; float a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }
  return v;
}
void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  vec2 p = vec2(uv.x * u_res.x / u_res.y, uv.y) * 2.1;
  p.y -= u_scroll * 0.12;
  float t = u_time * 0.011;
  float n1 = fbm(p + vec2(t, -t * 0.6));
  float n2 = fbm(p * 1.6 - vec2(t * 0.7, t * 0.35) + n1 * 1.5);
  vec3 blue = vec3(0.12, 0.24, 0.85);
  vec3 violet = vec3(0.48, 0.22, 0.92);
  vec3 teal = vec3(0.02, 0.62, 0.70);
  vec3 magenta = vec3(0.86, 0.16, 0.66);
  vec3 col = mix(blue, violet, smoothstep(0.35, 0.75, n1));
  col = mix(col, teal, smoothstep(0.5, 0.82, n2) * 0.85);
  col = mix(col, magenta, smoothstep(0.62, 0.9, n1 * n2 * 1.9) * 0.7);
  float density = smoothstep(0.32, 0.92, n2) * (0.5 + 0.5 * n1);
  // two diagonal lanes of cloud (top right, bottom left) so the middle of the page stays calm
  float lane = 0.35 + 0.65 * smoothstep(0.15, 0.95, abs(uv.x - (1.0 - uv.y)) * 1.6 + abs(uv.y - 0.5) * 0.4);
  float a = density * lane * 0.5;
  gl_FragColor = vec4(col * a, a);
}`;

const MAX_DPR = 1.5;
const FRAME_MS = 1000 / 30;
const NEB_SCALE = 0.25;

function compile(gl: WebGLRenderingContext, type: number, src: string) {
  const s = gl.createShader(type);
  if (!s) return null;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { gl.deleteShader(s); return null; }
  return s;
}

function program(gl: WebGLRenderingContext, vert: string, frag: string) {
  const vs = compile(gl, gl.VERTEX_SHADER, vert);
  const fs = compile(gl, gl.FRAGMENT_SHADER, frag);
  const prog = gl.createProgram();
  if (!vs || !fs || !prog) return null;
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  return gl.getProgramParameter(prog, gl.LINK_STATUS) ? prog : null;
}

function context(canvas: HTMLCanvasElement) {
  try {
    return canvas.getContext("webgl", { alpha: true, antialias: false, premultipliedAlpha: true, powerPreference: "low-power" })
      ?? (canvas.getContext("experimental-webgl") as WebGLRenderingContext | null);
  } catch {
    return null;
  }
}

/** Deterministic pseudo-random so the sky is the same on every load. */
function rng(seed: number) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function makeStars(count: number) {
  const rand = rng(1984);
  const pos = new Float32Array(count * 2);
  const star = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    pos[i * 2] = rand();
    pos[i * 2 + 1] = rand();
    const layer = rand();
    // three depths: many far and faint, some mid, a few near and bright
    const depth = layer < 0.6 ? 0.22 + rand() * 0.12 : layer < 0.88 ? 0.5 + rand() * 0.15 : 0.9 + rand() * 0.1;
    const size = depth > 0.8 ? 2.4 + rand() * 1.6 : depth > 0.45 ? 1.6 + rand() * 1.0 : 1.15 + rand() * 0.75;
    star.set([depth, size, rand(), rand()], i * 4);
  }
  return { pos, star };
}

export function Starfield() {
  const starRef = useRef<HTMLCanvasElement>(null);
  const nebRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = starRef.current;
    const nebCanvas = nebRef.current;
    if (!canvas || !nebCanvas) return;
    const gl = context(canvas);
    const prog = gl && program(gl, STAR_VERT, STAR_FRAG);
    if (!gl || !prog) { canvas.style.display = "none"; nebCanvas.style.display = "none"; return; }

    // ---- stars
    gl.useProgram(prog);
    const uTime = gl.getUniformLocation(prog, "u_time");
    const uScroll = gl.getUniformLocation(prog, "u_scroll");
    const uDpr = gl.getUniformLocation(prog, "u_dpr");
    const aPos = gl.getAttribLocation(prog, "a_pos");
    const aStar = gl.getAttribLocation(prog, "a_star");
    const posBuf = gl.createBuffer();
    const starBuf = gl.createBuffer();
    let count = 0;
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0, 0, 0, 0);

    // ---- nebula (its own small canvas; if it fails, the CSS gradient carries the colour)
    const ngl = context(nebCanvas);
    const nprog = ngl && program(ngl, NEB_VERT, NEB_FRAG);
    let nebula: null | { g: WebGLRenderingContext; uRes: WebGLUniformLocation | null; uTime: WebGLUniformLocation | null; uScroll: WebGLUniformLocation | null } = null;
    if (ngl && nprog) {
      ngl.useProgram(nprog);
      const quad = ngl.createBuffer();
      ngl.bindBuffer(ngl.ARRAY_BUFFER, quad);
      ngl.bufferData(ngl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), ngl.STATIC_DRAW);
      const aQuad = ngl.getAttribLocation(nprog, "a_quad");
      ngl.enableVertexAttribArray(aQuad);
      ngl.vertexAttribPointer(aQuad, 2, ngl.FLOAT, false, 0, 0);
      ngl.clearColor(0, 0, 0, 0);
      nebula = { g: ngl, uRes: ngl.getUniformLocation(nprog, "u_res"), uTime: ngl.getUniformLocation(nprog, "u_time"), uScroll: ngl.getUniformLocation(nprog, "u_scroll") };
    } else {
      nebCanvas.style.display = "none";
    }

    const reduceQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    let reduce = reduceQuery.matches;
    let raf = 0;
    let last = 0;
    const t0 = performance.now();
    let dpr = 1;

    const fill = () => {
      dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      const w = window.innerWidth;
      const h = window.innerHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      gl.viewport(0, 0, canvas.width, canvas.height);
      if (nebula) {
        nebCanvas.width = Math.max(64, Math.round(w * NEB_SCALE));
        nebCanvas.height = Math.max(64, Math.round(h * NEB_SCALE));
        nebula.g.viewport(0, 0, nebCanvas.width, nebCanvas.height);
      }
      const next = Math.min(1200, Math.max(180, Math.round((w * h) / 2000)));
      if (next !== count) {
        count = next;
        const { pos, star } = makeStars(count);
        gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
        gl.bufferData(gl.ARRAY_BUFFER, pos, gl.STATIC_DRAW);
        gl.enableVertexAttribArray(aPos);
        gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, starBuf);
        gl.bufferData(gl.ARRAY_BUFFER, star, gl.STATIC_DRAW);
        gl.enableVertexAttribArray(aStar);
        gl.vertexAttribPointer(aStar, 4, gl.FLOAT, false, 0, 0);
      }
    };

    const draw = (now: number) => {
      const t = reduce ? 0 : (now - t0) / 1000;
      const scroll = reduce ? 0 : window.scrollY / Math.max(1, window.innerHeight);
      gl.uniform1f(uTime, t);
      gl.uniform1f(uScroll, scroll);
      gl.uniform1f(uDpr, dpr);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.POINTS, 0, count);
      if (nebula) {
        const g = nebula.g;
        g.uniform2f(nebula.uRes, nebCanvas.width, nebCanvas.height);
        g.uniform1f(nebula.uTime, t);
        g.uniform1f(nebula.uScroll, scroll);
        g.clear(g.COLOR_BUFFER_BIT);
        g.drawArrays(g.TRIANGLE_STRIP, 0, 4);
      }
    };

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (now - last < FRAME_MS) return;
      last = now;
      draw(now);
    };

    const start = () => {
      cancelAnimationFrame(raf);
      if (reduce) { draw(performance.now()); return; }
      if (!document.hidden) raf = requestAnimationFrame(loop);
    };

    const onResize = () => { fill(); if (reduce) draw(performance.now()); };
    const onVisibility = () => { if (document.hidden) cancelAnimationFrame(raf); else start(); };
    const onReduce = () => { reduce = reduceQuery.matches; start(); };
    const onLost = (e: Event) => { e.preventDefault(); cancelAnimationFrame(raf); canvas.style.display = "none"; nebCanvas.style.display = "none"; };

    fill();
    start();
    window.addEventListener("resize", onResize);
    document.addEventListener("visibilitychange", onVisibility);
    reduceQuery.addEventListener("change", onReduce);
    canvas.addEventListener("webglcontextlost", onLost);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVisibility);
      reduceQuery.removeEventListener("change", onReduce);
      canvas.removeEventListener("webglcontextlost", onLost);
      // No loseContext(): StrictMode re-runs this effect on the same canvases and would get dead contexts.
    };
  }, []);

  return (
    <>
      <div className="space" aria-hidden />
      <canvas ref={nebRef} className="nebula" aria-hidden />
      <canvas ref={starRef} className="starfield" aria-hidden />
    </>
  );
}
