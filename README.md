<div align="center">

# 🎵 playlist-sync

**Sync public Spotify playlists locally via YouTube Music**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Bun](https://img.shields.io/badge/Bun-v1.0+-black?logo=bun)](https://bun.sh)
[![yt-dlp](https://img.shields.io/badge/yt--dlp-required-red?logo=youtube)](https://github.com/yt-dlp/yt-dlp)

</div>

---

## 📖 Overview

**playlist-sync** lets you discover and sync public Spotify playlists without using Spotify itself.

- 🔓 Uses the **Spotify Embed API** (public, cookie-free) — no login required
- 🔍 Searches tracks on **YouTube Music** and downloads via **yt-dlp**
- 🏷️ Tags songs with playlist name and cover art
- 📦 Organizes for seamless **Navidrome** playback

Explore new music without tracking or data collection. Support artists directly when you find music you love.

---

## ✨ Features

- ✅ **Anonymous access** — no Spotify login, tokens, or cookies
- 🎧 **YouTube Music search** — finds matching tracks automatically
- ⬇️ **yt-dlp downloads** — uses your YouTube cookies for access
- 🖼️ **Auto-tagging** — adds playlist name and cover art
- 📂 **Navidrome-ready** — organized as albums with metadata

---

## 🚀 Installation

### Prerequisites

| Tool | Description | Link |
|------|-------------|------|
| **Bun** | JavaScript runtime | [bun.sh](https://bun.sh/) |
| **yt-dlp** | Video/audio downloader | [github.com/yt-dlp/yt-dlp](https://github.com/yt-dlp/yt-dlp) |
| **cookies.txt** | YouTube Music cookies | Required for downloads |

### Setup

```bash
# 1. Install dependencies
bun install

# 2. Install yt-dlp (if not already installed)
# macOS/Linux:
brew install yt-dlp
# or: pip install yt-dlp

# Windows:
# Download from https://github.com/yt-dlp/yt-dlp/releases

# Verify installation
yt-dlp --version

# 3. Export YouTube Music cookies
# Use a browser extension like "Get cookies.txt"
# Save as cookies.txt in the project directory

# 4. Configure environment
cp .env.example .env
# Edit .env with your playlist IDs

# 5. Run sync
bun sync

# Or run in background
bun run sync &
```

### Configuration

Edit `.env` with your Spotify playlist IDs:

```env
PLAYLIST_IDS=37i9dQZF1DWSTqUqJcxFk6,37i9dQZF1DXcBWIGoYBM5M
SYNC_INTERVAL_HOURS=6
OUTPUT_DIR=mp3s
```

---

## 📝 Notes

- 🌐 Spotify data is fetched anonymously via the public Embed API
- 🔑 YouTube Music cookies are required only for search and download
- 🎶 Audio quality depends on YouTube's source
- ⚠️ For personal and educational use only — please support artists directly

---

## 📄 License

**MIT** © 2025

---

## 🙏 Acknowledgements

| Project | Purpose |
|---------|---------|
| [Navidrome](https://www.navidrome.org/) | Local music streaming |
| [yt-dlp](https://github.com/yt-dlp/yt-dlp) | Efficient downloads |
| Spotify Embed API | Public playlist metadata |

