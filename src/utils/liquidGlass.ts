/**
 * 液态玻璃：圆角矩形 SDF 位移贴图 + SVG feDisplacementMap 滤镜。
 * 从 https://github.com/shuding/liquid-glass 核心算法移植（MIT License）。
 */

export interface LiquidGlassOptions {
  /** 元素宽度 px */ width: number;
  /** 元素高度 px */ height: number;
  /** 圆角半径 px */ radius: number;
  /** 折射强度 0~1（0.5 为自然） */ intensity?: number;
  /** 唯一 ID，用于 filter url(#id) */ id: string;
}

/**
 * 圆角矩形 SDF（signed distance field）
 * 负数在内部，正数在外部，0 在边缘。
 */
function roundedRectSDF(x: number, y: number, halfW: number, halfH: number, radius: number): number {
  const qx = Math.abs(x) - halfW + radius;
  const qy = Math.abs(y) - halfH + radius;
  return Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - radius;
}

/** smoothstep 反向：t∈[edgeMax,0] 映射到 0~1（越近边缘=1） */
function smoothStep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * 创建位移贴图 canvas + SVG filter，返回 filterId 字符串（用于 backdrop-filter: url(#xxx)）。
 * 每次调用都会替换 DOM 中的旧 filter（用于 resize 后重新生成）。
 */
export function createLiquidGlassFilter(opts: LiquidGlassOptions): string {
  const { width, height, radius, intensity = 0.5 } = opts;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.round(width * dpr);
  const h = Math.round(height * dpr);

  // ---- 位移贴图 ----
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context");
  const img = ctx.createImageData(w, h);
  const data = img.data;

  let maxScale = 0.0001;
  const rawX = new Float32Array(w * h);
  const rawY = new Float32Array(w * h);

  // 中心：UV 坐标 [-0.5, 0.5]，roundedRectSDF 参数（半宽/半高/圆角）
  const halfW = 0.5;
  const halfH = 0.5;
  const rNorm = (radius / Math.min(width, height)) * 0.5; // 归一化圆角

  for (let y = 0; y < h; y++) {
    const iy = y / h - 0.5;
    for (let x = 0; x < w; x++) {
      const ix = x / w - 0.5;
      const idx = y * w + x;

      const sdf = roundedRectSDF(ix, iy, halfW, halfH, rNorm);
      // 边缘附近 intensity 大，中心=0；edge 阈值 0.15（shuding 默认）
      const edge = 0.15;
      const strength = smoothStep(0.8, 0, sdf - edge);
      const scaled = intensity * strength;

      // 从中心指向该像素的向量 * scaled（位移幅度）
      const dx = ix * scaled;
      const dy = iy * scaled;
      rawX[idx] = dx;
      rawY[idx] = dy;
      maxScale = Math.max(maxScale, Math.abs(dx), Math.abs(dy));
    }
  }
  maxScale *= 0.5;

  let i = 0;
  for (let idx = 0; idx < w * h; idx++) {
    const r = rawX[idx] / maxScale + 0.5;
    const g = rawY[idx] / maxScale + 0.5;
    data[i++] = Math.max(0, Math.min(255, r * 255));
    data[i++] = Math.max(0, Math.min(255, g * 255));
    data[i++] = 0;
    data[i++] = 255;
  }
  ctx.putImageData(img, 0, 0);

  const mapDataURL = canvas.toDataURL();

  // ---- SVG filter ----
  const filterId = `${opts.id}_filter`;
  const mapId = `${opts.id}_map`;
  let svg = document.getElementById(opts.id) as SVGSVGElement | null;
  if (!svg) {
    svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("id", opts.id);
    svg.style.display = "none";
    document.body.appendChild(svg);
  }
  svg.setAttribute("width", String(w));
  svg.setAttribute("height", String(h));

  const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
  const filter = document.createElementNS("http://www.w3.org/2000/svg", "filter");
  filter.setAttribute("id", filterId);
  filter.setAttribute("filterUnits", "userSpaceOnUse");
  filter.setAttribute("color-interpolation-filters", "sRGB");
  filter.setAttribute("x", "0");
  filter.setAttribute("y", "0");
  filter.setAttribute("width", String(w));
  filter.setAttribute("height", String(h));

  const feImage = document.createElementNS("http://www.w3.org/2000/svg", "feImage");
  feImage.setAttribute("id", mapId);
  feImage.setAttribute("width", String(w));
  feImage.setAttribute("height", String(h));
  feImage.setAttributeNS("http://www.w3.org/1999/xlink", "xlink:href", mapDataURL);
  feImage.setAttribute("href", mapDataURL);

  const feDisp = document.createElementNS("http://www.w3.org/2000/svg", "feDisplacementMap");
  feDisp.setAttribute("in", "SourceGraphic");
  feDisp.setAttribute("in2", mapId);
  feDisp.setAttribute("xChannelSelector", "R");
  feDisp.setAttribute("yChannelSelector", "G");
  feDisp.setAttribute("scale", String(maxScale / dpr));

  filter.appendChild(feImage);
  filter.appendChild(feDisp);
  defs.appendChild(filter);
  svg.innerHTML = "";
  svg.appendChild(defs);

  return filterId;
}
