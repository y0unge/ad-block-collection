# 去广告合集

Loon 去广告插件合集，包含**闲鱼**、**京东**、**广汽传祺**的去广告插件与**网易云音乐** VIP 解锁插件。

## 插件一览

| 插件 | 覆盖范围 | 安装链接（Loon → 插件 → 从链接安装） |
| --- | --- | --- |
| **去广告合集** (AdBlockAll) | 闲鱼 + 京东 + 传祺 + 网易云（VIP 解锁默认开启，参数中可关闭） | `https://raw.githubusercontent.com/y0unge/ad-block-collection/main/AdBlockAll.plugin` |
| **闲鱼去广告** (XianyuAdBlock) | 仅闲鱼 | `https://raw.githubusercontent.com/y0unge/ad-block-collection/main/XianyuAdBlock.plugin` |
| **京东去广告** (JDAdBlock) | 仅京东 | `https://raw.githubusercontent.com/y0unge/ad-block-collection/main/JDAdBlock.plugin` |
| **传祺去广告** (TrumpchiAdBlock) | 仅广汽传祺 | `https://raw.githubusercontent.com/y0unge/ad-block-collection/main/TrumpchiAdBlock.plugin` |
| **网易云音乐 VIP 解锁** (NeteaseMusicVIP) | 仅网易云（默认开启，参数中可关闭） | `https://raw.githubusercontent.com/y0unge/ad-block-collection/main/NeteaseMusicVIP.plugin` |

脚本（`XianyuAdBlock.js` / `JD_remove_ads.js` / `netease_music_vip.js` 等）已通过插件内远程地址引用，无需手动安装。

## 使用前提

1. Loon 已安装并信任 CA 证书（设置 → 证书 → 安装/信任）
2. 开启 Loon 的 **MITM** 总开关
3. 按需安装上表中的插件链接（合集一键全装，或单项插件）

## 闲鱼去广告

基于闲鱼 **7.28.80 (com.taobao.fleamarket)** 脱壳 IPA 逆向分析，覆盖：

- **网关迁移适配（2026-10-29 抓包发现）**：闲鱼 mtop 网关已整体迁移至 `acs.m.goofish.com` / `g-acs.m.goofish.com`（92/92 条业务请求，含 `splash.async.ads` 开屏接口），旧 `*.m.taobao.com` 网关域名已不再承载闲鱼流量。脚本 URL 正则匹配任意 host 无需改动，`[MITM]` 列表已加入新网关域名，旧域名保留兼容

- **开屏广告**：`FishSplashAdManager` 经 `mtop.taobao.idlecommerce.splash.{ads,async.ads,config}` 拉取。采用**响应篡改**（`XianyuSplashFix.js`）：递归把响应中每日展示次数类字段（`maxShowCount`/`leftShowCount`/`showTimes*` 等按正则匹配，字段名无关）归零、广告开关置 false、素材列表清空，App 业务层判定"今日无可展示次数"主动跳过开屏——相比 reject 不会触发联盟兜底、素材重试与缓存展示（与京东 `showTimesDaily=0` 同思路）
- **信息流广告卡片**（首页/同城）：`fish_home_advertise_card_d3/d4`、`fish_local_advertise_card_d4`、`idlefish_local_feed2_marketing`、`fish_home_feeds_pager_banner`（DinamicX 模板名匹配，脚本从响应中剔除）
- **详情页推荐广告**：`detail_recommend_ad_card`
- **直播广告**：`mtop.taobao.idle.live.home.ads.material.get`
- **小游戏/互动激励广告**：`game.iaa.ads` 等（看广告得奖励类，如需保留可删插件内对应行）
- **鱼塘弹窗**：`mtop.taobao.idle.fishpool.poplayerinfo`
- **广告上报拦截**：`mtop.idle.ad.{click,expose}`、`mtop.ali.ad.settle.*`、Tanx/广点通/穿山甲等广告域名
- **联盟开屏兜底通道拦截**：Fanti 广告SDK（优酷/阿里文娱联盟，`ssp.iytcdn.com`，含 `ft_ad_splash_enable_key` 开屏开关与 `union/api/ps` 广告请求）与 BeiZi 聚合 SDK（`bid.ad-scope.com.cn` s2s 竞价、`sdk.beizi.biz`）。自有 mtop 开屏被拦截后，App 会经这两条联盟通道兜底拉取开屏，且素材/配置会缓存到本地（展示时无网络请求），属"偶发一次、日志无记录"的漏网来源

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
- **观测日志**：Loon 日志搜索 `[JD-FID]` 可见拦截/清理命中流水（Warning 级）；需要全量流水排查时把脚本内 `DEBUG` 置为 `true`

