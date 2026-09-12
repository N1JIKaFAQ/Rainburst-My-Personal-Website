import { useEffect, useRef, useState } from "react";
import { BlackholeScene } from "../universe/blackhole";
import SectionPage from "./SectionPage";
import { rockCards, site, type RockCard, type StarDef } from "../data/site";

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
  const [activeCardId, setActiveCardId] = useState<string | null>(null);

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
      className="fixed inset-0 select-none overflow-x-hidden overflow-y-auto bg-[#030304] text-white"
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
                摇滚
              </h1>
              <p className="anim-fade-up delay-3 mt-3 text-[11px] font-light uppercase tracking-[0.48em] text-white/45">
                MUSIC & SOUND ARCHIVES · 2026
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

          {/* 终局：三张卡片沿底部一排渐次浮现（苹果发布页式），避开黑洞与上方拱弧 */}
          <div className="pointer-events-none absolute bottom-6 left-[5vw] right-[5vw] z-30 flex snap-x gap-3 overflow-x-auto pb-1 sm:bottom-8 sm:grid sm:grid-cols-3 sm:gap-4 sm:overflow-visible">
            {rockCards.map((card, i) => {
              const cp = clamp01((progress - (0.72 + i * 0.08)) / 0.1);
              return (
                <div
                  key={card.id}
                  className={`min-w-[78vw] snap-center transition-all duration-300 sm:min-w-0 ${
                    cp > 0.01 ? "pointer-events-auto" : "pointer-events-none"
                  }`}
                  style={{
                    opacity: cp,
                    transform: `translateY(${(1 - cp) * 28}px)`,
                    visibility: cp > 0.01 ? "visible" : "hidden",
                  }}
                >
                  <GlassCard
                    card={card}
                    active={activeCardId === card.id}
                    onToggle={() => setActiveCardId(activeCardId === card.id ? null : card.id)}
                  />
                </div>
              );
            })}
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
    </div>
  );
}

/** 苹果 / ins 极简玻璃拟态卡片 */
function GlassCard({
  card,
  active,
  onToggle,
}: {
  card: RockCard;
  active: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      onClick={onToggle}
      className={`group relative cursor-pointer overflow-hidden rounded-2xl border bg-black/45 p-5 shadow-2xl backdrop-blur-2xl transition-all duration-500 ${
        active
          ? "border-[#8fb6ff]/50 bg-black/60"
          : "border-white/12 hover:border-white/30 hover:bg-white/[0.05]"
      }`}
    >
      <div
        className="pointer-events-none absolute -left-12 -top-12 h-32 w-32 rounded-full opacity-20 blur-2xl transition-opacity duration-500 group-hover:opacity-40"
        style={{ background: card.accent }}
      />

      <div className="relative">
        <div className="flex items-baseline justify-between">
          <span className="font-mono text-[10px] tracking-[0.3em] text-white/35">{card.index}</span>
          <span className="text-[9px] font-light uppercase tracking-[0.24em]" style={{ color: card.accent }}>
            {card.category}
          </span>
        </div>

        <h3 className="mt-2.5 text-lg font-light tracking-wide text-white/95">{card.title}</h3>
        <p className="text-[9px] font-light uppercase tracking-[0.3em] text-white/30">{card.titleEn}</p>

        {/* 均衡器条 */}
        <div className="mt-3 flex items-center gap-1">
          {[40, 75, 55, 90, 60, 30, 85, 45, 95, 70, 50, 80].map((h, i) => (
            <span
              key={i}
              className="inline-block w-1 rounded-full bg-[#8fb6ff]/40 transition-colors duration-300 group-hover:bg-[#8fb6ff]/80"
              style={{
                height: `${h * 0.14}px`,
                animation: `breathe ${2 + (i % 3) * 0.5}s ease-in-out infinite alternate`,
                animationDelay: `${i * 0.1}s`,
              }}
            />
          ))}
          <span className="ml-2 font-mono text-[8px] tracking-[0.16em] text-white/30">192kHz/24bit</span>
        </div>

        <p className="mt-3 text-[11px] font-light leading-relaxed text-white/50">{card.description}</p>

        <div className="mt-4 grid grid-cols-3 gap-2 border-t border-white/10 pt-3.5">
          {card.metrics.map((m) => (
            <div key={m.label}>
              <span className="block text-[8px] font-light tracking-[0.18em] text-white/30">{m.label}</span>
              <span className="mt-0.5 block font-mono text-[10px] text-white/80">{m.value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
