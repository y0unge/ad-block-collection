/*
 * 网易云音乐 VIP 解锁 —— eapi 响应改写脚本 (Loon http-response)
 *
 * 逆向依据: com.netease.cloudmusic 9.6.15 脱壳 IPA
 *   - eapi 响应体 = AES-128-ECB 密文(密钥 e82ckenh8dichen8, CloudMusicCoSDK),
 *     通常再包一层 gzip(Content-Encoding: gzip); 请求侧脚本已把
 *     Accept-Encoding 改为 identity, 服务器将返回纯 AES(JSON) 不压缩
 *   - 去填充规则: 末字节即填充长度(1..16)
 *   - 客户端 decrypt:type: 对 len%16!=0 的体解密失败会原样放行
 *     (0x10175cb38 tst x2,#0xf), 因此改写后的 JSON 以纯文本返回即可
 *
 * 2026 服务器现状(实测): 对非 VIP 账号的付费歌曲, player/url 只下发
 * 服务端切片的 30 秒试听文件(jd-musicrep-ts 路径), freeTrialInfo 置空
 * 仅能去掉客户端试听交互, 无法变出完整音频。
 *
 * 因此本脚本提供两级解锁:
 *   1) [unm_url 配置了音源 API] 换源模式: 用歌曲名/歌手/时长在
 *      UnblockNeteaseMusic 兼容音源 API(kugou/kuwo/migu/qq)上搜索匹配,
 *      命中则把响应里的试听 url 替换为完整音频直链(md5/size/type 同步修正)
 *   2) [未配置或换源失败] 降级模式: freeTrialInfo/freeTrialPrivilege/
 *      freeTimeTrialPrivilege 置空 + privilege(payed/pl/dl/st)修补,
 *      去掉 VIP 弹窗与试听限制交互(实际音频仍为 30s 切片)
 *
 * 任何环节失败(非 eapi 密文/解析失败/无改动)一律 $done({}) 原样放行,
 * 绝不破坏正常响应。
 */

