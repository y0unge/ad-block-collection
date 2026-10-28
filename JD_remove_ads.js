// 京东去广告 / 去推荐
// 原作者: aoconch (https://github.com/aoconch/jd-loon-remove-recommend)
// 本仓库整合时移除了每个请求弹出系统通知的调试代码，其余逻辑保持不变
// functionId 常在 POST body；对所有 client.action/api 响应做清理

const url = $request.url || "";
const reqBody = typeof $request.body === "string" ? $request.body : "";
if (!$response || !$response.body) $done({});

const raw = $response.body;
const rawStr = typeof raw === "string" ? raw : "";

function pickFunctionId() {
  let m = url.match(/[?&]functionId=([^&]+)/i);
  if (m) return decodeURIComponent(m[1]);
  m = reqBody.match(/(?:^|&)functionId=([^&]+)/i);
  if (m) return decodeURIComponent(m[1]);
  try {
    const j = JSON.parse(reqBody);
    if (j && j.functionId) return String(j.functionId);
  } catch (e) {}
  // body 里嵌套的 functionId=xxx
  m = reqBody.match(/functionId%3D([^%&]+)/i) || reqBody.match(/"functionId"\s*:\s*"([^"]+)"/i);
  if (m) return decodeURIComponent(m[1]);
  return "";
}

const fid = pickFunctionId();

const TITLE_RE =
  /为你推荐|潮流好货|推荐榜单|快点来看看|你可能还喜欢|猜你喜欢|AI推荐|好物推荐|热门推荐|精选推荐|看了又看|相似好物/;

const BLOCK_MID = new Set([
  "recommendfloor",
  "recommendFloor",
  "recommend_floor",
  "recommend",
  "feeds",
  "feedFloor",
  "rankFloor",
  "rankListFloor",
  "ranklist",
  "lookFloor",
  "lookAround",
  "buyOften",
  "fashionGoods",
  "goodStuffFloor",
  "mayLikeFloor",
  "guessYouLike",
  "bigSaleFloor",
  "newAttentionCard",
  "newBigSaleFloor",
  "newStyleAttentionCard",
  "newsFloor",
  "noticeFloor",
  "bannerFloor",
  "bpDynamicFloor",
  "plusFloor",
  "banner",
  "jdDeliveryBanner",
  "cartRecommend",
  "cartRecommendFloor",
  "recommendRank",
  "rankRecommend",
  "feedRecommend",
]);

function emptyRecommendPayload() {
  return JSON.stringify({
    code: "0",
    echo: "0",
    hasNextPage: false,
    hasMore: false,
    wareInfoList: [],
    list: [],
    data: { wareInfoList: [], list: [], hasNextPage: false, hasMore: false, feeds: [] },
    result: { wareInfoList: [], list: [], hasNextPage: false, hasMore: false },
  });
}

// uniformRecommend：直接空包（购物车/消息/物流底部流）
if (/^uniformRecommend/i.test(fid) || /functionId=uniformRecommend/i.test(url + reqBody)) {
  $done({ body: emptyRecommendPayload() });
}

let obj;
try {
  obj = JSON.parse(rawStr);
} catch (e) {
  // 非 JSON（可能加密）：若请求是推荐相关，仍尝试空包
  if (/recommend|personinfo|cart|Cart|myOrder|orderTrack|deliverLayer/i.test(fid + url + reqBody)) {
    $done({ body: emptyRecommendPayload() });
  }
  $done({});
}

function floorText(f) {
  if (!f || typeof f !== "object") return "";
  return [f.title, f.name, f.floorName, f.floorTitle, f.showTitle, f.tabName, f.subTitle, f.mainTitle, f.text]
    .filter(Boolean)
    .join("|");
}

function isRecFloor(f) {
  if (!f || typeof f !== "object") return false;
  const id = String(f.mId || f.mid || f.type || f.floorId || f.templateId || f.bId || "");
  if (BLOCK_MID.has(id) || /recommend|jdur|guess|rank|look|fashion|feed|maylike|goodstuff|cartRec/i.test(id))
    return true;
  if (TITLE_RE.test(floorText(f))) return true;
  // 任意字段字符串命中标题
  try {
    const s = JSON.stringify(f);
    if (TITLE_RE.test(s) && s.length < 8000) return true;
  } catch (e) {}
  return false;
}

