import { useEffect, useRef, useState } from "react";
import { BlackholeScene } from "../universe/blackhole";
import SectionPage from "./SectionPage";
import SPlayerPage from "./SPlayerPage";
import { music } from "../audio/music";
import { coverUrl, featuredAlbum, historyAlbums, pinnedAlbum, type Album } from "../data/albums";
import { site, type StarDef } from "../data/site";

interface Props {
  star: StarDef;
  onBack: () => void;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export default function BlueGiantPage({ star, onBack }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<BlackholeScene | null>(null);
  const lastProgressRef = useRef(-1);

  const [progress, setProgress] = useState(0);
  const [unsupported, setUnsupported] = useState(false);
  /** 打开 SPlayer 播放器的专辑 id；null = 故事页 */
  const [playerAlbum, setPlayerAlbum] = useState<string | null>(null);

  /* DEV 调试钩子：?dev=blue-giant&finale=1 定格终局卡片；window.__bgOpen(id) 直接开播放器
     （用于浏览器面板隐藏、rAF 冻结时的无头布局验证；生产构建剔除） */
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (window as unknown as { __bgOpen?: (id: string) => void }).__bgOpen = (id: string) => setPlayerAlbum(id);
    if (new URLSearchParams(window.location.search).get("finale")) setProgress(1);
  }, []);

  /** 关播放器：若正在播队列 → 淡回板块专属曲 */
  const closePlayer = () => {
    setPlayerAlbum(null);
    if (music.getState().mode === "queue") music.switchMode("dedicated");
  };

  /** 本地别名：模块级 const 在 JSX 闭包里不被 TS 收窄，本地 const 会 */
  const feat = featuredAlbum;
  const pin = pinnedAlbum;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const scene = new BlackholeScene(canvas, {
      onProgress: (p) => {
        // 只有变化超过阈值才触发 React 重渲染
        if (Math.abs(p - lastProgressRef.current) > 0.0015) {
          lastProgressRef.current = p;
          setProgress(p);
        }
      },
    });
    sceneRef.current = scene;
    if (!scene.supported) setUnsupported(true);
    return () => {
      scene.destroy();
      sceneRef.current = null;
    };
  }, []);

  if (unsupported) return <SectionPage star={star} onBack={onBack} />;

  const handleScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    const maxScroll = el.scrollHeight - el.clientHeight;
    if (maxScroll <= 0) return;
    sceneRef.current?.setProgress(el.scrollTop / maxScroll);
  };

  const scrollToEnd = () => {
    const el = containerRef.current;
    el?.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  };

  // 首屏文案：p < 0.22 可见
  const heroOpacity = clamp01(1 - progress * 4.5);
  // 中段遥测：0.12 → 0.72
  const telemetryOpacity =
    progress > 0.12 && progress < 0.72 ? Math.sin(((progress - 0.12) / 0.6) * Math.PI) : 0;

  // 遥测数值：随滚动一路飙升
  const accretionRate = (0.8 + Math.pow(progress, 1.4) * 41).toFixed(1);
  const diskSpeed = (0.18 + progress * 0.74).toFixed(2);
  const redshift = (1.02 + Math.pow(progress, 2.4) * 4.8).toFixed(2);

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className={`fixed inset-0 select-none bg-[#030304] text-white ${
        playerAlbum ? "overflow-hidden" : "overflow-x-hidden overflow-y-auto"
      }`}
      style={{ WebkitOverflowScrolling: "touch" }}
    >
      <div className="relative h-[500vh] w-full">
        <div className="sticky top-0 h-screen w-full overflow-hidden">
          <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />

          {/* 顶栏 */}
          <header className="pointer-events-auto absolute left-[5vw] right-[5vw] top-6 z-30 flex items-center justify-between sm:top-8">
            <div className="flex items-center gap-3 rounded-full bg-black/35 px-3.5 py-1.5 backdrop-blur-md">
              <span className="text-[11px] font-light uppercase tracking-[0.42em] text-white/60">
                {site.nameLatin}
              </span>
              <span className="h-3 w-px bg-white/20" />
              <span className="text-[10px] font-light uppercase tracking-[0.32em] text-[#8fb6ff]/90">
                {star.nameEn}
              </span>
            </div>

            <button
              onClick={onBack}
              className="group flex cursor-pointer items-center gap-3 rounded-full border border-white/10 bg-black/40 px-4 py-1.5 backdrop-blur-md transition-all duration-300 hover:border-white/30 hover:bg-white/10"
            >
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-[#8fb6ff] transition-transform duration-300 group-hover:scale-150" />
              <span className="text-[11px] font-light uppercase tracking-[0.28em] text-white/70 group-hover:text-white">
                返回宇宙
              </span>
            </button>
          </header>

          {/* 首屏文案：放在右侧深空一侧，不压在过曝的恒星上 */}
          <div
            className="pointer-events-none absolute inset-0 z-20 transition-opacity duration-300"
            style={{ opacity: heroOpacity, transform: `translateY(-${progress * 60}px)` }}
          >
            <div className="absolute bottom-[14vh] right-[6vw] max-w-[78vw] text-right sm:bottom-auto sm:top-1/2 sm:max-w-[34vw] sm:-translate-y-1/2">
              <p className="anim-fade-up delay-1 text-[11px] font-light uppercase tracking-[0.44em] text-[#8fb6ff]">
                潮汐撕裂 · ROCHE LOBE OVERFLOW
              </p>
              <h1 className="anim-fade-up delay-2 mt-4 text-[17vw] font-thin leading-[0.9] tracking-[-0.04em] text-white/95 sm:text-[7vw]">
                {star.section}
              </h1>
              <p className="anim-fade-up delay-3 mt-3 text-[11px] font-light uppercase tracking-[0.48em] text-white/45">
                {star.sectionEn} & SOUND ARCHIVES · 2026
              </p>
              <p className="anim-fade-up delay-4 ml-auto mt-7 max-w-[26rem] text-sm font-light leading-relaxed text-white/60 sm:text-base">
                一颗蓝巨星把自己的大气一层层交给身旁的黑洞。被撕下来的等离子体绕着视界加速到近乎光速，那是宇宙里最响的一段低音。
              </p>
            </div>

            <button
              onClick={scrollToEnd}
              className="anim-fade-up delay-5 pointer-events-auto absolute bottom-8 right-[6vw] flex cursor-pointer items-center gap-3 text-[11px] font-light tracking-[0.32em] text-white/50 transition-colors duration-300 hover:text-white"
            >
              <span className="anim-breathe">向下滚动 · 靠近视界</span>
              <span className="anim-breathe-soft inline-block h-1.5 w-1.5 rounded-full bg-[#8fb6ff]" />
            </button>
          </div>

          {/* 中段遥测 HUD：右下角，压在深空一侧 */}
          <div
            className="pointer-events-none absolute bottom-8 right-[6vw] z-20 text-right transition-opacity duration-300"
            style={{ opacity: telemetryOpacity }}
          >
            <div className="flex items-end gap-7 border-t border-white/10 pt-4 text-[10px] font-light uppercase tracking-[0.26em] text-white/40 sm:gap-10">
              <div>
                <span className="block text-white/30">吸积速率</span>
                <span className="font-mono text-sm text-white/85">{accretionRate} M☉/yr</span>
              </div>
              <div>
                <span className="block text-white/30">盘面转速</span>
                <span className="font-mono text-sm text-white/85">{diskSpeed} c</span>
              </div>
              <div>
                <span className="block text-white/30">引力红移</span>
                <span className="font-mono text-sm text-[#8fb6ff]">{redshift} Z</span>
              </div>
            </div>
          </div>

          {/* 终局：三张专辑卡沿底部一排渐次浮现（苹果发布页式），避开黑洞与上方拱弧 */}
          <div className="pointer-events-none absolute bottom-6 left-[5vw] right-[5vw] z-30 flex snap-x gap-3 overflow-x-auto pb-1 sm:bottom-8 sm:grid sm:grid-cols-3 sm:gap-4 sm:overflow-visible">
            {feat && (
              <RevealSlot cp={clamp01((progress - 0.72) / 0.1)}>
                <AlbumCard
                  album={feat}
                  kicker="最近爱听"
                  kickerEn="NOW SPINNING"
                  accent={star.color}
                  onOpen={() => setPlayerAlbum(feat.id)}
                />
              </RevealSlot>
            )}
            <RevealSlot cp={clamp01((progress - 0.8) / 0.1)}>
              <HistoryCard albums={historyAlbums} accent={star.color} onOpen={(id) => setPlayerAlbum(id)} />
            </RevealSlot>
            {pin && (
              <RevealSlot cp={clamp01((progress - 0.88) / 0.1)}>
                <AlbumCard
                  album={pin}
                  kicker="声音玩具"
                  kickerEn="ARCHIVE PICK"
                  accent="#a8c9ff"
                  onOpen={() => setPlayerAlbum(pin.id)}
                />
              </RevealSlot>
            )}
          </div>

          {/* 右侧微型滚动指示条 */}
          <div className="pointer-events-none absolute right-4 top-1/2 z-30 hidden h-32 w-1 -translate-y-1/2 rounded-full bg-white/10 sm:block">
            <div
              className="w-full rounded-full bg-gradient-to-b from-[#8fb6ff] to-white transition-all duration-100"
              style={{ height: `${Math.max(8, progress * 100)}%` }}
            />
          </div>
        </div>
      </div>

      {/* 播放器：全屏接管（Esc / 右上角返回退出并淡回专属曲） */}
      {playerAlbum && <SPlayerPage initialAlbumId={playerAlbum} onClose={closePlayer} />}
    </div>
  );
}

