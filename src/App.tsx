import { useCallback, useRef, useState } from "react";
import CosmosView from "./components/CosmosView";
import SectionPage from "./components/SectionPage";
import BlueGiantPage from "./components/BlueGiantPage";
import MusicCapsule from "./components/MusicCapsule";
import { music } from "./audio/music";
import type { Cosmos, CaptureInfo } from "./universe/engine";
import type { StarDef } from "./data/site";

type Enter = { mode: "intro" | "return"; color: string };

export default function App() {
  const engineRef = useRef<Cosmos | null>(null);
  const [view, setView] = useState<"cosmos" | "section">("cosmos");
  const [enter, setEnter] = useState<Enter>({ mode: "intro", color: "#05060c" });
  const [section, setSection] = useState<StarDef | null>(null);
  /** 每次回到宇宙都重建一次引擎，保证入场动画从干净状态开始 */
  const [epoch, setEpoch] = useState(0);

  const swallowDone = useCallback((def: StarDef) => {
    setSection(def);
    setView("section");
    /** 进入「摇滚」板块 → 切换板块专属曲；其余板块保持 ambient */
    music.switchMode(def.id === "blue-giant" ? "dedicated" : "ambient");
  }, []);

  /** 板块页 → 宇宙：反向吞噬（色膜从中心被撑开，点阵涟漪回来） */
  const backToCosmos = useCallback(() => {
    music.switchMode("ambient");
    setEnter({ mode: "return", color: section?.pageBg ?? "#05060c" });
    setView("cosmos");
    setEpoch((e) => e + 1);
  }, [section]);

  const noop = useCallback((_info: CaptureInfo | null) => {}, []);

  const onBlueGiant = view === "section" && section?.id === "blue-giant";

  return (
    <>
      {view === "section" && section ? (
        /** 蓝巨星走黑洞电影页，其余板块保持通用页 */
        onBlueGiant ? (
          <BlueGiantPage star={section} onBack={backToCosmos} />
        ) : (
          <SectionPage star={section} onBack={backToCosmos} />
        )
      ) : (
        <CosmosView
          key={epoch}
          engineRef={engineRef}
          enterMode={enter.mode}
          enterColor={enter.color}
          onCapture={noop}
          onSwallowStart={() => {}}
          onSwallowDone={swallowDone}
        />
      )}
      {/* 胶囊常驻；蓝巨星页底部有卡片行，挪到顶部居中 */}
      <MusicCapsule position={onBlueGiant ? "top" : "bottom"} />
    </>
  );
}
