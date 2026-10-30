var DEFAULT_KEYWORDS = "黑客700,速比特,开普勒";
var STORE_KEY = "alipay_goods_monitor_seen_v1";
var MAX_STORE = 300;
var MAX_PER_KW = 3;
var MAX_PUSH = 8;
var CLIP_LEN = 80;

function log(msg) {
  try { console.log("[商品监控] " + msg); } catch (e) {}
}

function decodeEscapes(s) {
  return s
    .replace(/\\u([0-9a-fA-F]{4})/g, function (_, h) {
      return String.fromCharCode(parseInt(h, 16));
    })
    .replace(/\\"/g, '"')
    .replace(/\\n/g, " ")
    .replace(/\\r/g, "")
    .replace(/\\t/g, " ")
    .replace(/\\\//g, "/")
    .replace(/\\\\/g, "\\");
}

function clip(s, n) {
  s = String(s).replace(/\s+/g, " ").trim();
  return s.length > n ? s.slice(0, n) + "…" : s;
}

(function main() {
  var arg = {};
  try {
    if ($argument && typeof $argument === "object") arg = $argument;
    else if (typeof $argument === "string" && $argument) arg = { keywords: $argument };
  } catch (e) {}

  var keywords = String(arg.keywords || DEFAULT_KEYWORDS)
    .split(/[,，、|;；]+/)
    .map(function (s) { return s.trim(); })
    .filter(function (s) { return s.length > 0; });

  var dedupeHours = parseFloat(arg.dedupeHours);
  if (!isFinite(dedupeHours) || dedupeHours < 0) dedupeHours = 24;

  var openLink = "";
  try { openLink = String(arg.openLink || "").trim(); } catch (e) {}

  var heartbeat = String(arg.notifyMode || "always") !== "hit";

  var body = "";
  try { body = $response.body || ""; } catch (e) {}

  var opType = "";
  try {
    var rb = (typeof $request !== "undefined" && $request && typeof $request.body === "string") ? $request.body : "";
    if (rb) {
      var om = rb.match(/(?:^|&)operationType=([^&]+)/i) || rb.match(/"operationType"\s*:\s*"([^"]+)"/i);
      if (om) opType = decodeURIComponent(om[1]);
    }
  } catch (e) {}

  var usable = typeof body === "string" && body.length > 0 && keywords.length > 0;
  log("触发 " + (opType || (typeof $request !== "undefined" && $request && $request.url ? $request.url : "?")) + " len=" + (typeof body === "string" ? body.length : 0) + (usable ? "" : " (跳过)"));

  var lines = [];
  var kws = [];
  var quickHit = false;
  var found = [];

  if (usable) {
    var decoded = decodeEscapes(body);
    var texts = decoded !== body ? [body, decoded] : [body];

    var values = [];
    var seen = {};
    function addVal(v) {
      var t = String(v).trim();
      if (t && !seen[t]) { seen[t] = 1; values.push(t); }
    }

    function walk(obj, depth) {
      if (depth > 6 || values.length > 3000) return;
      if (typeof obj === "string") {
        addVal(obj);
        var t = obj.trim();
        if (t.length > 1 && (t.charAt(0) === "{" || t.charAt(0) === "[")) {
          try { walk(JSON.parse(t), depth + 1); } catch (e) {}
        }
        return;
      }
      if (Array.isArray(obj)) {
        for (var i = 0; i < obj.length; i++) walk(obj[i], depth + 1);
        return;
      }
      if (obj && typeof obj === "object") {
        for (var k in obj) {
          if (Object.prototype.hasOwnProperty.call(obj, k)) walk(obj[k], depth + 1);
        }
      }
    }

    var parsed = null;
    try { parsed = JSON.parse(body); } catch (e) {}
    if (parsed !== null && typeof parsed === "object") {
      walk(parsed, 0);
    } else {
      var STR_RE = /"((?:[^"\\\x00-\x1f]|\\.){1,300})"/g;
      function extractStrings(text) {
        var out = [], m;
        STR_RE.lastIndex = 0;
        while ((m = STR_RE.exec(text)) !== null) {
          var v = m[1]
            .replace(/\\n/g, " ")
            .replace(/\\r/g, "")
            .replace(/\\t/g, " ")
            .replace(/\\"/g, '"')
            .replace(/\\\\/g, "\\")
            .replace(/\\u([0-9a-fA-F]{4})/g, function (_, h) {
              return String.fromCharCode(parseInt(h, 16));
            })
            .trim();
          if (v && out.indexOf(v) === -1) out.push(v);
        }
        return out;
      }
      for (var a = 0; a < texts.length; a++) {
        var arr = extractStrings(texts[a]);
        for (var b = 0; b < arr.length; b++) addVal(arr[b]);
      }
    }

    for (var i2 = 0; i2 < keywords.length && !quickHit; i2++) {
      var kwL0 = keywords[i2].toLowerCase();
      for (var v0 = 0; v0 < values.length && !quickHit; v0++) {
        if (values[v0].toLowerCase().indexOf(kwL0) !== -1) quickHit = true;
      }
      for (var t0 = 0; t0 < texts.length && !quickHit; t0++) {
        if (texts[t0].toLowerCase().indexOf(kwL0) !== -1) quickHit = true;
      }
    }

    if (quickHit) {
      for (var k = 0; k < keywords.length; k++) {
        var kw = keywords[k];
        var kwL = kw.toLowerCase();
        var hits = [];
        for (var v = 0; v < values.length; v++) {
          if (values[v].toLowerCase().indexOf(kwL) !== -1) hits.push(values[v]);
        }
        if (!hits.length) {
          for (var t1 = 0; t1 < texts.length; t1++) {
            var idx = texts[t1].toLowerCase().indexOf(kwL);
            if (idx !== -1) {
              var ctx = clip(texts[t1]
                .slice(Math.max(0, idx - 40), Math.min(texts[t1].length, idx + kw.length + 40))
                .replace(/[\r\n\t]+/g, " ")
                .replace(/[{}\[\]"\\,]/g, " "), CLIP_LEN);
              if (ctx) hits.push(ctx);
              break;
            }
          }
        } else {
          hits.sort(function (x, y) { return x.length - y.length; });
          var picked = [];
          for (var h = 0; h < hits.length && picked.length < MAX_PER_KW; h++) {
            if (picked.length === 0 && hits[h].length <= kw.length) continue;
            var hl = hits[h].toLowerCase(), dup = false;
            for (var p = 0; p < picked.length; p++) {
              var pl = picked[p].toLowerCase();
              if (hl.indexOf(pl) !== -1 || pl.indexOf(hl) !== -1) { dup = true; break; }
            }
            if (!dup) picked.push(hits[h]);
          }
          if (!picked.length) picked.push(hits[hits.length - 1]);
          hits = picked;
        }
        if (hits.length) found.push({ kw: kw, titles: hits });
      }
    }
  }

  if (found.length) {
    var now = Date.now();
    var ttl = dedupeHours * 3600000;
    var store = {};
    try { store = JSON.parse($persistentStore.read(STORE_KEY) || "{}") || {}; } catch (e) {}
    for (var key in store) {
      if (Object.prototype.hasOwnProperty.call(store, key)) {
        if (typeof store[key] !== "number" || now - store[key] > ttl) delete store[key];
      }
    }

    for (var f = 0; f < found.length; f++) {
      var kwHit = false;
      for (var q = 0; q < found[f].titles.length; q++) {
        var sig = found[f].kw + " :: " + found[f].titles[q];
        if (ttl > 0 && store[sig]) continue;
        store[sig] = now;
        lines.push("【" + found[f].kw + "】" + clip(found[f].titles[q], CLIP_LEN));
        kwHit = true;
      }
      if (kwHit) kws.push(found[f].kw);
    }

    if (lines.length) {
      var skeys = Object.keys(store);
      if (skeys.length > MAX_STORE) {
        skeys.sort(function (x, y) { return store[x] - store[y]; });
        for (var d = 0; d < skeys.length - MAX_STORE; d++) delete store[skeys[d]];
      }
      try { $persistentStore.write(JSON.stringify(store), STORE_KEY); } catch (e) {}

      var total = lines.length;
      if (total > MAX_PUSH) {
        lines = lines.slice(0, MAX_PUSH);
        lines.push("…… 共 " + total + " 条");
      }

      var title = "发现目标商品";
      var subtitle = "关键词: " + kws.join("、");
      var content = lines.join("\n");
      try {
        if (openLink) $notification.post(title, subtitle, content, openLink);
        else $notification.post(title, subtitle, content);
      } catch (e) {
        try { $notification.post(title, subtitle, content); } catch (e2) {}
      }
      log("命中 " + kws.join("、") + "，推送 " + total + " 条");
    }
  }

  if (!lines.length && heartbeat && usable) {
    var st = (quickHit && found.length) ? "重复命中(去重)" : "无命中";
    try {
      $notification.post("支付宝商品监控", (opType || "mgw响应").slice(0, 40), st + " len=" + body.length);
    } catch (e) {}
  }

  $done({});
})();
