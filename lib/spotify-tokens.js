let cachedAccessToken = null;
let accessTokenExpiry = null;
let cachedClientToken = null;
let clientTokenExpiry = null;

const SAMPLE_PLAYLIST_ID = '37i9dQZF1DXcBWIGoYBM5M';

export async function getAccessToken() {
  if (cachedAccessToken && accessTokenExpiry && Date.now() < accessTokenExpiry) {
    return cachedAccessToken;
  }

  try {
    console.log('   🔑 Fetching access token from Embed API...');

    const embedUrl = `https://open.spotify.com/embed/playlist/${SAMPLE_PLAYLIST_ID}`;

    const response = await fetch(embedUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://open.spotify.com/'
      }
    });

    if (!response.ok) {
      throw new Error(`Embed request failed: ${response.status}`);
    }

    const html = await response.text();

    const tokenPatterns = [
      /accessToken["\s:]+["']([A-Za-z0-9_-]+)["']/i,
      /["']accessToken["'][:\s]+["']([A-Za-z0-9_-]+)["']/i,
      /"token"[:\s]+"([A-Za-z0-9_-]{100,})"/i
    ];

    let token = null;
    for (const pattern of tokenPatterns) {
      const match = html.match(pattern);
      if (match && match[1] && match[1].length > 50) {
        token = match[1];
        break;
      }
    }

    if (!token) {
      throw new Error('No access token found in embed HTML');
    }

    cachedAccessToken = token;
    accessTokenExpiry = Date.now() + (60 * 60 * 1000);

    console.log('   ✓ Access token acquired');

    return cachedAccessToken;
  } catch (error) {
    throw new Error(`Failed to get access token: ${error.message}`);
  }
}

export async function getClientToken() {
  if (cachedClientToken && clientTokenExpiry && Date.now() < clientTokenExpiry) {
    return cachedClientToken;
  }

  try {
    const response = await fetch('https://clienttoken.spotify.com/v1/clienttoken', {
      method: 'POST',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        client_data: {
          client_version: '1.2.77.2.g23d1d0ed',
          client_id: 'd8a5ed958d274c2e8ee717e6a4b0971d',
          js_sdk_data: {
            device_brand: 'unknown',
            device_model: 'desktop',
            os: 'macOS',
            os_version: 'unknown'
          }
        }
      })
    });

    if (!response.ok) {
      throw new Error(`Client token request failed: ${response.status}`);
    }

    const data = await response.json();

    if (data.granted_token && data.granted_token.token) {
      cachedClientToken = data.granted_token.token;
      const expiresIn = data.granted_token.expires_after_seconds || 1209600;
      clientTokenExpiry = Date.now() + (expiresIn * 1000);
      return cachedClientToken;
    }

    throw new Error('No client token in response');
  } catch (error) {
    throw new Error(`Failed to get client token: ${error.message}`);
  }
}

export function clearTokenCache() {
  cachedAccessToken = null;
  accessTokenExpiry = null;
  cachedClientToken = null;
  clientTokenExpiry = null;
}
