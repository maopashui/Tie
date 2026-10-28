# Tie

[中文](docs/README.zh.md)

Cross-platform SSH / SFTP desktop client. The UI is Tauri 2 + React, the protocol stack is `russh` + `russh-sftp`, and the terminal is rendered with xterm.js.

## Screenshots

Session list and quick connect:

<img src="docs/screenshots/home.png" alt="Session list" width="720">

SSH terminal:

<img src="docs/screenshots/ssh.png" alt="SSH terminal" width="720">

Two-pane SFTP:

<img src="docs/screenshots/sftp.png" alt="SFTP" width="720">

Command reference:

<img src="docs/screenshots/command.png" alt="Commands" width="720">

## Scope

- Interactive SSH terminal (password / private key, app-local `known_hosts`, host-key confirmation)
- Two-pane SFTP browse, plus single-file upload and download (cancellable; recorded in SQLite when finished)
- Sessions and groups (SQLite + the system keychain)
- Local shell still lives in `tie-pty` and is not wired into the desktop UI yet

## Requirements

- Rust stable
- Node.js 22+

## Development

```bash
cd apps/desktop
npm install
npm run tauri dev
```

Checks:

```bash
cargo test -p tie-store -p tie-ssh -p tie-desktop
cd apps/desktop && npm run check && npm run build
```

## Packaging

Run this on the target operating system. The output is a graphical app you launch by double-clicking. Do not start the bundled executable from a terminal.

```bash
cd apps/desktop
npm install
npm run tauri build
```

Release builds on Windows use the GUI subsystem, so double-clicking does not open a console. `npm run tauri dev` still attaches a terminal; that is only for development.

### macOS

Xcode command-line tools must be installed.

Artifacts:

- `src-tauri/target/release/bundle/dmg/Tie_0.1.3_<arch>.dmg`
- `src-tauri/target/release/bundle/macos/Tie.app`

Open the dmg, drag `Tie.app` into Applications, then launch it from Launchpad or the Applications folder.

### Windows

Install the Visual Studio "Desktop development with C++" workload, and the WebView2 runtime (usually already present on Windows 11).

Artifacts:

- `src-tauri/target/release/bundle/nsis/Tie_0.1.3_x64-setup.exe`
- an `.msi` under `src-tauri/target/release/bundle/msi/`

Run the installer, then open Tie from the Start menu.

### Linux

On Debian / Ubuntu, install the UI dependencies first:

```bash
sudo apt update
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev patchelf
```

Artifacts are under `src-tauri/target/release/bundle/`:

- `deb/tie_0.1.3_<arch>.deb`: `sudo apt install ./tie_0.1.3_<arch>.deb`, then open Tie from the application menu
- `rpm/`: install with the system rpm installer, then open it from the application menu
- `appimage/tie_0.1.3_<arch>.AppImage`: mark it executable and double-click, or open it from the file manager

The packages register a graphical desktop entry and do not open a terminal window.

## Data locations

- macOS: `~/Library/Application Support/Tie/sessions.db`
- Host keys: `known_hosts` in the same directory. `~/.ssh/known_hosts` is left unchanged
- Windows: `%APPDATA%\Tie\`

Passwords and private-key passphrases are stored only in the operating system credential store.
