import { useEffect, useRef, useState } from "react";
import { RedGiantScene } from "../universe/redgiant";
import SectionPage from "./SectionPage";
import { createLiquidGlassFilter } from "../utils/liquidGlass";
import { galleryItems, type GalleryItem } from "../data/gallery";
import { site, type StarDef } from "../data/site";

interface Props {
  star: StarDef;
  onBack: () => void;
}

/* ---------- 可调常数（"iOS 手感"与堆叠露边比例） ---------- */
export const GALLERY_TUNE = {
  /** 卡片切换时长 ms */
  cardDur: 750,
  /** 切换缓动（Apple 面板曲线，对应 iOS 默认 spring 的近似） */
  cardEase: "cubic-bezier(0.32, 0.72, 0, 1)",
  /** 下层两张卡各露出的水平边距（相对卡宽） */
  peekX: 0.085,
  /** 下层卡下沉的垂直偏移（相对卡高） */
  peekY: 0.14,
  /** 上层 / 下层卡缩放 */
  topScale: 1.0,
  backScale: 0.965,
  /** 切换防抖阈值 ms */
  swipeLockMs: 750,
};
const G = GALLERY_TUNE;

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const imgURL = (file: string) => `./影像/${encodeURI(file)}`;

function easeOutQuint(t: number) {
  return 1 - Math.pow(1 - t, 5);
}

/** 全站共享的液态玻璃滤镜：挂载时生成一次，CSS 变量 --lg-filter 指向它，resize 重建。 */
function useGlobalLiquidGlass() {
  useEffect(() => {
    let t = 0;
    const apply = () => {
      const w = Math.min(window.innerWidth, 900);
      const h = Math.min(window.innerHeight, 1100);
      try {
        const fid = createLiquidGlassFilter({
          width: w,
          height: h,
          radius: 28,
          intensity: 0.5,
          id: "rg-glass",
        });
        document.documentElement.style.setProperty("--lg-filter", `url(#${fid}) blur(10px)`);
      } catch {
        document.documentElement.style.setProperty("--lg-filter", "blur(14px)");
      }
    };
    const raf = requestAnimationFrame(apply);
    const onResize = () => {
      window.clearTimeout(t);
      t = window.setTimeout(apply, 250);
    };
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(t);
      window.removeEventListener("resize", onResize);
    };
  }, []);
}

/* ===================== 主页面 ===================== */

