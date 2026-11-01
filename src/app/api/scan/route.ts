import { NextResponse } from "next/server";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { scanWebpageMedia } from "@/lib/scan-media";
import type { ApiError, ScanSuccess } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const ip = clientIp(req);
  const rl = rateLimit(`scan:${ip}`);
  if (!rl.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: `請求過於頻繁，請 ${rl.retryAfter} 秒後再試`,
        code: "rate_limited",
      } satisfies ApiError,
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } }
    );
  }

  let url: string;
  try {
    const body = (await req.json()) as { url?: string };
    url = (body.url || "").trim();
  } catch {
    return NextResponse.json(
      { ok: false, error: "請提供 JSON：{ url }" } satisfies ApiError,
      { status: 400 }
    );
  }
  if (!url) {
    return NextResponse.json(
      { ok: false, error: "請貼上網頁連結" } satisfies ApiError,
      { status: 400 }
    );
  }

  try {
    const { pageUrl, items, truncated } = await scanWebpageMedia(url);
    const success: ScanSuccess = {
      ok: true,
      mode: "webpage",
      pageUrl,
      items,
      truncated,
    };
    return NextResponse.json(success);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status =
      msg.includes("私網") || msg.includes("本機") || msg.includes("不允許")
        ? 400
        : msg.includes("登入")
          ? 403
          : 502;
    return NextResponse.json(
      { ok: false, error: msg, code: "scan_failed" } satisfies ApiError,
      { status }
    );
  }
}
