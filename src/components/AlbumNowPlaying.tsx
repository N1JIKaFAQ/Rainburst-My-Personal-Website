import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { music, type MusicState, type QueueMode } from "../audio/music";
import type { Track } from "../data/site";
import { allAlbums, coverUrl, getAlbum, type Album } from "../data/albums";
import { ncmConfigured, getCookie, setCookie } from "../netease/config";
import { account, albumDetail, artistAlbums, like, lyricRaw, songUrls, type NcmAlbumBrief, type NcmAlbumDetail } from "../netease/api";
import { lyricIndexAt, parseLrc, type LrcLine } from "../netease/lrc";
import LoginModal from "../netease/login";

/* ---------- FLIP 转场 ---------- */
const HERO_MS = 640;
const HERO_EASE = "cubic-bezier(0.32, 0.72, 0, 1)";

interface Props {
  initialAlbumId: string;
  /** 打开瞬间卡片封面的视口矩形（FLIP 起点），可选 */
  originRect?: { x: number; y: number; width: number; height: number };
  onClose: () => void;
}

const fmtTime = (sec: number) => {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  return `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;
};

interface Row {
  id: number;
  title: string;
  artist: string;
  ms: number;
}

/** 专辑组里未入库的网易云专辑 → 虚拟 Album（只用于播放浏览，卡片库不落地） */
function virtualAlbum(a: NcmAlbumBrief): Album {
  return {
    id: `ncm:${a.id}`,
    title: a.name,
    artist: a.artist.name,
    year: String(new Date(a.publishTime || Date.now()).getFullYear()),
    date: "",
    genres: [],
    cover: `${a.picUrl}?param=600x600`,
    accent: "#e0a25c",
    intro: "",
    ncmId: a.id,
    tracks: [],
  };
}

export default function AlbumNowPlaying({ initialAlbumId, originRect, onClose }: Props) {
  /* ---------- music 单例订阅 ---------- */
  const stateRef = useRef<MusicState>(music.getState());
  const [, bump] = useState(0);
  useEffect(
    () =>
      music.subscribe((s) => {
        stateRef.current = s;
        bump((x) => x + 1);
      }),
    [],
  );
  const st = stateRef.current;

  /* ---------- 视图态 ---------- */
  const [album, setAlbum] = useState<Album>(() => getAlbum(initialAlbumId) ?? allAlbums[0]);
  const [detail, setDetail] = useState<NcmAlbumDetail | null>(null);
  const [related, setRelated] = useState<NcmAlbumBrief[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [playingId, setPlayingId] = useState<number | null>(null);
  const [lyr, setLyr] = useState<{ lines: LrcLine[]; credits: Record<string, string> }>({ lines: [], credits: {} });
  const [urlMap, setUrlMap] = useState<Map<number, string>>(new Map());
  const [canPlayMap, setCanPlayMap] = useState<Map<number, boolean>>(new Map());
  const [login, setLogin] = useState<{ ok: boolean; nickname?: string; avatarUrl?: string }>({ ok: false });
  const [loginOpen, setLoginOpen] = useState(false);
  const [pendingPlay, setPendingPlay] = useState<number | null>(null);
  const [bigCover, setBigCover] = useState(true);
  const [userToggledView, setUserToggledView] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [scrub, setScrub] = useState<number | null>(null);
  const [faved, setFaved] = useState(false);
  const fetchingRef = useRef(false);

  const heroRef = useRef<HTMLImageElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const lyricBoxRef = useRef<HTMLDivElement>(null);
  const manualUntil = useRef(0);
  const closingRef = useRef(false);

  const ncmId = album?.ncmId ?? null;
  const apiOn = ncmConfigured();
  const loggedIn = login.ok;

  /* ---------- toast 自动消失 ---------- */
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 2600);
    return () => window.clearTimeout(t);
  }, [toast]);

  /* ---------- 登录态 ---------- */
  const refreshAccount = useCallback(async () => {
    if (!getCookie() || !ncmConfigured()) {
      setLogin({ ok: false });
      return;
    }
    const acc = await account();
    setLogin(acc.ok ? { ok: true, nickname: acc.nickname, avatarUrl: acc.avatarUrl } : { ok: false });
  }, []);
  useEffect(() => {
    void refreshAccount();
  }, [refreshAccount]);

  /* ---------- 专辑装载：详情 + 曲目表 + 专辑组 ---------- */
  useEffect(() => {
    let alive = true;
    setDetail(null);
    setRelated([]);
    setUrlMap(new Map());
    setCanPlayMap(new Map());
    if (!ncmId) {
      setRows(
        (album?.tracks ?? []).map((t) => ({ id: -(t.n || 0), title: t.title, artist: album?.artist ?? "", ms: t.ms })),
      );
      setLyr({ lines: [], credits: {} });
      return () => {
        alive = false;
      };
    }
    void (async () => {
      try {
        const d = await albumDetail(ncmId);
        if (!alive || !d) return;
        setDetail(d);
        setRows(
          (d.songs ?? []).map((s) => ({
            id: s.id,
            title: s.name,
            artist: (s.artists ?? []).map((a) => a.name).join(" / "),
            ms: s.duration ?? s.dt ?? 0,
          })),
        );
        try {
          const list = await artistAlbums(d.artist.id);
          if (alive) setRelated(list.filter((x) => x.id !== ncmId).slice(0, 6));
        } catch {
          /* 专辑组非关键路径 */
        }
      } catch {
        if (alive) {
          setRows((album?.tracks ?? []).map((t) => ({ id: -(t.n || 0), title: t.title, artist: album?.artist ?? "", ms: t.ms })));
          setToast("网易云接口请求失败");
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [ncmId, album?.id]);

  /* ---------- 队列 → playingId ---------- */
  useEffect(() => {
    if (st.mode !== "queue") setPlayingId(null);
    else if (st.track) setPlayingId(Number(st.track.titleEn) || null);
  }, [st.mode, st.track]);

  /* ---------- 当前曲目歌词 ---------- */
  useEffect(() => {
    if (!playingId) {
      setLyr({ lines: [], credits: {} });
      return;
    }
    let alive = true;
    void lyricRaw(playingId)
      .then((raw) => alive && setLyr(parseLrc(raw)))
      .catch(() => alive && setLyr({ lines: [], credits: {} }));
    return () => {
      alive = false;
    };
  }, [playingId]);

  /* ---------- 有词且在播 → 自动从大封面切到歌词（一次） ---------- */
  useEffect(() => {
    if (!userToggledView && bigCover && lyr.lines.length > 0 && st.playing) setBigCover(false);
  }, [lyr.lines.length, st.playing, bigCover, userToggledView]);

  /* ---------- 拉全专辑直链（登录后首次播放时一次批量） ---------- */
  const ensureUrls = useCallback(
    async (ids: number[]): Promise<Map<number, string>> => {
      if (urlMap.size) return urlMap;
      if (fetchingRef.current) return new Map();
      fetchingRef.current = true;
      const fresh = new Map<number, string>();
      const okM = new Map<number, boolean>();
      try {
        for (let i = 0; i < ids.length; i += 50) {
          const part = await songUrls(ids.slice(i, i + 50));
          for (const p of part) {
            if (p.url) {
              fresh.set(p.id, p.url);
              okM.set(p.id, true);
            } else okM.set(p.id, false);
          }
        }
        setUrlMap(fresh);
        setCanPlayMap(okM);
      } catch {
        setToast("播放链接获取失败");
      } finally {
        fetchingRef.current = false;
      }
      return fresh;
    },
    [urlMap],
  );

  /* ---------- 播放 ---------- */
  const playRow = useCallback(
    async (row: Row) => {
      if (!ncmId) {
        setToast("这张专辑还没接入网易云（部署服务后 npm run album --ncm 重新灌入）");
        return;
      }
      if (!apiOn) {
        setToast("播放服务未配置：部署 api-enhanced 并填 src/netease/config.ts");
        return;
      }
      if (!loggedIn) {
        setPendingPlay(row.id);
        setLoginOpen(true);
        return;
      }
      const ids = rows.filter((r) => r.id > 0).map((r) => r.id);
      let urls = urlMap;
      if (!urls.size) urls = await ensureUrls(ids);
      let u = urls.get(row.id);
      if (!u) {
        // 单曲再试一次（可能批量时该曲无权限/临时失败）
        try {
          const r = (await songUrls([row.id])).find((x) => x.id === row.id);
          u = r?.url ?? undefined;
        } catch {
          /* 下面统一提示 */
        }
        if (!u) {
          setToast("该曲目在你的账号下不可播（VIP/版权）");
          return;
        }
        urls = new Map(urls).set(row.id, u);
        setUrlMap(urls);
      }
      const queue: Track[] = ids
        .filter((id) => urls.has(id))
        .map((id) => {
          const r = rows.find((x) => x.id === id)!;
          return { title: r.title, titleEn: String(id), artist: r.artist || album.artist, url: urls.get(id) };
        });
      const qi = Math.max(0, queue.findIndex((t) => t.titleEn === String(row.id)));
      music.playQueue(queue, qi);
      music.setUrlRefresher(async (t) => {
        const id = Number(t.titleEn);
        if (!id) return null;
        try {
          const r = (await songUrls([id])).find((x) => x.id === id);
          if (r?.url) {
            setUrlMap((m) => new Map(m).set(id, r.url!));
            return r.url;
          }
        } catch {
          /* 刷新失败按普通错误处理 */
        }
        return null;
      });
    },
    [ncmId, apiOn, loggedIn, rows, urlMap, ensureUrls, album],
  );

  /* 登录成功 → 续播 */
  useEffect(() => {
    if (loggedIn && pendingPlay) {
      const id = pendingPlay;
      setPendingPlay(null);
      const r = rows.find((x) => x.id === id);
      if (r) void playRow(r);
    }
  }, [loggedIn, pendingPlay, rows, playRow]);

  /* ---------- FLIP 入场 ---------- */
  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const hero = heroRef.current;
    if (reduced || !hero || !originRect || originRect.width < 8) return;
    const to = hero.getBoundingClientRect();
    if (!to.width) return;
    const dx = originRect.x + originRect.width / 2 - (to.x + to.width / 2);
    const dy = originRect.y + originRect.height / 2 - (to.y + to.height / 2);
    const sc = originRect.width / to.width;
    hero.style.transition = "none";
    hero.style.transform = `translate(${dx}px, ${dy}px) scale(${sc})`;
    hero.style.opacity = "0.9";
    void hero.offsetWidth;
    requestAnimationFrame(() => {
      hero.style.transition = `transform ${HERO_MS}ms ${HERO_EASE}, opacity ${HERO_MS * 0.6}ms ease`;
      hero.style.transform = "translate(0px, 0px) scale(1)";
      hero.style.opacity = "1";
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------- 退出（反向 FLIP） ---------- */
  const close = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const hero = heroRef.current;
    const root = rootRef.current;
    if (!reduced && hero && root && originRect && originRect.width >= 8) {
      const to = hero.getBoundingClientRect();
      const dx = originRect.x + originRect.width / 2 - (to.x + to.width / 2);
      const dy = originRect.y + originRect.height / 2 - (to.y + to.height / 2);
      const sc = originRect.width / to.width;
      hero.style.transition = `transform ${HERO_MS * 0.85}ms ${HERO_EASE}, opacity ${HERO_MS * 0.6}ms ease`;
      hero.style.transform = `translate(${dx}px, ${dy}px) scale(${sc})`;
      hero.style.opacity = "0.35";
      root.style.transition = `opacity ${HERO_MS * 0.7}ms ease`;
      root.style.opacity = "0";
      window.setTimeout(onClose, HERO_MS * 0.8);
    } else {
      onClose();
    }
  }, [onClose, originRect]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !loginOpen) close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close, loginOpen]);

  /* ---------- 歌词滚动 ---------- */
  const activeIdx = useMemo(() => lyricIndexAt(lyr.lines, st.currentTime), [lyr.lines, st.currentTime]);
  useEffect(() => {
    if (performance.now() < manualUntil.current) return;
    const box = lyricBoxRef.current;
    if (!box || activeIdx < 0) return;
    const line = box.children[activeIdx] as HTMLElement | undefined;
    if (line) box.scrollTo({ top: line.offsetTop - box.clientHeight / 2 + line.clientHeight / 2, behavior: "smooth" });
  }, [activeIdx]);

  /* ---------- 播放条 ---------- */
  const curRow = rows.find((r) => r.id === playingId) ?? null;
  const duration = st.duration || 0;
  const progress = scrub !== null ? scrub : duration > 0 ? st.currentTime / duration : 0;
  const nextMode: Record<QueueMode, QueueMode> = { order: "shuffle", shuffle: "one", one: "order" };

  const toggleFav = async () => {
    if (!loggedIn || !playingId) {
      setToast("登录后才能把曲目红心到你自己的网易云账号");
      return;
    }
    try {
      await like(playingId, !faved);
      setFaved(!faved);
    } catch {
      setToast("红心失败");
    }
  };

  const coverSrc = coverUrl(album);
  const accent = album.accent || "#e0a25c";

  return (
    <div ref={rootRef} className="fixed inset-0 z-[60] overflow-hidden text-white" style={{ background: "#0a0605" }}>
      {/* ===== 背景：当前封面 blur + 暖压暗（换专 crossfade 靠 key + anim-fade-in） ===== */}
      <div key={coverSrc} className="anim-fade-in pointer-events-none absolute inset-[-14%]">
        <img src={coverSrc} alt="" className="h-full w-full scale-110 object-cover" style={{ filter: "blur(72px) saturate(1.3)" }} draggable={false} />
        <div
          className="absolute inset-0"
          style={{
            background: `linear-gradient(180deg, rgba(10,6,5,0.5) 0%, rgba(10,6,5,0.85) 100%), radial-gradient(120% 90% at 50% -10%, ${accent}26 0%, transparent 55%)`,
          }}
        />
      </div>

      {/* ===== 顶栏 ===== */}
      <div className="absolute inset-x-0 top-0 z-40 flex items-center justify-between px-5 py-4 sm:px-8">
        <button onClick={close} className="flex cursor-pointer items-center gap-2 rounded-full border border-white/12 bg-black/40 px-4 py-1.5 text-[11px] font-light uppercase tracking-[0.28em] text-white/60 backdrop-blur-xl transition-colors duration-300 hover:text-white">
          <Ico d={IcoPath.back} /> 返回蓝巨星
        </button>
        {login.ok ? (
          <div className="flex items-center gap-2.5 rounded-full border border-white/12 bg-black/40 py-1 pl-1 pr-4 backdrop-blur-xl">
            {login.avatarUrl && <img src={`${login.avatarUrl}?param=80x80`} alt="" className="h-7 w-7 rounded-full object-cover" />}
            <span className="text-[11px] font-light text-white/80">{login.nickname ?? "已登录"}</span>
            <button
              onClick={() => {
                setCookie("");
                setLogin({ ok: false });
                setUrlMap(new Map());
                setCanPlayMap(new Map());
                setToast("已退出登录");
              }}
              className="cursor-pointer text-[10px] tracking-[0.2em] text-white/40 transition-colors hover:text-white"
            >
              退出
            </button>
          </div>
        ) : (
          <button onClick={() => setLoginOpen(true)} className="cursor-pointer rounded-full border px-4 py-1.5 text-[11px] font-light tracking-[0.24em] backdrop-blur-xl transition-all duration-300 hover:brightness-125" style={{ borderColor: `${accent}66`, background: `${accent}1f`, color: "#fff" }}>
            扫码登录
          </button>
        )}
      </div>

      {/* ===== 主体：中列（大封面 ⇄ 歌词） + 右列曲目表 ===== */}
      <div className="relative flex h-full items-stretch pb-[118px] pt-14 sm:gap-8">
        <div className="flex min-w-0 flex-1 items-center justify-center px-6">
          {bigCover ? (
            <img
              ref={heroRef}
              src={coverSrc}
              alt={album.title}
              className="h-[min(40vh,340px)] w-[min(40vh,340px)] rounded-2xl object-cover shadow-[0_30px_90px_rgba(0,0,0,0.6)]"
              draggable={false}
              style={{ transformOrigin: "center", willChange: "transform" }}
            />
          ) : lyr.lines.length > 0 ? (
            <div ref={lyricBoxRef} onWheel={() => (manualUntil.current = performance.now() + 3000)} className="h-[58vh] w-full max-w-[560px] overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <div className="h-[24vh]" />
              {lyr.lines.map((l, i) => (
                <button
                  key={`${l.t}-${i}`}
                  onClick={() => {
                    manualUntil.current = 0;
                    music.seek(l.t + 0.2);
                  }}
                  className={`block w-full cursor-pointer py-[8px] text-left text-[22px] leading-snug transition-all duration-500 ${
                    i === activeIdx ? "text-[33px] font-normal text-white" : i < activeIdx ? "font-light text-white/25 hover:text-white/50" : "font-light text-white/40 hover:text-white/65"
                  }`}
                >
                  {l.text}
                </button>
              ))}
              <div className="h-[26vh]" />
            </div>
          ) : (
            <div className="max-w-[560px] px-4 text-center">
              <h1 className="text-[40px] font-thin leading-tight text-white/95 sm:text-[48px]">{curRow?.title ?? album.title}</h1>
              <p className="mt-4 text-[13px] font-light text-white/60">
                {curRow?.artist || detail?.artist?.name || album.artist}
                {detail?.publishTime ? ` · ${new Date(detail.publishTime).getFullYear()}` : album.year ? ` · ${album.year}` : ""}
              </p>
              <p className="mt-2 text-[11px] font-light uppercase tracking-[0.32em] text-white/30">暂无歌词</p>
              <div className="mt-9 space-y-2 text-[12px] font-light text-white/45">
                {lyr.credits["作词"] && <p>作词 : {lyr.credits["作词"]}</p>}
                {lyr.credits["作曲"] && <p>作曲 : {lyr.credits["作曲"]}</p>}
                {lyr.credits["编曲"] && <p>编曲 : {lyr.credits["编曲"]}</p>}
                {album.intro && <p className="leading-relaxed">{album.intro}</p>}
              </div>
            </div>
          )}
        </div>

        {/* 右列：本专辑曲目表 */}
        <aside className="hidden w-[340px] shrink-0 flex-col pb-4 pr-6 xl:flex 2xl:w-[380px]">
          <p className="px-4 py-3 text-[13px] font-light text-white/70">
            {detail?.name ?? album.title} <span className="text-white/35">· {detail?.artist?.name ?? album.artist}</span>
          </p>
          <div className="min-h-0 flex-1 overflow-y-auto pr-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {rows.map((r) => {
              const isCur = r.id === playingId;
              const known = urlMap.size > 0;
              const ok = known ? (urlMap.has(r.id) ? true : canPlayMap.get(r.id) ?? false) : true;
              return (
                <button
                  key={r.id}
                  onClick={() => void playRow(r)}
                  className={`group flex w-full cursor-pointer items-center gap-3 rounded-lg px-4 py-2.5 text-left transition-colors duration-200 hover:bg-white/[0.07] ${isCur ? "text-white" : ok ? "text-white/70" : "text-white/28"}`}
                >
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate text-[14px] ${isCur ? "font-normal" : "font-light"}`}>{r.title}</span>
                    <span className="block truncate text-[11px] text-white/35">{r.artist || album.artist}</span>
                  </span>
                  {isCur ? (
                    <EqBars accent={accent} playing={st.playing && st.mode === "queue"} />
                  ) : !ncmId || (loggedIn && ok) || (!known && !loggedIn) ? (
                    <span className={loggedIn || !ncmId ? "text-white/25 transition-colors group-hover:text-white/80" : "text-white/15"}>
                      <Ico d={IcoPath.play} />
                    </span>
                  ) : (
                    <span className="text-white/15"><Ico d={IcoPath.playNo} /></span>
                  )}
                </button>
              );
            })}
          </div>
        </aside>
      </div>

      {/* ===== 底部：专辑组 + 播放条胶囊 ===== */}
      <div className="absolute inset-x-0 bottom-0 z-40 pb-4">
        {related.length > 0 && (
          <div className="mb-4 flex items-end justify-center gap-4 overflow-x-auto px-6 py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <p className="shrink-0 self-center pr-2 text-[10px] font-light uppercase tracking-[0.32em] text-white/30">专辑组</p>
            {related.map((a) => (
              <button
                key={a.id}
                onClick={() => {
                  const lib = allAlbums.find((x) => x.ncmId === a.id);
                  const target = lib ?? virtualAlbum(a);
                  setAlbum(target);
                  setBigCover(true);
                  setUserToggledView(false);
                }}
                className="group shrink-0 cursor-pointer text-center"
                title={`${a.name} · ${a.artist.name}`}
              >
                <span className="block h-[72px] w-[72px] overflow-hidden rounded-lg shadow-[0_10px_28px_rgba(0,0,0,0.5)] transition-transform duration-300 group-hover:-translate-y-1">
                  <img src={`${a.picUrl}?param=300x300`} alt={a.name} className="h-full w-full object-cover" loading="lazy" draggable={false} />
                </span>
                <span className="mt-1.5 block max-w-[96px] truncate text-[10px] font-light text-white/50 transition-colors duration-300 group-hover:text-white/85">{a.name}</span>
              </button>
            ))}
          </div>
        )}

        <div className="mx-auto flex w-[min(1080px,94vw)] items-center gap-4 rounded-2xl border border-white/[0.08] bg-[#140d09]/75 px-4 py-3 shadow-[0_20px_60px_rgba(0,0,0,0.55)] backdrop-blur-2xl">
          <div className="flex w-[26%] min-w-0 items-center gap-3">
            {!bigCover && <img src={coverSrc} alt="" className="h-10 w-10 shrink-0 rounded-lg object-cover shadow-lg" draggable={false} style={{ display: bigCover ? "none" : undefined }} />}
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] text-white/90">{curRow?.title ?? album.title}</p>
              <p className="truncate text-[10px] text-white/40">{curRow?.artist ?? album.artist}</p>
            </div>
            <button onClick={() => void toggleFav()} className={`shrink-0 cursor-pointer transition-all duration-200 hover:scale-110 ${faved ? "text-[#ff5f7a]" : "text-white/35 hover:text-white/75"}`} title="红心到你的网易云">
              <Ico d={faved ? IcoPath.heartFill : IcoPath.heart} solid={faved} />
            </button>
          </div>

          <div className="flex flex-1 flex-col items-center gap-1">
            <div className="flex items-center gap-5">
              <button onClick={() => music.setQueueMode(nextMode[st.queueMode])} className="text-white/55 transition-colors duration-200 hover:text-white" title={`播放模式：${st.queueMode === "order" ? "顺序" : st.queueMode === "shuffle" ? "随机" : "单曲循环"}`}>
                <Ico d={st.queueMode === "shuffle" ? IcoPath.shuffle : st.queueMode === "one" ? IcoPath.repeat1 : IcoPath.repeat} />
              </button>
              <button onClick={() => music.prev()} className="text-white/75 transition-colors duration-200 hover:text-white" title="上一首"><Ico d={IcoPath.prev} /></button>
              <button
                onClick={() => {
                  if (st.mode === "queue") music.toggle();
                  else if (rows.length) void playRow(rows.find((r) => r.id === playingId) ?? rows.find((r) => r.id > 0) ?? rows[0]);
                }}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-black transition-transform duration-200 hover:scale-105 active:scale-95"
                title={st.playing && st.mode === "queue" ? "暂停" : "播放"}
              >
                <Ico d={st.playing && st.mode === "queue" ? IcoPath.pause : IcoPath.play} solid />
              </button>
              <button onClick={() => music.next()} className="text-white/75 transition-colors duration-200 hover:text-white" title="下一首"><Ico d={IcoPath.next} /></button>
            </div>
            <div className="flex w-full max-w-[560px] items-center gap-3">
              <span className="w-9 shrink-0 text-right font-mono text-[10px] text-white/40">{fmtTime(scrub !== null ? scrub * duration : st.currentTime)}</span>
              <Scrubber value={progress} accent={accent} onScrub={setScrub} onCommit={(v) => { setScrub(null); music.seek(v * duration); }} />
              <span className="w-9 shrink-0 font-mono text-[10px] text-white/40">{fmtTime(duration)}</span>
            </div>
          </div>

          <div className="flex w-[24%] items-center justify-end gap-3">
            <button
              onClick={() => {
                setUserToggledView(true);
                setBigCover((b) => !b);
              }}
              className="rounded-md border border-white/10 px-2.5 py-1 text-[10px] font-light text-white/55 transition-colors duration-200 hover:border-white/25 hover:text-white"
              title="歌词 / 大封面"
            >
              {bigCover ? "歌词" : "封面"}
            </button>
            <button onClick={() => music.setVolume(st.volume > 0 ? 0 : 0.6)} className="text-white/50 transition-colors duration-200 hover:text-white" title="静音"><Ico d={st.volume === 0 ? IcoPath.mute : IcoPath.volume} /></button>
            <input type="range" min={0} max={100} value={Math.round(st.volume * 100)} onChange={(e) => music.setVolume(Number(e.target.value) / 100)} className="hidden w-20 accent-white/70 sm:block" aria-label="音量" />
          </div>
        </div>
      </div>

      {toast && (
        <div className="anim-caption-in absolute bottom-[124px] left-1/2 z-50 -translate-x-1/2 whitespace-nowrap rounded-full border border-white/10 bg-black/80 px-5 py-2 text-[12px] font-light text-white/85 backdrop-blur-xl">
          {toast}
        </div>
      )}
      {loginOpen && (
        <LoginModal
          onSuccess={() => {
            setLoginOpen(false);
            void refreshAccount();
          }}
          onClose={() => {
            setLoginOpen(false);
            setPendingPlay(null);
          }}
        />
      )}
    </div>
  );
}

