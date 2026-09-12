/**
 * Cosmos —— 可互动的宇宙点阵引擎（canvas 2D，无框架依赖）
 *
 * 物理/视觉模型：
 *  · 点阵：一张绷紧的橡胶膜。鼠标 = 大质量黑洞，把点朝自己拖、并做径向压缩
 *    （膜被压弯），靠得越近点被压得越密，最后在事件视界边缘堆成一个亮环。
 *  · 视界：光标处一个纯黑圆盘 + 一圈微弱光环；随"捕获"进度膨胀。
 *  · 恒星：5 颗，各自脉动；靠近时潮汐拉扯变形 + 表面物质被剥成粒子流，
 *    螺旋加速、越靠近越白热，到视界边缘消失。
 *  · 捕获：黑洞周围炸开光子环光环，恒星变红变暗坍缩进视界，字幕淡入。
 *  · 吞噬：坍缩成点 → 强光闪爆 → 冲击波穿过点阵 → 点阵弹回 → 颜色朝板块过渡。
 */

import type { StarDef, StarKind } from "../data/site";

export interface CaptureInfo {
  def: StarDef;
  x: number;
  y: number;
}

export interface CosmosCallbacks {
  onCapture?: (info: CaptureInfo | null) => void;
  onSwallowStart?: (def: StarDef) => void;
  onSwallowDone?: (def: StarDef) => void;
}

interface StarRT {
  def: StarDef;
  x: number;
  y: number;
  /** 初始位置（屏幕坐标，随 resize 重算） */
  restX: number;
  restY: number;
  radius: number;
  captured: boolean;
  /** 0 → 平静，1 → 已被视界吞没 */
  captureP: number;
  phase: number;
  spin: number;
  spawnAcc: number;
  excite: number;
  visualScale: number;
  alpha: number;
  /** 下一次随机恒星活动的倒计时与当前事件 */
  nextEvent: number;
  eventT: number;
  eventDur: number;
  eventKind: StarEventKind;
  eventSeed: number;
}

type StarEventKind = "quiet" | "flare" | "windShell" | "magneticPulse" | "surfaceBloom" | "eclipse";

interface Particle {
  x: number;
  y: number;
  /** 上一帧位置 */
  px: number;
  py: number;
  /** 上上帧位置：用来画平滑的曲线拖尾 */
  ox: number;
  oy: number;
  vx: number;
  vy: number;
  heat: number;
  /** 加热速率（被剥离的"风"粒子更慢冷） */
  hgain: number;
  life: number;
  size: number;
  star: number;
  /** 统一的旋转方向：保证整条吸积流是同一个方向螺旋，不凌乱 */
  swirl: number;
}

/** 粒子被视界吞掉时留下的一点冲击闪光 */
interface Impact {
  x: number;
  y: number;
  a: number;
  r: number;
  color: RGB;
}

/**
 * 黑洞在空白处被点击时喷出的一小股物质：沿两极对喷、快速衰减，
 * 和恒星吸积流是完全独立的一套轻量粒子（不牵连星体索引）。
 */
interface Ejecta {
  x: number;
  y: number;
  px: number;
  py: number;
  ox: number;
  oy: number;
  vx: number;
  vy: number;
  life: number;
  total: number;
}

/** 恒星表面的火舌 / 日珥 / 针状体参数（各型号性格不同） */
interface FlameCfg {
  /** 火舌条数 */ tongues: number;
  /** 几条做成"日珥拱桥"（起落回到星面） */ loops: number;
  /** 火舌长度区间（单位：星半径） */ len: [number, number];
  /** 火舌粗细（单位：星半径） */ width: number;
  /** 抖动频率 */ speed: number;
  /** 针状体数量与长度 */ spicules: number;
  spLen: number;
  /** 日冕射线条数 */ rays: number;
  /** 表面颗粒对流团数量 */ gran: number;
}

const FLAMES: Record<StarKind, FlameCfg> = {
  // 蓝巨星：少而长、狂野的星风与射线
  blueGiant: { tongues: 7, loops: 2, len: [0.45, 1.15], width: 0.085, speed: 0.62, spicules: 24, spLen: 0.2, rays: 11, gran: 4 },
  // 红巨星：厚、慢、边缘融化的对流与大量短火舌
  redGiant: { tongues: 13, loops: 4, len: [0.22, 0.72], width: 0.13, speed: 0.3, spicules: 38, spLen: 0.14, rays: 9, gran: 7 },
  // 太阳：经典的火舌 + 密集针状体
  sun: { tongues: 10, loops: 3, len: [0.28, 0.8], width: 0.1, speed: 0.72, spicules: 34, spLen: 0.17, rays: 14, gran: 5 },
  // 中子星不使用恒星火舌；它由独立的磁层与双极喷流渲染
  neutronStar: { tongues: 0, loops: 0, len: [0, 0], width: 0, speed: 0, spicules: 0, spLen: 0, rays: 0, gran: 0 },
  // 双星：两颗各自带一小撮火舌
  binary: { tongues: 6, loops: 2, len: [0.18, 0.5], width: 0.075, speed: 0.85, spicules: 22, spLen: 0.12, rays: 7, gran: 3 },
};

/** 稳定伪随机：同一根火舌每一帧拿到同一个相位，不会乱闪 */
const hash1 = (n: number) => {
  const s = Math.sin(n * 127.1 + 3.7) * 43758.5453;
  return s - Math.floor(s);
};

interface Ring {
  /** 当前半径 */ r: number;
  /** 目标半径 */ r1: number;
  /** 起始半径 */ r0: number;
  t: number;
  dur: number;
  width: number;
  alpha: number;
  color: string;
  /** 是否随进度变宽、变淡 */ grow: boolean;
}

interface BGStar {
  x: number;
  y: number;
  size: number;
  alpha: number;
  phase: number;
  speed: number;
  depth: number;
  /** 远景星有极淡的温度色，避免所有背景都像同一种白噪点 */
  tone: 0 | 1 | 2;
}

/** 极少量掠过视野的微流星，保持深空不是一张静态壁纸 */
interface Drifter {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  phase: number;
  speed: number;
  length: number;
  alpha: number;
  color: RGB;
}

interface NebulaCloud {
  x: number;
  y: number;
  rx: number;
  ry: number;
  rotation: number;
  color: RGB;
  color2: RGB;
  alpha: number;
  phase: number;
  depth: number;
  /** 尘埃暗带的方向 */
  dustAngle: number;
  /** 0..1，决定薄雾与厚云核的比例 */
  thickness: number;
}

interface Comet {
  /** 三次贝塞尔轨道的四个归一化控制点 */
  path: [number, number][];
  period: number;
  phase: number;
  size: number;
  color: RGB;
  dust: RGB;
  depth: number;
}

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const easeInOutCubic = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

type RGB = [number, number, number];

