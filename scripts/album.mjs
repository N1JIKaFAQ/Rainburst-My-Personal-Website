/**
 * 专辑录入 / 轮换脚本（蓝巨星「专辑展示」板块的数据入口）：
 *
 *   node scripts/album.mjs "梁博 精气神"        → 设为「最近爱听」(featured)，原 featured 自动归档进 history
 *   node scripts/album.mjs "声音玩具 劳动之余" --pin  → 设为第三张卡（固定推荐，不参与轮换）
 *   node scripts/album.mjs --scan              → 重新扫描 public/Music/<专辑>/，把实际文件挂进曲目表
 *   node scripts/album.mjs --checklist         → 查看各专辑的音频目录与放置说明
 *
 * 曲目真相 = 你放进 public/Music/<专辑名>/ 的音频文件（mp3/flac/m4a，文件名即曲名，建议 NN 前缀排序）；
 * iTunes 的曲目表只在目录还没有文件时作为灰色兑底展示。每次 fetch/rotate 都会自动附带一次 scan。
 * 音频文件本身由本人管理（不自动下载）。
 */
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve, extname, basename } from "node:path";
import sharp from "sharp";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const DB_PATH = join(ROOT, "src", "data", "albums.json");
const ALBUMS_DIR = join(ROOT, "public", "albums");

/* ---------------------------------------------------------------- CLI */

const args = process.argv.slice(2);
const flags = { pin: args.includes("--pin"), scan: args.includes("--scan"), checklist: args.includes("--checklist") };
const term = args.find((a) => !a.startsWith("--"));

async function loadDb() {
  if (!existsSync(DB_PATH)) return { featured: null, history: [], pinned: null, albums: {} };
  return JSON.parse(await readFile(DB_PATH, "utf8"));
}
const saveDb = (db) => writeFile(DB_PATH, JSON.stringify(db, null, 2) + "\n", "utf8");

function printChecklist(db) {
  for (const id of [db.featured, db.pinned, ...db.history].filter(Boolean)) {
    const al = db.albums[id];
    if (!al) continue;
    const withFile = al.tracks.filter((t) => t.file).length;
    const mark = withFile ? `✓ 已挂载 ${withFile}/${al.tracks.length} 个音频文件` : `✗ 未导入音频（当前展示 iTunes 兑底曲目表 ${al.tracks.length} 首）`;
    console.log(`  [${al.id}] ${al.artist} — ${al.title}  →  public/Music/${dirOf(al.title)}/  ${mark}`);
    if (!withFile) console.log(`      把 mp3/flac/m4a 丢进该目录后跑：node scripts/album.mjs --scan`);
  }
}

/** 扫描 public/Music/<专辑>/ 的真实文件 → 曲目表（文件名即曲名，NN 前缀排序，时长尽量回填 iTunes 匹配值） */
async function scanAlbumTracks(al) {
  const dir = join(ROOT, "public", "Music", dirOf(al.title));
  if (!existsSync(dir)) return null;
  const files = (await readdir(dir)).filter((f) => /\.(mp3|flac|m4a)$/i.test(f) && !f.startsWith("."));
  if (!files.length) return null;
  const num = (f) => {
    const m = f.match(/^(\d{1,2})/);
    return m ? +m[1] : 99;
  };
  files.sort((a, b) => num(a) - num(b) || a.localeCompare(b, "zh"));
  return files.map((f, i) => {
    const bare = basename(f, extname(f));
    const title = bare.replace(/^\d{1,2}[\s._-]+/, "").trim() || bare;
    const guess = al.tracks.find((t) => t.title && (title.includes(t.title) || t.title.includes(title)));
    return { n: i + 1, title, ms: guess?.ms || 0, file: `${dirOf(al.title)}/${f}` };
  });
}

/** 对库里所有专辑跑一遍文件挂载（有文件的覆盖曲目表；没文件的保留现状） */
async function applyScan(db) {
  for (const id of [db.featured, db.pinned, ...db.history].filter(Boolean)) {
    const al = db.albums[id];
    if (!al) continue;
    const scanned = await scanAlbumTracks(al);
    if (scanned && JSON.stringify(scanned) !== JSON.stringify(al.tracks)) {
      al.tracks = scanned;
      console.log(`  ✓ [${al.id}] 挂载 ${scanned.length} 个实际音频文件`);
    }
  }
}

if (flags.scan) {
  const db = await loadDb();
  await applyScan(db);
  await saveDb(db);
  printChecklist(db);
  process.exit(0);
}
if (flags.checklist) {
  printChecklist(await loadDb());
  process.exit(0);
}
if (!term) {
  console.error('用法：node scripts/album.mjs "歌手 专辑名" [--pin] ；--scan 重扫音频；--checklist 查看状态');
  process.exit(1);
}

/* ---------------------------------------------------------------- iTunes */

const jget = async (url) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.json();
};

