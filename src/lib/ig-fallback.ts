import type { MediaItem } from "./types";
import { assertPublicHttpUrl, FETCH_TIMEOUT_MS, MAX_HTML_BYTES } from "./ssrf";

function extractMeta(html: string, prop: string): string | null {
  const re = new RegExp(
    `<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']+)["']`,
    "i"
  );
  const re2 = new RegExp(
    `content=["']([^"']+)["'][^>]+(?:property|name)=["']${prop}["']`,
    "i"
  );
  return html.match(re)?.[1] || html.match(re2)?.[1] || null;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

export function isInstagramUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return /(^|\.)instagram\.com$/i.test(u.hostname);
  } catch {
    return false;
  }
}

export function isLikelyPrivatePage(html: string): boolean {
  const lower = html.toLowerCase();
  return (
    lower.includes("this account is private") ||
    lower.includes("這是私人帳號") ||
    lower.includes("這是私密帳號") ||
    lower.includes('"is_private":true') ||
    lower.includes("login_required") ||
    (lower.includes("/accounts/login") && lower.includes("og:description") === false)
  );
}

/** Public IG post/reel via oEmbed + page og tags. No login/session. */
export async function resolveInstagramPublic(url: string): Promise<MediaItem[]> {
  const pageUrl = await assertPublicHttpUrl(url);
  if (!/\/(p|reel|reels|tv)\//i.test(pageUrl.pathname)) {
    throw new Error("請貼 Instagram 公開貼文／Reel 連結（/p/ 或 /reel/）");
  }

  const items: MediaItem[] = [];

  // oEmbed (public posts only)
  try {
    const oembed = new URL("https://www.instagram.com/api/v1/oembed");
    oembed.searchParams.set("url", pageUrl.toString());
    const oRes = await fetch(oembed, {
      headers: { "User-Agent": "OnyxLabsMediaSave/1.0" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (oRes.ok) {
      const data = (await oRes.json()) as {
        thumbnail_url?: string;
        title?: string;
        author_name?: string;
      };
      if (data.thumbnail_url) {
        items.push({
          id: "ig-oembed-thumb",
          url: data.thumbnail_url,
          kind: "image",
          title: data.title || data.author_name || "Instagram 預覽圖",
          thumbnail: data.thumbnail_url,
          source: "instagram-oembed",
        });
      }
    }
  } catch {
    // continue to HTML scrape
  }

  const res = await fetch(pageUrl.toString(), {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; OnyxLabsMediaSave/1.0; +https://onyxlab.dev)",
      Accept: "text/html,application/xhtml+xml",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (res.status === 401 || res.status === 403) {
    throw new Error(
      "Instagram 拒絕此伺服器存取（常見於雲端 IP）。請設定 COBALT_API_URL 自架 Cobalt，或稍後再試。"
    );
  }
  if (!res.ok) {
    throw new Error(`無法讀取 Instagram 頁面（HTTP ${res.status}）`);
  }

  const reader = res.body?.getReader();
  if (!reader) throw new Error("無法讀取回應");
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > MAX_HTML_BYTES) {
      reader.cancel().catch(() => {});
      break;
    }
    chunks.push(value);
  }
  const html = new TextDecoder("utf-8").decode(Buffer.concat(chunks.map((c) => Buffer.from(c))));

  if (isLikelyPrivatePage(html)) {
    throw new Error("這似乎是私人／需登入內容，本服務不支援");
  }

  const ogVideo = extractMeta(html, "og:video") || extractMeta(html, "og:video:secure_url");
  const ogImage = extractMeta(html, "og:image");
  const ogTitle = extractMeta(html, "og:title");

  if (ogVideo) {
    items.push({
      id: "ig-og-video",
      url: decodeEntities(ogVideo),
      kind: "video",
      title: ogTitle ? decodeEntities(ogTitle) : "Instagram 影片",
      thumbnail: ogImage ? decodeEntities(ogImage) : undefined,
      source: "instagram-og",
    });
  } else if (ogImage) {
    const img = decodeEntities(ogImage);
    if (!items.some((i) => i.url === img)) {
      items.push({
        id: "ig-og-image",
        url: img,
        kind: "image",
        title: ogTitle ? decodeEntities(ogTitle) : "Instagram 圖片",
        thumbnail: img,
        source: "instagram-og",
      });
    }
  }

  if (!items.length) {
    throw new Error(
      "未能從公開頁面抽出媒體。可能被 Instagram 擋 IP，或內容非公開。建議設定 COBALT_API_URL。"
    );
  }
  return items;
}
