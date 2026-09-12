import { useEffect, useMemo, useRef, useState } from "react";
import { Cosmos, type CaptureInfo } from "../universe/engine";
import { nav, site, stars, type StarDef } from "../data/site";

interface Props {
  enterMode: "intro" | "return";
  enterColor: string;
  onCapture: (info: CaptureInfo | null) => void;
  onSwallowStart: (def: StarDef) => void;
  onSwallowDone: (def: StarDef) => void;
  engineRef: React.RefObject<Cosmos | null>;
}

export default function CosmosView({
  enterMode,
  enterColor,
  onCapture,
  onSwallowStart,
  onSwallowDone,
  engineRef,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cbRef = useRef({ onCapture, onSwallowStart, onSwallowDone });
  cbRef.current = { onCapture, onSwallowStart, onSwallowDone };

  const [captured, setCaptured] = useState<CaptureInfo | null>(null);
  const [exiting, setExiting] = useState(false);

  const coarse = useMemo(
    () => typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches,
    []
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const engine = new Cosmos(canvas, {
      onCapture: (info) => {
        setCaptured(info);
        cbRef.current.onCapture(info);
      },
      onSwallowStart: (def) => {
        setExiting(true);
        setCaptured(null);
        cbRef.current.onSwallowStart(def);
      },
      onSwallowDone: (def) => cbRef.current.onSwallowDone(def),
    });
    engine.setStarDefs(stars);
    engine.setEnter(enterMode, enterColor);
    engineRef.current = engine;
    return () => {
      engine.destroy();
      engineRef.current = null;
      canvas.style.cursor = "";
    };
    // 只为首次挂载：enterMode 的变化由父组件重新挂载时带进来
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 键盘可达性：捕获状态下回车 = 进入
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!captured) return;
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        engineRef.current?.clickStar(captured.def.id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [captured, engineRef]);

  const quiet = !!captured || exiting;
  // 恒星偏下就把字幕放上面，避免字幕被视口切掉
  const aboveCue = !!captured && captured.y > window.innerHeight * 0.55;

  return (
    <div className="fixed inset-0 overflow-hidden bg-[#030304]">
      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full touch-none select-none"
      />

      {/* ---------------- 文字层：极简、白色、细 ---------------- */}
      <div
        className={`pointer-events-none absolute inset-0 transition-opacity duration-[900ms] ease-out ${
          quiet ? "opacity-25" : "opacity-100"
        }`}
      >
        <div className="absolute left-[7vw] top-1/2 max-w-[62vw] -translate-y-1/2 sm:max-w-[46vw]">
          <p className="anim-fade-up delay-1 text-[11px] font-light uppercase tracking-[0.42em] text-white/40">
            {site.eyebrow}
          </p>
          <h1 className="anim-fade-up delay-2 mt-5 text-[15vw] font-thin leading-[0.92] tracking-[-0.04em] text-white/95 sm:mt-6 sm:text-[8.4vw] lg:text-[6.6vw]">
            {site.name}
          </h1>
          <p className="anim-fade-up delay-3 mt-3 text-[10px] font-light uppercase tracking-[0.5em] text-white/30 sm:text-[11px]">
            {site.nameLatin}
          </p>
          <p className="anim-fade-up delay-4 mt-8 max-w-[24rem] text-sm font-light leading-relaxed text-white/55 sm:text-base">
            {site.slogan}
          </p>
          <p
            className={`anim-fade-up delay-5 mt-10 flex items-center gap-3 text-[11px] font-light tracking-[0.3em] text-white/45 transition-opacity duration-700 ${
              quiet ? "opacity-0" : "opacity-100"
            }`}
          >
            <span className="anim-breathe-soft inline-block h-[5px] w-[5px] rounded-full bg-white/70" />
            <span className="anim-breathe">{coarse ? "轻触屏幕探索宇宙" : site.hint}</span>
          </p>
        </div>
      </div>

      {/* ---------------- 角落导航 ---------------- */}
      <nav
        className={`absolute bottom-6 left-[7vw] right-[7vw] flex flex-wrap items-center gap-x-7 gap-y-3 transition-all duration-700 sm:bottom-8 ${
          quiet ? "pointer-events-none opacity-0" : "opacity-100"
        }`}
      >
        {nav.map((n) => (
          <button
            key={n.label}
            onMouseEnter={() => engineRef.current?.hintStar(n.starId)}
            onMouseLeave={() => engineRef.current?.hintStar(null)}
            onClick={() => engineRef.current?.enterStar(n.starId)}
            className="group anim-fade-up delay-4 flex items-baseline gap-2 text-[11px] font-light tracking-[0.28em] text-white/40 transition-colors duration-300 hover:text-white"
          >
            <span>{n.label}</span>
            <span className="text-[9px] uppercase tracking-[0.2em] text-white/20 transition-colors duration-300 group-hover:text-white/50">
              {n.en}
            </span>
          </button>
        ))}
      </nav>

      <div
        className={`pointer-events-none absolute bottom-6 right-[7vw] hidden text-right transition-opacity duration-700 sm:bottom-8 sm:block ${
          quiet ? "opacity-0" : "opacity-100"
        }`}
      >
        <p className="anim-fade-in delay-5 text-[10px] font-light uppercase tracking-[0.3em] text-white/25">
          {site.coordinates}
        </p>
        <p className="anim-fade-in delay-5 mt-2 text-[10px] font-light tracking-[0.24em] text-white/20">
          {site.footer}
        </p>
      </div>

      {/* ---------------- 恒星捕获字幕（苹果式淡入） ---------------- */}
      {captured && (
        <div
          className="anim-caption-in absolute z-20"
          style={{
            left: captured.x,
            top: aboveCue ? captured.y - 46 : captured.y + 46,
            transform: `translate(-50%, ${aboveCue ? "-100%" : "0"})`,
          }}
        >
          <button
            onClick={() => engineRef.current?.clickStar(captured.def.id)}
            className="group pointer-events-auto flex cursor-pointer flex-col items-center"
          >
            <span
              className="mb-6 block h-3 w-px opacity-70"
              style={{ background: `linear-gradient(to bottom, transparent, ${captured.def.color})` }}
            />
            <span
              className="text-[10px] font-light uppercase tracking-[0.44em]"
              style={{ color: captured.def.color }}
            >
              {captured.def.nameEn}
            </span>
            <span className="mt-3 text-3xl font-thin tracking-[0.06em] text-white/95 transition-colors duration-500 sm:text-4xl">
              {captured.def.section}
            </span>
            <span className="mt-2 text-[10px] font-light uppercase tracking-[0.4em] text-white/35">
              {captured.def.sectionEn}
            </span>
            <span className="mt-5 max-w-[16rem] text-center text-[11px] font-light leading-relaxed tracking-[0.08em] text-white/45">
              {captured.def.tagline}
            </span>
            <span className="mt-6 rounded-full border border-white/15 px-4 py-1.5 text-[10px] font-light uppercase tracking-[0.3em] text-white/60 transition-all duration-500 group-hover:border-white/40 group-hover:bg-white/5 group-hover:text-white">
              点击进入
            </span>
          </button>
        </div>
      )}
    </div>
  );
}