export default function RedGiantPage({ star, onBack }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<RedGiantScene | null>(null);
  const [unsupported, setUnsupported] = useState(false);
  /** 入场完成度 0→1（由远及近），驱动右侧内容淡入 */
  const [p, setP] = useState(0);

  useGlobalLiquidGlass();

  const total = galleryItems.length;
  const mod = (n: number) => ((n % total) + total) % total;

  /** 上层槽位下标。5 个持久节点 delta=-2..+2：
   *  向右切 = 右卡(d+1)升到上层、原上层降为左下(d-1)、新卡从右幕外(d+2)无动画补位。 */
  const [topIdx, setTopIdx] = useState(0);
  const busyUntil = useRef(0);
  const cur = galleryItems[mod(topIdx)];

  const go = (dir: 1 | -1) => {
    const now = performance.now();
    if (now < busyUntil.current || total < 2) return;
    busyUntil.current = now + G.swipeLockMs;
    setTopIdx((i) => mod(i + dir));
  };

  /* ---------- 红巨星场景 + 入场驱动 ---------- */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const scene = new RedGiantScene(canvas);
    sceneRef.current = scene;
    /** 仅 DEV：把 scene 挂到 window，便于在 rAF 冻结环境下手动绘帧做无头截图验证 */
    if (import.meta.env.DEV) (window as unknown as { __rgScene?: RedGiantScene }).__rgScene = scene;
    if (!scene.supported) {
      setUnsupported(true);
      return () => {
        scene.destroy();
        sceneRef.current = null;
      };
    }
    scene.startEntrance();
    /* 若直接以 ?dev= 进入且页面处于隐藏态，入场循环无法跑帧：把 DOM 遮罩与着色器定格到入场完成态，
       保证截图能看到成品构图。正常运行（可见态）不走这里，动画照常播放。 */
    if (document.hidden) {
      setP(1);
      scene.debugDraw(1, 2.5, 0.9, 1);
      return () => {
        scene.destroy();
        sceneRef.current = null;
      };
    }
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      setP(easeOutQuint(clamp01((now - start) / G_CARD_ENTRANCE)));
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      scene.destroy();
      sceneRef.current = null;
    };
  }, []);

  /* ---------- 键盘左右键 ---------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [total]);

  if (unsupported) return <SectionPage star={star} onBack={onBack} />;

  const chromeOpacity = clamp01((p - 0.3) / 0.7);
  const accent = star.color;

  return (
    <div className="fixed inset-0 select-none overflow-hidden text-white" style={{ background: star.pageBg }}>
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />

      {/* 顶栏 */}
      <header
        className="absolute left-[5vw] right-[5vw] top-6 z-30 flex items-center justify-between sm:top-8"
        style={{ opacity: chromeOpacity }}
      >
        <GlassPill className="px-4 py-2">
          <span className="text-[11px] font-light uppercase tracking-[0.42em] text-white/60">{site.nameLatin}</span>
          <span className="mx-3 h-3 w-px bg-white/20" />
          <span className="text-[10px] font-light uppercase tracking-[0.32em]" style={{ color: accent }}>
            {star.sectionEn} · {star.nameEn}
          </span>
        </GlassPill>

        <GlassButton onClick={onBack} className="px-4 py-2">
          <span className="inline-block h-1.5 w-1.5 rounded-full transition-transform duration-300 hover:scale-150" style={{ background: accent }} />
          <span className="ml-3 text-[11px] font-light uppercase tracking-[0.28em] text-white/70 hover:text-white">
            返回宇宙
          </span>
        </GlassButton>
      </header>

      {/* 左侧板块标题（沉在弧面之下） */}
      <div
        className="pointer-events-none absolute bottom-[9vh] left-[5vw] z-20 max-w-[30vw]"
        style={{ opacity: chromeOpacity }}
      >
        <p className="text-[10px] font-light uppercase tracking-[0.44em]" style={{ color: accent }}>
          Photo Archive
        </p>
        <h1 className="mt-2 text-[42px] font-thin leading-[1.05] tracking-[-0.02em] text-white/95 sm:text-[64px]">
          {star.section}
        </h1>
        <p className="mt-3 text-[11px] font-light leading-relaxed text-white/40">{star.tagline}</p>
      </div>

      {/* 右侧：堆叠卡片 + 文案。整体从弧光右缘（~31vw）开始排布 */}
      <main
        className="absolute inset-y-0 right-[5vw] left-[32vw] z-20 flex flex-col items-center justify-center gap-8 lg:flex-row lg:gap-6"
        style={{ opacity: chromeOpacity }}
      >
        <StackStage items={galleryItems} topIdx={topIdx} mod={mod} go={go} />

        <div className="flex w-full max-w-[420px] shrink-0 grow flex-col items-end text-right lg:max-w-[400px] lg:items-start lg:text-left">
          <p className="font-mono text-[11px] tracking-[0.3em] text-white/30">
            {String(mod(topIdx) + 1).padStart(2, "0")}{" "}
            <span className="text-white/15">/ {String(total).padStart(2, "0")}</span>
          </p>
          <h2
            key={`place-${topIdx}`}
            className="anim-fade-up mt-2 text-[40px] font-thin leading-[1.05] tracking-[-0.02em] text-white/95 sm:text-[46px]"
          >
            {cur.place}
          </h2>
          <p
            key={`placeEn-${topIdx}`}
            className="anim-fade-up delay-1 mt-1 text-[10px] font-light uppercase tracking-[0.34em]"
            style={{ color: accent }}
          >
            {cur.placeEn}
          </p>
          <p key={`story-${topIdx}`} className="anim-fade-up delay-2 mt-6 max-w-[24rem] text-[14px] font-light leading-relaxed text-white/55">
            {cur.story}
          </p>
          <p key={`meta-${topIdx}`} className="anim-fade-up delay-3 mt-4 font-mono text-[10px] leading-relaxed tracking-[0.04em] text-white/25">
            {cur.date && <span>{cur.date} · </span>}
            {cur.meta}
          </p>

          {/* 页码 + 提示 */}
          <div className="mt-8 flex w-full items-center justify-end gap-1.5 lg:justify-start">
            {galleryItems.map((it, i) => (
              <span
                key={it.id}
                className="h-1 rounded-full transition-all duration-500"
                style={{
                  width: i === mod(topIdx) ? 18 : 6,
                  background: i === mod(topIdx) ? accent : "rgba(255,255,255,0.18)",
                }}
              />
            ))}
          </div>
          <p className="mt-3 text-[10px] font-light tracking-[0.28em] text-white/20">← → 切换</p>
        </div>
      </main>
    </div>
  );
}

