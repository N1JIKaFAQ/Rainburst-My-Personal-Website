/**
 * 专辑库的只读入口：数据由 scripts/album.mjs 生成/维护（src/data/albums.json），
 * 页面上只消费。intro 字段供手改专辑一句话介绍。
 */
import raw from "./albums.json";

export interface AlbumTrack {
  n: number;
  title: string;
  /** 毫秒；0 = 未知（等 audio metadata 回填） */
  ms: number;
  /** 相对 public/Music/ 的文件路径；null = 媒体未导入（灰色兑底） */
  file: string | null;
}

export interface Album {
  id: string;
  title: string;
  artist: string;
  year: string;
  date: string;
  genres: string[];
  /** 相对 public/ 的封面路径（albums/*.webp） */
  cover: string;
  /** 封面取色主色，播放器点缀色 */
  accent: string;
  intro: string;
  tracks: AlbumTrack[];
}

interface AlbumsDb {
  featured: string | null;
  history: string[];
  pinned: string | null;
  albums: Record<string, Album>;
}

const db = raw as AlbumsDb;

export const featuredAlbum: Album | null = db.featured ? (db.albums[db.featured] ?? null) : null;
export const pinnedAlbum: Album | null = db.pinned ? (db.albums[db.pinned] ?? null) : null;
export const historyAlbums: Album[] = db.history.map((id) => db.albums[id]).filter(Boolean);
/** 全部专辑（侧栏"专辑即歌单"列表用），featured → pinned → history 顺序 */
export const allAlbums: Album[] = [db.featured, db.pinned, ...db.history]
  .filter((v): v is string => !!v)
  .map((id) => db.albums[id])
  .filter(Boolean);

export const getAlbum = (id: string | null | undefined): Album | null => (id ? (db.albums[id] ?? null) : null);

export const totalAlbumCount = allAlbums.length;
export const playableTrackCount = allAlbums.reduce((s, a) => s + a.tracks.filter((t) => t.file).length, 0);

/* ---------------- 运行时 URL ---------------- */

export const coverUrl = (al: Album) => `./${encodeURI(al.cover)}`;
export const audioUrl = (file: string) => `./Music/${encodeURI(file)}`;

/** 专辑 → music.ts 的 Track 队列（只包含有文件的曲目） */
export interface QueueTrack {
  title: string;
  titleEn: string;
  artist: string;
  file: string;
}
export function playableQueue(al: Album): QueueTrack[] {
  return al.tracks
    .filter((t): t is AlbumTrack & { file: string } => !!t.file)
    .map((t) => ({ title: t.title, titleEn: "", artist: al.artist, file: t.file }));
}
