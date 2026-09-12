import { useEffect, useRef, useState } from "react";
import { music, type MusicState } from "../audio/music";
import { audioConfig } from "../data/site";

interface Props {
  /** top：蓝巨星页顶部（避开底部卡片行）；bottom：其余视图 */
  position?: "bottom" | "top";
}

/**
 * 全站唯一的液态玻璃胶囊播放器：
 * 内部为实时频谱细条（左高右低"山脉"轮廓），歌名居中浮在条上方。
 * 挂在 App，跨视图常驻。
 */
export default function MusicCapsule({ position = "bottom" }: Props) {
  const [state, setState] = useState<MusicState>(music.getState());
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const barCount = audioConfig.bars;
  const playingRef = useRef(false);
  playingRef.current = state.playing;

  useEffect(() => music.subscribe(setState), []);

  /* ---------- 频谱绘制 ---------- */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    const prev: number[] = Array(barCount).fill(0);

    const render = (now: number) => {
      raf = requestAnimationFrame(render);
      const spec = music.getSpectrum();
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = rect.width;
      const h = rect.height;
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.scale(dpr, dpr);

      const gap = 1.5;
      const barW = (w - (barCount - 1) * gap) / barCount;
      const baseY = h * 0.72;
      const maxH = h * 0.58;

      for (let i = 0; i < barCount; i++) {
        // 未播放时：低幅呼吸 idle（reduced-motion 下为静止短线）
        const idle = reduced ? 0.05 : 0.05 + 0.05 * Math.sin(now * 0.0022 + i * 0.55);
        const target = playingRef.current ? (spec[i] ?? 0) : Math.max(0, idle);
        prev[i] += (target - prev[i]) * 0.28;
        const barH = Math.max(2, prev[i] * maxH);
        const x = i * (barW + gap);
        const radius = Math.min(barW * 0.55, barH * 0.35);
        ctx.beginPath();
        ctx.roundRect(x, baseY - barH, barW, barH, [radius, radius, 0, 0]);
        const grad = ctx.createLinearGradient(0, baseY - barH, 0, baseY);
        grad.addColorStop(0, "rgba(143,182,255,0.92)");
        grad.addColorStop(1, "rgba(255,255,255,0.26)");
        ctx.fillStyle = grad;
        ctx.fill();
      }

      // 右侧"虚线山脚"装饰，还原参考图尾部
      ctx.strokeStyle = "rgba(255,255,255,0.22)";
      ctx.lineWidth = 1.2;
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.moveTo((barCount - 3) * (barW + gap) + barW, baseY);
      ctx.lineTo(w - 6, baseY);
      ctx.stroke();
      ctx.setLineDash([]);
    };

    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
  }, [barCount]);

  /* ---------- 中央文案 ---------- */
  let center: string | null;
  if (state.error) center = "音源不可用";
  else if (!state.unlocked) center = "轻触任意处 · 唤醒声音";
  else if (state.track) center = state.mode === "dedicated" ? state.track.title : state.track.titleEn;
  else center = null;

  return (
    <div
      className={`fixed left-1/2 z-50 -translate-x-1/2 ${
        /* 窄屏：底部导航会变两行、蓝巨星页 header 占满首行，胶囊上移避让 */
        position === "top" ? "top-20 sm:top-6" : "bottom-24 sm:bottom-6"
      }`}
    >
      <div className="group relative h-12 w-[min(320px,calc(100vw-3rem))] overflow-hidden rounded-full border border-white/10 bg-black/45 shadow-2xl backdrop-blur-2xl">
        {/* 内层液态高光 */}
        <div
          className="pointer-events-none absolute inset-0 rounded-full opacity-40"
          style={{
            background:
              "radial-gradient(90px 60px at 20% 8%, rgba(255,255,255,0.20), transparent 60%), radial-gradient(130px 80px at 82% 95%, rgba(143,182,255,0.14), transparent 70%)",
          }}
        />

        {/* 频谱层 */}
        <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />

        {/* 中央歌名层（浮在条上方） */}
        {center && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
            <span
              className="max-w-[78%] truncate text-center text-[10px] font-light uppercase tracking-[0.3em] text-white/85"
              style={{
                padding: "3px 14px",
                borderRadius: "999px",
                background:
                  "radial-gradient(ellipse 100px 46px at center, rgba(3,3,4,0.62), transparent 78%)",
                textShadow: "0 0 12px rgba(0,0,0,0.85), 0 0 22px rgba(143,182,255,0.30)",
              }}
            >
              {center}
            </span>
          </div>
        )}

        {/* 左端触控区：点击=播放/暂停。播放中淡显，暂停时常显 */}
        <button
          onClick={() => music.toggle()}
          aria-label={state.playing ? "暂停音乐" : "播放音乐"}
          className={`absolute left-0 top-0 z-20 flex h-full w-10 cursor-pointer items-center justify-center transition-opacity duration-300 ${
            state.playing ? "opacity-0 group-hover:opacity-100" : "opacity-70 hover:opacity-100"
          }`}
        >
          <span className="flex h-6 w-6 items-center justify-center rounded-full border border-white/15 bg-black/35 backdrop-blur-sm">
            {state.playing ? (
              <span className="flex gap-[3px]">
                <span className="h-2.5 w-[2px] rounded-full bg-white/85" />
                <span className="h-2.5 w-[2px] rounded-full bg-white/85" />
              </span>
            ) : (
              <svg className="ml-[1px] h-2.5 w-2.5 fill-white/85" viewBox="0 0 12 12">
                <path d="M2 1.5v9l8-4.5z" />
              </svg>
            )}
          </span>
        </button>
      </div>
    </div>
  );
}
