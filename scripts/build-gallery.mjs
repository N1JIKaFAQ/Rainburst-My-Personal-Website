/**
 * 影像板块素材管线（一次性 / 增量运行，产物入库）：
 *   1. 扫描根目录 影像/ 下原始照片与视频
 *   2. 按地区（文件名前缀）分组，轮转抽选约 N 张（预算内）
 *   3. 每张：读 EXIF → 压缩到长边 1800px WebP q78 → 输出到 public/影像/
 *   4. 2 个 mp4 拷到 public/影像/
 *   5. 生成 src/data/gallery.ts（地点/日期/器材 + 故事占位文案）
 *
 * 运行：node scripts/build-gallery.mjs
 * 重跑会覆盖 public/影像/ 与 gallery.ts（story 占位会被重置；若要保留手改文案见下方"保护手改"）。
 */
import { readFile, writeFile, readdir, mkdir, copyFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, extname, basename, resolve } from "node:path";
import sharp from "sharp";
import exifr from "exifr";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const SRC_DIR = join(ROOT, "影像");
const OUT_DIR = join(ROOT, "public", "影像");
const OUT_TS = join(ROOT, "src", "data", "gallery.ts");

/* ---------- 可调常数（交付给用户的旋钮） ---------- */
const TARGET_COUNT = 30;          // 照片抽选目标张数（不含视频）
const SIZE_BUDGET_MB = 20;        // 照片总体积预算（MB）
const MAX_EDGE = 1800;            // 长边像素
const WEBP_QUALITY = 78;

/* ---------- 地区中文名 → 英文名 ---------- */
const REGION_EN = {
  因斯布鲁克: "Innsbruck",
  多洛米蒂: "Dolomites",
  奥格斯堡: "Augsburg",
  慕尼黑: "Munich",
  柏林: "Berlin",
  米兰: "Milan",
  纽伦堡: "Nuremberg",
  菲森: "Füssen",
};
function regionOf(file) {
  for (const [zh, en] of Object.entries(REGION_EN)) {
    if (file.startsWith(zh)) return { zh, en };
  }
  return { zh: "未知", en: "Unknown" };
}
function numKey(file) {
  const m = basename(file, extname(file)).match(/(\d+)/);
  return m ? parseInt(m[1], 10) : 999;
}

