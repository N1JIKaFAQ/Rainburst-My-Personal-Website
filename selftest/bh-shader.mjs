/**
 * 黑洞着色器的 CPU 参考实现（GLSL → JS 逐行移植，零依赖）。
 * 被 render-blackhole.mjs（出图）和 alias-check.mjs（锯齿/摩尔纹量化）共用。
 *
 * makeShader({ noLod, spp }) 返回 shadePixel(uvx, uvy, aspect, p, u)：
 *   noLod = true  → 关闭纹理带限与透镜放大足迹（用于复现"修复前"或生成无偏参考）
 *   spp   = "auto" → 与 GLSL 一致的分层超采样；数字 n → 全画面 n×n 网格均匀超采样
 */

/* ---------------- vec helpers ---------------- */
const v3 = (x, y, z) => [x, y, z];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const mix = (a, b, t) => a + (b - a) * t;
const mix3 = (a, b, t) => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const fract = (x) => x - Math.floor(x);
const smoothstep = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };

/* ---------------- 整数哈希（与 GLSL 位级一致） ---------------- */
const uhash = (n) => {
  n = n >>> 0;
  n ^= n >>> 16; n = Math.imul(n, 0x7feb352d) >>> 0;
  n ^= n >>> 15; n = Math.imul(n, 0x846ca68b) >>> 0;
  n ^= n >>> 16;
  return n >>> 0;
};
const hash2i = (x, y) => uhash((Math.imul(x, 0x9E3779B1) >>> 0) ^ uhash((y + 0x68E31DA4) >>> 0)) / 4294967296;
const hash3i = (x, y, z) =>
  uhash((Math.imul(x, 0x9E3779B1) >>> 0) ^ uhash((Math.imul(y, 0x85EBCA77) >>> 0) ^ uhash((z + 0x68E31DA4) >>> 0))) / 4294967296;

function noise2D(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  return mix(mix(hash2i(ix, iy), hash2i(ix + 1, iy), ux), mix(hash2i(ix, iy + 1), hash2i(ix + 1, iy + 1), ux), uy);
}
function noise3D(x, y, z) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy), uz = fz * fz * (3 - 2 * fz);
  const nx00 = mix(hash3i(ix, iy, iz), hash3i(ix + 1, iy, iz), ux);
  const nx10 = mix(hash3i(ix, iy + 1, iz), hash3i(ix + 1, iy + 1, iz), ux);
  const nx01 = mix(hash3i(ix, iy, iz + 1), hash3i(ix + 1, iy, iz + 1), ux);
  const nx11 = mix(hash3i(ix, iy + 1, iz + 1), hash3i(ix + 1, iy + 1, iz + 1), ux);
  return mix(mix(nx00, nx10, uy), mix(nx01, nx11, uy), uz);
}
const n3 = (v) => noise3D(v[0], v[1], v[2]);
function fbm2D(x, y) {
  let v = 0, a = 0.55;
  for (let i = 0; i < 4; i++) {
    v += a * noise2D(x, y);
    const nx = (0.8 * x + 0.6 * y) * 2.05, ny = (-0.6 * x + 0.8 * y) * 2.05;
    x = nx; y = ny; a *= 0.5;
  }
  return v;
}

/* ---------------- 场景常量（与 GLSL 一致） ---------------- */
const Rs = 1.0, R_IN = 2.3, R_OUT = 11.0, H_CRIT = 2.598;
const STAR_C = v3(-189.13, 10.67, 14.33), STAR_R = 170;
const STAR_DIR = v3(0.99554, -0.05616, -0.0754), STAR_PHI = 3.066;
const S0 = v3(-19.89, 1.12, 1.51), SM = v3(-16.8, 2.2, 3.1), S1 = v3(-13.76, 0, 1.04);
const OFF4 = [[-0.125, -0.375], [0.375, -0.125], [-0.375, 0.125], [0.125, 0.375]];
const OFF8 = [[0.0625, -0.1875], [-0.0625, 0.1875], [0.3125, 0.0625], [-0.1875, -0.3125],
  [-0.3125, 0.3125], [-0.4375, -0.0625], [0.1875, 0.4375], [0.4375, -0.4375]];
export const TAU = Math.PI * 2;
export const KNOT_RADII = [2.85, 3.6, 4.9];

