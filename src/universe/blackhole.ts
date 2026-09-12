/**
 * BlackholeScene —— 板块页的 WebGL2 黑洞电影引擎（无框架依赖）。
 *
 * 渲染模型：片元着色器内对每个像素做史瓦西度规下的光线测地线积分
 * （加速度 a = -1.5·h²·r/|r|⁵，rs=1），引力透镜、光子环、吸积盘上下
 * 幻影弧都是积分的自然结果。吸积盘用程序化 fbm 湍流 + 开普勒差分旋转
 * + 多普勒集束着色；蓝巨星本体与潮汐流由 preset 参数驱动，后续板块
 * （红巨星/中子星……）复用同一引擎、换预设即可做出区分。
 *
 * 交互契约：外部只管 setProgress(0..1)（原始滚动进度），引擎内部做
 * 指数平滑得到运镜；onFrame 回调把平滑进度吐给 React 覆盖层。
 */

export type Vec3 = [number, number, number];

export interface CamKey {
  /** 该关键帧对应的滚动进度 */ p: number;
  pos: Vec3;
  tgt: Vec3;
  /** tan(fov/2) */ fov: number;
}

export interface BlackholePreset {
  /** 吸积盘内缘色（炽热） */ diskInner: Vec3;
  /** 吸积盘外缘色 */ diskOuter: Vec3;
  /** 恒星表面色 */ starColor: Vec3;
  starPos: Vec3;
  starRadius: number;
  /** 相机运镜关键帧（进度单调递增） */ camKeys: CamKey[];
  exposure: number;
}

export interface BlackholeSceneOptions {
  /** 平滑后的进度，供 DOM 覆盖层同步 */ onFrame?: (progress: number) => void;
  coarse?: boolean;
}

/* ---------------- 蓝巨星预设：蓝色吸积盘 · 低角度终局特写 ---------------- */

function hexRgb(hex: string): Vec3 {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
  ];
}

export function presetFromStar(def: {
  color: string;
  core: string;
}): BlackholePreset {
  const inner = hexRgb(def.core); // 内缘蓝白炽热
  const outer = hexRgb(def.color); // 外缘深蓝（提饱和、压亮度）
  return {
    diskInner: [inner[0], inner[1], inner[2]],
    diskOuter: [outer[0] * 0.45, outer[1] * 0.6, outer[2] * 1.05],
    starColor: hexRgb(def.color),
    starPos: [-13.5, 4.0, 1.5],
    starRadius: 6.2,
    camKeys: [
      { p: 0.0, pos: [3.5, 15.0, 27.0], tgt: [0, 0.5, 0], fov: 0.62 },
      { p: 0.28, pos: [1.5, 7.5, 18.5], tgt: [0, 0.2, 0], fov: 0.58 },
      { p: 0.55, pos: [1.2, 3.2, 14.0], tgt: [-0.6, 0.4, 0], fov: 0.58 },
      { p: 1.0, pos: [1.4, 2.4, 12.8], tgt: [-0.9, 0.25, 0], fov: 0.56 },
    ],
    exposure: 1.02,
  };
}

/* ---------------- GLSL ---------------- */

