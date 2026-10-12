/** LRC 歌词解析 + 头部 credits（作词/作曲/编曲常混在歌词前几行）抽取 */

export interface LrcLine {
  t: number; // 秒
  text: string;
}

const TIME_TAG = /\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g;

export function parseLrc(raw: string): { lines: LrcLine[]; credits: Record<string, string> } {
  const lines: LrcLine[] = [];
  const credits: Record<string, string> = {};
  if (!raw) return { lines, credits };
  for (const rowRaw of raw.split(/\r?\n/)) {
    const row = rowRaw.trim();
    if (!row) continue;
    const text = row.replace(TIME_TAG, "").trim();
    // 元信息行：[ar:] [ti:] [al:] [by:] [length:] 与裸 "作词 : 梁博"
    const meta = /^(作词|作曲|编曲|制作人|吉他|贝斯|鼓|钢琴|弦乐|和声|录音|混音|母带|Lyricist|Composer|Arranger)\s*[:：]\s*(.+)$/i.exec(text);
    if (meta) {
      const key = meta[1].trim();
      const val = meta[2].trim();
      if (!credits[key]) credits[key] = val;
    }
    TIME_TAG.lastIndex = 0;
    const times = [...row.matchAll(TIME_TAG)].map((m) => {
      const s = +m[1] * 60 + +m[2] + (m[3] ? +("0." + m[3]) : 0);
      return s;
    });
    if (!times.length) continue;
    for (const t of times) lines.push({ t, text });
  }
  lines.sort((a, b) => a.t - b.t);
  return { lines, credits };
}

/** 当前播放时间对应的歌词行下标（最后一行 <= t；t 在第一行前返回 -1） */
export function lyricIndexAt(lines: LrcLine[], t: number): number {
  let idx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].t <= t + 0.15) idx = i;
    else break;
  }
  return idx;
}
