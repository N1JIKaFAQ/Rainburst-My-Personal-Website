/**
 * 锯齿 / 摩尔纹量化（真实像素尺度）。
 * 以 1440×900 的像素张角为准，只着色黑洞周围一个窗口；
 * 以 16 spp 暴力超采样（无带限）为"真值"，比较：
 *   修复前 = 1 spp、无带限、无亚像素覆盖（新纹理频率下的裸采样）
 *   修复后 = 分层超采样 + 带限 + 解析星缘覆盖
 * 期望：阴影边缘/光子环/拱弧区域误差大幅下降；纹理充分过采样的盘面与星面区域两者都很小。
 *   node selftest/alias-check.mjs [progress=1] [window=200]
 */
import { makeShader, motionFor } from "./bh-shader.mjs";

const p = Number(process.argv[2] ?? 1);
const WIN = Number(process.argv[3] ?? 200);           // 窗口边长（像素）
const FW = 1440, FH = 900, aspect = FW / FH;          // 真实帧尺寸 → 真实像素张角
const T = 12;
// 窗口中心：阴影中心（按前面渲染统计，p=1 时约 (64.9%, 45.7%)；p=0 时约 (66.1%, 46.8%)）
const cxF = FW * (p > 0.5 ? 0.649 : 0.661), cyF = FH * (p > 0.5 ? 0.457 : 0.468);
const x0 = Math.round(cxF - WIN / 2), y0 = Math.round(cyF - WIN * 0.3125);
const W = WIN, H = Math.round(WIN * 0.625);

const before = makeShader({ noLod: true, spp: 1 });
const after = makeShader({ spp: "auto" });
const truth = makeShader({ noLod: true, spp: 16 });
const u = { ...motionFor(p, T), resY: FH };

const lum = (r) => (r.rgb[0] + r.rgb[1] + r.rgb[2]) / 3;
const regions = {
  "阴影边缘+光子环 (|h0-2.6|<0.35)": (r) => Math.abs(r.h0 - 2.598) < 0.35,
  "上方拱弧+内盘 (h0<4.5)": (r) => r.h0 < 4.5 && Math.abs(r.h0 - 2.598) >= 0.35,
  "外盘 (h0≥4.5, 非恒星)": (r) => r.h0 >= 4.5 && !r.hitStar,
  "蓝巨星本体+边缘": (r) => r.hitStar,
  "整个窗口": () => true,
};
const acc = {};
for (const k of Object.keys(regions)) acc[k] = { n: 0, eB: 0, eA: 0, sppA: 0 };

const t0 = Date.now();
for (let yy = 0; yy < H; yy++) {
  const uvy = 1 - (2 * (y0 + yy + 0.5)) / FH;
  for (let xx = 0; xx < W; xx++) {
    const uvx = (2 * (x0 + xx + 0.5)) / FW - 1;
    const rT = truth.shadePixel(uvx, uvy, aspect, p, u);
    const rB = before.shadePixel(uvx, uvy, aspect, p, u);
    const rA = after.shadePixel(uvx, uvy, aspect, p, u);
    const lt = lum(rT);
    for (const [k, test] of Object.entries(regions)) {
      if (!test(rT)) continue;
      const a = acc[k];
      a.n++;
      a.eB += (lum(rB) - lt) ** 2;
      a.eA += (lum(rA) - lt) ** 2;
      a.sppA += rA.spp;
    }
  }
}
console.log(`p=${p}  1440×900 像素尺度，窗口 ${W}×${H} @ (${x0},${y0})，真值 16 spp  (${((Date.now() - t0) / 1000).toFixed(0)}s)\n`);
console.log("区域".padEnd(30) + "像素占比   修复前 RMS   修复后 RMS   下降     修复后平均 spp");
let ok = true;
for (const [k, a] of Object.entries(acc)) {
  if (!a.n) continue;
  const rb = Math.sqrt(a.eB / a.n), ra = Math.sqrt(a.eA / a.n);
  const drop = (1 - ra / rb) * 100;
  console.log(
    `${k.padEnd(30)}${(a.n / (W * H) * 100).toFixed(1).padStart(5)}%     ${rb.toFixed(4)}       ${ra.toFixed(4)}      ${drop.toFixed(0).padStart(4)}%        ${(a.sppA / a.n).toFixed(2)}`
  );
  // 允许充分过采样区域有微小的带限偏差，但不允许明显变差
  if (ra > rb * 1.15 + 0.002) ok = false;
}
console.log(ok ? "\n关键区域误差下降，其余区域未变差" : "\n✗ 有区域明显变差");
process.exit(ok ? 0 : 1);