/** hex → [r,g,b] */
function rgb(hex: string): RGB {
  const h = hex.replace("#", "");
  const n = parseInt(
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h,
    16
  );
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
type ColorIn = string | RGB;
const toRgb = (c: ColorIn): RGB => (typeof c === "string" ? rgb(c) : c);
/** 两色混合，t=0 取 a */
function mix(a: ColorIn, b: ColorIn, t: number): RGB {
  const A = toRgb(a);
  const B = toRgb(b);
  const k = clamp01(t);
  return [
    Math.round(lerp(A[0], B[0], k)),
    Math.round(lerp(A[1], B[1], k)),
    Math.round(lerp(A[2], B[2], k)),
  ];
}
const rgba = (c: ColorIn, a: number) => {
  const v = toRgb(c);
  return `rgba(${v[0]},${v[1]},${v[2]},${a})`;
};

/** 亮度分级（点阵渲染必须批量，否则 3000 个点会拖死帧率） */
const LEVELS = [
  { a: 0.05, c: "138,160,208" },
  { a: 0.1, c: "168,188,236" },
  { a: 0.19, c: "205,220,255" },
  { a: 0.42, c: "231,239,255" },
  { a: 0.8, c: "255,255,255" },
];

export class Cosmos {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private cb: CosmosCallbacks;
  private raf = 0;
  private last = 0;
  private time = 0;
  private dpr = 1;
  private w = 0;
  private h = 0;

  /* 点阵 */
  private dotCount = 0;
  private dotX = new Float32Array(0);
  private dotY = new Float32Array(0);
  private dotPhase = new Float32Array(0);
  private dotSpace = 26;
  private dotSize = 1.7;
  /** 视口变化时用平滑缩放而不是重建（避免 resize 抖动时点阵跳动） */
  private bg: BGStar[] = [];
  private drifters: Drifter[] = [];
  private nebulae: NebulaCloud[] = [];
  private comets: Comet[] = [];

  /* 鼠标 / 黑洞 */
  private mx = 0;
  private my = 0;
  private tx = 0;
  private ty = 0;
  private vx = 0;
  private vy = 0;
  private pointerIn = false;
  /** 点阵畸变强度 0..1（鼠标不在窗口里就慢慢归零） */
  private influence = 0;
  private influenceTarget = 0;
  /** 视界半径 */
  private horizonR = 18;
  private horizonTarget = 18;
  /** 全局漂移（让星空有纵深） */
  private driftX = 0;
  private driftY = 0;
  private driftTX = 0;
  private driftTY = 0;

  /* 星体 */
  private stars: StarRT[] = [];
  private particles: Particle[] = [];
  private impacts: Impact[] = [];
  private ejecta: Ejecta[] = [];
  private ejectCooldown = 0;
  private rings: Ring[] = [];
  private flash = 0;
  private maxCaptureP = 0;
  private lastCaptureId: string | null = null;
  private forced: { id: string; t: number } | null = null;

  /* 吞噬 / 入场 */
  private swallow: { t: number; def: StarDef; x: number; y: number } | null = null;
  private swallowLit = false;
  private swallowDone = false;
  private gridRelease = 1; // 1 = 正常，0 = 完全松开（弹回）
  private floodR = -1;
  private enter: { t: number; dur: number; mode: "intro" | "return"; color: string } = {
    t: 0,
    dur: 2.4,
    mode: "intro",
    color: "#05060c",
  };
  private disposed = false;

  constructor(canvas: HTMLCanvasElement, cb: CosmosCallbacks = {}) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("2d context unavailable");
    this.ctx = ctx;
    this.cb = cb;
    this.resize();
    this.attach();
  }

  /* ------------------------------------------------------------------ 生命周期 */

  private attach() {
    window.addEventListener("resize", this.resize);
    window.addEventListener("pointermove", this.onPointerMove, { passive: true });
    window.addEventListener("pointerdown", this.onPointerDown);
    window.addEventListener("pointerleave", this.onPointerLeave);
    window.addEventListener("blur", this.onPointerLeave);
    document.addEventListener("visibilitychange", this.onVisibility);
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  destroy() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener("resize", this.resize);
    window.removeEventListener("pointermove", this.onPointerMove);
    window.removeEventListener("pointerdown", this.onPointerDown);
    window.removeEventListener("pointerleave", this.onPointerLeave);
    window.removeEventListener("blur", this.onPointerLeave);
    document.removeEventListener("visibilitychange", this.onVisibility);
  }

  private onVisibility = () => {
    if (document.hidden) cancelAnimationFrame(this.raf);
    else {
      this.last = performance.now();
      this.raf = requestAnimationFrame(this.frame);
    }
  };

  private onPointerLeave = () => {
    this.pointerIn = false;
    this.influenceTarget = 0;
    this.releaseAll();
  };

  private releaseAll() {
    for (const s of this.stars) {
      if (s.captured) {
        s.captured = false;
        this.lastCaptureId = null;
        this.cb.onCapture?.(null);
      }
    }
    this.forced = null;
  }

  private onPointerMove = (e: PointerEvent) => {
    this.pointerIn = true;
    this.tx = e.clientX;
    this.ty = e.clientY;
    if (this.mx === 0 && this.my === 0) {
      this.mx = this.tx;
      this.my = this.ty;
    }
    this.influenceTarget = 1;
    if (this.forced) this.forced = null;
  };

  private onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return; // 只响应左键 / 触屏主指针
    const hit = this.hitTest(e.clientX, e.clientY);
    if (hit) {
      if (hit.captured || this.captureFully(hit)) this.swallowStar(hit.def.id);
      return;
    }
    // 没有选中任何恒星：黑洞本体在这片空白区域喷射一小股物质。
    this.ejectBurst();
  };

  /* ------------------------------------------------------------------ 尺寸 / 点阵 */

  private resize = () => {
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(320, rect.width || window.innerWidth);
    const h = Math.max(320, rect.height || window.innerHeight);
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = w;
    this.h = h;
    this.canvas.width = Math.floor(w * this.dpr);
    this.canvas.height = Math.floor(h * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    // 点阵间距：小屏密一点，大屏松一点，但都保持"方格纸"的均匀感
    this.dotSpace = clamp(w / 62, 20, 30);
    this.dotSize = clamp(this.dotSpace / 15, 1.1, 1.9);

    const cols = Math.ceil(w / this.dotSpace) + 1;
    const rows = Math.ceil(h / this.dotSpace) + 1;
    const padX = (cols * this.dotSpace - w) / 2;
    const padY = (rows * this.dotSpace - h) / 2;
    const n = cols * rows;
    if (n !== this.dotCount) {
      this.dotCount = n;
      this.dotX = new Float32Array(n);
      this.dotY = new Float32Array(n);
      this.dotPhase = new Float32Array(n);
    }
    let i = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++, i++) {
        this.dotX[i] = c * this.dotSpace - padX;
        this.dotY[i] = r * this.dotSpace - padY;
        // 用坐标派生伪随机，resize 后不会重新洗牌闪烁
        const s = Math.sin(c * 12.9898 + r * 78.233) * 43758.5453;
        this.dotPhase[i] = (s - Math.floor(s)) * Math.PI * 2;
      }
    }

    // 远景星尘
    const bgCount = Math.round(clamp((w * h) / 16000, 60, 190));
    this.bg = new Array(bgCount).fill(0).map(() => {
      const depth = 0.25 + Math.random() * 0.75;
      return {
        x: Math.random() * w,
        y: Math.random() * h,
        size: 0.4 + Math.random() * 1.1,
        alpha: 0.08 + Math.random() * 0.4,
        phase: Math.random() * Math.PI * 2,
        speed: 0.4 + Math.random() * 1.4,
        depth,
        tone: Math.random() > 0.82 ? (Math.random() > 0.55 ? 1 : 2) : 0,
      };
    });

    // 掠过的光只在短暂窗口内出现，给长时间停留的画面一个不重复的惊喜。
    this.drifters = [
      { x0: -0.08, y0: 0.28, x1: 0.52, y1: 0.48, phase: 0.17, speed: 0.033, length: 112, alpha: 0.34, color: [180, 208, 255] },
      { x0: 1.05, y0: 0.72, x1: 0.39, y1: 0.47, phase: 0.51, speed: 0.026, length: 92, alpha: 0.26, color: [255, 204, 156] },
      { x0: 0.18, y0: 1.06, x1: 0.56, y1: 0.46, phase: 0.81, speed: 0.021, length: 76, alpha: 0.22, color: [206, 191, 255] },
    ];

    // 星云是大尺度环境，不是装饰贴纸：每团都有薄雾、厚云核和不同视差深度。
    this.nebulae = [
      {
        x: w * 0.73,
        y: h * 0.36,
        rx: Math.max(260, w * 0.34),
        ry: Math.max(150, h * 0.24),
        rotation: -0.28,
        color: [64, 103, 190],
        color2: [133, 91, 185],
        alpha: 0.3,
        phase: 0.4,
        depth: 0.36,
        dustAngle: -0.18,
        thickness: 0.82,
      },
      {
        x: w * 0.18,
        y: h * 0.67,
        rx: Math.max(210, w * 0.27),
        ry: Math.max(140, h * 0.2),
        rotation: 0.38,
        color: [153, 58, 54],
        color2: [221, 109, 61],
        alpha: 0.26,
        phase: 2.7,
        depth: 0.24,
        dustAngle: 0.54,
        thickness: 1,
      },
      {
        x: w * 0.5,
        y: -h * 0.04,
        rx: Math.max(300, w * 0.42),
        ry: Math.max(130, h * 0.18),
        rotation: 0.05,
        color: [78, 118, 142],
        color2: [103, 119, 194],
        alpha: 0.19,
        phase: 4.8,
        depth: 0.14,
        dustAngle: 0.08,
        thickness: 0.42,
      },
    ];

    this.comets = [
      {
        path: [[-0.12, 0.16], [0.2, 0.03], [0.68, 0.48], [1.12, 0.2]],
        period: 31,
        phase: 0.08,
        size: 2.2,
        color: [204, 232, 255],
        dust: [184, 152, 116],
        depth: 0.72,
      },
      {
        path: [[1.09, 0.9], [0.83, 0.72], [0.42, 0.64], [-0.1, 0.93]],
        period: 43,
        phase: 0.57,
        size: 1.65,
        color: [181, 211, 255],
        dust: [211, 173, 129],
        depth: 0.54,
      },
    ];

    this.layoutStars();
  };

  private layoutStars() {
    const defs = this.starDefs;
    if (!this.stars.length) {
      this.stars = defs.map((def, i) => ({
        def,
        x: 0,
        y: 0,
        restX: 0,
        restY: 0,
        radius: 20,
        captured: false,
        captureP: 0,
        phase: (i / defs.length) * Math.PI * 2,
        spin: i % 2 === 0 ? 1 : -1,
        spawnAcc: 0,
        excite: 0,
        visualScale: 1,
        alpha: 1,
        nextEvent: 3.5 + hash1(i * 19.7 + 2.3) * 8,
        eventT: 0,
        eventDur: 1,
        eventKind: "quiet",
        eventSeed: hash1(i * 31.9 + 7.1),
      }));
    }
    const scale = clamp(Math.min(this.w / 1440, this.h / 900), 0.62, 1.25);
    const narrow = this.w < 760;
    for (const s of this.stars) {
      s.radius = s.def.radius * scale * (narrow ? 0.82 : 1);
      // 窄屏把恒星稍微往中间收，避免贴边
      const nx = narrow ? 0.5 + (s.def.x - 0.5) * 0.78 : s.def.x;
      const ny = s.def.y;
      s.restX = clamp(nx * this.w, s.def.radius * 2 + 16, this.w - s.def.radius * 2 - 16);
      s.restY = clamp(ny * this.h, s.def.radius * 2 + 16, this.h - s.def.radius * 2 - 16);
      if (s.captureP < 0.02) {
        s.x = s.restX;
        s.y = s.restY;
      }
    }
    if (!this.w) return;
    // 初始黑洞落在文字块右侧的空白处（不会在名字上糊一个黑点）
    if (!this.mx && !this.my) {
      this.mx = this.tx = this.w * 0.66;
      this.my = this.ty = this.h * 0.56;
    }
  }

  /** 由外部传入（保持与 site.ts 同源，避免循环依赖） */
  private get starDefs(): StarDef[] {
    return this.defsRef ?? [];
  }
  private defsRef: StarDef[] = [];

  setStarDefs(defs: StarDef[]) {
    this.defsRef = defs;
    this.stars = [];
    this.layoutStars();
  }

  /* ------------------------------------------------------------------ 交互 */

  /** 入场：intro = 首次打开；return = 从板块页返回 */
  setEnter(mode: "intro" | "return", color = "#05060c") {
    this.enter = { t: 0, dur: mode === "intro" ? 2.6 : 1.5, mode, color };
    this.mx = this.tx = this.mx || this.w * 0.66;
    this.my = this.ty = this.my || this.h * 0.56;
    this.particles.length = 0;
    this.rings.length = 0;
    this.impacts.length = 0;
    this.ejecta.length = 0;
    this.ejectCooldown = 0;
    this.flash = 0;
    this.swallow = null;
    this.swallowLit = false;
    this.swallowDone = false;
    this.floodR = -1;
    this.gridRelease = 1;
    this.influence = 0;
    this.influenceTarget = this.pointerIn ? 1 : 0.75;
  }

  /** 导航点恒星名：字幕直接点亮 → 吞噬 → 进入板块 */
  enterStar(id: string) {
    const s = this.stars.find((v) => v.def.id === id);
    if (!s || this.swallow) return;
    this.influenceTarget = 1;
    this.tx = s.restX;
    this.ty = s.restY;
    this.forced = { id, t: 0 };
  }

  /** 鼠标悬停导航项时给对应恒星一点"兴奋" */
  hintStar(id: string | null) {
    for (const s of this.stars) {
      if (id && s.def.id === id) s.excite = 1;
    }
  }

  private hitTest(x: number, y: number): StarRT | null {
    let best: StarRT | null = null;
    let bestD = Infinity;
    for (const s of this.stars) {
      if (s.captureP > 0.9) continue;
      const d = Math.hypot(x - s.x, y - s.y);
      const r = Math.max(s.radius * 2.4 * (1 + s.captureP), 30);
      if (d < r && d < bestD) {
        bestD = d;
        best = s;
      }
    }
    return best;
  }

  private captureFully(s: StarRT) {
    return s.captureP > 0.5;
  }

  private swallowStar(id: string) {
    const s = this.stars.find((v) => v.def.id === id);
    if (!s || this.swallow) return;
    // 被吞的那一刻，其他恒星的"活跃"状态一并平静下来
    for (const other of this.stars) {
      if (other !== s && other.captured) other.captured = false;
    }
    this.swallow = { t: 0, def: s.def, x: this.mx, y: this.my };
    this.swallowLit = false;
    this.swallowDone = false;
    this.floodR = -1;
    this.impacts.length = 0;
    this.cb.onSwallowStart?.(s.def);
  }

  /** 从黑洞位置到四个角的最远距离：颜色铺满整屏所需的半径 */
  private coverRadius() {
    const { w, h } = this;
    return (
      Math.max(
        Math.hypot(this.mx, this.my),
        Math.hypot(w - this.mx, this.my),
        Math.hypot(this.mx, h - this.my),
        Math.hypot(w - this.mx, h - this.my)
      ) * 1.04
    );
  }

  /** React 侧（字幕）点击也能触发 */
  clickStar(id: string) {
    this.swallowStar(id);
  }

  /**
   * 空白处按左键：黑洞对喷一小股物质。
   * 方向跟随最近的移动速度（正在划过时喷流会顺着划动方向甩出）；
   * 静止点击则用当次点击的随机轴，保证原地连点也不会永远同一个方向。
   */
  private ejectBurst() {
    if (this.swallow || this.influence < 0.3 || this.ejectCooldown > 0) return;
    this.ejectCooldown = 0.24;

    const speed = Math.hypot(this.vx, this.vy);
    const axis = speed > 14 ? Math.atan2(this.vy, this.vx) + Math.PI / 2 : Math.random() * Math.PI * 2;
    const perCone = 8;
    for (const side of [1, -1]) {
      const dir = axis + (side > 0 ? 0 : Math.PI);
      for (let i = 0; i < perCone; i++) {
        const spread = (Math.random() - 0.5) * 0.6;
        const a = dir + spread;
        const speedOut = 150 + Math.random() * 190;
        const r0 = this.horizonR + 1.5;
        const x = this.mx + Math.cos(a) * r0;
        const y = this.my + Math.sin(a) * r0;
        this.ejecta.push({
          x,
          y,
          px: x,
          py: y,
          ox: x,
          oy: y,
          vx: Math.cos(a) * speedOut,
          vy: Math.sin(a) * speedOut,
          life: 0.55 + Math.random() * 0.35,
          total: 0.9,
        });
      }
      // 视界边缘一点点被"顶开"的反冲闪光，复用既有的撞击特效而不新造一层。
      if (this.impacts.length < 26) {
        this.impacts.push({
          x: this.mx + Math.cos(axis + (side > 0 ? 0 : Math.PI)) * this.horizonR,
          y: this.my + Math.sin(axis + (side > 0 ? 0 : Math.PI)) * this.horizonR,
          a: 1,
          r: 5 + this.horizonR * 0.3,
          color: [200, 224, 255],
        });
      }
    }
    if (this.ejecta.length > 260) this.ejecta.splice(0, this.ejecta.length - 260);
  }

  /** 字幕锚点：把恒星静止位置夹到安全区内，窄屏也不会被切掉 */
  private anchor(s: StarRT) {
    const mx = Math.min(170, this.w * 0.34);
    const my = Math.min(96, this.h * 0.2);
    return {
      def: s.def,
      x: clamp(s.restX, mx, Math.max(this.w - mx, mx + 10)),
      y: clamp(s.restY, my, Math.max(this.h - my, my + 10)),
    };
  }

  /* ------------------------------------------------------------------ 主循环 */

  private frame = (now: number) => {
    if (this.disposed) return;
    const dt = clamp((now - this.last) / 1000, 0, 1 / 20);
    this.last = now;
    this.time += dt;
    this.update(dt);
    this.render();
    this.raf = requestAnimationFrame(this.frame);
  };

  private update(dt: number) {
    const t = this.time;

    /* 入场 */
    if (this.enter.t < this.enter.dur) this.enter.t += dt;
    const enterK = clamp01(this.enter.t / this.enter.dur);

    /* 指针 → 黑洞：慢半拍、有重量感 */
    const k = 1 - Math.exp(-dt / 0.115);
    const prevX = this.mx;
    const prevY = this.my;
    this.mx += (this.tx - this.mx) * k;
    this.my += (this.ty - this.my) * k;
    this.vx = this.vx * 0.86 + ((this.mx - prevX) / Math.max(dt, 1e-3)) * 0.14;
    this.vy = this.vy * 0.86 + ((this.my - prevY) / Math.max(dt, 1e-3)) * 0.14;

    /* 畸变强度（吞噬时先归零再弹回） */
    const inflTarget = this.swallow ? 0 : this.influenceTarget * enterK;
    this.influence += (inflTarget - this.influence) * (1 - Math.exp(-dt / 0.22));

    /* 最大捕获进度 */
    this.maxCaptureP = Math.max(
      0,
      ...this.stars.map((s) => s.captureP)
    );

    /* 视界半径：捕获时膨胀 */
    const wantR = this.swallow ? 8 : 17 * clamp(this.influence * 1.15, 0, 1) + 30 * this.maxCaptureP;
    this.horizonTarget = wantR;
    this.horizonR += (this.horizonTarget - this.horizonR) * (1 - Math.exp(-dt / 0.16));

    /* 星空缓慢漂移（纵深） */
    const cx = this.w / 2;
    const cy = this.h / 2;
    this.driftTX = -(this.mx - cx) * 0.022 + Math.sin(t * 0.05) * 8;
    this.driftTY = -(this.my - cy) * 0.022 + Math.cos(t * 0.043) * 6;
    this.driftX += (this.driftTX - this.driftX) * (1 - Math.exp(-dt / 1.1));
    this.driftY += (this.driftTY - this.driftY) * (1 - Math.exp(-dt / 1.1));

    /* 星云不再参与任何黑洞交互：它是远景，位置只由自身极慢的呼吸漂移决定。 */

    /* 恒星状态机 */
    for (const s of this.stars) {
      s.excite = Math.max(0, s.excite - dt * 0.9);
      // 恒星不是机械循环：每颗星按自己的类型，隔一段随机时间发生一次短暂活动。
      if (s.eventKind === "quiet") {
        s.nextEvent -= dt;
        if (s.nextEvent <= 0 && !this.swallow) this.beginStarEvent(s);
      } else {
        s.eventT += dt;
        if (s.eventT >= s.eventDur) {
          s.eventKind = "quiet";
          s.eventT = 0;
          s.eventSeed = hash1(s.eventSeed * 97.3 + this.time * 0.17 + this.stars.indexOf(s));
          s.nextEvent = 5.5 + s.eventSeed * 10.5;
        }
      }
      const dx = this.mx - s.x;
      const dy = this.my - s.y;
      // 判定用"静止位置"，否则恒星一旦被拉近光标就再也松不开了
      const rdx = this.mx - s.restX;
      const rdy = this.my - s.restY;
      const rd = Math.hypot(rdx, rdy);
      const lureR = Math.max(s.radius * s.def.lure, 90);
      const proximity = clamp01(1 - rd / lureR);

      if (this.swallow?.def.id === s.def.id) {
        // 正在被吞：交给吞噬时序
      } else {
        if (!s.captured && this.influence > 0.35 && rd < lureR * 0.46) {
          s.captured = true;
          this.lastCaptureId = s.def.id;
          this.canvas.style.cursor = "pointer";
          this.cb.onCapture?.(this.anchor(s));
          this.expandRing(s.radius * 3.4);
        }
        if (s.captured && (rd > lureR * 0.78 || this.influence < 0.2)) {
          s.captured = false;
          if (this.lastCaptureId === s.def.id) {
            this.lastCaptureId = null;
            this.canvas.style.cursor = "";
          }
          this.cb.onCapture?.(null);
        }
      }

      const want = s.captured ? 1 : 0;
      const tc = want > s.captureP ? 0.34 : 0.5;
      s.captureP += (want - s.captureP) * (1 - Math.exp(-dt / tc));

      // 被吸进视界：位置朝黑洞滑落 + 越来越小
      const pull = s.captureP * s.captureP;
      const targetX = lerp(s.restX, this.mx, pull * 0.94);
      const targetY = lerp(s.restY, this.my, pull * 0.94);
      s.x += (targetX - s.x) * (1 - Math.exp(-dt / 0.24));
      s.y += (targetY - s.y) * (1 - Math.exp(-dt / 0.24));
      s.visualScale = clamp(1 - pull * 0.94, 0.05, 1.1);
      s.alpha = clamp(1 - pull * 1.06, 0, 1);

      // 表面物质被剥落：主体是朝黑洞的束流，另有一小撮很淡的星风
      // 物质流要靠"密度"读成一条丝滑的流，而不是靠亮度。
      // 少而亮 = 一串刺眼的白色短划；多而淡 = 真正的吸积流。
      const streamRate = Math.pow(proximity, 1.6) * 260 * this.influence + s.captureP * 210 + s.excite * 30;
      const windRate = Math.pow(proximity, 2.2) * 46 * this.influence;
      if (this.influence > 0.3 && !this.swallow) {
        s.spawnAcc += (streamRate + windRate) * dt;
        const count = Math.min(14, Math.floor(s.spawnAcc));
        s.spawnAcc -= count;
        for (let i = 0; i < count && this.particles.length < 1500; i++) {
          const stream = Math.random() * (streamRate + windRate) < streamRate;
          this.spawnParticle(s, dx, dy, rd, proximity, stream);
        }
      }
    }

    /* 强制入场（导航点击） */
    if (this.forced) {
      this.forced.t += dt;
      const s = this.stars.find((v) => v.def.id === this.forced!.id);
      if (s) {
        s.captured = true;
        if (!this.lastCaptureId) {
          this.lastCaptureId = s.def.id;
          this.cb.onCapture?.(this.anchor(s));
        }
        if (s.captureP > 0.94 || this.forced.t > 1.5) {
          this.swallowStar(s.def.id);
          this.forced = null;
        }
      } else this.forced = null;
    }

    /* 粒子积分：引力 + 螺旋拖曳 + 加热 */
    const gx = this.mx;
    const gy = this.my;
    const hR = this.horizonR;
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      const dx = gx - p.x;
      const dy = gy - p.y;
      const d2 = dx * dx + dy * dy + 260;
      const d = Math.sqrt(d2);
      const nx = dx / d;
      const ny = dy / d;
      // GM 取"在 200px 处为轨道速度"的量级，越靠近视界加速度越夸张
      const grab = 4500000 / d2;
      p.vx += nx * grab * dt;
      p.vy += ny * grab * dt;
      // 切向加速 → 螺旋吸积流（像水流进下水道）
      const spin = grab * 0.55 * p.swirl;
      p.vx += -ny * spin * dt;
      p.vy += nx * spin * dt;
      // 一点点粘滞，让轨迹更"顺"
      const drag = 1 - Math.min(0.35, 0.9 / (1 + d / 120)) * dt;
      p.vx *= drag;
      p.vy *= drag;
      p.ox = p.px;
      p.oy = p.py;
      p.px = p.x;
      p.py = p.y;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
      // 热度必须是"趋向目标值"而不是单调累加：否则飘到空场里的老粒子
      // 也会烧成白热，在深空中留下一串刺眼的白色碎线。
      const heatTarget = clamp01(1.25 / (1 + (d / 145) * (d / 145)));
      p.heat += (heatTarget - p.heat) * (1 - Math.exp(-dt * p.hgain * 2.6));
      if (d < hR * 0.96) {
        // 掉进视界：留一点撞击闪光，而不是无声消失
        if (this.impacts.length < 26 && hR > 6) this.impacts.push({
          x: gx - nx * hR,
          y: gy - ny * hR,
          a: 1,
          r: 3 + Math.random() * 4 + hR * 0.16,
          color: mix(this.stars[p.star]?.def.color ?? "#ffffff", "#ffffff", 0.62),
        });
        this.particles.splice(i, 1);
      } else if (p.life <= 0 || p.x < -60 || p.y < -60 || p.x > this.w + 60 || p.y > this.h + 60) {
        this.particles.splice(i, 1);
      }
    }

    /* 视界撞击闪光：快速淡出 */
    for (let i = this.impacts.length - 1; i >= 0; i--) {
      const im = this.impacts[i];
      im.a -= dt * 3.6;
      im.r += dt * 26;
      if (im.a <= 0) this.impacts.splice(i, 1);
    }

    /* 喷射物质：快速外抛、迅速减速衰减，不受黑洞引力回拉（它已经"喷出去"了） */
    this.ejectCooldown = Math.max(0, this.ejectCooldown - dt);
    for (let i = this.ejecta.length - 1; i >= 0; i--) {
      const p = this.ejecta[i];
      const drag = 1 - Math.min(0.85, 2.4 * dt);
      p.vx *= drag;
      p.vy *= drag;
      p.ox = p.px;
      p.oy = p.py;
      p.px = p.x;
      p.py = p.y;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
      if (p.life <= 0) this.ejecta.splice(i, 1);
    }

    /* 环 / 闪光 / 吞噬时序 */
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.t += dt;
      const k = clamp01(r.t / r.dur);
      r.r = lerp(r.r0, r.r1, easeOutCubic(k));
      if (r.grow) r.width = lerp(r.width, r.width * 1.9, dt * 1.6);
      if (k >= 1) this.rings.splice(i, 1);
    }
    this.flash = Math.max(0, this.flash - dt * 2.6);

    if (this.swallow) {
      const st = this.swallow;
      st.t += dt * 1000;
      // 点阵先"啪"地弹回原形
      this.gridRelease = st.t < 150 ? 1 - st.t / 150 : clamp01((st.t - 150) / 170);
      if (st.t > 120 && !this.swallowLit) {
        this.swallowLit = true;
        this.flash = 1;
      }
      if (st.t > 430 && this.floodR < 0) this.floodR = 40;
      if (this.floodR >= 0) {
        const cover = this.coverRadius();
        const fk = clamp01((st.t - 430) / 390);
        this.floodR = lerp(40, cover, easeInOutCubic(fk));
        // 颜色已经铺满整屏 → 此刻才通知 React 换页，绝不会看到硬切
        if (fk >= 1 && !this.swallowDone) {
          this.swallowDone = true;
          this.floodR = cover * 1.05;
          this.cb.onSwallowDone?.(st.def);
        }
      }
      if (st.t > 1600) this.swallow = null;
    }
  }

  private beginStarEvent(s: StarRT) {
    const r = hash1(s.eventSeed * 83.7 + this.time * 0.11 + this.stars.indexOf(s) * 7.9);
    if (s.def.kind === "blueGiant") s.eventKind = r > 0.38 ? "windShell" : "flare";
    if (s.def.kind === "redGiant") s.eventKind = r > 0.3 ? "surfaceBloom" : "flare";
    if (s.def.kind === "sun") s.eventKind = r > 0.46 ? "flare" : "windShell";
    if (s.def.kind === "neutronStar") s.eventKind = "magneticPulse";
    if (s.def.kind === "binary") s.eventKind = r > 0.34 ? "eclipse" : "flare";
    s.eventT = 0;
    s.eventDur =
      s.eventKind === "windShell" ? 3.8 + r * 1.8 :
      s.eventKind === "surfaceBloom" ? 3.2 + r * 2 :
      s.eventKind === "eclipse" ? 3.6 :
      1.8 + r * 1.4;
    s.eventSeed = r;
  }

  /**
   * 生成一个被剥离的粒子。
   * stream = true：朝黑洞方向的束流（主体，保证"水流进下水道"的干净观感）
   * stream = false：从星面朝外飘散的星风（少量、很淡，只给星体加一层绒毛感）
   */
  private spawnParticle(s: StarRT, dx: number, dy: number, _d: number, proximity: number, stream: boolean) {
    const toBH = Math.atan2(dy, dx);
    // 束流从"面向黑洞的那半边"被剥离，星风则绕整圈
    const spread = stream ? 0.5 : Math.PI / 2;
    const a = toBH + (stream ? 1 : 0) * (Math.random() - 0.5) * 2 * spread + (stream ? 0 : Math.random() * Math.PI * 2);
    const sr = s.radius * (stream ? 0.82 + Math.random() * 0.22 : 0.95 + Math.random() * 0.2);
    const lift = sr + s.radius * 0.05;
    const x = s.x + Math.cos(a) * lift;
    const y = s.y + Math.sin(a) * lift;
    // 统一方向：所有粒子同向旋转 → 形成一条清楚的螺旋吸积流
    const sw = s.spin;
    const tangent = sw * (stream ? 34 + 120 * proximity : 22);
    const outward = stream ? 26 + 90 * proximity : 26 + 40 * proximity;
    const vx = -Math.sin(a) * tangent + Math.cos(a) * outward;
    const vy = Math.cos(a) * tangent + Math.sin(a) * outward;
    const dt0 = 0.055; // 出生时先往前挪一点点，避免"啪"地出现
    this.particles.push({
      x: x + vx * dt0,
      y: y + vy * dt0,
      px: x + vx * dt0 * 0.5,
      py: y + vy * dt0 * 0.5,
      ox: x,
      oy: y,
      vx,
      vy,
      heat: clamp01(0.08 + 0.22 * proximity + (stream ? 0.06 : 0)),
      hgain: stream ? 1 : 0.55,
      life: stream ? 1.8 + Math.random() * 1.7 : 1.3 + Math.random() * 1.4,
      size: 0.7 + Math.random() * 1.1,
      star: this.stars.indexOf(s),
      swirl: sw,
    });
  }

  /** 环心固定跟在黑洞上（点被吸进来那一下的涟漪） */
  private expandRing(r0: number) {
    this.rings.push({
      r: r0,
      r0,
      r1: r0 * 24,
      t: 0,
      dur: 1.5,
      width: 2,
      alpha: 0.5,
      color: "180,210,255",
      grow: true,
    });
  }

  /* ------------------------------------------------------------------ 渲染 */

  private render() {
    const ctx = this.ctx;
    const { w, h } = this;
    const t = this.time;

    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "#030304";
    ctx.fillRect(0, 0, w, h);

    this.drawBackdrop(t);
    this.drawDrifters(t);
    // 星云在远景星尘之后绘制，厚云核和暗分子云才能真实遮住后方星光。
    this.drawNebula(t);
    this.drawGridDots(t);
    this.drawLensingArcs(t);
    this.drawComets(t);
    this.drawRibbons();
    for (const s of this.stars) if (s.alpha > 0.02) this.drawStar(s, t);
    this.drawParticles();
    this.drawEjecta();
    this.drawImpacts();
    this.drawHorizon(t);
    this.drawRings();
    this.drawOverlays();

    if (this.swallow) {
      // 整颗恒星坍缩成一个点：半径被吸走、亮度升到白热
      const k = clamp01(this.swallow.t / 180);
      if (k < 1) {
        const r = Math.pow(1 - k, 1.7) * 26 + 1.1;
        const a = 0.5 + 0.5 * k;
        const c = mix(this.swallow.def.color, "#ffffff", 0.7);
        const g = ctx.createRadialGradient(this.mx, this.my, 0, this.mx, this.my, r * 3.2);
        g.addColorStop(0, rgba("#ffffff", Math.min(1, a)));
        g.addColorStop(0.28, rgba(c, a * 0.8));
        g.addColorStop(1, rgba(c, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(this.mx, this.my, r * 3.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  private drawNebula(t: number) {
    const ctx = this.ctx;
    const enterK = clamp01((this.enter.t - 0.12) / 1.6);
    if (enterK <= 0) return;

    for (let ni = 0; ni < this.nebulae.length; ni++) {
      const n = this.nebulae[ni];
      // 星云是纯远景：不吃黑洞引力，也不吃鼠标视差。
      // 位置只由自身极慢的呼吸漂移决定，所以黑洞划过时它完全静止。
      const rawX = n.x + Math.sin(t * 0.035 + n.phase) * 10;
      const rawY = n.y + Math.cos(t * 0.031 + n.phase) * 7;
      const cloudA = n.alpha * enterK;

      const cr = Math.cos(n.rotation);
      const sr = Math.sin(n.rotation);

      // 最远的一层只有一块大而薄的色雾，负责建立星云边界，不产生任何轮廓线。
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.translate(rawX, rawY);
      ctx.rotate(n.rotation);
      ctx.scale(n.rx, n.ry);
      const veil = ctx.createRadialGradient(-0.08, 0.02, 0, 0, 0, 1);
      veil.addColorStop(0, rgba(mix(n.color, n.color2, 0.42), cloudA * 0.16));
      veil.addColorStop(0.48, rgba(n.color, cloudA * 0.075));
      veil.addColorStop(1, rgba(n.color, 0));
      ctx.fillStyle = veil;
      ctx.beginPath();
      ctx.arc(0, 0, 1, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // 薄雾 / 中层 / 厚云核。每块云的中心独立经过透镜计算，靠近黑洞的
      // 云团会被径向拉长；潮汐爆发时则被推离空腔，形成真正的气体炸散。
      const layers = [
        { count: 7, spread: 0.92, size: 0.31, alpha: 0.09, dense: 0 },
        { count: 9, spread: 0.7, size: 0.22, alpha: 0.15, dense: 0.45 },
        { count: 7, spread: 0.5, size: 0.14, alpha: 0.21, dense: 1 },
      ];
      for (let li = 0; li < layers.length; li++) {
        const layer = layers[li];
        for (let i = 0; i < layer.count; i++) {
          const seed = ni * 173.1 + li * 47.7 + i * 11.9;
          const h1 = hash1(seed);
          const h2 = hash1(seed + 8.3);
          const h3 = hash1(seed + 19.7);
          const a = h1 * Math.PI * 2 + Math.sin(t * (0.012 + h3 * 0.012) + seed) * 0.025;
          const rr = Math.sqrt(h2) * layer.spread;
          const lx = Math.cos(a) * n.rx * rr;
          const ly = Math.sin(a) * n.ry * rr * (0.72 + h3 * 0.2);
          const wx = rawX + lx * cr - ly * sr;
          const wy = rawY + lx * sr + ly * cr;

          // 真实恒星会照亮附近气体：颜色只在云团内部反射，不额外增加新元素。
          // 这是星云唯一的"活"来源，且只跟恒星位置有关，与黑洞无关。
          let starLight = 0;
          let starColor: ColorIn = n.color2;
          for (const st of this.stars) {
            const sd = Math.hypot(st.x - wx, st.y - wy);
            const light = Math.exp(-Math.pow(sd / Math.max(76, st.radius * 2.85), 2)) * st.alpha;
            if (light > starLight) {
              starLight = light;
              starColor = st.def.color;
            }
          }
          const baseColor = mix(n.color, n.color2, h3);
          const color = mix(baseColor, starColor, clamp01(starLight * 0.32));
          const br = Math.max(26, Math.min(n.rx, n.ry) * layer.size * (0.72 + h2 * 0.72));
          const thick = lerp(0.65, 1.15, n.thickness * layer.dense);
          const alpha = cloudA * layer.alpha * thick * (0.75 + h3 * 0.55) *
            (1 + starLight * 0.45);

          ctx.save();
          ctx.globalCompositeOperation = "lighter";
          ctx.translate(wx, wy);
          const g = ctx.createRadialGradient(-br * 0.12, 0, 0, 0, 0, br);
          g.addColorStop(0, rgba(color, alpha));
          g.addColorStop(0.38, rgba(color, alpha * 0.58));
          g.addColorStop(0.76, rgba(color, alpha * 0.14));
          g.addColorStop(1, rgba(color, 0));
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(0, 0, br, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      }

      // 厚云不是一条横穿画面的暗带，而是几块互相咬合的分子云核。
      // 顶部薄云 thickness 较低，因此几乎没有遮挡；红色厚云则有明显黑色层次。
      for (let i = 0; i < 5; i++) {
        const seed = ni * 89.3 + i * 21.7;
        const h1 = hash1(seed);
        const h2 = hash1(seed + 6.4);
        const a = h1 * Math.PI * 2;
        const lx = Math.cos(a) * n.rx * (0.08 + h2 * 0.43);
        const ly = Math.sin(a) * n.ry * (0.06 + h2 * 0.31);
        const wx = rawX + lx * cr - ly * sr;
        const wy = rawY + lx * sr + ly * cr;
        const radius = Math.min(n.rx, n.ry) * (0.16 + h1 * 0.18);
        ctx.save();
        ctx.translate(wx, wy);
        ctx.rotate(n.rotation + n.dustAngle + (h2 - 0.5) * 0.7);
        ctx.scale(1.35 + h1 * 0.65, 0.72 + h2 * 0.36);
        const dust = ctx.createRadialGradient(0, 0, 0, 0, 0, radius);
        const dustA = enterK * n.thickness * (0.18 + h2 * 0.18);
        dust.addColorStop(0, `rgba(2,2,5,${dustA})`);
        dust.addColorStop(0.48, `rgba(2,2,5,${dustA * 0.55})`);
        dust.addColorStop(0.82, `rgba(2,2,5,${dustA * 0.12})`);
        dust.addColorStop(1, "rgba(2,2,5,0)");
        ctx.fillStyle = dust;
        ctx.beginPath();
        ctx.arc(0, 0, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // 星形成区不再是方形亮点，而是埋在气体里的柔光核。
      for (let i = 0; i < 8; i++) {
        const h1 = hash1(ni * 113.7 + i * 17.1);
        const h2 = hash1(ni * 43.9 + i * 8.3);
        const rr = Math.sqrt(h1) * 0.68;
        const a = h2 * Math.PI * 2;
        const lx = Math.cos(a) * n.rx * rr;
        const ly = Math.sin(a) * n.ry * rr * 0.66;
        const wx = rawX + lx * cr - ly * sr;
        const wy = rawY + lx * sr + ly * cr;
        const radius = 3.5 + h1 * 7;
        const glow = ctx.createRadialGradient(wx, wy, 0, wx, wy, radius);
        glow.addColorStop(0, rgba(mix(n.color2, "#ffffff", 0.82), cloudA * 0.82));
        glow.addColorStop(0.16, rgba(mix(n.color, "#ffffff", 0.5), cloudA * 0.28));
        glow.addColorStop(1, rgba(n.color, 0));
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(wx, wy, radius, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  private drawBackdrop(t: number) {
    const ctx = this.ctx;
    const enterK = clamp01((this.enter.t - 0.2) / 1.6);
    const colors = ["214,228,255", "174,199,255", "255,216,182"];
    for (const b of this.bg) {
      const ox = this.driftX * (0.3 + b.depth * 0.9);
      const oy = this.driftY * (0.3 + b.depth * 0.9);
      const a = b.alpha * (0.55 + 0.45 * Math.sin(t * b.speed + b.phase)) * enterK;
      if (a <= 0.01) continue;
      ctx.fillStyle = `rgba(${colors[b.tone]},${a})`;
      ctx.fillRect(b.x + ox, b.y + oy, b.size, b.size);
    }
  }

  /**
   * 偶尔掠过视野的流星：极稀疏、短暂、亮度很低，属于安静的背景点缀。
   * 它是自身在飞，不响应黑洞（真实流星距离黑洞极远，不该被引力弯折）。
   */
  private drawDrifters(t: number) {
    const ctx = this.ctx;
    const enterK = clamp01((this.enter.t - 0.75) / 1.35);
    if (enterK <= 0) return;

    ctx.globalCompositeOperation = "source-over";
    ctx.lineCap = "round";
    for (const d of this.drifters) {
      const p = (t * d.speed + d.phase) % 1;
      if (p > 0.16) continue;
      const k = p / 0.16;
      const fade = Math.sin(k * Math.PI);
      const x0 = d.x0 * this.w + this.driftX * 0.5;
      const y0 = d.y0 * this.h + this.driftY * 0.5;
      const x1 = d.x1 * this.w + this.driftX * 0.5;
      const y1 = d.y1 * this.h + this.driftY * 0.5;
      const x = lerp(x0, x1, easeOutCubic(k));
      const y = lerp(y0, y1, easeOutCubic(k));
      const dx = x1 - x0;
      const dy = y1 - y0;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len;
      const uy = dy / len;
      const g = ctx.createLinearGradient(x - ux * d.length, y - uy * d.length, x, y);
      g.addColorStop(0, rgba(d.color, 0));
      g.addColorStop(0.72, rgba(d.color, d.alpha * fade * 0.35));
      g.addColorStop(1, rgba([255, 255, 255], d.alpha * fade));
      ctx.strokeStyle = g;
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(x - ux * d.length, y - uy * d.length);
      ctx.lineTo(x, y);
      ctx.stroke();
    }
    ctx.lineCap = "butt";
  }

  /**
   * 引力偏折（只用于彗星）。
   *
   * 物理约束：黑洞只是把从它身边掠过的轨迹"掰弯"一个有限角度，
   * 绝不会把物体吸进去，更不会把它翻到另一侧。所以偏折量必须是
   * 归一化的位移比例，并且有硬上限：
   *
   *   pull = k · (R² / (d² + R²))²   ∈ (0, k]，k ≤ 0.34
   *
   * pull 永远小于 1，因此 x' = x + (bh − x)·pull 只在原位置与黑洞之间
   * 移动，几何不会自交也不会翻转。按每个采样点**自身**距离衰减，
   * 位移量近似 ∝ 1/d³，所以只有贴近黑洞的那一小段尾巴被掰弯，
   * 400px 之外几乎完全不受影响（不再是"影响很大范围"）。
   */
  private cometBend(x: number, y: number, k: number) {
    const dx = this.mx - x;
    const dy = this.my - y;
    const reach = 160;
    const rr = reach * reach;
    const strength = Math.min(0.34, 0.34 * k) * clamp01(this.influence);
    const f = rr / (dx * dx + dy * dy + rr);
    const pull = strength * f * f;
    return { x: x + dx * pull, y: y + dy * pull };
  }

  /**
   * 引力透镜的可见痕迹：远景光被黑洞剪成两道很细的弧。
   * 这层不抢事件视界的戏，但会让鼠标移动时的空间畸变更可信。
   */
  private drawLensingArcs(t: number) {
    const ctx = this.ctx;
    const k = clamp01(this.influence * 1.1);
    if (k < 0.08) return;
    const speed = Math.hypot(this.vx, this.vy);
    const orient = speed > 12 ? Math.atan2(this.vy, this.vx) : t * 0.08;
    const base = this.horizonR + 19 + k * 20;
    const c = mix("#a8c6ff", "#ffffff", 0.35);
    ctx.save();
    ctx.translate(this.mx, this.my);
    ctx.rotate(orient);
    ctx.scale(1, 0.38);
    ctx.lineCap = "round";
    for (let i = 0; i < 3; i++) {
      const r = base + i * 13;
      const sweep = 0.42 + i * 0.12;
      const a = (0.08 + 0.06 * Math.sin(t * 1.4 + i)) * k * (1 - i * 0.18);
      ctx.strokeStyle = rgba(c, a);
      ctx.lineWidth = i === 0 ? 1.1 : 0.65;
      ctx.beginPath();
      ctx.arc(0, 0, r, -sweep, sweep);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, r, Math.PI - sweep, Math.PI + sweep);
      ctx.stroke();
    }
    ctx.restore();
    ctx.lineCap = "butt";
  }

  private bezierPoint(path: [number, number][], p: number) {
    const q = clamp01(p);
    const k = 1 - q;
    return {
      x: (k * k * k * path[0][0] + 3 * k * k * q * path[1][0] + 3 * k * q * q * path[2][0] + q * q * q * path[3][0]) * this.w,
      y: (k * k * k * path[0][1] + 3 * k * k * q * path[1][1] + 3 * k * q * q * path[2][1] + q * q * q * path[3][1]) * this.h,
    };
  }

  /**
   * 双尾彗星：冷色离子尾细直、暖色尘埃尾宽而弯。尾部每个采样点都会被黑洞弯折。
   */
  private drawComets(t: number) {
    const ctx = this.ctx;
    const enterK = clamp01((this.enter.t - 1.25) / 1.2);
    if (enterK <= 0) return;
    ctx.lineCap = "round";

    for (let ci = 0; ci < this.comets.length; ci++) {
      const c = this.comets[ci];
      // 轨道两端各留一段淡入淡出，彗星不会硬切消失。
      const cycle = (t / c.period + c.phase) % 1;
      const p = cycle;
      const visible = Math.sin(clamp01(cycle) * Math.PI);
      if (visible <= 0.012) continue;
      const rawHead = this.bezierPoint(c.path, p);
      rawHead.x += this.driftX * c.depth;
      rawHead.y += this.driftY * c.depth;
      // near 只用于亮度/碎裂这些外观判断，绝不参与偏折强度：
      // 一旦让整条尾巴共用彗核的强度，远端也会被一起拽进来，就变成橡皮筋了。
      const near = clamp01(1 - Math.hypot(this.mx - rawHead.x, this.my - rawHead.y) / 280) * this.influence;
      // 彗核与尾部共用同一个偏折函数、同一个强度系数，因此首尾绝不脱节，
      // 但每一点的位移由"它自己到黑洞的距离"决定 → 只有近端被掰弯。
      const head = this.cometBend(rawHead.x, rawHead.y, c.depth);

      const ion = new Path2D();
      const dust = new Path2D();
      const fragments = new Path2D();
      const samples = 26;
      const step = 0.0040 + c.size * 0.00032;
      let started = false;
      let tailEnd = { x: head.x, y: head.y };
      for (let j = 0; j < samples; j++) {
        const q = p - j * step;
        // 轨道起点之前没有历史位置，直接收尾；不能 clamp，否则尾巴会钉死在起点。
        if (q <= 0) break;
        const raw = this.bezierPoint(c.path, q);
        raw.x += this.driftX * c.depth;
        raw.y += this.driftY * c.depth;

        // 轨道切线 → 法线：尘埃尾沿法线侧向滞后，这才是真实的弯尾，
        // 而不是把整条线沿屏幕斜向平移。
        const ahead = this.bezierPoint(c.path, Math.min(1, q + 0.004));
        const behind = this.bezierPoint(c.path, Math.max(0, q - 0.004));
        const tx = ahead.x - behind.x;
        const ty = ahead.y - behind.y;
        const tl = Math.hypot(tx, ty) || 1;
        const nx = -ty / tl;
        const ny = tx / tl;
        const curl = (j / samples) * (j / samples) * (16 + c.size * 5);
        const sway = Math.sin(t * 0.35 + ci * 2.1) * 0.35 + 1;

        const bent = this.cometBend(raw.x, raw.y, c.depth);
        const dustPoint = this.cometBend(raw.x + nx * curl * sway, raw.y + ny * curl * sway, c.depth);
        if (!started) {
          ion.moveTo(bent.x, bent.y);
          dust.moveTo(dustPoint.x, dustPoint.y);
          started = true;
        } else {
          ion.lineTo(bent.x, bent.y);
          dust.lineTo(dustPoint.x, dustPoint.y);
        }
        tailEnd = bent;
        if (near > 0.25 && j > 4 && j % 4 === 0) {
          const z = 0.65 + near * 0.75;
          fragments.rect(bent.x - z / 2, bent.y - z / 2, z, z);
        }
      }
      if (!started) continue;

      ctx.globalAlpha = enterK * visible;
      // 尾巴必须从彗核向后渐隐。等亮度的一整条线看起来像画面上的一道划痕，
      // 而不是逐渐稀薄的气体。
      const dustG = ctx.createLinearGradient(head.x, head.y, tailEnd.x, tailEnd.y);
      dustG.addColorStop(0, rgba(c.dust, 0.13 + near * 0.1));
      dustG.addColorStop(0.35, rgba(c.dust, 0.07 + near * 0.05));
      dustG.addColorStop(1, rgba(c.dust, 0));
      ctx.strokeStyle = dustG;
      ctx.lineWidth = 5.5 + c.size * 1.8;
      ctx.stroke(dust);
      const ionG = ctx.createLinearGradient(head.x, head.y, tailEnd.x, tailEnd.y);
      ionG.addColorStop(0, rgba(mix(c.color, "#ffffff", 0.5), 0.42 + near * 0.2));
      ionG.addColorStop(0.4, rgba(c.color, 0.16 + near * 0.1));
      ionG.addColorStop(1, rgba(c.color, 0));
      ctx.strokeStyle = ionG;
      ctx.lineWidth = 0.75 + c.size * 0.18;
      ctx.stroke(ion);
      ctx.fillStyle = rgba(mix(c.color, "#ffffff", 0.45), 0.35 + near * 0.4);
      ctx.fill(fragments);

      const hr = c.size * (4.8 + near * 2.6);
      const hg = ctx.createRadialGradient(head.x, head.y, 0, head.x, head.y, hr);
      hg.addColorStop(0, rgba("#ffffff", 0.94));
      hg.addColorStop(0.16, rgba(c.color, 0.72));
      hg.addColorStop(0.55, rgba(c.color, 0.17));
      hg.addColorStop(1, rgba(c.color, 0));
      ctx.fillStyle = hg;
      ctx.beginPath();
      ctx.arc(head.x, head.y, hr, 0, Math.PI * 2);
      ctx.fill();
      if (near > 0.42) {
        ctx.strokeStyle = rgba(mix(c.color, "#ffffff", 0.7), near * 0.24);
        ctx.lineWidth = 0.7;
        ctx.beginPath();
        ctx.arc(head.x, head.y, hr * (1.5 + near), 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
    ctx.lineCap = "butt";
  }

  private drawGridDots(t: number) {
    const ctx = this.ctx;
    const bhX = this.mx;
    const bhY = this.my;
    const infl = this.influence * this.gridRelease;
    // 只保留黑洞附近的局部点阵，引力场紧实、不再把半屏一起照亮。
    const soft = 4200;
    const strength = 5200 * infl;
    const swirlAmt = 0.62 * infl;
    const hR = this.horizonR + 1.5;
    const fieldX = this.driftX;
    const fieldY = this.driftY;
    const px = bhX - fieldX;
    const py = bhY - fieldY;

    const enterK = clamp01((this.enter.t - 0.25) / 1.5);

    // 批量桶：球面亮度分级
    const paths: Path2D[] = LEVELS.map(() => new Path2D());
    // 被恒星照亮的点，按 (star, 2 级) 分桶，保留颜色
    const litPaths: Path2D[][] = this.stars.map(() => [new Path2D(), new Path2D()]);
    // 入场涟漪：还在"亮起来"途中的点单独一桶，用整体透明度近似逐点淡入
    const fadePath = new Path2D();
    const s = this.dotSize;

    for (let i = 0; i < this.dotCount; i++) {
      const rx = this.dotX[i];
      const ry = this.dotY[i];
      const dx0 = rx - px;
      const dy0 = ry - py;
      const r = Math.sqrt(dx0 * dx0 + dy0 * dy0) || 0.0001;

      let x = rx + fieldX;
      let y = ry + fieldY;
      let g = 0;

      if (infl > 0.01) {
        g = strength / (r * r + soft);
        let rp = r * (1 - g);
        // 事件视界边缘：点被"顶"在视界外面，堆成一个亮环
        if (rp < hR) rp = hR;
        const ang = Math.atan2(dy0, dx0) + swirlAmt * g * 0.85;
        x = px + Math.cos(ang) * rp + fieldX;
        y = py + Math.sin(ang) * rp + fieldY;
      }

      // 入场：从画面中心向外一圈圈"点亮"
      let fading = false;
      if (enterK < 1) {
        const cx = this.w / 2;
        const cy = this.h / 2;
        const distN = Math.hypot(x - cx, y - cy) / (Math.hypot(cx, cy) + 1);
        const local = clamp01((this.enter.t - 0.18 - distN * 1.15) / 0.8);
        if (local <= 0.02) continue;
        if (local < 0.99) fading = true;
      }

      const blackReveal = infl * Math.exp(-Math.pow(r / 122, 4));
      let reveal = blackReveal;
      const twinkle = 0.11 + 0.065 * Math.sin(t * 1.05 + this.dotPhase[i]);
      const farLight = (infl * 0.12) / (1 + Math.pow(r / 96, 4));
      let b = twinkle * (0.35 + reveal * 0.65) + clamp01(g * 0.78) * 0.58 * blackReveal + farLight;

      // 恒星给点的受光
      let litIdx = -1;
      let lit = 0;
      for (let k = 0; k < this.stars.length; k++) {
        const st = this.stars[k];
        const sdx = x - st.x;
        const sdy = y - st.y;
        // 恒星只照亮紧贴自身的一小片点阵，不再产生数百像素的发光圆场。
        const rr = Math.max(44, st.radius * 2.72);
        if (sdx > rr || sdx < -rr || sdy > rr || sdy < -rr) continue;
        const sd = Math.hypot(sdx, sdy);
        if (sd > rr) continue;
        const starReveal = Math.pow(1 - sd / rr, 1.4) * st.alpha;
        reveal = Math.max(reveal, starReveal);
        const l = Math.pow(1 - sd / rr, 2.35) * 0.5 * st.alpha;
        if (l > lit) {
          lit = l;
          litIdx = k;
        }
      }
      // 范围之外完全不画。边缘使用每个点固定的伪随机阈值做稀疏渐隐，
      // 避免局部点阵的边缘变成一个生硬的标准圆。
      const dither = 0.035 + ((this.dotPhase[i] / (Math.PI * 2) + 1) % 1) * 0.055;
      if (reveal < dither) continue;
      b = clamp01(b + lit);

      const level = b < 0.24 ? 0 : b < 0.42 ? 1 : b < 0.62 ? 2 : b < 0.85 ? 3 : 4;
      const size = s * (1 + clamp01(b) * 0.75);
      if (fading) {
        fadePath.rect(x - size / 2, y - size / 2, size, size);
        continue;
      }
      const target =
        lit > 0.1 && litIdx >= 0 ? litPaths[litIdx][lit > 0.34 ? 1 : 0] : paths[level];
      target.rect(x - size / 2, y - size / 2, size, size);
    }

    if (enterK < 1) {
      ctx.globalAlpha = 0.3;
      ctx.fillStyle = `rgba(${LEVELS[1].c},${LEVELS[1].a + 0.04})`;
      ctx.fill(fadePath);
    }
    ctx.globalAlpha = 1;
    for (let l = 0; l < LEVELS.length; l++) {
      ctx.fillStyle = `rgba(${LEVELS[l].c},${LEVELS[l].a})`;
      ctx.fill(paths[l]);
    }
    for (let k = 0; k < this.stars.length; k++) {
      const st = this.stars[k];
      const c = mix(st.def.color, "#ffffff", 0.25);
      const a0 = 0.16 * st.alpha;
      const a1 = 0.5 * st.alpha;
      ctx.fillStyle = rgba(c, a0);
      ctx.fill(litPaths[k][0]);
      ctx.fillStyle = rgba(c, a1);
      ctx.fill(litPaths[k][1]);
    }
    ctx.globalAlpha = 1;
  }

  private drawStar(s: StarRT, t: number) {
    const ctx = this.ctx;
    const def = s.def;
    const pulse =
      1 + def.pulseAmount * Math.sin(t * ((Math.PI * 2) / def.pulsePeriod) + s.phase) + s.excite * 0.05;
    const R = Math.max(2, s.radius * pulse * s.visualScale);
    const p = s.captureP;
    const baseAngle = Math.atan2(this.my - s.y, this.mx - s.x);
    const d = Math.hypot(this.mx - s.x, this.my - s.y);
    const lux = clamp01(1 - d / Math.max(s.radius * def.lure, 90));
    const deform = (0.06 + 0.4 * p + 0.3 * lux) * this.influence;

    const halo = mix(def.color, "#ff4a1e", p * 0.7);
    const core = mix(def.core, "#ffb28c", p * 0.55);

    ctx.save();
    ctx.globalAlpha = s.alpha * (0.35 + 0.65 * clamp01((this.enter.t - 0.9) / 1.2));
    ctx.translate(s.x, s.y);
    ctx.rotate(baseAngle);
    ctx.scale(1 + deform, 1 - deform * 0.52);
    ctx.rotate(-baseAngle);

    // 等离子体闪烁：两个不同频率的正弦叠加，避免看出周期
    const flick =
      0.955 +
      0.032 * Math.sin(t * 7.3 + s.phase) +
      0.018 * Math.sin(t * 17.9 + s.phase * 2.3) +
      0.012 * Math.sin(t * 31.1 + s.phase * 0.7);
    const glowR =
      R *
      (def.kind === "redGiant" ? 4.4 : def.kind === "neutronStar" ? 4.1 : def.kind === "sun" ? 4.6 : 5) *
      (0.98 + 0.02 * flick);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, glowR);
    g.addColorStop(0, rgba(core, 0.95 * flick));
    g.addColorStop(0.13, rgba(halo, 0.72 * flick));
    g.addColorStop(0.35, rgba(halo, (def.kind === "redGiant" ? 0.3 : 0.2) * flick));
    g.addColorStop(0.68, rgba(halo, 0.07 * flick));
    g.addColorStop(1, rgba(halo, 0));
    ctx.fillStyle = g;
    ctx.fillRect(-glowR, -glowR, glowR * 2, glowR * 2);

    // 中子星没有装饰性轨道环；其他系统保留极淡的伴星 / 碎屑轨道。
    this.drawCompanionSystem(s, t, R, halo, core);

    // 核心
    const cg = ctx.createRadialGradient(0, 0, 0, 0, 0, R);
    cg.addColorStop(0, rgba(mix(core, "#ffffff", 0.6), 1));
    cg.addColorStop(def.kind === "redGiant" ? 0.62 : 0.8, rgba(core, 0.95));
    cg.addColorStop(1, rgba(halo, def.kind === "redGiant" ? 0.15 : 0.35));
    ctx.fillStyle = cg;
    ctx.beginPath();
    ctx.arc(0, 0, R, 0, Math.PI * 2);
    ctx.fill();

    if (def.kind === "neutronStar") this.drawNeutronStar(s, t, R, halo, core);

    // 普通恒星持续翻涌；中子星不使用火舌或日冕射线。
    if (def.kind !== "neutronStar") this.drawFlames(s, t, R, halo, core);

    if (def.kind === "redGiant") {
      // 红巨星的星面基底色更暖、更糊一点，强化"边缘融化"
      const wg = ctx.createRadialGradient(0, 0, R * 0.7, 0, 0, R * 1.5);
      wg.addColorStop(0, rgba(mix(halo, "#ff9a6a", 0.4), 0.18));
      wg.addColorStop(1, rgba(halo, 0));
      ctx.fillStyle = wg;
      ctx.beginPath();
      ctx.arc(0, 0, R * 1.5, 0, Math.PI * 2);
      ctx.fill();
    }

    if (def.kind === "binary") {
      // 双星：两颗互相绕转 + 质量转移的微弱光桥
      const oa = t * 0.95 + s.phase;
      const sep = R * 1.15;
      const ax = Math.cos(oa) * sep;
      const ay = Math.sin(oa) * sep * 0.55;
      const bx = -ax;
      const by = -ay;
      ctx.strokeStyle = rgba(core, 0.18 + 0.12 * Math.sin(t * 2.2));
      ctx.lineWidth = Math.max(1, R * 0.12);
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.quadraticCurveTo(0, R * 0.5, bx, by);
      ctx.stroke();
      for (const [ox, oy, rr, cc] of [
        [ax, ay, R * 0.62, core],
        [bx, by, R * 0.44, mix(def.color, "#ffffff", 0.4)],
      ] as [number, number, number, [number, number, number]][]) {
        const sg = ctx.createRadialGradient(ox, oy, 0, ox, oy, rr * 3.2);
        sg.addColorStop(0, rgba(cc, 1));
        sg.addColorStop(0.3, rgba(cc, 0.5));
        sg.addColorStop(1, rgba(cc, 0));
        ctx.fillStyle = sg;
        ctx.beginPath();
        ctx.arc(ox, oy, rr * 3.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    if (def.kind === "blueGiant") {
      // 蓝巨星的星风：一层薄薄的发散光
      const wg = ctx.createRadialGradient(0, 0, R * 0.9, 0, 0, R * 4);
      wg.addColorStop(0, rgba(def.color, 0.16));
      wg.addColorStop(1, rgba(def.color, 0));
      ctx.fillStyle = wg;
      ctx.beginPath();
      ctx.arc(0, 0, R * 4, 0, Math.PI * 2);
      ctx.fill();
    }

    this.drawStarEvent(s, t, R, halo, core);

    ctx.restore();
  }

  /**
   * 中子星 / 脉冲星：稳定自转轴、倾斜磁轴和两极准直喷流。
   * 不使用四向星芒或装饰圆环，速度通过沿喷流外移的等离子结与交替脉冲表达。
   */
  private drawNeutronStar(s: StarRT, t: number, R: number, halo: RGB, core: RGB) {
    const ctx = this.ctx;
    const active = s.eventKind === "magneticPulse"
      ? Math.sin(clamp01(s.eventT / Math.max(0.01, s.eventDur)) * Math.PI)
      : 0;
    // 喷流轴整体稳定，只做高速磁轴的投影扫动；不会像风车一样绕屏旋转。
    const axis = -0.74 + Math.sin(t * 6.4 + s.phase) * (0.19 + active * 0.08);
    const pulse = 0.72 + 0.22 * Math.pow(Math.max(0, Math.sin(t * 18.5 + s.phase)), 7) + active * 0.42;
    const len = R * (9.5 + active * 4.5);
    const width = Math.max(1.2, R * (0.24 + active * 0.08));
    const opacity = s.alpha * clamp01((this.enter.t - 0.7) / 1.1);

    ctx.save();
    ctx.rotate(axis);
    ctx.lineCap = "round";
    for (const side of [-1, 1]) {
      ctx.save();
      ctx.scale(side, 1);
      const beam = ctx.createLinearGradient(R * 0.72, 0, len, 0);
      beam.addColorStop(0, rgba(mix(core, "#ffffff", 0.7), 0.62 * pulse));
      beam.addColorStop(0.18, rgba(halo, 0.32 * pulse));
      beam.addColorStop(0.62, rgba(halo, 0.12 * pulse));
      beam.addColorStop(1, rgba(halo, 0));

      // 外鞘是宽而淡的物质柱，内核更细、更亮。
      ctx.fillStyle = beam;
      ctx.globalAlpha = 0.38 * opacity;
      ctx.beginPath();
      ctx.moveTo(R * 0.72, -width);
      ctx.quadraticCurveTo(len * 0.43, -width * 0.42, len, -width * 0.1);
      ctx.lineTo(len, width * 0.1);
      ctx.quadraticCurveTo(len * 0.43, width * 0.42, R * 0.72, width);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 0.84 * opacity;
      ctx.strokeStyle = beam;
      ctx.lineWidth = Math.max(0.65, R * 0.075);
      ctx.beginPath();
      ctx.moveTo(R * 0.78, 0);
      ctx.lineTo(len, 0);
      ctx.stroke();

      // 等离子结高速离开两极；离核心越远越淡，不形成新的环或芒星。
      for (let i = 0; i < 4; i++) {
        const q = (t * (1.7 + active * 0.5) + i * 0.24 + s.phase) % 1;
        const x = R + easeOutCubic(q) * (len - R);
        const y = Math.sin(q * 8.4 + i) * width * 0.16;
        const kr = Math.max(0.65, R * 0.1 * (1 - q * 0.55));
        const kg = ctx.createRadialGradient(x, y, 0, x, y, kr * 3.2);
        kg.addColorStop(0, rgba("#ffffff", (1 - q) * 0.72 * pulse));
        kg.addColorStop(0.3, rgba(halo, (1 - q) * 0.3 * pulse));
        kg.addColorStop(1, rgba(halo, 0));
        ctx.fillStyle = kg;
        ctx.globalAlpha = opacity;
        ctx.beginPath();
        ctx.arc(x, y, kr * 3.2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    // 两个磁极热点高速交替闪烁，直接贴在球面上，不画完整白圈。
    for (const side of [-1, 1]) {
      const x = side * R * 0.74;
      const hot = side > 0 ? pulse : 1.45 - pulse * 0.65;
      const g = ctx.createRadialGradient(x, 0, 0, x, 0, R * 0.48);
      g.addColorStop(0, rgba("#ffffff", clamp01(hot) * 0.92));
      g.addColorStop(0.24, rgba(core, clamp01(hot) * 0.48));
      g.addColorStop(1, rgba(halo, 0));
      ctx.fillStyle = g;
      ctx.globalAlpha = opacity;
      ctx.beginPath();
      ctx.arc(x, 0, R * 0.48, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  /** 类型化的随机恒星活动，事件结束后完全回到原状态。 */
  private drawStarEvent(s: StarRT, t: number, R: number, halo: RGB, core: RGB) {
    if (s.eventKind === "quiet") return;
    const ctx = this.ctx;
    const p = clamp01(s.eventT / Math.max(0.01, s.eventDur));
    const env = Math.sin(p * Math.PI) * s.alpha;
    if (env <= 0.002) return;
    const angle = s.eventSeed * Math.PI * 2;

    if (s.eventKind === "windShell") {
      for (let i = 0; i < 2; i++) {
        const q = clamp01(p * 1.18 - i * 0.16);
        const rr = R * (1.05 + q * (4.2 + i * 1.2));
        ctx.strokeStyle = rgba(mix(halo, "#ffffff", 0.34), env * (0.24 - i * 0.07) * (1 - q * 0.55));
        ctx.lineWidth = Math.max(0.6, R * (0.04 - i * 0.009));
        ctx.beginPath();
        ctx.arc(0, 0, rr, angle - 1.9, angle + 2.2);
        ctx.stroke();
      }
    }

    if (s.eventKind === "flare") {
      const len = R * (1.4 + env * 1.7);
      const path = new Path2D();
      path.moveTo(Math.cos(angle) * R * 0.86, Math.sin(angle) * R * 0.86);
      path.bezierCurveTo(
        Math.cos(angle - 0.2) * (R + len * 0.54),
        Math.sin(angle - 0.2) * (R + len * 0.54),
        Math.cos(angle + 0.48) * (R + len),
        Math.sin(angle + 0.48) * (R + len),
        Math.cos(angle + 0.76) * R * 0.92,
        Math.sin(angle + 0.76) * R * 0.92
      );
      ctx.lineCap = "round";
      ctx.strokeStyle = rgba(halo, env * 0.24);
      ctx.lineWidth = Math.max(1.8, R * 0.2);
      ctx.stroke(path);
      ctx.strokeStyle = rgba(mix(core, "#ffffff", 0.7), env * 0.78);
      ctx.lineWidth = Math.max(0.65, R * 0.045);
      ctx.stroke(path);
      ctx.lineCap = "butt";
    }

    if (s.eventKind === "surfaceBloom") {
      const a = angle + t * 0.035 * s.spin;
      const x = Math.cos(a) * R * 0.5;
      const y = Math.sin(a) * R * 0.5;
      const rr = R * (0.4 + env * 0.35);
      const g = ctx.createRadialGradient(x, y, 0, x, y, rr);
      g.addColorStop(0, rgba(mix(core, "#ffffff", 0.5), env * 0.7));
      g.addColorStop(0.35, rgba(halo, env * 0.28));
      g.addColorStop(1, rgba(halo, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, rr, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = rgba(halo, env * 0.16);
      ctx.lineWidth = Math.max(0.5, R * 0.018);
      ctx.beginPath();
      ctx.arc(0, 0, R * (1.2 + p * 2.5), angle - 0.8, angle + 1.25);
      ctx.stroke();
    }

    if (s.eventKind === "eclipse") {
      const x = lerp(-R * 1.7, R * 1.7, easeInOutCubic(p));
      const y = Math.sin(p * Math.PI) * -R * 0.24;
      const g = ctx.createRadialGradient(x, y, 0, x, y, R * 0.72);
      g.addColorStop(0, `rgba(2,2,5,${0.72 * env})`);
      g.addColorStop(0.7, `rgba(3,3,7,${0.5 * env})`);
      g.addColorStop(1, rgba(halo, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, R * 0.72, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = rgba(mix(core, "#ffffff", 0.6), env * 0.28);
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      ctx.arc(x, y, R * 0.55, -1.2, 1.2);
      ctx.stroke();
    }
  }

  /** 每颗恒星都不是孤岛：微行星、碎屑带和暗弱伴星把画面的时间尺度拉长。 */
  private drawCompanionSystem(s: StarRT, t: number, R: number, halo: RGB, core: RGB) {
    const ctx = this.ctx;
    const index = this.stars.indexOf(s);
    if (s.def.kind === "redGiant") {
      // 红巨星已把附近物质吹成一圈宽而慢的尘埃带。
      const phase = t * 0.055 + s.phase;
      ctx.save();
      ctx.rotate(phase * 0.2);
      ctx.scale(1, 0.42);
      ctx.strokeStyle = rgba(halo, 0.11 * s.alpha);
      ctx.lineWidth = Math.max(0.55, R * 0.025);
      ctx.beginPath();
      ctx.arc(0, 0, R * 2.55, 0.28, Math.PI * 1.38);
      ctx.stroke();
      ctx.restore();
      return;
    }
    // 中子星的两极喷流已经承担全部次级视觉，不再叠伴星和白色轨道圈。
    if (s.def.kind === "binary" || s.def.kind === "neutronStar") return;

    const count = s.def.kind === "sun" ? 2 : 1;
    for (let i = 0; i < count; i++) {
      const h = hash1(index * 61.7 + i * 17.3);
      const orbit = R * (3.4 + i * 1.45);
      const tilt = -0.42 + h * 0.84;
      ctx.save();
      ctx.rotate(tilt);
      ctx.scale(1, 0.34 + h * 0.18);
      ctx.strokeStyle = rgba(halo, 0.09 * s.alpha);
      ctx.lineWidth = 0.55;
      ctx.beginPath();
      ctx.arc(0, 0, orbit, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    for (let i = 0; i < count; i++) {
      const h = hash1(index * 61.7 + i * 17.3);
      const orbit = R * (3.4 + i * 1.45);
      const tilt = -0.42 + h * 0.84;
      const turn = t * (0.32 + i * 0.11) * (i % 2 ? -1 : 1) + h * Math.PI * 2;
      const px = Math.cos(turn) * orbit;
      const py = Math.sin(turn) * orbit * (0.34 + h * 0.18);
      const x = px * Math.cos(tilt) - py * Math.sin(tilt);
      const y = px * Math.sin(tilt) + py * Math.cos(tilt);
      const r = Math.max(0.9, R * (0.07 + h * 0.035));
      const cg = ctx.createRadialGradient(x, y, 0, x, y, r * 5);
      cg.addColorStop(0, rgba(mix(core, "#ffffff", 0.5), 0.78 * s.alpha));
      cg.addColorStop(0.26, rgba(halo, 0.35 * s.alpha));
      cg.addColorStop(1, rgba(halo, 0));
      ctx.fillStyle = cg;
      ctx.beginPath();
      ctx.arc(x, y, r * 5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /**
   * 恒星静止状态的表面动效（"恒星概念视频"那套语言）：
   *  · 表面颗粒对流：缓慢翻涌的暖色团块
   *  · 针状体：贴着一圈细小、长度抖动的刺，形成闪烁的色球层
   *  · 火舌 / 日珥拱桥：一伸一缩、左右摇摆、尖端带亮团
   *  · 日冕射线：更远更淡的长射线，随呼吸慢慢摆动
   * 一颗星只建两个渐变，并用 Path2D 批量描边，所以既丰富又不掉帧。
   */
  private drawFlames(s: StarRT, t: number, R: number, halo: RGB, core: RGB) {
    const ctx = this.ctx;
    const cfg = FLAMES[s.def.kind];
    const si = this.stars.indexOf(s);
    const A = s.alpha * (0.35 + 0.65 * clamp01((this.enter.t - 0.9) / 1.2)) * (1 - s.captureP * 0.5);
    if (A <= 0.01) return;
    const boost = 1 + s.excite * 0.35 + s.captureP * 0.25;
    const TAU = Math.PI * 2;

    // 两个渐变（会跟着当前变换一起平移，所以可以复用给所有火舌）
    const granG = ctx.createRadialGradient(0, 0, 0, 0, 0, R * 0.7);
    granG.addColorStop(0, rgba(mix(core, "#ffffff", 0.3), 0.18));
    granG.addColorStop(0.55, rgba(mix(halo, core, 0.4), 0.1));
    granG.addColorStop(1, rgba(halo, 0));
    const tongueG = ctx.createRadialGradient(0, 0, R * 0.88, 0, 0, R * 2.15);
    tongueG.addColorStop(0, rgba(mix(core, halo, 0.3), 0.62));
    tongueG.addColorStop(0.26, rgba(halo, 0.36));
    tongueG.addColorStop(0.62, rgba(halo, 0.13));
    tongueG.addColorStop(1, rgba(halo, 0));

    ctx.lineCap = "round";

    /* 1 · 表面颗粒对流 */
    ctx.fillStyle = granG;
    for (let i = 0; i < cfg.gran; i++) {
      const h1 = hash1(i * 3.3 + si * 11.3);
      const h2 = hash1(i * 7.7 + si * 5.1);
      const ang = h1 * TAU + t * (0.05 + h2 * 0.14) * s.spin;
      const rad = R * (0.14 + h2 * 0.34) * (0.5 + 0.5 * Math.sin(t * (0.45 + h1 * 0.6) + h2 * 6.28));
      const bx = Math.cos(ang) * rad;
      const by = Math.sin(ang) * rad;
      const rr = R * (0.3 + h1 * 0.32) * boost;
      ctx.save();
      ctx.translate(bx, by);
      ctx.globalAlpha = A * 0.9;
      ctx.fillRect(-rr, -rr, rr * 2, rr * 2);
      ctx.restore();
    }

    /* 2 · 针状体：色球层的闪烁绒毛 */
    const spPath = new Path2D();
    for (let i = 0; i < cfg.spicules; i++) {
      const h = hash1(i * 5.1 + si * 3.9);
      const a = (i / cfg.spicules) * TAU + t * 0.045 * s.spin + h * 0.12;
      const flick = 0.4 + 0.6 * Math.sin(t * (2.2 + h * 2.8) + h * 12.9);
      const len = R * (0.32 + cfg.spLen * (0.3 + flick)) * boost;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      spPath.moveTo(ca * R * 0.97, sa * R * 0.97);
      spPath.lineTo(ca * (R * 0.97 + len), sa * (R * 0.97 + len));
    }
    ctx.strokeStyle = tongueG;
    ctx.globalAlpha = A * 0.6;
    ctx.lineWidth = Math.max(0.6, R * cfg.width * 0.42);
    ctx.stroke(spPath);

    /* 3 · 火舌与日珥拱桥 */
    const tips = new Path2D();
    for (let i = 0; i < cfg.tongues; i++) {
      const h1 = hash1(i * 2.71 + si * 13.7);
      const h2 = hash1(i * 9.43 + si * 7.3);
      const h3 = hash1(i * 4.19 + si * 17.1);
      // 舌根沿着星面缓慢游走
      const base = h1 * TAU + Math.sin(t * (0.1 + h2 * 0.17) * s.spin + h2 * 6.28) * 0.85;
      // 一伸一缩
      const breath = 0.5 + 0.5 * Math.sin(t * (0.45 + h1 * 0.95) * cfg.speed + h3 * 6.28);
      const len = R * (cfg.len[0] + (cfg.len[1] - cfg.len[0]) * breath) * boost;
      const sway = Math.sin(t * (0.65 + h2 * 1.1) * cfg.speed + h1 * 4.2) * 0.6;
      const r0 = R * 0.95;
      const bx = Math.cos(base) * r0;
      const by = Math.sin(base) * r0;
      const path = new Path2D();
      let tipX = 0;
      let tipY = 0;

      if (i < cfg.loops) {
        // 日珥拱桥：升起、越过、落回星面
        const span = 0.3 + h2 * 0.45 + breath * 0.3;
        const a1 = base + span;
        const ex = Math.cos(a1) * r0;
        const ey = Math.sin(a1) * r0;
        const midA = (base + a1) * 0.5 + sway * 0.1;
        const cr = r0 + len * 1.4;
        path.moveTo(bx, by);
        path.quadraticCurveTo(Math.cos(midA) * cr, Math.sin(midA) * cr, ex, ey);
        tipX = Math.cos(midA) * cr;
        tipY = Math.sin(midA) * cr;
      } else {
        // 火舌：伸出星面，尖端随气流摇摆
        const a1 = base + sway * 0.45;
        tipX = Math.cos(a1) * (r0 + len);
        tipY = Math.sin(a1) * (r0 + len);
        const cA = base + sway * 0.2;
        path.moveTo(bx, by);
        path.quadraticCurveTo(
          Math.cos(cA) * (r0 + len * 0.55),
          Math.sin(cA) * (r0 + len * 0.55),
          tipX,
          tipY
        );
      }

      ctx.strokeStyle = tongueG;
      // 外层：宽而柔和（等离子体的辉光）
      ctx.globalAlpha = A * (0.2 + 0.24 * breath);
      ctx.lineWidth = Math.max(1.1, R * cfg.width * 2.3);
      ctx.stroke(path);
      // 内层：细而亮（火舌本体）
      ctx.globalAlpha = A * (0.34 + 0.34 * breath);
      ctx.lineWidth = Math.max(0.7, R * cfg.width * 1.05);
      ctx.stroke(path);

      if (len > R * 0.26) {
        // 必须是圆点：方块在星体外面会变成一块块硬边白色碎片。
        const s0 = Math.max(0.55, R * 0.032 * (0.7 + 0.5 * breath));
        tips.moveTo(tipX + s0, tipY);
        tips.arc(tipX, tipY, s0, 0, TAU);
      }
    }
    ctx.globalAlpha = A * 0.34;
    ctx.fillStyle = rgba(mix(core, "#ffffff", 0.55), 0.9);
    ctx.fill(tips);

    /* 4 · 日冕射线 */
    const rays = new Path2D();
    for (let i = 0; i < cfg.rays; i++) {
      const h1 = hash1(i * 6.13 + si * 23.5);
      const a = (i / cfg.rays) * TAU + h1 * 0.35 + t * 0.03 * s.spin;
      const breath = 0.5 + 0.5 * Math.sin(t * (0.35 + h1 * 0.55) + h1 * 9.31);
      const r0 = R * 1.12;
      const r1 = R * (1.55 + 0.6 * breath + cfg.spLen * 1.4);
      rays.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
      rays.lineTo(Math.cos(a) * r1, Math.sin(a) * r1);
    }
    ctx.strokeStyle = tongueG;
    ctx.globalAlpha = A * 0.32;
    ctx.lineWidth = Math.max(0.55, R * 0.028);
    ctx.stroke(rays);

    // 偶发的日冕物质抛射：只有短短一段时间会亮起，停留越久越容易看见一次。
    // 红巨星与太阳的抛射更明显，其他星型只保留非常克制的余光。
    const cycleSpeed = s.def.kind === "redGiant" ? 0.035 : s.def.kind === "sun" ? 0.052 : 0.027;
    const cycle = (t * cycleSpeed + hash1(si * 29.4 + 8.2)) % 1;
    if (cycle < 0.12) {
      const progress = cycle / 0.12;
      const flareA = Math.sin(progress * Math.PI);
      const a = hash1(si * 77.1 + 4.9) * TAU;
      const r0 = R * 0.94;
      const length = R * (1.35 + 0.45 * flareA) * boost;
      const bend = 0.55 + hash1(si * 11.1 + 3.3) * 0.5;
      const flare = new Path2D();
      flare.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
      flare.quadraticCurveTo(
        Math.cos(a + bend * 0.18) * (r0 + length * 0.58),
        Math.sin(a + bend * 0.18) * (r0 + length * 0.58),
        Math.cos(a + bend * 0.42) * (r0 + length),
        Math.sin(a + bend * 0.42) * (r0 + length)
      );
      ctx.strokeStyle = rgba(mix(core, "#ffffff", 0.6), 0.66 * A * flareA);
      ctx.lineWidth = Math.max(0.7, R * cfg.width * 0.82);
      ctx.stroke(flare);
      ctx.strokeStyle = rgba(halo, 0.18 * A * flareA);
      ctx.lineWidth = Math.max(1.5, R * cfg.width * 3.2);
      ctx.stroke(flare);
    }

    ctx.globalAlpha = 1;
    ctx.lineCap = "butt";
  }

  /**
   * 被剥离物质形成的"河道"：从恒星面向黑洞的一条弯曲发光带。
   * 粒子沿它流动，整条流就有了方向感，而不是散落的火星。
   */
  private drawRibbons() {
    const ctx = this.ctx;
    ctx.lineCap = "round";
    for (const s of this.stars) {
      if (s.alpha < 0.05) continue;
      const rd = Math.hypot(this.mx - s.restX, this.my - s.restY);
      const lureR = Math.max(s.radius * s.def.lure, 90);
      const prox = clamp01(1 - rd / lureR);
      const k = (prox * this.influence + s.captureP * 0.45) * (1 - s.captureP * 0.5);
      if (k < 0.2) continue;
      const ang = Math.atan2(this.my - s.y, this.mx - s.x);
      const dist = Math.hypot(this.mx - s.x, this.my - s.y);
      if (dist < s.radius * 1.5) continue;

      const r0 = s.radius * 0.92;
      const x0 = s.x + Math.cos(ang) * r0;
      const y0 = s.y + Math.sin(ang) * r0;
      const x1 = this.mx - Math.cos(ang) * (this.horizonR + 1);
      const y1 = this.my - Math.sin(ang) * (this.horizonR + 1);
      // 控制点沿吸积旋转方向偏移 → 一条同向的弧
      const perp = ang + (Math.PI / 2) * s.spin;
      const off = (0.14 + 0.05 * Math.sin(this.time * 1.6 + s.phase)) * dist;
      const cxp = (x0 + x1) / 2 + Math.cos(perp) * off;
      const cyp = (y0 + y1) / 2 + Math.sin(perp) * off;

      const path = new Path2D();
      path.moveTo(x0, y0);
      path.quadraticCurveTo(cxp, cyp, x1, y1);

      const warm = mix(s.def.color, "#ffffff", 0.5);
      const g = ctx.createLinearGradient(x0, y0, x1, y1);
      g.addColorStop(0, rgba(s.def.color, 0));
      g.addColorStop(0.28, rgba(s.def.color, 0.2 * k));
      g.addColorStop(0.75, rgba(warm, 0.32 * k));
      g.addColorStop(1, rgba("#ffffff", 0));
      ctx.strokeStyle = g;
      const passes: [number, number][] = [
        [s.radius * 0.5, 0.42],
        [s.radius * 0.24, 0.66],
        [s.radius * 0.085, 1],
      ];
      for (const [wdt, a] of passes) {
        ctx.globalAlpha = a;
        ctx.lineWidth = Math.max(1, wdt);
        ctx.stroke(path);
      }
    }
    ctx.globalAlpha = 1;
  }

  /** 空白处点击喷出的那一小股物质：冰蓝到冷白的短促曲线，迅速淡出。 */
  private drawEjecta() {
    if (!this.ejecta.length) return;
    const ctx = this.ctx;
    ctx.lineCap = "round";
    const BUCKETS = 5;
    const paths: Path2D[] = Array.from({ length: BUCKETS }, () => new Path2D());
    for (const p of this.ejecta) {
      if (Math.abs(p.x - p.ox) + Math.abs(p.y - p.oy) < 1.2) continue;
      const k = clamp01(p.life / p.total);
      const idx = clamp(Math.floor(k * BUCKETS), 0, BUCKETS - 1);
      paths[idx].moveTo((p.ox + p.px) * 0.5, (p.oy + p.py) * 0.5);
      paths[idx].quadraticCurveTo(p.px, p.py, (p.px + p.x) * 0.5, (p.py + p.y) * 0.5);
    }
    const col = mix("#eaf2ff", "#8fb6ff", 0.4);
    for (let i = 0; i < BUCKETS; i++) {
      const k = (i + 0.5) / BUCKETS;
      ctx.strokeStyle = rgba(col, k * 0.55);
      ctx.lineWidth = 0.6 + k * 0.9;
      ctx.stroke(paths[i]);
    }
    ctx.lineCap = "butt";
  }

  /** 粒子掉进视界时的一点点闪光 */
  private drawImpacts() {
    if (!this.impacts.length) return;
    const ctx = this.ctx;
    for (const im of this.impacts) {
      const a = clamp01(im.a);
      const g = ctx.createRadialGradient(im.x, im.y, 0, im.x, im.y, im.r);
      g.addColorStop(0, rgba(im.color, 0.55 * a));
      g.addColorStop(0.45, rgba(im.color, 0.2 * a));
      g.addColorStop(1, rgba(im.color, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(im.x, im.y, im.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawParticles() {
    if (!this.particles.length) return;
    const ctx = this.ctx;
    ctx.lineCap = "round";
    // 按 (恒星, 热度 3 级 × 明暗 2 级) 分批：既保留星体颜色 → 白热的层次，
    // 又能让临近消亡的粒子平滑淡出，而不是"啪"地消失。
    const B = 6;
    const buckets = this.stars.map(() =>
      Array.from({ length: B }, () => new Path2D())
    );
    const heads = this.stars.map(() =>
      Array.from({ length: B }, () => new Path2D())
    );
    for (const p of this.particles) {
      const st = this.stars[p.star];
      if (!st) continue;
      // 曲线拖尾：用两点 + 中点做二次贝塞尔，轨迹是"流体"，不是折线
      if (Math.abs(p.x - p.ox) + Math.abs(p.y - p.oy) < 2.4) continue;
      const lvl = p.heat < 0.32 ? 0 : p.heat < 0.68 ? 1 : 2;
      // 被甩出引力井的粒子必须暗下去。否则它们会在空场里留下一串
      // 高对比的白色短划，看起来像画面上的脏点而不是物质流。
      const far = Math.hypot(this.mx - p.x, this.my - p.y) > 210;
      const fading = p.life < 0.9 || far ? 1 : 0;
      const idx = lvl * 2 + fading;
      const b = buckets[p.star][idx];
      b.moveTo((p.ox + p.px) * 0.5, (p.oy + p.py) * 0.5);
      b.quadraticCurveTo(p.px, p.py, (p.px + p.x) * 0.5, (p.py + p.y) * 0.5);
      // 只有真正被烧白的那一段才有粒子头部，避免整片闪点
      if (p.heat > 0.55) {
        const z = p.size * (0.5 + p.heat * 0.55);
        heads[p.star][idx].rect(p.x - z / 2, p.y - z / 2, z, z);
      }
    }
    for (let k = 0; k < this.stars.length; k++) {
      const def = this.stars[k].def;
      const cols = [
        { c: rgb(def.color), a: 0.17, w: 0.7 },
        { c: mix(def.color, "#ffd9a5", 0.6), a: 0.28, w: 0.85 },
        { c: [255, 252, 244] as [number, number, number], a: 0.44, w: 1.0 },
      ];
      for (let l = 0; l < 3; l++) {
        for (let f = 0; f < 2; f++) {
          const path = buckets[k][l * 2 + f];
          const fade = f ? 0.22 : 1;
          ctx.strokeStyle = rgba(cols[l].c, cols[l].a * fade * (0.5 + 0.5 * this.influence));
          ctx.lineWidth = cols[l].w;
          ctx.stroke(path);
          ctx.fillStyle = rgba(cols[l].c, cols[l].a * fade * (0.25 + l * 0.16));
          ctx.fill(heads[k][l * 2 + f]);
        }
      }
    }
  }

  private drawHorizon(t: number) {
    const ctx = this.ctx;
    const infl = clamp01(this.influence * 1.1);
    const show = Math.max(infl, this.maxCaptureP);
    if (show < 0.02) return;
    const r = this.horizonR;

    // 爱因斯坦辉光收紧在事件视界附近，不再制造覆盖半屏的亮圆场。
    const wellR = 92 + this.maxCaptureP * 62;
    const well = ctx.createRadialGradient(this.mx, this.my, r * 0.72, this.mx, this.my, wellR);
    well.addColorStop(0, "rgba(0,0,0,0)");
    well.addColorStop(0.13, `rgba(204,224,255,${0.065 * show})`);
    well.addColorStop(0.34, `rgba(112,148,220,${0.028 * show})`);
    well.addColorStop(0.7, `rgba(74,102,169,${0.009 * show})`);
    well.addColorStop(1, "rgba(68,94,154,0)");
    ctx.fillStyle = well;
    ctx.beginPath();
    ctx.arc(this.mx, this.my, wellR, 0, Math.PI * 2);
    ctx.fill();

    // 吸积盘：未捕获时只是很克制的一抹弧，靠近恒星后才烧成可见的炽热盘面。
    let diskColor: RGB = [196, 219, 255];
    let strongest = 0;
    let diskDir = Math.atan2(this.vy, this.vx);
    for (const s of this.stars) {
      if (s.captureP > strongest) {
        strongest = s.captureP;
        diskColor = mix(s.def.color, "#fff4df", 0.4);
        diskDir = Math.atan2(this.my - s.y, this.mx - s.x);
      }
    }
    const diskPower = clamp01(infl * 0.22 + strongest * 0.9);
    if (diskPower > 0.045) {
      const tilt = 0.23 + 0.09 * Math.sin(t * 0.7);
      ctx.save();
      ctx.translate(this.mx, this.my);
      ctx.rotate(diskDir + Math.PI / 2);
      ctx.scale(1, tilt);
      const glow = ctx.createRadialGradient(0, 0, r * 0.6, 0, 0, r * 4.4);
      glow.addColorStop(0, rgba(diskColor, 0));
      glow.addColorStop(0.32, rgba(diskColor, 0.08 * diskPower));
      glow.addColorStop(0.6, rgba(diskColor, 0.04 * diskPower));
      glow.addColorStop(1, rgba(diskColor, 0));
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(0, 0, r * 4.4, 0, Math.PI * 2);
      ctx.fill();

      // 盘的前后两侧亮度不同，才像一个真正倾斜的高速旋转盘。
      const rings = [
        { rr: 1.42, w: 1.1, a: 0.55 },
        { rr: 1.92, w: 0.75, a: 0.36 },
        { rr: 2.8, w: 0.45, a: 0.18 },
      ];
      for (let i = 0; i < rings.length; i++) {
        const ring = rings[i];
        const wobble = Math.sin(t * (2.1 + i * 0.8) + i) * 0.16;
        ctx.strokeStyle = rgba(diskColor, ring.a * diskPower);
        ctx.lineWidth = ring.w + strongest * 1.25;
        ctx.beginPath();
        ctx.arc(0, 0, r * ring.rr, -Math.PI + wobble, -0.04 + wobble);
        ctx.stroke();
        ctx.strokeStyle = rgba(mix(diskColor, "#ffffff", 0.65), ring.a * diskPower * 0.72);
        ctx.beginPath();
        ctx.arc(0, 0, r * ring.rr, 0.08 + wobble, Math.PI + wobble);
        ctx.stroke();
      }
      ctx.restore();
    }

    // 被捕获恒星造成的巨大光圈（光子环）：多层叠加出"炸开"的观感
    const pulse = 0.75 + 0.25 * Math.sin(t * 3.1);
    if (this.maxCaptureP > 0.02) {
      const rings: [number, number, number][] = [
        [r + 6, 3, 0.95 * pulse],
        [r + 16, 12, 0.42 * pulse],
        [r + 34, 46, 0.2 * pulse],
      ];
      for (const [rr, wdt, a] of rings) {
        const g = ctx.createRadialGradient(this.mx, this.my, Math.max(0, rr - wdt), this.mx, this.my, rr + wdt);
        const c = mix("#ffe6c4", "#ffffff", 0.4);
        g.addColorStop(0, rgba(c, 0));
        g.addColorStop(0.5, rgba(c, a * this.maxCaptureP));
        g.addColorStop(1, rgba(c, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(this.mx, this.my, rr + wdt, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // 相对论性喷流：垂直于吸积流方向的一对极淡烟柱，随捕获而亮起
    if (this.maxCaptureP > 0.28) {
      let dir = 0;
      let best = 0;
      for (const s of this.stars) {
        if (s.captureP > best) {
          best = s.captureP;
          dir = Math.atan2(this.my - s.y, this.mx - s.x);
        }
      }
      if (best < 0.05) dir = Math.atan2(this.vy, this.vx);
      const flick = 0.72 + 0.22 * Math.sin(t * 9.1) + 0.12 * Math.sin(t * 21.3);
      const len = r * 3.2 + 60 * flick;
      const wdt = Math.max(1.6, r * 0.2);
      const a = this.maxCaptureP * 0.15 * flick;
      const col = mix("#ffffff", "#a8c2ff", 0.5);
      const g = ctx.createLinearGradient(0, 0, len, 0);
      g.addColorStop(0, rgba(col, a));
      g.addColorStop(0.32, rgba(col, a * 0.55));
      g.addColorStop(1, rgba(col, 0));
      ctx.save();
      ctx.translate(this.mx, this.my);
      ctx.rotate(dir + Math.PI / 2);
      ctx.fillStyle = g;
      for (let side = 0; side < 2; side++) {
        if (side === 1) ctx.scale(-1, 1); // 镜像：同一渐变跟着 CTM 一起翻
        ctx.beginPath();
        ctx.moveTo(r * 0.55, -wdt);
        ctx.lineTo(len, -wdt * 0.16);
        ctx.lineTo(len, wdt * 0.16);
        ctx.lineTo(r * 0.55, wdt);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }

    // 事件视界：纯黑圆盘 + 一圈微弱发光边
    const disc = r;
    const outer = disc * 1.2;
    const dg = ctx.createRadialGradient(this.mx, this.my, 0, this.mx, this.my, outer);
    dg.addColorStop(0, `rgba(0,0,0,${0.99 * show})`);
    dg.addColorStop(0.7, `rgba(0,0,0,${0.985 * show})`);
    dg.addColorStop(0.83, `rgba(2,2,4,${0.72 * show})`);
    dg.addColorStop(0.93, `rgba(4,4,6,${0.3 * show})`);
    dg.addColorStop(1, "rgba(4,4,6,0)");
    ctx.fillStyle = dg;
    ctx.beginPath();
    ctx.arc(this.mx, this.my, outer, 0, Math.PI * 2);
    ctx.fill();

    const rg = ctx.createRadialGradient(this.mx, this.my, Math.max(0, disc - 3), this.mx, this.my, disc + 4.5);
    rg.addColorStop(0, "rgba(150,185,255,0)");
    rg.addColorStop(0.45, `rgba(196,220,255,${0.3 * show})`);
    rg.addColorStop(0.72, `rgba(230,240,255,${0.42 * show})`);
    rg.addColorStop(1, "rgba(150,185,255,0)");
    ctx.fillStyle = rg;
    ctx.beginPath();
    ctx.arc(this.mx, this.my, disc + 4.5, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawRings() {
    const ctx = this.ctx;
    for (const r of this.rings) {
      const k = clamp01(r.t / r.dur);
      const a = r.alpha * (1 - k) * (1 - k);
      if (a <= 0.005) continue;
      const wdt = Math.max(1.2, r.width);
      const g = ctx.createRadialGradient(this.mx, this.my, Math.max(0, r.r - wdt), this.mx, this.my, r.r + wdt);
      g.addColorStop(0, `rgba(${r.color},0)`);
      g.addColorStop(0.5, `rgba(${r.color},${a})`);
      g.addColorStop(1, `rgba(${r.color},0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(this.mx, this.my, r.r + wdt, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawOverlays() {
    const ctx = this.ctx;
    const { w, h } = this;

    // 冲击波（吞噬时）
    if (this.swallow) {
      const k = clamp01((this.swallow.t - 130) / 620);
      if (k > 0 && k < 1) {
        const rr = lerp(this.horizonR, Math.hypot(w, h) * 0.72, easeOutCubic(k));
        const wdt = lerp(5, 60, k);
        const a = (1 - k) * 0.62;
        const g = ctx.createRadialGradient(this.mx, this.my, Math.max(0, rr - wdt), this.mx, this.my, rr + wdt);
        const c = mix("#ffffff", this.swallow.def.color, 0.35);
        g.addColorStop(0, rgba(c, 0));
        g.addColorStop(0.45, rgba(c, a));
        g.addColorStop(1, rgba(c, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(this.mx, this.my, rr + wdt, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // 强光闪爆
    if (this.flash > 0.001) {
      const g = ctx.createRadialGradient(this.mx, this.my, 0, this.mx, this.my, Math.max(w, h) * 0.9);
      g.addColorStop(0, `rgba(255,255,255,${0.95 * this.flash})`);
      g.addColorStop(0.25, `rgba(226,238,255,${0.5 * this.flash})`);
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }

    // 朝该板块的颜色过渡：从黑洞处膨胀的色盘 + 发光边缘
    if (this.floodR >= 0 && this.swallow) {
      const cover = this.coverRadius();
      ctx.fillStyle = this.swallow.def.pageBg;
      ctx.beginPath();
      ctx.arc(this.mx, this.my, this.floodR, 0, Math.PI * 2);
      ctx.fill();
      if (this.floodR > 30 && this.floodR < cover) {
        const c = mix(this.swallow.def.color, "#ffffff", 0.5);
        const wdt = Math.min(140, this.floodR * 0.5);
        const g = ctx.createRadialGradient(
          this.mx,
          this.my,
          Math.max(0, this.floodR - wdt),
          this.mx,
          this.my,
          this.floodR
        );
        g.addColorStop(0, rgba(c, 0));
        g.addColorStop(0.82, rgba(c, 0.3));
        g.addColorStop(1, rgba(c, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(this.mx, this.my, this.floodR, 0, Math.PI * 2);
        ctx.fill();
      }
      if (this.floodR >= cover) {
        ctx.fillStyle = this.swallow.def.pageBg;
        ctx.fillRect(0, 0, w, h);
      }
    }

    // 从板块页返回：一层板块色膜，中间被"宇宙"从中心往外撑开（反向吞噬）
    if (this.enter.mode === "return") {
      const k = clamp01(this.enter.t / 0.72);
      if (k < 1) {
        const hole = easeInOutCubic(k) * Math.hypot(w, h) * 0.62;
        ctx.fillStyle = this.enter.color;
        ctx.beginPath();
        ctx.rect(0, 0, w, h);
        ctx.arc(w / 2, h / 2, Math.max(hole, 0.01), 0, Math.PI * 2, true);
        ctx.fill("evenodd");
        if (hole > 4) {
          const c: RGB = [235, 242, 255];
          const g = ctx.createRadialGradient(w / 2, h / 2, Math.max(0, hole - 90), w / 2, h / 2, hole);
          g.addColorStop(0, rgba(c, 0));
          g.addColorStop(0.78, rgba(c, 0.3 * (1 - k)));
          g.addColorStop(1, rgba(c, 0));
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(w / 2, h / 2, hole, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    // 亮度渐晕，让画面更"深"。收敛强度，否则会把边缘的星云整片压没。
    const vg = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.46, w / 2, h / 2, Math.max(w, h) * 0.86);
    vg.addColorStop(0, "rgba(0,0,0,0)");
    vg.addColorStop(1, "rgba(0,0,0,0.34)");
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, w, h);
  }
}
