/*
 * JD ad-endpoint blocker + functionId logger.
 *
 * The modern JD network stack (JDNetworkBaseAF) serializes functionId into
 * the POST body, leaving the URL bare ("/client.action?"), so URL-based
 * rewrites/scripts never match those requests. This script reads the body,
 * answers pure-ad endpoints locally with an empty JSON, and logs every
 * functionId to the Loon script console as "[JD-FID]" lines.
 */

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

console.warn(
  "[JD-FID] " +
    ($request.method || "GET") +
    " fid=" +
    (fid || "(none)") +
    " url=" +
    url.slice(0, 120)
);

// Write-through into the exportable Loon system log: query a bogus
// <tag>.jddebug.com subdomain (JD authoritative DNS drops unknown labels),
// the guaranteed timeout emits a Warn line "[DNS O UDP] Send A query
// for:jdfid-req-<fid>.jddebug.com" visible in the system log export.
try {
  $http.get(
    "http://jdfid-req-" + (fid || "none").replace(/[^a-zA-Z0-9]/g, "-").slice(0, 40) + ".jddebug.com/p",
    function () {}
  );
} catch (e) {}

if (fid && REJECT_FIDS[fid]) {
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