/* ---------------- 当前曲跳动双柱 ---------------- */
function EqBars({ accent, playing }: { accent: string; playing: boolean }) {
  return (
    <span className="flex h-4 w-4 items-end justify-center gap-[2.5px]">
      {[0, 1].map((i) => (
        <span
          key={i}
          className="w-[2.5px] rounded-full"
          style={{
            background: accent,
            height: "100%",
            transformOrigin: "bottom",
            animation: playing ? `eqbar ${0.85 + i * 0.4}s ease-in-out infinite alternate` : "none",
            transform: playing ? undefined : "scaleY(0.45)",
          }}
        />
      ))}
    </span>
  );
}

/* ---------------- 进度条 ---------------- */
function Scrubber({ value, accent, onScrub, onCommit }: { value: number; accent: string; onScrub: (v: number) => void; onCommit: (v: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState(false);
  const posFrom = (clientX: number) => {
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
        onScrub(posFrom(e.clientX));
      }}
      onPointerMove={(e) => {
        if (e.buttons & 1) onScrub(posFrom(e.clientX));
      }}
      onPointerUp={(e) => onCommit(posFrom(e.clientX))}
    >
      <div className="relative h-[3px] w-full rounded-full bg-white/15">
        <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${value * 100}%`, background: hover ? accent : "rgba(255,255,255,0.78)" }} />
        <span className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white opacity-0 shadow transition-opacity duration-150 group-hover:opacity-100" style={{ left: `${value * 100}%` }} />
      </div>
    </div>
  );
}

/* ---------------- 图标 ---------------- */
const IcoPath: Record<string, string> = {
  back: "m14 6-6 6 6 6",
  play: "M7 4.5v15l13-7.5Z",
  playNo: "M7 4.5v15l13-7.5Z M3 3l18 18",
  pause: "M7 4.5h3.4v15H7zM13.6 4.5H17v15h-3.4z",
  prev: "M7 5v14M19 5.5 9.5 12l9.5 6.5Z",
  next: "M17 5v14M5 5.5 14.5 12 5 18.5Z",
  heart: "M12 20s-7.5-4.6-9.3-9.2C1.4 7.6 3.4 4.5 6.6 4.5c2 0 3.6 1.1 4.4 2.4l1 1.6 1-1.6c.8-1.3 2.4-2.4 4.4-2.4 3.2 0 5.2 3.1 3.9 6.3C17.5 15.4 12 20 12 20Z",
  heartFill: "M12 20s-7.5-4.6-9.3-9.2C1.4 7.6 3.4 4.5 6.6 4.5c2 0 3.6 1.1 4.4 2.4l1 1.6 1-1.6c.8-1.3 2.4-2.4 4.4-2.4 3.2 0 5.2 3.1 3.9 6.3C17.5 15.4 12 20 12 20Z",
  shuffle: "M17 3.5 21 7l-4 3.5M17 13.5 21 17l-4 3.5M3 7h3.5c4 0 5 3.5 8.5 9.5M3 17h3.5c2-4.5 3-7 5.5-9",
  repeat: "M7 4.5h9.5L21 8l-4.5 3.5H7a2 2 0 0 0-2 2V15M17 19.5H7.5L3 16l4.5-3.5H17a2 2 0 0 0 2-2V9",
  repeat1: "M7 4.5h9.5L21 8l-4.5 3.5H7a2 2 0 0 0-2 2V15M17 19.5H7.5L3 16l4.5-3.5H17a2 2 0 0 0 2-2V9M11.5 15.5v-4l-1.5 1",
  volume: "M4 9.5v5h4l5 4.5V5l-5 4.5zM16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12",
  mute: "M4 9.5v5h4L13 19V5L8 9.5zM17 9.5l4 5m0-5-4 5",
};

function Ico({ d, solid = false }: { d: string; solid?: boolean }) {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill={solid ? "currentColor" : "none"} stroke={solid ? "none" : "currentColor"} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
      <path d={d} />
    </svg>
  );
}