/* ---------- 主流程 ---------- */
async function main() {
  if (!existsSync(SRC_DIR)) {
    console.error("影像/ 目录不存在，请在项目根放置原始照片后再运行。");
    process.exit(1);
  }
  await mkdir(OUT_DIR, { recursive: true });

  const entries = await readdir(SRC_DIR, { withFileTypes: true });
  const photos = entries.filter((e) => e.isFile() && /\.(jpe?g)$/i.test(e.name)).map((e) => e.name);
  const videos = entries.filter((e) => e.isFile() && /\.mp4$/i.test(e.name)).map((e) => e.name);

  /* 按地区分组，组内按数字序号排序 */
  const groups = new Map();
  for (const f of photos) {
    const { zh } = regionOf(f);
    if (!groups.has(zh)) groups.set(zh, []);
    groups.get(zh).push(f);
  }
  for (const arr of groups.values()) arr.sort((a, b) => numKey(a) - numKey(b));

  /* 轮转抽选：每个地区轮流取一张，直到达到目标数或某地区取完 */
  const selected = [];
  const regionNames = [...groups.keys()];
  const idx = new Map(regionNames.map((r) => [r, 0]));
  while (selected.length < TARGET_COUNT) {
    let progressed = false;
    for (const r of regionNames) {
      const arr = groups.get(r);
      const i = idx.get(r);
      if (i < arr.length) {
        selected.push(arr[i]);
        idx.set(r, i + 1);
        progressed = true;
        if (selected.length >= TARGET_COUNT) break;
      }
    }
    if (!progressed) break; // 所有地区取完
  }

  console.log(`原始照片 ${photos.length} 张，视频 ${videos.length} 个`);
  console.log(`抽选 ${selected.length} 张（目标 ${TARGET_COUNT}），地区分布：`);
  const countByRegion = new Map();
  for (const f of selected) {
    const zh = regionOf(f).zh;
    countByRegion.set(zh, (countByRegion.get(zh) || 0) + 1);
  }
  for (const [zh, n] of countByRegion) console.log(`  ${zh}: ${n}`);

  /* ---------- 处理照片 ---------- */
  const items = [];
  let totalKB = 0;
  for (const file of selected) {
    const src = join(SRC_DIR, file);
    const buf = await readFile(src);
    const img = sharp(buf, { failOn: "none" });
    const meta = await img.metadata();
    const exif = (await exifr.parse(buf).catch(() => null)) || {};
    const outName = `${basename(file, extname(file))}.webp`;
    const outPath = join(OUT_DIR, outName);
    const info = await img
      .rotate() // 按 EXIF 方向自动旋转
      .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: "inside", withoutEnlargement: true })
      .webp({ quality: WEBP_QUALITY })
      .toFile(outPath);
    const kb = info.size / 1024;
    totalKB += kb;

    const { zh, en } = regionOf(file);
    items.push({
      id: slug(file),
      place: zh,
      placeEn: en,
      kind: "image",
      file: outName,
      date: exifDate(exif),
      meta: exifMeta(exif, meta),
      story: "", // 占位，用户手改；见下方"保护手改"
      src,
      _dt: exif.DateTimeOriginal instanceof Date ? exif.DateTimeOriginal : null,
    });
    console.log(`  ✓ ${outName}  ${(kb / 1024).toFixed(2)}MB  ${items[items.length - 1].meta}`);
  }

  /* ---------- 处理视频：mp4 直接拷入（若过大仅警告，不重新编码） ---------- */
  for (const file of videos) {
    const src = join(SRC_DIR, file);
    const dst = join(OUT_DIR, file);
    const st = await stat(src);
    const mb = st.size / 1024 / 1024;
    if (mb > 8) console.warn(`  ⚠ ${file} = ${mb.toFixed(1)}MB 偏大，建议后续用 ffmpeg 压到 1080p`);
    await copyFile(src, dst);
    const { zh, en } = regionOf(file);
    items.push({
      id: slug(file),
      place: zh,
      placeEn: en,
      kind: "video",
      file,
      date: "",
      meta: "",
      story: "",
      src,
    });
    console.log(`  ✓ ${file}（视频）${mb.toFixed(1)}MB`);
  }

  /* ---------- 故事占位文案：只用真实日期与时段，不编造事实；用户逐条手改 ---------- */
  for (const it of items) {
    if (it.story) continue;
    if (!it.date) {
      it.story = `摄于${it.place}。`;
      continue;
    }
    const d = it._dt;
    const hour = d ? d.getHours() : -1;
    const period = hour < 0 ? "" : hour < 5 ? "凌晨" : hour < 8 ? "清晨" : hour < 11 ? "上午" : hour < 14 ? "正午" : hour < 17 ? "午后" : hour < 20 ? "黄昏" : "夜晚";
    const [y, m, dd] = it.date.split("-").map(Number);
    it.story = period ? `${y} 年 ${m} 月，${it.place}的${period}。` : `${y} 年 ${m} 月，摄于${it.place}。`;
  }

  /* ---------- 保护手改：读旧 gallery.ts，把用户填过的 story 带回来（GALLERY_FORCE=1 强制重置） ---------- */
  const force = process.env.GALLERY_FORCE === "1";
  const existingStories = new Map();
  if (!force && existsSync(OUT_TS)) {
    try {
      const prev = await readFile(OUT_TS, "utf8");
      const re = /id:\s*"([^"]+)"[\s\S]*?story:\s*"([^"]*)"/g;
      let m;
      while ((m = re.exec(prev))) if (m[2]) existingStories.set(m[1], m[2]);
    } catch {
      /* 旧文件解析失败则忽略 */
    }
  }
  let kept = 0;
  for (const it of items) {
    if (existingStories.has(it.id)) {
      it.story = existingStories.get(it.id);
      kept++;
    }
  }

  /* ---------- 按地区顺序排列（同地区相邻） ---------- */
  const regionOrder = Object.keys(REGION_EN);
  items.sort(
    (a, b) => regionOrder.indexOf(a.place) - regionOrder.indexOf(b.place) || a.file.localeCompare(b.file, "zh")
  );

  /* ---------- 生成 gallery.ts ---------- */
  const lines = [];
  lines.push(`/** 由 scripts/build-gallery.mjs 自动生成；story 字段可手改，重跑会尽量保留已有文案。 */`);
  lines.push(`export interface GalleryItem {`);
  lines.push(`  id: string;`);
  lines.push(`  place: string;   // 拍摄地点（中文，大字展示）`);
  lines.push(`  placeEn: string; // 地点英文（小字）`);
  lines.push(`  kind: "image" | "video";`);
  lines.push(`  file: string;    // 相对 public/影像/ 的文件名`);
  lines.push(`  date: string;    // EXIF 拍摄日期`);
  lines.push(`  meta: string;    // 一行器材/参数`);
  lines.push(`  story: string;   // 照片故事（手改此处）`);
  lines.push(`}`);
  lines.push(`export const galleryItems: GalleryItem[] = [`);
  for (const it of items) {
    lines.push(`  {`);
    lines.push(`    id: ${JSON.stringify(it.id)},`);
    lines.push(`    place: ${JSON.stringify(it.place)},`);
    lines.push(`    placeEn: ${JSON.stringify(it.placeEn)},`);
    lines.push(`    kind: ${JSON.stringify(it.kind)},`);
    lines.push(`    file: ${JSON.stringify(it.file)},`);
    lines.push(`    date: ${JSON.stringify(it.date)},`);
    lines.push(`    meta: ${JSON.stringify(it.meta)},`);
    lines.push(`    story: ${JSON.stringify(it.story)},`);
    lines.push(`  },`);
  }
  lines.push(`];`);
  await writeFile(OUT_TS, lines.join("\n") + "\n", "utf8");

  console.log(`\n照片总体积 ${(totalKB / 1024).toFixed(1)}MB（预算 ${SIZE_BUDGET_MB}MB）`);
  console.log(`保留手改 story ${kept} 条`);
  console.log(`✓ 输出 → public/影像/ + src/data/gallery.ts（${items.length} 项）`);
}

