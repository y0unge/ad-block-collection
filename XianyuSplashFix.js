/**
 * 闲鱼开屏广告响应篡改脚本 (Loon)
 * 2026-10-30 跨零点抓包实锤 (出现开屏的那次冷启动):
 *   开屏真实下发通道为 mtop.taobao.idlecommerce.splash.ads 响应的
 *   data.realTimeAd.mamaAd.imageMaterial —— 品牌广告(xy_adx_brand / fromDsp=opActivity),
 *   showNow:"true" 服务端实时决策, 响应中不存在 maxShowCount/leftShowCount 等频控字段,
 *   旧"频控归零"正则全部落空, 素材原样到达 App, 表现为"跨零点首启必出一次开屏"。
 *   每天仅一次是服务端自身的日频控(同日第二次请求的响应中已无 realTimeAd)。
 * 修复: 递归删除 realTimeAd 节点 —— 与服务器"当日无广告"响应形状完全一致
 *   (实测无广告响应即无此节点, App 主动跳过开屏, 不触发联盟兜底/重试/缓存展示)。
 * 兜底: 频控/开关/素材字段通用归零, 扩展字符串值("true"/"1"/数字串)与
 *   mamaAd/imageMaterial/adMap/dspList 容器, 防未来 schema 变体。
 * 观测: Loon 脚本日志搜 [XY-Splash]。
 */

const FREQ_KEY_RE = /(show_?count|show_?times|show_?freq|max_?show|left_?show|daily_?show|show_?limit|show_?daily|per_?day_?show)/i;
const ENABLE_KEY_RE = /(ad|ads|splash|advertis)[a-z_]*(enable|enabled|switch|open)/i;
const SHOW_NOW_KEY_RE = /^(show_?now)$/i;
const MATERIAL_KEY_RE = /^(images?|material_?list|ad_?list|ad_?materials?|splash_?ads?|creative_?list|advertisements?|mama_?ad|image_?material|native_?ad_?material)$/i;
const CONTAINER_KEY_RE = /^(ad_?map|dsp_?list)$/i;
const REALTIME_KEY_RE = /^(real_?time_?ad)$/i;

let freqHits = 0;
let enableHits = 0;
let materialHits = 0;
let realtimeHits = 0;

// 保持类型不变地置假: true->false / 1->0 / "true"->"false" / "1"->"0" / "n"->"0"; 不适用返回 null
function falsify(value) {
  if (value === true) return false;
  if (value === 1) return 0;
  if (typeof value === 'string') {
    if (value.toLowerCase() === 'true') return 'false';
    if (value === '1') return '0';
    if (/^\d+(\.\d+)?$/.test(value) && parseFloat(value) > 0) return '0';
  }
  return null;
}

function fixNode(node) {
  if (Array.isArray(node)) {
    node.forEach(fixNode);
    return node;
  }
  if (node !== null && typeof node === 'object') {
    for (const key of Object.keys(node)) {
      const value = node[key];
      if (typeof value === 'string' && value.length > 1 && (value.charAt(0) === '{' || value.charAt(0) === '[')) {
        node[key] = fixJsonString(value);
        continue;
      }
      // 开屏实测通道: 整树删除 realTimeAd(含 mamaAd/imageMaterial/showNow 等全部子节点)
      if (REALTIME_KEY_RE.test(key) && value !== null && typeof value === 'object') {
        delete node[key];
        realtimeHits++;
        continue;
      }
      if (FREQ_KEY_RE.test(key)) {
        const f = typeof value === 'number' && value > 0 ? 0
          : typeof value === 'string' && /^\d+(\.\d+)?$/.test(value) && parseFloat(value) > 0 ? '0'
          : null;
        if (f !== null) {
          node[key] = f;
          freqHits++;
          continue;
        }
      }
      if (ENABLE_KEY_RE.test(key) || SHOW_NOW_KEY_RE.test(key)) {
        const f = falsify(value);
        if (f !== null) {
          node[key] = f;
          enableHits++;
          continue;
        }
      }
      if (MATERIAL_KEY_RE.test(key) || CONTAINER_KEY_RE.test(key)) {
        if (Array.isArray(value) && value.length > 0) {
          node[key] = [];
          materialHits++;
          continue;
        }
        if (value !== null && typeof value === 'object' && Object.keys(value).length > 0) {
          node[key] = {};
          materialHits++;
          continue;
        }
      }
      fixNode(value);
    }
    return node;
  }
  return node;
}

function fixJsonString(text) {
  try {
    const parsed = JSON.parse(text);
    if (parsed !== null && typeof parsed === 'object') {
      return JSON.stringify(fixNode(parsed));
    }
  } catch (error) {}
  return text;
}

const raw = $response.body;

if (typeof raw !== 'string' || raw.length === 0) {
  $done({});
} else {
  let body = raw;
  try {
    body = JSON.stringify(fixNode(JSON.parse(raw)));
  } catch (error) {}
  try {
    console.log(`[XY-Splash] realTimeAd删除 ${realtimeHits} 处, 频控归零 ${freqHits} 处, 开关置false ${enableHits} 处, 素材清空 ${materialHits} 处`);
  } catch (error) {}
  $done({ body });
}
