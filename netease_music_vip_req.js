/*
 * 网易云音乐 VIP 解锁 —— eapi 请求侧脚本 (Loon http-request)
 *
 * 作用: 把 eapi 请求的 Accept-Encoding 改为 identity, 让服务器返回
 * 未经 gzip 压缩的 AES 密文(纯 AES(JSON)), 响应侧脚本因此无需处理 gzip,
 * 改写后的响应也可直接以纯 JSON 返回(客户端对 len%16!=0 的体解密失败
 * 会原样放行, 已在二进制 0x10175cb38 验证)。
 *
 * 实测依据: 网关响应带 vary: Accept-Encoding, identity 请求返回
 * content-encoding 无头的 AES(JSON)。
 *
 * 关闭开关(netease_vip=false)时直接放行, 零开销。
 */

(function () {
  'use strict';

  try {
    if (typeof $argument !== 'undefined' && $argument !== null) {
      var args = $argument;
      if (typeof args === 'string') {
        try { args = JSON.parse(args); } catch (e) { args = {}; }
      }
      var v = args ? args.netease_vip : undefined;
      if (v === false || String(v).toLowerCase() === 'false' || v === 0 || String(v) === '0') {
        $done({});
        return;
      }
    }

    var h = $request.headers || {};
    for (var k in h) {
      if (Object.prototype.hasOwnProperty.call(h, k) && k.toLowerCase() === 'accept-encoding') {
        delete h[k];
      }
    }
    h['Accept-Encoding'] = 'identity';
    $done({ headers: h });
  } catch (e) {
    $done({});
  }
})();
