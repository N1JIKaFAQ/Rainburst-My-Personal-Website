import { useCallback, useRef, useState } from "react";
import CosmosView from "./components/CosmosView";
import SectionPage from "./components/SectionPage";
import BlueGiantPage from "./components/BlueGiantPage";
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
  }, []);

  /** 板块页 → 宇宙：反向吞噬（色膜从中心被撑开，点阵涟漪回来） */
  const backToCosmos = useCallback(() => {
    setEnter({ mode: "return", color: section?.pageBg ?? "#05060c" });
    setView("cosmos");
    setEpoch((e) => e + 1);
  }, [section]);

  const noop = useCallback((_info: CaptureInfo | null) => {}, []);

  if (view === "section" && section) {
    /** 蓝巨星走黑洞电影页，其余板块保持通用页 */
    if (section.id === "blue-giant") {
      return <BlueGiantPage star={section} onBack={backToCosmos} />;
    }
    return <SectionPage star={section} onBack={backToCosmos} />;
  }

  return (
    <CosmosView
      key={epoch}
      engineRef={engineRef}
      enterMode={enter.mode}
      enterColor={enter.color}
      onCapture={noop}
      onSwallowStart={() => {}}
      onSwallowDone={swallowDone}
    />
  );
}
