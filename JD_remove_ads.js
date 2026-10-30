// 京东去广告 / 去推荐
// 原作者: aoconch (https://github.com/aoconch/jd-loon-remove-recommend)
// 本仓库整合时移除了每个请求弹出系统通知的调试代码，其余逻辑保持不变
// functionId 常在 POST body；对所有 client.action/api 响应做清理
//
// 低耗电优化（去广告效果不变）:
//   1. 移除每请求一次的 <tag>.jddebug.com 必超时 DNS 观测查询
//      （每会话数百个超时 DNS 重试定时器 + UDP 包 + Warn 日志，纯观测开销）
//   2. [JD-FID] 只在真正拦截/清理时输出；DEBUG=true 可恢复全量流水排查
//   3. 原始响应快速预检：非专项 fid 且不含黑名单 mId/推荐标题特征时直接放行，
//      跳过 JSON 解析、递归清理与再序列化（此类响应 deepScrub 必然是空操作）
//   4. uniformRecommend 命中后立即返回，不再空转全量 scrub（并修复双 $done）
//   注：isRecFloor 保留原生 JSON.stringify 判定（实测快于 JS 层遍历），收益集中在
//       预检跳过与观测开销移除上
//
// 开屏 fid 无关兜底（2026-10-30）:
//   抓包发现京东新网络栈的加密 body 通道（uuid=...&body=<加密>&appid=mpaas2，URL 为
//   光秃 /client.action? 或根路径 /）中 functionId 为明文兄弟参数，但部分请求 body
//   整体加密时 pickFunctionId 可能拿不到 fid，start 分支不触发；另存在根路径
//   api.m.jd.com/ 直传 body fid 的通道。因此开屏字段清理不依赖 fid：只要响应中
//   出现 showTimesDaily/startADImage/start_isshow 等特征字段（无论嵌套在哪一层），
//   scrubSplashFields 即按与 start 分支相同语义清理（含 images/launchVideos 清空）。

