import { NextResponse } from "next/server";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import {
  assertPublicHttpUrl,
  MAX_PROXY_BYTES,
  FETCH_TIMEOUT_MS,
  sameSiteOrCdn,
} from "@/lib/ssrf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const ip = clientIp(req);
  const rl = rateLimit(`proxy:${ip}`);
  if (!rl.ok) {
    return NextResponse.json(
      { ok: false, error: `請求過於頻繁，請 ${rl.retryAfter} 秒後再試` },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } }
    );
  }

  const { searchParams } = new URL(req.url);
  const target = searchParams.get("url");
  const page = searchParams.get("page") || "";
  if (!target) {
    return NextResponse.json({ ok: false, error: "缺少 url" }, { status: 400 });
  }

  let mediaUrl: URL;
  try {
    mediaUrl = await assertPublicHttpUrl(target);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "網址無效" },
      { status: 400 }
    );
  }

  if (page) {
    try {
      await assertPublicHttpUrl(page);
    } catch {
      return NextResponse.json({ ok: false, error: "page 參數無效" }, { status: 400 });
    }
    if (!sameSiteOrCdn(page, mediaUrl.toString())) {
      return NextResponse.json(
        { ok: false, error: "媒體網址不在允許的同源／CDN 清單" },
        { status: 403 }
      );
    }
  } else {
    // Platform mode: allowlist common media CDNs / cobalt tunnels only
    const h = mediaUrl.hostname.toLowerCase();
    const ok =
      h.includes("cdninstagram") ||
      h.includes("fbcdn") ||
      h.includes("twimg") ||
      h.includes("tiktokcdn") ||
      h.includes("ytimg") ||
      h.includes("googlevideo") ||
      h.includes("pinimg") ||
      h.endsWith("imgur.com") ||
      h.includes("cloudfront") ||
      h.includes("akamai") ||
      h.includes("fastly") ||
      // cobalt self-hosted tunnels often on same host as COBALT_API_URL
      (process.env.COBALT_API_URL
        ? (() => {
            try {
              return new URL(process.env.COBALT_API_URL).hostname === h;
            } catch {
              return false;
            }
          })()
        : false) ||
      // allow direct https media with common extensions from public hosts
      /\.(jpe?g|png|webp|gif|mp4|webm|m4a|mp3)(\?|$)/i.test(mediaUrl.pathname + mediaUrl.search);

    // Still require public DNS check (already done). For non-CDN hosts require page param.
    if (!ok) {
      return NextResponse.json(
        {
          ok: false,
          error: "此媒體網址需附帶 page（網頁模式）或屬於已知公開 CDN／Cobalt",
        },
        { status: 403 }
      );
    }
  }

  const upstream = await fetch(mediaUrl.toString(), {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; OnyxLabsMediaSave/1.0; +https://onyxlab.dev)",
      Accept: "*/*",
      ...(page ? { Referer: page } : {}),
    },
    redirect: "follow",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS * 2),
  });

  if (!upstream.ok || !upstream.body) {
    return NextResponse.json(
      { ok: false, error: `上游下載失敗（HTTP ${upstream.status}）` },
      { status: 502 }
    );
  }

  // Verify redirect target is still public
  if (upstream.url && upstream.url !== mediaUrl.toString()) {
    try {
      await assertPublicHttpUrl(upstream.url);
      if (page && !sameSiteOrCdn(page, upstream.url)) {
        return NextResponse.json(
          { ok: false, error: "重新導向目標不在允許範圍" },
          { status: 403 }
        );
      }
    } catch (e) {
      return NextResponse.json(
        { ok: false, error: e instanceof Error ? e.message : "重新導向被拒" },
        { status: 403 }
      );
    }
  }

  const len = Number(upstream.headers.get("content-length") || "0");
  if (len && len > MAX_PROXY_BYTES) {
    return NextResponse.json({ ok: false, error: "檔案過大" }, { status: 413 });
  }

  const contentType = upstream.headers.get("content-type") || "application/octet-stream";
  const disposition =
    upstream.headers.get("content-disposition") ||
    `attachment; filename="onyx-media-${Date.now()}"`;

  return new NextResponse(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": disposition,
      "Cache-Control": "private, max-age=60",
      ...(len ? { "Content-Length": String(len) } : {}),
    },
  });
}
