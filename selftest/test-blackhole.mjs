/**
 * BlackholeScene 架构与逻辑自检（零外部依赖）
 * 运行：
 *   npx esbuild src/universe/blackhole.ts src/data/site.ts --format=esm --outdir=dist-selftest
 *   node selftest/test-blackhole.mjs
 */
import { BlackholeScene } from "../dist-selftest/universe/blackhole.js";
import { rockCards } from "../dist-selftest/data/site.js";

const failures = [];

// 验证 rockCards 数据完整性
if (!Array.isArray(rockCards) || rockCards.length < 3) {
  failures.push("rockCards 数据缺失或长度小于 3");
} else {
  for (const c of rockCards) {
    if (!c.id || !c.title || !c.category || !c.metrics) {
      failures.push(`卡片 ${c.id || "未知"} 缺少关键字段`);
    }
  }
}

// 模拟 WebGL2 环境
const glCalls = [];
const fakeGL = {
  VERTEX_SHADER: 35633,
  FRAGMENT_SHADER: 35632,
  LINK_STATUS: 35714,
  COMPILE_STATUS: 35713,
  TRIANGLES: 4,
  FLOAT: 5126,
  ARRAY_BUFFER: 34962,
  STATIC_DRAW: 35044,
  createShader: (type) => ({ type }),
  shaderSource: () => {},
  compileShader: () => {},
  getShaderParameter: () => true,
  getShaderInfoLog: () => "",
  deleteShader: () => {},
  createProgram: () => ({ id: "prog" }),
  attachShader: () => {},
  linkProgram: () => {},
  getProgramParameter: () => true,
  getProgramInfoLog: () => "",
  deleteProgram: () => {},
  getUniformLocation: (p, name) => ({ name }),
  getAttribLocation: (p, name) => 0,
  createVertexArray: () => ({ id: "vao" }),
  deleteVertexArray: () => {},
  bindVertexArray: () => {},
  createBuffer: () => ({ id: "vbo" }),
  deleteBuffer: () => {},
  bindBuffer: () => {},
  bufferData: () => {},
  enableVertexAttribArray: () => {},
  vertexAttribPointer: () => {},
  viewport: (x, y, w, h) => glCalls.push(`viewport:${w}x${h}`),
  useProgram: () => {},
  uniform1f: (loc, val) => glCalls.push(`u1f:${loc.name}=${val.toFixed(2)}`),
  uniform2f: () => {},
  uniform3f: (loc, a, b, c) => glCalls.push(`u3f:${loc.name}=${a.toFixed(3)},${b.toFixed(3)},${c.toFixed(3)}`),
  drawArrays: () => glCalls.push("draw"),
};

const fakeCanvas = {
  width: 1440,
  height: 900,
  getContext: (type) => (type === "webgl2" ? fakeGL : null),
  getBoundingClientRect: () => ({ width: 1440, height: 900 }),
};

const listeners = {};
globalThis.window = {
  innerWidth: 1440,
  innerHeight: 900,
  devicePixelRatio: 1,
  addEventListener: (k, f) => { (listeners[k] ||= []).push(f); },
  removeEventListener: () => {},
};
globalThis.document = {
  hidden: false,
  addEventListener: () => {},
  removeEventListener: () => {},
};
let frameCb = null;
globalThis.requestAnimationFrame = (cb) => { frameCb = cb; return 1; };
globalThis.cancelAnimationFrame = () => {};

// 不支持 WebGL2 的环境：必须安全降级（supported=false，不注册监听、不崩溃）
{
  const noGlCanvas = { ...fakeCanvas, getContext: () => null };
  const before = Object.values(listeners).reduce((n, a) => n + a.length, 0);
  const s = new BlackholeScene(noGlCanvas, {});
  if (s.supported !== false) failures.push("无 WebGL2 时 supported 应为 false");
  const after = Object.values(listeners).reduce((n, a) => n + a.length, 0);
  if (after !== before) failures.push("无 WebGL2 时不应注册任何事件监听");
  s.setProgress(0.5);
  s.destroy();
}

let reportedProgress = -1;
const scene = new BlackholeScene(fakeCanvas, {
  onProgress: (p) => { reportedProgress = p; },
});
if (scene.supported !== true) failures.push("有 WebGL2 时 supported 应为 true");

// 测试 progress 设置与平滑阻尼更新
scene.setProgress(0.65);

// 推进若干帧
for (let i = 0; i < 40; i++) {
  if (frameCb) frameCb(i * 16.6);
}

if (reportedProgress < 0.6 || reportedProgress > 0.66) {
  failures.push(`setProgress(0.65) 未平滑传递给 onProgress，实际得到 ${reportedProgress}`);
}

scene.setProgress(1.0);
for (let i = 40; i < 100; i++) {
  if (frameCb) frameCb(i * 16.6);
}

if (reportedProgress < 0.98) {
  failures.push(`setProgress(1.0) 未到达终点，实际得到 ${reportedProgress}`);
}

// 运动相位必须随时间推进且 wrap 在 [0, 2π)：这是"盘面不再静止"的根本保证
const spins = glCalls.filter((c) => c.startsWith("u1f:u_spin=")).map((c) => Number(c.split("=")[1]));
const knots = glCalls.filter((c) => c.startsWith("u3f:u_knots="));
if (spins.length < 10) failures.push("u_spin 未按帧更新");
else {
  if (spins.every((v) => v === spins[0])) failures.push("u_spin 始终不变，盘面纹理会是静止的");
  if (spins.some((v) => v < 0 || v >= 6.2832)) failures.push("u_spin 未 wrap 到 [0, 2π)");
}
if (knots.length < 10) failures.push("u_knots 未按帧更新");
else {
  // 不同半径的热斑必须以不同角速度运动（开普勒差分自转：内侧更快）
  const at = (i) => knots[i].split("=")[1].split(",").map(Number);
  const a = at(5), b = at(knots.length - 1);
  const d = b.map((v, i) => ((v - a[i]) % 6.2832 + 6.2832) % 6.2832);
  if (!(d[0] > d[1] && d[1] > d[2])) failures.push(`内侧热斑应转得更快，实测相位增量 ${d.map((x) => x.toFixed(2)).join(" > ")}`);
}

// 测试正常销毁
scene.destroy();

console.log(`WebGL 调用统计: ${glCalls.length} 次`);
console.log(`最终平滑进度: ${reportedProgress.toFixed(4)}`);
console.log(`卡片配置数: ${rockCards.length}`);

if (failures.length) {
  console.log("\n发现问题:");
  for (const f of failures) console.log("  ✗ " + f);
  process.exit(1);
}
console.log("\nBlackholeScene 自检全部通过");