/** 入场总时长：着色器与右侧淡入共用同一常数，确保同步 */
const G_CARD_ENTRANCE = 1800;

/* ===================== 卡片堆叠舞台 ===================== */

function StackStage({
  items,
  topIdx,
  mod,
  go,
}: {
  items: GalleryItem[];
  topIdx: number;
  mod: (n: number) => number;
  go: (dir: 1 | -1) => void;
}) {
  const dragX = useRef<number | null>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("button")) return;
    dragX.current = e.clientX;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (dragX.current === null) return;
    const dx = e.clientX - dragX.current;
    dragX.current = null;
    if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1);
  };

  return (
    <div className="relative shrink-0 px-12 py-14">
      <div
        className="relative mx-auto aspect-[3/4] w-[min(64vw,320px)] md:w-[min(40vh,360px)] lg:w-[min(46vh,400px)]"
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={() => (dragX.current = null)}
      >
        {/* 5 个持久节点，靠 delta 决定槽位；delta=±2 的进出位无动画 */}
        {[-2, -1, 0, 1, 2].map((d) => {
          const it = items[mod(topIdx + d)];
          const st = cardTransform(d);
          return (
            <div
              key={it.id}
              className="absolute inset-0 origin-center"
              style={{
                transform: st.transform,
                opacity: st.opacity,
                zIndex: d === 0 ? 30 : d === 1 || d === -1 ? 20 : 10,
                transition:
                  Math.abs(d) >= 2
                    ? "none"
                    : `transform ${G.cardDur}ms ${G.cardEase}, opacity ${G.cardDur * 0.7}ms ease`,
                filter: d === 0 ? "none" : "saturate(0.72) brightness(0.82)",
                pointerEvents: d === 0 ? "auto" : "none",
              }}
            >
              <CardFace item={it} top={d === 0} />
            </div>
          );
        })}

        <GlassArrow side="left" onClick={() => go(-1)} />
        <GlassArrow side="right" onClick={() => go(1)} />
      </div>
    </div>
  );
}

/** delta → 槽位 transform */
function cardTransform(d: number): { transform: string; opacity: number } {
  if (d === 0) return { transform: `translate(0px, 0px) scale(${G.topScale})`, opacity: 1 };
  const dx = (d < 0 ? -1 : 1) * G.peekX * 100;
  const dy = G.peekY * 100;
  if (Math.abs(d) === 1) {
    return {
      transform: `translate(${dx}%, ${dy}%) scale(${G.backScale}) rotate(${d < 0 ? -3 : 3}deg)`,
      opacity: 1,
    };
  }
  /* 侧幕外进出位（d=±2）：肉眼不可见，仅给新卡一个无动画的落位 */
  const outX = G.peekX * 100 + (d > 0 ? 40 : -40);
  return {
    transform: `translate(${outX}%, ${dy}%) scale(${G.backScale * 0.96}) rotate(${d < 0 ? -3 : 3}deg)`,
    opacity: 0,
  };
}

/* ===================== 单张卡片（玻璃环 + 内容） ===================== */

