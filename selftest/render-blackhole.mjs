/**
 * 黑洞着色器的 CPU 参考渲染器（出图 + 构图统计）。
 *   node selftest/render-blackhole.mjs [progress=0,0.5,1] [width=320] [time=12]
 * 输出：selftest/bh-p<NN>.png
 * 环境变量：NOLOD=1 关闭带限（复现修复前），SPP=n 全画面 n 倍均匀超采样（1 = 关闭超采样）
 */
import { writePNG } from "./png.mjs";
import { makeShader, motionFor } from "./bh-shader.mjs";

const W = Number(process.argv[3] ?? 320);
const H = Math.round(W * 0.625);
const PROGRESSES = (process.argv[2] ?? "0,0.5,1").split(",").map(Number);
const T = Number(process.argv[4] ?? 12);
const { shadePixel } = makeShader({
  noLod: process.env.NOLOD === "1",
  spp: process.env.SPP ? Number(process.env.SPP) : "auto",
});

for (const p of PROGRESSES) {
  const t0 = Date.now();
  const u = { ...motionFor(p, T), resY: H };
  const rgb = Buffer.alloc(W * H * 3);
  const aspect = W / H;
  let horizonPixels = 0, starPixels = 0, hxSum = 0, hySum = 0, sampleSum = 0;
  let starMaxX = -1, pureShadow = 0, pureMean = [0, 0, 0], leftLum = 0, rightLum = 0, streamPx = 0;
  const lums = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    const uvy = 1 - (2 * (y + 0.5)) / H;
    for (let x = 0; x < W; x++) {
      const uvx = (2 * (x + 0.5)) / W - 1;
      const r = shadePixel(uvx, uvy, aspect, p, u);
      const i = (y * W + x) * 3;
      rgb[i] = Math.round(r.rgb[0] * 255); rgb[i + 1] = Math.round(r.rgb[1] * 255); rgb[i + 2] = Math.round(r.rgb[2] * 255);
      sampleSum += r.spp;
      const lum = (r.rgb[0] + r.rgb[1] + r.rgb[2]) / 3;
      lums[y * W + x] = lum;
      if (x < W / 2) leftLum += lum; else rightLum += lum;
      if (r.horizon) {
        horizonPixels++; hxSum += x; hySum += y;
        if (r.preAlpha < 0.05) { pureShadow++; pureMean = [pureMean[0] + r.rgb[0], pureMean[1] + r.rgb[1], pureMean[2] + r.rgb[2]]; }
      }
      if (r.hitStar) { starPixels++; if (x > starMaxX) starMaxX = x; }
      if (r.streamLum > 0.08) streamPx++;
    }
  }
  const file = `selftest/bh-p${String(Math.round(p * 100)).padStart(3, "0")}.png`;
  writePNG(file, W, H, rgb);
  const cx = hxSum / Math.max(1, horizonPixels), cy = hySum / Math.max(1, horizonPixels);
  const shadowR = Math.sqrt(horizonPixels / Math.PI);
  const pm = pureMean.map((c) => Math.round((c / Math.max(1, pureShadow)) * 255));
  // 盘面纹理对比度：阴影右侧 1.3R~3R 的水平带（沿滚转方向）
  let bm = 0, bn = 0; const band = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const dx = (x - cx) / shadowR, dy = (y - cy) / shadowR;
    const along = dx * Math.cos(0.36) + dy * Math.sin(0.36);
    const perp = -dx * Math.sin(0.36) + dy * Math.cos(0.36);
    if (along > 1.3 && along < 3.0 && Math.abs(perp) < 0.35) { band.push(lums[y * W + x]); bm += lums[y * W + x]; bn++; }
  }
  bm /= Math.max(1, bn);
  const bsd = Math.sqrt(band.reduce((s, v) => s + (v - bm) ** 2, 0) / Math.max(1, bn));
  console.log(`p=${p.toFixed(2)}  ${file}  (${((Date.now() - t0) / 1000).toFixed(1)}s, ${W}x${H}, 平均 ${(sampleSum / (W * H)).toFixed(2)} spp)`);
  console.log(`   黑洞阴影中心: x=${(cx / W * 100).toFixed(1)}%  y=${(cy / H * 100).toFixed(1)}%  阴影半径≈${(shadowR / W * 100).toFixed(1)}% 画面宽`);
  console.log(`   纯阴影像素 ${(pureShadow / Math.max(1, horizonPixels) * 100).toFixed(0)}%  平均色 rgb(${pm.join(",")})  ← 深色但非纯黑`);
  console.log(`   盘面(右侧1.3~3R带) 平均亮度 ${bm.toFixed(3)}  标准差 ${bsd.toFixed(3)}  ← 标准差 > 0.08 才有可见纹理/动感`);
  console.log(`   蓝巨星占画面: ${(starPixels / (W * H) * 100).toFixed(1)}%   星体最右延伸到 x=${(starMaxX / W * 100).toFixed(1)}%`);
  console.log(`   潮汐流可见像素: ${(streamPx / (W * H) * 100).toFixed(2)}%   左半亮度 ${(leftLum / (W * H / 2)).toFixed(3)}  右半亮度 ${(rightLum / (W * H / 2)).toFixed(3)}`);
}
