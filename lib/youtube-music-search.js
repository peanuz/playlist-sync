import { existsSync, readFileSync } from 'fs';

const COOKIES_PATH = Bun.env.YOUTUBE_MUSIC_COOKIES ?? 'cookies.txt';
const ORIGIN = 'https://music.youtube.com';
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

function parseNetscapeCookies(cookieText) {
  const lines = cookieText.split('\n');
  const cookies = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const parts = trimmed.split('\t');
    if (parts.length < 7) {
      continue;
    }

    const [domain, flag, path, secure, expiration, name, value] = parts;

    const expirationNum = parseInt(expiration, 10);
    if (!isNaN(expirationNum) && expirationNum > 0) {
      const expirationDate = new Date(expirationNum * 1000);
      if (expirationDate < new Date()) {
        continue;
      }
    }

    cookies.push({ name, value });
  }

  return cookies;
}

function cookiesToHeader(cookies) {
  return cookies.map(c => `${c.name}=${c.value}`).join('; ');
}

function getRendererText(runs = []) {
  return runs.map((run) => run.text).join('').trim();
}

function extractFirstWatchCandidate(searchResponse) {
  const tabs = searchResponse?.contents?.tabbedSearchResultsRenderer?.tabs || [];

  for (const tab of tabs) {
    const sections = tab?.tabRenderer?.content?.sectionListRenderer?.contents || [];

    for (const section of sections) {
      const shelf = section.musicShelfRenderer;
      if (!shelf?.contents) {
        continue;
      }

      for (const item of shelf.contents) {
        const renderer = item.musicResponsiveListItemRenderer;
        if (!renderer) {
          continue;
        }

        const titleRuns = renderer?.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs;
        const subtitleRuns = renderer?.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs;
        const title = getRendererText(titleRuns);
        const subtitle = getRendererText(subtitleRuns);

        const overlayEndpoint =
          renderer?.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint;
        const navigationEndpoint = renderer?.navigationEndpoint?.watchEndpoint;
        const playlistEndpoint = renderer?.navigationEndpoint?.watchPlaylistEndpoint;

        const watchEndpoint = overlayEndpoint || navigationEndpoint;

        if (watchEndpoint?.videoId) {
          return {
            videoId: watchEndpoint.videoId,
            playlistId: watchEndpoint.playlistId || playlistEndpoint?.playlistId || null,
            musicVideoType: watchEndpoint?.watchEndpointMusicSupportedConfigs?.watchEndpointMusicConfig?.musicVideoType || null,
            title,
            subtitle
          };
        }
      }
    }
  }

  return null;
}

class YouTubeMusicSearchClient {
  constructor() {
    this.initialized = false;
    this.cache = new Map();
  }

  async init() {
    if (this.initialized) {
      return;
    }

    if (!existsSync(COOKIES_PATH)) {
      throw new Error(`YouTube cookies not found at ${COOKIES_PATH}`);
    }

    const cookieText = readFileSync(COOKIES_PATH, 'utf-8');
    const cookies = parseNetscapeCookies(cookieText);

    if (cookies.length === 0) {
      throw new Error('No valid cookies found in cookies file');
    }

    this.cookieHeader = cookiesToHeader(cookies);

    const response = await fetch(ORIGIN, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8',
        'Cookie': this.cookieHeader,
        'Referer': ORIGIN
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch YouTube Music homepage: ${response.status}`);
    }

    const html = await response.text();

    const apiKeyMatch = html.match(/"INNERTUBE_API_KEY"\s*:\s*"([^"]+)"/i);
    if (!apiKeyMatch) {
      throw new Error('Could not extract INNERTUBE_API_KEY from HTML');
    }
    this.apiKey = apiKeyMatch[1];

    let context = null;
    const contextMatch = html.match(/"INNERTUBE_CONTEXT"\s*:\s*({[^}]*"client"[^}]*{[^}]*}[^}]*})/);
    if (contextMatch) {
      const startPos = contextMatch.index + contextMatch[0].indexOf('{');
      let depth = 0;
      let endPos = startPos;

      for (let i = startPos; i < html.length; i++) {
        const char = html[i];
        if (char === '{') depth++;
        if (char === '}') {
          depth--;
          if (depth === 0) {
            endPos = i + 1;
            break;
          }
        }
      }

      try {
        const contextStr = html.substring(startPos, endPos);
        context = JSON.parse(contextStr);
      } catch (e) {

      }
    }

    if (!context) {
      const clientNameMatch = html.match(/"clientName"\s*:\s*"([^"]+)"/);
      const clientVersionMatch = html.match(/"clientVersion"\s*:\s*"([^"]+)"/);
      const glMatch = html.match(/"gl"\s*:\s*"([^"]+)"/);
      const hlMatch = html.match(/"hl"\s*:\s*"([^"]+)"/);

      context = {
        client: {
          clientName: clientNameMatch ? clientNameMatch[1] : 'WEB_REMIX',
          clientVersion: clientVersionMatch ? clientVersionMatch[1] : '1.20251029.03.00',
          gl: glMatch ? glMatch[1] : 'DE',
          hl: hlMatch ? hlMatch[1] : 'de',
          platform: 'DESKTOP',
          originalUrl: ORIGIN
        }
      };
    }

    this.innerTubeContext = context;
    this.initialized = true;
  }

  async searchRaw(query) {
    await this.init();

    const cacheKey = query.toLowerCase();
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    const searchEndpoint = `${ORIGIN}/youtubei/v1/search?prettyPrint=false&key=${this.apiKey}`;

    const response = await fetch(searchEndpoint, {
      method: 'POST',
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': '*/*',
        'Accept-Language': 'de-DE,de;q=0.9',
        'Content-Type': 'application/json',
        'Cookie': this.cookieHeader,
        'Origin': ORIGIN,
        'Referer': `${ORIGIN}/`,
        'X-Youtube-Client-Name': '67',
        'X-Youtube-Client-Version': this.innerTubeContext.client?.clientVersion || '1.20251029.03.00'
      },
      body: JSON.stringify({
        context: this.innerTubeContext,
        query: query
      })
    });

    if (!response.ok) {
      throw new Error(`Search request failed with status ${response.status}`);
    }

    const json = await response.json();
    this.cache.set(cacheKey, json);
    return json;
  }

  async findFirstTrack(query) {
    const data = await this.searchRaw(query);
    const first = extractFirstWatchCandidate(data);

    if (!first) {
      return null;
    }

    return {
      ...first,
      query
    };
  }

  async findTrackForSpotifyItem(track) {
    const query = `${track.artists || ''} ${track.title || ''}`.trim();

    if (!query) {
      throw new Error('Track is missing artists/title for search');
    }

    const result = await this.findFirstTrack(query);

    if (!result) {
      return null;
    }

    return {
      ...result,
      youtubeUrl: `https://www.youtube.com/watch?v=${result.videoId}`,
      matchedTitle: result.title,
      matchedSubtitle: result.subtitle
    };
  }

  async dispose() {
    this.initialized = false;
    this.cache.clear();
  }
}

let clientInstance = null;

export async function getYouTubeMusicSearchClient() {
  if (!clientInstance) {
    clientInstance = new YouTubeMusicSearchClient();
    await clientInstance.init();
  }
  return clientInstance;
}

export async function closeYouTubeMusicSearchClient() {
  if (clientInstance) {
    await clientInstance.dispose();
    clientInstance = null;
  }
}

process.on('exit', () => {
  if (clientInstance) {
    clientInstance.dispose().catch(() => {});
    clientInstance = null;
  }
});