整合增强（基于 IPA 逆向）：

1. `startADImage` 开屏广告单图字段清理（16.1.80 IPA 发现）
2. Script 使用 Loon 3.5.1(983)+ 新语法（实测旧语法 `http-request` 在部分环境不触发）
3. 修复原脚本空响应时的双 `$done` 问题（含 uniformRecommend 分支缺 return 的全量空转）
4. QUIC/UDP 拦截规则与埋点域名屏蔽
5. 低耗电优化（详见下文「低耗电优化」一节）

## 传祺去广告

基于广汽传祺 App **6.2.0 (com.cloudyoung.TrumpchiCarSalesDev)** 脱壳 IPA 逆向分析，覆盖：

- **开屏广告**：App 启动时 `checkPostOrAdvertiseForOpenPageWithModel:` 展示"帖子或广告"开屏页，广告数据统一走 `/app-api/baseinfo/advertise/getAdvertiseByPositionCode`（全 App 广告位数据源），拦截后无广告可展示；抓包确认 `positionCode=1` 为开屏广告、`82` 为首页右下悬浮广告。**采用响应篡改**（`TrumpchiSplashFix.js` 返回 `{"data":[],"resultCode":"0"}`，业务层主动跳过），而非 reject——避免 App 按接口失败处理走本地缓存/兜底展示（与闲鱼 `XianyuSplashFix.js` 同一教训）；Loon 日志搜 `[GAC-AD]` 可观测命中
- **开屏弹窗开关**：`/app-api/baseinfo/advertise/isalert`
- **登录页开屏视频/封面**：`/app-api/login/getLoginVideoAndCover`
- **页面广告**：首页右下角悬浮（`rightBtmAdModel`）、游戏（`gameAdModel`）、PK（`pkAdModel`）、签到页（`signAdvertiseModel`）、推荐（`recommendModel`）——均为 `YYAdvertiseModel`，随广告位数据源一并切断
- **运营弹窗**：`/app-api/car/activity/v2/popup`、车控学堂任务弹窗 `/car-api/leopard/school/home/taskPopup`、运动弹窗 `/car-api/vcontrol/sport/avpopup`、车控端弹窗文本 `selectPopupText`
- **Banner**：社区/商圈/商城/车控/充电服务 `bannerlist` 系列接口（充电服务路径较通用，已限定广汽域名避免误伤其他 App）
- **埋点上报拦截**：神策（`gets.gacmotor.com:8443/sa`）、友盟（`ulogs/cnlogs/alogsus/alogus.umeng.com`、`log.umsns.com` 等）、阿里 UT（`h-adashx.ut.taobao.com`）、EMAS（`adash.man.aliyuncs.com`）、字节 RangersAppLog（`volceapplog.com`）、高德日志（`logs.amap.com`，地图/定位功能域名不受影响）
- **广告素材 CDN**：华为 Ads（`cdn.adscloud.huawei.com(.cn)`）
- **MITM 通配**：`*.gacmotor.com`、`*.gacne.com.cn`、`*.gace.com.cn`，覆盖生产/预发/测试环境域名（该包为 Dev 构建，可能连测试环境）

**网关前缀修复（生产抓包发现）**：生产环境 API 经网关路由时路径带模块前缀（`next.gacmotor.com/app/app-api/...`、`/mall/content-app/...`），与 IPA 内的裸路径（`/app-api/...`）不同，导致首版规则全部漏网。现所有 Rewrite 规则已用 `(?:[a-z0-9\-]+\/)*` 通配任意层网关前缀，两种路径形态均可命中。

**仍见开屏的排查提示**：若更新插件后仍偶见开屏，依次确认——1) Loon 中插件已是最新版（插件详情看日期/重新安装）；2) MITM 总开关开启且已信任 CA 证书；3) Loon 日志搜 `[GAC-AD]`，命中说明脚本在生效，未命中则说明请求未走 MITM（检查是否被其他规则直连/分流）；4) 杀掉 App 重启验证（App 可能把开屏素材缓存到本地，接口被拦后短时间内仍可能展示一次缓存素材）。

## 网易云音乐 VIP 解锁

基于网易云音乐 **9.6.15 (com.netease.cloudmusic)** 脱壳 IPA 逆向分析（eapi 协议级），合集与独立插件中**均默认开启**，均可在插件「参数」中切换（`netease_vip` 布尔开关；关闭时脚本直接放行，不解密、零开销）：

