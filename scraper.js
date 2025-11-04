import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { fetchAllTracks } from './lib/spotify-graphql.js';

const COVER_DIR = 'covers';

async function downloadPlaylistCover(playlistId, imageUrl) {
  if (!imageUrl) {
    return null;
  }

  if (!existsSync(COVER_DIR)) {
    mkdirSync(COVER_DIR, { recursive: true });
  }

  const extensionMatch = imageUrl.split('?')[0].match(/\.(jpg|jpeg|png|webp)$/i);
  const extension = extensionMatch ? extensionMatch[1].toLowerCase() : 'jpg';
  const normalizedExtension = extension === 'jpeg' ? 'jpg' : extension;
  const filePath = join(COVER_DIR, `${playlistId}.${normalizedExtension}`);

  try {
    const response = await fetch(imageUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
        'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8'
      }
    });

    if (!response.ok) {
      console.warn(`⚠️  Could not load playlist cover (${response.status})`);
      return existsSync(filePath) ? filePath : null;
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    writeFileSync(filePath, buffer);
    return filePath;
  } catch (error) {
    console.warn(`⚠️  Could not load playlist cover: ${error.message}`);
    return existsSync(filePath) ? filePath : null;
  }
}

function extractPlaylistId(url) {
  const match = url.match(/playlist\/([a-zA-Z0-9]+)/);
  if (!match) {
    throw new Error('Invalid playlist URL');
  }
  return match[1];
}

