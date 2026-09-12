/**
 * 全站背景音乐：无 React 依赖的模块级单例（模式对齐 universe/blackhole.ts）。
 *
 * 两种播放模式：
 *  - ambient    主页随机池（globalTracks），一首播完自动换下一首
 *  - dedicated  板块专属单曲（蓝巨星 = The Great Gig in the Sky），循环不掐断
 *
 * 浏览器自动播放策略决定音频必须等首次用户手势（pointerdown / keydown），
 * 在此之前不创建 AudioContext；手势到来时以当前模式淡入开始播放。
 */
import { audioConfig, blueGiantTrack, globalTracks, type Track } from "../data/site";

export type MusicMode = "ambient" | "dedicated";

export interface MusicState {
  /** 用户已交互，音频可播 */ unlocked: boolean;
  playing: boolean;
  mode: MusicMode;
  track: Track | null;
  /** 加载失败的文件名；null = 正常 */ error: string | null;
}

type Listener = (s: MusicState) => void;

const TARGET_VOLUME = audioConfig.volume;

class MusicManager {
  private audio: HTMLAudioElement | null = null;
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private freq: Uint8Array<ArrayBuffer> | null = null;
  private spectrum: Float32Array = new Float32Array(1024);

  private state: MusicState = {
    unlocked: false,
    playing: false,
    mode: "ambient",
    track: null,
    error: null,
  };
  private listeners = new Set<Listener>();
  private fadeRaf = 0;

  /** ambient 池的无重复随机序列 */
  private pool: Track[] = [];
  private poolIdx = 0;
  /** 进入 dedicated 前的 ambient 曲目，返回宇宙时恢复 */
  private lastAmbient: Track | null = null;

  /** 待解锁后执行的模式切换（进页早于首次手势时暂存） */
  private pending: { mode: MusicMode; track: Track } | null = null;

  constructor() {
    this.pool = this.shuffled(globalTracks);
    if (typeof window !== "undefined") {
      const unlock = () => this.unlock();
      window.addEventListener("pointerdown", unlock, { once: true, capture: true });
      window.addEventListener("keydown", unlock, { once: true, capture: true });
    }
  }

  /* ---------------- 状态订阅 ---------------- */

  getState(): MusicState {
    return this.state;
  }

  subscribe(cb: Listener): () => void {
    this.listeners.add(cb);
    cb(this.state);
    return () => this.listeners.delete(cb);
  }

  private emit(patch: Partial<MusicState>) {
    this.state = { ...this.state, ...patch };
    for (const cb of this.listeners) cb(this.state);
  }

  /* ---------------- 解锁与初始化 ---------------- */

  private unlock() {
    if (this.state.unlocked) return;
    const wanted = this.pending ?? {
      mode: "ambient" as MusicMode,
      track: this.pool[this.poolIdx++ % this.pool.length],
    };
    this.pending = null;
    this.ensureNodes();
    this.emit({ unlocked: true, mode: wanted.mode, track: wanted.track });
    this.load(wanted.track, wanted.mode);
    this.play();
  }

  private ensureNodes() {
    if (this.audio) return;
    const audio = new Audio();
    audio.preload = "metadata";
    audio.volume = 0;
    audio.addEventListener("ended", () => this.onEnded());
    audio.addEventListener("error", () => {
      this.emit({ error: this.state.track?.file ?? "未知文件", playing: false });
    });
    this.audio = audio;

    try {
      const Ctor = window.AudioContext;
      const ctx = new Ctor();
      const src = ctx.createMediaElementSource(audio);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.8;
      src.connect(analyser);
      analyser.connect(ctx.destination);
      this.ctx = ctx;
      this.analyser = analyser;
      this.freq = new Uint8Array(analyser.frequencyBinCount);
    } catch {
      // 无 WebAudio 也能出声，只是频谱层退化为静态
      this.analyser = null;
    }
  }

  /* ---------------- 模式切换 ---------------- */

  /** 页面切换入口：ambient ↔ dedicated，带淡出淡入 */
  switchMode(mode: MusicMode) {
    if (mode === this.state.mode && this.state.track) return;
    if (!this.state.unlocked) {
      // 还没解锁：记住目标模式，首次手势直接以它开播
      this.pending =
        mode === "dedicated"
          ? { mode, track: blueGiantTrack }
          : { mode, track: this.pool[this.poolIdx++ % this.pool.length] };
      this.emit({ mode, track: this.pending.track });
      return;
    }
    const track =
      mode === "dedicated"
        ? blueGiantTrack
        : (this.lastAmbient ?? this.pickAmbient());
    if (mode === "dedicated" && this.state.mode === "ambient") {
      this.lastAmbient = this.state.track;
    }
    this.fadeTo(0, 500, () => {
      this.emit({ mode, track });
      this.load(track, mode);
      this.play();
    });
  }

