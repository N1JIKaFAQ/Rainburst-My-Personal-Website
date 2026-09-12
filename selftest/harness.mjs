/**
 * 无头自检（零依赖）。运行方式：
 *   npx esbuild src/universe/engine.ts src/data/site.ts --format=esm --outdir=dist-selftest
 *   node selftest/harness.mjs
 *
 * 用一个带真实状态栈的假 2D context 跑 Cosmos 渲染循环。
 * 抓的是肉眼难发现的结构性 bug：
 *  1. save/restore 是否配平
 *  2. globalCompositeOperation / globalAlpha 每帧结束是否复位（lighter 泄漏会让整屏发白）
 *  3. 每个图层是否真的产生绘制调用（"没显示"的根因）
 *  4. 彗尾根部是否贴着彗核（脱轨检测）
 */
import { Cosmos } from "../dist-selftest/universe/engine.js";
import { stars } from "../dist-selftest/data/site.js";

let depth = 0;
let maxDepth = 0;
let negative = false;
let drawCount = 0;
const arcs = [];
const paths = [];

const makeGradient = () => ({ addColorStop() {} });

let recording = false;
class FakePath2D {
  constructor() {
    this.pts = [];
    if (recording) paths.push(this);
  }
  moveTo(x, y) { this.pts.push([x, y]); }
  lineTo(x, y) { this.pts.push([x, y]); }
  quadraticCurveTo(_a, _b, x, y) { this.pts.push([x, y]); }
  bezierCurveTo(_a, _b, _c, _d, x, y) { this.pts.push([x, y]); }
  rect(x, y) { this.pts.push([x, y]); }
  arc(x, y) { this.pts.push([x, y]); }
}
globalThis.Path2D = FakePath2D;

// 真实的 canvas 状态栈语义：save 压栈、restore 恢复所有绘图状态
const STATE_KEYS = ["globalAlpha", "globalCompositeOperation", "fillStyle", "strokeStyle", "lineWidth", "lineCap"];
const stack = [];

const ctx = {
  globalAlpha: 1,
  globalCompositeOperation: "source-over",
  fillStyle: "",
  strokeStyle: "",
  lineWidth: 1,
  lineCap: "butt",
  save() {
    const snap = {};
    for (const k of STATE_KEYS) snap[k] = this[k];
    stack.push(snap);
    depth++;
    maxDepth = Math.max(maxDepth, depth);
  },
  restore() {
    const snap = stack.pop();
    if (!snap) { negative = true; return; }
    for (const k of STATE_KEYS) this[k] = snap[k];
    depth--;
  },
  setTransform() {}, translate() {}, rotate() {}, scale() {},
  beginPath() {}, closePath() {},
  moveTo() {}, lineTo() {}, quadraticCurveTo() {}, bezierCurveTo() {},
  arc(x, y, r) { if (recording) arcs.push([x, y, r]); },
  ellipse() {},
  // 只有真的往路径里塞过点才算一次绘制：空 Path2D 上调用 stroke/fill
  // 在真实 canvas 里什么都不会画出来，不能算数。
  fill(path) {
    if (path instanceof FakePath2D && path.pts.length === 0) return;
    drawCount++;
  },
  stroke(path) {
    if (path instanceof FakePath2D && path.pts.length === 0) return;
    drawCount++;
  },
  fillRect() { drawCount++; },
  strokeRect() { drawCount++; },
  createRadialGradient: makeGradient,
  createLinearGradient: makeGradient,
};

const canvas = {
  width: 1440, height: 900, style: {},
  getContext: () => ctx,
  getBoundingClientRect: () => ({ width: 1440, height: 900 }),
};

const listeners = {};
globalThis.window = {
  innerWidth: 1440, innerHeight: 900, devicePixelRatio: 2,
  addEventListener: (k, f) => { (listeners[k] ||= []).push(f); },
  removeEventListener: () => {},
  matchMedia: () => ({ matches: false }),
};
globalThis.document = { hidden: false, addEventListener() {}, removeEventListener() {} };
globalThis.performance = { now: () => 0 };
globalThis.requestAnimationFrame = () => 0;
globalThis.cancelAnimationFrame = () => {};

const engine = new Cosmos(canvas, {});
engine.setStarDefs(stars);
engine.setEnter("intro", "#05060c");

// 鼠标停在蓝色星云内部，确保星云卷吸、透镜、吸积等分支全部执行
for (const f of listeners.pointermove ?? []) f({ clientX: 1050, clientY: 330 });

const failures = [];

