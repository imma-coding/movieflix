import { useCallback, useState } from 'react';
import type {
    ProviderControls,
    Qualities,
    RunOutput,
    ScrapeMedia,
    Stream,
} from '../../providers-temp/lib/index.js';
import { flags } from '../../providers-temp/lib/index.js';

const {
  makeProviders,
  makeStandardFetcher,
  targets,
  setupProxy,
  setM3U8ProxyUrl,
} = require('../../providers-temp/lib/index.js') as typeof import('../../providers-temp/lib/index.js');

/* ───────── TYPES ───────── */

export type PStreamPlayback = {
  uri: string;
  headers?: Record<string, string>;
  stream: Stream;
  sourceId: string;
  embedId?: string;
};

type Embed = {
  id: string;
  embedScraperId: string;
};

type RunOutputWithEmbeds = RunOutput & { embeds?: Embed[] };

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/* ───────── FETCHER ───────── */

const fetchLike: FetchLike = async (url, init) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const res = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
        Referer: 'https://www.google.com/',
        ...(init?.headers as Record<string, string>),
      },
    });
    clearTimeout(timeout);
    return res;
  } catch (e) {
    clearTimeout(timeout);
    throw e;
  }
};

const sharedFetcher = makeStandardFetcher(fetchLike as any);

/* ───────── PROVIDERS ───────── */

let cachedProviders: ProviderControls | null = null;

function getProviders(): ProviderControls {
  if (!cachedProviders) {
    // When running in the browser, prefer an explicit env override, otherwise
    // fall back to the app's local API proxy so playlists and segment requests
    // are routed through `/api/proxy` (Next.js route).
    if (typeof window !== 'undefined' && typeof setM3U8ProxyUrl === 'function') {
      try {
        const envProxy = (process && (process.env as any)?.NEXT_PUBLIC_PSTREAM_M3U8_PROXY_URL) as string | undefined;
        if (envProxy) {
          setM3U8ProxyUrl(envProxy);
        } else {
          setM3U8ProxyUrl(`${window.location.origin}/api/proxy`);
        }
      } catch (e) {
        // noop
      }
    }
    cachedProviders = makeProviders({
      fetcher: sharedFetcher,
      proxiedFetcher: sharedFetcher,
      target: targets.NATIVE,
      consistentIpForRequests: true,
      proxyStreams: false,
      externalSources: 'all',
    });
  }
  return cachedProviders;
}

/* ───────── STREAM HELPERS ───────── */

const QUALITY_ORDER: Qualities[] = ['4k', '1080', '720', '480', '360', 'unknown'];

function mergeHeaders(stream: Stream) {
  const h = { ...(stream.headers ?? {}), ...(stream.preferredHeaders ?? {}) };
  return Object.keys(h).length ? h : undefined;
}

function pickFileQuality(stream: Stream): string | null {
  if (stream.type !== 'file') return null;
  for (const q of QUALITY_ORDER) {
    const f = stream.qualities?.[q];
    if (f?.url) return f.url;
  }
  return Object.values(stream.qualities ?? {}).find(v => v?.url)?.url ?? null;
}

function buildPlayback(stream: Stream, sourceId: string, embedId?: string): PStreamPlayback {
  let uri: string | null = null;
  let headers = mergeHeaders(stream);

  if (stream.type === 'hls') {
    uri = stream.playlist;
  } else if (stream.type === 'file') {
    uri = pickFileQuality(stream);
    if (stream.flags && (!stream.flags.includes(flags.CORS_ALLOWED) || headers)) {
      const proxied = setupProxy({ ...stream });
      uri = pickFileQuality(proxied);
      headers = undefined;
    }
  }

  if (!uri) throw new Error('No playable stream');

  return { uri, headers, stream, sourceId, embedId };
}

/* ───────── LANGUAGE PRIORITY ───────── */

function isEnglish(embedId?: string) {
  const id = embedId?.toLowerCase() ?? '';
  return id.includes('english') || id.includes('eng') || id.includes('en');
}

function orderEmbedsEnglishFirst(embeds: Embed[]): Embed[] {
  const english: Embed[] = [];
  const rest: Embed[] = [];
  for (const e of embeds) (isEnglish(e.embedScraperId) ? english : rest).push(e);
  return [...english, ...rest];
}

/* ───────── FALLBACK SOURCES ───────── */

const FALLBACK_SOURCES = ['cuevana3', 'ridomovies', 'hdrezka', 'warezcdn'];

/* ───────── HOOK ───────── */

export function usePStream() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PStreamPlayback | null>(null);

  const scrape = useCallback(
    async (media: ScrapeMedia, options?: { sourceOrder?: string[]; debugTag?: string }) => {
      setLoading(true);
      setError(null);
      setResult(null);

      try {
        const providers = getProviders();
        const sourceOrder = options?.sourceOrder || FALLBACK_SOURCES;

        if (options?.debugTag) console.log('[PStream]', options.debugTag, media);

        for (const sourceId of sourceOrder) {
          const discovery: RunOutputWithEmbeds | null = await providers.runAll({
            media,
            sourceOrder: [sourceId],
            disableOpensubtitles: true,
          });

          if (!discovery) continue;

          /* 1️⃣ MAIN STREAM */
          if (discovery.stream) {
            try {
              const playback = buildPlayback(discovery.stream, sourceId);
              setResult(playback);
              return playback;
            } catch {}
          }

          /* 2️⃣ EMBEDS */
          const embeds = orderEmbedsEnglishFirst(discovery.embeds ?? []);
          for (const embed of embeds) {
            try {
              const embedRun = await providers.runAll({
                media,
                sourceOrder: [sourceId],
                embedId: embed.id,
                disableOpensubtitles: true,
              });
              if (embedRun?.stream) {
                const playback = buildPlayback(embedRun.stream, sourceId, embed.id);
                setResult(playback);
                return playback;
              }
            } catch {
              console.warn('[PStream] Embed failed:', embed.embedScraperId);
            }
          }
        }

        throw new Error('No playable stream found');
      } catch (e: any) {
        setError(e?.message ?? 'Stream error');
        throw e;
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  return { loading, error, result, scrape };
}

export default usePStream;
