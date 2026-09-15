/** Firefox/Zen（Gecko）渲染引擎判定。
 *  Gecko 对 backdrop-filter 的 SVG url() 滤镜走 CPU 光栅化、Canvas2D 在高 DPR 下也更慢，
 *  站点据此在 Zen/Firefox 上把液态玻璃降级为纯 blur、并收紧 canvas 像素预算。
 *  Zen 的 UA 同样含 "Firefox/"，因此一并覆盖。 */
export const IS_GECKO = typeof navigator !== "undefined" && /firefox\//i.test(navigator.userAgent);
