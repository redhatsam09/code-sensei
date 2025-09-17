# Code Sensei

> A VS Code companion that keeps you focused with a playful pixel world, responsive character, and gentle nudges as you code.

![Extension Badge](https://img.shields.io/badge/VS%20Code-Extension-1f6feb?logo=visualstudiocode&logoColor=white)
![Pixel Art](https://img.shields.io/badge/Pixel-Art-8A2BE2)
![License](https://img.shields.io/badge/License-MIT-green)

— Keep momentum while you work: Code Sensei reacts to your typing, pauses, and context switches with charming animations and subtle audio cues.

https://github.com/user-attachments/assets/your-youtube-or-demo-video-id

## Installation

Install Code Sensei directly from the VS Code Marketplace — no local build needed:

- Marketplace: https://marketplace.visualstudio.com/items?itemName=your-name.code-sensei
- Or in VS Code, open the Extensions view → search for "Code Sensei" → Install.
- Open the Code Sensei view from the Activity Bar or run `Code Sensei: Open Sensei`.

## Features

- Character reacts to coding activity:
	- Idle → Walks while you type
	- Paused typing → Quick hop/jump animation
	- Switching away from VS Code → Character goes idle; on return, playful reminders
- One-hour session timer that starts on first activity
- Minute marks trigger a celebratory “item use” animation and SFX
- Background music with smart ducking during sound effects
- Gentle “away too long” nudge or dramatic “death + restart” if you’ve been gone for a bit
- Infinite-scrolling parallax forest scene with pixel-art crispness

## Configuration

Audio behavior is handled automatically:

- Background music volume: lowered during SFX, restored afterward
- Audio unlocks on your first click if autoplay is blocked

## How It Works

1. The webview renders layered PNGs as an infinitely scrolling scene with per-layer parallax and alternating mirror tiling.
2. A sprite-sheet–driven character animates (idle, walk, jump/fall, item use, multi-step death).
3. Editor activity events drive state:
	 - Typing starts walking; pauses trigger a hop.
	 - Window focus loss marks you as away; returning within a minute triggers a playful “attack,” longer away triggers the death sequence and a restart prompt.
4. A session timer is visible only after you click Start; it pauses when the tab loses visibility.
5. The ground line is auto-detected from the front layer, with manual calibration controls and persistence via webview state.

## Usage

1. Open the Code Sensei view and click START.
2. Start coding. The character will walk as you type and the timer will begin.
3. If you step away, come back to a playful nudge—or a dramatic pixel demise if you took too long. You can restart the session anytime via the on-screen button.

## Screenshots

> Drop your captures here to showcase the experience.

![code-sensei](https://github.com/user-attachments/assets/1517875d-64e9-4303-8144-72ddee7b56ae)


## Commands

- `codeSensei.openSensei`: Open the Code Sensei webview

## Development

- Codebase: TypeScript extension (`src/extension.ts`), webview UI generated inline
- Assets: Forest layers (`assets/forest/...`), character sprite sheet (`assets/jotem/...`), audio (`music/...`)
- If you’re contributing, use the standard VS Code Extension workflow (press F5 to launch an Extension Development Host).

## Troubleshooting

- No background visible: ensure assets are present under `assets/forest/Free Pixel Art Forest/PNG/Background layers/`.
- Audio not playing on start: click the START button to unlock audio and re-attempt autoplay.

## Acknowledgements

- Forest art: "Free Pixel Art Forest" pack
- Character sprite sheet: Jotem
- Background and SFX: included under `music/`

Bring a little joy to your coding sessions—train with Code Sensei! 🥋🌲
