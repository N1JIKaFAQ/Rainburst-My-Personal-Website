/**
 * BlackholeScene —— 原生 WebGL2 史瓦西黑洞 + 蓝巨星 + 潮汐吸积流实时光线步进
 *
 * 构图对照参考图：
 *  · 蓝巨星是庞然大物：半径 170 单位，星心远在左侧，只看得到球面的一小片、边缘弧度很小；
 *    表面是云絮状过曝的蓝白湍流，域扭曲让云团翻涌而不是平移；临边有日冕流光与针状体。
 *  · 黑洞在画面右侧 ~64%，吸积盘倾斜 ~20°（相机滚转），细长的流光从恒星方向穿过黑洞伸向右下。
 *  · 黑洞阴影不是平面纯黑：极细极亮的光子环贴着阴影边缘（来自被透镜化的盘面光），内部有体积感的深色渐变。
 *  · 潮汐流：从星面最近点扬起、切向汇入吸积盘的一条贝塞尔发光管，纤维纹理沿流向奔涌，强度随滚动飙升。
 *  · 滚动推进：相机拉近、盘面刚性旋转 ×8、三个轨道热斑以真实开普勒速度绕行、径向涌入加速、盘面微进动。
 *
 * 抗锯齿 / 抗摩尔纹（全部在着色器内完成，不依赖 MSAA）：
 *  · 纹理带限：所有盘面 / 星面噪声的频率都按世界单位设计，并按"像素足迹 ÷ 波长"在奈奎斯特附近淡回均值。
 *    足迹 = 路程 × 像素张角 ÷ 掠射余弦 × 透镜放大；放大因子由撞击参数到临界值 2.598 的距离估计，
 *    因此黑洞上方被强透镜的拱弧和光子环处的纹理会自动变柔。
 *  · 星缘覆盖：巨星轮廓用解析的亚像素覆盖率混合，而不是一像素硬阶跃。
 *  · 分层超采样：只在黑洞附近做——临界撞击参数 ±0.24 内 8 spp、h0 < 3.7 内 4 spp、其余 1 spp。
 *  · 视界附近步长更细更平滑（dt = 0.06·r，下限 0.05），阴影边界与光子环不再随步进相位抖动。
 *
 * 数值稳健性：所有噪声使用整数哈希；旋转/涌入相位由 JS 用 dt 积分并 wrap 到 2π 后作为 uniform 传入。
 */

export interface BlackholeCallbacks {
  onProgress?: (progress: number) => void;
}

const TAU = Math.PI * 2;
/** 三个轨道热斑的半径（与着色器内 kr 一致），用于 JS 侧按开普勒角速度积分相位 */
const KNOT_RADII = [2.85, 3.6, 4.9];

const VERT_SHADER = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = a_pos;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

