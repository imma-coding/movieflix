
export const scrapeImdbTrailer = async ({ imdb_id }: { imdb_id: string }): Promise<string | null> => {
  if (!imdb_id) return null;

  try {
    // Step 1: Fetch the main movie page to find the trailer's video ID
    const titlePageUrl = `https://www.imdb.com/title/${imdb_id}/`;
    const titlePageResponse = await fetch(titlePageUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      },
    });

    if (!titlePageResponse.ok) {
      console.error(`Failed to fetch IMDb title page for ${imdb_id}: ${titlePageResponse.statusText}`);
      return null;
    }

    const titlePageHtml = await titlePageResponse.text();
    const videoIdMatch = titlePageHtml.match(/\/video\/(vi\d+)/);

    if (!videoIdMatch || !videoIdMatch[1]) {
      console.warn(`Could not find a trailer video ID on IMDb page for ${imdb_id}.`);
      return null;
    }
    const videoId = videoIdMatch[1];

    // Step 2: Fetch the embed player page
    const embedUrl = `https://www.imdb.com/videoembed/${videoId}`;
    const embedPageResponse = await fetch(embedUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      },
    });

    if (!embedPageResponse.ok) {
      console.error(`Failed to fetch IMDb embed page for ${videoId}: ${embedPageResponse.statusText}`);
      return null;
    }

    const embedPageHtml = await embedPageResponse.text();

    // Step 3: Extract the video source URL from the embedded JSON state
    // Try several patterns to be resilient to IMDb changes.
    const tryPatterns = [
      /IMDbReactInitialState\.push\(({[\s\S]*?})\)/,
      /window\.__INITIAL_STATE__\s*=\s*({[\s\S]*?})\s*;/,
      /IMDbReactInitialState\s*=\s*({[\s\S]*?})\s*;/,
    ];

    let state: any = null;

    for (const pat of tryPatterns) {
      const m = embedPageHtml.match(pat as RegExp);
      if (m && m[1]) {
        try {
          state = JSON.parse(m[1]);
          break;
        } catch (err) {
          // continue to other patterns
        }
      }
    }

    // Fallback: try to find the `videoLegacyEncodings` token anywhere in the HTML
    // and extract the surrounding JSON object using brace matching.
    if (!state) {
      const key = 'videoLegacyEncodings';
      const keyIdx = embedPageHtml.indexOf(key);
      if (keyIdx !== -1) {
        // find opening brace before the key
        let start = embedPageHtml.lastIndexOf('{', keyIdx);
        if (start === -1) start = embedPageHtml.indexOf('{', Math.max(0, keyIdx - 200));
        if (start !== -1) {
          // find matching closing brace
          let depth = 0;
          let end = -1;
          for (let i = start; i < embedPageHtml.length; i++) {
            const ch = embedPageHtml[i];
            if (ch === '{') depth++;
            else if (ch === '}') depth--;
            if (depth === 0) { end = i + 1; break; }
          }
          if (end !== -1) {
            const candidate = embedPageHtml.slice(start, end);
            try {
              state = JSON.parse(candidate);
            } catch (err) {
              // ignore parse error
            }
          }
        }
      }
    }

    if (!state) {
      console.error(`Could not find IMDbReactInitialState JSON on embed page for ${videoId}.`);
      return null;
    }

    const encodings = state?.videos?.videoLegacyEncodings || state?.videoLegacyEncodings || null;

    if (!Array.isArray(encodings) || encodings.length === 0) {
      console.warn(`No video encodings found in IMDb data for ${videoId}.`);
      return null;
    }

    const preferred = Array.isArray(encodings)
      ? encodings.find((e: any) => e.definition === '720p') || encodings.find((e: any) => e.definition === '1080p')
      : null;
    const chosenEncoding = preferred || encodings[0];
    const videoUrl = chosenEncoding?.videoUrl;

    if (!videoUrl) {
      console.warn(`Could not extract a video URL from encodings for ${videoId}.`);
      return null;
    }

    return videoUrl;
  } catch (error) {
    console.error(`An error occurred while scraping IMDb trailer for ${imdb_id}:`, error);
    return null;
  }
};
