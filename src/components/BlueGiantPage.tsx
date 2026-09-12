import { useEffect, useRef, useState } from "react";
import { site, rockCards, type StarDef } from "../data/site";
import { BlackholeScene, presetFromStar } from "../universe/blackhole";
import SectionPage from "./SectionPage";

interface Props {
  star: StarDef;
  onBack: () => void;
}

/** 卡片浮现的滚动窗口（进场沿，全部停留在终局） */
const CARD_IN: [number, number][] = [
  [0.62, 0.72],
  [0.74, 0.83],
  [0.86, 0.94],
];

/** 卡片桌面端定位（避开黑洞核心，左下/右下/上方；auto 用于清除基类的 left-1/2 居中） */
const CARD_POS = [
  "sm:left-[6vw] sm:right-auto",
  "sm:left-auto sm:right-[6vw]",
  "sm:left-[8vw] sm:right-auto",
];

const ss = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export default function BlueGiantPage({ star, onBack }: Props) {
  const [supported] = useState(() => BlackholeScene.supported());
  const [failed, setFailed] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const veilRef = useRef<HTMLDivElement>(null);
  const heroRef = useRef<HTMLDivElement>(null);
  const hintRef = useRef<HTMLDivElement>(null);
  const footRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    if (!supported || failed) return;
    const canvas = canvasRef.current;
    const scroller = scrollRef.current;
    if (!canvas || !scroller) return;

    let scene: BlackholeScene;
    try {
      scene = new BlackholeScene(canvas, presetFromStar(star), {
        coarse: window.matchMedia("(pointer: coarse)").matches,
        onFrame: (p) => {
          /* 滚动联动的覆盖层：直接改样式，避免每帧重渲染 */
          const hero = heroRef.current;
          if (hero) {
            const out = ss(0.04, 0.22, p);
            hero.style.opacity = String(1 - out);
            hero.style.transform = `translateY(${-46 * out}px)`;
          }
          const hint = hintRef.current;
          if (hint) {
            hint.style.opacity = String(1 - ss(0.012, 0.05, p));
          }
          CARD_IN.forEach(([a, b], i) => {
            const el = cardRefs.current[i];
            if (!el) return;
            const rv = ss(a, b, p);
            el.style.opacity = String(rv);
            /* 位移/缩放放在内层，避免覆盖外层用于居中的 translate 类 */
            const inner = el.firstElementChild as HTMLElement | null;
            if (inner) {
              inner.style.transform = `translateY(${30 * (1 - rv)}px) scale(${0.98 + 0.02 * rv})`;
            }
            el.style.pointerEvents = rv > 0.5 ? "auto" : "none";
          });
          const foot = footRef.current;
          if (foot) {
            foot.style.opacity = String(ss(0.9, 0.98, p));
          }
        },
      });
    } catch (err) {
      console.error("[BlueGiantPage] blackhole scene failed:", err);
      setFailed(true);
      return;
    }

    const updateTarget = () => {
      const max = scroller.scrollHeight - scroller.clientHeight;
      scene.setProgress(max > 0 ? scroller.scrollTop / max : 0);
    };
    updateTarget();
    scroller.addEventListener("scroll", updateTarget, { passive: true });

    /* 入场：从宇宙页带来的同色幕布淡出 */
    const veil = veilRef.current;
    const veilTimer = window.setTimeout(() => {
      if (veil) {
        veil.style.transition = "opacity 1.6s ease";
        veil.style.opacity = "0";
      }
    }, 60);

    return () => {
      window.clearTimeout(veilTimer);
      scroller.removeEventListener("scroll", updateTarget);
      scene.destroy();
    };
  }, [star, supported, failed]);

  if (!supported || failed) {
    return <SectionPage star={star} onBack={onBack} />;
  }

  return (
    <div
      ref={scrollRef}
      className="h-screen w-full overflow-y-auto overscroll-contain text-white [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      style={{ background: star.pageBg }}
    >
      <div className="relative" style={{ height: "520vh" }}>
        <div className="sticky top-0 h-screen w-full overflow-hidden">
          <canvas ref={canvasRef} className="block h-full w-full" />
          {/* 入场幕布：与宇宙页吞噬淹漫同色，保证无缝衔接 */}
          <div
            ref={veilRef}
            className="pointer-events-none absolute inset-0"
            style={{ background: star.pageBg }}
          />

          {/* 头部 */}
          <header className="anim-fade-in absolute inset-x-0 top-0 z-10 flex items-center justify-between px-[7vw] py-7">
            <span className="text-[11px] font-light uppercase tracking-[0.4em] text-white/45">
              {site.nameLatin}
            </span>
            <button
              onClick={onBack}
              className="group flex items-center gap-3 text-[11px] font-light uppercase tracking-[0.3em] text-white/45 transition-colors duration-300 hover:text-white"
            >
              <span className="inline-block h-[5px] w-[5px] rounded-full bg-white/50 transition-transform duration-500 group-hover:scale-150" />
              返回宇宙
            </button>
          </header>

          {/* 开场标题：恒星被吞掉后随滚动退场 */}
          <div
            ref={heroRef}
            className="absolute bottom-[13vh] left-[7vw] z-10 max-w-[80vw] will-change-transform"
          >
            <p
              className="anim-fade-up delay-1 text-[11px] font-light uppercase tracking-[0.44em]"
              style={{ color: star.color }}
            >
              {star.sectionEn} · {star.nameEn}
            </p>
            <h1 className="anim-fade-up delay-2 mt-5 text-[17vw] font-thin leading-[0.9] tracking-[-0.04em] text-white/95 sm:text-[9vw] lg:text-[7vw]">
              {star.section}
            </h1>
            <p className="anim-fade-up delay-3 mt-5 max-w-[26rem] text-sm font-light leading-relaxed text-white/50 sm:text-base">
              {star.tagline}。滚动，看这颗蓝巨星被一点点抽成光。
            </p>
          </div>

          {/* 滚动提示 */}
          <div
            ref={hintRef}
            className="absolute bottom-9 left-1/2 z-10 -translate-x-1/2"
          >
            <span className="anim-breathe flex items-center gap-3 text-[10px] font-light uppercase tracking-[0.34em] text-white/55">
              <span className="anim-breathe-soft inline-block h-[5px] w-[5px] rounded-full bg-white/60" />
              滚动 · 靠近视界
            </span>
          </div>

          {/* 终局卡片：沿吸积盘视觉走向浮现 */}
          {rockCards.map((c, i) => (
            <div
              key={c.k}
              ref={(el) => {
                cardRefs.current[i] = el;
              }}
              className={`absolute left-1/2 z-10 w-[min(320px,80vw)] -translate-x-1/2 opacity-0 will-change-transform ${
                i === 0 ? "bottom-[10vh]" : i === 1 ? "bottom-[10vh] sm:bottom-[14vh]" : "top-[16vh]"
              } sm:translate-x-0 ${CARD_POS[i]}`}
            >
              <div className="rounded-2xl border border-white/10 bg-white/[0.05] p-6 shadow-[0_8px_40px_rgba(0,0,0,0.45)] backdrop-blur-xl will-change-transform">
                <span className="text-[10px] font-light tracking-[0.3em] text-white/35">
                  {c.k}
                </span>
                <h3 className="mt-3 text-base font-light tracking-wide text-white/90">
                  {c.t}
                </h3>
                <p className="mt-2 text-[12px] font-light leading-relaxed text-white/50">
                  {c.d}
                </p>
                <span
                  className="mt-5 block h-px w-10 opacity-70"
                  style={{ background: star.color }}
                />
              </div>
            </div>
          ))}

          {/* 页脚 */}
          <div
            ref={footRef}
            className="anim-fade-in absolute inset-x-0 bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 px-[7vw] py-6 text-[10px] font-light uppercase tracking-[0.28em] text-white/30"
            style={{ opacity: 0 }}
          >
            <span>{site.footer}</span>
            <span>视界之内 · 无需返回信号</span>
          </div>
        </div>
      </div>
    </div>
  );
}