const FRAG_SHADER = `#version 300 es
precision highp float;
precision highp int;

in vec2 v_uv;
out vec4 fragColor;

uniform vec2  u_resolution;
uniform float u_time;
uniform float u_progress;
uniform vec2  u_mouse;
uniform float u_spin;     // 盘面刚性旋转相位（JS 积分，wrap 2π）
uniform float u_flow;     // 径向涌入纹理位移（JS 积分）
uniform vec3  u_knots;    // 三个轨道热斑的开普勒相位（JS 积分，wrap 2π）
uniform float u_stream;   // 潮汐流沿流向的纹理位移（JS 积分）

const float Rs     = 1.0;      // 史瓦西半径
const float R_IN   = 2.3;      // 吸积盘内缘
const float R_OUT  = 11.0;     // 吸积盘外缘（朝恒星一侧伸出窄舌）
const float H_CRIT = 2.598;    // 临界撞击参数 3√3/2·Rs：小于它的光线全部落入视界

// 蓝巨星：半径 170，星心远在左后方；星面最近点 S0 距黑洞 ~20 单位
const vec3  STAR_C   = vec3(-189.13, 10.67, 14.33);
const float STAR_R   = 170.0;
const vec3  STAR_DIR = vec3(0.99554, -0.05616, -0.07540);  // 星心 → 黑洞
const float STAR_PHI = 3.0660;                              // 恒星在盘面坐标中的方位角
// 潮汐流：星面最近点 S0 → 扬起的控制点 SM → 切向汇入盘面 S1
const vec3  S0 = vec3(-19.89, 1.12, 1.51);
const vec3  SM = vec3(-16.80, 2.20, 3.10);
const vec3  S1 = vec3(-13.76, 0.00, 1.04);

// 亚像素采样图案（D3D 标准 4x / 8x，单位：像素）
const vec2 OFF4[4] = vec2[4](
  vec2(-0.125, -0.375), vec2(0.375, -0.125), vec2(-0.375, 0.125), vec2(0.125, 0.375));
const vec2 OFF8[8] = vec2[8](
  vec2(0.0625, -0.1875), vec2(-0.0625, 0.1875), vec2(0.3125, 0.0625), vec2(-0.1875, -0.3125),
  vec2(-0.3125, 0.3125), vec2(-0.4375, -0.0625), vec2(0.1875, 0.4375), vec2(0.4375, -0.4375));

/* ---------------- 整数哈希与噪声 ---------------- */
uint uhash(uint n) {
  n ^= n >> 16u; n *= 0x7feb352du;
  n ^= n >> 15u; n *= 0x846ca68bu;
  n ^= n >> 16u;
  return n;
}
float hash2i(ivec2 p) {
  uint h = uhash((uint(p.x) * 0x9E3779B1u) ^ uhash(uint(p.y) + 0x68E31DA4u));
  return float(h) * (1.0 / 4294967296.0);
}
float hash3i(ivec3 p) {
  uint h = uhash((uint(p.x) * 0x9E3779B1u) ^ uhash((uint(p.y) * 0x85EBCA77u) ^ uhash(uint(p.z) + 0x68E31DA4u)));
  return float(h) * (1.0 / 4294967296.0);
}
float noise2D(vec2 p) {
  vec2 i = floor(p);
  vec2 f = p - i;
  vec2 u = f * f * (3.0 - 2.0 * f);
  ivec2 c = ivec2(i);
  return mix(mix(hash2i(c), hash2i(c + ivec2(1, 0)), u.x),
             mix(hash2i(c + ivec2(0, 1)), hash2i(c + ivec2(1, 1)), u.x), u.y);
}
float noise3D(vec3 p) {
  vec3 i = floor(p);
  vec3 f = p - i;
  vec3 u = f * f * (3.0 - 2.0 * f);
  ivec3 c = ivec3(i);
  float n000 = hash3i(c);
  float n100 = hash3i(c + ivec3(1, 0, 0));
  float n010 = hash3i(c + ivec3(0, 1, 0));
  float n110 = hash3i(c + ivec3(1, 1, 0));
  float n001 = hash3i(c + ivec3(0, 0, 1));
  float n101 = hash3i(c + ivec3(1, 0, 1));
  float n011 = hash3i(c + ivec3(0, 1, 1));
  float n111 = hash3i(c + ivec3(1, 1, 1));
  float nx00 = mix(n000, n100, u.x);
  float nx10 = mix(n010, n110, u.x);
  float nx01 = mix(n001, n101, u.x);
  float nx11 = mix(n011, n111, u.x);
  return mix(mix(nx00, nx10, u.y), mix(nx01, nx11, u.y), u.z);
}
float fbm2D(vec2 p) {
  float v = 0.0;
  float a = 0.55;
  mat2 rot = mat2(0.8, -0.6, 0.6, 0.8);
  for (int i = 0; i < 4; i++) {
    v += a * noise2D(p);
    p = rot * p * 2.05;
    a *= 0.5;
  }
  return v;
}
// 带限：x = 像素足迹（单位：噪声 cell）。值噪声的基波周期约 2 cell，
// 宽为 x 的盒滤波对它的衰减 ≈ sinc(x/2)：x=1 时剩 64%，x≈1.8 时归零。
// 用 smoothstep(0.5, 1.7) 近似这条曲线：既不摩尔纹，也不会比真实超采样更糊。
float lodFade(float x) {
  return 1.0 - smoothstep(0.5, 1.7, x);
}
float fbm3Dlod(vec3 p, float x) {
  float v = 0.0;
  float a = 0.55;
  for (int i = 0; i < 3; i++) {
    float f = lodFade(x);
    v += a * (f > 0.002 ? mix(0.5, noise3D(p), f) : 0.5);
    p = p * 2.03 + vec3(11.3, 7.1, 3.9);
    a *= 0.5;
    x *= 2.03;
  }
  return v;
}
float fbm3D(vec3 p) {
  return fbm3Dlod(p, 0.0);
}

/* ---------------- 背景 ---------------- */
vec3 sampleStars(vec3 dir) {
  vec3 c = vec3(0.006, 0.009, 0.018);
  float neb = fbm2D(dir.xy * 2.4 + dir.z * 1.2);
  c += vec3(0.02, 0.035, 0.07) * neb * neb;
  vec3 g = dir * 280.0;
  ivec3 cell = ivec3(floor(g));
  float h = hash3i(cell);
  if (h > 0.986) {
    // 圆点星而不是方块：在格子内随机落点 + 高斯衰减
    vec3 jit = 0.35 + 0.3 * vec3(hash3i(cell + ivec3(17, 0, 0)), hash3i(cell + ivec3(0, 29, 0)), hash3i(cell + ivec3(0, 0, 43)));
    vec3 d = g - (vec3(cell) + jit);
    float spot = exp(-dot(d, d) * 12.0);
    float b = pow((h - 0.986) / 0.014, 6.0) * 2.4;
    c += mix(vec3(0.7, 0.85, 1.0), vec3(1.0, 0.94, 0.85), fract(h * 37.0)) * b * spot;
  }
  return c;
}

/* ---------------- 蓝巨星 ---------------- */
// 云絮状、过曝的蓝白湍流表面；域扭曲让云团翻涌，靠近黑洞的一片被潮汐拉出丝状条纹。
// fp = 像素在星面上的足迹（世界单位），用于纹理带限。
vec3 shadeStar(vec3 hit, vec3 nGeo, float mu, float p, float fp) {
  float t = u_time;
  // 整颗星缓慢自转（只旋转纹理坐标；几何法线 nGeo 用于临边）
  float ra = t * 0.006;
  vec3 n = vec3(nGeo.x * cos(ra) - nGeo.z * sin(ra), nGeo.y, nGeo.x * sin(ra) + nGeo.z * cos(ra));
  float wa = noise3D(n * 5.0 + vec3(t * 0.08, 0.0, 0.0));
  float wb = noise3D(n * 5.0 + vec3(0.0, t * 0.07, 7.7));
  vec3 w = vec3(wa, wb, wa * wb) * 0.55;
  // n 空间频率 f 对应星面波长 STAR_R/f
  float c1 = fbm3Dlod(n * 9.3 + w + vec3(t * 0.02), fp * (9.3 / STAR_R));
  float c2 = fbm3Dlod(n * 25.0 + w * 1.6 - vec3(0.0, t * 0.05, 0.0), fp * (25.0 / STAR_R));
  float c3 = mix(0.5, noise3D(n * 62.0 + vec3(t * 0.35)), lodFade(fp * (62.0 / STAR_R)));
  float cloud = smoothstep(0.30, 0.72, c1 * 0.55 + c2 * 0.32 + c3 * 0.13);

  // 被撕扯的那片星面：云层被剥走（更蓝），露出朝黑洞方向的拉丝
  vec3 rel = hit - S0;
  float pull = exp(-dot(rel, rel) / 110.0) * (0.55 + 0.45 * p);
  cloud *= 1.0 - 0.55 * pull;
  float streak = mix(0.5, noise3D(vec3(rel.x * 0.55 - u_stream * 0.45, rel.y * 1.8, rel.z * 1.8)), lodFade(fp * 1.8));
  float pulse = 0.86 + 0.28 * mix(0.5, noise3D(n * 14.0 + vec3(0.0, 0.0, t * 0.3)), lodFade(fp * (14.0 / STAR_R)));

  vec3 col = mix(vec3(0.30, 0.58, 1.0), vec3(1.0), cloud) * (1.7 + 0.7 * cloud) * pulse;
  col *= 1.0 + pull * (0.15 + 0.7 * smoothstep(0.42, 0.8, streak));
  // 临边：柔和晕成蓝白光，而不是一道台阶
  col = mix(col, vec3(0.60, 0.80, 1.0) * 1.2, pow(1.0 - mu, 1.5) * 0.8);
  return col * (1.0 + 0.10 * p);
}

// 未击中星体的光线：宽气辉 + 日冕流光 + 临边针状体（朝黑洞一侧被潮汐拉长）
vec3 starAtmosphere(vec3 ro, vec3 rd, float p, float pixA) {
  vec3 oc = ro - STAR_C;
  float b = dot(oc, rd);
  vec3 cp = oc - b * rd;
  float dmin = (b > 0.0) ? length(oc) : length(cp);
  float gap = max(0.0, dmin - STAR_R);
  float h = 0.8 * exp(-gap / 7.0) + 0.35 * exp(-gap / 28.0);
  vec3 col = vec3(0.55, 0.75, 1.0) * h * 0.95;
  if (b < 0.0 && gap < 60.0) {
    vec3 nl = cp / max(dmin, 1e-3);
    float toward = max(0.0, dot(nl, STAR_DIR));
    // 日冕流光：慢速演化的尖刺状射线，朝黑洞一侧被潮汐拉长
    float s1 = fbm3Dlod(nl * 11.0 + vec3(u_time * 0.02, 0.0, 0.0), pixA * 11.0);
    float spiky = pow(s1, 2.6);
    float L1 = 9.0 + 24.0 * toward * toward;
    col += vec3(0.55, 0.78, 1.0) * spiky * exp(-gap / L1) * (0.9 + 0.6 * toward * p);
    // 针状体 / 日珥：贴着临边的短刺，快速闪动
    float s2 = mix(0.5, noise3D(nl * 30.0 + vec3(0.0, u_time * 0.25, 0.0)), lodFade(pixA * 30.0));
    col += vec3(0.82, 0.92, 1.0) * pow(s2, 3.0) * exp(-gap / 5.0) * 1.2;
  }
  return col;
}

/* ---------------- 潮汐流：贝塞尔发光管，沿逃逸直线解析采样 ---------------- */
vec3 bez(float t) {
  float u = 1.0 - t;
  return u * u * S0 + 2.0 * u * t * SM + t * t * S1;
}
vec3 streamGlow(vec3 ro, vec3 rd, float inflow) {
  vec3 acc = vec3(0.0);
  for (int i = 0; i < 6; i++) {
    float t = (float(i) + 0.5) / 6.0;
    vec3 P = bez(t);
    float s = dot(P - ro, rd);
    if (s <= 0.0) continue;
    vec3 Q = ro + rd * s;
    vec3 dq = Q - P;
    float d2 = dot(dq, dq);
    float rad = mix(2.8, 0.9, t);
    float core = exp(-d2 / (rad * rad));
    float halo = exp(-d2 / (rad * rad * 6.0)) * 0.22;
    if (core + halo < 0.003) continue;
    float n = noise3D(vec3(Q.x * 0.9 - u_stream, Q.y * 2.6, Q.z * 2.6));
    float fib = smoothstep(0.30, 0.74, n);
    float dens = (core * (0.2 + 0.8 * fib) + halo) * (0.3 + 0.7 * inflow);
    vec3 c = mix(vec3(0.60, 0.82, 1.0), vec3(0.96, 0.98, 1.0), t * 0.45 + fib * 0.45);
    acc += c * dens;
  }
  return acc * 0.55;
}

/* ---------------- 吸积盘（盘面坐标系：y=0 平面） ----------------
 * fp = 像素在盘面上的足迹（世界单位，已含掠射拉伸与透镜放大）。
 * 所有纹理频率按世界单位设计：径向 cell 数/单位 = (A·k + B)/ρ（圆周嵌入半径 A、螺旋系数 k、log 径向系数 B）
 */
vec4 diskShade(vec3 hp, vec3 velD, float p, float diskGain, float inflow, float fp) {
  float rho = length(hp.xz);
  float phi = atan(hp.z, hp.x);
  float starSide = 0.5 + 0.5 * cos(phi - STAR_PHI);    // 1 = 正对恒星
  float tongue = starSide * starSide;
  tongue *= tongue;
  float rOut = R_OUT * (1.0 + 0.42 * tongue);
  if (rho < R_IN) return vec4(0.0);
  if (rho > rOut) {
    // 盘外很淡很宽的散射光带（参考图右侧那条柔和的亮带）
    float halo = 0.06 * (1.0 - smoothstep(rOut, rOut + 12.0, rho)) * (0.6 + 0.4 * p);
    return vec4(vec3(0.30, 0.50, 0.95) * halo * diskGain, halo * 0.5);
  }

  float invR = 1.0 / rho;
  float lr = log(rho);
  float rp = phi + u_spin;                    // 刚性旋转（物质沿 -φ 运动）

  // 湍流：径向基波长 0.8，三层八度各自带限
  float turb = fbm3Dlod(vec3(cos(rp) * 2.4, sin(rp) * 2.4, rho * 1.25 - u_flow * 0.45), fp * 1.25);
  // 纤维：沿螺旋拉长的细流。径向 cell 率 = |(1.6·1.2, 4.0)|/ρ = 4.44/ρ（ρ=3 时周期 ≈1.35 单位），方位向拉得很长
  float uf = rp + 1.2 * lr;
  float fiber = mix(0.5, noise3D(vec3(cos(uf) * 1.6, sin(uf) * 1.6, lr * 4.0 + u_flow * 0.8)), lodFade(fp * 4.44 * invR));
  float lanes = 0.07 + 0.93 * smoothstep(0.28, 0.78, fiber);   // 暗纹理带：高亮下依然看得见结构
  // 螺旋臂：很低频，无需带限
  float spiral = 0.5 + 0.5 * sin(3.0 * (rp + 1.8 * lr));
  // 径向涌入条纹：径向 cell 率 = |(2.2·0.9/ρ, 1.2)|
  float ur = rp + 0.9 * lr;
  float rushRate = sqrt(3.92 * invR * invR + 1.44);
  float rush = mix(0.5, noise3D(vec3(cos(ur) * 2.2, sin(ur) * 2.2, rho * 1.2 + u_flow * 2.2)), lodFade(fp * rushRate));
  float feed = 1.0 + (0.35 + 0.9 * inflow) * starSide;
  float edgeIn = smoothstep(R_IN, R_IN + max(0.35, fp), rho);
  float edgeOut = 1.0 - smoothstep(rOut - 2.4, rOut, rho);
  float density = edgeIn * edgeOut * lanes
                * (0.34 + 0.5 * turb + 0.16 * spiral + 0.3 * rush * inflow * starSide) * feed;

  // 三个轨道热斑：真实开普勒角速度（相位由 JS 积分）。高斯核按像素足迹预滤波（宽度卷积、能量守恒）
  float knots = 0.0;
  vec3 kr = vec3(2.85, 3.6, 4.9);
  vec3 kw = vec3(0.16, 0.20, 0.25);
  vec3 kd = vec3(0.20, 0.26, 0.34);
  vec3 kb = vec3(1.6, 1.2, 0.9);
  float fpA = fp * invR;
  for (int i = 0; i < 3; i++) {
    float ad = phi + u_knots[i];
    ad = atan(sin(ad), cos(ad));
    // 盒滤波（宽 fp）与高斯核卷积：方差相加，盒的方差为 fp²/12
    float kdE = sqrt(kd[i] * kd[i] + fp * fp * 0.0833);
    float kwE = sqrt(kw[i] * kw[i] + fpA * fpA * 0.0833);
    float dr = rho - kr[i];
    float radial = exp(-(dr * dr) / (kdE * kdE)) * (kd[i] / kdE);
    float k = exp(-(ad * ad) / (kwE * kwE)) * (kw[i] / kwE) * radial;
    k += 0.35 * exp(-max(0.0, ad) / 0.7) * radial * step(0.0, ad);
    knots += k * kb[i];
  }
  knots *= (0.35 + 0.65 * p) * edgeIn;

  // 相对论多普勒集束：物质朝观察者运动的一侧（左、朝向恒星）更亮更白
  vec3 orbDir = normalize(vec3(hp.z, 0.0, -hp.x));
  float vlos = dot(-velD, orbDir);
  float beta = clamp(sqrt(0.5 / rho) * (0.9 + 0.3 * p), 0.0, 0.75);
  float gamma = 1.0 / sqrt(1.0 - beta * beta);
  float dop = 1.0 / (gamma * (1.0 - beta * vlos));
  float beam = pow(clamp(dop, 0.7, 1.6), 2.0);

  float temp = 1.0 - smoothstep(R_IN, rOut, rho);
  vec3 cold = vec3(0.20, 0.38, 0.85);
  vec3 mid  = vec3(0.55, 0.78, 1.00);
  vec3 hot  = vec3(0.97, 0.99, 1.00);
  vec3 dc = mix(cold, mix(mid, hot, smoothstep(0.35, 0.95, temp)), temp);
  dc = mix(dc, hot, clamp((beam - 1.0) * 0.6, 0.0, 1.0));
  float flick = 1.0 + 0.08 * sin(u_time * 6.3 + rho * 5.0) * (1.0 - smoothstep(R_IN, 4.0, rho)) * lodFade(fp * 0.8);
  vec3 rgb = dc * beam * diskGain * flick * (density + knots) * 0.85;
  float da = clamp((density + knots * 0.6) * 0.85, 0.0, 0.96);
  return vec4(rgb, da);
}

float easeInOutCubic(float t) {
  return t < 0.5 ? 4.0 * t * t * t : 1.0 - pow(-2.0 * t + 2.0, 3.0) * 0.5;
}
// 弱场透镜方程给出的径向去放大：dβ/dθ ≈ 1 + (α/θ)·(D_ls/D) ≈ 1 + L·α/h0
float lensMag(vec3 vel, vec3 rayDir, float L, float h0) {
  float a = acos(clamp(dot(vel, rayDir), -1.0, 1.0));
  return min(12.0, 1.0 + L * a / max(h0, 0.5));
}
vec3 aces(vec3 c) {
  return clamp((c * (2.51 * c + 0.03)) / (c * (2.43 * c + 0.59) + 0.14), 0.0, 1.0);
}

/* ---------------- 单条光线：测地线积分 → 盘面 / 潮汐流 / 巨星 / 大气 / 星空 ---------------- */
vec4 traceSample(vec3 camPos, vec3 rayDir, float p, float pixAng) {
  float spinDrag = 0.32 * p;                 // 伪参考系拖曳
  float diskGain = 1.1 + 0.55 * p;
  float inflow   = p;
  // 盘面微进动：绕 x 轴缓慢摆动 ±2°，透镜拱弧随之呼吸
  float tilt = 0.02 * sin(u_time * 0.23) + 0.015 * sin(u_time * 0.41 + 1.0);
  float ct = cos(tilt);
  float st = sin(tilt);

  // 撞击参数（测地线守恒量）
  float h0 = length(cross(camPos, rayDir));
  // 透镜造成的径向拉伸（源面足迹倍率）≈ 1 + L·α/h0：α = 光线到目前为止累计的偏折角，
  // L = 越过近心点之后走过的路程。没弯过的光线（近侧盘面、恒星大部分）倍率恒为 1；
  // 越过黑洞落到远侧盘面的拱弧、绕行的光子环像才会被判定为强拉伸并相应放宽纹理带限。
  float sPast = 0.0;

  vec3 pos = camPos;
  vec3 vel = rayDir;
  vec3 col = vec3(0.0);
  float alpha = 0.0;
  bool horizon = false;
  float r = length(pos);
  float yA = pos.y * ct - pos.z * st;

  const int MAX_STEPS = 140;
  for (int i = 0; i < MAX_STEPS; i++) {
    r = length(pos);

    /* 1 · 事件视界：内部是有体积的深色渐变，掠射进入的光线在内缘留下一道柔和亮边 */
    if (r < Rs * 1.03) {
      horizon = true;
      float graze = 1.0 - abs(dot(pos / r, vel));
      vec3 inner = mix(vec3(0.004, 0.007, 0.014), vec3(0.02, 0.035, 0.07), graze);
      inner += vec3(0.6, 0.78, 1.0) * pow(graze, 8.0) * 0.5;
      col += (1.0 - alpha) * inner;
      alpha = 1.0;
      break;
    }

    // 步长随 r 平滑变化，视界附近最细；不再在 r=2.6 处跳变
    float dt = clamp(0.06 * r, 0.05, 0.6);

    /* 2 · 光子环补光：环的主亮度来自被透镜化的盘面光，这里只给绕行光线一点随自转流动的微光（按步长积分） */
    float pd = r - 1.5 * Rs;
    float tang = 1.0 - abs(dot(pos / r, vel));
    float ring = exp(-pd * pd * 200.0) * tang * tang;
    ring *= 0.85 + 0.25 * sin(pos.x * 4.0 + pos.z * 3.0 + u_spin * 3.0);
    col += (1.0 - alpha) * vec3(0.88, 0.94, 1.0) * ring * 0.33 * dt * (0.5 + 0.6 * p);

    /* 3 · 测地线积分 + 伪参考系拖曳 */
    vec3 hv = cross(pos, vel);
    float h2 = dot(hv, hv);
    vec3 acc = -1.5 * Rs * h2 * pos / (r * r * r * r * r + 1e-4);
    acc += spinDrag * cross(vec3(0.0, 1.0, 0.0), vel) / (r * r * r);
    vel = normalize(vel + acc * dt);
    vec3 newPos = pos + vel * dt;

    /* 4 · 吸积盘：用真实走过的这一段检测穿越（进动后的盘面） */
    float yB = newPos.y * ct - newPos.z * st;
    if (yA * yB <= 0.0) {
      float tc = -yA / (yB - yA + 1e-6);
      vec3 hp = mix(pos, newPos, tc);
      vec3 hpD = vec3(hp.x, 0.0, hp.y * st + hp.z * ct);
      vec3 vD = vec3(vel.x, vel.y * ct - vel.z * st, vel.y * st + vel.z * ct);
      float mag = lensMag(vel, rayDir, sPast, h0);
      float fp = length(hp - camPos) * pixAng * mag / max(abs(vD.y), 0.05);
      vec4 d = diskShade(hpD, vD, p, diskGain, inflow, fp);
      col += (1.0 - alpha) * d.rgb;
      alpha += (1.0 - alpha) * d.a;
    }
    pos = newPos;
    yA = yB;
    if (dot(pos, vel) > 0.0) sPast += dt;

    // 已越过近心点、正在远离且 r>9：剩余偏折 <~7°，退出循环，余下路径直线解析求交
    if (r > 9.0 && dot(pos, vel) > 0.0) break;
    // 远离黑洞后的光线基本走直线；提前退出可以避免巨星轮廓被残余弯折啃成锯齿
    if (r > 6.0 && dot(pos, vel) > 0.0 && length(cross(pos, vel)) > 3.2) break;
    if (alpha > 0.985) break;
  }

  // 步数耗尽却仍缠在光子球附近的光线：按落入阴影处理，避免边缘噪点
  if (!horizon && alpha < 0.985 && length(pos) < 3.0) {
    col += (1.0 - alpha) * vec3(0.01, 0.016, 0.03);
    alpha = 1.0;
    horizon = true;
  }

  /* ---------------- 逃逸光线：盘面解析求交 → 潮汐流 → 蓝巨星 / 大气 / 星空 ---------------- */
  if (!horizon && alpha < 0.985) {
    vec3 pD = vec3(pos.x, pos.y * ct - pos.z * st, pos.y * st + pos.z * ct);
    vec3 vD = vec3(vel.x, vel.y * ct - vel.z * st, vel.y * st + vel.z * ct);
    if (pD.y * vD.y < 0.0) {
      float sD = -pD.y / vD.y;
      float mag = lensMag(vel, rayDir, sPast + sD, h0);
      float fp = (length(pos - camPos) + sD) * pixAng * mag / max(abs(vD.y), 0.05);
      vec4 d = diskShade(pD + vD * sD, vD, p, diskGain, inflow, fp);
      col += (1.0 - alpha) * d.rgb;
      alpha += (1.0 - alpha) * d.a;
    }
    col += (1.0 - alpha) * streamGlow(pos, vel, inflow);

    // 蓝巨星：解析求交 + 亚像素边缘覆盖（轮廓不再是一像素硬台阶）
    vec3 oc = pos - STAR_C;
    float dC = length(oc);
    float b = dot(oc, vel);
    float ang = acos(clamp(-b / dC, -1.0, 1.0));
    float angR = asin(min(STAR_R / dC, 1.0));
    float pixA = pixAng * lensMag(vel, rayDir, sPast + max(-b, 0.0), h0);
    float cov = 1.0 - smoothstep(-0.75 * pixA, 0.75 * pixA, ang - angR);
    vec3 atm = starAtmosphere(pos, vel, p, pixA);
    vec3 bg = atm + sampleStars(vel) * (1.0 - min(atm.b, 1.0) * 0.8);
    if (cov > 0.001) {
      float hh = b * b - (dot(oc, oc) - STAR_R * STAR_R);
      vec3 hit;
      if (hh > 0.0) hit = pos + vel * (-b - sqrt(hh));
      else hit = STAR_C + normalize(oc - b * vel) * STAR_R;   // 掠过：取切点
      vec3 nGeo = normalize(hit - STAR_C);
      float mu = max(0.02, dot(nGeo, -vel));
      float fpS = length(hit - camPos) * pixA / mu;         // 掠射角越大，星面足迹越长
      vec3 sc = shadeStar(hit, nGeo, mu, p, fpS);
      col += (1.0 - alpha) * mix(bg, sc, cov);
    } else {
      col += (1.0 - alpha) * bg;
    }
    alpha += (1.0 - alpha) * cov;
  }
  return vec4(col, alpha);
}

void main() {
  float aspect = u_resolution.x / u_resolution.y;
  float p = clamp(u_progress, 0.0, 1.0);
  float camP = easeInOutCubic(p);

  /* ---------------- 相机：拉近 + 滚转 20° + 黑洞偏右 ---------------- */
  vec3 camPos = mix(vec3(0.0, 2.1, 16.5), vec3(0.0, 0.95, 12.0), camP);
  camPos.x += u_mouse.x * 0.35;
  camPos.y += u_mouse.y * 0.22;
  vec3 fwd = normalize(-camPos);
  vec3 right0 = normalize(cross(fwd, vec3(0.0, 1.0, 0.0)));
  vec3 up0 = cross(right0, fwd);
  float roll = 0.36;
  float cr = cos(roll);
  float sr = sin(roll);
  vec3 right = cr * right0 + sr * up0;
  vec3 up    = -sr * right0 + cr * up0;
  float fov = mix(1.4, 1.58, camP);
  vec2 shift = mix(vec2(-0.52, -0.06), vec2(-0.43, -0.10), camP);
  vec2 s = vec2(v_uv.x * aspect, v_uv.y) + shift;
  float pxS = 2.0 / u_resolution.y;   // 一个像素在 s 空间的尺寸
  float pixAng = pxS / fov;           // 一个像素的张角（弧度）

  /* ---------------- 分层超采样：只在黑洞附近加密 ---------------- */
  vec3 dir0 = normalize(s.x * right + s.y * up + fov * fwd);
  float h0 = length(cross(camPos, dir0));
  int ns = 1;
  if (abs(h0 - H_CRIT) < 0.24) ns = 8;       // 阴影边缘 + 光子环
  else if (h0 < 3.7) ns = 4;                 // 内盘 + 上方透镜拱弧

  vec4 acc = vec4(0.0);
  for (int i = 0; i < 8; i++) {
    if (i >= ns) break;
    vec2 off = (ns == 8) ? OFF8[i] : ((ns == 4) ? OFF4[i & 3] : vec2(0.0));
    vec2 si = s + off * pxS;
    vec3 rd = normalize(si.x * right + si.y * up + fov * fwd);
    acc += traceSample(camPos, rd, p, pixAng);
  }
  acc /= float(ns);
  vec3 col = acc.rgb;
  float alpha = acc.a;

  // 恒星把左半边画面整体浸成蓝色（参考图的左亮右暗），右侧也留一点深蓝灰而不是死黑
  col += vec3(0.04, 0.08, 0.16) * (1.0 - smoothstep(-0.7, 1.0, v_uv.x)) * (1.0 - alpha * 0.3);
  col += vec3(0.012, 0.02, 0.04) * (1.0 - alpha * 0.5);

  col = aces(col);
  col *= 1.0 - 0.18 * dot(v_uv, v_uv);
  // 抖动：打散 8-bit 量化带（深色阴影与气辉渐变里的色阶）
  col += (hash2i(ivec2(gl_FragCoord.xy)) - 0.5) * (1.0 / 255.0);
  fragColor = vec4(col, 1.0);
}
`;

