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
      .scene .mirrored { transform: scaleX(-1); }
      .empty { padding:16px; font-style:italic; }
      .overlay { position:absolute; left:6px; top:6px; background:rgba(0,0,0,.45); padding:2px 6px; border-radius:4px; font-size:10px; letter-spacing:.5px; }
      
      .timer {
        position: absolute;
        top: 34%;
        left: 50%;
        transform: translateX(-50%);
        font-family: monospace;
        font-size: 32px;
        line-height: 1;
        letter-spacing: 2px;
        color: #ff3333;
        text-shadow:
          -2px -2px 0 #990000,
           2px -2px 0 #990000,
          -2px  2px 0 #990000,
           2px  2px 0 #990000,
          0    -2px 0 #cc0000,
          0     2px 0 #cc0000,
          -2px  0   0 #cc0000,
           2px  0   0 #cc0000;
        -webkit-font-smoothing: none;
        -moz-osx-font-smoothing: grayscale;
        text-rendering: optimizeSpeed;
        z-index: 10;
      }
      
      /* Wrapper controls position/scale; inner .character handles sprite frames */
      .character-wrap {
        position: absolute;
        width: 128px;
        height: 128px;
        left: 50%;
        top: 68%; /* Lowered to be on the road */
        transform: translate(-50%, -50%) scale(2.2); /* Centered and enlarged */
        will-change: transform;
      }
      .character-wrap.jumping {
        animation: jump-motion 0.45s ease-out forwards;
      }
      .character-wrap.falling {
        animation: fall-motion 0.5s ease-in forwards;
      }

      .character {
        width: 128px;
        height: 128px;
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
      .character.attack {
        animation: attack-anim 0.8s steps(10) infinite;
      }
      .character.attack-twice {
        animation: attack-anim 0.8s steps(10) 2 forwards;
      }
      .character.jump {
        animation: jump-anim 0.45s steps(3) forwards;
      }
      .character.fall {
        animation: fall-anim 0.5s steps(5) forwards;
      }

      @keyframes idle-anim {
        from { background-position: 0px 0px; }
        to { background-position: -768px 0px; } /* 6 frames * 128px */
      }
      @keyframes walk-anim {
        from { background-position: 0px -128px; }
        to { background-position: -1024px -128px; } /* 8 frames * 128px */
      }
      /* Vertical motion for smoother jump/fall */
      @keyframes jump-motion {
        from { transform: translate(-50%, -50%) scale(2.2) translateY(0px); }
        to   { transform: translate(-50%, -50%) scale(2.2) translateY(-22px); }
      }
      @keyframes fall-motion {
        0%   { transform: translate(-50%, -50%) scale(2.2) translateY(-22px); }
        70%  { transform: translate(-50%, -50%) scale(2.2) translateY(0px); }
        85%  { transform: translate(-50%, -50%) scale(2.2) translateY(3px); }
        100% { transform: translate(-50%, -50%) scale(2.2) translateY(0px); }
      }
      @keyframes jump-anim {
        from { background-position: 0px -512px; }
        to { background-position: -384px -512px; } /* 3 frames * 128px */
      }
      @keyframes fall-anim {
        from { background-position: 0px -640px; }
        to { background-position: -640px -640px; } /* 5 frames * 128px */
      }
      @keyframes attack-anim {
        from { background-position: 0px -896px; }
        to { background-position: -1280px -896px; } /* 10 frames * 128px */
      }
    `;
  const stack = layers.map(u => `<img src="${u}" draggable="false" />`).join('\n');
  const characterHtml = `<div class="character-wrap"><div class="character idle"></div></div>`;
    const timerHtml = `<div class="timer">01:00:00</div>`;
    const script = /* js */ `(() => {
      const scene = document.querySelector('.scene');
      const vp = document.querySelector('.viewport');
      const first = scene.querySelector('img');
  const characterWrap = document.querySelector('.character-wrap');
  const character = document.querySelector('.character');
      const timer = document.querySelector('.timer');

      // Timer state
      let timerSeconds = 3600; // 1 hour in seconds

      function formatTime(seconds) {
        const hours = Math.floor(seconds / 3600);
        const mins = Math.floor((seconds % 3600) / 60);
        const secs = seconds % 60;
        return hours.toString().padStart(2, '0') + ':' + 
               mins.toString().padStart(2, '0') + ':' + 
               secs.toString().padStart(2, '0');
      }

      function updateTimer() {
        if (timerSeconds > 0) {
          timerSeconds--;
          timer.textContent = formatTime(timerSeconds);
        } else {
          timer.textContent = '00:00:00';
          // keep red tone when finished
          timer.style.color = '#ff3333';
          stopTimer();
        }
      }

      // Initialize timer display and controller
      timer.textContent = formatTime(timerSeconds);
      let timerInterval = null;
      function startTimer() {
        if (timerInterval || timerSeconds <= 0) return;
        timerInterval = setInterval(updateTimer, 1000);
      }
      function stopTimer() {
        if (timerInterval) {
          clearInterval(timerInterval);
          timerInterval = null;
        }
      }

  // Timer starts on user activity and pauses when tab hidden

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
  let airborne = false; // true between jump start and fall end

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
    // ensure on-ground pose
    characterWrap.classList.remove('jumping', 'falling');
            airborne = false;
            startTimer();
            break;
          case 'stopWalking':
            if (character.classList.contains('walk')) {
              character.className = 'character jump';
              characterWrap.classList.remove('falling');
              // trigger upward motion
              characterWrap.classList.add('jumping');
              airborne = true;
            }
            walking = false;
            break;
        }
      });

      character.addEventListener('animationend', () => {
        if (character.classList.contains('jump')) {
          // After jump frames, begin fall frames
          character.className = 'character fall';
          // switch wrapper from jumping to falling
          characterWrap.classList.remove('jumping');
          characterWrap.classList.add('falling');
          return;
        }
        if (character.classList.contains('fall') || character.classList.contains('attack-twice')) {
          // Finish motion and land
          character.className = walking ? 'character walk' : 'character idle';
          characterWrap.classList.remove('jumping', 'falling');
          airborne = false;
        }
      });

  document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
          stopTimer();
          if (!walking) {
    characterWrap.classList.remove('jumping', 'falling');
            character.className = 'character attack';
            airborne = false;
          }
        } else {
          if (character.classList.contains('attack')) {
            character.className = 'character attack-twice';
          }
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
        // Only clamp vertically, allow horizontal to be infinite
        const halfH = visibleH / 2;
        cameraY = Math.max(halfH, Math.min(worldH - halfH, cameraY));
        // No horizontal clamping for infinite scrolling
      }

      function applyCameraTransform() {
        const patternWidth = worldW * 2;
        const effectiveX = ((cameraX % patternWidth) + patternWidth) % patternWidth;

        const ox = effectiveX - visibleW / 2;
        const oy = cameraY - visibleH / 2;
        const tx = -ox * scale;
        const ty = -oy * scale;

        scene.style.transform = 'translate(' + tx + 'px, ' + ty + 'px) scale(' + scale + ')';

        layerEls.forEach((el, i) => {
          const f = parallaxFactor(i);
          const parallaxX = cameraX * (1 - f);
          const segmentWidth = worldW;
          const currentSegment = Math.floor(parallaxX / segmentWidth);

          ensureDuplicate(el, i, currentSegment -1);
          ensureDuplicate(el, i, currentSegment);
          ensureDuplicate(el, i, currentSegment + 1);
        });
      }

      const layerSegments = {};
      function ensureDuplicate(el, layerIndex, segmentIndex) {
        const key = layerIndex + '-' + segmentIndex;
        let segment = layerSegments[key];

        if (!segment) {
            segment = el.cloneNode(true);
            segment.style.position = 'absolute';
            scene.appendChild(segment);
            layerSegments[key] = segment;
        }

        const isMirrored = segmentIndex % 2 !== 0;
        segment.style.left = (segmentIndex * worldW) + 'px';
        if (isMirrored) {
            segment.style.transform = 'scaleX(-1)';
        } else {
            segment.style.transform = 'scaleX(1)';
        }
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
        // While airborne, continue moving forward a bit for a projectile feel
        if (airborne) {
          const airSpeed = walkSpeed * 0.35; // 35% of walk speed
          targetCameraX += airSpeed * dt;
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
      ${layers.length ? `<div class="root"><div class="viewport"><div class="scene">${stack}</div>${characterHtml}${timerHtml}<div class="overlay">Forest Scene</div></div></div>` : `<div class="empty">No layered background PNGs found.</div>`}
      <script nonce="${nonce}">${script}</script>
    </body></html>`;
  }
}
