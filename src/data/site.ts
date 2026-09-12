/**
 * 全站可调参数与恒星数据。
 * 想改名字 / slogan / 导航 / 恒星，都只改这个文件即可。
 */

export const site = {
  name: "雨中虹影",
  nameLatin: "RainBurst",
  eyebrow: "开发 · 摇滚 · 宇宙",
  slogan: "充满褶皱的宇宙里，不只有空大的风",
  hint: "移动鼠标探索宇宙",
  footer: "© 2026 · 第四方向观测站 · 伊卡洛斯站",
  coordinates: "RA 05h 35m · DEC −05° 27′",
};

export type StarKind = "blueGiant" | "redGiant" | "sun" | "neutronStar" | "binary";

export interface StarDef {
  /** 唯一 id */ id: string;
  /** 天体学名，出现在悬停字幕里 */ name: string;
  /** 学名下方的小字 */ nameEn: string;
  /** 这块恒星代表的板块名 */ section: string;
  /** 板块英文 */ sectionEn: string;
  /** 一句话描述，字幕里淡淡的一行 */ tagline: string;
  kind: StarKind;
  /** 主色（光晕 / 粒子 / 过渡色） */ color: string;
  /** 核心色 */ core: string;
  /** 该板块页面的背景色（黑洞吞掉它之后过渡到的颜色） */ pageBg: string;
  /** 基准半径（按 1440px 视口宽度等比缩放） */ radius: number;
  /** 归一化坐标 0..1（相对视口宽高） */ x: number;
  y: number;
  /** 呼吸脉动周期（秒）与幅度 */ pulsePeriod: number;
  pulseAmount: number;
  /** 活跃半径系数：距离 < radius*lure 时开始吸积 */ lure: number;
}

export const stars: StarDef[] = [
  {
    id: "blue-giant",
    name: "蓝巨星",
    nameEn: "BLUE GIANT · 织女一",
    section: "摇滚",
    sectionEn: "ROCK",
    tagline: "来自月背的琴声",
    kind: "blueGiant",
    color: "#8fb6ff",
    core: "#eef4ff",
    pageBg: "#05060c",
    radius: 30,
    x: 0.78,
    y: 0.22,
    pulsePeriod: 5.4,
    pulseAmount: 0.06,
    lure: 7,
  },
  {
    id: "red-giant",
    name: "红巨星",
    nameEn: "RED GIANT · 参宿四",
    section: "影像",
    sectionEn: "VISUALS",
    tagline: "光融在黑色的雨里，这是短暂的彩虹",
    kind: "redGiant",
    color: "#ff7a4d",
    core: "#ffd9b8",
    pageBg: "#0c0503",
    radius: 46,
    x: 0.87,
    y: 0.6,
    pulsePeriod: 7.8,
    pulseAmount: 0.09,
    lure: 6,
  },
  {
    id: "sun",
    name: "黄矮星",
    nameEn: "G-TYPE STAR · 太阳",
    section: "文字",
    sectionEn: "WRITING",
    tagline: "把想象写进诗歌，留文字记录思想",
    kind: "sun",
    color: "#ffce7d",
    core: "#fff6e2",
    pageBg: "#0b0803",
    radius: 22,
    x: 0.5,
    y: 0.82,
    pulsePeriod: 9.2,
    pulseAmount: 0.05,
    lure: 7,
  },
  {
    id: "neutron-star",
    name: "中子星",
    nameEn: "NEUTRON STAR · PULSAR",
    section: "关于",
    sectionEn: "ABOUT",
    tagline: "完全的自主、完全的中心",
    kind: "neutronStar",
    color: "#bfe6ff",
    core: "#ffffff",
    pageBg: "#04070b",
    radius: 9,
    x: 0.275,
    y: 0.155,
    pulsePeriod: 3.1,
    pulseAmount: 0.14,
    lure: 12,
  },
  {
    id: "binary",
    name: "双星系统",
    nameEn: "BINARY SYSTEM · 天秤",
    section: "作品",
    sectionEn: "WORKS",
    tagline: "不是存在引力就能诞生链接",
    kind: "binary",
    color: "#d7c2ff",
    core: "#f4edff",
    pageBg: "#07050d",
    radius: 15,
    x: 0.62,
    y: 0.1,
    pulsePeriod: 6.6,
    pulseAmount: 0.08,
    lure: 9,
  },
];

export const nav = [
  { label: "作品", en: "WORKS", starId: "binary" },
  { label: "摇滚", en: "ROCK", starId: "blue-giant" },
  { label: "影像", en: "VISUALS", starId: "red-giant" },
  { label: "文字", en: "WRITING", starId: "sun" },
  { label: "关于", en: "ABOUT", starId: "neutron-star" },
];

/** 「摇滚」板块终局构图中浮现的卡片（占位内容，直接改这里） */
export const rockCards = [
  { k: "01", t: "正在建造中", d: "这段旋律还没被录制下来，它仍在月背回响。" },
  { k: "02", t: "内容占位", d: "曲目、现场与即兴，会陆续落进这条吸积流。" },
  { k: "03", t: "结构占位", d: "以专辑为单位环绕，保持噪声与秩序的平衡。" },
];