const RENDER_SCALES = [1, 0.85, 0.7, 0.55];

export class BlackholeScene {
  /** 浏览器不支持 WebGL2 时为 false，页面据此回退到通用板块页 */
  readonly supported: boolean;

  private canvas: HTMLCanvasElement;
  private cb: BlackholeCallbacks;
  private gl: WebGL2RenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private vbo: WebGLBuffer | null = null;

  private uResolution: WebGLUniformLocation | null = null;
  private uTime: WebGLUniformLocation | null = null;
  private uProgress: WebGLUniformLocation | null = null;
  private uMouse: WebGLUniformLocation | null = null;
  private uSpin: WebGLUniformLocation | null = null;
  private uFlow: WebGLUniformLocation | null = null;
  private uKnots: WebGLUniformLocation | null = null;
  private uStream: WebGLUniformLocation | null = null;

  private rafId = 0;
  private startTime = 0;
  private disposed = false;

  private progress = 0;
  private targetProgress = 0;
  private mouseX = 0;
  private mouseY = 0;
  private targetMouseX = 0;
  private targetMouseY = 0;

  /* 由 dt 积分的运动相位：转速随滚动变化时纹理连续，不会跳变 */
  private spin = 0;
  private flow = 0;
  private knots = [0, 0, 0];
  private streamT = 0;
  private lastFrame = 0;

