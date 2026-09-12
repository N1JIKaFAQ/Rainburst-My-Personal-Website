import { useEffect, useRef, useState } from "react";
import { music, type MusicState } from "../audio/music";
import { audioConfig } from "../data/site";
import { createLiquidGlassFilter } from "../utils/liquidGlass";
import type { Cosmos } from "../universe/engine";

interface Props {
  /** top：蓝巨星页顶部（避开底部卡片行）；bottom：其余视图 */
  position?: "bottom" | "top";
  /** 宇宙引擎 ref，用于读取黑洞位置做排斥计算 */
  engineRef: React.RefObject<Cosmos | null>;
}

/**
 * 全站唯一的液态玻璃胶囊播放器：
 * 内部为实时频谱细条（左高右低"山脉"轮廓），歌名居中浮在条上方。
 * 挂在 App，跨视图常驻。
 */
export default function MusicCapsule({ position = "bottom", engineRef }: Props) {
  const [state, setState] = useState<MusicState>(music.getState());
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const outerRef = useRef<HTMLDivElement>(null);
  /** 黑洞已接触胶囊（带滞回），锁定期间推量钉在极限 */
  const lockedRef = useRef(false);
  /** 接触瞬间锁存的推开方向（±1），黑洞穿过去也不翻转 */
  const dirRef = useRef({ x: 0, y: -1 });
  /** 棘轮行程峰值：只增不减，达到极限后钉住直到黑洞离开 */
  const peakRef = useRef({ x: 0, y: 0 });
  /** 重物惯性：质量-弹簧-阻尼积分的速度项 */
  const velRef = useRef({ x: 0, y: 0 });
  const barCount = audioConfig.bars;
  const playingRef = useRef(false);
  playingRef.current = state.playing;

  useEffect(() => music.subscribe(setState), []);

  /* ---------- 液态玻璃滤镜（挂载时 + resize 防抖重建） ---------- */
  useEffect(() => {
    let t = 0;
    const apply = () => {
      const el = outerRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      if (r.width < 40 || r.height < 20) return;
      try {
        const filterId = createLiquidGlassFilter({
          width: r.width,
          height: r.height,
          radius: r.height / 2,
          intensity: 0.5,
          id: "music-capsule",
        });
        el.style.setProperty("--lg-filter", `url(#${filterId}) blur(2px)`);
      } catch {
        /* 生成失败 → CSS 自动回退到纯 blur 毛玻璃 */
      }
    };
    const raf = requestAnimationFrame(apply); // 等布局稳定后测尺寸
    const onResize = () => {
      window.clearTimeout(t);
      t = window.setTimeout(apply, 200);
    };
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(t);
      window.removeEventListener("resize", onResize);
      document.getElementById("music-capsule")?.remove();
    };
  }, []);

  /* ---------- 黑洞排斥：椭圆势垒 + 弹簧回位 ---------- */
  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const cur = { x: 0, y: 0 };
    let raf = 0;
    let last = 0;

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const dt = last ? Math.min(1 / 30, Math.max(0.001, (now - last) / 1000)) : 1 / 60;
      last = now;
      const el = outerRef.current;
      if (!el) return; // 挂载前可能为 null，等下一帧
      const bh = engineRef.current?.getBlackhole();
      let tx = 0;
      let ty = 0;

      if (bh) {
        const r = el.getBoundingClientRect(); // 含当前位移：判定的是"看得见的胶囊"
        const halfW = r.width / 2;
        const halfH = r.height / 2;
        const dispCx = r.left + halfW; // 显示中心
        const dispCy = r.top + halfH;

        // 圆-矩形最近点距离：gap<0 才算真正接触
        const qx = Math.max(r.left, Math.min(bh.x, r.right));
        const qy = Math.max(r.top, Math.min(bh.y, r.bottom));
        const gap = Math.hypot(bh.x - qx, bh.y - qy) - bh.r;

        if (gap < 0) {
          if (!lockedRef.current) {
            // 初次接触：锁存推开方向（此后不再翻转，黑洞穿过去也保持）
            lockedRef.current = true;
            const vdx = dispCx - cur.x - bh.x; // 用虚拟中心定方向，避免被自身位移影响
            const vdy = dispCy - cur.y - bh.y;
            dirRef.current.x = vdx !== 0 ? Math.sign(vdx) : (bh.x >= window.innerWidth / 2 ? -1 : 1);
            dirRef.current.y = vdy !== 0 ? Math.sign(vdy) : -1;
            peakRef.current.x = 0;
            peakRef.current.y = 0;
          }
        } else if (gap > 16) {
          // 黑洞彻底移出胶囊（含 16px 滞回）才释放
          lockedRef.current = false;
          peakRef.current.x = 0;
          peakRef.current.y = 0;
        }

        if (lockedRef.current && !reduced && bh.influence > 0.2 && !bh.swallowing) {
          // 侵入深度：相对锚点中心计算（否则胶囊被推走后会自己"躲开"推力，永远到不了极限）
          const anchorCx = dispCx - cur.x;
          const anchorCy = dispCy - cur.y;
          const dX = Math.min(1, Math.max(0, (halfW + bh.r - Math.abs(bh.x - anchorCx)) / halfW));
          const dY = Math.min(1, Math.max(0, (halfH + bh.r - Math.abs(bh.y - anchorCy)) / halfH));
          // 一接触就推：推力随侵入深度渐进，无静摩擦死区
          const kX = dX;
          const kY = dY;
          const maxRepX = Math.max(24, halfW * 0.72); // 约为旧上限的 1/3
          const maxRepY = Math.min(halfH * 0.72, 46);

          // 棘轮缓爬：行程上限以 55px/s 向上爬，重物要一直顶着才到位；只增不减
          const climb = 55 * dt;
          peakRef.current.x = Math.max(
            peakRef.current.x,
            Math.min(maxRepX * kX, peakRef.current.x + climb)
          );
          peakRef.current.y = Math.max(
            peakRef.current.y,
            Math.min(maxRepY * kY, peakRef.current.y + climb)
          );

          tx = dirRef.current.x * peakRef.current.x;
          // bottom 态只允许上推、top 态只允许下推（防止被挤出屏幕边缘）
          const rawTy = dirRef.current.y * peakRef.current.y;
          ty = position === "bottom" ? Math.min(0, rawTy) : Math.max(0, rawTy);
        }
      }

      // 质量-弹簧-阻尼积分：起步迟疑、缓慢加速、临界阻尼不过冲（重物手感）
      const K = 5.5;
      const C = 4.7;
      velRef.current.x += (tx - cur.x) * K * dt;
      velRef.current.y += (ty - cur.y) * K * dt;
      const damp = Math.exp(-C * dt);
      velRef.current.x *= damp;
      velRef.current.y *= damp;
      cur.x += velRef.current.x * dt;
      cur.y += velRef.current.y * dt;

      // 静止判定：目标为 0 且已基本停住时归零，避免无意义写入
      if (
        tx === 0 &&
        ty === 0 &&
        Math.abs(cur.x) < 0.05 &&
        Math.abs(cur.y) < 0.05 &&
        Math.abs(velRef.current.x) < 0.8 &&
        Math.abs(velRef.current.y) < 0.8
      ) {
        cur.x = 0;
        cur.y = 0;
        velRef.current.x = 0;
        velRef.current.y = 0;
      }
      el.style.transform = `translate(-50%, 0) translate(${cur.x.toFixed(2)}px, ${cur.y.toFixed(2)}px)`;
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [engineRef, position]);

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
      ref={outerRef}
      className={`fixed left-1/2 z-50 ${
        /* 窄屏：底部导航会变两行、蓝巨星页 header 占满首行，胶囊上移避让 */
        position === "top" ? "top-20 sm:top-6" : "bottom-24 sm:bottom-6"
      }`}
      style={{ transform: "translate(-50%, 0)" }}
    >
      <div
        className="group relative h-12 w-[min(320px,calc(100vw-3rem))] overflow-hidden rounded-full border border-white/15 shadow-[0_8px_32px_rgba(2,4,12,0.35)]"
        style={{
          background: "linear-gradient(160deg, rgba(255,255,255,0.10), rgba(255,255,255,0.03) 45%, rgba(143,182,255,0.06))",
          backdropFilter: "var(--lg-filter, blur(18px)) saturate(1.4) brightness(1.06)",
          WebkitBackdropFilter: "var(--lg-filter, blur(18px)) saturate(1.4) brightness(1.06)",
          boxShadow:
            "inset 0 1px 0 rgba(255,255,255,0.22), inset 0 -1px 0 rgba(255,255,255,0.06), 0 8px 32px rgba(2,4,12,0.35)",
        }}
      >
        {/* 内层高光（镜面反射质感） */}
        <div
          className="pointer-events-none absolute inset-0 rounded-full opacity-25"
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
              className="max-w-[78%] truncate text-center text-[10px] font-light uppercase tracking-[0.3em] text-white/95"
              style={{
                padding: "3px 14px",
                borderRadius: "999px",
                textShadow:
                  "0 1px 10px rgba(4,6,16,0.75), 0 0 22px rgba(143,182,255,0.40)",
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
