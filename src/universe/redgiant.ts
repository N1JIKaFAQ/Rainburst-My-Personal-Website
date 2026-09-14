/**
 * RedGiantScene —— 写实风格红巨星（WebGL2 全屏片元，与 blackhole.ts 同款样板）
 *
 * 画面语言：
 *  · 光球表面：多层 fbm 噪声做米粒/超granulation 组织，大尺度对流胞 + 细颗粒纹理，时间缓慢演化；
 *  · 临边昏暗：解析光球模型 I ∝ (0.47 + 0.53·μ^0.6)，弧缘自然压暗、红化；
 *  · 自转：球面坐标 (θ,φ) 映射噪声域，φ = atan2(y,z) + 自转相位；
 *    可见弧带在 +x 侧（φ→±90°），特征沿弧向屏幕中心方向滑移、临边处被压缩变暗消隐，
 *    背面点自动隐藏——这就是"自转"的来源，不需要额外处理；
 *  · 日冕：弧缘外两层指数衰减辉光 + 低频噪声调制的丝状结构，呼吸周期 7.8s；
 *  · 入场：u_p 0→1 把星盘从「远处完整小盘」推进到「只露左缘弧段」（终态圆心 2.5·H 于视口中心之左，
 *    半径 1.25·H，弧顶抵达画面 x≈30% 宽处）；
 *  · 色板：#ffd9b8（核心）→ #ff7a4d（盘面）→ 暗红（临边），与 site.ts 的 red-giant 一致。
 *
 * 数值稳健性：自转/演化相位由 JS 用 dt 积分后作为 uniform 传入；噪声全部整数哈希。
 */

const VERT_SHADER = `#version 300 es
in vec2 a_pos;
void main() {
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

const FRAG_SHADER = `#version 300 es
precision highp float;

out vec4 fragColor;

uniform vec2  u_res;      // 画布像素尺寸
uniform float u_time;     // 秒（呼吸/演化用）
uniform float u_rot;      // 自转相位 rad（JS 积分）
uniform float u_p;        // 入场进度 0..1（0=远处完整盘，1=定格左缘弧段）
uniform float u_fade;     // 整幅亮度 0..1（返回宇宙时淡出）

/* ---------------- 哈希与噪声（与 blackhole.ts 同源） ---------------- */
uint uhash(uint n) {
  n ^= n >> 16u; n *= 0x7feb352du;
  n ^= n >> 15u; n *= 0x846ca68bu;
  n ^= n >> 16u;
  return n;
}
float hash2i(ivec2 p) {
  uint h = uhash((uint(p.x) * 0x9E3779B1u) ^ uhash(uint(p.y) + 0x68E31DA4u));
  return float(h) * (1.0 / 4294967296.0);
}
float hash3i(ivec3 p) {
  uint h = uhash((uint(p.x) * 0x9E3779B1u) ^ uhash((uint(p.y) * 0x85EBCA77u) ^ uhash(uint(p.z) + 0x68E31DA4u)));
  return float(h) * (1.0 / 4294967296.0);
}
float noise3D(vec3 p) {
  vec3 i = floor(p);
  vec3 f = p - i;
  vec3 u = f * f * (3.0 - 2.0 * f);
  ivec3 c = ivec3(i);
  float n000 = hash3i(c);
  float n100 = hash3i(c + ivec3(1, 0, 0));
  float n010 = hash3i(c + ivec3(0, 1, 0));
  float n110 = hash3i(c + ivec3(1, 1, 0));
  float n001 = hash3i(c + ivec3(0, 0, 1));
  float n101 = hash3i(c + ivec3(1, 0, 1));
  float n011 = hash3i(c + ivec3(0, 1, 1));
  float n111 = hash3i(c + ivec3(1, 1, 1));
  float nx00 = mix(n000, n100, u.x);
  float nx10 = mix(n010, n110, u.x);
  float nx01 = mix(n001, n101, u.x);
  float nx11 = mix(n011, n111, u.x);
  return mix(mix(nx00, nx10, u.y), mix(nx01, nx11, u.y), u.z);
}
float fbm3D(vec3 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * noise3D(p);
    p = p * 2.03 + vec3(11.3, 7.1, 3.9);
    a *= 0.5;
  }
  return v;
}

