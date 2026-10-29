/**
 * 闲鱼去广告脚本 (Loon)
 * 过滤首页/同城信息流广告卡片与详情页推荐广告卡片
 * 基于闲鱼 7.28.80 (com.taobao.fleamarket) IPA 逆向确认的广告卡片模板:
 *   fish_home_advertise_card_d3/d4    首页信息流广告
 *   fish_local_advertise_card_d4      同城信息流广告
 *   idlefish_local_feed2_marketing    同城营销卡片
 *   detail_recommend_ad_card          详情页推荐广告
 *   fish_home_feeds_pager_banner      信息流翻页Banner
 * 如需过滤首页顶部运营Banner,可在 AD_MARKERS 中加入 'fish_home_banner'
 *
 * 低耗电优化（过滤效果不变）:
 *   1. 响应原始文本不含任何广告卡片模板特征时直接放行，跳过 JSON 解析、
 *      递归清理与再序列化（无特征时 clean 必然是空操作，放行与清理等价）
 *   2. 嵌套 JSON 字符串仅在自身包含广告特征时才二次解析，其余原样保留
 *   3. 原地修改代替整棵对象树重建，减少大对象分配与 GC 压力
 */

const AD_MARKERS = [
  'fish_home_advertise_card',
  'fish_local_advertise_card',
  'idlefish_local_feed2_marketing',
  'detail_recommend_ad_card',
  'fish_home_feeds_pager_banner',
];

const MARKER_RE = AD_MARKERS.length
  ? new RegExp(AD_MARKERS.map((m) => m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'))
  : /$^/; // 空 markers 时永不匹配

function isAdItem(item) {
  try {
    return MARKER_RE.test(JSON.stringify(item));
  } catch (error) {
    return false;
  }
}

function cleanJsonString(text) {
  try {
    const parsed = JSON.parse(text);
    if (parsed !== null && typeof parsed === 'object') {
      return JSON.stringify(clean(parsed));
    }
  } catch (error) {}
  return text;
}

function clean(node) {
  if (Array.isArray(node)) {
    for (let i = node.length - 1; i >= 0; i--) {
      const item = node[i];
      if (item !== null && typeof item === 'object' && isAdItem(item)) {
        node.splice(i, 1);
      } else {
        clean(item);
      }
    }
    return node;
  }
  if (node !== null && typeof node === 'object') {
    for (const key of Object.keys(node)) {
      const value = node[key];
      if (typeof value === 'string') {
        // 仅嵌套 JSON 字符串自身含广告特征时才解析清理，其余原样保留
        if (MARKER_RE.test(value)) {
          node[key] = cleanJsonString(value);
        }
      } else {
        clean(value);
      }
    }
    return node;
  }
  return node;
}

const raw = $response.body;

// 快速预检：无任何广告卡片模板特征 → 原样放行（零解析开销）
if (typeof raw !== 'string' || raw.length === 0 || !MARKER_RE.test(raw)) {
  $done({});
} else {
  let body = raw;
  try {
    body = JSON.stringify(clean(JSON.parse(raw)));
  } catch (error) {}
  $done({ body });
}
