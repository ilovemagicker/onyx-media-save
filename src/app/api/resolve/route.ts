import { NextResponse } from "next/server";
import { resolveWithCobalt, isPrivateContentError } from "@/lib/cobalt";
import { isInstagramUrl, resolveInstagramPublic } from "@/lib/ig-fallback";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { assertHttpUrl } from "@/lib/ssrf";
import type { ApiError, ResolveSuccess } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const ip = clientIp(req);
  const rl = rateLimit(`resolve:${ip}`);
  if (!rl.ok) {
    const body: ApiError = {
      ok: false,
      error: `請求過於頻繁，請 ${rl.retryAfter} 秒後再試`,
      code: "rate_limited",
    };
    return NextResponse.json(body, {
      status: 429,
      headers: { "Retry-After": String(rl.retryAfter) },
    });
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
      { ok: false, error: "請貼上連結" } satisfies ApiError,
      { status: 400 }
    );
  }

  try {
    assertHttpUrl(url);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "網址無效" } satisfies ApiError,
      { status: 400 }
    );
  }

  const hasCobalt = Boolean(process.env.COBALT_API_URL);

  if (hasCobalt) {
    try {
      const { items } = await resolveWithCobalt(url);
      const success: ResolveSuccess = {
        ok: true,
        mode: "platform",
        source: "cobalt",
        items,
      };
      return NextResponse.json(success);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (isPrivateContentError(msg)) {
        return NextResponse.json(
          {
            ok: false,
            error: "私人／需登入內容不支援。請使用公開貼文，或請對方設為公開。",
            code: "private_content",
          } satisfies ApiError,
          { status: 403 }
        );
      }
      // fall through to IG fallback when applicable
      if (!isInstagramUrl(url)) {
        return NextResponse.json(
          {
            ok: false,
            error: `平台解析失敗：${msg}`,
            code: "cobalt_error",
          } satisfies ApiError,
          { status: 502 }
        );
      }
    }
  }

  if (isInstagramUrl(url)) {
    try {
      const items = await resolveInstagramPublic(url);
      const success: ResolveSuccess = {
        ok: true,
        mode: "platform",
        source: "fallback",
        items,
        warning: hasCobalt
          ? undefined
          : "未設定 COBALT_API_URL，使用公開頁／oEmbed 後備；完整影片／輪播可能不完整。",
      };
      return NextResponse.json(success);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("私人") || msg.includes("登入")) {
        return NextResponse.json(
          { ok: false, error: msg, code: "private_content" } satisfies ApiError,
          { status: 403 }
        );
      }
      return NextResponse.json(
        {
          ok: false,
          error: hasCobalt
            ? msg
            : `${msg}（建議在 Vercel 設定環境變數 COBALT_API_URL）`,
          code: "resolve_failed",
        } satisfies ApiError,
        { status: 502 }
      );
    }
  }

  if (!hasCobalt) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "尚未設定 COBALT_API_URL。請自架 Cobalt 並在環境變數填入 API 網址，即可解析 X／TikTok／YouTube／IG 等公開連結。Instagram 目前僅有有限後備。",
        code: "no_cobalt",
      } satisfies ApiError,
      { status: 501 }
    );
  }

  return NextResponse.json(
    { ok: false, error: "無法解析此連結", code: "resolve_failed" } satisfies ApiError,
    { status: 502 }
  );
}