- **eapi 协议**（`NEExtensionEncryptor` / `CloudMusicCoSDK`）：API 路径 `/api/...` → `/eapi/...`；请求体为 `AES-128-ECB` 加密后的大写 hex（`params=<HEX>`）；**响应体为原始 AES-128-ECB 密文**（非 hex），密钥 `e82ckenh8dichen8`——参数经「UTF-16 交错 base64 + 主密钥 `5f5f666f7e77420f1e2f42576e07223f` AES 二级封装」隐藏于 `__TEXT.__const`，需两级解包才得到 `-36cd479b6b5-` / `nobody` / `use` / `md5forencrypt` 与密钥本体
- **VIP 限制的本质是客户端裁剪**：`/eapi/song/enhance/player/url(/v1)` 响应中 `freeTrialInfo{start,end}` 标记 30 秒试听窗口（`NMSongUrlInfo fillWithDictionary:` 解析），**URL 本身就是完整音频文件**——脚本解密后将 `freeTrialInfo/freeTrialPrivilege/freeTimeTrialPrivilege` 置空即整曲播放；同时递归 patch `privilege`（`payed/pl/dl/st`，灰色歌曲一并放开），使 VIP 歌曲点击直接进入播放流程
- **免重加密的返回技巧**：客户端 `decrypt:type:` 对 `len%16!=0` 的响应体解密直接失败并原样放行（`0x10175cb38` 处 `tst x2,#0xf`），上层照常走 JSON 解析——脚本把改写后的 JSON 以纯文本返回、尾部补空格避开 16 字节对齐即可，无需重新 AES 加密，也绕开代理脚本二进制回写的兼容性问题
- **覆盖接口**：播放/下载 URL（核心）、`song/enhance/privilege`、`v3/song/detail`、`v3|v6/playlist/detail`、`cloudsearch/search`、每日推荐、`batch` 聚合、心动模式；MITM 仅 API 域（`music.163.com, *.music.163.com`，音频文件走 `music.126.net` CDN 不解密）
- **安全性**：任何环节失败（参数关闭 / 非 eapi 密文 / 解密乱码 / JSON 解析失败 / 无改动）一律 `$done({})` 原样放行，绝不破坏正常响应；命中时 Loon 日志输出 `[NM-VIP] patched <接口>`

> 本功能仅用于逆向学习与协议研究演示，请支持正版，付费收听你喜欢的音乐。

## 低耗电优化

为降低 Loon 常驻时的 CPU / DNS / 日志开销（**去广告效果不变**）：

- **移除观测 DNS 查询**：京东两个脚本原先每个请求各发一次 `<tag>.jddebug.com` 必超时 DNS 查询（每会话数百个超时重试定时器 + UDP 包 + Warn 日志），已全部移除；`[JD-FID]` 改为仅在命中拦截/清理时输出（脚本内 `DEBUG=true` 可恢复全量流水排查）
- **响应快速预检**：`JD_remove_ads.js` 解析前对原始响应做单次特征扫描，非专项 fid 且无黑名单 mId / 推荐标题特征时直接放行，跳过 JSON 解析、递归清理与再序列化（此类响应 deepScrub 必然是空操作）
- **uniformRecommend 提前返回**：命中空包后立即结束（实测该路径 ~2x），不再空转全量解析与递归清理，并修复双 `$done`
- **闲鱼脚本瘦身**：响应不含任何广告卡片模板特征时直接放行（零解析）；嵌套 JSON 字符串仅在自身含特征时才二次解析；原地修改代替整棵对象树重建
- **MITM 收窄**：京东侧仅保留有 Rewrite/Script 实际命中的域名（`mars`/`policy` 已 REJECT 无需解密，`api`/`routine`/`color`/`waapdg` 无规则引用）；闲鱼 mtop 网关与传祺通配保持不变（收窄会漏广告）；网易云仅 API 域（音频文件 CDN 不解密）
- **开屏改响应篡改**：闲鱼/传祺开屏走"频控归零/成功但无广告"响应篡改而非 reject，避免触发联盟兜底、素材重试与缓存展示（重试风暴本身就是耗电来源）
- **网易云解锁零开销关闭态**：`netease_vip` 关闭时脚本在参数检查处直接 `$done({})` 放行，不做任何解密/解析；开启后仅在命中 eapi 播放相关接口时解密，且无改动（非 VIP 歌曲）时也原样放行不重序列化

注意：插件内脚本为 GitHub 远程引用，本仓库文件更新后需推送到远程才会在 Loon 生效。

## 致谢

- [aoconch](https://github.com/aoconch) — 京东去推荐插件与脚本原作者

## 免责声明

本项目仅供学习交流逆向分析与网络代理技术使用，不得用于任何商业用途；请于下载后 24 小时内删除。使用本项目所产生的任何后果由使用者自行承担。