function emptyRecommend(o) {
  if (!o || typeof o !== "object") return;
  [
    "wareInfoList",
    "wareList",
    "list",
    "feeds",
    "feedList",
    "rankList",
    "recommendList",
    "itemList",
    "skuList",
    "productList",
    "dataList",
    "contentList",
    "cardList",
  ].forEach((k) => {
    if (Array.isArray(o[k])) o[k] = [];
  });
  if (o.hasNextPage != null) o.hasNextPage = false;
  if (o.hasMore != null) o.hasMore = false;
}

function scrubFloors(floors) {
  if (!Array.isArray(floors)) return floors;
  return floors.filter((f) => !isRecFloor(f));
}

function deepScrub(node, depth) {
  if (!node || typeof node !== "object" || depth > 10) return;
  if (Array.isArray(node)) {
    for (let i = node.length - 1; i >= 0; i--) {
      const item = node[i];
      if (isRecFloor(item)) node.splice(i, 1);
      else deepScrub(item, depth + 1);
    }
    return;
  }
  for (const k of Object.keys(node)) {
    const v = node[k];
    if ((k === "floors" || k === "floorList" || k === "webViewFloorList" || k === "floorInfoList") && Array.isArray(v)) {
      node[k] = scrubFloors(v);
      deepScrub(node[k], depth + 1);
      continue;
    }
    if (typeof v === "string" && TITLE_RE.test(v)) {
      emptyRecommend(node);
      // 标题所在对象尽量标记删除由上层 floors 过滤；这里清空列表
    }
    deepScrub(v, depth + 1);
  }
}

// 可莉同款专项
if (fid === "deliverLayer" || fid === "orderTrackBusiness") {
  if (obj?.bannerInfo) delete obj.bannerInfo;
  if (obj?.floors?.length) obj.floors = scrubFloors(obj.floors);
  emptyRecommend(obj);
} else if (fid === "getTabHomeInfo") {
  if (obj?.result?.iconInfo) delete obj.result.iconInfo;
  if (obj?.result?.roofTop) delete obj.result.roofTop;
} else if (fid === "myOrderInfo") {
  if (obj?.floors?.length) {
    obj.floors = obj.floors.filter(
      (floor) => !["bannerFloor", "bpDynamicFloor", "plusFloor"].includes(floor?.mId) && !isRecFloor(floor)
    );
  }
} else if (fid === "personinfoBusiness") {
  const scrub = (floors) => {
    if (!floors?.length) return floors;
    return floors.filter((floor) => {
      if (BLOCK_MID.has(floor?.mId) || isRecFloor(floor)) return false;
      if (floor?.mId === "basefloorinfo" && floor.data) {
        delete floor.data.commonPopup;
        delete floor.data.commonPopup_dynamic;
        delete floor.data.floatLayer;
        if (Array.isArray(floor.data.commonTips)) floor.data.commonTips = [];
        if (Array.isArray(floor.data.commonWindows)) floor.data.commonWindows = [];
      }
      return true;
    });
  };
  if (obj?.floors) obj.floors = scrub(obj.floors);
  if (obj?.others?.floors) obj.others.floors = scrub(obj.others.floors);
} else if (fid === "start") {
  if (obj?.images?.length) obj.images = [];
  if (obj?.showTimesDaily) obj.showTimesDaily = 0;
} else if (fid === "welcomeHome") {
  if (obj?.floorList?.length) {
    const delItems = ["bottomXview", "float", "photoCeiling", "recommend", "ruleFloat", "searchIcon", "topRotate", "tabBarAtmosphere"];
    obj.floorList = obj.floorList.filter((i) => !delItems.includes(i?.type) && !isRecFloor(i));
  }
  if (obj?.webViewFloorList?.length) obj.webViewFloorList = [];
} else if (/cart|Cart|shopCart|synCart/i.test(fid)) {
  // 购物车主接口：清推荐楼层
  deepScrub(obj, 0);
  emptyRecommend(obj);
  if (obj.data) emptyRecommend(obj.data);
  if (obj.result) emptyRecommend(obj.result);
}

// 全局：按标题/mId 递归清
deepScrub(obj, 0);

$done({ body: JSON.stringify(obj) });
