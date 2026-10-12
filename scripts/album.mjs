/**
 * 专辑录入 / 轮换脚本（蓝巨星「专辑展示」板块的数据入口）：
 *
 *   node scripts/album.mjs "梁博 精气神" --ncm      → 网易云数据源（需已部署 api-enhanced：设环境变量 NCM_API=https://你的地址）
 *   node scripts/album.mjs "声音玩具 劳动之余" --ncm --pin  → 写入第三张卡（固定推荐，不参与轮换）
 *   node scripts/album.mjs "some album"             → iTunes 数据源（仅展示元数据，不可播）
 *   node scripts/album.mjs --checklist              → 查看各专辑接入状态
 *
 * 轮换规则：不带 --pin 时，新专辑进 featured（「最近爱听」），原 featured 自动归档进 history。
 * 音频文件不再进仓库：播放走访客本人网易云账号的直链（见 src/netease/）。
 * intro 字段手改后重跑会保留。
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import sharp from "sharp";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const DB_PATH = join(ROOT, "src", "data", "albums.json");
const ALBUMS_DIR = join(ROOT, "public", "albums");

const args = process.argv.slice(2);
const flags = {
  pin: args.includes("--pin"),
  ncm: args.includes("--ncm"),
  checklist: args.includes("--checklist"),
};
const term = args.find((a) => !a.startsWith("--"));
const API = (process.env.NCM_API || "").replace(/\/+$/, "");

/* ---------------------------------------------------------------- 库读写 */

async function loadDb() {
  if (!existsSync(DB_PATH)) return { featured: null, history: [], pinned: null, albums: {} };
  return JSON.parse(await readFile(DB_PATH, "utf8"));
}
const saveDb = (db) => writeFile(DB_PATH, JSON.stringify(db, null, 2) + "\n", "utf8");

function printChecklist(db) {
  for (const id of [db.featured, db.pinned, ...db.history].filter(Boolean)) {
    const al = db.albums[id];
    if (!al) continue;
    const n = al.tracks.filter((t) => t.neteaseId).length;
    console.log(
      `  [${al.id}] ${al.artist} — ${al.title}  ${al.ncmId ? `✓ 已接入网易云（${n} 首）` : "✗ 仅展示数据（--ncm 重新灌入后可播）"}`,
    );
  }
}

if (flags.checklist) {
  printChecklist(await loadDb());
  process.exit(0);
}
if (!term) {
  console.error('用法：node scripts/album.mjs "歌手 专辑名" [--ncm] [--pin] ；--checklist 查看接入状态');
  process.exit(1);
}
if (flags.ncm && !API) {
  console.error("缺 API 地址：先部署 api-enhanced（README『专辑播放服务部署』），再 NCM_API=https://... npm run album -- \"歌手 专辑名\" --ncm");
  process.exit(1);
}

/* ---------------------------------------------------------------- 抓专辑 */

const jget = async (url) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.json();
};

/** 统一中间形状 */
async function fetchViaNcm(term) {
  console.log(`查询网易云（${API}）：${term}`);
  const s = await jget(`${API}/search?keywords=${encodeURIComponent(term)}&type=10&limit=10&timestamp=${Date.now()}`);
  const cand = s?.result?.albums?.[0];
  if (!cand) {
    console.error("网易云没搜到这张专辑，换个关键词（歌手 + 专辑名）再试");
    process.exit(1);
  }
  const d = await jget(`${API}/album?id=${cand.id}&timestamp=${Date.now()}`);
  const album = d.album ?? cand;
  const songs = (d.songs ?? album.songs ?? []).map((x, i) => ({
    n: i + 1,
    title: x.name,
    ms: x.duration ?? x.dt ?? 0,
    neteaseId: x.id,
  }));
  const picUrl = album.picUrl || cand.picUrl;
  return {
    title: album.name,
    artist: album.artist?.name ?? cand.artist?.name ?? "",
    artistId: album.artist?.id ?? cand.artist?.id ?? 0,
    date: album.publishTime ? new Date(album.publishTime).toISOString().slice(0, 10) : "",
    genres: [],
    coverSrc: picUrl ? `${picUrl}?param=600x600` : "",
    ncmId: album.id ?? cand.id,
    tracks: songs,
  };
}

function pickAlbum(results, fullTerm) {
  const toks = fullTerm.split(/\s+/).filter(Boolean);
  let best = null;
  let bestScore = 0;
  for (const r of results) {
    const name = (r.collectionName || "").toLowerCase();
    let score = 0;
    for (const t of toks) {
      const tl = t.toLowerCase();
      if (name.includes(tl)) score += 3;
      if ((r.artistName || "").toLowerCase().includes(tl)) score += 1;
    }
    if (name === fullTerm.toLowerCase()) score += 5;
    if (name.includes("various") || (r.artistName || "").includes("Various Artists")) score -= 4;
    if (score > bestScore) {
      bestScore = score;
      best = r;
    }
  }
  return bestScore >= 3 ? best : null;
}

