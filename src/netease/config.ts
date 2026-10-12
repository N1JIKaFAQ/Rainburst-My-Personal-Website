/**
 * 网易云 API（NeteaseCloudMusicApiEnhanced）配置。
 *
 * 该服务必须自行部署（无公开演示域名；MIT，开箱 CORS）：
 *   docker:  docker run -d -p 16641:16641 moefurina/ncm-api:latest
 *   详见 README「专辑播放服务部署」。
 * 部署好把地址填进 NCM_BASE（或以 localStorage 'rainburst.ncm-base' 临时覆盖调试）。
 * 未配置时所有播放入口给出友好提示，浏览（曲目表/歌词）不受影响。
 */

/** ⚠️ 部署 api-enhanced 后把网址粘贴到这里（结尾不要带斜杠），例如 "https://ncm.你的域名.com" */
export const NCM_BASE = "";

const OVERRIDE_KEY = "rainburst.ncm-base";

export function ncmBase(): string {
  try {
    const v = localStorage.getItem(OVERRIDE_KEY);
    if (v && /^https?:\/\//i.test(v)) return v.replace(/\/+$/, "");
  } catch {
    /* ignore */
  }
  return NCM_BASE.replace(/\/+$/, "");
}

export const ncmConfigured = (): boolean => ncmBase().length > 0;

/* ---------------- 登录 cookie（MUSIC_U）本地保管 ---------------- */

const COOKIE_KEY = "rainburst.ncm-cookie";

export function getCookie(): string {
  try {
    return localStorage.getItem(COOKIE_KEY) ?? "";
  } catch {
    return "";
  }
}

export function setCookie(c: string) {
  try {
    if (c) localStorage.setItem(COOKIE_KEY, c);
    else localStorage.removeItem(COOKIE_KEY);
  } catch {
    /* ignore */
  }
}
