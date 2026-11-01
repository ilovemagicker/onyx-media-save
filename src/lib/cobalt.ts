import type { MediaItem } from "./types";

type CobaltPickerItem = {
  type?: string;
  url?: string;
  thumb?: string;
};

type CobaltResponse = {
  status?: string;
  url?: string;
  filename?: string;
  picker?: CobaltPickerItem[];
  audio?: string;
  audioFilename?: string;
  error?: { code?: string; message?: string } | string;
};

function kindFromUrl(url: string, hint?: string): MediaItem["kind"] {
  const h = (hint || "").toLowerCase();
  if (h.includes("video")) return "video";
  if (h.includes("photo") || h.includes("image") || h.includes("gif")) return "image";
  if (h.includes("audio")) return "audio";
  const path = url.toLowerCase().split("?")[0];
  if (/\.(mp4|webm|mov|m4v)$/.test(path)) return "video";
  if (/\.(jpe?g|png|webp|gif|avif)$/.test(path)) return "image";
  if (/\.(mp3|m4a|aac|ogg|wav|opus)$/.test(path)) return "audio";
  return "unknown";
}

export function isPrivateContentError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("private") ||
    m.includes("login") ||
    m.includes("auth") ||
    m.includes("restricted") ||
    m.includes("unavailable") ||
    m.includes("age") ||
    m.includes("朋友") ||
    m.includes("私人") ||
    m.includes("登入")
  );
}

export async function resolveWithCobalt(url: string): Promise<{
  items: MediaItem[];
  rawStatus?: string;
}> {
  const base = process.env.COBALT_API_URL?.replace(/\/$/, "");
  if (!base) {
    throw new Error("NO_COBALT");
  }
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  const key = process.env.COBALT_API_KEY;
  if (key) headers.Authorization = `Api-Key ${key}`;

  const res = await fetch(`${base}/`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      url,
      videoQuality: "1080",
      filenameStyle: "basic",
      downloadMode: "auto",
    }),
    signal: AbortSignal.timeout(20_000),
  });

  const data = (await res.json().catch(() => ({}))) as CobaltResponse;
  if (!res.ok || data.status === "error") {
    const err =
      typeof data.error === "string"
        ? data.error
        : data.error?.code || data.error?.message || `Cobalt HTTP ${res.status}`;
    throw new Error(String(err));
  }

  const items: MediaItem[] = [];
  if (data.status === "picker" && Array.isArray(data.picker)) {
    data.picker.forEach((p, i) => {
      if (!p.url) return;
      items.push({
        id: `cobalt-pick-${i}`,
        url: p.url,
        kind: kindFromUrl(p.url, p.type),
        thumbnail: p.thumb,
        title: `項目 ${i + 1}`,
        source: "cobalt",
      });
    });
    if (data.audio) {
      items.push({
        id: "cobalt-audio",
        url: data.audio,
        kind: "audio",
        title: data.audioFilename || "音訊",
        source: "cobalt",
      });
    }
  } else if ((data.status === "tunnel" || data.status === "redirect") && data.url) {
    items.push({
      id: "cobalt-main",
      url: data.url,
      kind: kindFromUrl(data.url, data.filename),
      title: data.filename || "下載",
      source: "cobalt",
    });
  } else if (data.status === "local-processing" && data.url) {
    items.push({
      id: "cobalt-local",
      url: data.url,
      kind: kindFromUrl(data.url, data.filename),
      title: data.filename || "下載",
      source: "cobalt",
    });
  }

  if (!items.length) {
    throw new Error("Cobalt 未回傳可下載項目");
  }
  return { items, rawStatus: data.status };
}
