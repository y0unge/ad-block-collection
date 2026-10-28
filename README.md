# 去广告合集

Loon 去广告插件合集，包含**闲鱼**与**京东**的去广告插件。

## 插件一览

| 插件 | 覆盖范围 | 安装链接（Loon → 插件 → 从链接安装） |
| --- | --- | --- |
| **去广告合集** (AdBlockAll) | 闲鱼 + 京东，一键全装 | `https://raw.githubusercontent.com/y0unge/ad-block-collection/main/AdBlockAll.plugin` |
| **闲鱼去广告** (XianyuAdBlock) | 仅闲鱼 | `https://raw.githubusercontent.com/y0unge/ad-block-collection/main/XianyuAdBlock.plugin` |
| **京东去广告** (JDAdBlock) | 仅京东 | `https://raw.githubusercontent.com/y0unge/ad-block-collection/main/JDAdBlock.plugin` |

脚本（`XianyuAdBlock.js` / `JD_remove_ads.js`）已通过插件内远程地址引用，无需手动安装。

## 使用前提

1. Loon 已安装并信任 CA 证书（设置 → 证书 → 安装/信任）
2. 开启 Loon 的 **MITM** 总开关
3. 三选一安装上表中的插件链接即可

## 闲鱼去广告

基于闲鱼 **7.28.80 (com.taobao.fleamarket)** 脱壳 IPA 逆向分析，覆盖：

- **开屏广告**：`FishSplashAdManager` 经 `mtop.taobao.idlecommerce.splash.{ads,async.ads,config}` 拉取，请求失败（`onAdGetFail`）即不展示
- **信息流广告卡片**（首页/同城）：`fish_home_advertise_card_d3/d4`、`fish_local_advertise_card_d4`、`idlefish_local_feed2_marketing`、`fish_home_feeds_pager_banner`（DinamicX 模板名匹配，脚本从响应中剔除）
- **详情页推荐广告**：`detail_recommend_ad_card`
- **直播广告**：`mtop.taobao.idle.live.home.ads.material.get`
- **小游戏/互动激励广告**：`game.iaa.ads` 等（看广告得奖励类，如需保留可删插件内对应行）
- **鱼塘弹窗**：`mtop.taobao.idle.fishpool.poplayerinfo`
- **广告上报拦截**：`mtop.idle.ad.{click,expose}`、`mtop.ali.ad.settle.*`、Tanx/广点通/穿山甲等广告域名

如需过滤首页顶部运营 Banner，可在 `XianyuAdBlock.js` 的 `AD_MARKERS` 中加入 `fish_home_banner`。

## 京东去广告

整合自 [aoconch/jd-loon-remove-recommend](https://github.com/aoconch/jd-loon-remove-recommend)，并基于京东 **16.1.80 脱壳 IPA 逆向**与抓包分析大幅增强，覆盖：

- **开屏广告**：`functionId=start` 响应清理（`images`/`showTimesDaily`/`startADImage`，含 POST body 传参通道）
- **QUIC 旁路拦截**：京东 Cronet 网络栈可走 QUIC（`quic-api.m.jd.com`，UDP443）完全绕过 MITM，导致开屏偶发漏网；拦截后强制回退 TCP
- **POST body 通道拦截**：京东新网络栈（JDNetworkBaseAF）将 functionId 序列化进 POST body（URL 为光秃的 `/client.action?`），URL 匹配对其无效；请求侧脚本读取 body 拦截纯广告接口（`queryPagePopWindow`/`babelGetGuideTips`/`secondFloor`/`searchBoxWord`/`uniformRecommend` 等）
- **API 网关域名全覆盖**（UnitRouter 机制）：`api`/`api-q`/`squnit-api`/`quic-api.m.jd.com`、`api-ai`/`squnit-api-ai.jd.com`
- **推荐流**：`uniformRecommend` 直接返回空包
- **推荐楼层**：首页 `welcomeHome`、购物车、订单 `myOrderInfo`、个人页 `personinfoBusiness`、物流 `deliverLayer` 等楼层按 mId/标题递归清理（`deepScrub`）
- **弹窗**：`commonPopup` / `floatLayer` 等
- **埋点上报**：`mars.jd.com` 等 18 个埋点/统计/监控域名 REJECT（抓包 717 条请求中约 340 条）
- **观测日志**：Loon 日志搜索 `[JD-FID]` 可见全部 functionId 流水（Warning 级），便于排查漏网接口

整合增强（基于 IPA 逆向）：

1. `startADImage` 开屏广告单图字段清理（16.1.80 IPA 发现）
2. Script 使用 Loon 3.5.1(983)+ 新语法（实测旧语法 `http-request` 在部分环境不触发）
3. 修复原脚本空响应时的双 `$done` 问题
4. QUIC/UDP 拦截规则与埋点域名屏蔽

## 致谢

- [aoconch](https://github.com/aoconch) — 京东去推荐插件与脚本原作者

## 免责声明

本项目仅供学习交流逆向分析与网络代理技术使用，不得用于任何商业用途；请于下载后 24 小时内删除。使用本项目所产生的任何后果由使用者自行承担。
