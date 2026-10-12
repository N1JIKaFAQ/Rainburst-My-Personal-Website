import { useCallback, useEffect, useRef, useState } from "react";
import { ncmConfigured, setCookie } from "./config";
import { qrKey, qrCreate, qrCheck, account } from "./api";

interface Props {
  /** 登录成功（cookie 已存）→ 父组件刷新账号并继续播放 */
  onSuccess: () => void;
  onClose: () => void;
}

type Phase = "loading" | "scan" | "scanned" | "expired" | "failed";

/** 网易云扫码登录弹窗：拿 key → 生成二维码（服务端出图）→ 2s 轮询扫码状态 */
export default function LoginModal({ onSuccess, onClose }: Props) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [qrImg, setQrImg] = useState<string>("");
  const [msg, setMsg] = useState("");
  const keyRef = useRef("");
  const aliveRef = useRef(true);
  const pollRef = useRef(0);

  const start = useCallback(async () => {
    setPhase("loading");
    setQrImg("");
    setMsg("");
    if (!ncmConfigured()) {
      setPhase("failed");
      setMsg("播放服务还没部署——把 API 地址填进 src/netease/config.ts 后再试");
      return;
    }
    try {
      const key = await qrKey();
      if (!key) throw new Error("no-key");
      keyRef.current = key;
      const { qrImg: img, qrUrl } = await qrCreate(key);
      if (!img && !qrUrl) throw new Error("no-url");
      if (!aliveRef.current) return;
      // 服务端 qrimg 是现成的 dataURL；没有则无法本地绘制（提示换端）
      if (!img) {
        setPhase("failed");
        setMsg("服务端未返回二维码图，请检查 api-enhanced 版本");
        return;
      }
      setQrImg(img);
      setPhase("scan");
      const startedAt = Date.now();
      const poll = async () => {
        if (!aliveRef.current) return;
        try {
          const r = await qrCheck(keyRef.current);
          if (!aliveRef.current) return;
          if (r.code === 803 && r.cookie) {
            setCookie(r.cookie);
            const acc = await account();
            if (acc.ok) onSuccess();
            else setMsg("登录似乎没生效，重试一次");
            return;
          }
          if (r.code === 802) setPhase("scanned");
          else if (r.code === 800) {
            setPhase("expired");
            return;
          }
          // key 有效期约 60s，超时自动换一张
          if (Date.now() - startedAt > 55_000) {
            setPhase("expired");
            return;
          }
        } catch {
          if (!aliveRef.current) return;
          setPhase("failed");
          setMsg("登录服务连不上（地址不对 / 跨域被拒 / 服务未启动）");
          return;
        }
        pollRef.current = window.setTimeout(poll, 2000);
      };
      pollRef.current = window.setTimeout(poll, 2000);
    } catch {
      if (!aliveRef.current) return;
      setPhase("failed");
      setMsg("登录服务连不上（地址不对 / 跨域被拒 / 服务未启动）");
    }
  }, [onSuccess]);

  useEffect(() => {
    aliveRef.current = true;
    void start();
    return () => {
      aliveRef.current = false;
      window.clearTimeout(pollRef.current);
    };
  }, [start]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-6">
      <button aria-label="关闭" className="absolute inset-0 cursor-default bg-black/55 backdrop-blur-sm" onClick={onClose} />
      <div className="anim-caption-in relative w-full max-w-[340px] rounded-2xl border border-white/12 bg-[#161009]/95 p-6 text-center shadow-[0_30px_90px_rgba(0,0,0,0.7)]">
        <p className="text-[15px] font-light tracking-[0.18em] text-white/90">登录后即可播放</p>
        <p className="mt-1.5 text-[11px] font-light leading-relaxed text-white/45">
          用你本人的网易云音乐 App 扫码，音乐通过你自己的账号播放，本站不保存任何账号信息
        </p>
        <div className="mx-auto mt-5 flex h-[216px] w-[216px] items-center justify-center overflow-hidden rounded-xl bg-[#f6efe4]">
          {qrImg ? (
            <img src={qrImg} alt="网易云登录二维码" className="h-full w-full" />
          ) : (
            <span className="px-6 text-[12px] leading-relaxed text-black/50">
              {phase === "loading" ? "二维码生成中…" : phase === "failed" ? msg : phase === "expired" ? "已过期" : "准备中…"}
            </span>
          )}
        </div>
        <p className="mt-4 h-4 text-[11px] font-light tracking-[0.14em] text-white/55">
          {phase === "scan" && "等待扫码 · 网易云 App 扫一扫"}
          {phase === "scanned" && "已扫码 · 请在手机上点确认"}
          {phase === "expired" && "二维码已过期"}
        </p>
        <div className="mt-4 flex justify-center gap-3">
          {phase === "expired" && (
            <button onClick={() => void start()} className="cursor-pointer rounded-full border border-white/15 bg-white/[0.07] px-5 py-1.5 text-[11px] font-light tracking-[0.22em] text-white/85 transition-colors duration-300 hover:bg-white/[0.14]">
              换一张
            </button>
          )}
          <button onClick={onClose} className="cursor-pointer rounded-full border border-white/10 px-5 py-1.5 text-[11px] font-light tracking-[0.22em] text-white/50 transition-colors duration-300 hover:text-white">
            先不登录
          </button>
        </div>
      </div>
    </div>
  );
}
