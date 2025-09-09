import * as vscode from 'vscode';
import * as path from 'path';

export function activate(context: vscode.ExtensionContext) {
  const provider = new ForestSpritesViewProvider(context);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('forestSpritesView', provider)
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('forestSprites.openForest', async () => {
      provider.reveal();
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument(() => {
      provider.onUserActivity();
    })
  );
}

export function deactivate() {}

class ForestSpritesViewProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private activityTimeout?: NodeJS.Timeout;
  constructor(private readonly context: vscode.ExtensionContext) {}

  public onUserActivity() {
    if (!this.view) {
      return;
    }

    // User is typing, start walking
    this.view.webview.postMessage({ command: 'startWalking' });

    // Clear previous timer
    if (this.activityTimeout) {
      clearTimeout(this.activityTimeout);
    }

    // Set a new timer to detect when typing stops
    this.activityTimeout = setTimeout(() => {
      if (this.view) {
        this.view.webview.postMessage({ command: 'stopWalking' });
      }
    }, 1500); // 1.5 seconds of inactivity
  }

  public reveal() {
    if (this.view) {
      this.view.show?.(true);
    } else {
      vscode.commands.executeCommand('workbench.view.extension.forestSprites');
    }
  }

  async resolveWebviewView(webviewView: vscode.WebviewView) {
    this.view = webviewView;
    const { webview } = webviewView;
    webview.options = { enableScripts: true };

    const sceneLayers = await this.buildSceneLayerUris(webview);
    const characterSheetUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'assets', 'jotem', 'Jotem spritesheet.png'));
    webview.html = this.renderSceneHtml(webview, sceneLayers, characterSheetUri);
  }

  private async buildSceneLayerUris(webview: vscode.Webview): Promise<vscode.Uri[]> {
    const baseDir = vscode.Uri.joinPath(this.context.extensionUri, 'assets', 'forest', 'Free Pixel Art Forest', 'PNG', 'Background layers');
    let entries: [string, vscode.FileType][] = [];
    try {
      entries = await vscode.workspace.fs.readDirectory(baseDir);
    } catch {
      return [];
    }
    const pngs = entries
      .filter(e => e[1] === vscode.FileType.File && e[0].toLowerCase().endsWith('.png'))
      .map(e => e[0])
      .sort((a, b) => this.layerSortKey(a) - this.layerSortKey(b));

    return pngs.map(name => webview.asWebviewUri(vscode.Uri.joinPath(baseDir, name)));
  }

  private layerSortKey(name: string): number {
    const numMatch = name.match(/_(\d+)\.png$/i);
    if (numMatch) return parseInt(numMatch[1], 10);
    if (/lights/i.test(name)) return 9999;
    return 5000;
  }

  // Simplified fullscreen scene focused slightly lower (road) and slightly zoomed
  private renderSceneHtml(webview: vscode.Webview, layers: vscode.Uri[], characterSheetUri: vscode.Uri): string {
    const nonce = Date.now().toString(36);
    const style = /* css */ `
      html, body { height:100%; }
      body { padding:0; margin:0; font-family:system-ui,sans-serif; background:#0c140c; color:#cfe8cf; overflow:hidden; }
      .root { position:absolute; inset:0; }
      .viewport { position:absolute; inset:0; overflow:hidden; }
      .scene { position:absolute; left:0; top:0; transform-origin: top left; image-rendering:pixelated; }
      .scene img { position:absolute; inset:0; width:100%; height:100%; image-rendering:pixelated; }
      .empty { padding:16px; font-style:italic; }
      .overlay { position:absolute; left:6px; top:6px; background:rgba(0,0,0,.45); padding:2px 6px; border-radius:4px; font-size:10px; letter-spacing:.5px; }
      
      .character {
        position: absolute;
        width: 128px;
        height: 128px;
        left: 50%;
        top: 68%; /* Lowered to be on the road */
        transform: translate(-50%, -50%) scale(2.2); /* Centered and enlarged */
        background-image: url(${characterSheetUri});
        background-repeat: no-repeat;
        image-rendering: pixelated; /* Keep pixels sharp */
      }

      .character.idle {
        animation: idle-anim 1s steps(6) infinite;
      }
      .character.walk {
        animation: walk-anim 0.9s steps(8) infinite;
      }
      .character.jump {
        animation: jump-anim 0.5s steps(3) forwards;
      }

      @keyframes idle-anim {
        from { background-position: 0px 0px; }
        to { background-position: -768px 0px; } /* 6 frames * 128px */
      }
      @keyframes walk-anim {
        from { background-position: 0px -128px; }
        to { background-position: -1024px -128px; } /* 8 frames * 128px */
      }
      @keyframes jump-anim {
        from { background-position: 0px -512px; }
        to { background-position: -384px -512px; } /* 3 frames * 128px */
      }
    `;
    const stack = layers.map(u => `<img src="${u}" draggable="false" />`).join('\n');
    const characterHtml = `<div class="character idle"></div>`;
    const script = /* js */ `(() => {
      const scene = document.querySelector('.scene');
      const vp = document.querySelector('.viewport');
      const first = scene.querySelector('img');
      const character = document.querySelector('.character');

      // State
      let scale = 1;
      let worldW = 0, worldH = 0;
      let visibleW = 0, visibleH = 0;
      let cameraX = 0; // camera center x in world coords
      let cameraY = 0; // camera center y in world coords
      let targetCameraX = 0;
      const characterWorldYFactor = 0.60; // lower focus
      const characterWorldXStartFactor = 0.25; // start a bit from left then scroll
      const walkSpeed = 140; // pixels / second world units
      let velocityX = 0;
      let walking = false;

      // Parallax factors per layer (front moves more). If layer count > factors length we interpolate.
      const layerEls = Array.from(scene.querySelectorAll('img'));
      function parallaxFactor(idx) {
        if (layerEls.length <= 1) return 1;
        // Back layers (idx 0) move less, front (last) moves most.
        const t = idx / (layerEls.length - 1);
        return 0.25 + t * 0.75; // 0.25 .. 1.0
      }

      window.addEventListener('message', event => {
        const message = event.data;
        switch (message.command) {
          case 'startWalking':
            if (!character.classList.contains('walk')) {
              character.className = 'character walk';
            }
            walking = true;
            break;
          case 'stopWalking':
            if (character.classList.contains('walk')) {
              character.className = 'character jump';
            }
            walking = false;
            break;
        }
      });

      character.addEventListener('animationend', () => {
        if (character.classList.contains('jump')) {
          character.className = 'character idle';
        }
      });

      function layout() {
        if(!first.complete) { first.addEventListener('load', layout, { once: true }); return; }
        worldW = first.naturalWidth; worldH = first.naturalHeight;
        const vpRect = vp.getBoundingClientRect();
        const scaleW = vpRect.width / worldW;
        const scaleH = vpRect.height / worldH;
        scale = Math.max(scaleW, scaleH) * 1.15; // slight zoom
        scene.style.width = worldW + 'px';
        scene.style.height = worldH + 'px';
        visibleW = vpRect.width / scale;
        visibleH = vpRect.height / scale;
        cameraY = worldH * characterWorldYFactor; // constant vertical focus
        // Re-clamp camera when size changes
        clampCamera();
        applyCameraTransform();
      }

      function clampCamera() {
        const halfW = visibleW / 2;
        const halfH = visibleH / 2;
        cameraX = Math.max(halfW, Math.min(worldW - halfW, cameraX));
        cameraY = Math.max(halfH, Math.min(worldH - halfH, cameraY));
      }

      function applyCameraTransform() {
        const ox = cameraX - visibleW / 2;
        const oy = cameraY - visibleH / 2;
        const tx = -ox * scale;
        const ty = -oy * scale;
        // Instead of scaling container directly we set transform on scene
        scene.style.transform = ` + "`translate(${tx}px, ${ty}px) scale(${scale})`" + `;
        // Parallax: translate each layer slightly based on factor (only horizontal for depth illusion)
        layerEls.forEach((el, i) => {
          const f = parallaxFactor(i);
          el.style.transform = 'translateX(' + ( (cameraX / worldW) * (1 - f) * 100 ) + 'px)';
        });
      }

      function update(dt) {
        // Adjust velocity towards target based on walking flag
        const accel = 600; // px/s^2
        const maxVel = walkSpeed;
        if (walking) {
          velocityX += accel * dt;
        } else {
          velocityX -= accel * dt;
        }
        velocityX = Math.max(0, Math.min(maxVel, velocityX));
        // Move camera forward when near center after initial section
        if (velocityX > 5) {
          targetCameraX += velocityX * dt;
        }
        // Lock initial camera until character reaches start threshold (simulate character moving to center early)
        const desiredStartX = worldW * characterWorldXStartFactor;
        if (targetCameraX < desiredStartX) targetCameraX = desiredStartX;
        cameraX += (targetCameraX - cameraX) * Math.min(1, dt * 5); // smooth follow
        clampCamera();
        applyCameraTransform();
      }

      let lastTs;
      function loop(ts) {
        if (lastTs == null) lastTs = ts;
        const dt = Math.min(0.05, (ts - lastTs) / 1000); // cap large delta
        lastTs = ts;
        if (worldW > 0) update(dt);
        requestAnimationFrame(loop);
      }

      window.addEventListener('resize', layout);
      layout();
      requestAnimationFrame(loop);
    })();`;
    return `<!DOCTYPE html><html><head><meta charset="utf-8" />
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';" />
      <title>Forest Scene</title>
      <style nonce="${nonce}">${style}</style>
    </head><body>
      ${layers.length ? `<div class="root"><div class="viewport"><div class="scene">${stack}</div>${characterHtml}<div class="overlay">Forest Scene</div></div></div>` : `<div class="empty">No layered background PNGs found.</div>`}
      <script nonce="${nonce}">${script}</script>
    </body></html>`;
  }
}
