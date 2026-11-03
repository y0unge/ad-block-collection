// 墨迹天气「我的」页入口精简 (moji_my_page.js)
// 匹配: mme.api.moji.com/json/entrance/list 响应
// 依据: 9.0950.02 IPA 本地兜底配置 UserCenterTool.json 实锤响应结构
//   { entrance_region_res_list: [ { region_name, region_no, style_type,
//     entrance_res_list: [ { entrance_name, entrance_id, link_type, ... } ] } ] }
// 逻辑: 按关键词剔除命中 region_name/entrance_name 的 region / 入口项
// 安全: 任何解析失败 / 参数关闭 / 无改动 一律 $done({}) 原样放行

var TAG = "[MJ-My]";
var DEFAULT_FILTER = "广告,福利,活动,商城,游戏,邀请,赚,红包,任务,领";

function log(msg) {
  try { console.log(TAG + " " + msg); } catch (e) {}
}

function kwList(s) {
  return String(s || "")
    .split(/[,，、|;；]+/)
    .map(function (x) { return x.trim(); })
    .filter(function (x) { return x.length > 0; });
}

function hit(name, kws) {
  if (!name) return false;
  var s = String(name);
  for (var i = 0; i < kws.length; i++) {
    if (s.indexOf(kws[i]) >= 0) return true;
  }
  return false;
}

(function main() {
  // ---- 参数 ----
  var arg = {};
  try {
    if (typeof $argument === "object" && $argument) arg = $argument;
    else if (typeof $argument === "string" && $argument) arg = { my_filter: $argument };
  } catch (e) {}

  var enabled = true;
  if (arg.my_simplify !== undefined) {
    enabled = !(arg.my_simplify === false || String(arg.my_simplify) === "false" || String(arg.my_simplify) === "0");
  }

  var kws = kwList(arg.my_filter !== undefined ? arg.my_filter : DEFAULT_FILTER);

  // ---- 响应体 ----
  var body = "";
  try { body = $response.body || ""; } catch (e) {}

  if (!enabled || typeof body !== "string" || body.length === 0) {
    $done({});
    return;
  }
  // 快速预检: 无入口列表特征直接放行(零解析, 低耗电)
  if (body.indexOf("entrance_region_res_list") < 0 && body.indexOf("entrance_res_list") < 0) {
    $done({});
    return;
  }
  if (kws.length === 0) {
    $done({});
    return;
  }

  var obj = null;
  try { obj = JSON.parse(body); } catch (e) {}
  if (!obj || typeof obj !== "object") {
    log("JSON 解析失败, 放行 len=" + body.length);
    $done({});
    return;
  }

  // 兼容顶层或 data 包裹
  var containers = [obj];
  if (obj.data && typeof obj.data === "object") containers.push(obj.data);

  var removedRegions = [];
  var removedEntries = [];

  for (var c = 0; c < containers.length; c++) {
    var list = containers[c].entrance_region_res_list;
    if (!Array.isArray(list) || list.length === 0) continue;

    var kept = [];
    for (var i = 0; i < list.length; i++) {
      var region = list[i];
      if (!region || typeof region !== "object") { kept.push(region); continue; }
      if (hit(region.region_name, kws) || hit(region.region_no, kws)) {
        removedRegions.push(region.region_name || region.region_no || "?");
        continue;
      }
      var entries = region.entrance_res_list;
      if (Array.isArray(entries) && entries.length > 0) {
        var keptEntries = [];
        for (var j = 0; j < entries.length; j++) {
          var en = entries[j];
          if (en && typeof en === "object" && hit(en.entrance_name, kws)) {
            removedEntries.push(en.entrance_name || String(en.entrance_id || "?"));
            continue;
          }
          keptEntries.push(en);
        }
        if (keptEntries.length === 0) {
          // 过滤后 region 内已无入口, 整个 region 一并剔除
          removedRegions.push(region.region_name || region.region_no || "?");
          continue;
        }
        region.entrance_res_list = keptEntries;
      }
      kept.push(region);
    }
    if (kept.length !== list.length) containers[c].entrance_region_res_list = kept;
  }

  if (removedRegions.length === 0 && removedEntries.length === 0) {
    $done({});
    return;
  }

  var out;
  try { out = JSON.stringify(obj); } catch (e) {
    log("序列化失败, 放行");
    $done({});
    return;
  }

  log("region剔除 " + removedRegions.length + " (" + removedRegions.slice(0, 6).join("/") +
      (removedRegions.length > 6 ? "…" : "") + "), 入口剔除 " + removedEntries.length +
      " (" + removedEntries.slice(0, 6).join("/") + (removedEntries.length > 6 ? "…" : "") + ")");

  $done({ body: out });
})();
