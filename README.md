# onyx-media-save

Onyx Labs 媒體下載頁（繁中）：平台公開連結解析 + 任意網頁媒體挑選。

線上：`https://save.onyxlab.dev`（若 DNS 尚未接上，見 Vercel 專案網域）

## 模式

### A · 平台解析
貼 Instagram 公開 `/p/` `/reel/`、X、TikTok、YouTube 等公開連結 → 解析 → 多檔時可勾選下載。

- **私人／需登入**：明確拒絕，不實作登入繞過或 cookie session。
- 優先呼叫環境變數 `COBALT_API_URL`（可選 `COBALT_API_KEY`）的 Cobalt `POST /`。
- 無 Cobalt 時，Instagram 有公開 oEmbed／og 後備；其他平台需 Cobalt。

### B · 網頁媒體
貼一般 `https` URL → 伺服器抓 HTML → 抽出 `img`／`video`／`source`／`srcset`／`og:image`／常見懶加載屬性 → 預覽勾選下載。

- SSRF：只允許 http(s)、擋私網／metadata IP、限制大小與超時。
- 下載經同源 `/api/proxy`，校驗同站或允許的 CDN。
- 不跟登入牆、不帶使用者密碼、不破解付費牆。

## 環境變數

| 變數 | 必填 | 說明 |
|------|------|------|
| `COBALT_API_URL` | 建議 | 自架 Cobalt API 根網址，例如 `https://cobalt.example.com`（不要用官方有 bot 防護的公開 API） |
| `COBALT_API_KEY` | 否 | 若實例啟用 Api-Key，設為 `Authorization: Api-Key …` |

## 開發

```bash
npm install
npm run dev
```

## 限制與免責

- 僅供個人存檔；請遵守各站條款與著作權。
- 簡易 IP rate limit（約每分鐘 30 次／端點）。
- Instagram 等常擋資料中心 IP；雲端部署若解析失敗，請自架 Cobalt 並設定 `COBALT_API_URL`。
- 輪播／高畫質影片在無 Cobalt 時可能不完整。

## 品牌

Onyx Labs · [onyxlab.dev](https://onyxlab.dev)