(function () {
  const DEBUG = false; // true: 输出全部 functionId 流水用于排查（平时保持 false 省电）

  const url = $request.url || "";
  const reqBody = typeof $request.body === "string" ? $request.body : "";
  if (!$response || !$response.body) {
    $done({});
    return;
  }

  const raw = $response.body;
  const rawStr = typeof raw === "string" ? raw : "";

  function logHit(msg) {
    console.warn("[JD-FID] " + msg + " fid=" + (fid || "(none)"));
  }

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

  if (DEBUG) {
    console.warn("[JD-FID] " + ($request.method || "GET") + " fid=" + (fid || "(none)") + " url=" + url.slice(0, 100));
  }

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

  // 预检信号 = deepScrub/scrubSplashFields 可能产生修改的全部必要特征（黑名单 mId
  // 字面量 + mId 正则 token + 推荐标题 + 开屏特征字段）。原始文本不含任一信号时
  // 清理必然是空操作，直接放行。注：容器 key（floors/floorList 等）无需列入——
  // 容器存在而无楼层命中时本就是空操作；showtimes 单词不列入（影院排片等业务
  // 同名，用 showtimesdaily/start_isshow 等高置信 token 避免误判）。
  const SCRUB_SIGNAL_RE =
    /recommend|jdur|guess|rank|look|fashion|feed|maylike|goodstuff|cartrec|banner|buyoften|bigsale|attention|newsfloor|noticefloor|plusfloor|bpdynamic|showtimesdaily|startadimage|start_isshow|startisshow|showcondition|verctr|saoasao|ver14close|launchvideos|为你推荐|潮流好货|推荐榜单|快点来看看|你可能还喜欢|猜你喜欢|AI推荐|好物推荐|热门推荐|精选推荐|看了又看|相似好物/i;

  // 专项 fid：分支内的处理不依赖特征预检（start 清字段、cart 清列表等），必须解析
  const SPECIAL_FID_RE = /^(deliverLayer|orderTrackBusiness|getTabHomeInfo|myOrderInfo|personinfoBusiness|start|welcomeHome)$/i;
  const CART_FID_RE = /cart|Cart|shopCart|synCart/i;
  // 非 JSON（可能加密）响应的推荐兜底判定（与原版一致）
  const RECOMMENDISH_RE = /recommend|personinfo|cart|myOrder|orderTrack|deliverLayer/i;
  const specialFid = SPECIAL_FID_RE.test(fid) || CART_FID_RE.test(fid);

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
    logHit("uniformRecommend -> 空包");
    $done({ body: emptyRecommendPayload() });
    return;
  }

  // 快速预检：非专项 fid、非推荐兜底类、响应无任何可清理特征 → 原样放行（零解析开销）
  if (!specialFid && !RECOMMENDISH_RE.test(fid + url + reqBody) && !SCRUB_SIGNAL_RE.test(rawStr)) {
    $done({});
    return;
  }

  let obj;
  try {
    obj = JSON.parse(rawStr);
  } catch (e) {
    // 非 JSON（可能加密）：若请求是推荐相关，仍尝试空包
    if (RECOMMENDISH_RE.test(fid + url + reqBody)) {
      logHit("非JSON推荐接口 -> 空包");
      $done({ body: emptyRecommendPayload() });
      return;
    }
    $done({});
    return;
  }

  let dirty = 0; // 清理命中计数（仅用于 [JD-FID] 命中日志）

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
    // 任意字段字符串命中标题（原生 stringify，实测快于 JS 层遍历）
    try {
      const s = JSON.stringify(f);
      if (TITLE_RE.test(s) && s.length < 8000) return true;
    } catch (e) {}
    return false;
  }

  function emptyRecommend(o) {
    if (!o || typeof o !== "object") return 0;
    let changed = 0;
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
      if (Array.isArray(o[k])) {
        if (o[k].length > 0) {
          o[k] = [];
          changed++;
        } else {
          o[k] = [];
        }
      }
    });
    if (o.hasNextPage != null && o.hasNextPage !== false) {
      o.hasNextPage = false;
      changed++;
    }
    if (o.hasMore != null && o.hasMore !== false) {
      o.hasMore = false;
      changed++;
    }
    return changed;
  }

  function scrubFloors(floors) {
    if (!Array.isArray(floors)) return floors;
    const before = floors.length;
    const kept = floors.filter((f) => !isRecFloor(f));
    dirty += before - kept.length;
    return kept;
  }

  function deepScrub(node, depth) {
    if (!node || typeof node !== "object" || depth > 10) return;
    if (Array.isArray(node)) {
      for (let i = node.length - 1; i >= 0; i--) {
        const item = node[i];
        if (isRecFloor(item)) {
          node.splice(i, 1);
          dirty++;
        } else {
          deepScrub(item, depth + 1);
        }
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
    if (obj?.bannerInfo) {
      delete obj.bannerInfo;
      dirty++;
    }
    if (obj?.floors?.length) obj.floors = scrubFloors(obj.floors);
    dirty += emptyRecommend(obj);
  } else if (fid === "getTabHomeInfo") {
    if (obj?.result?.iconInfo) {
      delete obj.result.iconInfo;
      dirty++;
    }
    if (obj?.result?.roofTop) {
      delete obj.result.roofTop;
      dirty++;
    }
  } else if (fid === "myOrderInfo") {
    if (obj?.floors?.length) {
      const before = obj.floors.length;
      obj.floors = obj.floors.filter(
        (floor) => !["bannerFloor", "bpDynamicFloor", "plusFloor"].includes(floor?.mId) && !isRecFloor(floor)
      );
      dirty += before - obj.floors.length;
    }
  } else if (fid === "personinfoBusiness") {
    const scrub = (floors) => {
      if (!floors?.length) return floors;
      const before = floors.length;
      const kept = floors.filter((floor) => {
        if (BLOCK_MID.has(floor?.mId) || isRecFloor(floor)) return false;
        if (floor?.mId === "basefloorinfo" && floor.data) {
          if (floor.data.commonPopup) {
            delete floor.data.commonPopup;
            dirty++;
          }
          if (floor.data.commonPopup_dynamic) {
            delete floor.data.commonPopup_dynamic;
            dirty++;
          }
          if (floor.data.floatLayer) {
            delete floor.data.floatLayer;
            dirty++;
          }
          if (Array.isArray(floor.data.commonTips) && floor.data.commonTips.length) {
            floor.data.commonTips = [];
            dirty++;
          }
          if (Array.isArray(floor.data.commonWindows) && floor.data.commonWindows.length) {
            floor.data.commonWindows = [];
            dirty++;
          }
        }
        return true;
      });
      dirty += before - kept.length;
      return kept;
    };
    if (obj?.floors) obj.floors = scrub(obj.floors);
    if (obj?.others?.floors) obj.others.floors = scrub(obj.others.floors);
  } else if (fid === "start") {
    const hadAds =
      (Array.isArray(obj?.images) && obj.images.length > 0) || !!obj?.startADImage;
    if (obj?.images?.length) {
      obj.images = [];
      dirty++;
    }
    if (obj?.showTimesDaily) {
      obj.showTimesDaily = 0;
      dirty++;
    }
    // IPA(16.1.80)逆向补充：开屏广告单图字段
    if ("startADImage" in obj) {
      delete obj.startADImage;
      dirty++;
    }
    // 频控/展示门槛全面压制(字段清单来自 16.1.80 IPA strings):
    // 每日额度、展示标志、展示条件、CTR开关、视频开屏
    const ZERO_KEYS = [
      "showtimes", "showTimes", "start_isshow", "startIsshow",
      "showcondition", "verCtrSwitch", "verCtrAllSwitch", "saoasaoSwitch",
    ];
    for (const k of ZERO_KEYS) {
      if (k in obj) {
        if (obj[k] !== 0) dirty++;
        obj[k] = 0;
      }
    }
    if ("ver14CloseSwitch" in obj) obj.ver14CloseSwitch = 1;
    if (Array.isArray(obj.launchVideos) && obj.launchVideos.length) {
      obj.launchVideos = [];
      dirty++;
    }
    if (Array.isArray(obj.LaunchVideos) && obj.LaunchVideos.length) {
      obj.LaunchVideos = [];
      dirty++;
    }
    if (hadAds) {
      dirty++; // 人证信号: 开屏素材被下发且已被清理
      try {
        $notification.post("JD去广告", "开屏素材已拦截清理", "");
      } catch (e) {}
    }
  } else if (fid === "welcomeHome") {
    if (obj?.floorList?.length) {
      const before = obj.floorList.length;
      const delItems = ["bottomXview", "float", "photoCeiling", "recommend", "ruleFloat", "searchIcon", "topRotate", "tabBarAtmosphere"];
      obj.floorList = obj.floorList.filter((i) => !delItems.includes(i?.type) && !isRecFloor(i));
      dirty += before - obj.floorList.length;
    }
    if (obj?.webViewFloorList?.length) {
      obj.webViewFloorList = [];
      dirty++;
    }
  } else if (CART_FID_RE.test(fid)) {
    // 购物车主接口：清推荐楼层
    deepScrub(obj, 0);
    dirty += emptyRecommend(obj);
    if (obj.data) dirty += emptyRecommend(obj.data);
    if (obj.result) dirty += emptyRecommend(obj.result);
  }

  // 开屏特征字段（与 start 分支/ZERO_KEYS 同源，16.1.80 IPA strings）
  // 高置信门控 key：节点含其一才按开屏节点处理（避免误伤普通业务字段）
  const SPLASH_GATE_RE = /^(showTimesDaily|startADImage|start_isshow|startIsshow|showcondition|verCtrSwitch|verCtrAllSwitch|saoasaoSwitch|ver14CloseSwitch|launchVideos|LaunchVideos)$/;
  // 门控命中后需归零的 key（含无 "Daily" 后缀的变体）
  const SPLASH_ZERO_RE = /^(showTimesDaily|showtimes|showTimes|start_isshow|startIsshow|showcondition|verCtrSwitch|verCtrAllSwitch|saoasaoSwitch)$/;

  // fid 无关的开屏字段清理：递归遍历（含嵌套 JSON 字符串），凡节点命中门控 key
  // 即按 start 分支同语义处理（频控/开关归零、startADImage 删除、launchVideos 清空、
  // 兄弟 images 数组清空、ver14CloseSwitch=1）。fid 不可见（加密 body/根路径通道）
  // 或字段嵌套在 data 等子层时由此兜底。
  function scrubSplashFields(node) {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach(scrubSplashFields);
      return;
    }
    for (const k of Object.keys(node)) {
      const v = node[k];
      if (typeof v === "string" && v.length > 1 && (v.charAt(0) === "{" || v.charAt(0) === "[")) {
        try {
          const parsed = JSON.parse(v);
          if (parsed !== null && typeof parsed === "object") {
            const before = JSON.stringify(parsed);
            scrubSplashFields(parsed);
            const after = JSON.stringify(parsed);
            if (after !== before) node[k] = after;
          }
        } catch (e) {}
      } else {
        scrubSplashFields(v);
      }
    }
    const keys = Object.keys(node);
    if (!keys.some((k) => SPLASH_GATE_RE.test(k))) return;
    for (const k of keys) {
      if (SPLASH_ZERO_RE.test(k)) {
        if (node[k] !== 0) {
          node[k] = 0;
          dirty++;
        }
      } else if (k === "startADImage") {
        delete node[k];
        dirty++;
      } else if (k === "ver14CloseSwitch") {
        if (node[k] !== 1) {
          node[k] = 1;
          dirty++;
        }
      } else if (k === "launchVideos" || k === "LaunchVideos") {
        if (Array.isArray(node[k]) && node[k].length) {
          node[k] = [];
          dirty++;
        }
      }
    }
    if (Array.isArray(node.images) && node.images.length) {
      node.images = [];
      dirty++;
    }
    if (node.startADImage) {
      delete node.startADImage;
      dirty++;
    }
  }

  // 全局：按标题/mId 递归清
  deepScrub(obj, 0);

  // 全局：开屏特征字段 fid 无关清理（加密 body/根路径通道下 fid 不可见的兜底）
  scrubSplashFields(obj);

  if (dirty > 0) {
    logHit("cleaned hits=" + dirty);
  }
  $done({ body: JSON.stringify(obj) });
})();
