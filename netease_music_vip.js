/*
 * 网易云音乐 VIP 解锁 —— eapi 响应改写脚本 (Loon)
 *
 * 逆向依据: com.netease.cloudmusic 9.6.15 脱壳 IPA
 *   - eapi 响应体 = 原始 AES-128-ECB 密文, 密钥 "e82ckenh8dichen8"
 *     (CloudMusicCoSDK decrypt:type:, IMP 0x1017535f4 → 0x10175cecc → 0x10175cb14)
 *   - 去填充规则: 末字节即填充长度(1..16)
 *   - VIP 试听裁剪是客户端行为: /eapi/song/enhance/player/url(/v1) 响应
 *     data[].freeTrialInfo{start,end} 之外, url 即完整音频文件
 *     (NMSongUrlInfo fillWithDictionary: 解析该字段, NMCoreModel)
 *   - decrypt:type: 对 len%16!=0 的体直接原样放行(0x10175cb38 处 tst x2,#0xf),
 *     因此改写后的 JSON 以纯文本返回, 尾部补空格避开 16 对齐即可, 无需重加密
 *
 * 插件参数: [Argument] netease_vip = boolean,...  (是否解锁 VIP 歌曲)
 *   合集插件默认 false(去广告用户按需开启), 独立插件默认 true;
 *   关闭时本脚本直接放行, 不做任何解密/改写。
 *
 * 策略: 解密 → 递归清理试听字段 + patch privilege → 纯 JSON 返回;
 *       任何环节失败(参数关闭/非 eapi 密文/解析失败/无改动)一律 $done({})
 *       原样放行, 绝不破坏正常响应。
 */