async function fetchViaItunes(term) {
  console.log(`查询 iTunes：${term}`);
  const search = await jget(`https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=album&limit=25`);
  const hit = pickAlbum(search.results || [], term);
  if (!hit) {
    console.error(`没找到匹配专辑。候选：\n${(search.results || []).slice(0, 8).map((r) => `  ${r.collectionName} — ${r.artistName}`).join("\n")}`);
    process.exit(1);
  }
  const songRes = await jget(`https://itunes.apple.com/lookup?id=${hit.collectionId}&entity=song&limit=200`);
  const songs = (songRes.results || [])
    .filter((r) => r.kind === "song" && r.collectionId === hit.collectionId)
    .sort((a, b) => (a.discNumber || 1) - (b.discNumber || 1) || (a.trackNumber || 0) - (b.trackNumber || 0))
    .map((s, i) => ({ n: i + 1, title: s.trackName, ms: s.trackTimeMillis || 0 }));
  console.log(`  ✓ ${hit.collectionName} — ${hit.artistName}（${(hit.releaseDate || "").slice(0, 10)}，${hit.trackCount} 曲）`);
  return {
    title: hit.collectionName,
    artist: hit.artistName,
    artistId: 0,
    date: (hit.releaseDate || "").slice(0, 10),
    genres: (hit.primaryGenreName ? [hit.primaryGenreName] : []).concat((hit.genres || []).slice(0, 2)).filter((g, i, a) => g && a.indexOf(g) === i && g !== "Music").slice(0, 3),
    coverSrc: (hit.artworkUrl100 || "").replace("100x100bb", "600x600bb"),
    ncmId: 0,
    tracks: songs,
  };
}

/* ---------------------------------------------------------------- 封面 + 取色 */

function slug(title) {
  return title.replace(/\s+/g, "-").replace(/[\\/:*?"<>|]/g, "").trim();
}

async function fetchAccent(coverPath) {
  const img = sharp(coverPath);
  const { data } = await img.clone().resize(6, 6, { fit: "fill" }).raw().toBuffer({ resolveWithObject: true });
  let accent = "#e0a25c";
  let bestPx = -1;
  for (let i = 0; i < 36; i++) {
    const r = data[i * 4] / 255;
    const g = data[i * 4 + 1] / 255;
    const b = data[i * 4 + 2] / 255;
    const mx = Math.max(r, g, b);
    const mn = Math.min(r, g, b);
    const sat = mx === 0 ? 0 : (mx - mn) / mx;
    const v = sat * mx * (1 - Math.abs(mx - 0.55) * 0.8);
    if (v > bestPx) {
      bestPx = v;
      accent = "#" + [r, g, b].map((c) => Math.round(Math.min(1, c * 1.35) * 255).toString(16).padStart(2, "0")).join("");
    }
  }
  return accent;
}

/* ---------------------------------------------------------------- 主流程 */

const raw = flags.ncm ? await fetchViaNcm(term) : await fetchViaItunes(term);
const id = slug(raw.title);
const coverFile = `albums/${id}.webp`;

await mkdir(ALBUMS_DIR, { recursive: true });
if (raw.coverSrc) {
  const coverBuf = await (await fetch(raw.coverSrc)).arrayBuffer();
  await sharp(Buffer.from(coverBuf)).webp({ quality: 80 }).toFile(join(ROOT, "public", coverFile));
  console.log(`  ✓ 封面 → public/${coverFile}`);
}
const accent = raw.coverSrc ? await fetchAccent(join(ROOT, "public", coverFile)) : "#e0a25c";
console.log(`  · 主色 ${accent}`);

const album = {
  id,
  title: raw.title,
  artist: raw.artist,
  year: raw.date ? raw.date.slice(0, 4) : "",
  date: raw.date,
  genres: raw.genres,
  cover: coverFile,
  accent,
  intro: "",
  ncmId: raw.ncmId || undefined,
  artistId: raw.artistId || undefined,
  tracks: raw.tracks.map((t) => ({ n: t.n, title: t.title, ms: t.ms, neteaseId: t.neteaseId ?? undefined })),
};

const db = await loadDb();
if (db.albums[id]?.intro) album.intro = db.albums[id].intro; // 手改文案保留
db.albums[id] = { ...album, intro: album.intro };

if (flags.pin) {
  db.pinned = id;
  console.log("  ✓ 已设为第三张卡（固定推荐）");
} else {
  // 归档条件：原 featured 存在、不同专辑、且真的接入过网易云（iTunes 展示态数据换源重灌时不该进历史）
  const prev = db.featured ? db.albums[db.featured] : null;
  if (prev && db.featured !== id && prev.ncmId) {
    db.history = [db.featured, ...db.history.filter((h) => h !== id && h !== db.featured)].slice(0, 24);
    console.log(`  ✓ 原「${prev.title}」已归档进历史列表`);
  }
  db.featured = id;
  console.log("  ✓ 已设为「最近爱听」");
}
await saveDb(db);
printChecklist(db);
console.log("\n完成。专辑一句话介绍改 src/data/albums.json 的 intro 字段（重跑会保留）。");