  private width = 0;
  private height = 0;

  /* 自适应分辨率：帧耗时超标就降内部分辨率，保住 60fps */
  private scaleIdx = 0;
  private frameEMA = 16.7;
  private lastScaleChange = 0;

  constructor(canvas: HTMLCanvasElement, cb: BlackholeCallbacks = {}) {
    this.canvas = canvas;
    this.cb = cb;
    this.supported = this.initGL();
    this.startTime = performance.now();
    if (this.supported) this.attach();
  }

  private initGL(): boolean {
    const gl = this.canvas.getContext("webgl2", {
      alpha: false,
      antialias: false,
      depth: false,
      powerPreference: "high-performance",
    });
    if (!gl) return false;
    this.gl = gl;

    const vs = this.compileShader(gl.VERTEX_SHADER, VERT_SHADER);
    const fs = this.compileShader(gl.FRAGMENT_SHADER, FRAG_SHADER);
    if (!vs || !fs) return false;

    const prog = gl.createProgram();
    if (!prog) return false;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.error("Program link failed:", gl.getProgramInfoLog(prog));
      return false;
    }
    this.program = prog;

    this.uResolution = gl.getUniformLocation(prog, "u_resolution");
    this.uTime = gl.getUniformLocation(prog, "u_time");
    this.uProgress = gl.getUniformLocation(prog, "u_progress");
    this.uMouse = gl.getUniformLocation(prog, "u_mouse");
    this.uSpin = gl.getUniformLocation(prog, "u_spin");
    this.uFlow = gl.getUniformLocation(prog, "u_flow");
    this.uKnots = gl.getUniformLocation(prog, "u_knots");
    this.uStream = gl.getUniformLocation(prog, "u_stream");

