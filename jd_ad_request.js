/*
 * JD ad-endpoint blocker + functionId logger.
 *
 * The modern JD network stack (JDNetworkBaseAF) serializes functionId into
 * the POST body, leaving the URL bare ("/client.action?"), so URL-based
 * rewrites/scripts never match those requests. This script reads the body,
 * answers pure-ad endpoints locally with an empty JSON.
 *
 * 低耗电优化（拦截效果不变）:
 *   1. 移除每请求一次的 <tag>.jddebug.com 必超时 DNS 观测查询
 *      （每会话数百个超时 DNS 重试定时器 + UDP 包 + Warn 日志，纯观测开销）
 *   2. [JD-FID] 只在命中拦截时输出；DEBUG=true 可恢复全量流水排查
 */

const DEBUG = false; // true: 输出全部 functionId 流水用于排查（平时保持 false 省电）

const REJECT_FIDS = {
  queryPagePopWindow: 1, // page pop-up ads
  babelGetGuideTips: 1, // home guide overlay
  secondFloor: 1, // pull-down marketing second floor
  searchBoxWord: 1, // search box marketing words
  stationPullService: 1,
  uniformRecommend0: 1, // recommendation feed ad slots
  uniformRecommend6: 1,
  uniformRecommend9: 1,
};

const url = $request.url || "";
let body = $request.body;
let fid = "";

const um = url.match(/[?&]functionId=([^&]+)/);
if (um) fid = um[1];

if (!fid && typeof body === "string" && body.length > 0) {
  const bm = body.match(/(?:^|&)functionId=([^&]*)/);
  if (bm) {
    try {
      fid = decodeURIComponent(bm[1].replace(/\+/g, "%20"));
    } catch (e) {
      fid = bm[1];
    }
  }
  if (!fid) {
    const jm = body.match(/"functionId"\s*:\s*"([^"]+)"/);
    if (jm) fid = jm[1];
  }
}

if (DEBUG) {
  console.warn(
    "[JD-FID] " +
      ($request.method || "GET") +
      " fid=" +
      (fid || "(none)") +
      " url=" +
      url.slice(0, 120)
  );
}

if (fid && REJECT_FIDS[fid]) {
  console.warn("[JD-FID] blocked fid=" + fid);
  $done({
    response: {
      status: 200,
      headers: { "Content-Type": "application/json; charset=UTF-8" },
      body: "{}",
    },
  });
} else {
  $done({});
}
