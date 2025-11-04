import { scrapePlaylist } from './scraper.js';
import { downloadPlaylistTracks } from './downloader.js';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

async function checkPrerequisites() {
  console.log('🔍 Checking prerequisites...\n');

  // Check if yt-dlp is installed
  try {
    await execAsync('yt-dlp --version');
    console.log('✅ yt-dlp is installed');
  } catch (error) {
    console.error('❌ yt-dlp is not installed or not in PATH');
    console.log('\nPlease install yt-dlp:');
    console.log('  macOS/Linux: brew install yt-dlp');
    console.log('  or:          pip install yt-dlp');
    console.log('  Windows:     https://github.com/yt-dlp/yt-dlp/releases\n');
    process.exit(1);
  }

  // Check if cookies.txt exists
  if (!existsSync('cookies.txt')) {
    console.error('❌ cookies.txt not found');
    console.log('\nPlease export your YouTube Music cookies:');
    console.log('  1. Use a browser extension like "Get cookies.txt"');
    console.log('  2. Save the file as cookies.txt in the project directory\n');
    process.exit(1);
  }
  console.log('✅ cookies.txt found');

  console.log('\n✓ All prerequisites met\n');
}

async function syncPlaylists() {
  const playlistIds = Bun.env.PLAYLIST_IDS?.split(',').map(id => id.trim()).filter(Boolean);

  if (!playlistIds || playlistIds.length === 0) {
    console.error('❌ No playlist IDs configured in .env');
    console.log('\nAdd playlist IDs to .env:');
    console.log('PLAYLIST_IDS=37i9dQZF1DWSTqUqJcxFk6,37i9dQZF1DXcBWIGoYBM5M');
    process.exit(1);
  }

  console.log(`\n🎵 Starting synchronization of ${playlistIds.length} playlist(s)\n`);
  console.log('═══════════════════════════════════════════\n');

  let totalNewTracks = 0;
  const playlistsWithNewTracks = [];

  for (let i = 0; i < playlistIds.length; i++) {
    const playlistId = playlistIds[i];
    const playlistUrl = `https://open.spotify.com/playlist/${playlistId}`;

    console.log(`[${i + 1}/${playlistIds.length}] Playlist: ${playlistId}`);
    console.log('───────────────────────────────────────────');

    try {
      const statePath = join('data', `${playlistId}.json`);
      const isFirstRun = !existsSync(statePath);
      let oldState = null;

      if (!isFirstRun) {
        oldState = JSON.parse(readFileSync(statePath, 'utf-8'));
      }

      console.log('\n📋 Step 1: Loading Spotify data...');
      await scrapePlaylist(playlistUrl);

      const state = JSON.parse(readFileSync(statePath, 'utf-8'));
      let newTracks = [];

      if (isFirstRun) {
        newTracks = state.tracks;
        console.log(`\n🎧 Step 2: First scan - downloading all ${newTracks.length} track(s)...\n`);
      } else {
        const oldIds = new Set(oldState.tracks.map(t => t.id));
        newTracks = state.tracks.filter(t => !oldIds.has(t.id));

        if (newTracks.length > 0) {
          console.log(`\n🎧 Step 2: Downloading ${newTracks.length} new track(s)...\n`);
        }
      }

      if (newTracks.length > 0) {
        totalNewTracks += newTracks.length;
        playlistsWithNewTracks.push({ playlistId, tracks: newTracks });

        await downloadPlaylistTracks(playlistId, newTracks, state.playlistName);
      } else {
        console.log('\n✓ No new tracks to download');
      }

      console.log('\n✅ Playlist synchronized\n');

    } catch (error) {
      console.error(`\n❌ Error with playlist ${playlistId}:`, error.message);
    }

    if (i < playlistIds.length - 1) {
      console.log('\n═══════════════════════════════════════════\n');
    }
  }

  console.log('\n═══════════════════════════════════════════');
  console.log('📊 Synchronization completed\n');
  console.log(`   Playlists processed: ${playlistIds.length}`);
  console.log(`   New tracks found: ${totalNewTracks}`);
  console.log(`   Playlists with new tracks: ${playlistsWithNewTracks.length}`);
  console.log('═══════════════════════════════════════════\n');
}

async function main() {
  // Check prerequisites once at startup
  await checkPrerequisites();

  const SYNC_INTERVAL_HOURS = parseInt(Bun.env.SYNC_INTERVAL_HOURS || '6', 10);

  while (true) {
    try {
      await syncPlaylists();
    } catch (error) {
      console.error('\n💥 Synchronization failed:', error.message);
    }

    const nextRun = new Date(Date.now() + SYNC_INTERVAL_HOURS * 3600000);
    console.log(`⏰ Next sync scheduled at: ${nextRun.toLocaleString()}`);
    console.log(`   Waiting ${SYNC_INTERVAL_HOURS} hour(s)...\n`);

    await new Promise(resolve => setTimeout(resolve, SYNC_INTERVAL_HOURS * 3600000));
  }
}

main();
