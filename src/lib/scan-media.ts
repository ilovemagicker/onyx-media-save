import type { MediaItem } from "./types";
import {
  assertPublicHttpUrl,
  FETCH_TIMEOUT_MS,
  MAX_HTML_BYTES,
  sameSiteOrCdn,
} from "./ssrf";

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function absUrl(base: string, maybe: string): string | null {
  try {
    return new URL(decodeEntities(maybe.trim()), base).toString();
  } catch {
    return null;
  }
}

function guessKind(url: string, tagHint?: string): MediaItem["kind"] {
  if (tagHint === "video" || tagHint === "source-video") return "video";
  if (tagHint === "audio" || tagHint === "source-audio") return "audio";
  const path = url.toLowerCase().split("?")[0];
  if (/\.(mp4|webm|mov|m4v|m3u8)$/.test(path)) return "video";
  if (/\.(mp3|m4a|aac|ogg|wav|opus)$/.test(path)) return "audio";
  if (/\.(jpe?g|png|webp|gif|avif|svg)$/.test(path)) return "image";
  return tagHint === "img" ? "image" : "unknown";
}

function pushUnique(
  map: Map<string, MediaItem>,
  pageUrl: string,
  url: string,
  kind: MediaItem["kind"],
  title?: string
) {
  if (!sameSiteOrCdn(pageUrl, url)) return;
  if (map.has(url)) return;
  if (url.startsWith("data:")) return;
  map.set(url, {
    id: `m-${map.size + 1}`,
    url,
    kind,
    title,
    thumbnail: kind === "image" ? url : undefined,
    source: "webpage",
  });
}

function parseSrcset(base: string, srcset: string): string[] {
  return srcset
    .split(",")
    .map((part) => part.trim().split(/\s+/)[0])
    .map((u) => absUrl(base, u))
    .filter((u): u is string => !!u);
}

export async function scanWebpageMedia(rawUrl: string): Promise<{
  pageUrl: string;
  items: MediaItem[];
  truncated: boolean;
}> {
  const page = await assertPublicHttpUrl(rawUrl);
  const res = await fetch(page.toString(), {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; OnyxLabsMediaSave/1.0; +https://onyxlab.dev)",
      Accept: "text/html,application/xhtml+xml",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  // Re-check final URL after redirects
  const finalUrl = res.url || page.toString();
  await assertPublicHttpUrl(finalUrl);

  if (res.status === 401 || res.status === 403) {
    throw new Error("此頁面需要登入或拒絕存取，本服務不支援繞過");
  }
  if (!res.ok) throw new Error(`無法抓取頁面（HTTP ${res.status}）`);

  const ctype = res.headers.get("content-type") || "";
  if (!ctype.includes("text/html") && !ctype.includes("application/xhtml")) {
    throw new Error("目標不是 HTML 網頁");
  }

  const reader = res.body?.getReader();
  if (!reader) throw new Error("無法讀取回應");
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > MAX_HTML_BYTES) {
      truncated = true;
      reader.cancel().catch(() => {});
      break;
    }
    chunks.push(value);
  }
  const html = new TextDecoder("utf-8").decode(
    Buffer.concat(chunks.map((c) => Buffer.from(c)))
  );

  const map = new Map<string, MediaItem>();

  // meta og / twitter
  for (const prop of ["og:image", "og:image:url", "twitter:image", "og:video", "og:video:url", "og:video:secure_url"]) {
    const re = new RegExp(
      `<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']+)["']`,
      "gi"
    );
    const re2 = new RegExp(
      `content=["']([^"']+)["'][^>]+(?:property|name)=["']${prop}["']`,
      "gi"
    );
    for (const reX of [re, re2]) {
      let m: RegExpExecArray | null;
      while ((m = reX.exec(html))) {
        const u = absUrl(finalUrl, m[1]);
        if (u) {
          pushUnique(
            map,
            finalUrl,
            u,
            prop.includes("video") ? "video" : "image",
            prop
          );
        }
      }
    }
  }

  // img src / data-src / data-lazy-src / srcset
  const imgRe =
    /<img\b[^>]*>/gi;
  let im: RegExpExecArray | null;
  while ((im = imgRe.exec(html))) {
    const tag = im[0];
    const attrs = [
      "src",
      "data-src",
      "data-lazy-src",
      "data-original",
      "data-url",
      "data-image",
    ];
    for (const a of attrs) {
      const am = tag.match(new RegExp(`${a}=["']([^"']+)["']`, "i"));
      if (am) {
        const u = absUrl(finalUrl, am[1]);
        if (u) pushUnique(map, finalUrl, u, "image");
      }
    }
    const ss = tag.match(/srcset=["']([^"']+)["']/i);
    if (ss) {
      for (const u of parseSrcset(finalUrl, ss[1])) {
        pushUnique(map, finalUrl, u, "image");
      }
    }
  }

  // video / source / audio
  const mediaTagRe = /<(video|audio|source)\b[^>]*>/gi;
  let tm: RegExpExecArray | null;
  while ((tm = mediaTagRe.exec(html))) {
    const tagName = tm[1].toLowerCase();
    const tag = tm[0];
    const src = tag.match(/\bsrc=["']([^"']+)["']/i);
    if (src) {
      const u = absUrl(finalUrl, src[1]);
      if (u) {
        const kind =
          tagName === "audio"
            ? "audio"
            : tagName === "video"
              ? "video"
              : guessKind(u, "source-video");
        pushUnique(map, finalUrl, u, kind);
      }
    }
    const ss = tag.match(/srcset=["']([^"']+)["']/i);
    if (ss) {
      for (const u of parseSrcset(finalUrl, ss[1])) {
        pushUnique(map, finalUrl, u, guessKind(u, tagName));
      }
    }
  }

  // poster=
  const posterRe = /poster=["']([^"']+)["']/gi;
  let pm: RegExpExecArray | null;
  while ((pm = posterRe.exec(html))) {
    const u = absUrl(finalUrl, pm[1]);
    if (u) pushUnique(map, finalUrl, u, "image", "poster");
  }

  const items = Array.from(map.values()).slice(0, 120);
  if (!items.length) {
    throw new Error("此頁未找到公開可列的圖片／影片連結");
  }
  return { pageUrl: finalUrl, items, truncated };
}
