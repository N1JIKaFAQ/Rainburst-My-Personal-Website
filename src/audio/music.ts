/**
 * 全站背景音乐：无 React 依赖的模块级单例（模式对齐 universe/blackhole.ts）。
 *
 * 三种播放模式：
 *  - ambient  主页随机池（globalTracks），一首播完自动换下一首
 *  - dedicated 板块专属单曲（蓝巨星 = The Great Gig in the Sky），循环不掐断
 *  - queue    专辑播放（网易云直链）：显式曲目队列，顺序/随机/单曲循环
 *
 * 双通道 audio：
 *  - 本地曲目（Track.file）走主元素，串 WebAudio analyser → 胶囊频谱有信号；
 *  - 网络直链（Track.url，如网易云 CDN）走独立元素——跨域音频一旦被
 *    createMediaElementSource 接管会因 CORS 污染输出静音，所以直链绝不进频谱图
 *    （代价：直链播放时胶囊频谱呈低位，属预期）。
 *  - 直链会过期（分钟级）：error 时通过 urlRefresher 回调换新链接自动续播一次。
 *
 * 浏览器自动播放策略决定音频必须等首次用户手势（pointerdown / keydown），
 * 在此之前不创建 AudioContext；手势到来时以当前模式淡入开始播放。
 */
import { audioConfig, blueGiantTrack, globalTracks, type Track } from "../data/site";

export type MusicMode = "ambient" | "dedicated" | "queue";
export type QueueMode = "order" | "shuffle" | "one";

export interface MusicState {
  /** 用户已交互，音频可播 */ unlocked: boolean;
  playing: boolean;
  mode: MusicMode;
  track: Track | null;
  /** 加载失败的曲目名；null = 正常 */ error: string | null;
  /** queue 模式下：队列与指针（胶囊/播放页共享同一事实源） */
  queue: Track[] | null;
  queueIndex: number;
  queueMode: QueueMode;
  /** 秒；timeupdate 驱动（~4Hz），seek 立即更新 */
  currentTime: number;
  duration: number;
  /** 0..1；持久化到 localStorage */
  volume: number;
}

type Listener = (s: MusicState) => void;

const VOL_KEY = "rainburst.volume";

function readStoredVolume(): number {
  try {
    const v = Number(localStorage.getItem(VOL_KEY));
    if (Number.isFinite(v) && v > 0 && v <= 1) return v;
  } catch {
    /* localStorage 不可用 → 默认音量 */
  }
  return audioConfig.volume;
}

class MusicManager {
  private audio: HTMLAudioElement | null = null;
  private audioX: HTMLAudioElement | null = null;
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private freq: Uint8Array<ArrayBuffer> | null = null;
  private spectrum: Float32Array = new Float32Array(1024);
  /** 直链过期时的换新链接回调（由播放页注入：重新请求 song/url） */
  private urlRefresher: ((t: Track) => Promise<string | null>) | null = null;
  private retrying = false;

  private state: MusicState = {
    unlocked: false,
    playing: false,
    mode: "ambient",
    track: null,
    error: null,
    queue: null,
    queueIndex: 0,
    queueMode: "order",
    currentTime: 0,
    duration: 0,
    volume: readStoredVolume(),
  };
  private listeners = new Set<Listener>();
  private fadeRaf = 0;

  /** ambient 池的无重复随机序列 */
  private pool: Track[] = [];
  private poolIdx = 0;
  /** 进入 dedicated 前的 ambient 曲目，返回宇宙时恢复 */
  private lastAmbient: Track | null = null;