function pickAlbum(results, fullTerm) {
  // 用户输入 "歌手 专辑名"：专辑标题与 artistName 都要参与打分（region 里 artist 常为英文，用宽松包含）
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
    // 排除明显合辑/杂集
    if (name.includes("various") || (r.artistName || "").includes("Various Artists")) score -= 4;
    if (score > bestScore) {
      bestScore = score;
      best = r;
    }
  }
  return bestScore >= 3 ? best : null;
}

console.log(`查询 iTunes：${term}`);
const search = await jget(`https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=album&limit=25`);
const hit = pickAlbum(search.results || [], term);
if (!hit) {
  console.error(`没找到匹配专辑。候选：\n${(search.results || []).slice(0, 8).map((r) => `  ${r.collectionId} ${r.collectionName} — ${r.artistName}`).join("\n")}`);
  process.exit(1);
}
console.log(`  ✓ ${hit.collectionName} — ${hit.artistName}（${(hit.releaseDate || "").slice(0, 10)}，${hit.trackCount} 曲）`);

const songRes = await jget(`https://itunes.apple.com/lookup?id=${hit.collectionId}&entity=song&limit=200`);
const songs = (songRes.results || [])
  .filter((r) => r.kind === "song" && r.collectionId === hit.collectionId)
  .sort((a, b) => (a.discNumber || 1) - (b.discNumber || 1) || (a.trackNumber || 0) - (b.trackNumber || 0));
if (!songs.length) {
  console.error("拿不到曲目列表");
  process.exit(1);
}

/* ---------------------------------------------------------------- 封面 + 取色 */

function slug(title) {
  return title.replace(/\s+/g, "-").replace(/[\\/:*?"<>|]/g, "").trim();
}
function dirOf(title) {
  return title.replace(/[\\/:*?"<>|]/g, "").trim();
}

const id = slug(hit.collectionName);
await mkdir(ALBUMS_DIR, { recursive: true });
const coverSrc = (hit.artworkUrl100 || "").replace("100x100bb", "600x600bb");
const coverBuf = await (await fetch(coverSrc)).arrayBuffer();
const img = sharp(Buffer.from(coverBuf));
const coverFile = `albums/${id}.webp`;
await img.clone().webp({ quality: 80 }).toFile(join(ROOT, "public", coverFile));

// 主色：6×6 降采样里挑"饱和×明度"最高的格子（平均色在暗封面上会发灰）
const { data } = await img.clone().resize(6, 6, { fit: "fill" }).raw().toBuffer({ resolveWithObject: true });
let accent = "#ff7a4d";
let bestPx = -1;
for (let i = 0; i < 36; i++) {
  const r = data[i * 4] / 255;
  const g = data[i * 4 + 1] / 255;
  const b = data[i * 4 + 2] / 255;
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const sat = mx === 0 ? 0 : (mx - mn) / mx;
  const v = sat * mx * (1 - Math.abs(mx - 0.55) * 0.8); // 偏好中高明度的饱和色
  if (v > bestPx) {
    bestPx = v;
    accent = "#" + [r, g, b].map((c) => Math.round(Math.min(1, c * 1.35) * 255).toString(16).padStart(2, "0")).join("");
  }
}
console.log(`  ✓ 封面 → public/${coverFile}，主色 ${accent}`);

/* ---------------------------------------------------------------- 组库 + 轮换 */

const album = {
  id,
  title: hit.collectionName,
  artist: hit.artistName,
  year: (hit.releaseDate || "").slice(0, 4),
  date: (hit.releaseDate || "").slice(0, 10),
  genres: (hit.primaryGenreName ? [hit.primaryGenreName] : []).concat((hit.genres || []).slice(0, 2)).filter((g, i, a) => g && a.indexOf(g) === i && g !== "Music").slice(0, 3),
  cover: coverFile,
  accent,
  intro: "",
  tracks: songs.map((s, i) => ({
    n: i + 1,
    title: s.trackName,
    ms: s.trackTimeMillis || 0,
    file: null, // 兑底曲目表；实际文件由 --scan 挂载后覆盖
  })),
};

const db = await loadDb();
// 手改过的 intro 重新抓取时保留；已有实际文件挂载的曲目表由 applyScan 重新对齐
if (db.albums[id] && db.albums[id].intro) album.intro = db.albums[id].intro;
db.albums[id] = { ...album, intro: album.intro };
await applyScan(db);

if (flags.pin) {
  db.pinned = id;
  console.log(`  ✓ 已设为第三张卡（固定推荐）`);
} else {
  if (db.featured && db.featured !== id) {
    db.history = [db.featured, ...db.history.filter((h) => h !== id && h !== db.featured)].slice(0, 24);
    console.log(`  ✓ 原「${db.albums[db.featured]?.title ?? db.featured}」已归档进历史列表`);
  }
  db.featured = id;
  console.log(`  ✓ 已设为「最近爱听」`);
}
await saveDb(db);
printChecklist(db);
console.log("\n完成。专辑一句话介绍写在 src/data/albums.json 的 intro 字段（重跑脚本会保留）。");
