# Fractals - IPTV Player Application

<p align="center">
  <img src="apps/web/src/assets/icons/icon-tv-256.png" alt="Fractals icon" title="Free IPTV player application" width="128" />
</p>
<p align="center">
  <a href="https://github.com/FractalTV/fractals/releases"><img src="https://img.shields.io/github/release/FractalTV/fractals.svg?style=for-the-badge&logo=github" alt="Release"></a>
  <a href="https://github.com/FractalTV/fractals/releases"><img src="https://img.shields.io/github/v/release/FractalTV/fractals?include_prereleases&label=pre-release&logo=github&style=for-the-badge" /></a>
  <a href="https://github.com/FractalTV/fractals/releases"><img src="https://img.shields.io/github/downloads/FractalTV/fractals/total?style=for-the-badge&logo=github" alt="Releases"></a>
</p>

**Fractals** is a video player application that provides support for IPTV playlist playback (m3u, m3u8). The application allows users to import playlists using remote URLs or by uploading files from the local file system. Additionally, it supports EPG information in XMLTV format which can be provided via URL.

The application is a cross-platform, open-source project built with Electron and Angular.

⚠️ Note: Fractals does not provide any playlists or other digital content. The channels and pictures in the screenshots are for demonstration purposes only.

![Fractals: Channels list, player and epg list](./iptv-dark-theme.png)

## Features

-   M3u and M3u8 playlist support 📺
-   Xtream Code (XC) and Stalker portal (STB) support
-   External player support - MPV, VLC
-   Add playlists from the file system or remote URLs 📂
-   Automatic playlist updates on application startup
-   Channel search functionality 🔍
-   EPG support (TV Guide) with detailed information
-   TV archive/catchup/timeshift functionality
-   Group-based channel list
-   Favorite channels management
-   Global favorites aggregated from all playlists
-   HTML video player with HLS.js support or Video.js-based player
-   Internationalization with support for 16 languages:
    * Arabic
    * Moroccan arabic
    * English
    * Russian
    * German
    * Korean
    * Spanish
    * Chinese
    * Traditional chinese
    * French
    * Italian
    * Turkish
    * Japanese
    * Dutch
    * Belarusian
    * Polish  
-   Custom "User Agent" header configuration for playlists
-   Light and Dark themes
-   Docker version available for self-hosting

## Screenshots:

|                 Welcome screen: Playlists overview                 | Main player interface with channels sidebar and video player  |
| :----------------------------------------------------------------: | :-----------------------------------------------------------: |
|       ![Welcome screen: Playlists overview](./playlists.png)       |   ![Sidebar with channel and video player](./iptv-main.png)   |
|            Welcome screen: Add playlist via file upload            |             Welcome screen: Add playlist via URL              |
| ![Welcome screen: Add playlist via file upload](./iptv-upload.png) | ![Welcome screen: Add playlist via URL](./upload-via-url.png) |
|              EPG Sidebar: TV guide on the right side               |                 General application settings                  |
|         ![EPG: TV guide on the right side](./iptv-epg.png)         |         ![General app settings](./iptv-settings.png)          |
|                         Playlist settings                          |
|         ![Playlist settings](./iptv-playlist-settings.png)         |                                                               |

_Note: First version of the application which was developed as a PWA is available in an extra git branch._

## Download

