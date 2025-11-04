import { spawn } from 'child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'fs';
import { join } from 'path';
import { getYouTubeMusicSearchClient, closeYouTubeMusicSearchClient } from './lib/youtube-music-search.js';

const OUTPUT_DIR = Bun.env.OUTPUT_DIR || 'mp3s';

function sanitizeFilename(filename) {
  return filename
    .replace(/[<>:"/\\|?*]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 200);
}

async function ensurePlaylistCover(playlistId, playlistImage, outputDir, playlistImagePath = null) {
  if (playlistImagePath && existsSync(playlistImagePath)) {
    return playlistImagePath;
  }

  if (!playlistImage) {
    return null;
  }

  const sanitizedId = sanitizeFilename(playlistId);
  const coverPath = join(outputDir, `${sanitizedId || 'playlist'}-cover.jpg`);

  if (existsSync(coverPath)) {
    return coverPath;
  }

  try {
    const response = await fetch(playlistImage, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
        'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8'
      }
    });

    if (!response.ok) {
      console.warn(`⚠ Could not load playlist cover (${response.status})`);
      return null;
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    writeFileSync(coverPath, buffer);
    return coverPath;
  } catch (error) {
    console.warn(`⚠ Could not load playlist cover: ${error.message}`);
    return null;
  }
}

async function downloadTrackWithYtDlp(track, youtubeUrl, outputDir) {
  return new Promise((resolve, reject) => {
    const baseFilename = sanitizeFilename(`${track.artists} - ${track.title}`);
    const outputTemplate = join(outputDir, `${baseFilename}.%(ext)s`);
    const finalPath = join(outputDir, `${baseFilename}.mp3`);

    const args = [
      youtubeUrl,
      '--no-progress',
      '--newline',
      '--ignore-errors',
      '--extract-audio',
      '--audio-format', 'mp3',
      '--audio-quality', '0',
      '--add-metadata',
      '--output', outputTemplate
    ];

    if (existsSync('cookies.txt')) {
      args.push('--cookies', 'cookies.txt');
    }

    const ytDlp = spawn('yt-dlp', args, {
      stdio: ['ignore', 'inherit', 'inherit']
    });

    console.log('    ▶️  yt-dlp started...');

    ytDlp.on('close', (code) => {
      if (code === 0) {
        resolve({
          success: true,
          outputPath: finalPath
        });
      } else {
        reject(new Error(`yt-dlp exited with code ${code}`));
      }
    });

    ytDlp.on('error', (error) => {
      reject(new Error(`Failed to spawn yt-dlp: ${error.message}`));
    });
  });
}

function formatMetadataValue(value) {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value).replace(/\u0000/g, '').trim();
}

async function applyMetadata(mp3Path, metadata, thumbnailPath, cleanupThumbnail = true) {
  let tempPath;
  if (mp3Path.toLowerCase().endsWith('.mp3')) {
    tempPath = `${mp3Path.slice(0, -4)}.tmp.mp3`;
  } else {
    tempPath = `${mp3Path}.tmp.mp3`;
  }

  const args = [
    '-y',
    '-i', mp3Path
  ];

  const hasArtwork = thumbnailPath && existsSync(thumbnailPath);

  if (hasArtwork) {
    args.push('-i', thumbnailPath);
    args.push('-map', '0:a');
    args.push('-map', '1:v');
    args.push('-c:a', 'copy');
    args.push('-c:v', 'mjpeg');
    args.push('-disposition:v', 'attached_pic');
    args.push('-metadata:s:v', 'title=Album cover');
    args.push('-metadata:s:v', 'comment=Cover (front)');
  } else {
    args.push('-map', '0:a');
    args.push('-c:a', 'copy');
  }

  args.push('-id3v2_version', '3');
  args.push('-map_metadata', '-1');

  Object.entries(metadata).forEach(([key, value]) => {
    const formatted = formatMetadataValue(value);
    if (formatted) {
      args.push('-metadata', `${key}=${formatted}`);
    }
  });

  args.push(tempPath);

  await new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', args, {
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stderr = '';

    ffmpeg.stdout.on('data', () => {});

    ffmpeg.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    ffmpeg.on('close', (code) => {
      if (code === 0) {
        resolve(true);
      } else {
        reject(new Error(stderr || `ffmpeg exited with code ${code}`));
      }
    });

    ffmpeg.on('error', (error) => {
      reject(new Error(`Failed to spawn ffmpeg: ${error.message}`));
    });
  });

  try {
    unlinkSync(mp3Path);
  } catch (error) {
  }

  try {
    renameSync(tempPath, mp3Path);
  } catch (error) {
    if (existsSync(tempPath)) {
      try {
        unlinkSync(tempPath);
      } catch {}
    }
    throw error;
  }

  if (cleanupThumbnail && hasArtwork) {
    try {
      unlinkSync(thumbnailPath);
    } catch {}
  }
}

