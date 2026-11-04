// 墨迹天气「免广告会员」状态模拟 (moji_adfree.js)
// 匹配: mcs.api.moji.com/json/member/{get_member_info,memberSyncV2}
//       sns.api.moji.com/sns/json/{account/login,account/loginBySMSCode,account/fastbm,profile/get_info_v2}
// 依据: 9.0950.02 IPA 逆向
//   · IAPMemberInfoModel ivars: { isMember(NSNumber), isAdFree(NSNumber), vipType(NSString),
//     memberInfo(IAPVisitorMemberInfoModel) } — memberSyncV2/get_member_info 响应模型
//   · SnsUserData ivars: { _member(NSNumber), _isAdFree(NSNumber), ... } — 登录响应模型,
//     NSCoding 归档到 DataStore(saveSnsUserData), 广告系统经
//     ad_reloadAdsForMemberStatusChange 依会员状态重载广告
//   · 墨迹自有独立「免广告会员」档( adver_free 接口组: json/adver_free/adver_free_homepage|
//     adver_free_list|add_order|pay_order|adver_free_detail ), 唯一权益=无广告
// 逻辑: 仅改写/注入 isAdFree=1, 不动 isMember/vipType/memberType/到期时间 ——
//       不产生任何 VIP 数据功能副作用(付费数据 40 天预报/流感地图等由服务端按账号裁剪,
//       与本脚本无关)
// 安全: 任何解析失败/参数关闭/无改动一律 $done({}) 原样放行

var TAG = "[MJ-ADFree]";

function log(msg) {
  try { console.log(TAG + " " + msg); } catch (e) {}
}

(function main() {
  var arg = {};
  try {
    if (typeof $argument === "object" && $argument) arg = $argument;
  } catch (e) {}

  var enabled = true;
  if (arg.moji_adfree !== undefined) {
    enabled = !(arg.moji_adfree === false || String(arg.moji_adfree) === "false" || String(arg.moji_adfree) === "0");
  }

  var body = "";
  try { body = $response.body || ""; } catch (e) {}

  if (!enabled || typeof body !== "string" || body.length === 0) {
    $done({});
    return;
  }
  // 快速预检: 响应中无会员字段特征直接放行(零解析, 低耗电)
  if (body.indexOf("isAdFree") < 0 && body.indexOf("isMember") < 0 &&
      body.indexOf("\"member\"") < 0) {
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

  var changed = 0;
  var injected = 0;

  // 修改已存在的 isAdFree(类型保真), 或在与 isMember/member 同级注入
  function patch(node, depth) {
    if (depth > 6) return false;
    var touched = false;
    if (Array.isArray(node)) {
      for (var i = 0; i < node.length; i++) {
        if (patch(node[i], depth + 1)) touched = true;
      }
      return touched;
    }
    if (!node || typeof node !== "object") return false;

    if (Object.prototype.hasOwnProperty.call(node, "isAdFree")) {
      var cur = node.isAdFree;
      var truthy = (cur === 1 || cur === "1" || cur === true);
      if (!truthy) {
        node.isAdFree = (typeof cur === "boolean") ? true : (typeof cur === "string" ? "1" : 1);
        touched = true;
        changed++;
      }
    } else if (depth <= 3) {
      // 仅在确认为会员信息模型层级时注入(isMember 或 member 兄弟键),
      // 避免给无关业务模型乱加字段
      var hasIsMember = Object.prototype.hasOwnProperty.call(node, "isMember");
      var hasMember = Object.prototype.hasOwnProperty.call(node, "member");
      if (hasIsMember || hasMember) {
        node.isAdFree = 1;
        touched = true;
        injected++;
      }
    }

    for (var k in node) {
      if (Object.prototype.hasOwnProperty.call(node, k)) {
        if (patch(node[k], depth + 1)) touched = true;
      }
    }
    return touched;
  }

  var touched = patch(obj, 0);

  if (!touched) {
    $done({});
    return;
  }

  var out;
  try { out = JSON.stringify(obj); } catch (e) {
    log("序列化失败, 放行");
    $done({});
    return;
  }

  log((changed ? "改写 " + changed + " 处" : "") +
      (injected ? (changed ? ", " : "") + "注入 " + injected + " 处" : "") +
      " isAdFree(免广告档, 不动 isMember/vipType)");
  $done({ body: out });
})();