vec3 aces(vec3 c) {
  return clamp((c * (2.51 * c + 0.03)) / (c * (2.43 * c + 0.59) + 0.14), 0.0, 1.0);
}
// iOS 入场缓动（easeOutQuint 近似 cubic-bezier(0.22,1,0.36,1)）
float easeOutQuint(float t) { return 1.0 - pow(1.0 - t, 5.0); }

/* ---------------- 主流程 ---------------- */
void main() {
  float aspect = u_res.x / u_res.y;
  // 单位空间：视口中心为原点，y∈[-1,1]（全高=2 单位），x∈[-aspect,aspect]
  vec2 s = vec2((gl_FragCoord.x / u_res.x - 0.5) * 2.0 * aspect, (gl_FragCoord.y / u_res.y - 0.5) * 2.0);

  float e = easeOutQuint(clamp(u_p, 0.0, 1.0));
  // 终态：弧顶抵达 x = -0.40·w（画面左 30%），圆心 2.5·H 于左，半径 2.5 单位（=1.25·全高）
  float r1 = 2.5;
  vec2 c1 = vec2(-0.40 * aspect - r1, 0.0);
  vec2 c0 = vec2(-0.55 * aspect, -0.15);      // 起始：完整的远处小盘
  float r0 = 0.34;
  vec2 c = mix(c0, c1, e);
  float R = mix(r0, r1, e);

  vec2 q = s - c;
  float L = length(q);
  // 正交投影球面：盘内点 (L<R) 的三维法线 n=(qx/R, qy/R, √(1-ρ²))，视线 +z。
  // μ = n.z = √(1-(L/R)²)：盘心正对观众 μ=1 最亮，圆周一圈是几何临边 μ→0 变暗红——
  // 这正是真实望远镜看到的恒星。入场小盘因此是完整圆盘，定格后只剩外圈 1/4 环带（μ≈0.4..0.9 的梯度带）。
  float rho = min(L / max(R, 1e-4), 1.0);
  float mu = sqrt(max(0.0, 1.0 - rho * rho));
  float ang = atan(q.y, q.x);                  // 投影方位（日冕丝状用）

  float pixAng = 2.0 / u_res.y;                // 一像素张角（单位空间）

  // ---- 三维单位法线（正交投影：n=(qx/R, qy/R, μ)），自转轴 = y ----
  vec3 nrm = normalize(vec3(q.x / max(R, 1e-4), q.y / max(R, 1e-4), max(mu, 1e-4)));
  // 球面坐标：经度 lon 随自转推进（中央经线正对观众），纬度 lat 由 n.y 给出
  float lon = atan(nrm.x, nrm.z) + u_rot;
  float lat = asin(clamp(nrm.y, -1.0, 1.0));
  vec3 u = vec3(cos(lat) * cos(lon), sin(lat), cos(lat) * sin(lon));   // 无奇点的球面采样点

  // 像素足迹（噪声域单位）：掠射（μ→0）拉伸 + 小盘（R 小）整体变小，都让足迹超过奈奎斯特
  float graz = max(0.10, mu);

  // ---- 光球纹理：大尺度对流胞 + 中尺度米粒 + 细颗粒（带限：小盘/掠射处回落，不摩尔纹）----
  float t1 = u_time * 0.012;   // 演化要慢——"安静地燃烧"
  vec3 P = u * 8.0;
  vec3 P2 = u * 18.0;
  vec3 P3 = u * 42.0;
  float lodA = 1.0 - smoothstep(0.35, 1.0, pixAng * 8.0 / max(R, 0.01) / graz);
  float lodB = 1.0 - smoothstep(0.35, 1.0, pixAng * 18.0 / max(R, 0.01) / graz);
  float lodC = 1.0 - smoothstep(0.35, 1.0, pixAng * 42.0 / max(R, 0.01) / graz);
  float conv = mix(0.5, fbm3D(P + vec3(0.0, t1 * 1.5, 0.0)), lodA);       // 对流胞（翻涌的大团）
  float gran = mix(0.5, fbm3D(P2 - vec3(t1 * 2.5, 0.0, t1)), lodB);       // 米粒组织
  float fine = mix(0.5, fbm3D(P3 + vec3(t1 * 4.0)), lodC);                // 细颗粒
  float cell = smoothstep(0.32, 0.70, conv * 0.55 + gran * 0.45);
  float bright = (0.42 + 0.58 * cell) * (0.84 + 0.32 * fine);

  // ---- 临边昏暗 + 色温梯度 ----
  // 红巨星整体偏暗红、对比强，绝不能过曝成白/奶油色；core 用暖橙，limb 深红。
  float LD = 0.30 + 0.70 * pow(mu, 0.75);      // 解析光球模型，弧缘自然压暗
  vec3 coreCol = vec3(1.000, 0.451, 0.176);    // 中心：炽橙（压掉黄褐感）
  vec3 faceCol = vec3(0.851, 0.306, 0.110);    // 盘面：深橙红
  vec3 limbCol = vec3(0.302, 0.045, 0.012);    // 临边：暗红褐
  float cmix = pow(1.0 - mu, 1.7);
  vec3 base = mix(coreCol, faceCol, clamp(0.5 + 0.6 * cmix, 0.0, 1.0));
  base = mix(base, limbCol, clamp(cmix * cmix * 1.3, 0.0, 1.0));
  // 纹理调制：米粒组织造成明暗，但整体亮度受控（曝光 ~1.0，避免过曝）
  float I = LD * (0.55 + 0.62 * bright);
  vec3 col = base * I * 1.05;
  // 局部热丝：亮粒微微冲淡颜色往黄白（不超过白），暗沟往深红——增加燃烧质感
  float heat = (bright - 0.55);
  col += vec3(0.55, 0.22, 0.02) * max(0.0, heat) * LD * 0.7;
  col *= 1.0 - 0.30 * max(0.0, -heat);

  // 暗斑（星斑），大尺度低频
  float spot = fbm3D(P * 0.8 + vec3(31.7));
  col *= 1.0 - 0.40 * smoothstep(0.60, 0.80, spot);

  // ---- 星缘：解析亚像素覆盖率 ----
  float dEdge = R - L;
  float cov = clamp(dEdge / pixAng + 0.5, 0.0, 1.0);

  // ---- 日冕：只加在盘外（最终合成走背景通道，不受 cov 混合丢弃）----
  float gap = max(0.0, L - R);
  float corona = 0.55 * exp(-gap / 0.030) + 0.22 * exp(-gap / 0.10) + 0.06 * exp(-gap / 0.34);
  float fil = fbm3D(vec3(cos(ang) * 9.0, sin(ang) * 9.0, u_time * 0.02)) * 0.5 + 0.5;
  corona *= (0.55 + 0.45 * pow(fil, 1.5));
  float breath = 1.0 + 0.14 * sin(u_time * 0.8055);   // 周期 7.8s，呼应 site.ts pulsePeriod

  // ---- 背景：#0c0503 纯色 + 恒星球光照渐晕（无点阵）+ 日冕 ----
  vec3 bg = vec3(0.047, 0.020, 0.012);
  bg += vec3(1.00, 0.42, 0.16) * corona * breath;
  bg += vec3(0.05, 0.014, 0.004) * exp(-gap / 0.9) * (0.6 + 0.4 * breath);
  float dist = length(s);
  bg += vec3(0.030, 0.010, 0.004) * exp(-max(0.0, dist - R) * 1.1) * 0.8;
  bg *= 1.0 - 0.16 * dot(s * vec2(1.0 / max(aspect, 1.0), 1.0), s * vec2(1.0 / max(aspect, 1.0), 1.0));

  // 少量背景星点（很暗，给空间感）
  vec2 g = s * 140.0;
  ivec2 cell2 = ivec2(floor(g));
  float hh = hash2i(cell2);
  if (hh > 0.9975) {
    vec2 d2 = g - (vec2(cell2) + vec2(0.3 + 0.4 * hash2i(cell2 + ivec2(7, 13)), 0.3 + 0.4 * hash2i(cell2 + ivec2(23, 5))));
    float spk = exp(-dot(d2, d2) * 0.6);
    bg += vec3(0.85, 0.75, 0.7) * spk * 0.22 * (0.4 + 0.6 * hash2i(cell2 + ivec2(41, 19)));
  }

  // 盘内贴边一条薄薄的临边增亮（让弧缘发光但不糊面）：仅在几何临边（mu 小）处轻微
  col *= 1.0 + cov * 0.30 * pow(1.0 - mu, 2.8) * breath;
  col = mix(bg, col, cov);
  col = aces(col);
  // 退场淡出压向背景色（避免黑闪），并加微量抖动
  col = mix(vec3(0.047, 0.020, 0.012), col, clamp(u_fade, 0.0, 1.0));
  col += (hash2i(ivec2(gl_FragCoord.xy)) - 0.5) * (1.0 / 255.0);
  fragColor = vec4(col, 1.0);
}
`;

const RENDER_SCALES = [1, 0.85, 0.7, 0.55];

/** 自转默认角速度：约 140s 扫过可见视场（φ 变化 ~0.85 rad/140s → 取 0.0152 rad/s，可调） */
export const RED_GIANT_DEFAULTS = {
  /** 自转角速度 rad/s */ spinRate: 0.0152,
  /** 入场时长 ms */ entranceMs: 1800,
};

export class RedGiantScene {
  /** 浏览器不支持 WebGL2 时为 false，页面据此回退到通用板块页 */
  readonly supported: boolean;

  private canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private vbo: WebGLBuffer | null = null;

  private uRes: WebGLUniformLocation | null = null;
  private uTime: WebGLUniformLocation | null = null;
  private uRot: WebGLUniformLocation | null = null;
  private uP: WebGLUniformLocation | null = null;
  private uFade: WebGLUniformLocation | null = null;

  private rafId = 0;
  private startTime = 0;
  private disposed = false;

  /** 入场进度：挂载时记录起始时刻，1.8s 内 0→1（缓动在着色器里做） */
  private entranceAt = 0;
  private entranceMs = RED_GIANT_DEFAULTS.entranceMs;
  /** 淡出用的整体亮度 */
  private fade = 1;
  private targetFade = 1;

  private rot = 0;
  private lastFrame = 0;

  private width = 0;
  private height = 0;

  /** 自转角速度 rad/s（可运行时调） */
  spinRate = RED_GIANT_DEFAULTS.spinRate;

  private scaleIdx = 0;
  private frameEMA = 16.7;
  private lastScaleChange = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.supported = this.initGL();
    this.startTime = performance.now();
    this.entranceAt = this.startTime;
    if (this.supported) this.attach();
  }

  private initGL(): boolean {
    const gl = this.canvas.getContext("webgl2", {
      alpha: false,
      antialias: false,
      depth: false,
      powerPreference: "high-performance",
    });
    if (!gl) return false;
    this.gl = gl;

    const vs = this.compileShader(gl.VERTEX_SHADER, VERT_SHADER);
    const fs = this.compileShader(gl.FRAGMENT_SHADER, FRAG_SHADER);
    if (!vs || !fs) return false;

    const prog = gl.createProgram();
    if (!prog) return false;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.error("Program link failed:", gl.getProgramInfoLog(prog));
      return false;
    }
    this.program = prog;

    this.uRes = gl.getUniformLocation(prog, "u_res");
    this.uTime = gl.getUniformLocation(prog, "u_time");
    this.uRot = gl.getUniformLocation(prog, "u_rot");
    this.uP = gl.getUniformLocation(prog, "u_p");
    this.uFade = gl.getUniformLocation(prog, "u_fade");

    const quad = new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]);
    const vao = gl.createVertexArray();
    const vbo = gl.createBuffer();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(prog, "a_pos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    this.vao = vao;
    this.vbo = vbo;

    this.resize();
    return true;
  }

  private compileShader(type: number, src: string): WebGLShader | null {
    const gl = this.gl;
    if (!gl) return null;
    const s = gl.createShader(type);
    if (!s) return null;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.error("Shader compile error:", gl.getShaderInfoLog(s));
      gl.deleteShader(s);
      return null;
    }
    return s;
  }

  private attach() {
    window.addEventListener("resize", this.resize);
    document.addEventListener("visibilitychange", this.onVisibility);
    this.rafId = requestAnimationFrame(this.render);
  }

  destroy() {
    this.disposed = true;
    cancelAnimationFrame(this.rafId);
    window.removeEventListener("resize", this.resize);
    document.removeEventListener("visibilitychange", this.onVisibility);
    const gl = this.gl;
    if (gl) {
      if (this.vbo) gl.deleteBuffer(this.vbo);
      if (this.vao) gl.deleteVertexArray(this.vao);
      if (this.program) gl.deleteProgram(this.program);
    }
  }

  private onVisibility = () => {
    if (document.hidden) {
      cancelAnimationFrame(this.rafId);
    } else {
      this.lastFrame = 0;
      this.rafId = requestAnimationFrame(this.render);
    }
  };

  /** 触发一次由远及近的入场（页面挂载时调用；重看可调 entranceMs） */
  startEntrance(ms = RED_GIANT_DEFAULTS.entranceMs) {
    this.entranceAt = performance.now();
    this.entranceMs = ms;
  }

  /** 整幅画面亮度 0..1（返回宇宙时淡出用） */
  setFade(v: number) {
    this.targetFade = Math.max(0, Math.min(1, v));
  }

  /** 调试用：手动绘制一帧（后台 rAF 冻结环境下做无头截图验证；生产不走这里） */
  debugDraw(p: number, t = 0, rot = 0, fade = 1) {
    const gl = this.gl;
    if (!gl || !this.program || !this.vao) return;
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.uniform2f(this.uRes, this.width, this.height);
    gl.uniform1f(this.uTime, t);
    gl.uniform1f(this.uRot, rot);
    gl.uniform1f(this.uP, p);
    gl.uniform1f(this.uFade, fade);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.flush();
  }

  private resize = () => {
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(320, rect.width || window.innerWidth);
    const h = Math.max(320, rect.height || window.innerHeight);
    const dpr = Math.min(1.25, window.devicePixelRatio || 1) * RENDER_SCALES[this.scaleIdx];
    this.width = Math.floor(w * dpr);
    this.height = Math.floor(h * dpr);
    this.canvas.width = this.width;
    this.canvas.height = this.height;
    this.gl?.viewport(0, 0, this.width, this.height);
  };

  private adaptResolution(now: number, dtMs: number) {
    if (dtMs > 0) this.frameEMA += (Math.min(dtMs, 100) - this.frameEMA) * 0.08;
    if (now - this.lastScaleChange < 2500) return;
    if (this.frameEMA > 24 && this.scaleIdx < RENDER_SCALES.length - 1) {
      this.scaleIdx++;
      this.lastScaleChange = now;
      this.resize();
    } else if (this.frameEMA < 11 && this.scaleIdx > 0 && now - this.lastScaleChange > 5000) {
      this.scaleIdx--;
      this.lastScaleChange = now;
      this.resize();
    }
  }

  private render = (now: number) => {
    if (this.disposed) return;
    const gl = this.gl;
    if (gl && this.program && this.vao) {
      const dtMs = this.lastFrame ? now - this.lastFrame : 0;
      this.lastFrame = now;
      const dt = Math.min(0.05, dtMs / 1000);
      this.adaptResolution(now, dtMs);

      const t = (now - this.startTime) * 0.001;
      const p = this.entranceMs > 0 ? Math.min(1, (now - this.entranceAt) / this.entranceMs) : 1;
      this.fade += (this.targetFade - this.fade) * 0.12;
      this.rot = (this.rot + dt * this.spinRate) % (Math.PI * 2);

      gl.useProgram(this.program);
      gl.bindVertexArray(this.vao);
      gl.uniform2f(this.uRes, this.width, this.height);
      gl.uniform1f(this.uTime, t);
      gl.uniform1f(this.uRot, this.rot);
      gl.uniform1f(this.uP, p);
      gl.uniform1f(this.uFade, this.fade);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
    this.rafId = requestAnimationFrame(this.render);
  };
}
