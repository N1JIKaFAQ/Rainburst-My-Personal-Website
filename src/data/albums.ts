/**
 * 专辑库的只读入口：数据由 scripts/album.mjs 生成/维护（src/data/albums.json），
 * 页面上只消费。intro 字段供手改专辑一句话介绍。
 */
import raw from "./albums.json";

export interface AlbumTrack {
  n: number;
  title: string;
  /** 毫秒；0 = 未知 */
  ms: number;
  /** 网易云歌曲 id（接入后） */
  neteaseId?: number;
  /** 历史遗留（本地挂载已退役）：保留可选以免旧数据报错 */
  file?: string | null;
}

export interface Album {
  id: string;
  title: string;
  artist: string;
  year: string;
  date: string;
  genres: string[];
  /** 相对 public/ 的封面路径（albums/*.webp），或以 http(s) 开头的网易云封面 */
  cover: string;
  /** 封面取色主色，播放页点缀色 */
  accent: string;
  intro: string;
  /** 网易云专辑 id（有则可播） */
  ncmId?: number;
  /** 网易云艺术家 id（专辑组用） */
  artistId?: number;
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
/** 全部专辑（featured → pinned → history 顺序） */
export const allAlbums: Album[] = [db.featured, db.pinned, ...db.history]
  .filter((v): v is string => !!v)
  .map((id) => db.albums[id])
  .filter(Boolean);

export const getAlbum = (id: string | null | undefined): Album | null => (id ? (db.albums[id] ?? null) : null);

/** 封面 URL：本地图加相对前缀并编码；网易云外链原样透传 */
export const coverUrl = (al: Album) =>
  /^https?:\/\//i.test(al.cover) ? al.cover : `./${encodeURI(al.cover)}`;

/** 是否已接入网易云（决定播放页是真实曲目还是 iTunes 兜底灰态） */
export const isLinkedToNcm = (al: Album | null | undefined): boolean => !!al?.ncmId;
