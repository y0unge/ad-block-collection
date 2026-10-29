/**
 * 闲鱼开屏广告"频控归零"脚本 (Loon)
 * 思路: 不拒绝开屏接口,而是篡改响应——把服务端下发的每日展示次数类字段归零、
 *       广告开关置false、素材列表清空,让App业务层认为"今日无可展示次数"主动跳过开屏,
 *       不触发联盟兜底(Fanti/BeiZi)、素材重试与缓存展示。
 * 字段名无关: 递归遍历响应JSON按正则匹配处理,不依赖具体字段名(7.28.80 IPA 逆向确认
 *       存在 maxShowCount/leftShowCount/ritIdShowCount 等频控 ivar)。
 * 观测: Loon 脚本日志搜索 [XY-Splash] 可见处理统计。
 */

const FREQ_KEY_RE = /(show_?count|show_?times|show_?freq|max_?show|left_?show|daily_?show|show_?limit|show_?daily|per_?day_?show)/i;
const ENABLE_KEY_RE = /(ad|ads|splash|advertis)[a-z_]*(enable|enabled|switch|open)/i;
const MATERIAL_KEY_RE = /^(images?|material_?list|ad_?list|ad_?materials?|splash_?ads?|creative_?list|advertisements?)$/i;

let freqHits = 0;
let enableHits = 0;
let materialHits = 0;

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
      } else if (FREQ_KEY_RE.test(key) && typeof value === 'number' && value > 0) {
        node[key] = 0;
        freqHits++;
      } else if (ENABLE_KEY_RE.test(key) && typeof value === 'boolean' && value === true) {
        node[key] = false;
        enableHits++;
      } else if (ENABLE_KEY_RE.test(key) && typeof value === 'number' && value === 1) {
        node[key] = 0;
        enableHits++;
      } else if (MATERIAL_KEY_RE.test(key) && Array.isArray(value) && value.length > 0) {
        node[key] = [];
        materialHits++;
      } else {
        fixNode(value);
      }
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
    console.log(`[XY-Splash] 频控归零 ${freqHits} 处, 开关置false ${enableHits} 处, 素材清空 ${materialHits} 处`);
  } catch (error) {}
  $done({ body });
}