  /** 待解锁后执行的模式切换（进页早于首次手势时暂存） */
  private pending: { mode: MusicMode; track: Track; queue?: Track[]; queueIndex?: number } | null = null;

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
    this.emit({
      unlocked: true,
      mode: wanted.mode,
      track: wanted.track,
      queue: wanted.queue ?? null,
      queueIndex: wanted.queueIndex ?? 0,
    });
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
      this.emit({ error: this.state.track?.title ?? this.state.track?.file ?? "未知文件", playing: false });
    });
    audio.addEventListener("timeupdate", () => {
      if (this.currentEl() !== audio) return;
      this.emit({ currentTime: audio.currentTime, duration: audio.duration || 0 });
    });
    audio.addEventListener("loadedmetadata", () => {
      if (this.currentEl() !== audio) return;
      this.emit({ duration: audio.duration || 0, currentTime: 0 });
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

  /** 直链通道：普通 Audio，绝不接进 WebAudio 图（跨域直链被 analyser 接管会静音） */
  private ensureDirect() {
    if (this.audioX) return;
    const a = new Audio();
    a.preload = "metadata";
    a.volume = 0;
    a.addEventListener("ended", () => this.onEnded());
    a.addEventListener("error", () => void this.onDirectError());
    a.addEventListener("timeupdate", () => {
      if (this.currentEl() !== a) return;
      this.emit({ currentTime: a.currentTime, duration: a.duration || 0 });
    });
    a.addEventListener("loadedmetadata", () => {
      if (this.currentEl() !== a) return;
      this.emit({ duration: a.duration || 0, currentTime: 0 });
    });
    this.audioX = a;
  }

  /** 当前曲目对应的播放元素 */
  private currentEl(): HTMLAudioElement | null {
    return this.state.track?.url ? this.audioX : this.audio;
  }

  /** 播放页注入：直链过期时如何换新链接（返回 null = 放弃） */
  setUrlRefresher(fn: ((t: Track) => Promise<string | null>) | null) {
    this.urlRefresher = fn;
  }

  private async onDirectError() {
    const t = this.state.track;
    if (!t?.url) return;
    if (this.urlRefresher && !this.retrying) {
      this.retrying = true;
      try {
        const fresh = await this.urlRefresher(t);
        this.retrying = false;
        if (fresh && this.state.track === t) {
          const nt = { ...t, url: fresh };
          this.emit({ track: nt });
          this.load(nt, "queue");
          this.play();
          return;
        }
      } catch {
        this.retrying = false;
      }
    }
    this.emit({ error: t.title ?? "播放失败", playing: false });
  }

  /* ---------------- 模式切换 ---------------- */

  /** 页面切换入口：ambient ↔ dedicated（离开 queue 时也走这里复位） */
  switchMode(mode: Exclude<MusicMode, "queue">) {
    const sameQueue = this.state.mode !== "queue";
    if (mode === this.state.mode && this.state.track && sameQueue) return;
    if (!this.state.unlocked) {
      // 还没解锁：记住目标模式，首次手势直接以它开播
      this.pending =
        mode === "dedicated"
          ? { mode, track: blueGiantTrack }
          : { mode, track: this.pool[this.poolIdx++ % this.pool.length] };
      this.emit({ mode, track: this.pending.track, queue: null, queueIndex: 0 });
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
      this.emit({ mode, track, queue: null, queueIndex: 0 });
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
    const audio = this.currentEl();
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

  /** ambient 换下一首；dedicated 从头续播；queue 按队列模式推进 */
  private onEnded() {
    if (this.state.mode === "queue" && this.state.queue) {
      if (this.state.queueMode === "one") {
        this.load(this.state.track!, "queue");
        this.play();
        return;
      }
      const q = this.state.queue;
      const nextIdx =
        this.state.queueMode === "shuffle"
          ? q.length > 1
            ? (() => {
                let i = this.state.queueIndex;
                while (i === this.state.queueIndex) i = Math.floor(Math.random() * q.length);
                return i;
              })()
            : this.state.queueIndex
          : (this.state.queueIndex + 1) % q.length;
      this.playAt(nextIdx);
      return;
    }
    const track = this.state.mode === "ambient" ? this.pickAmbient() : this.state.track;
    if (!track) return;
    this.emit({ track });
    this.load(track, this.state.mode);
    this.play();
  }

  /* ---------------- 专辑队列播放（播放放大页） ---------------- */

  /** 以显式队列开播（条目可为本地 file 或直链 url） */
  playQueue(tracks: Track[], index = 0) {
    if (!tracks.length) return;
    if (!this.state.unlocked) {
      this.pending = { mode: "queue", track: tracks[index], queue: tracks, queueIndex: index };
      this.emit({ mode: "queue", track: tracks[index], queue: tracks, queueIndex: index });
      return;
    }
    this.fadeTo(0, 300, () => {
      this.emit({ mode: "queue", queue: tracks, queueIndex: index });
      this.playAt(index);
    });
  }

  /** 队列内切歌（含循环边界） */
  playAt(index: number) {
    const q = this.state.queue;
    if (!q || !q.length) return;
    const i = ((index % q.length) + q.length) % q.length;
    const track = q[i];
    this.fadeTo(0, 250, () => {
      this.emit({ queueIndex: i, track });
      this.load(track, "queue");
      this.play();
    });
  }

  next() {
    if (this.state.mode === "queue") this.playAt(this.state.queueIndex + 1);
  }

  prev() {
    if (this.state.mode === "queue") this.playAt(this.state.queueIndex - 1);
  }

  /** 拖动进度条 */
  seek(sec: number) {
    const audio = this.currentEl();
    if (!audio || !Number.isFinite(audio.duration)) return;
    audio.currentTime = Math.max(0, Math.min(sec, audio.duration - 0.05));
    this.emit({ currentTime: audio.currentTime });
  }

  /** 用户音量 0..1（即时生效 + 持久化，作为后续淡入目标） */
  setVolume(v: number) {
    const vol = Math.max(0, Math.min(1, v));
    this.emit({ volume: vol });
    for (const a of [this.audio, this.audioX]) {
      if (a && (this.state.playing || vol === 0)) a.volume = vol;
    }
    try {
      localStorage.setItem(VOL_KEY, String(vol));
    } catch {
      /* ignore */
    }
  }

  setQueueMode(mode: QueueMode) {
    this.emit({ queueMode: mode });
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
    if (track.url) {
      this.ensureDirect();
      this.audio?.pause();
      const a = this.audioX!;
      if (a.src !== track.url) a.src = track.url;
      a.loop = false;
      a.currentTime = 0;
    } else {
      this.ensureNodes();
      this.audioX?.pause();
      const a = this.audio!;
      const file = track.file ?? "";
      const url = `./Music/${encodeURI(file)}`;
      if (!a.src.endsWith(encodeURI(file))) a.src = url;
      a.loop = mode === "dedicated";
      a.currentTime = 0;
    }
    this.emit({ error: null, currentTime: 0, duration: 0 });
  }

  private play() {
    const audio = this.currentEl();
    if (!audio || !this.state.track) return;
    void this.ctx?.resume();
    audio
      .play()
      .then(() => this.emit({ playing: true }))
      .catch(() => {
        /* 手势链断裂等极端情况：保持可点，不报错 */
      });
    this.fadeTo(this.state.volume, 2200);
  }

  private fadeTo(target: number, ms: number, done?: () => void) {
    const audio = this.currentEl();
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