/** 与 JS 侧 integrateMotion 等价：静止帧下按恒定进度积分 t 秒 */
export function motionFor(p, t) {
  const speedMul = 1 + 7 * Math.pow(p, 1.6);
  return {
    time: t,
    spin: (t * speedMul * 0.55) % TAU,
    flow: t * (0.35 + 1.6 * p),
    knots: KNOT_RADII.map((r) => (t * (speedMul * 1.4) / Math.pow(r, 1.5)) % TAU),
    stream: t * (1.6 + 6.5 * p),
  };
}

const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) * 0.5);
const aces = (c) => c.map((x) => clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0, 1));

export function makeShader(opts = {}) {
  const noLod = !!opts.noLod;
  const sppMode = opts.spp ?? "auto";
  const lodFade = noLod ? () => 1 : (x) => 1 - smoothstep(0.5, 1.7, x);

  function fbm3Dlod(p, x) {
    let v = 0, a = 0.55;
    let px = p[0], py = p[1], pz = p[2];
    for (let i = 0; i < 3; i++) {
      const f = lodFade(x);
      v += a * (f > 0.002 ? mix(0.5, noise3D(px, py, pz), f) : 0.5);
      px = px * 2.03 + 11.3; py = py * 2.03 + 7.1; pz = pz * 2.03 + 3.9;
      a *= 0.5; x *= 2.03;
    }
    return v;
  }
  const fbm3D = (p) => fbm3Dlod(p, 0);

  function sampleStars(d) {
    let c = v3(0.006, 0.009, 0.018);
    const neb = fbm2D(d[0] * 2.4 + d[2] * 1.2, d[1] * 2.4 + d[2] * 1.2);
    c = add(c, mul(v3(0.02, 0.035, 0.07), neb * neb));
    const g = mul(d, 280);
    const cell = g.map(Math.floor);
    const h = hash3i(cell[0], cell[1], cell[2]);
    if (h > 0.986) {
      const jit = [0.35 + 0.3 * hash3i(cell[0] + 17, cell[1], cell[2]), 0.35 + 0.3 * hash3i(cell[0], cell[1] + 29, cell[2]), 0.35 + 0.3 * hash3i(cell[0], cell[1], cell[2] + 43)];
      const dd = sub(g, add(cell, jit));
      const spot = Math.exp(-dot(dd, dd) * 12);
      const b = Math.pow((h - 0.986) / 0.014, 6) * 2.4;
      c = add(c, mul(mix3(v3(0.7, 0.85, 1), v3(1, 0.94, 0.85), fract(h * 37)), b * spot));
    }
    return c;
  }

  function shadeStar(hit, nGeo, mu, p, fp, u) {
    const t = u.time;
    const ra = t * 0.006;
    const n = v3(nGeo[0] * Math.cos(ra) - nGeo[2] * Math.sin(ra), nGeo[1], nGeo[0] * Math.sin(ra) + nGeo[2] * Math.cos(ra));
    const wa = n3(add(mul(n, 5), v3(t * 0.08, 0, 0)));
    const wb = n3(add(mul(n, 5), v3(0, t * 0.07, 7.7)));
    const w = mul(v3(wa, wb, wa * wb), 0.55);
    const c1 = fbm3Dlod(add(add(mul(n, 9.3), w), v3(t * 0.02, t * 0.02, t * 0.02)), fp * (9.3 / STAR_R));
    const c2 = fbm3Dlod(sub(add(mul(n, 25), mul(w, 1.6)), v3(0, t * 0.05, 0)), fp * (25 / STAR_R));
    const c3 = mix(0.5, n3(add(mul(n, 62), v3(t * 0.35, t * 0.35, t * 0.35))), lodFade(fp * (62 / STAR_R)));
    let cloud = smoothstep(0.3, 0.72, c1 * 0.55 + c2 * 0.32 + c3 * 0.13);
    const rel = sub(hit, S0);
    const pull = Math.exp(-dot(rel, rel) / 110) * (0.55 + 0.45 * p);
    cloud *= 1 - 0.55 * pull;
    const streak = mix(0.5, noise3D(rel[0] * 0.55 - u.stream * 0.45, rel[1] * 1.8, rel[2] * 1.8), lodFade(fp * 1.8));
    const pulse = 0.86 + 0.28 * mix(0.5, n3(add(mul(n, 14), v3(0, 0, t * 0.3))), lodFade(fp * (14 / STAR_R)));
    let col = mul(mix3(v3(0.3, 0.58, 1), v3(1, 1, 1), cloud), (1.7 + 0.7 * cloud) * pulse);
    col = mul(col, 1 + pull * (0.15 + 0.7 * smoothstep(0.42, 0.8, streak)));
    col = mix3(col, mul(v3(0.6, 0.8, 1), 1.2), Math.pow(1 - mu, 1.5) * 0.8);
    return mul(col, 1 + 0.1 * p);
  }

  function starAtmosphere(ro, rd, p, pixA, u) {
    const oc = sub(ro, STAR_C);
    const b = dot(oc, rd);
    const cp = sub(oc, mul(rd, b));
    const dmin = b > 0 ? len(oc) : len(cp);
    const gap = Math.max(0, dmin - STAR_R);
    const h = 0.8 * Math.exp(-gap / 7) + 0.35 * Math.exp(-gap / 28);
    let col = mul(v3(0.55, 0.75, 1), h * 0.95);
    if (b < 0 && gap < 60) {
      const nl = mul(cp, 1 / Math.max(dmin, 1e-3));
      const toward = Math.max(0, dot(nl, STAR_DIR));
      const s1 = fbm3Dlod(add(mul(nl, 11), v3(u.time * 0.02, 0, 0)), pixA * 11);
      const spiky = Math.pow(s1, 2.6);
      const L1 = 9 + 24 * toward * toward;
      col = add(col, mul(v3(0.55, 0.78, 1), spiky * Math.exp(-gap / L1) * (0.9 + 0.6 * toward * p)));
      const s2 = mix(0.5, n3(add(mul(nl, 30), v3(0, u.time * 0.25, 0))), lodFade(pixA * 30));
      col = add(col, mul(v3(0.82, 0.92, 1), Math.pow(s2, 3) * Math.exp(-gap / 5) * 1.2));
    }
    return col;
  }

  const bez = (t) => { const uu = 1 - t; return add(add(mul(S0, uu * uu), mul(SM, 2 * uu * t)), mul(S1, t * t)); };
  function streamGlow(ro, rd, inflow, u) {
    let acc = v3(0, 0, 0);
    for (let i = 0; i < 6; i++) {
      const t = (i + 0.5) / 6;
      const P = bez(t);
      const s = dot(sub(P, ro), rd);
      if (s <= 0) continue;
      const Q = add(ro, mul(rd, s));
      const dq = sub(Q, P);
      const d2 = dot(dq, dq);
      const rad = mix(2.8, 0.9, t);
      const core = Math.exp(-d2 / (rad * rad));
      const halo = Math.exp(-d2 / (rad * rad * 6)) * 0.22;
      if (core + halo < 0.003) continue;
      const n = noise3D(Q[0] * 0.9 - u.stream, Q[1] * 2.6, Q[2] * 2.6);
      const fib = smoothstep(0.3, 0.74, n);
      const dens = (core * (0.2 + 0.8 * fib) + halo) * (0.3 + 0.7 * inflow);
      const c = mix3(v3(0.6, 0.82, 1), v3(0.96, 0.98, 1), t * 0.45 + fib * 0.45);
      acc = add(acc, mul(c, dens));
    }
    return mul(acc, 0.55);
  }

  function diskShade(hp, velD, p, diskGain, inflow, fp, u) {
    const rho = Math.hypot(hp[0], hp[2]);
    const phi = Math.atan2(hp[2], hp[0]);
    const starSide = 0.5 + 0.5 * Math.cos(phi - STAR_PHI);
    const tongue = starSide ** 4;
    const rOut = R_OUT * (1 + 0.42 * tongue);
    if (rho < R_IN) return [0, 0, 0, 0];
    if (rho > rOut) {
      const halo = 0.06 * (1 - smoothstep(rOut, rOut + 12, rho)) * (0.6 + 0.4 * p);
      const c = mul(v3(0.3, 0.5, 0.95), halo * diskGain);
      return [c[0], c[1], c[2], halo * 0.5];
    }
    const invR = 1 / rho, lr = Math.log(rho), rp = phi + u.spin;
    const turb = fbm3Dlod(v3(Math.cos(rp) * 2.4, Math.sin(rp) * 2.4, rho * 1.25 - u.flow * 0.45), fp * 1.25);
    const uf = rp + 1.2 * lr;
    const fiber = mix(0.5, noise3D(Math.cos(uf) * 1.6, Math.sin(uf) * 1.6, lr * 4 + u.flow * 0.8), lodFade(fp * 4.44 * invR));
    const lanes = 0.07 + 0.93 * smoothstep(0.28, 0.78, fiber);
    const spiral = 0.5 + 0.5 * Math.sin(3 * (rp + 1.8 * lr));
    const ur = rp + 0.9 * lr;
    const rush = mix(0.5, noise3D(Math.cos(ur) * 2.2, Math.sin(ur) * 2.2, rho * 1.2 + u.flow * 2.2), lodFade(fp * Math.sqrt(3.92 * invR * invR + 1.44)));
    const feed = 1 + (0.35 + 0.9 * inflow) * starSide;
    const edgeIn = smoothstep(R_IN, R_IN + Math.max(0.35, fp), rho);
    const edgeOut = 1 - smoothstep(rOut - 2.4, rOut, rho);
    const density = edgeIn * edgeOut * lanes * (0.34 + 0.5 * turb + 0.16 * spiral + 0.3 * rush * inflow * starSide) * feed;

    let knots = 0;
    const kr = [2.85, 3.6, 4.9], kw = [0.16, 0.2, 0.25], kd = [0.2, 0.26, 0.34], kb = [1.6, 1.2, 0.9];
    const fpA = fp * invR;
    for (let i = 0; i < 3; i++) {
      let ad = phi + u.knots[i];
      ad = Math.atan2(Math.sin(ad), Math.cos(ad));
      const kdE = Math.sqrt(kd[i] * kd[i] + fp * fp * 0.0833);
      const kwE = Math.sqrt(kw[i] * kw[i] + fpA * fpA * 0.0833);
      const dr = rho - kr[i];
      const radial = Math.exp(-(dr * dr) / (kdE * kdE)) * (kd[i] / kdE);
      let k = Math.exp(-(ad * ad) / (kwE * kwE)) * (kw[i] / kwE) * radial;
      k += 0.35 * Math.exp(-Math.max(0, ad) / 0.7) * radial * (ad >= 0 ? 1 : 0);
      knots += k * kb[i];
    }
    knots *= (0.35 + 0.65 * p) * edgeIn;

    const orbDir = norm(v3(hp[2], 0, -hp[0]));
    const vlos = dot(mul(velD, -1), orbDir);
    const beta = clamp(Math.sqrt(0.5 / rho) * (0.9 + 0.3 * p), 0, 0.75);
    const gamma = 1 / Math.sqrt(1 - beta * beta);
    const dop = 1 / (gamma * (1 - beta * vlos));
    const beam = Math.pow(clamp(dop, 0.7, 1.6), 2);
    const temp = 1 - smoothstep(R_IN, rOut, rho);
    const cold = v3(0.2, 0.38, 0.85), midc = v3(0.55, 0.78, 1), hot = v3(0.97, 0.99, 1);
    let dc = mix3(cold, mix3(midc, hot, smoothstep(0.35, 0.95, temp)), temp);
    dc = mix3(dc, hot, clamp((beam - 1) * 0.6, 0, 1));
    const flick = 1 + 0.08 * Math.sin(u.time * 6.3 + rho * 5) * (1 - smoothstep(R_IN, 4, rho)) * lodFade(fp * 0.8);
    const rgb = mul(dc, beam * diskGain * flick * (density + knots) * 0.85);
    const da = clamp((density + knots * 0.6) * 0.85, 0, 0.96);
    return [rgb[0], rgb[1], rgb[2], da];
  }

  function traceSample(camPos, rayDir, p, pixAng, u) {
    const spinDrag = 0.32 * p, diskGain = 1.1 + 0.55 * p, inflow = p;
    const tilt = 0.02 * Math.sin(u.time * 0.23) + 0.015 * Math.sin(u.time * 0.41 + 1);
    const ct = Math.cos(tilt), st = Math.sin(tilt);
    const toD = (v) => v3(v[0], v[1] * ct - v[2] * st, v[1] * st + v[2] * ct);
    const h0 = len(cross(camPos, rayDir));
    const lensMag = (vel, L) => noLod ? 1 : Math.min(12, 1 + L * Math.acos(clamp(dot(vel, rayDir), -1, 1)) / Math.max(h0, 0.5));
    let sPast = 0;

    let pos = camPos.slice(), vel = rayDir.slice();
    let col = v3(0, 0, 0), alpha = 0, horizon = false, r = len(pos);
    let yA = pos[1] * ct - pos[2] * st;
    let steps = 0, preAlpha = 0;
    for (let i = 0; i < 140; i++) {
      steps++;
      r = len(pos);
      if (r < Rs * 1.03) {
        horizon = true; preAlpha = alpha;
        const graze = 1 - Math.abs(dot(mul(pos, 1 / r), vel));
        let inner = mix3(v3(0.004, 0.007, 0.014), v3(0.02, 0.035, 0.07), graze);
        inner = add(inner, mul(v3(0.6, 0.78, 1), Math.pow(graze, 8) * 0.5));
        col = add(col, mul(inner, 1 - alpha)); alpha = 1; break;
      }
      const dt = clamp(0.06 * r, 0.05, 0.6);
      const pd = r - 1.5 * Rs;
      const tang = 1 - Math.abs(dot(mul(pos, 1 / r), vel));
      let ring = Math.exp(-pd * pd * 200) * tang * tang;
      ring *= 0.85 + 0.25 * Math.sin(pos[0] * 4 + pos[2] * 3 + u.spin * 3);
      col = add(col, mul(v3(0.88, 0.94, 1), (1 - alpha) * ring * 0.33 * dt * (0.5 + 0.6 * p)));

      const hv = cross(pos, vel);
      const h2 = dot(hv, hv);
      let acc = mul(pos, (-1.5 * Rs * h2) / (r * r * r * r * r + 1e-4));
      acc = add(acc, mul(cross(v3(0, 1, 0), vel), spinDrag / (r * r * r)));
      vel = norm(add(vel, mul(acc, dt)));
      const newPos = add(pos, mul(vel, dt));
      const yB = newPos[1] * ct - newPos[2] * st;
      if (yA * yB <= 0) {
        const tc = -yA / (yB - yA + 1e-6);
        const hp = mix3(pos, newPos, tc);
        const hpD = v3(hp[0], 0, hp[1] * st + hp[2] * ct);
        const vD = toD(vel);
        const fp = len(sub(hp, camPos)) * pixAng * lensMag(vel, sPast) / Math.max(Math.abs(vD[1]), 0.05);
        const d = diskShade(hpD, vD, p, diskGain, inflow, fp, u);
        col = add(col, mul([d[0], d[1], d[2]], 1 - alpha)); alpha += (1 - alpha) * d[3];
      }
      pos = newPos; yA = yB;
      if (dot(pos, vel) > 0) sPast += dt;
      if (r > 9 && dot(pos, vel) > 0) break;
      if (r > 6 && dot(pos, vel) > 0 && len(cross(pos, vel)) > 3.2) break;
      if (alpha > 0.985) break;
    }
    if (!horizon && alpha < 0.985 && len(pos) < 3) {
      col = add(col, mul(v3(0.01, 0.016, 0.03), 1 - alpha)); alpha = 1; horizon = true;
    }
    let hitStar = false, streamLum = 0;
    if (!horizon && alpha < 0.985) {
      const pD = toD(pos), vD = toD(vel);
      if (pD[1] * vD[1] < 0) {
        const sD = -pD[1] / vD[1];
        const fp = (len(sub(pos, camPos)) + sD) * pixAng * lensMag(vel, sPast + sD) / Math.max(Math.abs(vD[1]), 0.05);
        const d = diskShade(add(pD, mul(vD, sD)), vD, p, diskGain, inflow, fp, u);
        col = add(col, mul([d[0], d[1], d[2]], 1 - alpha)); alpha += (1 - alpha) * d[3];
      }
      const sg = streamGlow(pos, vel, inflow, u);
      streamLum = ((sg[0] + sg[1] + sg[2]) / 3) * (1 - alpha);
      col = add(col, mul(sg, 1 - alpha));

      const oc = sub(pos, STAR_C);
      const dC = len(oc);
      const b = dot(oc, vel);
      const ang = Math.acos(clamp(-b / dC, -1, 1));
      const angR = Math.asin(Math.min(STAR_R / dC, 1));
      const pixA = pixAng * lensMag(vel, sPast + Math.max(-b, 0));
      const cov = noLod ? (ang < angR ? 1 : 0) : 1 - smoothstep(-0.75 * pixA, 0.75 * pixA, ang - angR);
      const atm = starAtmosphere(pos, vel, p, pixA, u);
      const bg = add(atm, mul(sampleStars(vel), 1 - Math.min(atm[2], 1) * 0.8));
      if (cov > 0.001) {
        const hh = b * b - (dot(oc, oc) - STAR_R * STAR_R);
        const hit = hh > 0 ? add(pos, mul(vel, -b - Math.sqrt(hh))) : add(STAR_C, mul(norm(sub(oc, mul(vel, b))), STAR_R));
        const nGeo = norm(sub(hit, STAR_C));
        const mu = Math.max(0.02, dot(nGeo, mul(vel, -1)));
        const fpS = len(sub(hit, camPos)) * pixA / mu;
        const sc = shadeStar(hit, nGeo, mu, p, fpS, u);
        col = add(col, mul(mix3(bg, sc, cov), 1 - alpha));
        hitStar = cov > 0.5;
      } else {
        col = add(col, mul(bg, 1 - alpha));
      }
      alpha += (1 - alpha) * cov;
    }
    return { col, alpha, horizon, hitStar, steps, preAlpha, streamLum };
  }

  /** u = motionFor(p, t) 加上 resY（渲染高度像素数，决定像素张角） */
  function shadePixel(uvx, uvy, aspect, p, u) {
    const camP = easeInOutCubic(p);
    const camPos = mix3(v3(0, 2.1, 16.5), v3(0, 0.95, 12.0), camP);
    const fwd = norm(mul(camPos, -1));
    const right0 = norm(cross(fwd, v3(0, 1, 0)));
    const up0 = cross(right0, fwd);
    const roll = 0.36, cr = Math.cos(roll), sr = Math.sin(roll);
    const right = add(mul(right0, cr), mul(up0, sr));
    const up = add(mul(right0, -sr), mul(up0, cr));
    const fov = mix(1.4, 1.58, camP);
    const shift = [mix(-0.52, -0.43, camP), mix(-0.06, -0.10, camP)];
    const s = [uvx * aspect + shift[0], uvy + shift[1]];
    const pxS = 2 / u.resY;
    const pixAng = pxS / fov;
    const dirFor = (si) => norm(add(add(mul(right, si[0]), mul(up, si[1])), mul(fwd, fov)));

    const dir0 = dirFor(s);
    const h0 = len(cross(camPos, dir0));
    let offsets;
    if (sppMode === "auto") {
      if (Math.abs(h0 - H_CRIT) < 0.24) offsets = OFF8;
      else if (h0 < 3.7) offsets = OFF4;
      else offsets = [[0, 0]];
    } else if (sppMode === 1) {
      offsets = [[0, 0]];
    } else {
      const g = Math.round(Math.sqrt(sppMode));
      offsets = [];
      for (let j = 0; j < g; j++) for (let i = 0; i < g; i++) offsets.push([(i + 0.5) / g - 0.5, (j + 0.5) / g - 0.5]);
    }
    let acc = v3(0, 0, 0), alpha = 0, first = null;
    for (const off of offsets) {
      const r = traceSample(camPos, dirFor([s[0] + off[0] * pxS, s[1] + off[1] * pxS]), p, pixAng, u);
      acc = add(acc, r.col); alpha += r.alpha;
      if (!first) first = r;
    }
    acc = mul(acc, 1 / offsets.length); alpha /= offsets.length;
    let col = add(acc, mul(v3(0.04, 0.08, 0.16), (1 - smoothstep(-0.7, 1, uvx)) * (1 - alpha * 0.3)));
    col = add(col, mul(v3(0.012, 0.02, 0.04), 1 - alpha * 0.5));
    col = aces(col);
    const vig = 1 - 0.18 * (uvx * uvx + uvy * uvy);
    return { rgb: col.map((c) => c * vig), spp: offsets.length, h0, ...first };
  }

  return { shadePixel };
}
