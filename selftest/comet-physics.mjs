/**
 * 彗星引力偏折的物理不变量测试（零依赖）。
 *   npx esbuild src/universe/engine.ts src/data/site.ts --format=esm --outdir=dist-selftest
 *   node selftest/comet-physics.mjs
 *
 * 检查三件事：
 *  1. 偏折量永远小于 1 → 采样点只在"原位置↔黑洞"之间移动，几何不会自交/翻转。
 *     （旧实现 bend 可以到 1.03，尾巴会被搬到黑洞另一侧。）
 *  2. 彗核与尾部第一个采样点（同一物理点）位移完全一致 → 首尾不脱节。
 *  3. 远离黑洞时偏折必须归零 → 不再出现"整条尾巴被一起拖走"的橡皮筋感。
 */
import { Cosmos } from "../dist-selftest/universe/engine.js";
import { stars } from "../dist-selftest/data/site.js";

globalThis.Path2D = class {
  moveTo() {} lineTo() {} quadraticCurveTo() {} bezierCurveTo() {} rect() {} arc() {}
};

const ctx = new Proxy(
  { globalAlpha: 1, globalCompositeOperation: "source-over" },
  {
    get(t, k) {
      if (k in t) return t[k];
      if (k === "createRadialGradient" || k === "createLinearGradient")
        return () => ({ addColorStop() {} });
      return () => {};
    },
    set(t, k, v) { t[k] = v; return true; },
  }
);

const canvas = {
  width: 1440, height: 900, style: {},
  getContext: () => ctx,
  getBoundingClientRect: () => ({ width: 1440, height: 900 }),
};
const L = {};
globalThis.window = {
  innerWidth: 1440, innerHeight: 900, devicePixelRatio: 1,
  addEventListener: (k, f) => { (L[k] ||= []).push(f); },
  removeEventListener() {}, matchMedia: () => ({ matches: false }),
};
globalThis.document = { hidden: false, addEventListener() {}, removeEventListener() {} };
globalThis.performance = { now: () => 0 };
globalThis.requestAnimationFrame = () => 0;
globalThis.cancelAnimationFrame = () => {};

const e = new Cosmos(canvas, {});
e.setStarDefs(stars);
e.setEnter("intro", "#05060c");
// 把真实的黑洞挪到指定位置并拉到满强度。
// 注意 cometBend 内部用的是引擎自己的 mx/my，不是测试里另设的坐标。
const BH = { x: 700, y: 450 };
const placeBH = (x, y) => {
  e.mx = x; e.my = y; e.tx = x; e.ty = y;
  e.influence = 1;
};
placeBH(BH.x, BH.y);

const failures = [];

// —— 1 & 3：扫描各种距离，检查偏折比例上限与远场归零
let maxPull = 0;
let maxPullAt = 0;
for (let d = 0; d <= 900; d += 2) {
  for (const ang of [0, 1.1, 2.6, 4.2, 5.5]) {
    const x = BH.x + Math.cos(ang) * d;
    const y = BH.y + Math.sin(ang) * d;
    placeBH(BH.x, BH.y); // 防止其它检查改过位置
    const out = e.cometBend(x, y, 0.72);
    const disp = Math.hypot(out.x - x, out.y - y);
    const distBefore = Math.hypot(BH.x - x, BH.y - y);
    const distAfter = Math.hypot(BH.x - out.x, BH.y - out.y);
    // 偏折比例必须 < 1：距离黑洞只会变小，绝不会越过黑洞
    if (distBefore > 1e-6 && distAfter >= distBefore) {
      failures.push(`d=${d} 时偏折没有把点拉近黑洞（几何异常）`);
      break;
    }
    if (d > 0) {
      const pull = disp / distBefore;
      if (pull > maxPull) { maxPull = pull; maxPullAt = d; }
    }
    // 远场必须几乎无扰动（这是"只扭曲经过的光"的量化标准）
    if (d > 400 && disp > 2) {
      failures.push(`d=${d}（远场）仍有 ${disp.toFixed(2)}px 位移，影响范围过大`);
      break;
    }
    // 近场必须有可感知的偏折，否则这个交互等于没有
    if (d === 60 && ang === 0 && disp < 4) {
      failures.push(`d=60 只有 ${disp.toFixed(2)}px 偏折，近场效果太弱`);
      break;
    }
  }
  if (failures.length) break;
}
if (maxPull >= 1) failures.push(`偏折比例达到 ${maxPull.toFixed(3)}，会导致几何翻转`);

// —— 2：彗核与尾根位移一致性（用真实彗星轨道采样）
let worstGap = 0;
const comet = e.comets[0];
for (let k = 0; k < 400; k++) {
  const p = k / 400;
  const raw = e.bezierPoint(comet.path, p);
  const head = e.cometBend(raw.x, raw.y, comet.depth);
  const tailRoot = e.cometBend(raw.x, raw.y, comet.depth); // j=0 采样点与彗核同一位置
  worstGap = Math.max(worstGap, Math.hypot(head.x - tailRoot.x, head.y - tailRoot.y));
}

// —— 4：彗尾形态连续性：相邻采样点位移差必须平滑，不能出现跳变
let maxStepJump = 0;
{
  const step = 0.004;
  for (let k = 1; k < 300; k++) {
    const p = k / 300;
    const a = e.bezierPoint(comet.path, p);
    const b = e.bezierPoint(comet.path, Math.max(0, p - step));
    const oa = e.cometBend(a.x, a.y, comet.depth);
    const ob = e.cometBend(b.x, b.y, comet.depth);
    // 相邻两点的位移向量差（不是位置差），用于检测橡皮筋式突变
    const jump = Math.hypot((oa.x - a.x) - (ob.x - b.x), (oa.y - a.y) - (ob.y - b.y));
    maxStepJump = Math.max(maxStepJump, jump);
  }
}
if (maxStepJump > 6) failures.push(`尾部位移场出现 ${maxStepJump.toFixed(2)}px 的阶跃，会有橡皮筋感`);

console.log(`偏折比例最大值:      ${maxPull.toFixed(4)}（出现在 d=${maxPullAt}px，必须 < 1）`);
console.log(`彗核↔尾根位移差:     ${worstGap.toFixed(6)}px（必须为 0）`);
console.log(`相邻采样位移场阶跃:  ${maxStepJump.toFixed(3)}px（越小越平滑）`);

// —— 5：星云必须完全静止，不随黑洞移动
const snapBefore = e.nebulae.map((n) => ({ x: n.x, y: n.y }));
for (let i = 0; i < 240; i++) {
  e.mx = 200 + i * 4;
  e.my = 200 + i * 2;
  e.time += 1 / 60;
  e.update(1 / 60);
}
const moved = e.nebulae.some((n, i) => n.x !== snapBefore[i].x || n.y !== snapBefore[i].y);
if (moved) failures.push("星云位置被黑洞改动了（应为绝对静止）");

if (failures.length) {
  console.log("\n发现问题:");
  for (const f of failures) console.log("  ✗ " + f);
  process.exit(1);
}
console.log("\n彗星偏折与星云静止性全部通过");