// 跑满 60 秒模拟时间：覆盖入场、恒星随机事件、整条彗星轨道、遗迹信标
for (let i = 0; i < 3600; i++) {
  const before = drawCount;
  engine.time += 1 / 60;
  engine.update(1 / 60);
  engine.render();
  if (depth !== 0) { failures.push(`第 ${i} 帧 save/restore 不配平，残留深度 ${depth}`); break; }
  if (ctx.globalCompositeOperation !== "source-over") {
    failures.push(`第 ${i} 帧结束时合成模式未复位: ${ctx.globalCompositeOperation}`); break;
  }
  if (Math.abs(ctx.globalAlpha - 1) > 1e-6) {
    failures.push(`第 ${i} 帧结束时 globalAlpha 未复位: ${ctx.globalAlpha}`); break;
  }
  if (drawCount === before) { failures.push(`第 ${i} 帧没有任何绘制`); break; }
}
if (negative) failures.push("出现了多余的 restore()");

// 此刻黑洞已完全激活（60 秒模拟时间早已跑完入场动画）。
// (1050,330) 不在任何恒星的吸积判定半径内，模拟一次空白处左键点击。
for (const f of listeners.pointerdown ?? []) f({ clientX: 1050, clientY: 330, button: 0 });
if (engine.ejecta.length === 0) failures.push("空白处左键点击没有产生喷射粒子（ejecta 为空）");
// 真实渲染循环里 update() 总是先于 render() 执行一次，这里复现同样的顺序再取样。
engine.update(1 / 60);
{
  const before = drawCount;
  engine.drawEjecta();
  if (drawCount === before) failures.push("drawEjecta 有粒子却没有产生可见绘制");
}
// 右键 / 非主指针不应触发喷射
const beforeCount = engine.ejecta.length;
for (const f of listeners.pointerdown ?? []) f({ clientX: 300, clientY: 300, button: 2 });
if (engine.ejecta.length !== beforeCount) failures.push("右键点击也触发了喷射（应只响应左键）");

// 逐层验证：入场已完成，此时每个图层都必须有绘制
const probes = ["drawNebula", "drawDrifters", "drawComets", "drawGridDots", "drawHorizon", "drawRibbons", "drawEjecta"];
console.log("图层绘制统计:");
for (const name of probes) {
  const before = drawCount;
  if (name === "drawRibbons") engine[name]();
  else engine[name](engine.time);
  const n = drawCount - before;
  console.log(`  ${name}: ${n} 次绘制`);
  if (n === 0) failures.push(`${name} 没有产生任何绘制调用（该图层不可见）`);
}

// 彗尾脱轨检测：抓 drawComets 实际生成的 ion 路径首点与彗核光晕圆心
let worstGap = 0;
let sampled = 0;
recording = true;
const allComets = engine.comets;
let worstDustGap = 0;
// 一次只放一颗彗星，路径与圆弧的配对才不会被"近距离光环"这类额外 arc 打乱
for (const comet of allComets) {
  engine.comets = [comet];
  for (let k = 1; k < 300; k++) {
    engine.time = k * 0.23;
    paths.length = 0;
    arcs.length = 0;
    engine.drawComets(engine.time);
    if (paths.length < 3 || arcs.length === 0) continue;
    const ion = paths[0];
    const dust = paths[1];
    const headArc = arcs[0]; // 彗核光晕永远是本颗彗星画的第一个圆
    if (!ion.pts.length || !dust.pts.length) continue;
    worstGap = Math.max(worstGap, Math.hypot(ion.pts[0][0] - headArc[0], ion.pts[0][1] - headArc[1]));
    worstDustGap = Math.max(worstDustGap, Math.hypot(dust.pts[0][0] - headArc[0], dust.pts[0][1] - headArc[1]));
    sampled++;
  }
}
engine.comets = allComets;
console.log(`尘埃尾根↔彗核最大间距: ${worstDustGap.toFixed(4)}px`);
if (worstDustGap > 0.5) failures.push(`尘埃尾根部与彗核脱离，最大间距 ${worstDustGap.toFixed(2)}px`);
console.log(`\n彗核↔尾根最大间距: ${worstGap.toFixed(4)}px（采样 ${sampled} 次）`);
console.log(`save/restore 最大嵌套深度: ${maxDepth}`);
if (sampled === 0) failures.push("彗星从未被绘制，无法验证尾部");
if (worstGap > 0.5) failures.push(`彗尾根部与彗核脱离，最大间距 ${worstGap.toFixed(2)}px`);

if (failures.length) {
  console.log("\n发现问题:");
  for (const f of failures) console.log("  ✗ " + f);
  process.exit(1);
}
console.log("\n全部自检通过");

// 性能：统计纯逻辑+绘制调用的每帧耗时（不含真实光栅化，但能反映 JS 侧开销）
recording = false;
engine.time = 30;
const t0 = process.hrtime.bigint();
for (let i = 0; i < 600; i++) { engine.time += 1 / 60; engine.update(1 / 60); engine.render(); }
const ms = Number(process.hrtime.bigint() - t0) / 1e6 / 600;
console.log(`JS 侧平均每帧: ${ms.toFixed(3)} ms（16.7ms 预算）`);