Download the latest version of the application for macOS, Windows, and Linux from the [release page](https://github.com/FractalTV/fractals/releases).

Alternatively, you can install the application using one of the following package managers:

### Homebrew

```shell
$ brew install fractals
```

### Snap

```shell
$ sudo snap install fractals
```

### Arch

Also available as an Arch PKG, [fractals-bin](https://aur.archlinux.org/packages/fractals-bin/), in the AUR (using your favourite AUR-helper, .e.g. `yay`)

```shell
$ yay -S fractals-bin
```

### Gentoo

You can install Fractals from the [gentoo-zh overlay](https://github.com/microcai/gentoo-zh)

```shell
sudo eselect repository enable gentoo-zh
sudo emerge --sync gentoo-zh
sudo emerge fractals-bin
```

[![Get it from the Snap Store](https://snapcraft.io/static/images/badges/en/snap-store-black.svg)](https://snapcraft.io/fractals)

<a href="https://github.com/FractalTV/fractals" target="_blank">Fractals on GitHub</a>

## Troubleshooting

### macOS: "App is damaged and can't be opened"

Due to Apple's Gatekeeper security and code signing requirements, you may need to remove the quarantine flag from the downloaded application:

```bash
xattr -c /Applications/Fractals.app
```

Alternatively, if the app is located in a different directory:

```bash
xattr -c ~/Downloads/Fractals.app
```

### Linux: chrome-sandbox Issues

If you encounter the following error when launching Fractals:

```
The SUID sandbox helper binary was found, but is not configured correctly.
Rather than run without sandboxing I'm aborting now.
You need to make sure that chrome-sandbox is owned by root and has mode 4755.
```

**Solution 1: Fix chrome-sandbox permissions (Recommended for .deb/.rpm installations)**

Navigate to the Fractals installation directory and run:

```bash
sudo chown root:root chrome-sandbox
sudo chmod 4755 chrome-sandbox
```

**Solution 2: Launch with --no-sandbox flag**

Edit the desktop launcher file to add the `--no-sandbox` flag:

1. Find your desktop file location:
   - **Ubuntu/Debian**: `~/.local/share/applications/fractals.desktop`
   - **System-wide**: `/usr/share/applications/fractals.desktop`

2. Edit the file and modify the `Exec` line:

   ```
   Exec=fractals --no-sandbox %U
   ```

3. Save the file and relaunch the application from your application menu.

Alternatively, you can launch Fractals from the terminal with the flag:

```bash
fractals --no-sandbox
```

## How to Build and Develop

Requirements:

-   Node.js with pnpm (via Corepack)

1. Clone this repository and install project dependencies:

    ```
    $ corepack enable
    $ pnpm install
    ```

2. Start the application:
    ```
    $ pnpm run serve:backend
    ```

This starts the Angular dev server and the Electron app. The Electron window may stay blank for a few seconds while it waits for the dev server to be ready, then the app will load. **Use the Electron window for development**—that is where Xtream Codes and full features work. The Angular dev server also runs at http://localhost:4200 (e.g. for quick UI checks); in the browser, Xtream Codes portals use a different code path and may not work correctly, so prefer the Electron window for Xtream.

**Why do I see multiple “Electron” or “Fractals” processes?** Electron uses one main process plus separate processes for the window (renderer) and sometimes GPU/utility, so 2–4 processes per app is normal. The app also uses a single-instance lock: if you start it again (or run `serve:backend` twice), the new attempt will quit and focus the existing window instead of opening another.

To run only the Angular app without Electron, use:

```
$ pnpm run serve:frontend
```

### Building native installers (Mac & Windows)

From the project root (`src/fractals/`):

1. **Install dependencies and build the app once**
   ```bash
   cd src/fractals
   pnpm install
   pnpm run build:frontend
   pnpm run build:backend
   ```

2. **Mac (Apple Silicon and/or Intel)**  
   Run on a Mac:
   ```bash
   pnpm run make:app
   ```
   - Output: `dist/executables/` (e.g. `Fractals-0.20.0-mac-arm64.dmg`, `Fractals-0.20.0-mac-x64.dmg`).  
   - To build **only Apple Silicon (arm64)**:
     ```bash
     pnpm run make:app:mac:arm64
     ```
   - To build **only Intel Mac (x64)**:
     ```bash
     pnpm run make:app:mac:x64
     ```

3. **Windows (Intel x64)**  
   Run on a Windows machine (same repo, same commands):
   ```bash
   pnpm install
   pnpm run build:frontend
   pnpm run build:backend
   pnpm run make:app
   ```
   - Output: `dist/executables/` (e.g. `Fractals-0.20.0-windows-x64-setup.exe`).  
   - The packaged app is Windows x64 only (see `electron-builder.json`).

**Building Windows from macOS:** You can build the Windows app on a Mac by running:
```bash
pnpm run build:frontend && pnpm run build:backend && pnpm run make:app:win
```
Output in `dist/executables/`: you get at least **`Fractals-0.20.0-win-x64.zip`** (unzip on Windows and run `Fractals.exe`). The **NSIS setup .exe** is built only if [Wine](https://www.winehq.org/) is installed on the Mac (e.g. `brew install --cask wine-stable`); otherwise the zip is the way to ship.

## Disclaimer

**Fractals doesn't provide any playlists or other digital content.**

<!-- ALL-CONTRIBUTORS-BADGE:START - Do not remove or modify this section -->

[![All Contributors](https://img.shields.io/badge/all_contributors-13-orange.svg?style=flat-square)](#contributors)

<!-- ALL-CONTRIBUTORS-BADGE:END -->
