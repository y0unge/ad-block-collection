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
 */

const AD_MARKERS = [
  'fish_home_advertise_card',
  'fish_local_advertise_card',
  'idlefish_local_feed2_marketing',
  'detail_recommend_ad_card',
  'fish_home_feeds_pager_banner',
];

function isAdItem(item) {
  try {
    const text = JSON.stringify(item);
    return AD_MARKERS.some((marker) => text.indexOf(marker) !== -1);
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
    return node
      .filter((item) => !(item !== null && typeof item === 'object' && isAdItem(item)))
      .map(clean);
  }
  if (node !== null && typeof node === 'object') {
    const result = {};
    for (const key of Object.keys(node)) {
      const value = node[key];
      result[key] =
        typeof value === 'string' && value.length > 1 && (value.charAt(0) === '{' || value.charAt(0) === '[')
          ? cleanJsonString(value)
          : clean(value);
    }
    return result;
  }
  return node;
}

const raw = $response.body;

if (typeof raw !== 'string' || raw.length === 0) {
  $done({});
} else {
  let body = raw;
  try {
    body = JSON.stringify(clean(JSON.parse(raw)));
  } catch (error) {}
  $done({ body });
}