    const quad = new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]);
    const vao = gl.createVertexArray();
    const vbo = gl.createBuffer();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(prog, "a_pos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    this.vao = vao;
    this.vbo = vbo;

    this.resize();
    return true;
  }

  private compileShader(type: number, src: string): WebGLShader | null {
    const gl = this.gl;
    if (!gl) return null;
    const s = gl.createShader(type);
    if (!s) return null;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.error("Shader compile error:", gl.getShaderInfoLog(s));
      gl.deleteShader(s);
      return null;
    }
    return s;
  }

  private attach() {
    window.addEventListener("resize", this.resize);
    window.addEventListener("pointermove", this.onPointerMove, { passive: true });
    document.addEventListener("visibilitychange", this.onVisibility);
    this.rafId = requestAnimationFrame(this.render);
  }

  destroy() {
    this.disposed = true;
    cancelAnimationFrame(this.rafId);
    window.removeEventListener("resize", this.resize);
    window.removeEventListener("pointermove", this.onPointerMove);
    document.removeEventListener("visibilitychange", this.onVisibility);
    const gl = this.gl;
    if (gl) {
      if (this.vbo) gl.deleteBuffer(this.vbo);
      if (this.vao) gl.deleteVertexArray(this.vao);
      if (this.program) gl.deleteProgram(this.program);
    }
  }

  private onVisibility = () => {
    if (document.hidden) {
      cancelAnimationFrame(this.rafId);
    } else {
      this.lastFrame = 0;
      this.rafId = requestAnimationFrame(this.render);
    }
  };

  private onPointerMove = (e: PointerEvent) => {
    const cx = window.innerWidth * 0.5;
    const cy = window.innerHeight * 0.5;
    this.targetMouseX = (e.clientX - cx) / cx;
    this.targetMouseY = -(e.clientY - cy) / cy;
  };

  setProgress(target: number) {
    this.targetProgress = Math.max(0, Math.min(1, target));
  }

  private resize = () => {
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(320, rect.width || window.innerWidth);
    const h = Math.max(320, rect.height || window.innerHeight);
    const dpr = Math.min(1.25, window.devicePixelRatio || 1) * RENDER_SCALES[this.scaleIdx];
    this.width = Math.floor(w * dpr);
    this.height = Math.floor(h * dpr);
    this.canvas.width = this.width;
    this.canvas.height = this.height;
    this.gl?.viewport(0, 0, this.width, this.height);
  };

  private adaptResolution(now: number, dtMs: number) {
    if (dtMs > 0) this.frameEMA += (Math.min(dtMs, 100) - this.frameEMA) * 0.08;
    if (now - this.lastScaleChange < 2500) return;
    if (this.frameEMA > 24 && this.scaleIdx < RENDER_SCALES.length - 1) {
      this.scaleIdx++;
      this.lastScaleChange = now;
      this.resize();
    } else if (this.frameEMA < 11 && this.scaleIdx > 0 && now - this.lastScaleChange > 5000) {
      this.scaleIdx--;
      this.lastScaleChange = now;
      this.resize();
    }
  }

  /** 按当前进度对应的转速积分各运动相位（wrap 到 2π 保持数值精度） */
  private integrateMotion(dt: number) {
    const p = this.progress;
    const speedMul = 1 + 7 * Math.pow(p, 1.6);
    this.spin = (this.spin + dt * speedMul * 0.55) % TAU;
    this.flow += dt * (0.35 + 1.6 * p);
    for (let i = 0; i < 3; i++) {
      const w = (speedMul * 1.4) / Math.pow(KNOT_RADII[i], 1.5);
      this.knots[i] = (this.knots[i] + dt * w) % TAU;
    }
    this.streamT += dt * (1.6 + 6.5 * p);
  }

  private render = (now: number) => {
    if (this.disposed) return;
    const gl = this.gl;
    if (gl && this.program && this.vao) {
      const dtMs = this.lastFrame ? now - this.lastFrame : 0;
      this.lastFrame = now;
      const dt = Math.min(0.05, dtMs / 1000);
      this.adaptResolution(now, dtMs);

      this.progress += (this.targetProgress - this.progress) * 0.085;
      this.mouseX += (this.targetMouseX - this.mouseX) * 0.08;
      this.mouseY += (this.targetMouseY - this.mouseY) * 0.08;
      this.integrateMotion(dt);
      this.cb.onProgress?.(this.progress);

      gl.useProgram(this.program);
      gl.bindVertexArray(this.vao);
      gl.uniform2f(this.uResolution, this.width, this.height);
      gl.uniform1f(this.uTime, (now - this.startTime) * 0.001);
      gl.uniform1f(this.uProgress, this.progress);
      gl.uniform2f(this.uMouse, this.mouseX, this.mouseY);
      gl.uniform1f(this.uSpin, this.spin);
      gl.uniform1f(this.uFlow, this.flow);
      gl.uniform3f(this.uKnots, this.knots[0], this.knots[1], this.knots[2]);
      gl.uniform1f(this.uStream, this.streamT);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
    this.rafId = requestAnimationFrame(this.render);
  };
}
