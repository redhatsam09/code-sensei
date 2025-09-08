# Forest Sprite Viewer Extension

VS Code extension to browse the bundled Free Pixel Art Forest PNG assets in a custom Activity Bar view ("Forest").

## Run / Debug
1. Install dependencies (one time): npm install
2. Press F5 (Run Forest Sprite Viewer) to launch an Extension Development Host.
3. Click the Forest icon to open the sprite gallery.

## Structure
```
assets/              Extracted forest asset zip (PNG files)
src/extension.ts     Extension activation + view provider
resources/           Icons and static resources
package.json         Extension manifest
tsconfig.json        TypeScript config
.vscode/launch.json  Launch configuration
```

## Notes
- Only PNG files under assets/forest are shown ("You may also like" folder skipped)
- Images rendered with image-rendering: pixelated for crisp pixels.
- No telemetry or external network requests.

## Packaging
Install vsce globally then: vsce package

Enjoy exploring the forest sprites.