(function () {
  'use strict';

  var EAPI_KEY = 'e82ckenh8dichen8';
  var LOG_TAG = '[NM-VIP]';
  var TRIAL_KEYS = ['freeTrialInfo', 'freeTrialPrivilege', 'freeTimeTrialPrivilege'];
  var CACHE_KEY = 'nm_vip_songs';
  var CACHE_MAX = 400;
  var SOURCES = ['kugou', 'kuwo', 'migu', 'qq'];

  /* ================= 插件参数 ================= */
  function pluginArgs() {
    try {
      if (typeof $argument === 'undefined') return {};
      if (typeof $argument === 'string') return JSON.parse($argument) || {};
      if (typeof $argument === 'object') return $argument;
    } catch (e) {}
    return {};
  }

  function argEnabled(v, dflt) {
    if (v === undefined || v === null || v === '') return dflt;
    if (v === true) return true;
    if (v === false) return false;
    var s = String(v).toLowerCase();
    if (s === 'true' || s === '1' || s === 'yes' || s === 'on') return true;
    if (s === 'false' || s === '0' || s === 'no' || s === 'off') return false;
    return dflt;
  }

  /* ================= body → Uint8Array ================= */
  function bodyToBytes(body, info) {
    if (body === null || body === undefined) return null;
    if (typeof body === 'string') {
      info.form = 'string';
      var out = new Uint8Array(body.length);
      for (var i = 0; i < body.length; i++) out[i] = body.charCodeAt(i) & 0xff;
      return out;
    }
    if (body instanceof Uint8Array) { info.form = 'uint8'; return body; }
    if (body instanceof ArrayBuffer) { info.form = 'uint8'; return new Uint8Array(body); }
    if (Array.isArray(body)) { info.form = 'array'; return new Uint8Array(body); }
    return null;
  }

  function bytesToWordArray(bytes) {
    var words = [];
    for (var i = 0; i < bytes.length; i++) {
      var w = i >>> 2;
      words[w] = (words[w] || 0) | ((bytes[i] & 0xff) << (24 - (i % 4) * 8));
    }
    return CryptoJS.lib.WordArray.create(words, bytes.length);
  }

  function wordArrayToBytes(wa) {
    var out = new Uint8Array(wa.sigBytes);
    for (var i = 0; i < wa.sigBytes; i++) {
      out[i] = (wa.words[i >>> 2] >>> (24 - (i % 4) * 8)) & 0xff;
    }
    return out;
  }

  function utf8Decode(bytes, end) {
    var s = '';
    var i = 0;
    while (i < end) {
      var b = bytes[i];
      if (b < 0x80) { s += String.fromCharCode(b); i += 1; }
      else if (b < 0xC0) { i += 1; }
      else if (b < 0xE0) { s += String.fromCharCode(((b & 0x1F) << 6) | (bytes[i + 1] & 0x3F)); i += 2; }
      else if (b < 0xF0) { s += String.fromCharCode(((b & 0x0F) << 12) | ((bytes[i + 1] & 0x3F) << 6) | (bytes[i + 2] & 0x3F)); i += 3; }
      else {
        var cp = ((b & 0x07) << 18) | ((bytes[i + 1] & 0x3F) << 12) | ((bytes[i + 2] & 0x3F) << 6) | (bytes[i + 3] & 0x3F);
        cp -= 0x10000;
        s += String.fromCharCode(0xD800 + (cp >> 10), 0xDC00 + (cp & 0x3FF));
        i += 4;
      }
    }
    return s;
  }

  function utf8Encode(s) {
    var bytes = [];
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c < 0x80) bytes.push(c);
      else if (c < 0x800) bytes.push(0xC0 | (c >> 6), 0x80 | (c & 0x3F));
      else if (c >= 0xD800 && c <= 0xDBFF && i + 1 < s.length) {
        var lo = s.charCodeAt(i + 1);
        var cp = 0x10000 + ((c - 0xD800) << 10) + (lo - 0xDC00);
        bytes.push(0xF0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3F), 0x80 | ((cp >> 6) & 0x3F), 0x80 | (cp & 0x3F));
        i++;
      } else bytes.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 0x3F), 0x80 | (c & 0x3F));
    }
    return bytes;
  }

  function utf8ByteLength(s) {
    var n = 0;
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c < 0x80) n += 1;
      else if (c < 0x800) n += 2;
      else if (c >= 0xD800 && c <= 0xDBFF) { n += 4; i++; }
      else n += 3;
    }
    return n;
  }

  /* ================= eapi 加解密 ================= */
  function aesDecryptToBytes(bytes) {
    var params = CryptoJS.lib.CipherParams
      ? CryptoJS.lib.CipherParams.create({ ciphertext: bytesToWordArray(bytes) })
      : { ciphertext: bytesToWordArray(bytes) };
    var wa = CryptoJS.AES.decrypt(
      params,
      CryptoJS.enc.Utf8.parse(EAPI_KEY),
      { mode: CryptoJS.mode.ECB, padding: CryptoJS.pad.NoPadding }
    );
    return wordArrayToBytes(wa);
  }

  function aesEncryptBytes(bytes) {
    var cp = CryptoJS.AES.encrypt(
      bytesToWordArray(bytes),
      CryptoJS.enc.Utf8.parse(EAPI_KEY),
      { mode: CryptoJS.mode.ECB, padding: CryptoJS.pad.Pkcs7 }
    );
    return wordArrayToBytes(cp.ciphertext);
  }

  /* 解密响应体 → {text, wasGzip} 或 null(放弃, 调用方放行) */
  function decryptBody(bytes) {
    var pt = aesDecryptToBytes(bytes);
    if (pt.length === 0) return null;
    if (pt[0] === 0x1f && pt[1] === 0x8b) {
      if (typeof pako === 'undefined') return null; // gzip 响应且无 pako: 只能放行(请求侧已避免这种情况)
      var tries = [pt];
      // PKCS7 填充剥离变体(gzip 尾部是 ISIZE, 末字节规则不可靠, 需校验;
      // 且 pako 会把尾部填充当第二个 gzip member 解析, 必须剥离)
      var p = pt[pt.length - 1];
      var ok = false;
      if (p >= 1 && p <= 16 && p <= pt.length) {
        ok = true;
        for (var k = pt.length - p; k < pt.length; k++) if (pt[k] !== p) { ok = false; break; }
      }
      if (ok) tries.push(pt.subarray(0, pt.length - p));
      for (var t = 0; t < tries.length; t++) {
        try {
          var out = pako.ungzip(tries[t]); // 注意: pako 的 {to:'string'} 对 ungzip 无效, 返回 Uint8Array
          if (out && out.length > 0) {
            var arr = out instanceof Uint8Array ? out : new Uint8Array(out);
            return { text: utf8Decode(arr, arr.length), wasGzip: true };
          }
        } catch (e) {}
      }
      return null;
    }
    var end = pt.length;
    var last = pt[end - 1];
    if (last >= 1 && last <= 16 && last <= end) end -= last;
    while (end > 0 && pt[end - 1] === 0) end--;
    return { text: utf8Decode(pt, end), wasGzip: false };
  }

  /* ================= 返回体构造 ================= */
  function doneWithJson(obj, wasGzip, info) {
    var out = JSON.stringify(obj);
    var finalBytes;
    if (wasGzip) {
      // 原 gzip 路径: 重新 gzip + AES 加密, 保持 Content-Encoding 兼容
      var gz = pako.gzip(out);
      finalBytes = aesEncryptBytes(gz instanceof Uint8Array ? gz : new Uint8Array(gz));
    } else {
      // 纯 JSON 返回: 客户端对 len%16!=0 解密失败回退原文(0x10175cb38 验证)
      while (utf8ByteLength(out) % 16 === 0) out += ' ';
      finalBytes = utf8Encode(out);
    }
    if (info.form === 'array') {
      $done({ body: Array.prototype.slice.call(finalBytes) });
    } else if (info.form === 'uint8') {
      $done({ body: finalBytes instanceof Uint8Array ? finalBytes : new Uint8Array(finalBytes) });
    } else {
      var s = '';
      for (var i = 0; i < finalBytes.length; i++) s += String.fromCharCode(finalBytes[i]);
      $done({ body: s });
    }
  }

  /* ================= 歌名缓存(换源搜索用) ================= */
  function cacheLoad() {
    try {
      return JSON.parse($persistentStore.read(CACHE_KEY) || '{}') || {};
    } catch (e) { return {}; }
  }

  function cacheSave(map) {
    try { $persistentStore.write(JSON.stringify(map), CACHE_KEY); } catch (e) {}
  }

  function cachePut(map, song) {
    map[song.n_id] = { n: song.n_name, a: song.n_artist, d: song.n_dur, ts: Date.now() };
    var keys = Object.keys(map);
    if (keys.length > CACHE_MAX) {
      keys.sort(function (x, y) { return (map[x].ts || 0) - (map[y].ts || 0); });
      for (var i = 0; i < keys.length - CACHE_MAX; i++) delete map[keys[i]];
    }
  }

  /* 收集 JSON 里的歌曲对象(有 id/name/ar/dt), 供换源搜索 */
  function collectSongs(node, map) {
    if (node === null || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (var i = 0; i < node.length; i++) collectSongs(node[i], map);
      return;
    }
    if (typeof node.id === 'number' && typeof node.name === 'string' &&
        Array.isArray(node.ar) && typeof node.dt === 'number') {
      var artists = [];
      for (var j = 0; j < node.ar.length && j < 4; j++) {
        if (node.ar[j] && node.ar[j].name) artists.push(node.ar[j].name);
      }
      cachePut(map, {
        n_id: String(node.id), n_name: node.name,
        n_artist: artists.join(' '), n_dur: node.dt
      });
    }
    for (var k in node) {
      if (Object.prototype.hasOwnProperty.call(node, k)) collectSongs(node[k], map);
    }
  }

  /* ================= privilege / 试听字段 ================= */
  function isPrivilege(o) {
    return o !== null && typeof o === 'object' && !Array.isArray(o) &&
      ('pl' in o) && ('dl' in o) && ('st' in o);
  }

  function patchPrivilege(p) {
    var changed = false;
    if (p.payed === 0) { p.payed = 1; changed = true; }
    if (!p.pl || p.pl <= 0) { p.pl = 320000; changed = true; }
    if (!p.dl || p.dl <= 0) { p.dl = 320000; changed = true; }
    if (p.st < 0) { p.st = 0; changed = true; }
    if (p.cs === true) { p.cs = false; changed = true; }
    return changed;
  }

  function walkPatch(node) {
    if (node === null || typeof node !== 'object') return false;
    if (Array.isArray(node)) {
      var c1 = false;
      for (var i = 0; i < node.length; i++) c1 = walkPatch(node[i]) || c1;
      return c1;
    }
    var changed = false;
    if (isPrivilege(node)) changed = patchPrivilege(node) || changed;
    for (var k = 0; k < TRIAL_KEYS.length; k++) {
      if (TRIAL_KEYS[k] in node && node[TRIAL_KEYS[k]] !== null) {
        node[TRIAL_KEYS[k]] = null;
        changed = true;
      }
    }
    for (var name in node) {
      if (Object.prototype.hasOwnProperty.call(node, name) && TRIAL_KEYS.indexOf(name) === -1) {
        changed = walkPatch(node[name]) || changed;
      }
    }
    return changed;
  }

  /* ================= 换源(UnblockNeteaseMusic 兼容 API) ================= */
  function httpGetJson(url, cb) {
    try {
      $httpClient.get({ url: url, headers: { 'User-Agent': 'NeteaseMusic/9.6.15' } }, function (error, response, body) {
        if (error || !body) { cb(null); return; }
        try { cb(JSON.parse(body)); } catch (e) { cb(null); }
      });
    } catch (e) { cb(null); }
  }

  /* 宽容解析: 递归收集"看起来像搜索结果"的对象数组 */
  function findItemArrays(node, acc) {
    if (node === null || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      var ok = node.length > 0;
      for (var i = 0; i < node.length; i++) {
        if (!node[i] || typeof node[i] !== 'object' || Array.isArray(node[i]) || node[i].id === undefined) { ok = false; break; }
      }
      if (ok) acc.push(node);
      else for (var j = 0; j < node.length; j++) findItemArrays(node[j], acc);
      return;
    }
    for (var k in node) {
      if (Object.prototype.hasOwnProperty.call(node, k)) findItemArrays(node[k], acc);
    }
  }

  function normDuration(v) {
    var n = typeof v === 'string' ? parseInt(v, 10) : v;
    if (typeof n !== 'number' || !isFinite(n) || n <= 0) return 0;
    if (n < 600) n = n * 1000; // 秒 → 毫秒
    return n;
  }

  function itemText(it) {
    var name = it.name || it.songName || it.title || '';
    var arts = '';
    if (Array.isArray(it.artists)) {
      var a = [];
      for (var i = 0; i < it.artists.length; i++) if (it.artists[i] && it.artists[i].name) a.push(it.artists[i].name);
      arts = a.join(' ');
    } else if (typeof it.artist === 'string') arts = it.artist;
    else if (it.singerName) arts = String(it.singerName);
    return (name + ' ' + arts).toLowerCase();
  }

  function matchScore(it, kwLower, targetDurMs) {
    var txt = itemText(it);
    if (!txt) return -1;
    var kwHit = 0;
    var words = kwLower.split(/\s+/);
    for (var i = 0; i < words.length; i++) {
      if (words[i] && txt.indexOf(words[i]) >= 0) kwHit++;
    }
    if (kwHit === 0) return -1; // 无关键词命中直接淘汰(避免同名无关歌曲)
    var dur = normDuration(it.duration || it.interval || it.Duration);
    var durScore = 0;
    if (targetDurMs > 0 && dur > 0) {
      var delta = Math.abs(dur - targetDurMs);
      if (delta > 5000) return -1; // 时长差 >5s 视为不同录音(现场/DJ 版)
      durScore = 100 - Math.floor(delta / 50);
    }
    return kwHit * 10 + durScore;
  }

  /* 递归找音源直链 */
  function findUrl(node, depth) {
    if (depth > 6 || node === null || typeof node !== 'object') return null;
    var keys = ['url', 'play_url', 'playUrl', 'backupUrl', 'backup_url', 'listenUrl', 'listen_url', 'musicUrl'];
    for (var i = 0; i < keys.length; i++) {
      var v = node[keys[i]];
      if (typeof v === 'string' && v.indexOf('http') === 0 && /\.(mp3|flac|m4a|aac|ogg|wav)([?#]|$)/i.test(v)) return v;
    }
    for (var k in node) {
      if (Object.prototype.hasOwnProperty.call(node, k)) {
        var v2 = node[k];
        if (typeof v2 === 'string' && v2.indexOf('http') === 0 && /\.(mp3|flac|m4a|aac|ogg|wav)([?#]|$)/i.test(v2)) return v2;
        if (typeof v2 === 'object') {
          var r = findUrl(v2, depth + 1);
          if (r) return r;
        }
      }
    }
    return null;
  }

  function extOf(url) {
    var m = String(url).match(/\.(mp3|flac|m4a|aac)([?#]|$)/i);
    return m ? m[1].toLowerCase() : 'mp3';
  }

  /* 单首歌换源: 依次尝试各源, 命中回调 cb(url, extra) */
  function trySource(songMeta, unm, srcIdx, cb) {
    if (srcIdx >= SOURCES.length) { cb(null); return; }
    var src = SOURCES[srcIdx];
    var kw = (songMeta.n + ' ' + (songMeta.a || '')).trim();
    var searchUrl = unm + '/search?source=' + encodeURIComponent(src) +
      '&key=' + encodeURIComponent(kw) + '&count=10&pages=1';
    httpGetJson(searchUrl, function (sj) {
      if (!sj) { trySource(songMeta, unm, srcIdx + 1, cb); return; }
      var arrays = [];
      findItemArrays(sj, arrays);
      var best = null, bestScore = -1;
      for (var a = 0; a < arrays.length; a++) {
        var arr = arrays[a];
        for (var i = 0; i < arr.length; i++) {
          var s = matchScore(arr[i], kw.toLowerCase(), songMeta.d || 0);
          if (s > bestScore) { bestScore = s; best = arr[i]; }
        }
      }
      if (!best) { trySource(songMeta, unm, srcIdx + 1, cb); return; }
      var songUrl = unm + '/song?source=' + encodeURIComponent(src) +
        '&id=' + encodeURIComponent(String(best.id));
      httpGetJson(songUrl, function (dj) {
        var url = dj ? findUrl(dj, 0) : null;
        if (url) cb({ url: url, source: src, size: normSize(best.size || best.fileSize), item: best });
        else trySource(songMeta, unm, srcIdx + 1, cb);
      });
    });
  }

  function normSize(v) {
    var n = typeof v === 'string' ? parseInt(v, 10) : v;
    return (typeof n === 'number' && isFinite(n) && n > 0) ? n : 0;
  }

  /* ================= 主流程 ================= */
  try {
    if (typeof $response === 'undefined' || $response === null || typeof CryptoJS === 'undefined') {
      $done({});
      return;
    }
    var args = pluginArgs();
    if (!argEnabled(args.netease_vip, true)) { $done({}); return; }
    var unm = (args.unm_url || args.unm || '').trim();
    if (unm && unescape(unm).indexOf('http') !== 0) unm = '';
    if (unm.charAt(unm.length - 1) === '/') unm = unm.slice(0, -1);

    var url = (typeof $request !== 'undefined' && $request && $request.url) ? $request.url : '';
    var isPlayerUrl = /\/eapi\/song\/enhance\/(player|download)\/url/.test(url);

    var info = { form: 'string' };
    var bytes = bodyToBytes($response.body, info);
    if (!bytes || bytes.length < 16 || bytes.length % 16 !== 0) { $done({}); return; }

    var dec = decryptBody(bytes);
    if (!dec) { $done({}); return; }

    var obj = null;
    try { obj = JSON.parse(dec.text); } catch (e) { $done({}); return; }
    if (obj === null || typeof obj !== 'object') { $done({}); return; }

    // 歌名缓存(供换源), 任何含歌曲对象的响应都收集
    var cacheMap = null;
    try {
      if (typeof $persistentStore !== 'undefined' && $persistentStore) {
        cacheMap = cacheLoad();
        var before = Object.keys(cacheMap).length;
        collectSongs(obj, cacheMap);
        if (Object.keys(cacheMap).length !== before) cacheSave(cacheMap);
      }
    } catch (e) {}

    if (!isPlayerUrl) {
      // 非播放 URL: privilege/试听字段修补
      if (!walkPatch(obj)) { $done({}); return; }
      doneWithJson(obj, dec.wasGzip, info);
      return;
    }

    /* ---- 播放/下载 URL: 检测试听 → 换源 → 替换/降级 ---- */
    var items = (obj && Array.isArray(obj.data)) ? obj.data : null;
    if (!items) {
      if (!walkPatch(obj)) { $done({}); return; }
      doneWithJson(obj, dec.wasGzip, info);
      return;
    }

    var pending = [];
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (!it || typeof it !== 'object') continue;
      var isTrial = false;
      for (var k = 0; k < TRIAL_KEYS.length; k++) {
        if (it[TRIAL_KEYS[k]] !== null && it[TRIAL_KEYS[k]] !== undefined) { isTrial = true; break; }
      }
      if (!it.url || it.code !== 200) isTrial = true; // 无 URL/失败码也走换源
      if (isTrial) pending.push(i);
    }
    if (pending.length === 0) { $done({}); return; } // 全部正常: 原样放行
    if (!unm || !cacheMap) {
      // 降级: 逐项置空试听字段 + payed 修补, 再全树 privilege 修补
      for (var d0 = 0; d0 < pending.length; d0++) {
        var dItem = items[pending[d0]];
        for (var d1 = 0; d1 < TRIAL_KEYS.length; d1++) {
          if (TRIAL_KEYS[d1] in dItem && dItem[TRIAL_KEYS[d1]] !== null) dItem[TRIAL_KEYS[d1]] = null;
        }
        if (dItem.payed === 0) dItem.payed = 1;
      }
      walkPatch(obj);
      console.warn(LOG_TAG + ' trial-cleared ' + pending.length + ' song(s) (未配置音源 API, 降级模式)');
      doneWithJson(obj, dec.wasGzip, info);
      return;
    }

    // 换源: 逐首处理(串行避免并发过载), 全部完成后统一返回
    var logInfo = [];
    (function next(idx) {
      if (idx >= pending.length) {
        for (var L = 0; L < logInfo.length; L++) console.warn(LOG_TAG + ' ' + logInfo[L]);
        doneWithJson(obj, dec.wasGzip, info);
        return;
      }
      var pos = pending[idx];
      var item = items[pos];
      var meta = cacheMap[String(item.id)] || null;
      if (!meta) {
        // 缓存无歌名: 降级处理该项
        for (var k2 = 0; k2 < TRIAL_KEYS.length; k2++) {
          if (TRIAL_KEYS[k2] in item && item[TRIAL_KEYS[k2]] !== null) item[TRIAL_KEYS[k2]] = null;
        }
        if (item.payed === 0) item.payed = 1;
        logInfo.push('trial-cleared id=' + item.id + ' (无歌名缓存, 降级)');
        next(idx + 1);
        return;
      }
      trySource(meta, unm, 0, function (res) {
        if (res && res.url) {
          item.url = res.url;
          item.code = 200;
          item.md5 = '';
          if (res.size) item.size = res.size;
          item.type = extOf(res.url).toUpperCase() === 'FLAC' ? 'flac' : extOf(res.url);
          if (meta.d) item.time = meta.d; // 完整时长(进度条按整曲显示)
          for (var k3 = 0; k3 < TRIAL_KEYS.length; k3++) {
            if (TRIAL_KEYS[k3] in item && item[TRIAL_KEYS[k3]] !== null) item[TRIAL_KEYS[k3]] = null;
          }
          if (item.payed === 0) item.payed = 1;
          if (item.fee === 1) item.fee = 0;
          logInfo.push('unlocked id=' + item.id + ' (' + meta.n + ' - ' + (meta.a || '?') +
            ') via ' + res.source + (res.size ? ' ' + res.size + 'B' : ''));
        } else {
          // 换源失败: 降级
          for (var k4 = 0; k4 < TRIAL_KEYS.length; k4++) {
            if (TRIAL_KEYS[k4] in item && item[TRIAL_KEYS[k4]] !== null) item[TRIAL_KEYS[k4]] = null;
          }
          if (item.payed === 0) item.payed = 1;
          logInfo.push('trial-cleared id=' + item.id + ' (' + meta.n + ') 换源未命中, 降级');
        }
        next(idx + 1);
      });
    })(0);
  } catch (e) {
    console.log(LOG_TAG + ' error: ' + e);
    $done({});
  }
})();
