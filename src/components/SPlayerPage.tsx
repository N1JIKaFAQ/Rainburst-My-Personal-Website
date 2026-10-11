import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { music, type MusicState, type QueueMode } from "../audio/music";
import {
  allAlbums,
  coverUrl,
  featuredAlbum,
  getAlbum,
  historyAlbums,
  pinnedAlbum,
  playableQueue,
  type Album,
  type AlbumTrack,
  type QueueTrack,
} from "../data/albums";

interface Props {
  /** 打开时聚焦的专辑 id */
  initialAlbumId: string;
  onClose: () => void;
}

const FAV_KEY = "rainburst.fav-tracks";
const RECENT_KEY = "rainburst.recent-tracks";

type View = { kind: "album"; id: string } | { kind: "favorites" } | { kind: "recent" };

const fmtTime = (sec: number) => {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
};
const fmtMs = (ms: number) => (ms > 0 ? fmtTime(ms / 1000) : "--:--");

function loadFav(): string[] {
  try {
    return JSON.parse(localStorage.getItem(FAV_KEY) || "[]");
  } catch {
    return [];
  }
}
function loadRecent(): { key: string; title: string; artist: string; cover: string; at: number }[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
  } catch {
    return [];
  }
}

/* ============================ SPlayer 复刻页 ============================ */