/* ---------- 工具函数 ---------- */
function slug(file) {
  return basename(file, extname(file))
    .replace(/\s+/g, "-")
    .replace(/[^\w\-.一-龥]+/g, "")
    .toLowerCase();
}
function exifDate(exif) {
  const d = exif.DateTimeOriginal || exif.CreateDate || exif.ModifyDate;
  if (!(d instanceof Date) || isNaN(d.getTime())) return "";
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function exifMeta(exif, meta) {
  const parts = [];
  let model = (exif.Model || "").trim();
  if (!model && exif.CreatorTool) model = String(exif.CreatorTool).replace(/\s*Ver\..*$/i, "").trim();
  if (model) parts.push(model);
  const lens = (exif.LensModel || exif.Lens || "").trim();
  if (lens && !model.includes(lens)) parts.push(lens);
  const fn = exif.FNumber ? `f/${exif.FNumber}` : "";
  const exp = exif.ExposureTime
    ? exif.ExposureTime >= 1
      ? `${Math.round(exif.ExposureTime * 10) / 10}s`
      : `1/${Math.round(1 / exif.ExposureTime)}s`
    : "";
  const iso = exif.ISO ? `ISO${exif.ISO}` : "";
  const mm = exif.FocalLength ? `${Math.round(exif.FocalLength)}mm` : "";
  const params = [fn, mm, exp, iso].filter(Boolean).join(" ");
  if (params) parts.push(params);
  if (meta.width && meta.height) parts.push(`${meta.width}×${meta.height}`);
  return parts.join(" · ");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
