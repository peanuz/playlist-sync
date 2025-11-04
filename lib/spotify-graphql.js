import { getAccessToken, getClientToken } from './spotify-tokens.js';

const GRAPHQL_ENDPOINT = 'https://api-partner.spotify.com/pathfinder/v2/query';

function extractPlaylistImageUrl(playlist) {
  const candidates = [];

  const pushSources = (sources = []) => {
    sources.forEach(source => {
      if (source?.url) {
        candidates.push({
          url: source.url,
          width: source.width || 0
        });
      }
    });
  };

  const processImageItems = (items = []) => {
    items.forEach(item => {
      if (item?.sources) {
        pushSources(item.sources);
      }
    });
  };

  processImageItems(playlist?.images?.items);
  processImageItems(playlist?.imagesV2?.items);
  processImageItems(playlist?.galleryImages?.items);
  pushSources(playlist?.coverArt?.sources);
  pushSources(playlist?.image?.sources);

  if (candidates.length === 0) {
    return null;
  }

  const unique = new Map();
  candidates.forEach(candidate => {
    const existing = unique.get(candidate.url);
    if (!existing || candidate.width > existing.width) {
      unique.set(candidate.url, candidate);
    }
  });

  const sorted = Array.from(unique.values()).sort((a, b) => (b.width || 0) - (a.width || 0));
  return sorted[0]?.url || null;
}

const PERSISTED_QUERIES = {
  fetchPlaylist: '837211ef46f604a73cd3d051f12ee63c81aca4ec6eb18e227b0629a7b36adad3',
  fetchPlaylistContents: '837211ef46f604a73cd3d051f12ee63c81aca4ec6eb18e227b0629a7b36adad3',
  playlistPermissions: 'f4c99a92059b896b9e4e567403abebe666c0625a36286f9c2bb93961374a75c6'
};

async function executeGraphQL(operationName, variables) {
  const [accessToken, clientToken] = await Promise.all([
    getAccessToken(),
    getClientToken()
  ]);

  const payload = {
    variables,
    operationName,
    extensions: {
      persistedQuery: {
        version: 1,
        sha256Hash: PERSISTED_QUERIES[operationName] || PERSISTED_QUERIES.fetchPlaylist
      }
    }
  };

  const response = await fetch(GRAPHQL_ENDPOINT, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'client-token': clientToken,
      'Content-Type': 'application/json;charset=UTF-8',
      'Accept': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      'app-platform': 'WebPlayer',
      'spotify-app-version': '1.2.77.2.g23d1d0ed',
      'accept-language': 'en',
      'Referer': 'https://open.spotify.com/',
      'Origin': 'https://open.spotify.com'
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(`GraphQL request failed: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();

  if (data.errors && data.errors.length > 0) {
    throw new Error(`GraphQL errors: ${JSON.stringify(data.errors)}`);
  }

  return data;
}

export async function getPlaylistMetadata(playlistId) {
  const uri = `spotify:playlist:${playlistId}`;

  try {
    const response = await executeGraphQL('playlistPermissions', { uri });

    const playlist = response.data?.playlistV2;
    if (!playlist) {
      throw new Error('Playlist not found');
    }

    const owner = playlist.members?.items?.find(m => m.isOwner)?.user?.data?.name || 'Unknown';

    return {
      name: 'Unknown Playlist',
      owner,
      uri
    };
  } catch (error) {
    console.warn(`⚠ Could not fetch metadata: ${error.message}`);
    return {
      name: 'Unknown Playlist',
      owner: 'Unknown',
      uri
    };
  }
}

export async function fetchPlaylistTracks(playlistId, offset = 0, limit = 100) {
  const uri = `spotify:playlist:${playlistId}`;
  const operationName = offset === 0 ? 'fetchPlaylist' : 'fetchPlaylistContents';

  const response = await executeGraphQL(operationName, {
    uri,
    offset,
    limit,
    enableWatchFeedEntrypoint: false
  });

  const playlist = response.data?.playlistV2;
  if (!playlist) {
    throw new Error('Playlist not found in response');
  }

  const playlistName = playlist.name || null;

  const items = playlist.content?.items || [];
  const tracks = items
    .map((item, index) => {
      const track = item.itemV2?.data;
      if (!track || track.__typename !== 'Track') {
        return null;
      }

      const artists = track.artists?.items
        ?.map(a => a.profile?.name)
        .filter(Boolean)
        .join(', ') || 'Unknown Artist';

      const trackUri = track.uri || '';
      const trackId = trackUri.replace('spotify:track:', '');

      return {
        id: `/track/${trackId}`,
        url: `https://open.spotify.com/track/${trackId}`,
        artists,
        title: track.name || 'Unknown Track',
        position: offset + index + 1
      };
    })
    .filter(Boolean);

  return {
    tracks,
    hasMore: items.length === limit,
    playlistName,
    playlistImage: extractPlaylistImageUrl(playlist)
  };
}

export async function fetchAllTracks(playlistId) {
  const allTracks = [];
  let offset = 0;
  const limit = 100;
  let hasMore = true;
  let playlistName = null;
  let playlistImage = null;

  console.log(`⏳ Loading playlist tracks (ID: ${playlistId})...`);

  while (hasMore) {
    const { tracks, hasMore: more, playlistName: name, playlistImage: image } = await fetchPlaylistTracks(
      playlistId,
      offset,
      limit
    );

    if (name && !playlistName) {
      playlistName = name;
    }

    if (image && !playlistImage) {
      playlistImage = image;
    }

    allTracks.push(...tracks);
    hasMore = more;
    offset += limit;

    if (hasMore) {
      console.log(`   Loaded: ${allTracks.length} tracks...`);
    }
  }

  console.log(`✓ ${allTracks.length} tracks loaded`);

  return {
    tracks: allTracks,
    playlistName: playlistName || 'Unknown Playlist',
    playlistImage: playlistImage || null
  };
}