const VERT = `#version 300 es
void main() {
  vec2 v = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(v * 2.0 - 1.0, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
out vec4 O;

uniform vec2  uRes;
uniform float uTime;
uniform float uProgress;
uniform vec3  uCamPos;
uniform vec3  uCamRight;
uniform vec3  uCamUp;
uniform vec3  uCamFwd;
uniform float uFovTan;
uniform vec3  uDiskInner;
uniform vec3  uDiskOuter;
uniform vec3  uStarColor;
uniform vec3  uStarPos;
uniform vec3  uStretchAxis;
uniform float uStarRadius;
uniform float uStretch;
uniform float uStream;
uniform float uSpin;
uniform float uDiskBright;
uniform float uFlash;
uniform float uStarTh;
uniform float uExposure;
uniform int   uSteps;

const float RS   = 1.0;
const float DIN  = 2.6;
const float DOUT = 11.0;

float hash12(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}
float hash13(vec3 q) {
  q = fract(q * 0.1031);
  q += dot(q, q.zyx + 31.32);
  return fract((q.x + q.y) * q.z);
}
vec3 hash33(vec3 q) {
  q = fract(q * vec3(0.1031, 0.1030, 0.0973));
  q += dot(q, q.yxz + 33.33);
  return fract((q.xxy + q.yxx) * q.zyx);
}
float noise2(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), f.x),
             mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 5; i++) {
    s += a * noise2(p);
    p = p * 2.03 + vec2(13.7, 7.1);
    a *= 0.5;
  }
  return s;
}

/* 深空：底色 + 微星云 + 两层点星（引力透镜会自动扭曲这里的采样方向） */
vec3 background(vec3 rd) {
  vec3 col = vec3(0.006, 0.008, 0.014);
  float neb = fbm(rd.xy * 2.3 + vec2(rd.z * 1.7, rd.z * -1.3));
  col += vec3(0.020, 0.032, 0.065) * neb * neb;
  col += vec3(0.012, 0.008, 0.024) * fbm(rd.zy * 1.9 - vec2(rd.x, 0.0));
  for (int L = 0; L < 2; L++) {
    float sc = L == 0 ? 34.0 : 76.0;
    vec3 id = floor(rd * sc), f = fract(rd * sc) - 0.5;
    vec3 h = hash33(id) - 0.5;
    float d = length(f - h * 0.72);
    float m = hash13(id + 9.1);
    float star = smoothstep(0.16, 0.0, d) * step(0.965, m);
    float tw = 0.75 + 0.25 * sin(uTime * (1.2 + m * 2.0) + m * 40.0);
    vec3 tint = mix(vec3(0.75, 0.83, 1.0), vec3(1.0, 0.92, 0.82), step(0.5, hash13(id + 3.3)));
    col += tint * star * tw * (L == 0 ? 0.9 : 0.45);
  }
  return col;
}

/* 蓝巨星：沿"指向黑洞"的轴做拉伸后做球测试（潮汐水滴形），直线求交即可
   （恒星离黑洞足够远时测地线弯曲量可忽略；靠近时它已被拉伸成流） */
vec3 shadeStar(vec3 ro, vec3 rd, out float tHit) {
  tHit = -1.0;
  if (uStarRadius < 0.02) return vec3(0.0);
  float k = max(uStretch, 1.0);
  vec3 oc = ro - uStarPos;
  float a0 = dot(oc, uStretchAxis);
  vec3 q0 = oc - uStretchAxis * a0 * (1.0 - 1.0 / k);
  vec3 rA = rd - uStretchAxis * dot(rd, uStretchAxis) * (1.0 - 1.0 / k);
  float A = dot(rA, rA);
  float B = 2.0 * dot(q0, rA);
  float C = dot(q0, q0) - uStarRadius * uStarRadius;
  float disc = B * B - 4.0 * A * C;
  if (disc < 0.0 || A < 1e-6) return vec3(0.0);
  float t = (-B - sqrt(disc)) / (2.0 * A);
  if (t < 0.0) return vec3(0.0);
  tHit = t;
  vec3 hit = ro + rd * t;
  vec3 oc2 = hit - uStarPos;
  float al = dot(oc2, uStretchAxis);
  vec3 n = normalize(oc2 - uStretchAxis * al * (1.0 - 1.0 / (k * k)) + vec3(1e-4));
  float lim = clamp(dot(n, -rd), 0.0, 1.0);
  float limb = 0.34 + 0.66 * pow(lim, 0.55);
  float gran = fbm(n.xy * 8.0 + n.z * 6.0 + uTime * 0.08);
  float veins = fbm(n.zy * 15.0 - n.x * 8.0 + uTime * 0.05);
  float cells = fbm(n.xz * 11.0 + uTime * 0.04);
  float pulse = 0.97 + 0.03 * sin(uTime * 1.16);
  /* 冰蓝白球体：整体高亮，gran 调制明暗形成满布纹理的发光巨物表面 */
  vec3 ice = vec3(0.74, 0.85, 1.0);
  vec3 base = uStarColor * 1.7 + ice * 0.5;
  vec3 surf = base * (0.55 + 1.05 * gran)
            + ice * pow(veins, 2.6) * 1.15
            + vec3(0.22, 0.34, 0.66) * pow(1.0 - gran, 2.0) * 0.5
            + uStarColor * cells * 0.3;
  vec3 col = surf * limb * pulse;
  col += uStarColor * pow(1.0 - lim, 2.2) * 2.1; /* 亮蓝临边辉光 */
  /* 朝向黑洞一侧的物质被剥离 → 偏亮偏白的吸积尾迹 */
  vec3 toBH = normalize(-uStarPos);
  float tail = clamp(dot(n, toBH), 0.0, 1.0);
  col += ice * pow(tail, 2.4) * (0.4 + gran) * 1.1;
  return col;
}

/* 吸积盘单次盘面穿越采样 */
vec4 diskSample(vec3 cp, vec3 dir) {
  float rr = length(cp.xz);
  float band = smoothstep(DIN, DIN + 0.55, rr) * smoothstep(DOUT, DOUT - 3.2, rr);
  if (band <= 0.0) return vec4(0.0);
  float th = atan(cp.z, cp.x);
  float om = 6.0 / (rr * sqrt(rr)) * uSpin; /* 开普勒差分旋转（随黑洞加速而提速） */
  float den = pow(fbm(vec2(rr * 1.9, (th + uTime * om) * 2.6)), 1.6) * 1.5 + 0.12;
  /* 自转拉到极高时条纹被扫成高速流带 */
  den = mix(den, fbm(vec2(rr * 1.4, uTime * 2.0)) * 0.8 + 0.3, clamp((uSpin - 2.0) / 5.5, 0.0, 1.0) * 0.5);

  /* 潮汐流：从恒星方位向内缠绕的对数螺旋臂，强度随滚动进度变化 */
  if (uStream > 0.004) {
    float spiral = uStarTh + 10.5 * log(max(rr, 2.0) / 3.4);
    float dth = atan(sin(th - spiral), cos(th - spiral));
    float arm = exp(-dth * dth * 6.0) * smoothstep(DOUT + 0.5, DIN + 0.8, rr);
    float knots = 0.5 + 1.0 * fbm(vec2(rr * 3.4 - uTime * 1.5, spiral * 2.2));
    den += arm * knots * uStream * 3.2 * band;
  }

  float temp = clamp(pow(DIN / rr, 1.35), 0.0, 1.0);
  vec3 col = mix(uDiskOuter * 1.35, uDiskInner, temp) * (0.45 + 1.5 * temp);

  /* 多普勒集束：迎面一侧更亮更冷白（指数温和，防过曝成灰） */
  float beta = sqrt(0.5 / max(rr, 1.2));
  vec3 tang = normalize(vec3(-cp.z, 0.0, cp.x));
  float dop = 1.0 + beta * 1.25 * dot(tang, -normalize(dir));
  col *= pow(clamp(dop, 0.45, 2.2), 2.3);
  col = mix(col, col * vec3(0.88, 0.95, 1.14), clamp(dop - 1.0, 0.0, 1.0));

  /* 引力红移造成的内缘衰减 */
  col *= clamp(sqrt(1.0 - 1.0 / max(rr, 1.05)), 0.0, 1.0) * 0.9 + 0.1;

  float alpha = clamp(den * band, 0.0, 1.0);
  return vec4(col * den * uDiskBright, alpha);
}

void main() {
  vec2 uv = (2.0 * gl_FragCoord.xy - uRes) / uRes.y;
  vec3 rd = normalize(uCamFwd + uFovTan * (uv.x * uCamRight + uv.y * uCamUp));
  vec3 ro = uCamPos;

  float tStar;
  vec3 starCol = shadeStar(ro, rd, tStar);

  vec3 col = vec3(0.0);
  float trans = 1.0;
  vec3 pos = ro;
  vec3 vel = rd;
  vec3 hv = cross(pos, vel);
  float h2 = dot(hv, hv);
  bool captured = false;
  bool starFront = false;
  float s = 0.0;

  for (int i = 0; i < 400; i++) {
    if (i >= uSteps) break;
    float r2 = dot(pos, pos);
    float r = sqrt(r2);
    if (r < RS) { captured = true; break; }
    if (r > 44.0 && dot(pos, vel) > 0.0) break;
    if (trans < 0.012) break;
    if (tStar > 0.0 && s > tStar) { starFront = true; break; }

    float dt = clamp(0.30 * (r - RS * 0.7), 0.035, 1.0);
    float rr0 = length(pos.xz);
    if (rr0 < DOUT + 1.5) dt = min(dt, 0.038 + abs(pos.y) * 0.5);

    vec3 acc = (-1.5 * h2 / (r2 * r2 * r)) * pos;
    vel += acc * dt;
    vec3 prev = pos;
    pos += vel * dt;
    s += dt;

    if (prev.y * pos.y < 0.0) {
      float tt = prev.y / (prev.y - pos.y);
      vec3 cp = mix(prev, pos, tt);
      float rr = length(cp.xz);
      if (rr > DIN - 0.2 && rr < DOUT + 0.5) {
        vec4 d = diskSample(cp, vel);
        col += trans * d.rgb * d.a;
        trans *= 1.0 - d.a * 0.88;
      }
    }
  }

  if (starFront) {
    col += starCol * trans;
  } else if (!captured && trans > 0.012) {
    col += trans * background(normalize(vel));
    /* 恒星日冕：未命中球体的近星光线加一层蓝色外晕（体积感） */
    if (uStarRadius > 0.02) {
      vec3 toS = uStarPos - ro;
      float proj = dot(toS, rd);
      if (proj > 0.0) {
        vec3 closest = ro + rd * proj;
        float perp = length(closest - uStarPos);
        float R = uStarRadius;
        float halo = smoothstep(R * 3.6, R * 0.96, perp);
        halo *= halo * (1.0 + uStream * 0.3); /* 被剥离得越猛，外层越亮 */
        col += trans * uStarColor * halo * 1.35;
        col += trans * vec3(0.72, 0.84, 1.0) * smoothstep(R * 1.6, R, perp) * 0.9; /* 内层浓密色雾 */
      }
    }
  }

  /* 吞噬瞬间的白光脉冲（中心加权） */
  col += uFlash * vec3(1.0, 1.0, 1.03) * exp(-dot(uv, uv) * 0.9);

  /* 曝光 → ACES → 暗角 → 微颗粒 → gamma */
  col *= uExposure;
  col = (col * (2.51 * col + 0.03)) / (col * (2.43 * col + 0.59) + 0.14);
  col *= 1.0 - 0.5 * pow(length(uv * vec2(0.72, 0.95)), 2.0);
  col += (hash12(gl_FragCoord.xy + fract(uTime) * 137.0) - 0.5) * 0.007;
  O = vec4(pow(max(col, 0.0), vec3(1.0 / 2.2)), 1.0);
}`;