function isAlreadyDownloaded(playlistId, artists, title) {
  const filename = sanitizeFilename(`${artists} - ${title}.mp3`);
  const filePath = join(OUTPUT_DIR, playlistId, filename);
  return existsSync(filePath);
}

async function downloadNewTracks(playlistId, tracks, playlistName = 'Unknown Playlist', playlistImage = null, playlistImagePath = null) {
  const youtubeSearch = await getYouTubeMusicSearchClient();

  if (tracks.length === 0) {
    console.log('\n✓ No new tracks to download');
    return;
  }

  const outputDir = join(OUTPUT_DIR, playlistId);
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  const playlistCoverPath = await ensurePlaylistCover(playlistId, playlistImage, outputDir, playlistImagePath);

  console.log(`\n🎧 Starting download of ${tracks.length} track(s)...\n`);

  let successCount = 0;
  let skipCount = 0;
  let errorCount = 0;

  for (let i = 0; i < tracks.length; i++) {
    const track = tracks[i];
    const progress = `[${i + 1}/${tracks.length}]`;

    console.log(`${progress} ${track.artists} - ${track.title}`);

    if (isAlreadyDownloaded(playlistId, track.artists, track.title)) {
      console.log('  ⏭ Already exists, skipping\n');
      skipCount++;
      continue;
    }

    try {
      const match = await youtubeSearch.findTrackForSpotifyItem(track);

      if (!match?.youtubeUrl) {
        console.log('  ❌ No YouTube result found\n');
        errorCount++;
        continue;
      }

      console.log(`  🔎 Found: ${match.matchedTitle || 'Unknown'} (${match.videoId})`);
      console.log('  ⬇️  Downloading with yt-dlp...');

      const downloadResult = await downloadTrackWithYtDlp(track, match.youtubeUrl, outputDir);

      const displayTitle = formatMetadataValue(`${track.artists || ''} - ${track.title || ''}`) || track.title;
      const playlistLabel = formatMetadataValue(playlistName) || 'Playlist';
      const artworkPath = playlistCoverPath || null;
      const cleanupArtwork = false;

      await applyMetadata(downloadResult.outputPath, {
        title: displayTitle,
        artist: playlistLabel,
        album: playlistLabel,
        album_artist: playlistLabel,
        comment: match.youtubeUrl
          ? `Source: ${match.youtubeUrl} | Original: ${track.artists} - ${track.title}`
          : `Original: ${track.artists} - ${track.title}`,
        date: new Date().getFullYear()
      }, artworkPath, cleanupArtwork);

      console.log('  ✅ Download successful\n');
      successCount++;
    } catch (error) {
      console.log(`  ❌ ${error.message}\n`);
      errorCount++;
    }

    if (i < tracks.length - 1) {
      const delay = 2000 + Math.random() * 1000;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`✅ Successful: ${successCount}`);
  console.log(`⏭  Skipped: ${skipCount}`);
  console.log(`❌ Errors: ${errorCount}`);
  console.log(`📁 Output directory: ${outputDir}`);
}

export async function downloadPlaylistTracks(playlistId, newTracks = null, playlistName = null) {
  const statePath = join('data', `${playlistId}.json`);

  if (!existsSync(statePath)) {
    console.error('❌ No state file found. Run scraper.js first.');
    process.exit(1);
  }

  const state = JSON.parse(readFileSync(statePath, 'utf-8'));

  if (!newTracks) {
    newTracks = state.tracks;
  }

  if (!playlistName) {
    playlistName = state.playlistName || 'Unknown Playlist';
  }

  try {
    await downloadNewTracks(
      playlistId,
      newTracks,
      playlistName,
      state.playlistImage || null,
      state.playlistImagePath || null
    );
  } finally {
    await closeYouTubeMusicSearchClient();
  }
}

function printUsage() {
  console.log(`
Spotify Playlist Downloader

Usage:
  bun downloader.js <PLAYLIST_ID>

Example:
  bun downloader.js 37i9dQZF1DWSTqUqJcxFk6

Note:
  Playlist must be scraped with scraper.js first.
  Downloads are saved to <OUTPUT_DIR>/<PLAYLIST_ID>/ (default: mp3s/<PLAYLIST_ID>/)
  Requires yt-dlp + ffmpeg in PATH.
`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    printUsage();
    process.exit(args.length === 0 ? 1 : 0);
  }

  const playlistId = args[0];

  downloadPlaylistTracks(playlistId)
    .then(() => {
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Download failed:', error.message);
      process.exit(1);
    });
}
