# 红旗粉丝家年华 - 拍摄专场报名小程序

Cloudflare Pages 全栈部署（Pages Functions + D1 SQLite）。

## 文件结构

```
index.html              # 主页面（报名/签到/看板/后台）
jsQR.js                 # 网页内扫码库
sw.js                   # Service Worker（离线缓存）
functions/
  api/
    health.js          # GET /api/health（健康检查）
    records.js         # GET/POST /api/records（报名 CRUD）
    visit_log.js       # GET/POST /api/visit_log（签到流水）
```

## Cloudflare Pages 部署

1. Connect to Git → 选这个 repo
2. Build command: **留空**
3. Build output directory: **留空**
4. 添加 D1 binding：Settings → Functions → D1 database bindings
   - Variable name: `DB`（大写）
   - D1 database: `hongqi-gala-db`

## 活动日期

2026 年 8 月 12 日 - 8 月 15 日

## 主办

红旗品牌