/* ---------------- 引擎 ---------------- */

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const norm = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const lerpV = (a: Vec3, b: Vec3, t: number): Vec3 => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];
const ss = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export class BlackholeScene {
  static supported(): boolean {
    try {
      return !!document.createElement("canvas").getContext("webgl2");
    } catch {
      return false;
    }
  }

  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private locs = new Map<string, WebGLUniformLocation | null>();
  private raf = 0;
  private last = 0;
  private running = false;
  private destroyed = false;
  private target = 0;
  private smooth = 0;
  private time = 0;
  private px = 0;
  private py = 0;
  private spx = 0;
  private spy = 0;
  private resScale = 1;
  private emaMs = 16;
  private adaptAcc = 0;
  private onDetach: (() => void)[] = [];
  private preset: BlackholePreset;
  private onFrame?: (p: number) => void;
  private steps: number;

  constructor(
    private canvas: HTMLCanvasElement,
    preset: BlackholePreset,
    opts: BlackholeSceneOptions = {}
  ) {
    const gl = canvas.getContext("webgl2", {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: "high-performance",
    });
    if (!gl) throw new Error("webgl2 unavailable");
    this.gl = gl;
    this.preset = preset;
    this.onFrame = opts.onFrame;
    this.steps = opts.coarse ? 140 : 240;

    const compile = (type: number, src: string) => {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(sh);
        gl.deleteShader(sh);
        throw new Error("shader compile failed: " + log);
      }
      return sh;
    };
    const vs = compile(gl.VERTEX_SHADER, VERT);
    const fs = compile(gl.FRAGMENT_SHADER, FRAG);
    const program = gl.createProgram()!;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error("program link failed: " + gl.getProgramInfoLog(program));
    }
    this.program = program;
    this.vao = gl.createVertexArray()!;
    gl.useProgram(program);
    gl.bindVertexArray(this.vao);

    this.resize();
    this.attach();
    this.start();
  }

  private loc(name: string) {
    if (!this.locs.has(name)) {
      this.locs.set(name, this.gl.getUniformLocation(this.program, name));
    }
    return this.locs.get(name)!;
  }

  private attach() {
    const onWinResize = () => this.resize();
    window.addEventListener("resize", onWinResize);
    this.onDetach.push(() => window.removeEventListener("resize", onWinResize));

    const ro = new ResizeObserver(() => this.resize());
    ro.observe(this.canvas);
    this.onDetach.push(() => ro.disconnect());

    const onVis = () => (document.hidden ? this.stop() : this.start());
    document.addEventListener("visibilitychange", onVis);
    this.onDetach.push(() =>
      document.removeEventListener("visibilitychange", onVis)
    );

    const onPtr = (e: PointerEvent) => {
      const r = this.canvas.getBoundingClientRect();
      this.px = ((e.clientX - r.left) / r.width) * 2 - 1;
      this.py = ((e.clientY - r.top) / r.height) * 2 - 1;
    };
    this.canvas.addEventListener("pointermove", onPtr);
    this.onDetach.push(() =>
      this.canvas.removeEventListener("pointermove", onPtr)
    );

    const onLost = (e: Event) => {
      e.preventDefault();
      this.stop();
    };
    this.canvas.addEventListener("webglcontextlost", onLost);
    this.onDetach.push(() =>
      this.canvas.removeEventListener("webglcontextlost", onLost)
    );
  }

  setProgress(raw: number) {
    this.target = Math.min(1, Math.max(0, raw));
  }

  private resize() {
    if (this.destroyed) return;
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(1.25, window.devicePixelRatio || 1) * this.resScale;
    const w = Math.max(2, Math.round(rect.width * dpr));
    const h = Math.max(2, Math.round(rect.height * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.gl.viewport(0, 0, w, h);
  }

  private start() {
    if (this.running || this.destroyed) return;
    this.running = true;
    this.last = performance.now();
    const loop = (now: number) => {
      if (!this.running) return;
      const ms = now - this.last;
      this.last = now;
      this.tick(Math.min(ms, 100) / 1000, ms);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  private stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  private tick(dt: number, ms: number) {
    const gl = this.gl;
    this.time += dt;

    /* 滚动进度指数平滑（运镜阻尼） */
    this.smooth += (this.target - this.smooth) * (1 - Math.exp(-dt / 0.13));
    const p = this.smooth;
    this.spx += (this.px - this.spx) * (1 - Math.exp(-dt / 0.25));
    this.spy += (this.py - this.spy) * (1 - Math.exp(-dt / 0.25));

    /* 自适应分辨率：帧耗时超标就降内部分辨率 */
    this.emaMs = this.emaMs * 0.94 + ms * 0.06;
    this.adaptAcc += dt;
    if (this.adaptAcc > 1.2) {
      this.adaptAcc = 0;
      if (this.emaMs > 24 && this.resScale > 0.62) {
        this.resScale = Math.max(0.62, this.resScale * 0.82);
        this.resize();
      } else if (this.emaMs < 13 && this.resScale < 1) {
        this.resScale = Math.min(1, this.resScale * 1.12);
        this.resize();
      }
    }

    /* ---- 运镜插值 ---- */
    const keys = this.preset.camKeys;
    let k0 = keys[0];
    let k1 = keys[keys.length - 1];
    for (let i = 0; i < keys.length - 1; i++) {
      if (p >= keys[i].p && p <= keys[i + 1].p) {
        k0 = keys[i];
        k1 = keys[i + 1];
        break;
      }
    }
    const span = Math.max(k1.p - k0.p, 1e-4);
    const u = ss(0, 1, (p - k0.p) / span);
    const drift: Vec3 = [
      Math.sin(this.time * 0.11) * 0.18,
      Math.sin(this.time * 0.07) * 0.1,
      0,
    ];
    const camPos = lerpV(k0.pos, k1.pos, u);
    let tgt = lerpV(k0.tgt, k1.tgt, u);
    /* 鼠标视差：轻微转动视线 */
    tgt = [tgt[0] + this.spx * 1.2, tgt[1] - this.spy * 0.5, tgt[2]];
    const fov = k0.fov + (k1.fov - k0.fov) * u;

    const eye: Vec3 = [camPos[0] + drift[0], camPos[1] + drift[1], camPos[2]];
    const fwd = norm(sub(tgt, eye));
    const right = norm(cross(fwd, [0, 1, 0]));
    const up = cross(right, fwd);

    /* ---- 恒星状态：巨物镇场，位置与体积基本不变，只有光在"流失" ---- */
    const s0 = this.preset.starPos;
    const starPos: Vec3 = [s0[0], s0[1], s0[2]];
    const starR = this.preset.starRadius;
    const stretch = 1; /* 保持完美球体：不做潮汐水滴变形 */
    const stretchAxis = norm([-s0[0], -s0[1], -s0[2]]);

    /* ---- 黑洞自转提速 + 物质抽吸：滚动越深越狂暴 ---- */
    const spin = 1 + 6.5 * ss(0.18, 0.78, p) + 0.25 * Math.sin(this.time * 1.7);
    const diskBright =
      0.5 + 0.68 * ss(0.1, 0.55, p) - 0.34 * ss(0.72, 1.0, p) + 0.06 * Math.sin(this.time * 0.7);
    const stream = 0.3 + 2.1 * ss(0.08, 0.62, p);
    const d = (p - 0.68) / 0.05;
    const flash = 0.5 * Math.exp(-d * d); /* 吞噬高潮的能量脉冲，不抹掉恒星 */

    /* ---- uniforms ---- */
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    const L = (n: string) => this.loc(n);
    gl.uniform2f(L("uRes"), this.canvas.width, this.canvas.height);
    gl.uniform1f(L("uTime"), this.time);
    gl.uniform1f(L("uProgress"), p);
    gl.uniform3fv(L("uCamPos"), eye);
    gl.uniform3fv(L("uCamRight"), right);
    gl.uniform3fv(L("uCamUp"), up);
    gl.uniform3fv(L("uCamFwd"), fwd);
    gl.uniform1f(L("uFovTan"), fov);
    gl.uniform3fv(L("uDiskInner"), this.preset.diskInner);
    gl.uniform3fv(L("uDiskOuter"), this.preset.diskOuter);
    gl.uniform3fv(L("uStarColor"), this.preset.starColor);
    gl.uniform3fv(L("uStarPos"), starPos);
    gl.uniform3fv(L("uStretchAxis"), stretchAxis);
    gl.uniform1f(L("uStarRadius"), starR);
    gl.uniform1f(L("uStretch"), stretch);
    gl.uniform1f(L("uStream"), stream);
    gl.uniform1f(L("uSpin"), spin);
    gl.uniform1f(L("uDiskBright"), diskBright);
    gl.uniform1f(L("uFlash"), flash);
    gl.uniform1f(L("uStarTh"), Math.atan2(starPos[2], starPos[0]));
    gl.uniform1f(L("uExposure"), this.preset.exposure);
    gl.uniform1i(L("uSteps"), this.steps);

    gl.drawArrays(gl.TRIANGLES, 0, 3);

    this.onFrame?.(p);
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.stop();
    for (const off of this.onDetach) off();
    this.onDetach = [];
    this.gl.deleteProgram(this.program);
    this.gl.deleteVertexArray(this.vao);
    /* 注意：不要调用 WEBGL_lose_context.loseContext()——StrictMode 下
       同一 canvas 会被重新挂载，丢失的上下文会让二次创建永远失败。
       canvas 元素卸载后上下文由浏览器随 GC 回收。 */
  }
}
