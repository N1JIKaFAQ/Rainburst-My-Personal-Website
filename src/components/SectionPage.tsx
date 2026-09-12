import { site, type StarDef } from "../data/site";

interface Props {
  star: StarDef;
  onBack: () => void;
}

const placeholders = [
  { k: "01", t: "正在建造中", d: "这一颗恒星下面藏着的东西还没被观测清楚。" },
  { k: "02", t: "内容占位", d: "作品、文章、音频、影像都会由黑洞吐回到这个页面。" },
  { k: "03", t: "结构占位", d: "网格会沿用主界面的点阵语言，保持克制与呼吸感。" },
];

export default function SectionPage({ star, onBack }: Props) {
  return (
    <div
      className="fixed inset-0 overflow-hidden"
      style={{ background: star.pageBg }}
      key={star.id}
    >
      {/* 该板块自己的光 */}
      <div
        className="anim-fade-in pointer-events-none absolute -left-[20vw] -top-[30vh] h-[90vh] w-[90vh] rounded-full opacity-40 blur-[10px]"
        style={{
          background: `radial-gradient(circle, ${star.color}22 0%, transparent 65%)`,
        }}
      />
      <div
        className="anim-fade-in pointer-events-none absolute -bottom-[30vh] -right-[15vw] h-[80vh] w-[80vh] rounded-full opacity-30"
        style={{
          background: `radial-gradient(circle, ${star.color}18 0%, transparent 70%)`,
        }}
      />
      {/* 点阵余韵 */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.14]"
        style={{
          backgroundImage: `radial-gradient(${star.color}55 1px, transparent 1px)`,
          backgroundSize: "26px 26px",
        }}
      />

      <div className="relative flex h-full flex-col px-[7vw] py-7 sm:py-9">
        <header className="anim-fade-in flex items-center justify-between">
          <span className="text-[11px] font-light uppercase tracking-[0.4em] text-white/45">
            {site.nameLatin}
          </span>
          <button
            onClick={onBack}
            className="group flex items-center gap-3 text-[11px] font-light uppercase tracking-[0.3em] text-white/45 transition-colors duration-300 hover:text-white"
          >
            <span className="inline-block h-[5px] w-[5px] rounded-full bg-white/50 transition-transform duration-500 group-hover:scale-150" />
            返回宇宙
          </button>
        </header>

        <main className="flex flex-1 flex-col justify-center py-10">
          <p
            className="anim-fade-up delay-1 text-[11px] font-light uppercase tracking-[0.44em]"
            style={{ color: star.color }}
          >
            {star.sectionEn} · {star.nameEn}
          </p>
          <h1 className="anim-fade-up delay-2 mt-6 text-[16vw] font-thin leading-[0.9] tracking-[-0.04em] text-white/95 sm:text-[9vw] lg:text-[7vw]">
            {star.section}
          </h1>
          <p className="anim-fade-up delay-3 mt-6 max-w-[26rem] text-sm font-light leading-relaxed text-white/50 sm:text-base">
            {star.tagline}。这颗 {star.name} 已经落进视界，从这里开始是这个板块。
          </p>

          <div className="anim-fade-up delay-4 mt-12 grid gap-px overflow-hidden rounded-2xl border border-white/10 sm:grid-cols-3">
            {placeholders.map((p) => (
              <div
                key={p.k}
                className="bg-white/[0.02] p-6 transition-colors duration-500 hover:bg-white/[0.05]"
              >
                <span className="text-[10px] font-light tracking-[0.3em] text-white/30">
                  {p.k}
                </span>
                <h3 className="mt-3 text-base font-light tracking-wide text-white/85">{p.t}</h3>
                <p className="mt-2 text-[12px] font-light leading-relaxed text-white/40">{p.d}</p>
                <span
                  className="mt-5 block h-px w-10 opacity-70"
                  style={{ background: star.color }}
                />
              </div>
            ))}
          </div>
        </main>

        <footer className="anim-fade-in delay-5 flex flex-wrap items-center justify-between gap-3 text-[10px] font-light uppercase tracking-[0.28em] text-white/25">
          <span>{site.footer}</span>
          <span>视界之内 · 无需返回信号</span>
        </footer>
      </div>
    </div>
  );
}
