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

整合自 [aoconch/jd-loon-remove-recommend](https://github.com/aoconch/jd-loon-remove-recommend)，覆盖：

- **开屏广告**：`functionId=start` 响应中的启动图列表
- **推荐流**：`uniformRecommend` 直接返回空包
- **推荐楼层**：首页 `welcomeHome`、购物车、订单 `myOrderInfo`、个人页 `personinfoBusiness`、物流 `deliverLayer` 等楼层按 mId/标题递归清理
- **弹窗**：`commonPopup` / `floatLayer` 等

整合时的适配（其余逻辑保持原样）：

1. 脚本内置为仓库远程地址，安装即用
2. `reject-200`（QuantumultX 语法）改为 Loon 支持的 `reject-dict`
3. 移除上游脚本中每个请求都弹出系统通知的调试代码

## 致谢

- [aoconch](https://github.com/aoconch) — 京东去推荐插件与脚本原作者

## 免责声明

本项目仅供学习交流逆向分析与网络代理技术使用，不得用于任何商业用途；请于下载后 24 小时内删除。使用本项目所产生的任何后果由使用者自行承担。
