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
}

export function deactivate() {}

class ForestSpritesViewProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  constructor(private readonly context: vscode.ExtensionContext) {}

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
        animation: idle-back 0.8s steps(6) infinite; /* Smoother animation */
      }

      @keyframes idle-back {
        from { background-position: 0px 0px; }
        to { background-position: -768px 0px; } /* 6 frames * 128px */
      }
    `;
    const stack = layers.map(u => `<img src="${u}" draggable="false" />`).join('\n');
    const characterHtml = `<div class="character"></div>`;
    const script = /* js */ `(() => {
      const scene = document.querySelector('.scene');
      const vp = document.querySelector('.viewport');
      const first = scene.querySelector('img');
      function layout() {
        if(!first.complete) { first.addEventListener('load', layout); return; }
        const iw = first.naturalWidth; const ih = first.naturalHeight;
        const vpRect = vp.getBoundingClientRect();
        const scaleW = vpRect.width / iw;
        const scaleH = vpRect.height / ih;
        const scale = Math.max(scaleW, scaleH) * 1.15; // slight zoom
        scene.style.width = iw + 'px';
        scene.style.height = ih + 'px';
        const visibleW = vpRect.width / scale;
        const visibleH = vpRect.height / scale;
        const cx = iw / 2; // center horizontally
        const cy = ih * 0.60; // lower vertical focus
        let ox = cx - visibleW / 2;
        let oy = cy - visibleH / 2;
        ox = Math.max(0, Math.min(iw - visibleW, ox));
        oy = Math.max(0, Math.min(ih - visibleH, oy));
        const tx = -ox * scale;
        const ty = -oy * scale;
        scene.style.transform = \`translate(\${tx}px, \${ty}px) scale(\${scale})\`;
      }
      window.addEventListener('resize', layout);
      layout();
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