/** 终局卡的浮现槽位（沿用苹果发布页的错峰公式） */
function RevealSlot({ cp, children }: { cp: number; children: React.ReactNode }) {
  return (
    <div
      className={`min-w-[78vw] snap-center transition-all duration-300 sm:min-w-0 ${
        cp > 0.01 ? "pointer-events-auto" : "pointer-events-none"
      }`}
      style={{
        opacity: cp,
        transform: `translateY(${(1 - cp) * 28}px)`,
        visibility: cp > 0.01 ? "visible" : "hidden",
      }}
    >
      {children}
    </div>
  );
}

/** 专辑卡：封面缩略 + 曲名信息 + 统计，点进 SPlayer 播放器（宇宙玻璃语言） */
function AlbumCard({
  album,
  kicker,
  kickerEn,
  accent,
  onOpen,
}: {
  album: Album;
  kicker: string;
  kickerEn: string;
  accent: string;
  onOpen: () => void;
}) {
  const playable = album.tracks.filter((t) => t.file).length;
  const totalMin = Math.round(album.tracks.reduce((s, t) => s + (t.ms || 0), 0) / 60000);
  return (
    <button
      onClick={onOpen}
      className="group relative block w-full cursor-pointer overflow-hidden rounded-2xl border border-white/12 bg-black/45 p-5 text-left shadow-2xl backdrop-blur-2xl transition-all duration-500 hover:border-white/30 hover:bg-white/[0.05]"
    >
      <div
        className="pointer-events-none absolute -left-12 -top-12 h-32 w-32 rounded-full opacity-20 blur-2xl transition-opacity duration-500 group-hover:opacity-40"
        style={{ background: accent }}
      />
      <div className="relative flex gap-4">
        <span className="relative h-[72px] w-[72px] shrink-0 overflow-hidden rounded-lg shadow-[0_10px_28px_rgba(0,0,0,0.55)]">
          <img src={coverUrl(album)} alt={album.title} className="h-full w-full object-cover" loading="lazy" draggable={false} />
          {/* 封面底部的播放提示角标 */}
          <span className="absolute inset-x-0 bottom-0 translate-y-full bg-black/65 py-[3px] text-center text-[8px] font-light uppercase tracking-[0.22em] text-white/85 backdrop-blur-sm transition-transform duration-300 group-hover:translate-y-0">
            打开播放器
          </span>
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-2">
            <span className="text-[9px] font-light uppercase tracking-[0.24em]" style={{ color: accent }}>
              {kickerEn}
            </span>
            <span className="font-mono text-[8px] tracking-[0.16em] text-white/25">{album.year}</span>
          </span>
          <span className="mt-1.5 block truncate text-lg font-light tracking-wide text-white/95">{album.title}</span>
          <span className="block truncate text-[10px] font-light text-white/40">
            {kicker} · {album.artist}
          </span>
        </span>
      </div>
      {album.intro && (
        <p className="relative mt-3 line-clamp-2 text-[11px] font-light leading-relaxed text-white/50">{album.intro}</p>
      )}
      <div className="relative mt-4 grid grid-cols-3 gap-2 border-t border-white/10 pt-3.5">
        <span>
          <span className="block text-[8px] font-light tracking-[0.18em] text-white/30">曲目</span>
          <span className="mt-0.5 block font-mono text-[10px] text-white/80">{album.tracks.length} TRACKS</span>
        </span>
        <span>
          <span className="block text-[8px] font-light tracking-[0.18em] text-white/30">时长</span>
          <span className="mt-0.5 block font-mono text-[10px] text-white/80">{totalMin > 0 ? `≈${totalMin} MIN` : "—"}</span>
        </span>
        <span>
          <span className="block text-[8px] font-light tracking-[0.18em] text-white/30">音频</span>
          <span className="mt-0.5 block font-mono text-[10px]" style={{ color: playable ? "#8fb6ff" : "rgba(255,255,255,0.35)" }}>
            {playable ? `${playable} 首可播` : "待导入"}
          </span>
        </span>
      </div>
    </button>
  );
}