function CardFace({ item, top }: { item: GalleryItem; top: boolean }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [ready, setReady] = useState(false);

  /** 视频卡：仅作为上层可见时播放，滑走暂停 */
  useEffect(() => {
    if (item.kind !== "video") return;
    const el = videoRef.current;
    if (!el) return;
    if (top) void el.play().catch(() => {});
    else el.pause();
  }, [top, item.kind]);

  return (
    <div
      className="relative h-full w-full overflow-hidden rounded-[26px]"
      style={{
        background:
          "linear-gradient(150deg, rgba(255,255,255,0.12), rgba(255,255,255,0.04) 45%, rgba(255,122,77,0.07))",
        backdropFilter: "var(--lg-filter, blur(12px)) saturate(1.3) brightness(1.04)",
        WebkitBackdropFilter: "var(--lg-filter, blur(12px)) saturate(1.3) brightness(1.04)",
        border: "1px solid rgba(255,255,255,0.14)",
        boxShadow: top
          ? "0 30px 80px rgba(2,4,10,0.55), inset 0 1px 0 rgba(255,255,255,0.28), inset 0 -1px 0 rgba(255,255,255,0.07)"
          : "0 18px 50px rgba(2,4,10,0.4), inset 0 1px 0 rgba(255,255,255,0.14)",
        padding: top ? 9 : 7,
      }}
    >
      <div
        className="pointer-events-none absolute inset-0 rounded-[26px] opacity-25"
        style={{
          background:
            "radial-gradient(120px 80px at 18% 8%, rgba(255,255,255,0.22), transparent 60%), radial-gradient(160px 120px at 86% 96%, rgba(255,122,77,0.16), transparent 72%)",
        }}
      />
      <div className="relative h-full w-full overflow-hidden rounded-[18px] bg-white/[0.04]">
        {item.kind === "video" ? (
          <video
            ref={videoRef}
            src={imgURL(item.file)}
            className="h-full w-full object-cover"
            muted
            loop
            playsInline
            preload="auto"
            draggable={false}
            onContextMenu={(e) => e.preventDefault()}
          />
        ) : (
          <img
            src={imgURL(item.file)}
            alt={`${item.place} · ${item.date}`}
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover transition-opacity duration-700"
            draggable={false}
            onContextMenu={(e) => e.preventDefault()}
            onLoad={() => setReady(true)}
            onError={() => setReady(true)}
            style={{ opacity: ready ? 1 : 0 }}
          />
        )}
        <div className="pointer-events-none absolute inset-0 rounded-[18px] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12)]" />
      </div>
    </div>
  );
}

/* ===================== 液态玻璃控件 ===================== */

function glassStyle(): React.CSSProperties {
  return {
    background:
      "linear-gradient(160deg, rgba(255,255,255,0.10), rgba(255,255,255,0.03) 45%, rgba(255,122,77,0.06))",
    backdropFilter: "var(--lg-filter, blur(16px)) saturate(1.35) brightness(1.05)",
    WebkitBackdropFilter: "var(--lg-filter, blur(16px)) saturate(1.35) brightness(1.05)",
    boxShadow:
      "inset 0 1px 0 rgba(255,255,255,0.22), inset 0 -1px 0 rgba(255,255,255,0.06), 0 8px 32px rgba(2,4,12,0.35)",
    border: "1px solid rgba(255,255,255,0.14)",
  };
}

function GlassPill({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={`flex items-center rounded-full ${className}`} style={glassStyle()}>
      {children}
    </span>
  );
}

function GlassButton({ children, onClick, className = "" }: { children: React.ReactNode; onClick: () => void; className?: string }) {
  return (
    <button
      onClick={onClick}
      className={`cursor-pointer rounded-full transition-all duration-300 hover:brightness-125 ${className}`}
      style={glassStyle()}
    >
      <span className="flex items-center">{children}</span>
    </button>
  );
}

function GlassArrow({ side, onClick }: { side: "left" | "right"; onClick: () => void }) {
  return (
    <button
      aria-label={side === "left" ? "上一张" : "下一张"}
      onClick={onClick}
      className="absolute top-1/2 z-40 flex h-11 w-11 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full transition-all duration-300 hover:brightness-125 active:scale-95"
      style={{
        ...glassStyle(),
        left: side === "left" ? "-50px" : undefined,
        right: side === "right" ? "-50px" : undefined,
      }}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.85)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        {side === "left" ? <path d="M15 18l-6-6 6-6" /> : <path d="M9 6l6 6-6 6" />}
      </svg>
    </button>
  );
}