  /** 用户点暂停/播放 */
  toggle() {
    if (!this.state.unlocked) {
      this.unlock();
      return;
    }
    const audio = this.audio;
    if (!audio || !this.state.track) return;
    if (this.state.playing) {
      audio.pause();
      this.emit({ playing: false });
    } else {
      // 从暂停处继续：不重新 load，避免进度归零
      void this.ctx?.resume();
      this.play();
    }
  }

  /** ambient 播完自动换下一首；dedicated 从头续播 */
  private onEnded() {
    const track = this.state.mode === "ambient" ? this.pickAmbient() : this.state.track;
    if (!track) return;
    this.emit({ track });
    this.load(track, this.state.mode);
    this.play();
  }

  private pickAmbient(): Track {
    if (this.poolIdx >= this.pool.length) {
      const last = this.pool[this.pool.length - 1];
      this.pool = this.shuffled(globalTracks);
      // 新一轮避免立刻重复刚播完的那首
      if (this.pool[0] === last && this.pool.length > 1) {
        const i = 1 + Math.floor(Math.random() * (this.pool.length - 1));
        [this.pool[0], this.pool[i]] = [this.pool[i], this.pool[0]];
      }
      this.poolIdx = 0;
    }
    return this.pool[this.poolIdx++];
  }

  private shuffled<T>(arr: T[]): T[] {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  /* ---------------- 播放内核 ---------------- */

  private load(track: Track, mode: MusicMode) {
    const audio = this.audio;
    if (!audio) return;
    const url = `./Music/${encodeURI(track.file)}`;
    if (!audio.src.endsWith(encodeURI(track.file))) audio.src = url;
    audio.loop = mode === "dedicated";
    audio.currentTime = 0;
    this.emit({ error: null });
  }

  private play() {
    const audio = this.audio;
    if (!audio || !this.state.track) return;
    void this.ctx?.resume();
    audio
      .play()
      .then(() => this.emit({ playing: true }))
      .catch(() => {
        /* 手势链断裂等极端情况：保持可点，不报错 */
      });
    this.fadeTo(TARGET_VOLUME, 2200);
  }

  private fadeTo(target: number, ms: number, done?: () => void) {
    const audio = this.audio;
    if (!audio) {
      done?.();
      return;
    }
    cancelAnimationFrame(this.fadeRaf);
    const from = audio.volume;
    const t0 = performance.now();
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / ms);
      const eased = k * (2 - k); // easeOutQuad
      audio.volume = Math.max(0, Math.min(1, from + (target - from) * eased));
      if (k < 1) this.fadeRaf = requestAnimationFrame(step);
      else done?.();
    };
    this.fadeRaf = requestAnimationFrame(step);
  }

  /* ---------------- 频谱数据（给胶囊组件） ---------------- */

  /** 返回 audioConfig.bars 段对数频谱（0..1），无 analyser 时返回全 0 */
  getSpectrum(): Float32Array {
    const bars = audioConfig.bars;
    if (!this.analyser || !this.freq) return this.spectrum.subarray(0, bars).fill(0);
    this.analyser.getByteFrequencyData(this.freq);
    const bins = this.freq.length;
    // 对数取段：低频占更多条，高频合并——天然形成左高右低的"山脉"轮廓
    for (let b = 0; b < bars; b++) {
      const t0 = b / bars;
      const t1 = (b + 1) / bars;
      const lo = Math.floor(Math.pow(t0, 2.2) * bins * 0.55);
      const hi = Math.max(lo + 1, Math.floor(Math.pow(t1, 2.2) * bins * 0.55));
      let sum = 0;
      for (let i = lo; i < hi; i++) sum += this.freq[i];
      const avg = sum / (hi - lo) / 255;
      // 高频段整体增益略提，避免尾部全 0
      const boost = 1 + t1 * 0.8;
      this.spectrum[b] = Math.min(1, avg * boost);
    }
    return this.spectrum.subarray(0, bars);
  }
}

export const music = new MusicManager();