/** 历史列表卡：叠放缩略墙，悬停扇形展开，点任意一张进播放器；空态说明归档规则 */
function HistoryCard({ albums, accent, onOpen }: { albums: Album[]; accent: string; onOpen: (id: string) => void }) {
  const [hover, setHover] = useState(false);
  const shown = albums.slice(0, 5);
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="group relative block w-full overflow-hidden rounded-2xl border border-white/12 bg-black/45 p-5 shadow-2xl backdrop-blur-2xl transition-all duration-500 hover:border-white/30 hover:bg-white/[0.05]"
    >
      <div
        className="pointer-events-none absolute -left-12 -top-12 h-32 w-32 rounded-full opacity-20 blur-2xl transition-opacity duration-500 group-hover:opacity-40"
        style={{ background: accent }}
      />
      <div className="relative flex items-baseline justify-between gap-2">
        <span className="text-[9px] font-light uppercase tracking-[0.24em]" style={{ color: accent }}>
          HISTORY BIN
        </span>
        {albums.length > 0 && (
          <span className="font-mono text-[9px] tracking-[0.16em] text-white/35">×{albums.length}</span>
        )}
      </div>
      <span className="relative mt-1.5 block text-lg font-light tracking-wide text-white/95">历史列表</span>

      {shown.length === 0 ? (
        <p className="relative mt-3 text-[11px] font-light leading-relaxed text-white/40">
          暂时空着。每次换听新专辑，上一张会自动归档到这里。
        </p>
      ) : (
        <>
          <div className="relative mt-4 flex h-[54px] items-center">
            {shown.map((a, i) => (
              <button
                key={a.id}
                onClick={() => onOpen(a.id)}
                title={`${a.title} · ${a.artist}`}
                className="absolute h-[54px] w-[54px] cursor-pointer overflow-hidden rounded-md shadow-[0_8px_22px_rgba(0,0,0,0.55)] ring-1 ring-white/15 transition-all duration-500 hover:z-50 hover:-translate-y-1.5"
                style={{
                  left: hover ? `${i * 64}px` : `${i * 20}px`,
                  transform: `rotate(${hover ? 0 : (i - (shown.length - 1) / 2) * 4}deg)`,
                  zIndex: i,
                }}
              >
                <img src={coverUrl(a)} alt={a.title} className="h-full w-full object-cover" loading="lazy" draggable={false} />
              </button>
            ))}
          </div>
          <p className="relative mt-3 text-[10px] font-light leading-relaxed text-white/35">
            最近归档：{shown[0].artist} — {shown[0].title}
          </p>
        </>
      )}
      <div className="relative mt-4 border-t border-white/10 pt-3.5">
        <span className="block text-[8px] font-light tracking-[0.18em] text-white/30">换听自动归档</span>
        <span className="mt-1 block font-mono text-[10px] text-white/60">npm run album "歌手 新专辑"</span>
      </div>
    </div>
  );
}