function loadState(playlistId) {
  const statePath = join('data', `${playlistId}.json`);

  if (!existsSync(statePath)) {
    return null;
  }

  try {
    const content = readFileSync(statePath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    console.warn(`⚠ Could not load state: ${error.message}`);
    return null;
  }
}

function saveState(playlistId, tracks, metadata = {}) {
  if (!existsSync('data')) {
    mkdirSync('data', { recursive: true });
  }

  const state = {
    playlistId,
    playlistName: metadata.name || 'Unknown Playlist',
    playlistImage: metadata.image || metadata.playlistImage || null,
    playlistImagePath: metadata.imagePath || null,
    lastUpdate: new Date().toISOString(),
    trackCount: tracks.length,
    tracks: tracks.map((track, index) => ({
      position: index + 1,
      id: track.id,
      url: track.url,
      artists: track.artists,
      title: track.title
    }))
  };

  const statePath = join('data', `${playlistId}.json`);
  writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf-8');
}

function compareTrackLists(oldTracks, newTracks) {
  const oldMap = new Map(oldTracks.map(t => [t.id, t]));
  const newMap = new Map(newTracks.map(t => [t.id, t]));

  const changes = {
    added: [],
    removed: [],
    moved: [],
    unchanged: 0
  };

  for (const track of newTracks) {
    if (!oldMap.has(track.id)) {
      changes.added.push(track);
    }
  }

  for (const track of oldTracks) {
    if (!newMap.has(track.id)) {
      changes.removed.push(track);
    }
  }

  for (const newTrack of newTracks) {
    const oldTrack = oldMap.get(newTrack.id);
    if (oldTrack && oldTrack.position !== newTrack.position) {
      changes.moved.push({
        from: oldTrack.position,
        to: newTrack.position,
        artists: newTrack.artists,
        title: newTrack.title
      });
    } else if (oldTrack) {
      changes.unchanged++;
    }
  }

  return changes;
}

function printDiffReport(changes, playlistName) {
  console.log(`\n📊 Changes in "${playlistName}":`);

  const totalChanges = changes.added.length + changes.removed.length + changes.moved.length;

  if (totalChanges === 0) {
    console.log('   ✓ No changes found');
    return false;
  }

  console.log(`   + ${changes.added.length} new tracks`);
  console.log(`   - ${changes.removed.length} removed tracks`);
  console.log(`   ↕ ${changes.moved.length} position changes`);
  console.log(`   = ${changes.unchanged} unchanged`);

  if (changes.added.length > 0) {
    console.log(`\n➕ New tracks:`);
    changes.added.slice(0, 10).forEach(track => {
      console.log(`   #${track.position}  ${track.artists} - ${track.title}`);
    });
    if (changes.added.length > 10) {
      console.log(`   ... and ${changes.added.length - 10} more`);
    }
  }

  if (changes.removed.length > 0) {
    console.log(`\n➖ Removed tracks:`);
    changes.removed.slice(0, 10).forEach(track => {
      console.log(`   ${track.artists} - ${track.title}`);
    });
    if (changes.removed.length > 10) {
      console.log(`   ... and ${changes.removed.length - 10} more`);
    }
  }

  if (changes.moved.length > 0 && changes.moved.length <= 10) {
    console.log(`\n↕️  Moved tracks:`);
    changes.moved.forEach(track => {
      console.log(`   #${track.from} → #${track.to}  ${track.artists} - ${track.title}`);
    });
  }

  return true;
}

function writePlaylistFile(playlistId, tracks, playlistName, playlistImage = null, playlistImagePath = null) {
  if (!existsSync('playlists')) {
    mkdirSync('playlists', { recursive: true });
  }

  const output = {
    playlistId,
    playlistName,
    playlistImage,
    playlistImagePath,
    exportDate: new Date().toISOString(),
    trackCount: tracks.length,
    tracks: tracks.map(track => ({
      position: track.position,
      title: track.title,
      artists: track.artists,
      url: track.url
    }))
  };

  const filePath = join('playlists', `${playlistId}.json`);
  writeFileSync(filePath, JSON.stringify(output, null, 2), 'utf-8');

  return filePath;
}

export async function scrapePlaylist(playlistUrl, options = {}) {
  const playlistId = extractPlaylistId(playlistUrl);
  console.log(`\n🎵 Playlist ID: ${playlistId}`);

  const oldState = loadState(playlistId);

  if (oldState && !options.force) {
    const lastUpdate = new Date(oldState.lastUpdate);
    const minutesAgo = Math.floor((Date.now() - lastUpdate.getTime()) / 60000);
    console.log(`📅 Last scan: ${minutesAgo} minute(s) ago`);
    console.log(`📊 Previous count: ${oldState.trackCount} tracks`);
  }

  try {
    const startTime = Date.now();

    const { tracks: newTracks, playlistName, playlistImage } = await fetchAllTracks(playlistId);

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`⚡ Duration: ${duration}s`);

    if (newTracks.length === 0) {
      throw new Error('No tracks found!');
    }

    console.log(`📝 Playlist: "${playlistName}"`);

    const tracksWithPositions = newTracks.map((track, index) => ({
      ...track,
      position: index + 1
    }));

    let hasChanges = true;
    let changes = null;

    if (oldState && !options.force) {
      changes = compareTrackLists(oldState.tracks, tracksWithPositions);
      hasChanges = printDiffReport(changes, playlistName);

      if (!hasChanges) {
        console.log('\n✓ Playlist is up to date (no changes)');
        return;
      }
    } else if (options.force) {
      console.log('\n🔄 Force mode: Overwriting existing data');
    } else {
      console.log('\n✨ First scan of this playlist');
    }

    const playlistImagePath = await downloadPlaylistCover(playlistId, playlistImage);

    saveState(playlistId, tracksWithPositions, { name: playlistName, image: playlistImage, imagePath: playlistImagePath });
    const filePath = writePlaylistFile(playlistId, tracksWithPositions, playlistName, playlistImage, playlistImagePath);

    console.log(`\n✅ Successfully saved:`);
    console.log(`   📄 ${filePath}`);
    console.log(`   💾 data/${playlistId}.json`);

    if (changes && changes.added.length > 0) {
      console.log(`\n💡 ${changes.added.length} new track(s) found!`);
      console.log(`   Start download with: bun downloader.js ${playlistId}`);
    }

  } catch (error) {
    console.error('\n❌ Scraping error:', error.message);

    if (error.message.includes('GraphQL') || error.message.includes('token')) {
      console.error('\n💡 Tip: If the API no longer works:');
      console.error('   Use old version: bun scraper.old.js <URL>');
    }

    throw error;
  }
}

function printUsage() {
  console.log(`
Spotify Playlist Scraper (GraphQL Version)

Usage:
  bun scraper.js <PLAYLIST_URL> [OPTIONS]

Options:
  --force         Ignores saved state and scrapes everything from scratch
  --help          Shows this help message

Examples:
  bun scraper.js https://open.spotify.com/playlist/37i9dQZF1DWSTqUqJcxFk6
  bun scraper.js https://open.spotify.com/playlist/37i9dQZF1DWSTqUqJcxFk6 --force

Output:
  playlists/<PLAYLIST_ID>.json   Track list with URLs as JSON
  data/<PLAYLIST_ID>.json        State file for incremental updates

Technology:
  ⚡ Uses Spotify's GraphQL API (minimal browser automation only for token)
  🚀 30x faster than old Playwright version
  🛡️ Robust against website changes
`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    printUsage();
    process.exit(args.length === 0 ? 1 : 0);
  }

  const playlistUrl = args[0];
  const options = {
    force: args.includes('--force')
  };

  if (!playlistUrl.includes('open.spotify.com/playlist/')) {
    console.error('❌ Invalid Spotify playlist URL!');
    console.log('URL must contain open.spotify.com/playlist/');
    process.exit(1);
  }

  scrapePlaylist(playlistUrl, options)
    .then(() => {
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Scraping failed:', error.message);
      process.exit(1);
    });
}
