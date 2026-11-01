"use client";

import Image from "next/image";
import { useCallback, useMemo, useState } from "react";
import type { MediaItem } from "@/lib/types";

type Mode = "platform" | "webpage";

function proxyHref(url: string, page?: string) {
  const q = new URLSearchParams({ url });
  if (page) q.set("page", page);
  return `/api/proxy?${q.toString()}`;
}

function kindLabel(k: MediaItem["kind"]) {
  switch (k) {
    case "image":
      return "圖片";
    case "video":
      return "影片";
    case "audio":
      return "音訊";
    default:
      return "媒體";
  }
}

export function MediaSaveApp() {
  const [mode, setMode] = useState<Mode>("platform");
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [items, setItems] = useState<MediaItem[]>([]);
  const [pageUrl, setPageUrl] = useState<string | null>(null);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [source, setSource] = useState<string | null>(null);

  const selectedItems = useMemo(
    () => items.filter((i) => selected[i.id]),
    [items, selected]
  );

  const resetResults = () => {
    setItems([]);
    setSelected({});
    setPageUrl(null);
    setSource(null);
    setWarning(null);
    setError(null);
  };

  const onMode = (m: Mode) => {
    setMode(m);
    resetResults();
  };

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    setWarning(null);
    setItems([]);
    setSelected({});
    setPageUrl(null);
    setSource(null);
    try {
      const endpoint = mode === "platform" ? "/api/resolve" : "/api/scan";
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error || "發生錯誤");
        return;
      }
      const list: MediaItem[] = data.items || [];
      setItems(list);
      const sel: Record<string, boolean> = {};
      list.forEach((it) => {
        sel[it.id] = true;
      });
      setSelected(sel);
      if (data.pageUrl) setPageUrl(data.pageUrl);
      if (data.source) setSource(data.source);
      if (data.warning) setWarning(data.warning);
      if (data.truncated) {
        setWarning((w) =>
          w ? `${w}（頁面過大，已截斷解析）` : "頁面過大，已截斷解析"
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "網路錯誤");
    } finally {
      setLoading(false);
    }
  }, [mode, url]);

  const toggle = (id: string) => {
    setSelected((s) => ({ ...s, [id]: !s[id] }));
  };

  const toggleAll = (on: boolean) => {
    const next: Record<string, boolean> = {};
    items.forEach((i) => {
      next[i.id] = on;
    });
    setSelected(next);
  };

  const downloadOne = (item: MediaItem) => {
    const href = proxyHref(item.url, pageUrl || undefined);
    const a = document.createElement("a");
    a.href = href;
    a.download = "";
    a.rel = "noopener";
    a.target = "_blank";
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const downloadSelected = async () => {
    for (const item of selectedItems) {
      downloadOne(item);
      await new Promise((r) => setTimeout(r, 350));
    }
  };

  return (
    <div className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 px-4 py-8 sm:py-12">
      <header className="flex items-start gap-3">
        <Image
          src="/onyx-mark.png"
          alt="Onyx Labs"
          width={48}
          height={48}
          className="rounded-sm"
          priority
        />
        <div>
          <p className="text-xs tracking-widest text-brand uppercase">Onyx Labs</p>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            媒體下載
          </h1>
          <p className="mt-1 text-sm text-muted">
            公開平台解析 · 任意網頁媒體挑選 · 個人存檔用
          </p>
        </div>
      </header>

      <div className="pixel-panel p-1 flex gap-1">
        <button
          type="button"
          className={`flex-1 pixel-btn px-3 py-2 text-sm font-medium ${
            mode === "platform" ? "bg-brand text-black" : "bg-surface-2 text-foreground"
          }`}
          onClick={() => onMode("platform")}
        >
          平台解析
        </button>
        <button
          type="button"
          className={`flex-1 pixel-btn px-3 py-2 text-sm font-medium ${
            mode === "webpage" ? "bg-brand text-black" : "bg-surface-2 text-foreground"
          }`}
          onClick={() => onMode("webpage")}
        >
          網頁媒體
        </button>
      </div>

      <section className="pixel-panel p-4 sm:p-5 space-y-3">
        <p className="text-sm text-muted">
          {mode === "platform"
            ? "貼 Instagram 公開貼文／Reel、X、TikTok、YouTube 等公開連結。私人／需登入內容會拒絕。"
            : "貼一般 https 網頁，抽出公開圖片／影片供勾選下載。不跟登入牆、不破解付費內容。"}
        </p>
        <label className="block text-xs text-muted uppercase tracking-wide">
          連結
        </label>
        <input
          className="pixel-inset w-full px-3 py-2.5 text-sm outline-none focus:ring-1 focus:ring-brand"
          placeholder={
            mode === "platform"
              ? "https://www.instagram.com/reel/…"
              : "https://example.com/gallery"
          }
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && url.trim() && !loading) run();
          }}
        />
        <button
          type="button"
          disabled={!url.trim() || loading}
          onClick={run}
          className="pixel-btn bg-brand px-4 py-2.5 text-sm font-semibold text-black disabled:opacity-50"
        >
          {loading ? "解析中…" : mode === "platform" ? "解析平台" : "掃描網頁"}
        </button>
      </section>

      {error && (
        <div className="pixel-panel border-danger/60 bg-danger/10 p-4 text-sm text-danger">
          {error}
        </div>
      )}
      {warning && (
        <div className="pixel-panel border-warning/60 bg-warning/10 p-4 text-sm text-warning">
          {warning}
        </div>
      )}

      {items.length > 0 && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm text-muted">
              找到 {items.length} 項
              {source ? ` · 來源 ${source}` : ""}
              {pageUrl ? ` · ${new URL(pageUrl).hostname}` : ""}
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="pixel-btn bg-surface-2 px-3 py-1.5 text-xs"
                onClick={() => toggleAll(true)}
              >
                全選
              </button>
              <button
                type="button"
                className="pixel-btn bg-surface-2 px-3 py-1.5 text-xs"
                onClick={() => toggleAll(false)}
              >
                全不選
              </button>
              <button
                type="button"
                disabled={!selectedItems.length}
                className="pixel-btn bg-brand px-3 py-1.5 text-xs font-semibold text-black disabled:opacity-50"
                onClick={downloadSelected}
              >
                下載已選（{selectedItems.length}）
              </button>
            </div>
          </div>

          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {items.map((item) => (
              <li key={item.id} className="pixel-panel overflow-hidden">
                <label className="flex cursor-pointer flex-col">
                  <div className="relative aspect-video bg-surface-2">
                    {item.kind === "video" ? (
                      <video
                        src={item.url}
                        poster={item.thumbnail}
                        className="h-full w-full object-contain"
                        muted
                        playsInline
                        preload="metadata"
                      />
                    ) : item.thumbnail || item.kind === "image" ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={item.thumbnail || item.url}
                        alt={item.title || ""}
                        className="h-full w-full object-contain"
                        loading="lazy"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center text-muted text-sm">
                        {kindLabel(item.kind)}
                      </div>
                    )}
                    <input
                      type="checkbox"
                      className="absolute left-2 top-2 h-4 w-4 accent-brand"
                      checked={!!selected[item.id]}
                      onChange={() => toggle(item.id)}
                    />
                  </div>
                  <div className="flex items-center justify-between gap-2 p-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm">
                        {item.title || kindLabel(item.kind)}
                      </p>
                      <p className="truncate text-xs text-muted">
                        {kindLabel(item.kind)}
                        {item.source ? ` · ${item.source}` : ""}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="pixel-btn shrink-0 bg-surface-2 px-2 py-1 text-xs"
                      onClick={(e) => {
                        e.preventDefault();
                        downloadOne(item);
                      }}
                    >
                      下載
                    </button>
                  </div>
                </label>
              </li>
            ))}
          </ul>
        </section>
      )}

      <footer className="mt-auto space-y-2 border-t border-border/40 pt-6 text-xs text-muted">
        <p>
          僅供個人存檔。請遵守各平台服務條款與著作權；勿下載他人私人內容或用於侵權用途。
        </p>
        <p>
          私人帳號、登入牆、付費牆不支援，也不會實作 cookie／session 繞過。
        </p>
        <p>
          <a
            className="text-brand hover:underline"
            href="https://onyxlab.dev"
            target="_blank"
            rel="noreferrer"
          >
            onyxlab.dev
          </a>
          {" · "}
          Onyx Labs
        </p>
      </footer>
    </div>
  );
}
