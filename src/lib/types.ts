export type MediaKind = "image" | "video" | "audio" | "unknown";

export type MediaItem = {
  id: string;
  url: string;
  kind: MediaKind;
  title?: string;
  thumbnail?: string;
  source?: string;
};

export type ResolveSuccess = {
  ok: true;
  mode: "platform";
  source: "cobalt" | "fallback";
  items: MediaItem[];
  warning?: string;
};

export type ScanSuccess = {
  ok: true;
  mode: "webpage";
  pageUrl: string;
  items: MediaItem[];
  truncated?: boolean;
};

export type ApiError = {
  ok: false;
  error: string;
  code?: string;
};
