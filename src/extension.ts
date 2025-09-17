import * as vscode from 'vscode';
import * as path from 'path';

export function activate(context: vscode.ExtensionContext) {
  const provider = new ForestSpritesViewProvider(context);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('codeSenseiView', provider)
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('codeSensei.openSensei', async () => {
      provider.reveal();
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument(() => {
      provider.onUserActivity();
    })
  );

  // Track when user switches away from VS Code
  context.subscriptions.push(
    vscode.window.onDidChangeWindowState((state) => {
      if (state.focused) {
        provider.onUserReturn();
      } else {
        provider.onUserAway();
      }
    })
  );
}

export function deactivate() {}

class ForestSpritesViewProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private activityTimeout?: NodeJS.Timeout;
  private awayStartTime?: number;
  private windowAwayStartTime?: number; // Track window focus away separately
  constructor(private readonly context: vscode.ExtensionContext) {}

  public onUserActivity() {
    if (!this.view) {
      return;
    }

    // If returning from window focus away, send return event first so animation can play
    if (this.windowAwayStartTime) {
      const awayDuration = Date.now() - this.windowAwayStartTime;
      const awayMinutes = awayDuration / (1000 * 60);
      this.view.webview.postMessage({ command: 'userReturn', awayMinutes, fromWindowAway: true });
      this.windowAwayStartTime = undefined;
    } else {
      // User is typing, start walking
      this.view.webview.postMessage({ command: 'startWalking' });
    }

    // Clear previous timer
    if (this.activityTimeout) {
      clearTimeout(this.activityTimeout);
    }

    // Reset inactivity away time only if it was set (handled above on return)
    if (this.awayStartTime) {
      this.awayStartTime = undefined;
    }

    // Set a new timer to detect when typing stops
    this.activityTimeout = setTimeout(() => {
      if (this.view) {
        this.view.webview.postMessage({ command: 'stopWalking' });
        // Mark inactivity-away start if not already set (this is just typing pause, not window away)
        if (!this.awayStartTime) {
          this.awayStartTime = Date.now();
        }
      }
    }, 1500); // 1.5 seconds of inactivity
  }

  public onUserAway() {
    // Mark the time when user switches away from VS Code window
    if (!this.windowAwayStartTime) {
      this.windowAwayStartTime = Date.now();
    }
    if (this.view) {
      this.view.webview.postMessage({ command: 'userAway' });
    }
  }

  public onUserReturn() {
    if (!this.view || !this.windowAwayStartTime) {
      return;
    }

    const awayDuration = Date.now() - this.windowAwayStartTime;
    const awayMinutes = awayDuration / (1000 * 60);

    // Send message to webview with away duration
    this.view.webview.postMessage({ 
      command: 'userReturn', 
      awayMinutes: awayMinutes,
      fromWindowAway: true
    });

    // Reset window away time
    this.windowAwayStartTime = undefined;
  }

  public reveal() {
    if (this.view) {
      this.view.show?.(true);
    } else {
      vscode.commands.executeCommand('workbench.view.extension.codeSensei');
    }
  }

  async resolveWebviewView(webviewView: vscode.WebviewView) {
    this.view = webviewView;
    const { webview } = webviewView;
    webview.options = { enableScripts: true };

    // Handle messages from the webview
    webview.onDidReceiveMessage(async (message) => {
      switch (message.command) {
        case 'introSeen':
          // This can be used for other logic if needed in the future
          return;
      }
    });

  const sceneLayers = await this.buildSceneLayerUris(webview);
  const groundConfig = await this.readGroundConfig();
    const characterSheetUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'assets', 'jotem', 'Jotem spritesheet.png'));
    
    const audioUris = {
      intro: webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'music', 'intro.mp3')),
      attack: webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'music', 'attack.mp3')),
      dead: webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'music', 'dead.mp3')),
      good: webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'music', 'good.mp3')),
      bg: webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'music', 'bg.mp3')),
    };

    webview.html = this.renderSceneHtml(webview, sceneLayers, characterSheetUri, audioUris, groundConfig);
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

  private async readGroundConfig(): Promise<any | undefined> {
    const cfgUri = vscode.Uri.joinPath(this.context.extensionUri, 'assets', 'forest', 'Free Pixel Art Forest', 'PNG', 'Background layers', 'ground.json');
    try {
      const data = await vscode.workspace.fs.readFile(cfgUri);
      const txt = Buffer.from(data).toString('utf8');
      return JSON.parse(txt);
    } catch {
      return undefined;
    }
  }

  private layerSortKey(name: string): number {
    const numMatch = name.match(/_(\d+)\.png$/i);
    if (numMatch) return parseInt(numMatch[1], 10);
    if (/lights/i.test(name)) return 9999;
    return 5000;
  }

  // Simplified fullscreen scene focused slightly lower (road) and slightly zoomed
  private renderSceneHtml(webview: vscode.Webview, layers: vscode.Uri[], characterSheetUri: vscode.Uri, audioUris: { [key: string]: vscode.Uri }, groundConfig?: any): string {
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
        display: none; /* hidden until Start is clicked */
      }
      
      /* Text Popup Styling */
      .popup-text {
        position: absolute;
        bottom: 60px; /* Lower above the character's head to avoid restart button */
        left: 50%;
        transform: translateX(-50%);
        font-family: monospace;
        font-size: 11px;
        font-weight: bold;
        color: white;
        text-shadow:
          -1px -1px 0 #000,
           1px -1px 0 #000,
          -1px  1px 0 #000,
           1px  1px 0 #000,
          -2px 0 0 #555,
           2px 0 0 #555,
          0 -2px 0 #555,
           0 2px 0 #555;
        white-space: nowrap;
        z-index: 20;
        opacity: 0;
        -webkit-font-smoothing: none;
        -moz-osx-font-smoothing: grayscale;
        text-rendering: optimizeSpeed;
        pointer-events: none;
      }

      .popup-text.show {
        animation: popup-anim 3s ease-out forwards;
      }

      .popup-text.dead {
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
      }

      @keyframes popup-anim {
        0% {
          opacity: 0;
          transform: translate(-50%, 10px) scale(0.5);
        }
        15% {
          opacity: 1;
          transform: translate(-50%, -10px) scale(1.1);
        }
        85% {
          opacity: 1;
          transform: translate(-50%, -10px) scale(1.1);
        }
        100% {
          opacity: 0;
          transform: translate(-50%, -20px) scale(0.8);
        }
      }

      /* Wrapper controls position/scale; inner .character handles sprite frames */
      .character-wrap {
        position: absolute;
        width: 128px;
        height: 128px;
        left: 50%;
        top: 0; /* exact top set from JS to align with road */
        transform: translateX(-50%) scale(var(--char-scale, 2.2));
        transform-origin: top center;
        will-change: transform, top;
      }
      .character-wrap.jumping .character-motion {
        animation: jump-motion 0.45s ease-out forwards;
      }
      .character-wrap.falling .character-motion {
        animation: fall-motion 0.5s ease-in forwards;
      }

      .character {
        width: 128px;
        height: 128px;
        background-image: url(${characterSheetUri});
        background-repeat: no-repeat;
        image-rendering: pixelated; /* Keep pixels sharp */
      }

      /* Two nested wrappers: character-offset handles baseline compensation per frame; character-motion handles jump/fall motion */
      .character-offset { position: absolute; left: 0; right: 0; bottom: 0; height: 128px; }
      .character-motion { position: absolute; left: 0; right: 0; bottom: 0; height: 128px; will-change: transform; }

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
      .character.item-use {
        animation: item-use-anim 0.8s steps(10) 1 forwards;
      }
      .character.death {
        animation: death-anim-1 0.9s steps(10) 1 forwards;
      }
      .character.death-2 {
        animation: death-anim-2 0.9s steps(10) 1 forwards;
      }
      .character.death-3 {
        animation: death-anim-3 0.9s steps(10) 1 forwards;
      }
      .character.death-4 {
        animation: death-anim-4 0.54s steps(6) 1 forwards; /* 6 frames, 0.09s per frame */
      }
      .character.dead-hold {
        /* Last row: lying dead static frame (last cell/frame 6 of row 11) */
        background-position: -640px -1408px;
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
      /* Vertical motion for smoother jump/fall (applies on .character-motion only) */
      @keyframes jump-motion {
        from { transform: translateY(0px); }
        to   { transform: translateY(-22px); }
      }
      @keyframes fall-motion {
        0%   { transform: translateY(-22px); }
        70%  { transform: translateY(0px); }
        85%  { transform: translateY(3px); }
        100% { transform: translateY(0px); }
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
      /* Item use - 7th line (row index 6), 10 frames */
      @keyframes item-use-anim {
        from { background-position: 0px -768px; }
        to { background-position: -1280px -768px; }
      }
      @keyframes death-anim-1 {
        from { background-position: 0px -1024px; }
        to { background-position: -1280px -1024px; }
      }
      @keyframes death-anim-2 {
        from { background-position: 0px -1152px; }
        to { background-position: -1280px -1152px; }
      }
      @keyframes death-anim-3 {
        from { background-position: 0px -1280px; }
        to { background-position: -1280px -1280px; }
      }
      @keyframes death-anim-4 {
        from { background-position: 0px -1408px; }
        to { background-position: -768px -1408px; } /* 6 frames * 128px */
      }

      /* Restart Button Styling */
      .restart-button {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: linear-gradient(135deg, #8B4513 0%, #A0522D 25%, #CD853F  50%, #A0522D 75%, #654321 100%);
        border: 4px solid #2F1B14;
        border-radius: 8px;
        padding: 12px 24px;
        font-family: monospace;
        font-size: 16px;
        font-weight: bold;
        color: #F5DEB3;
        text-shadow: 
          -1px -1px 0 #2F1B14,
           1px -1px 0 #2F1B14,
          -1px  1px 0 #2F1B14,
           1px  1px 0 #2F1B14;
        cursor: pointer;
        z-index: 100;
        box-shadow: 
          inset 2px 2px 0 #D2B48C,
          inset -2px -2px 0 #654321,
          0 4px 8px rgba(0, 0, 0, 0.3);
        image-rendering: pixelated;
        -webkit-font-smoothing: none;
        -moz-osx-font-smoothing: grayscale;
        text-rendering: optimizeSpeed;
        display: none;
        transition: none;
        user-select: none;
        min-width: 120px;
        text-align: center;
        letter-spacing: 1px;
      }

      .restart-button:hover {
        background: linear-gradient(135deg, #A0522D 0%, #CD853F 25%, #DEB887 50%, #CD853F 75%, #8B4513 100%);
        box-shadow: 
          inset 2px 2px 0 #F5DEB3,
          inset -2px -2px 0 #654321,
          0 6px 12px rgba(0, 0, 0, 0.4);
        transform: translate(-50%, -50%) scale(1.05);
      }

      .restart-button:active {
        background: linear-gradient(135deg, #654321 0%, #8B4513 25%, #A0522D 50%, #8B4513 75%, #654321 100%);
        box-shadow: 
          inset -2px -2px 0 #2F1B14,
          inset 2px 2px 0 #8B4513,
          0 2px 4px rgba(0, 0, 0, 0.2);
        transform: translate(-50%, -50%) scale(0.95);
      }

      .restart-button.show {
        display: block;
        animation: restart-button-appear 0.5s ease-out forwards;
      }

      @keyframes restart-button-appear {
        0% {
          opacity: 0;
          transform: translate(-50%, -50%) scale(0.5);
        }
        50% {
          opacity: 1;
          transform: translate(-50%, -50%) scale(1.1);
        }
        100% {
          opacity: 1;
          transform: translate(-50%, -50%) scale(1);
        }
      }

      /* Intro screen styling */
      .intro-container {
        position: absolute;
        inset: 0;
        z-index: 200;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        font-family: monospace;
      }
      .intro-container.hidden {
        display: none;
      }
      .intro-textbox {
        background: white;
        border: 3px solid black;
        border-radius: 15px;
        padding: 12px 18px;
        max-width: 60%;
        text-align: center;
        margin-bottom: 20px;
        font-family: monospace;
        font-size: 16px;
        font-weight: bold;
        color: black;
        text-shadow:
          0.5px 0.5px 0 #ccc,
          1px 1px 0 #aaa,
          1.5px 1.5px 0 #888;
        -webkit-font-smoothing: none;
        -moz-osx-font-smoothing: grayscale;
        text-rendering: optimizeSpeed;
        image-rendering: pixelated;
      }
      .start-button {
        background: linear-gradient(135deg, #8B4513 0%, #A0522D 25%, #CD853F  50%, #A0522D 75%, #654321 100%);
        border: 4px solid #2F1B14;
        border-radius: 8px;
        padding: 12px 24px;
        font-size: 16px;
        font-weight: bold;
        color: #F5DEB3;
        text-shadow: 
          -1px -1px 0 #2F1B14,
           1px -1px 0 #2F1B14,
          -1px  1px 0 #2F1B14,
           1px  1px 0 #2F1B14;
        cursor: pointer;
        box-shadow: 
          inset 2px 2px 0 #D2B48C,
          inset -2px -2px 0 #654321,
          0 4px 8px rgba(0, 0, 0, 0.3);
        user-select: none;
        text-align: center;
        letter-spacing: 1px;
      }
      .start-button:hover {
        background: linear-gradient(135deg, #A0522D 0%, #CD853F 25%, #DEB887 50%, #CD853F 75%, #8B4513 100%);
      }
      .start-button:active {
        transform: scale(0.95);
      }
      /* Debug ground-line overlay */
      .ground-line { position:absolute; left:0; width:100%; height:1px; background:#ff2a55; z-index:60; pointer-events:none; box-shadow:0 0 0 1px rgba(255,42,85,.15); }
    `;
  const stack = layers.map(u => `<img src="${u}" draggable="false" />`).join('\n');
  const characterHtml = `<div class="character-wrap"><div class="character-offset"><div class="character-motion"><div class="character idle"></div></div></div><div class="popup-text"></div></div>`;
    const timerHtml = `<div class="timer">01:00:00</div>`;
    const restartButtonHtml = `<button class="restart-button" id="restart-btn">RESTART</button>`;
    const groundLineEl = `<div class="ground-line" id="ground-line" style="display:none;"></div>`;
    const introHtml = `
      <div id="intro-container" class="intro-container">
        <div class="intro-textbox">
          <p>Greetings, student! I am Sensei Sam. I will help you master the art of code.</p>
        </div>
        <button id="start-btn" class="start-button">START</button>
      </div>
    `;
    const audioHtml = `
      <audio id="audio-intro" src="${audioUris.intro}" preload="auto"></audio>
      <audio id="audio-attack" src="${audioUris.attack}" preload="auto"></audio>
      <audio id="audio-dead" src="${audioUris.dead}" preload="auto"></audio>
      <audio id="audio-good" src="${audioUris.good}" preload="auto"></audio>
      <audio id="audio-bg" src="${audioUris.bg}" autoplay loop preload="auto"></audio>
    `;
    const script = /* js */ `(() => {
      const vscode = acquireVsCodeApi();
      const initialState = vscode.getState?.() || {};
      const groundConfig = ${JSON.stringify(groundConfig || {})};
      const scene = document.querySelector('.scene');
      const vp = document.querySelector('.viewport');
      const first = scene.querySelector('img');
  const characterWrap = document.querySelector('.character-wrap');
  const characterOffset = document.querySelector('.character-offset');
  const characterMotion = document.querySelector('.character-motion');
  const character = document.querySelector('.character');
      const timer = document.querySelector('.timer');
      const restartButton = document.getElementById('restart-btn');
      const popupText = document.querySelector('.popup-text');
      const introContainer = document.getElementById('intro-container');
      const startButton = document.getElementById('start-btn');

      // Audio elements
      const audioIntro = document.getElementById('audio-intro');
      const audioAttack = document.getElementById('audio-attack');
      const audioDead = document.getElementById('audio-dead');
      const audioGood = document.getElementById('audio-good');
      const audioBg = document.getElementById('audio-bg');
      const allAudio = [audioIntro, audioAttack, audioDead, audioGood, audioBg];
      const sfxAudio = [audioIntro, audioAttack, audioDead, audioGood];
      let audioUnlocked = false;

      // Game state flag
      let gameStarted = false;

      function unlockAudio() {
        if (audioUnlocked) return;
        allAudio.forEach(audio => {
          audio.play().catch(() => {});
          audio.pause();
          audio.currentTime = 0;
        });
        audioUnlocked = true;
      }

      // Autoplay background music handler
      audioBg.volume = 0.3;
      audioBg.play().catch(error => {
        console.log('Autoplay for background music was prevented.', error);
        // If autoplay is prevented, we'll try to start it on the first user interaction.
      });

      // Audio ducking logic
      function duckBgMusic() {
        audioBg.volume = 0.1;
      }
      function restoreBgMusic() {
        audioBg.volume = 0.3;
      }

      sfxAudio.forEach(sfx => {
        sfx.addEventListener('play', duckBgMusic);
        sfx.addEventListener('ended', restoreBgMusic);
        sfx.addEventListener('pause', restoreBgMusic); // Also restore if paused manually
      });

      startButton.addEventListener('click', () => {
        unlockAudio();
        audioIntro.play();
        // If bg music failed to autoplay, this click will start it.
        audioBg.play().catch(()=>{});
        introContainer.classList.add('hidden');
        gameStarted = true;
        vscode.postMessage({ command: 'introSeen' });
        showPopup('Lets start kid!');
        // Show timer only after game has started
        timer.style.display = 'block';
      });

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
          // On each minute boundary (e.g., 00:59:00), play item-use animation
          if (timerSeconds > 0 && (timerSeconds % 60) === 0) {
            playItemUse();
          }
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

  function playItemUse() {
        // Don't allow actions if game hasn't started
        if (!gameStarted) return;
        
        // Avoid interrupting death sequences or if character is dead
        if (isDead || 
            character.classList.contains('death') ||
            character.classList.contains('death-2') ||
            character.classList.contains('death-3') ||
            character.classList.contains('death-4') ||
            character.classList.contains('dead-hold')) {
          return;
        }
        // Ground the character and play item-use
        walking = false ? walking : walking; // no-op; preserve walking flag
        characterWrap.classList.remove('jumping', 'falling');
        airborne = false;
        character.className = 'character item-use';
        showPopup('Good work!!');
        audioGood.play();
      }

      // Restart game function
      function restartGame() {
        // Reset timer
        timerSeconds = 3600; // 1 hour
        timer.textContent = formatTime(timerSeconds);
        timer.style.color = '#ff3333';
        // Hide timer again until Start is clicked
        timer.style.display = 'none';
        
        // Stop and restart timer if it was running
        stopTimer();
        
        // Reset character state
        walking = false;
        airborne = false;
        isDead = false; // Reset dead state
        gameStarted = false; // Reset game started flag
        velocityX = 0;
        character.className = 'character idle';
        characterWrap.classList.remove('jumping', 'falling');
        
        // Reset camera position to starting point
        const desiredStartX = worldW * characterWorldXStartFactor;
        cameraX = desiredStartX;
        targetCameraX = desiredStartX;
        
        // Hide restart button and show intro again
        restartButton.classList.remove('show');
        introContainer.classList.remove('hidden');
        
        // Apply camera transform to snap back to start
        clampCamera();
        applyCameraTransform();
      }

      // Add restart button click handler
      restartButton.addEventListener('click', restartGame);

      function showPopup(text, isDead = false) {
        popupText.textContent = text;
        popupText.classList.remove('dead', 'show');
        if (isDead) {
          popupText.classList.add('dead');
        }
        // Trigger reflow to restart animation
        void popupText.offsetWidth;
        popupText.classList.add('show');
      }

  // Timer starts on user activity and pauses when tab hidden

      // State
      let scale = 1;
  let worldW = 0, worldH = 0;
  let visibleW = 0, visibleH = 0;
  let cameraX = 0; // camera center x in world coords
  let cameraY = 0; // camera center y in world coords
  let targetCameraX = 0;
      const groundFallbackFactor = 0.72; // tuned default if detection unavailable
  let detectedGroundWorldY = null; // set after analyzing front layer
      let configuredGroundWorldY = null; // from ground.json or state override
      if (groundConfig) {
        if (typeof groundConfig.groundWorldY === 'number') configuredGroundWorldY = groundConfig.groundWorldY;
        // Support fraction 0..1 config too
        if (typeof groundConfig.groundFraction === 'number') {
          // will be applied after worldH known
          configuredGroundWorldY = null; // mark for later
        }
      }
      // Load persisted override from webview state if present
      // Do not auto-apply session override by default; user can opt in with Shift+O
      const characterWorldXStartFactor = 0.25; // start a bit from left then scroll
      const walkSpeed = 140; // pixels / second world units
  let velocityX = 0;
  let walking = false;
  let airborne = false; // true between jump start and fall end
  let isDead = false; // Track if character is dead
  const groundOffsetFrac = 0.18; // road appears ~18% below viewport center

      // Parallax factors per layer (front moves more). If layer count > factors length we interpolate.
      const layerEls = Array.from(scene.querySelectorAll('img'));
      function parallaxFactor(idx) {
        if (layerEls.length <= 1) return 1;
        // Back layers (idx 0) move less, front (last) moves most.
        const t = idx / (layerEls.length - 1);
        return 0.25 + t * 0.75; // 0.25 .. 1.0
      }

      // Attempt to auto-detect the ground/road Y from the front-most layer by scanning alpha
      let groundDetectStarted = false;
      function startGroundDetection() {
        if (groundDetectStarted || !layerEls.length) return;
        groundDetectStarted = true;
        const front = layerEls[layerEls.length - 1];
        const img = new Image();
        // Some webviews allow canvas readback on same-origin URIs; if not, we fall back silently
        try { img.crossOrigin = 'anonymous'; } catch {}
        img.onload = () => {
          try {
            const w = img.naturalWidth, h = img.naturalHeight;
            const canvas = document.createElement('canvas');
            canvas.width = w; canvas.height = h;
            const ctx = canvas.getContext('2d');
            if (!ctx) throw new Error('ctx');
            ctx.drawImage(img, 0, 0);
            // Sample three vertical columns and take the maximum non-transparent Y near the bottom
            const xs = [Math.floor(w*0.3), Math.floor(w*0.5), Math.floor(w*0.7)];
            const ys = [];
            for (const x of xs) {
              const col = ctx.getImageData(x, 0, 1, h).data;
              for (let y = h - 1; y >= 0; y--) {
                const a = col[y*4 + 3];
                if (a > 8) { ys.push(y); break; }
              }
            }
            if (ys.length) {
              const y = Math.max.apply(null, ys);
              detectedGroundWorldY = y; // world pixel coordinate in that layer (all layers share dimensions)
              layout(); // re-apply with detected ground
            }
          } catch (_) {
            // ignore; fallback will be used
          }
        };
        img.onerror = () => { /* ignore, use fallback */ };
        img.src = front.getAttribute('src') || '';
      }
      // Kick off detection once base images are present
      startGroundDetection();

  window.addEventListener('message', event => {
        const message = event.data;
        switch (message.command) {
          case 'startWalking':
            // Don't allow actions if game hasn't started or character is dead
            if (!gameStarted || isDead) return;
            
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
            // Don't allow actions if game hasn't started or character is dead
            if (!gameStarted || isDead) return;
            
            if (character.classList.contains('walk')) {
              character.className = 'character jump';
              characterWrap.classList.remove('falling');
              // trigger upward motion
              characterWrap.classList.add('jumping');
              // reset motion before new animation
              characterMotion.style.transform = 'translateY(0px)';
              airborne = true;
            }
            walking = false;
            break;
          case 'userAway':
            // Don't allow actions if game hasn't started or character is dead
            if (!gameStarted || isDead) return;
            
            // User switched away from VS Code - just set to idle, no attack animation
            if (!walking) {
              characterWrap.classList.remove('jumping', 'falling');
              characterMotion.style.transform = 'translateY(0px)';
              character.className = 'character idle';
              airborne = false;
            }
            break;
          case 'userReturn':
            // Don't allow actions if game hasn't started
            if (!gameStarted) return;
            
            // User returned to VS Code
            const awayMinutes = message.awayMinutes || 0;
            const fromWindowAway = message.fromWindowAway || false;
            
            // Stop any walking state and ground the character
            walking = false;
            characterWrap.classList.remove('jumping', 'falling');
            characterMotion.style.transform = 'translateY(0px)';
            airborne = false;
            
            // Only play attack/death animations if returning from window focus away, not typing inactivity
            if (fromWindowAway) {
              if (awayMinutes >= 1) {
                // Away for 1 minute or more - play death animation directly
                // Don't prevent this if character is already dead - allow death animation to restart
                character.className = 'character death';
                audioDead.play();
              } else if (awayMinutes > 0 && !isDead) {
                // Away for less than 1 minute - play attack animation twice (only if not dead)
                character.className = 'character attack-twice';
                showPopup('Hey! Get back here');
                audioAttack.play();
              }
            } else if (!isDead) {
              // Just returning from typing inactivity - go to idle (only if not dead)
              character.className = 'character idle';
            }
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
        if (character.classList.contains('death')) {
          character.className = 'character death-2';
          return;
        }
        if (character.classList.contains('death-2')) {
          character.className = 'character death-3';
          return;
        }
        if (character.classList.contains('death-3')) {
          // Continue to last row 6-frame animation
          character.className = 'character death-4';
          return;
        }
        if (character.classList.contains('death-4')) {
          // Show final dead pose from last row briefly
          character.className = 'character dead-hold';
          characterWrap.classList.remove('jumping', 'falling');
          characterMotion.style.transform = 'translateY(0px)';
          airborne = false;
          isDead = true; // Mark character as dead
          showPopup('dead', true);
          // Hold the dead pose for a moment, then show restart button
          setTimeout(() => {
            restartButton.classList.add('show');
          }, 900);
          return;
        }
        if (character.classList.contains('fall') || character.classList.contains('attack-twice')) {
          // Finish motion and land - return to appropriate state
          character.className = walking ? 'character walk' : 'character idle';
          characterWrap.classList.remove('jumping', 'falling');
          characterMotion.style.transform = 'translateY(0px)';
          airborne = false;
        }
        if (character.classList.contains('item-use')) {
          // After item-use, return to current locomotion state
          character.className = walking ? 'character walk' : 'character idle';
          characterWrap.classList.remove('jumping', 'falling');
          characterMotion.style.transform = 'translateY(0px)';
          airborne = false;
        }
      });
      // Per-frame baseline compensation to keep feet constant despite sprite row jitter
      const frameBaselines = {
        idle: [],
        walk: [],
        attack: [], itemuse: [],
        death1: [], death2: [], death3: [], death4: [],
        jump: [], fall: []
      };
      let baselineReady = false;
      (function computeBaselines(){
        const sheet = new Image();
        try { sheet.crossOrigin = 'anonymous'; } catch {}
        sheet.onload = () => {
          try {
            const w = sheet.naturalWidth, h = sheet.naturalHeight;
            const canvas = document.createElement('canvas');
            canvas.width = w; canvas.height = h;
            const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('ctx');
            ctx.drawImage(sheet, 0, 0);
            function baselineForRow(rowY, frames) {
              const res = [];
              for (let i=0;i<frames;i++) {
                const sx = i*128, sy = rowY;
                const data = ctx.getImageData(sx, sy, 128, 128).data;
                let bottom = 127; // default
                outer: for (let y=127; y>=0; y--) {
                  for (let x=20; x<108; x++) { // focus on middle columns to avoid weapon protrusions
                    const idx = (y*128 + x)*4 + 3;
                    if (data[idx] > 8) { bottom = y; break outer; }
                  }
                }
                res.push(bottom);
              }
              return res;
            }
            frameBaselines.idle = baselineForRow(0, 6);
            frameBaselines.walk = baselineForRow(128, 8);
            frameBaselines.jump = baselineForRow(512, 3);
            frameBaselines.fall = baselineForRow(640, 5);
            frameBaselines.attack = baselineForRow(896, 10);
            frameBaselines.itemuse = baselineForRow(768, 10);
            frameBaselines.death1 = baselineForRow(1024, 10);
            frameBaselines.death2 = baselineForRow(1152, 10);
            frameBaselines.death3 = baselineForRow(1280, 10);
            frameBaselines.death4 = baselineForRow(1408, 6);
            baselineReady = true;
          } catch(_) { baselineReady = false; }
        };
        sheet.onerror = () => { baselineReady = false; };
  sheet.src = '${characterSheetUri}';
      })();

      // Apply baseline compensation based on current animation and frame index
      let lastBgPos = '0px 0px';
      const charScalePx = () => parseFloat(getComputedStyle(characterWrap).getPropertyValue('--char-scale')||'2.2') || 2.2;
      function applyBaselineComp() {
        if (!baselineReady) {
          characterOffset.style.transform = 'translateY(0px)';
          requestAnimationFrame(applyBaselineComp);
          return;
        }
        const style = getComputedStyle(character);
        const bgPos = style.backgroundPosition || style.backgroundPositionX+" "+style.backgroundPositionY;
        if (!bgPos) return;
        // Parse current row (Y) and frame (X)
        const m = bgPos.match(/(-?\d+)px\s+(-?\d+)px/);
        if (!m) { requestAnimationFrame(applyBaselineComp); return; }
        const bx = Math.abs(parseInt(m[1],10));
        const by = Math.abs(parseInt(m[2],10));
        const frame = Math.floor(bx / 128);
        let rowKey = '';
        if (by===0) rowKey='idle';
        else if (by===128) rowKey='walk';
        else if (by===512) rowKey='jump';
        else if (by===640) rowKey='fall';
        else if (by===768) rowKey='itemuse';
        else if (by===896) rowKey='attack';
        else if (by===1024) rowKey='death1';
        else if (by===1152) rowKey='death2';
        else if (by===1280) rowKey='death3';
        else if (by===1408) rowKey='death4';
        const arr = frameBaselines[rowKey] || [];
        const base = arr[Math.min(frame, Math.max(0, arr.length-1))] || 127;
        // Target baseline = max baseline in this row so feet stay consistent
        const target = Math.max(...arr, 127);
        const delta = (target - base) * charScalePx();
        characterOffset.style.transform = 'translateY(' + delta + 'px)';
        requestAnimationFrame(applyBaselineComp);
      }
      requestAnimationFrame(applyBaselineComp);

  document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
          stopTimer();
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
        // Determine ground Y preference order: persisted override > config (px or fraction) > detected > fallback
        let groundWorldY = null;
        if (groundConfig && typeof groundConfig.groundWorldY === 'number') {
          groundWorldY = groundConfig.groundWorldY;
        } else if (groundConfig && typeof groundConfig.groundFraction === 'number') {
          groundWorldY = worldH * groundConfig.groundFraction;
        } else if (detectedGroundWorldY != null) {
          groundWorldY = detectedGroundWorldY;
        } else {
          groundWorldY = worldH * groundFallbackFactor;
        }
        // If user explicitly enabled session override, apply it now
        const state = vscode.getState?.() || {};
        if (state.useGroundOverride && typeof state.groundWorldYOverride === 'number') {
          groundWorldY = state.groundWorldYOverride;
        }
        // Clamp ground within image bounds
        groundWorldY = Math.max(0, Math.min(worldH, groundWorldY));
    cameraY = groundWorldY - (vpRect.height * groundOffsetFrac) / scale;
    // Clamp camera after computing anchor to avoid out-of-bounds
    clampCamera();
        // Compute character absolute top so feet touch the ground line in screen pixels
        const charScale = 2.2; // visual scale
        const spriteH = 128;   // logical sprite height
  const footInset = -24;   // px from bottom to feet (raise character)
        
        // Ground line in screen coordinates: where groundWorldY appears after camera transform
  const groundScreenY = (vpRect.height / 2) + ((groundWorldY - cameraY) * scale);
        
        // Position character so its feet (bottom - footInset) align with groundScreenY
        // Character bottom = top + spriteH * charScale
        // Character feet = character bottom - footInset * charScale
        // So: top + spriteH * charScale - footInset * charScale = groundScreenY
        // Therefore: top = groundScreenY - spriteH * charScale + footInset * charScale
        const charTop = Math.round(groundScreenY - (spriteH * charScale) + (footInset * charScale));
        
        characterWrap.style.setProperty('--char-scale', String(charScale));
        characterWrap.style.top = charTop + 'px';
        // Position ground-line debug overlay if enabled
        const gl = document.getElementById('ground-line');
        if (gl) {
          gl.style.top = Math.round(groundScreenY) + 'px';
        }
        applyCameraTransform();
      }

      // Keyboard nudging to calibrate ground precisely: Shift+ArrowUp/Down adjusts by 1px
      window.addEventListener('keydown', (e) => {
        if (!e.shiftKey) return;
        const vpRect = vp.getBoundingClientRect();
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          // Convert a 1px screen delta to world delta and apply to override
          // d(groundScreenY) = d(groundWorldY) * scale, so 1px -> 1/scale world px
          const deltaWorld = (e.key === 'ArrowUp' ? -1 : 1) / scale;
          const state = vscode.getState?.() || {};
          const currentOverride = (typeof state.groundWorldYOverride === 'number') ? state.groundWorldYOverride
            : (typeof (groundConfig?.groundWorldY) === 'number') ? groundConfig.groundWorldY
            : (typeof (groundConfig?.groundFraction) === 'number') ? worldH * groundConfig.groundFraction
            : (detectedGroundWorldY != null) ? detectedGroundWorldY
            : worldH * groundFallbackFactor;
          const newOverride = Math.max(0, Math.min(worldH, currentOverride + deltaWorld));
          vscode.setState?.({ ...state, useGroundOverride: true, groundWorldYOverride: newOverride });
          // Re-layout with new override
          layout();
          e.preventDefault();
        }
        // Toggle use of override
        if (e.key.toLowerCase() === 'o') {
          const state = vscode.getState?.() || {};
          const next = !state.useGroundOverride;
          vscode.setState?.({ ...state, useGroundOverride: next });
          layout();
          e.preventDefault();
        }
        // Toggle ground-line visibility
        if (e.key.toLowerCase() === 'g') {
          const gl = document.getElementById('ground-line');
          if (gl) gl.style.display = (gl.style.display === 'none') ? 'block' : 'none';
          e.preventDefault();
        }
      });

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
        // Don't update movement if character is dead
        if (isDead) {
          return;
        }
        
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
      
      // Add a test mechanism - click on character to trigger death (for testing)
      character.addEventListener('click', () => {
        if (!isDead) {
          character.className = 'character death';
        }
      });
    })();`;
    return `<!DOCTYPE html><html><head><meta charset="utf-8" />
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; media-src ${webview.cspSource};" />
      <title>Code Sensei</title>
      <style nonce="${nonce}">${style}</style>
    </head><body>
  ${layers.length ? `<div class="root"><div class="viewport"><div class="scene">${stack}</div>${characterHtml}${groundLineEl}${timerHtml}${restartButtonHtml}</div>${introHtml}${audioHtml}</div>` : `<div class="empty">No layered background PNGs found.</div>`}
      <script nonce="${nonce}">${script}</script>
    </body></html>`;
  }
}