export default function SPlayerPage({ initialAlbumId, onClose }: Props) {
  const [view, setView] = useState<View>({ kind: "album", id: initialAlbumId });
  const [showAllTracks, setShowAllTracks] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [scrub, setScrub] = useState<number | null>(null); // 0..1 拖拽中
  const [favorites, setFavorites] = useState<string[]>(loadFav);
  const [recent, setRecent] = useState(loadRecent);
  /** music 单例 → 本组件：ref 缓存最新 state + 计数触发重渲染 */
  const stateRef = useRef<MusicState>(music.getState());
  const [, bump] = useState(0);
  useEffect(() => music.subscribe((s) => {
    stateRef.current = s;
    bump((x) => x + 1);
  }), []);
  const state = stateRef.current;

  const album = view.kind === "album" ? getAlbum(view.id) : null;
  const playing = state.playing;
  const trackKey = (a: Album | null, t?: { title: string; file: string | null }) =>
    `${a?.id ?? "-"}|${t?.title ?? ""}`;

  /* toast 自动消失 */
  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 2400);
    return () => window.clearTimeout(id);
  }, [toast]);

  /* Esc 退出 */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  /* 最近播放记录：queue 模式下切歌即写 */
  useEffect(() => {
    if (state.mode !== "queue" || !state.track || !album) return;
    const key = trackKey(album, { title: state.track.title, file: state.track.file ?? null });
    setRecent((prev) => {
      const next = [{ key, title: state.track!.title, artist: state.track!.artist, cover: album.cover, at: Date.now() }, ...prev.filter((r) => r.key !== key)].slice(0, 20);
      try {
        localStorage.setItem(RECENT_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.track, state.mode, state.queueIndex]);

  const toggleFav = useCallback((key: string) => {
    setFavorites((prev) => {
      const next = prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key];
      try {
        localStorage.setItem(FAV_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  /** 播放整张专辑的第 index 首（无文件 → toast） */
  const playAlbumAt = useCallback(
    (al: Album, trackIndex: number) => {
      const s = stateRef.current;
      const q = playableQueue(al);
      if (!q.length) {
        setToast("这张专辑还没导入媒体文件（public/Music 放好后 npm run album:scan）");
        return;
      }
      const target = al.tracks[trackIndex];
      const qi = al.tracks.slice(0, trackIndex).filter((t) => t.file).length;
      if (!target?.file) {
        setToast(`「${target?.title ?? ""}」媒体未导入`);
        return;
      }
      const sameQueue =
        s.mode === "queue" &&
        !!s.queue &&
        s.queue.length === q.length &&
        s.queue[0]?.file === q[0]?.file;
      if (sameQueue) music.playAt(qi);
      else music.playQueue(q, qi);
    },
    [],
  );

  /* ---------- 播放条状态 ---------- */
  const barTrack = state.track;
  const duration = state.duration || 0;
  const progress = scrub !== null ? scrub : duration > 0 ? state.currentTime / duration : 0;
  const barAlbum = barTrack
    ? allAlbums.find((a) => a.tracks.some((t) => t.file && t.file === barTrack.file)) ?? album
    : album;
  const favKey = trackKey(barAlbum, { title: barTrack?.title ?? "", file: barTrack?.file ?? null });
  const isFav = favorites.includes(favKey);

  const nextMode: Record<QueueMode, QueueMode> = { order: "shuffle", shuffle: "one", one: "order" };

  /* ---------- 侧栏数据 ---------- */
  const sidebarAlbums = useMemo(() => {
    const ids = [featuredAlbum?.id, pinnedAlbum?.id, ...historyAlbums.map((a) => a.id)];
    return allAlbums.filter((a) => ids.includes(a.id));
  }, []);

  const navBtn =
    "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-[13px] transition-colors duration-200";

  return (
    <div className="anim-fade-in fixed inset-0 z-[60] flex flex-col overflow-hidden text-white" style={{ background: "#0b0708" }}>
      {/* ===== 背景：封面放大铺满 + 强模糊 + 压暗（SPlayer 沉浸取色） ===== */}
      <div className="pointer-events-none absolute inset-[-12%]">
        <img
          src={album ? coverUrl(album) : coverUrl(sidebarAlbums[0])}
          alt=""
          className="h-full w-full scale-110 object-cover opacity-60"
          style={{ filter: "blur(70px) saturate(1.25)" }}
          draggable={false}
        />
        <div className="absolute inset-0" style={{ background: "linear-gradient(180deg, rgba(6,4,5,0.55) 0%, rgba(6,4,5,0.82) 100%)" }} />
      </div>

      <div className="relative flex min-h-0 flex-1">
        {/* ===== 左侧导航栏 ===== */}
        <aside className="hidden w-[230px] shrink-0 flex-col border-r border-white/[0.06] bg-black/40 px-3 pb-3 pt-4 backdrop-blur-xl md:flex">
          <div className="flex items-center gap-2 px-2 pb-4">
            <span className="h-2 w-2 rounded-full" style={{ background: album?.accent ?? "#8fb6ff" }} />
            <span className="text-[13px] font-light uppercase tracking-[0.34em] text-white/90">RainBurst</span>
          </div>

          <p className="px-3 pb-1 pt-2 text-[10px] uppercase tracking-[0.3em] text-white/25">浏览</p>
          <nav className="flex flex-col gap-0.5">
            <button className={navBtn} onClick={() => setView({ kind: "album", id: album?.id ?? initialAlbumId })}>
              <Ico d={IcoPath.home} /> 首页
            </button>
            {(["搜索", "榜单", "音乐库", "已收藏"] as const).map((label) => (
              <button key={label} title="暂未接入" className={`${navBtn} cursor-not-allowed text-white/25`}>
                <Ico d={label === "搜索" ? IcoPath.search : label === "榜单" ? IcoPath.chart : label === "音乐库" ? IcoPath.library : IcoPath.star} />
                {label}
              </button>
            ))}
          </nav>

          <p className="px-3 pb-1 pt-5 text-[10px] uppercase tracking-[0.3em] text-white/25">我的歌单</p>
          <div className="flex flex-col gap-0.5 overflow-y-auto">
            <button className={`${navBtn} text-white/70 hover:bg-white/5 hover:text-white`} onClick={() => setView({ kind: "favorites" })}>
              <Ico d={IcoPath.heart} /> 我喜欢的歌曲 <span className="ml-auto text-[10px] text-white/25">{favorites.length}</span>
            </button>
            <button className={`${navBtn} text-white/70 hover:bg-white/5 hover:text-white`} onClick={() => setView({ kind: "recent" })}>
              <Ico d={IcoPath.clock} /> 最近播放 <span className="ml-auto text-[10px] text-white/25">{recent.length}</span>
            </button>
            {sidebarAlbums.map((a) => {
              const active = view.kind === "album" && view.id === a.id;
              return (
                <button
                  key={a.id}
                  className={`${navBtn} ${active ? "bg-white/[0.07] text-white/95" : "text-white/55 hover:bg-white/5 hover:text-white"}`}
                  onClick={() => {
                    setView({ kind: "album", id: a.id });
                    setShowAllTracks(false);
                  }}
                >
                  <span className="h-[26px] w-[26px] shrink-0 overflow-hidden rounded"><img src={coverUrl(a)} alt="" className="h-full w-full object-cover" draggable={false} /></span>
                  <span className="truncate">{a.title}</span>
                </button>
              );
            })}
          </div>

          <div className="mt-auto flex flex-col gap-0.5 border-t border-white/[0.06] pt-3">
            <button className={`${navBtn} text-white/55`} disabled title="已导入音频数量">
              <Ico d={IcoPath.save} /> 存储 <span className="ml-auto text-[10px] text-white/30">{allAlbums.reduce((s, a) => s + a.tracks.filter((t) => t.file).length, 0)} 首</span>
            </button>
            <button className={`${navBtn} cursor-not-allowed text-white/25`} title="暂未接入">
              <Ico d={IcoPath.settings} /> 设置
            </button>
          </div>
        </aside>

        {/* ===== 主区 ===== */}
        <main className="relative flex min-w-0 flex-1 flex-col overflow-y-auto px-6 pb-4 pt-5 sm:px-10">
          <button
            onClick={() => setView({ kind: "album", id: album?.id ?? initialAlbumId })}
            className="absolute left-5 top-5 flex h-8 w-8 items-center justify-center rounded-full text-white/60 transition-colors duration-200 hover:bg-white/10 hover:text-white"
            title="返回专辑"
          >
            <Ico d={IcoPath.back} />
          </button>

          {view.kind === "album" && album && (
            <div className="mx-auto flex w-full max-w-[520px] flex-1 flex-col items-center text-center">
              <img
                src={coverUrl(album)}
                alt={album.title}
                className="mt-10 h-[180px] w-[180px] rounded-lg object-cover shadow-[0_24px_70px_rgba(0,0,0,0.6)]"
                draggable={false}
                onContextMenu={(e) => e.preventDefault()}
              />
              <h1 className="mt-7 text-[34px] font-thin leading-tight text-white/95">
                {state.mode === "queue" && state.track ? state.track.title : album.title}
              </h1>
              <p className="mt-1.5 text-[12px] font-light text-white/55">
                {album.artist} · {album.date}
              </p>

              {album.intro && (
                <p className="mt-5 max-w-[26rem] text-[12px] font-light leading-relaxed text-white/50">{album.intro}</p>
              )}

              {album.genres.length > 0 && (
                <div className="mt-5 flex flex-wrap justify-center gap-2">
                  {album.genres.map((g) => (
                    <span key={g} className="rounded-full border border-white/10 bg-white/[0.07] px-3.5 py-1 text-[11px] font-light text-white/70">
                      {g}
                    </span>
                  ))}
                </div>
              )}

              <p className="mt-8 text-[12px] font-light text-white/60">「{album.title}」歌曲列表:</p>
              <ul className="mt-3 w-full max-w-[420px]">
                {(showAllTracks ? album.tracks : album.tracks.slice(0, 5)).map((t) => {
                  const isPlaying =
                    !!t.file && state.mode === "queue" && barAlbum?.id === album.id && state.track?.title === t.title;
                  return (
                    <li key={t.n}>
                      <button
                        onClick={() => playAlbumAt(album, album.tracks.indexOf(t))}
                        className={`group flex w-full items-baseline justify-center gap-6 rounded-lg px-3 py-[7px] text-[14px] transition-colors duration-200 hover:bg-white/[0.06] ${
                          isPlaying ? "text-white" : t.file ? "text-white/75" : "text-white/25"
                        }`}
                      >
                        <span className="truncate">{t.title}</span>
                        <span className="shrink-0 font-mono text-[11px] text-white/30">
                          {t.ms > 0 ? fmtMs(t.ms) : isPlaying ? fmtTime(duration) : "--:--"}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              {!showAllTracks && album.tracks.length > 5 && (
                <button className="mt-3 text-[11px] font-light tracking-[0.2em] text-white/40 transition-colors duration-200 hover:text-white/80" onClick={() => setShowAllTracks(true)}>
                  查看全部 {album.tracks.length} 首
                </button>
              )}
            </div>
          )}

          {(view.kind === "favorites" || view.kind === "recent") && (
            <div className="mx-auto flex w-full max-w-[560px] flex-1 flex-col pt-14">
              <h1 className="text-[26px] font-thin text-white/95">{view.kind === "favorites" ? "我喜欢的歌曲" : "最近播放"}</h1>
              <p className="mt-1 text-[11px] font-light tracking-[0.2em] text-white/35">
                {view.kind === "favorites" ? `${favorites.length} 首` : `${recent.length} 条记录`}
              </p>
              <ul className="mt-6 flex flex-col gap-1">
                {(view.kind === "favorites"
                  ? favorites
                      .map((k) => {
                        const [aid, title] = k.split("|");
                        const a = getAlbum(aid);
                        const t = a?.tracks.find((x) => x.title === title);
                        return a && t ? { a, t } : null;
                      })
                      .filter((v): v is { a: Album; t: AlbumTrack } => !!v)
                  : recent
                      .map((r) => {
                        const [aid, title] = r.key.split("|");
                        const a = getAlbum(aid);
                        const t = a?.tracks.find((x) => x.title === title);
                        return a && t ? { a, t } : null;
                      })
                      .filter((v): v is { a: Album; t: AlbumTrack } => !!v)
                ).map(({ a, t }) => (
                  <li key={`${a.id}-${t.title}`}>
                    <button onClick={() => playAlbumAt(a, a.tracks.indexOf(t))} className={`flex w-full items-center gap-4 rounded-lg px-3 py-2.5 text-left transition-colors duration-200 hover:bg-white/[0.06] ${t.file ? "text-white/80" : "text-white/30"}`}>
                      <span className="h-9 w-9 shrink-0 overflow-hidden rounded"><img src={coverUrl(a)} alt="" className="h-full w-full object-cover" draggable={false} /></span>
                      <span className="min-w-0 flex-1"><span className="block truncate text-[14px]">{t.title}</span><span className="block truncate text-[11px] text-white/35">{a.artist} · {a.title}</span></span>
                      <span className="shrink-0 font-mono text-[11px] text-white/30">{t.ms > 0 ? fmtMs(t.ms) : ""}</span>
                    </button>
                  </li>
                ))}
                {view.kind === "favorites" && favorites.length === 0 && (
                  <li className="py-10 text-center text-[12px] font-light text-white/30">还没有收藏，点播放条左边的 ♥ 试试</li>
                )}
                {view.kind === "recent" && recent.length === 0 && (
                  <li className="py-10 text-center text-[12px] font-light text-white/30">播放过的歌会自动记录在这里</li>
                )}
              </ul>
            </div>
          )}
        </main>
      </div>

      {/* ===== 队列抽屉 ===== */}
      {queueOpen && (
        <div className="anim-fade-in absolute bottom-[76px] right-4 z-50 max-h-[46vh] w-[300px] overflow-y-auto rounded-2xl border border-white/10 bg-black/70 p-2 shadow-2xl backdrop-blur-2xl">
          <p className="px-3 py-2 text-[11px] uppercase tracking-[0.28em] text-white/35">播放队列</p>
          {(state.queue ?? []).map((q, i) => (
            <button
              key={`${q.file}-${i}`}
              onClick={() => music.playAt(i)}
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-[13px] transition-colors duration-200 hover:bg-white/[0.06] ${i === state.queueIndex ? "text-white" : "text-white/60"}`}
            >
              <span className="w-4 shrink-0 font-mono text-[10px] text-white/25">{i + 1}</span>
              <span className="min-w-0 flex-1 truncate">{q.title}</span>
              {i === state.queueIndex && <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full" style={{ background: barAlbum?.accent ?? "#fff" }} />}
            </button>
          ))}
          {!state.queue?.length && <p className="px-3 py-4 text-center text-[12px] text-white/30">队列空着——去专辑列表里点一首</p>}
        </div>
      )}

      {/* ===== 底部播放条 ===== */}
      <footer className="relative z-40 flex h-[68px] shrink-0 items-center gap-4 border-t border-white/[0.07] bg-black/55 px-4 backdrop-blur-2xl sm:px-6">
        {/* 左：当前曲 */}
        <div className="flex w-[26%] min-w-0 items-center gap-3">
          {barAlbum && <img src={coverUrl(barAlbum)} alt="" className="h-10 w-10 shrink-0 rounded object-cover" draggable={false} />}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] text-white/90">{barTrack?.title ?? (album?.title ?? "未选择曲目")}</span>
            <span className="block truncate text-[10px] text-white/40">{barTrack?.artist ?? album?.artist ?? ""}</span>
          </span>
          <button
            onClick={() => barTrack && toggleFav(favKey)}
            title="收藏"
            className={`shrink-0 transition-all duration-200 hover:scale-110 ${isFav ? "text-[#ff5f7a]" : "text-white/40 hover:text-white/80"}`}
          >
            <Ico d={isFav ? IcoPath.heartFill : IcoPath.heart} solid={isFav} />
          </button>
        </div>

        {/* 中：控件 + 进度 */}
        <div className="flex flex-1 flex-col items-center gap-1">
          <div className="flex items-center gap-5">
            <button
              onClick={() => music.setQueueMode(nextMode[state.queueMode])}
              title={`播放模式：${state.queueMode === "order" ? "顺序" : state.queueMode === "shuffle" ? "随机" : "单曲循环"}`}
              className="text-white/55 transition-colors duration-200 hover:text-white"
            >
              <Ico d={state.queueMode === "shuffle" ? IcoPath.shuffle : state.queueMode === "one" ? IcoPath.repeat1 : IcoPath.repeat} />
            </button>
            <button onClick={() => music.prev()} className="text-white/70 transition-colors duration-200 hover:text-white" title="上一首">
              <Ico d={IcoPath.prev} />
            </button>
            <button
              onClick={() => {
                if (state.mode !== "queue") {
                  const q = playableQueue(album ?? sidebarAlbums[0]);
                  if (!q.length) {
                    setToast("这张专辑还没导入媒体文件");
                    return;
                  }
                  music.playQueue(q as QueueTrack[], 0);
                  return;
                }
                music.toggle();
              }}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-black transition-transform duration-200 hover:scale-105 active:scale-95"
              title={playing && state.mode === "queue" ? "暂停" : "播放"}
            >
              <Ico d={playing && state.mode === "queue" ? IcoPath.pause : IcoPath.play} solid />
            </button>
            <button onClick={() => music.next()} className="text-white/70 transition-colors duration-200 hover:text-white" title="下一首">
              <Ico d={IcoPath.next} />
            </button>
            <button className="text-white/40 transition-colors duration-200 hover:text-white" title="更多（暂未接入）" disabled>
              <Ico d={IcoPath.dots} />
            </button>
          </div>
          <div className="flex w-full max-w-[560px] items-center gap-3">
            <span className="w-9 shrink-0 text-right font-mono text-[10px] text-white/40">{fmtTime(scrub !== null ? scrub * duration : state.currentTime)}</span>
            <Progressbar
              value={progress}
              accent={barAlbum?.accent ?? "#ffffff"}
              onScrub={(v) => setScrub(v)}
              onCommit={(v) => {
                setScrub(null);
                music.seek(v * duration);
              }}
            />
            <span className="w-9 shrink-0 font-mono text-[10px] text-white/40">{fmtTime(duration)}</span>
          </div>
        </div>

        {/* 右：队列/桌面端占位/音量 */}
        <div className="flex w-[26%] items-center justify-end gap-3">
          <button
            onClick={() => setQueueOpen((q) => !q)}
            title="播放列表"
            className={`transition-colors duration-200 hover:text-white ${queueOpen ? "text-white" : "text-white/55"}`}
          >
            <Ico d={IcoPath.list} />
          </button>
          <button className="hidden rounded-md border border-white/10 px-2.5 py-1 text-[10px] text-white/25 lg:block" title="桌面客户端功能" disabled>桌面歌词</button>
          <button className="hidden rounded-md border border-white/10 px-2.5 py-1 text-[10px] text-white/25 lg:block" title="桌面客户端功能" disabled>迷你窗口</button>
          <button onClick={() => music.setVolume(state.volume > 0 ? 0 : 0.6)} className="text-white/55 transition-colors duration-200 hover:text-white" title="静音">
            <Ico d={state.volume === 0 ? IcoPath.mute : IcoPath.volume} />
          </button>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(state.volume * 100)}
            onChange={(e) => music.setVolume(Number(e.target.value) / 100)}
            className="hidden w-20 accent-white/70 sm:block"
            aria-label="音量"
          />
        </div>
      </footer>

      {/* 顶栏退出（浏览器里没有窗口按钮，给一个明确的返回） */}
      <button
        onClick={onClose}
        className="absolute right-4 top-4 z-50 flex items-center gap-2 rounded-full border border-white/12 bg-black/45 px-4 py-1.5 text-[11px] font-light uppercase tracking-[0.28em] text-white/60 backdrop-blur-xl transition-colors duration-300 hover:text-white"
      >
        <Ico d={IcoPath.back} /> 返回蓝巨星
      </button>

      {/* toast */}
      {toast && (
        <div className="anim-caption-in absolute bottom-[92px] left-1/2 z-50 -translate-x-1/2 whitespace-nowrap rounded-full border border-white/10 bg-black/75 px-5 py-2 text-[12px] font-light text-white/85 backdrop-blur-xl">
          {toast}
        </div>
      )}
    </div>
  );
}

/* ---------------- 进度条（可拖） ---------------- */
function Progressbar({ value, accent, onScrub, onCommit }: { value: number; accent: string; onScrub: (v: number) => void; onCommit: (v: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState(false);
  const posFromEvent = (clientX: number) => {
    const el = ref.current;
    if (!el) return 0;
    const r = el.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - r.left) / r.width));
  };
  return (
    <div
      ref={ref}
      className="group relative flex h-4 flex-1 cursor-pointer items-center"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onPointerDown={(e) => {
        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
        onScrub(posFromEvent(e.clientX));
      }}
      onPointerMove={(e) => {
        if (e.buttons & 1) onScrub(posFromEvent(e.clientX));
      }}
      onPointerUp={(e) => onCommit(posFromEvent(e.clientX))}
    >
      <div className="relative h-[3px] w-full rounded-full bg-white/15">
        <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${value * 100}%`, background: hover ? accent : "rgba(255,255,255,0.75)" }} />
        <span
          className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white opacity-0 shadow transition-opacity duration-150 group-hover:opacity-100"
          style={{ left: `${value * 100}%` }}
        />
      </div>
    </div>
  );
}

/* ---------------- 图标 ---------------- */
const IcoPath: Record<string, string> = {
  home: "M3 10.5 12 3l9 7.5M5 9.5V21h5v-6h4v6h5V9.5",
  search: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm5 12 5 5",
  chart: "M4 20V10M10 20V4M16 20v-7M22 20H2",
  library: "M4 4h6v16H4zM13 4h3v16h-3zM19 5l3 14",
  star: "m12 3 2.7 5.8 6.3.8-4.6 4.2 1.2 6.2L12 17l-5.6 3 1.2-6.2L3 9.6l6.3-.8Z",
  heart: "M12 20s-7.5-4.6-9.3-9.2C1.4 7.6 3.4 4.5 6.6 4.5c2 0 3.6 1.1 4.4 2.4l1 1.6 1-1.6c.8-1.3 2.4-2.4 4.4-2.4 3.2 0 5.2 3.1 3.9 6.3C17.5 15.4 12 20 12 20Z",
  heartFill: "M12 20s-7.5-4.6-9.3-9.2C1.4 7.6 3.4 4.5 6.6 4.5c2 0 3.6 1.1 4.4 2.4l1 1.6 1-1.6c.8-1.3 2.4-2.4 4.4-2.4 3.2 0 5.2 3.1 3.9 6.3C17.5 15.4 12 20 12 20Z",
  clock: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 4v5l3.5 2",
  save: "M4 4h12l4 4v12H4zM8 4v5h8V4M8 20v-6h8v6",
  settings: "M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Zm8.5 3.5-2 .8-.5 1.3 1.1 1.9-1.5 1.5-1.9-1.1-1.3.5-.8 2h-2.2l-.8-2-1.3-.5-1.9 1.1-1.5-1.5 1.1-1.9-.5-1.3-2-.8v-2.2l2-.8.5-1.3L5.2 7l1.5-1.5L8.6 6.6l1.3-.5.8-2h2.2l.8 2 1.3.5 1.9-1.1L21 7l-1.1 1.9.5 1.3 2 .8Z",
  back: "m14 6-6 6 6 6",
  play: "M7 4.5v15l13-7.5Z",
  pause: "M7 4.5h3.4v15H7zM13.6 4.5H17v15h-3.4z",
  prev: "M7 5v14M19 5.5 9.5 12l9.5 6.5Z",
  next: "M17 5v14M5 5.5 14.5 12 5 18.5Z",
  shuffle: "M17 3.5 21 7l-4 3.5M17 13.5 21 17l-4 3.5M3 7h3.5c4 0 5 3.5 8.5 9.5M3 17h3.5c2-4.5 3-7 5.5-9",
  repeat: "M7 4.5h9.5L21 8l-4.5 3.5H7a2 2 0 0 0-2 2V15M17 19.5H7.5L3 16l4.5-3.5H17a2 2 0 0 0 2-2V9",
  repeat1: "M7 4.5h9.5L21 8l-4.5 3.5H7a2 2 0 0 0-2 2V15M17 19.5H7.5L3 16l4.5-3.5H17a2 2 0 0 0 2-2V9M11.5 15.5v-4l-1.5 1",
  dots: "M5 12h.01M12 12h.01M19 12h.01",
  list: "M4 6h16M4 12h10M4 18h10M18 15v6l4.5-3Z",
  volume: "M4 9.5v5h4l5 4.5V5l-5 4.5zM16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12",
  mute: "M4 9.5v5h4L13 19V5L8 9.5zM17 9.5l4 5m0-5-4 5",
};

function Ico({ d, solid = false }: { d: string; solid?: boolean }) {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill={solid ? "currentColor" : "none"}
      stroke={solid ? "none" : "currentColor"}
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0"
    >
      <path d={d} />
    </svg>
  );
}
