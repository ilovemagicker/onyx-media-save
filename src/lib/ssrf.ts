import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const BLOCKED_HOSTS = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata.google.com",
]);

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, o) => (acc << 8) + Number(o), 0) >>> 0;
}

function isPrivateIpv4(ip: string): boolean {
  const n = ipv4ToInt(ip);
  const ranges: Array<[number, number]> = [
    [ipv4ToInt("0.0.0.0"), ipv4ToInt("0.255.255.255")],
    [ipv4ToInt("10.0.0.0"), ipv4ToInt("10.255.255.255")],
    [ipv4ToInt("100.64.0.0"), ipv4ToInt("100.127.255.255")],
    [ipv4ToInt("127.0.0.0"), ipv4ToInt("127.255.255.255")],
    [ipv4ToInt("169.254.0.0"), ipv4ToInt("169.254.255.255")],
    [ipv4ToInt("172.16.0.0"), ipv4ToInt("172.31.255.255")],
    [ipv4ToInt("192.0.0.0"), ipv4ToInt("192.0.0.255")],
    [ipv4ToInt("192.168.0.0"), ipv4ToInt("192.168.255.255")],
    [ipv4ToInt("198.18.0.0"), ipv4ToInt("198.19.255.255")],
    [ipv4ToInt("224.0.0.0"), ipv4ToInt("255.255.255.255")],
  ];
  return ranges.some(([a, b]) => n >= a && n <= b);
}

function isPrivateIpv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === "::" || lower === "::1") return true;
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // ULA
  if (lower.startsWith("fe80")) return true; // link-local
  if (lower.startsWith("::ffff:")) {
    const mapped = lower.slice("::ffff:".length);
    if (isIP(mapped) === 4) return isPrivateIpv4(mapped);
  }
  return false;
}

export function assertHttpUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error("網址格式無效");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error("只允許 http 或 https");
  }
  if (u.username || u.password) {
    throw new Error("不允許帶帳密的網址");
  }
  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host || BLOCKED_HOSTS.has(host) || host.endsWith(".localhost") || host.endsWith(".local")) {
    throw new Error("不允許存取此主機");
  }
  const ipVersion = isIP(host);
  if (ipVersion === 4 && isPrivateIpv4(host)) {
    throw new Error("不允許私網／本機 IP");
  }
  if (ipVersion === 6 && isPrivateIpv6(host)) {
    throw new Error("不允許私網／本機 IP");
  }
  return u;
}

export async function assertPublicHttpUrl(raw: string): Promise<URL> {
  const u = assertHttpUrl(raw);
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) return u;
  let records: Array<{ address: string; family: number }>;
  try {
    records = await lookup(host, { all: true, verbatim: true });
  } catch {
    throw new Error("無法解析主機名稱");
  }
  if (!records.length) throw new Error("無法解析主機名稱");
  for (const r of records) {
    if (r.family === 4 && isPrivateIpv4(r.address)) {
      throw new Error("主機解析到私網 IP，已阻擋");
    }
    if (r.family === 6 && isPrivateIpv6(r.address)) {
      throw new Error("主機解析到私網 IP，已阻擋");
    }
  }
  return u;
}

export const FETCH_TIMEOUT_MS = 12_000;
export const MAX_HTML_BYTES = 2_000_000;
export const MAX_PROXY_BYTES = 80_000_000;

export function sameSiteOrCdn(pageUrl: string, mediaUrl: string): boolean {
  let page: URL;
  let media: URL;
  try {
    page = new URL(pageUrl);
    media = assertHttpUrl(mediaUrl);
  } catch {
    return false;
  }
  const ph = page.hostname.replace(/^www\./, "").toLowerCase();
  const mh = media.hostname.replace(/^www\./, "").toLowerCase();
  if (mh === ph || mh.endsWith(`.${ph}`)) return true;
  // Common public CDNs / image hosts
  const allow = [
    "cdninstagram.com",
    "fbcdn.net",
    "twimg.com",
    "tiktokcdn.com",
    "tiktokcdn-us.com",
    "ytimg.com",
    "ggpht.com",
    "googleusercontent.com",
    "pinimg.com",
    "redd.it",
    "redditmedia.com",
    "imgur.com",
    "i.imgur.com",
    "cloudfront.net",
    "akamaized.net",
    "fastly.net",
    "wp.com",
    "unsplash.com",
    "images.unsplash.com",
    "pexels.com",
    "staticflickr.com",
  ];
  return allow.some((d) => mh === d || mh.endsWith(`.${d}`));
}
