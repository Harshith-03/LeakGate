/**
 * The room's backdrop: slowly drifting, twinkling stars in three parallax depths, drawn with raw
 * WebGL (one draw call of GL_POINTS, no library). The nebula is a CSS gradient underneath (.space),
 * which is also the whole fallback when WebGL isn't available.
 *
 * Budget: device pixel ratio capped at 1.5, ~30 fps, paused while the tab is hidden, and a single
 * static frame (no drift, no twinkle, no scroll parallax) under prefers-reduced-motion.
 */
import { useEffect, useRef } from "react";

const VERT = `
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
  float speed = 0.5 + fract(a_star.z * 13.7) * 1.6;
  float tw = 0.5 + 0.5 * sin(u_time * speed + a_star.z * 6.2831);
  float twinkly = step(0.35, fract(a_star.z * 7.3));
  v_alpha = (0.28 + 0.72 * depth) * mix(1.0, 0.35 + 0.65 * tw, twinkly);
  vec3 cool = vec3(0.80, 0.87, 1.0);
  vec3 warm = vec3(1.0, 0.88, 0.76);
  vec3 teal = vec3(0.72, 1.0, 0.93);
  v_col = a_star.w < 0.72 ? cool : (a_star.w < 0.9 ? warm : teal);
  gl_PointSize = a_star.y * u_dpr * (0.55 + depth * 0.9);
}`;

const FRAG = `
precision mediump float;
varying float v_alpha;
varying vec3 v_col;
void main() {
  float r = length(gl_PointCoord - 0.5) * 2.0;
  float core = smoothstep(1.0, 0.0, r);
  float a = (core * core * 0.85 + smoothstep(0.35, 0.0, r) * 0.6) * v_alpha;
  gl_FragColor = vec4(v_col * a, a);
}`;

const MAX_DPR = 1.5;
const FRAME_MS = 1000 / 30;

function compile(gl: WebGLRenderingContext, type: number, src: string) {
  const s = gl.createShader(type);
  if (!s) return null;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { gl.deleteShader(s); return null; }
  return s;
}

/** Deterministic pseudo-random so the sky is the same on every load (no flicker between reloads). */
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
    const depth = layer < 0.62 ? 0.22 + rand() * 0.12 : layer < 0.9 ? 0.5 + rand() * 0.15 : 0.9 + rand() * 0.1;
    const size = depth > 0.8 ? 2.2 + rand() * 1.4 : depth > 0.45 ? 1.5 + rand() * 0.9 : 1.1 + rand() * 0.7;
    star.set([depth, size, rand(), rand()], i * 4);
  }
  return { pos, star };
}

export function Starfield() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    let gl: WebGLRenderingContext | null = null;
    try {
      gl = canvas.getContext("webgl", { alpha: true, antialias: false, premultipliedAlpha: true, powerPreference: "low-power" })
        ?? (canvas.getContext("experimental-webgl") as WebGLRenderingContext | null);
    } catch {
      gl = null;
    }
    if (!gl) { canvas.style.display = "none"; return; }

    const vs = compile(gl, gl.VERTEX_SHADER, VERT);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    const prog = gl.createProgram();
    if (!vs || !fs || !prog) { canvas.style.display = "none"; return; }
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { canvas.style.display = "none"; return; }
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

    const reduceQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    let reduce = reduceQuery.matches;
    let raf = 0;
    let last = 0;
    const t0 = performance.now();
    let dpr = 1;

    const fill = () => {
      const g = gl!;
      dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      const w = window.innerWidth;
      const h = window.innerHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      g.viewport(0, 0, canvas.width, canvas.height);
      const next = Math.min(1100, Math.max(160, Math.round((w * h) / 2300)));
      if (next !== count) {
        count = next;
        const { pos, star } = makeStars(count);
        g.bindBuffer(g.ARRAY_BUFFER, posBuf);
        g.bufferData(g.ARRAY_BUFFER, pos, g.STATIC_DRAW);
        g.enableVertexAttribArray(aPos);
        g.vertexAttribPointer(aPos, 2, g.FLOAT, false, 0, 0);
        g.bindBuffer(g.ARRAY_BUFFER, starBuf);
        g.bufferData(g.ARRAY_BUFFER, star, g.STATIC_DRAW);
        g.enableVertexAttribArray(aStar);
        g.vertexAttribPointer(aStar, 4, g.FLOAT, false, 0, 0);
      }
    };

    const draw = (now: number) => {
      const g = gl!;
      const t = reduce ? 0 : (now - t0) / 1000;
      g.uniform1f(uTime, t);
      g.uniform1f(uScroll, reduce ? 0 : window.scrollY / Math.max(1, window.innerHeight));
      g.uniform1f(uDpr, dpr);
      g.clear(g.COLOR_BUFFER_BIT);
      g.drawArrays(g.POINTS, 0, count);
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
    const onLost = (e: Event) => { e.preventDefault(); cancelAnimationFrame(raf); canvas.style.display = "none"; };

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
      // No loseContext(): StrictMode re-runs this effect on the same canvas and would get a dead context.
    };
  }, []);

  return (
    <>
      <div className="space" aria-hidden />
      <canvas ref={ref} className="starfield" aria-hidden />
    </>
  );
}