(function () {
  'use strict';

  var EAPI_KEY = 'e82ckenh8dichen8';
  var LOG_TAG = '[NM-VIP]';
  var TRIAL_KEYS = ['freeTrialInfo', 'freeTrialPrivilege', 'freeTimeTrialPrivilege'];

  /* ---------- 插件参数 ----------
   * $argument 兼容对象/JSON字符串两种形态; 参数缺失时默认开启
   * (Loon 会把 [Argument] 定义值传入, 合集插件默认 false 由插件侧控制)。 */
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

  /* ---------- body → Uint8Array ----------
   * binary-body-mode 下 Loon 可能以 数组/Uint8Array/二进制字符串 之一给 body,
   * 全部归一化; 字符串按 charCode&0xff 取字节(latin1 语义, 兼容二进制串)。
   * 同时记录输入形态, 输出时按同形态返回, 最大化兼容。 */
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

  /* ---------- 字节 ↔ CryptoJS WordArray ---------- */
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

  /* ---------- 手工 UTF-8 解码 (JSC 无 TextDecoder) ---------- */
  function utf8Decode(bytes, end) {
    var s = '';
    var i = 0;
    while (i < end) {
      var b = bytes[i];
      if (b < 0x80) {
        s += String.fromCharCode(b);
        i += 1;
      } else if (b < 0xC0) {
        i += 1; // 孤立续字节, 跳过
      } else if (b < 0xE0) {
        s += String.fromCharCode(((b & 0x1F) << 6) | (bytes[i + 1] & 0x3F));
        i += 2;
      } else if (b < 0xF0) {
        s += String.fromCharCode(((b & 0x0F) << 12) | ((bytes[i + 1] & 0x3F) << 6) | (bytes[i + 2] & 0x3F));
        i += 3;
      } else {
        var cp = ((b & 0x07) << 18) | ((bytes[i + 1] & 0x3F) << 12) | ((bytes[i + 2] & 0x3F) << 6) | (bytes[i + 3] & 0x3F);
        cp -= 0x10000;
        s += String.fromCharCode(0xD800 + (cp >> 10), 0xDC00 + (cp & 0x3FF));
        i += 4;
      }
    }
    return s;
  }

  /* ---------- eapi 响应解密: AES-128-ECB(NoPadding) + 去填充 ---------- */
  function eapiDecrypt(bytes) {
    var params = CryptoJS.lib.CipherParams
      ? CryptoJS.lib.CipherParams.create({ ciphertext: bytesToWordArray(bytes) })
      : { ciphertext: bytesToWordArray(bytes) };
    var wa = CryptoJS.AES.decrypt(
      params,
      CryptoJS.enc.Utf8.parse(EAPI_KEY),
      { mode: CryptoJS.mode.ECB, padding: CryptoJS.pad.NoPadding }
    );
    var pt = wordArrayToBytes(wa);
    if (pt.length === 0) return null;
    var end = pt.length;
    var last = pt[end - 1];
    // 客户端去填充规则: 末字节 = 填充长度 (JSON 必以 '}' 结尾, 不会误判)
    if (last >= 1 && last <= 16 && last <= end) end -= last;
    // 兜底: 服务端零填充时剥掉尾部 NUL
    while (end > 0 && pt[end - 1] === 0) end--;
    return utf8Decode(pt, end);
  }

  /* ---------- privilege 判定与修补 ---------- */
  function isPrivilege(o) {
    return o !== null && typeof o === 'object' && !Array.isArray(o) &&
      ('pl' in o) && ('dl' in o) && ('st' in o);
  }

  function patchPrivilege(p) {
    var changed = false;
    if (p.payed === 0) { p.payed = 1; changed = true; }
    if (!p.pl || p.pl <= 0) { p.pl = 320000; changed = true; }
    if (!p.dl || p.dl <= 0) { p.dl = 320000; changed = true; }
    if (p.st < 0) { p.st = 0; changed = true; }          // 灰色/无版权歌曲一并放开
    if (p.cs === true) { p.cs = false; changed = true; }
    return changed;
  }

  /* ---------- 递归改写, 返回是否发生改动 ---------- */
  function walk(node) {
    if (node === null || typeof node !== 'object') return false;
    if (Array.isArray(node)) {
      var c1 = false;
      for (var i = 0; i < node.length; i++) c1 = walk(node[i]) || c1;
      return c1;
    }
    var changed = false;
    if (isPrivilege(node)) changed = patchPrivilege(node) || changed;
    for (var k = 0; k < TRIAL_KEYS.length; k++) {
      var key = TRIAL_KEYS[k];
      if (key in node && node[key] !== null) {
        node[key] = null;
        changed = true;
      }
    }
    for (var name in node) {
      if (node.hasOwnProperty(name) && TRIAL_KEYS.indexOf(name) === -1) {
        changed = walk(node[name]) || changed;
      }
    }
    return changed;
  }

  /* ---------- UTF-8 字节长度 (返回体需保证非 16 对齐) ---------- */
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

  /* ---------- 字符串 → UTF-8 字节数组 ---------- */
  function utf8Encode(s) {
    var bytes = [];
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c < 0x80) {
        bytes.push(c);
      } else if (c < 0x800) {
        bytes.push(0xC0 | (c >> 6), 0x80 | (c & 0x3F));
      } else if (c >= 0xD800 && c <= 0xDBFF && i + 1 < s.length) {
        var lo = s.charCodeAt(i + 1);
        var cp = 0x10000 + ((c - 0xD800) << 10) + (lo - 0xDC00);
        bytes.push(0xF0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3F), 0x80 | ((cp >> 6) & 0x3F), 0x80 | (cp & 0x3F));
        i++;
      } else {
        bytes.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 0x3F), 0x80 | (c & 0x3F));
      }
    }
    return bytes;
  }

  /* ================= 主流程 ================= */
  try {
    if (typeof $response === 'undefined' || $response === null || typeof CryptoJS === 'undefined') {
      $done({});
      return;
    }

    // 插件参数开关: 关闭时直接放行(不解密、不解析, 零开销)
    var args = pluginArgs();
    if (!argEnabled(args.netease_vip, true)) {
      $done({});
      return;
    }

    var info = { form: 'string' };
    var bytes = bodyToBytes($response.body, info);
    // 非 eapi 密文(长度非 16 倍数)或空体: 原样放行
    if (!bytes || bytes.length < 16 || bytes.length % 16 !== 0) {
      $done({});
      return;
    }

    var text = eapiDecrypt(bytes);
    if (!text) {
      $done({});
      return;
    }

    var obj = null;
    try {
      obj = JSON.parse(text);
    } catch (e) {
      // 解密产物不是合法 JSON → 不是 eapi 密文, 放行
      $done({});
      return;
    }
    if (obj === null || typeof obj !== 'object') {
      $done({});
      return;
    }

    if (!walk(obj)) {
      // 无试听字段、无待修补 privilege: 原样放行, 保留原始密文
      $done({});
      return;
    }

    var out = JSON.stringify(obj);
    // 纯 JSON 返回: 客户端对 len%16!=0 的体解密失败后原样回退解析
    // (二进制 0x10175cb38 处验证), 补空格保证 UTF-8 字节长度非 16 对齐
    while (utf8ByteLength(out) % 16 === 0) out += ' ';

    var url = (typeof $request !== 'undefined' && $request && $request.url) ? $request.url : '';
    var m = url.match(/\/eapi\/([^?]+)/);
    console.warn(LOG_TAG + ' patched ' + (m ? m[1] : url.slice(0, 80)));

    // 按输入形态返回: 二进制模式进什么就回什么, 避免兼容性问题
    if (info.form === 'array') {
      $done({ body: utf8Encode(out) });
    } else if (info.form === 'uint8') {
      $done({ body: new Uint8Array(utf8Encode(out)) });
    } else {
      $done({ body: out });
    }
  } catch (e) {
    console.log(LOG_TAG + ' error: ' + e);
    $done({});
  }
})();
