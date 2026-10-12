/**
 * NeteaseCloudMusicAPI Enhanced 的最小客户端封装：
 * 所有请求 GET {base}{path}，自动带 timestamp 防缓存、有登录 cookie 则带 cookie 参数。
 * 登录态完全存在访客浏览器 localStorage（本站不保存任何人账号）。
 *
 * 参数名兼容：QR 三个接口在不同版本里叫 key / qrkey / unikey / qrUniKey 不等，
 * 统一把候选参数名都发过去（未识别的参数服务端会忽略），响应端做多路径取值。
 */
import { getCookie, ncmBase } from "./config";

const TIMEOUT_MS = 12000;

async function get<T>(path: string, params: Record<string, string | number> = {}): Promise<T> {
  const base = ncmBase();
  if (!base) throw new Error("api-not-configured");
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) q.set(k, String(v));
  q.set("timestamp", String(Date.now()));
  const cookie = getCookie();
  if (cookie) q.set("cookie", cookie);
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${base}${path}?${q.toString()}`, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`http-${res.status}`);
    return (await res.json()) as T;
  } finally {
    window.clearTimeout(timer);
  }
}

/* ---------------- 浏览类（无需登录） ---------------- */

export interface NcmAlbumBrief {
  id: number;
  name: string;
  publishTime: number;
  size: number;
  picUrl: string;
  artist: { id: number; name: string };
}

export async function searchAlbum(keyword: string): Promise<NcmAlbumBrief | null> {
  const r = await get<{ result?: { albums?: NcmAlbumBrief[] } }>("/search", {
    keywords: keyword,
    type: 10,
    limit: 10,
  });
  const list = r.result?.albums ?? [];
  return list.length ? list[0] : null;
}

export interface NcmSong {
  id: number;
  name: string;
  /** 网易云 /album 返回的艺术家数组字段名是 ar，部分端点是 artists；取用时归一 */
  ar?: { id: number; name: string }[];
  artists?: { id: number; name: string }[];
  /** 毫秒：/album 端点实际给的是 dt */
  duration?: number;
  dt?: number;
  fee: number; // 0 免费 1 VIP 4 付费专辑
}

export interface NcmAlbumDetail {
  id: number;
  name: string;
  publishTime: number;
  picUrl: string;
  artist: { id: number; name: string };
  songs: NcmSong[];
  artistId?: number;
}

export async function albumDetail(id: number | string): Promise<NcmAlbumDetail | null> {
  const r = await get<{ album?: NcmAlbumDetail; songs?: NcmSong[] }>("/album", { id });
  if (!r.album) return null;
  const songs = ((r.songs ?? r.album.songs ?? []).map((s) => ({
    ...s,
    artists: s.artists ?? s.ar ?? [],
    duration: s.duration ?? s.dt ?? 0,
  })));
  return { ...r.album, songs };
}

export async function artistAlbums(artistId: number, limit = 50): Promise<NcmAlbumBrief[]> {
  const r = await get<{ hotAlbums?: NcmAlbumBrief[]; albums?: NcmAlbumBrief[] }>("/artist/album", {
    id: artistId,
    limit,
    offset: 0,
  });
  return r.hotAlbums ?? r.albums ?? [];
}

export async function lyricRaw(id: number | string): Promise<string> {
  const r = await get<{ lrc?: { lyric?: string } }>("/lyric", { id });
  return r.lrc?.lyric ?? "";
}

/* ---------------- 播放类（需登录 cookie） ---------------- */

export interface NcmUrl {
  id: number;
  url: string | null;
  code: number;
  fee?: number;
}

export async function songUrls(ids: (number | string)[], level = "exhigh"): Promise<NcmUrl[]> {
  const r = await get<{ data?: NcmUrl[] }>("/song/url/v1", { id: ids.join(","), level });
  return r.data ?? [];
}

/** 专辑全部曲目的「可播性」探测：不传 cookie 时返回的就是游客视角（VIP 曲 url=null） */
export async function playableMap(
  ids: number[],
  withCookie: boolean,
): Promise<Map<number, { url: string | null; ok: boolean }>> {
  if (!ids.length) return new Map();
  const out: NcmUrl[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    // 单次批量上限保护
    const batch = ids.slice(i, i + 50);
    if (withCookie) {
      const part = await songUrls(batch);
      out.push(...part);
    } else {
      const saved = getCookie();
      try {
        localStorage.setItem("rainburst.ncm-cookie", "");
        const part = await songUrls(batch);
        out.push(...part);
      } finally {
        if (saved) localStorage.setItem("rainburst.ncm-cookie", saved);
      }
    }
  }
  const m = new Map<number, { url: string | null; ok: boolean }>();
  for (const s of out) m.set(s.id, { url: s.url, ok: !!s.url && s.code === 200 });
  return m;
}

export async function like(id: number, add: boolean): Promise<void> {
  await get("/like", { id, add: add ? "1" : "0" });
}

export interface NcmAccount {
  ok: boolean;
  nickname?: string;
  avatarUrl?: string;
  userId?: number;
}

export async function account(): Promise<NcmAccount> {
  if (!getCookie()) return { ok: false };
  try {
    const r = await get<{ profile?: { nickname?: string; avatarUrl?: string; userId?: number } | null }>("/user/account");
    if (!r.profile) return { ok: false };
    return { ok: true, nickname: r.profile.nickname, avatarUrl: r.profile.avatarUrl, userId: r.profile.userId };
  } catch {
    return { ok: false };
  }
}

/* ---------------- 扫码登录 ---------------- */

export async function qrKey(): Promise<string> {
  const r = await get<{ data?: { unikey?: string }; unikey?: string }>("/login/qr/key");
  return r.data?.unikey ?? r.unikey ?? "";
}

/** 服务端自带二维码渲染（qrimg=1 时直接回 dataURL，无需前端绘制） */
export async function qrCreate(key: string): Promise<{ qrUrl: string; qrImg: string }> {
  const r = await get<{ data?: { qrurl?: string; qrimg?: string; qrUrl?: string } }>("/login/qr/create", {
    key,
    qrimg: 1,
  });
  return {
    qrUrl: r.data?.qrurl ?? r.data?.qrUrl ?? "",
    qrImg: r.data?.qrimg ?? "",
  };
}

/** 轮询：801 未扫 / 802 已扫待确认 / 803 成功 / 800 过期 */
export async function qrCheck(key: string): Promise<{ code: number; cookie: string }> {
  const r = await get<{
    code?: number;
    cookie?: string;
    body?: { cookie?: string };
    data?: { code?: number; cookie?: string };
  }>("/login/qr/check", { key });
  const code = r.data?.code ?? r.code ?? 0;
  const cookie = r.cookie ?? r.body?.cookie ?? r.data?.cookie ?? "";
  return { code, cookie };
}
