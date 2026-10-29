/* 广汽传祺 (Trumpchi) 开屏广告响应篡改 — Loon http-response 脚本
 *
 * 背景:
 *   开屏广告数据源 /app-api/baseinfo/advertise/getAdvertiseByPositionCode
 *   (positionCode=1 为开屏, 82 为首页右下悬浮)。早期版本用 reject-dict
 *   返回 {},App 若按"接口失败"处理会走本地缓存/兜底展示(参考闲鱼教训),
 *   故改为返回结构合法的"成功但无广告"响应,业务层主动跳过开屏:
 *     {"data":[],"resultCode":"0","resultMsg":"success"}
 *   同理将登录页开屏视频/封面 (getLoginVideoAndCover) 置空。
 *
 * 观测: Loon 日志搜索 [GAC-AD] 可见命中流水 (Warning 级)。
 */

(function () {
  const url = $request.url || "";

  let data;
  if (url.indexOf("getLoginVideoAndCover") !== -1) {
    // 登录页开屏视频/封面: data 为对象
    data = { contentDetail: "", videoSrc: "" };
  } else if (url.indexOf("getAdvertiseByPositionCode") !== -1) {
    // 广告位数据源: data 为数组, 空数组 = 无广告
    data = [];
  } else {
    // 未识别的接口, 原样放行
    $done({});
    return;
  }

  const body = JSON.stringify({
    data: data,
    exceptCauseApp: null,
    exceptCauseIp: null,
    exceptClass: null,
    exceptStackTrace: null,
    exportDataQueryBeanName: null,
    extFields: {},
    importDataHandlerBeanName: null,
    resultCode: "0",
    resultMsg: "success",
  });

  console.log("[GAC-AD] splash blocked -> " + url.split("?")[0]);
  $done({ body: body });
})();
