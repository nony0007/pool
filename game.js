(() => {
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;

  // Table geometry
  const rail = 30;
  const table = { x: rail, y: rail, w: W - rail*2, h: H - rail*2, pocketR: 23, ballR: 10.5 };

  // Pockets: 6 pockets (corners + middles on long rails)
  const pockets = [
    {x: table.x, y: table.y},
    {x: table.x + table.w/2, y: table.y - 2},
    {x: table.x + table.w, y: table.y},
    {x: table.x, y: table.y + table.h},
    {x: table.x + table.w/2, y: table.y + table.h + 2},
    {x: table.x + table.w, y: table.y + table.h},
  ];

  // Game state
  let balls = [];
  let cueBallId = 0;
  let dragging = false;
  let aimStart = null;
  let cueReady = true;
  let score = 0;
  let shots = 0;
  let soundsOn = true;
  const powerBar = document.getElementById('powerBar');
  const statusEl = document.getElementById('status');
  const shotsEl = document.getElementById('shots');
  const scoreEl = document.getElementById('score');

  const snd = {
    hit: new Audio(makeBeep(880, 0.03)),
    rail: new Audio(makeBeep(440, 0.05)),
    pocket: new Audio(makeBeep(220, 0.12))
  };
  Object.values(snd).forEach(a => { a.volume = 0.4; });

  function makeBeep(freq, dur){
    // simple WebAudio-less fallback: data URI with tiny wav is complex; use oscillator via WebAudio when available
    // but some browsers block without gesture; so we prepare Oscillator on demand
    // Here we return an empty src and instead trigger WebAudio in playBeep
    return "";
  }
  const audioCtx = (window.AudioContext ? new AudioContext() : null);

  function playBeep(f=440, t=0.05){
    if(!soundsOn || !audioCtx) return;
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.connect(g); g.connect(audioCtx.destination);
    o.type = "sine"; o.frequency.value = f;
    const now = audioCtx.currentTime;
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.2, now + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, now + t);
    o.start(now); o.stop(now + t);
  }

  function resetRack() {
    balls = [];
    // Cue ball
    balls.push(makeBall(table.x + table.w*0.25, table.y + table.h/2, 0, 0, true));
    cueBallId = 0;

    // Rack 10 colored balls in a triangle
    const cols = 5; // rows 5,4,3,2,1 = 15 traditionally, we use 10 for speed
    const startX = table.x + table.w * 0.72;
    const startY = table.y + table.h / 2;
    let colors = [
      "#ffd700", "#ff4d4d", "#4dd2ff", "#9b59b6", "#2ecc71",
      "#e67e22", "#ecf0f1", "#f1c40f", "#3498db", "#e74c3c"
    ];
    let placed = 0;
    let row = 5;
    let gap = table.ballR*2 + 1.5;
    for (let r = 0; r < 5; r++){
      let count = 5 - r;
      for (let i = 0; i < count; i++){
        if (placed >= 10) break;
        const x = startX + r*gap;
        const y = startY - (count-1)*gap/2 + i*gap;
        balls.push(makeBall(x, y, 0, 0, false, colors[placed % colors.length]));
        placed++;
      }
    }
  }

  function makeBall(x, y, vx, vy, isCue=false, color=null){
    return { x, y, vx, vy, r: table.ballR, isCue, inPocket:false, color: color || "#fff" };
  }

  function newGame(){
    score = 0; shots = 0;
    resetRack();
    updateHUD();
  }

  function updateHUD(){
    shotsEl.textContent = shots;
    scoreEl.textContent = score;
  }

  // Physics params
  const FRICTION = 0.992; // per frame multiplier
  const STOP_T = 0.02; // threshold
  const MAX_POWER = 26; // velocity scale
  const BALL_MASS = 1; // equal masses

  function length(x,y){ return Math.hypot(x,y); }

  function step(){
    // Move
    for (const b of balls){
      if (b.inPocket) continue;
      b.x += b.vx;
      b.y += b.vy;
      b.vx *= FRICTION;
      b.vy *= FRICTION;
      if (Math.abs(b.vx) < STOP_T) b.vx = 0;
      if (Math.abs(b.vy) < STOP_T) b.vy = 0;
    }

    // Collide with rails (treat pocket mouths as open)
    for (const b of balls){
      if (b.inPocket) continue;

      // If near pocket opening, allow fall instead of rail bounce
      for (const p of pockets){
        if (Math.hypot(b.x - p.x, b.y - p.y) < table.pocketR){
          // pocket it
          b.inPocket = true;
          b.vx = b.vy = 0;
          if (b.isCue){
            score -= 200;
            statusEl.textContent = "Scratch! Place cue ball (ball in hand) - tap/click on table.";
            playBeep(120, 0.2);
          } else {
            score += 100;
            playBeep(200, 0.12);
          }
          updateHUD();
        }
      }

      if (b.inPocket) continue;

      const left = table.x + b.r;
      const right = table.x + table.w - b.r;
      const top = table.y + b.r;
      const bottom = table.y + table.h - b.r;

      if (b.x < left){ b.x = left; b.vx = -b.vx; playBeep(500, 0.05); }
      if (b.x > right){ b.x = right; b.vx = -b.vx; playBeep(500, 0.05); }
      if (b.y < top){ b.y = top; b.vy = -b.vy; playBeep(500, 0.05); }
      if (b.y > bottom){ b.y = bottom; b.vy = -b.vy; playBeep(500, 0.05); }
    }

    // Ball-ball collisions
    for (let i=0;i<balls.length;i++){
      for (let j=i+1;j<balls.length;j++){
        const a = balls[i], b = balls[j];
        if (a.inPocket || b.inPocket) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.hypot(dx,dy);
        const minDist = a.r + b.r;
        if (dist > 0 && dist < minDist){
          // push them apart
          const overlap = (minDist - dist) / 2;
          const nx = dx / dist, ny = dy / dist;
          a.x -= nx * overlap; a.y -= ny * overlap;
          b.x += nx * overlap; b.y += ny * overlap;

          // 1D collision response along normal
          const av = a.vx*nx + a.vy*ny;
          const bv = b.vx*nx + b.vy*ny;
          const p = (2 * (av - bv)) / (BALL_MASS + BALL_MASS);
          a.vx -= p * BALL_MASS * nx;
          a.vy -= p * BALL_MASS * ny;
          b.vx += p * BALL_MASS * nx;
          b.vy += p * BALL_MASS * ny;
          playBeep(880, 0.03);
        }
      }
    }
  }

  function draw(){
    // Table felt
    ctx.clearRect(0,0,W,H);
    // Wood outside rails
    ctx.fillStyle = "#5d4037";
    ctx.fillRect(0,0,W,H);
    // Felt area
    roundRect(ctx, table.x, table.y, table.w, table.h, 16, "#1b5e20");

    // Pockets
    ctx.fillStyle = "#0a0a0a";
    for (const p of pockets){
      ctx.beginPath();
      ctx.arc(p.x, p.y, table.pocketR, 0, Math.PI*2);
      ctx.fill();
    }

    // Markers (spots)
    ctx.fillStyle = "rgba(255,255,255,.25)";
    for (let i=1;i<4;i++){
      const x = table.x + (table.w/5)*i;
      ctx.fillRect(x-1, table.y+6, 2, 10);
      ctx.fillRect(x-1, table.y+table.h-16, 2, 10);
    }

    // Balls
    for (const b of balls){
      if (b.inPocket) continue;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI*2);
      ctx.fillStyle = b.isCue ? "#ffffff" : b.color;
      ctx.shadowColor = "rgba(0,0,0,.6)";
      ctx.shadowBlur = 6;
      ctx.fill();
      ctx.shadowBlur = 0;

      // simple highlight
      ctx.beginPath();
      ctx.arc(b.x - b.r*0.35, b.y - b.r*0.35, b.r*0.35, 0, Math.PI*2);
      ctx.fillStyle = "rgba(255,255,255,.25)";
      ctx.fill();
    }

    // Aim guide
    if (dragging && aimStart && cueReady && !anyMoving()){
      const cue = balls[cueBallId];
      if (!cue.inPocket){
        const dx = mouse.x - aimStart.x;
        const dy = mouse.y - aimStart.y;
        const len = Math.hypot(dx,dy);
        const nx = dx/(len||1), ny = dy/(len||1);
        const guideLen = Math.min(140, len);
        ctx.lineWidth = 2;
        ctx.strokeStyle = "#38bdf8";
        ctx.setLineDash([6,6]);
        ctx.beginPath();
        ctx.moveTo(cue.x, cue.y);
        ctx.lineTo(cue.x - nx*guideLen, cue.y - ny*guideLen);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  }

  function anyMoving(){
    return balls.some(b => !b.inPocket && (Math.abs(b.vx)>0.01 || Math.abs(b.vy)>0.01));
  }

  // Input
  const mouse = {x:0,y:0};
  function withinTable(x,y){
    return x > table.x && x < table.x + table.w && y > table.y && y < table.y + table.h;
  }

  function setCueBallAt(x,y){
    const cue = balls[cueBallId];
    cue.inPocket = false;
    cue.x = Math.min(Math.max(x, table.x + cue.r), table.x + table.w - cue.r);
    cue.y = Math.min(Math.max(y, table.y + cue.r), table.y + table.h - cue.r);
    cue.vx = cue.vy = 0;
    statusEl.textContent = "Cue ball placed. Aim & shoot.";
  }

  function onDown(x,y){
    mouse.x=x; mouse.y=y;
    const cue = balls[cueBallId];

    // Ball in hand if cue is pocketed
    if (cue.inPocket){
      if (withinTable(x,y)) setCueBallAt(x,y);
      return;
    }

    if (!anyMoving()){
      dragging = true;
      aimStart = {x, y};
      statusEl.textContent = "Dragging... release to shoot";
    }
  }
  function onMove(x,y){
    mouse.x=x; mouse.y=y;
    if (dragging && aimStart){
      const dx = x - aimStart.x, dy = y - aimStart.y;
      const p = Math.min(1, Math.hypot(dx,dy)/200);
      document.getElementById('powerBar').style.width = `${Math.floor(p*100)}%`;
    }
  }
  function onUp(x,y){
    if (!dragging || !aimStart) return;
    dragging = false;
    powerBar.style.width = "0%";
    const cue = balls[cueBallId];
    if (cue.inPocket) return;

    const dx = x - aimStart.x;
    const dy = y - aimStart.y;
    const len = Math.hypot(dx,dy);
    if (len < 4) { statusEl.textContent = "Tiny shot ignored."; return; }

    const nx = dx/len, ny = dy/len;
    const power = Math.min(1, len/220);
    cue.vx = -nx * (MAX_POWER * power);
    cue.vy = -ny * (MAX_POWER * power);
    cueReady = false;
    shots++;
    updateHUD();
    statusEl.textContent = "Shooting...";
    playBeep(200, 0.04);
  }

  canvas.addEventListener('mousedown', e => {
    const r = canvas.getBoundingClientRect();
    onDown(e.clientX - r.left, e.clientY - r.top);
  });
  canvas.addEventListener('mousemove', e => {
    const r = canvas.getBoundingClientRect();
    onMove(e.clientX - r.left, e.clientY - r.top);
  });
  window.addEventListener('mouseup', e => {
    const r = canvas.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    if (x>=0 && y>=0 && x<=canvas.width && y<=canvas.height) onUp(x,y);
    else onUp(mouse.x, mouse.y);
  });

  // Touch
  canvas.addEventListener('touchstart', e => {
    const t = e.touches[0]; const r = canvas.getBoundingClientRect();
    onDown(t.clientX - r.left, t.clientY - r.top); e.preventDefault();
  }, {passive:false});
  canvas.addEventListener('touchmove', e => {
    const t = e.touches[0]; const r = canvas.getBoundingClientRect();
    onMove(t.clientX - r.left, t.clientY - r.top); e.preventDefault();
  }, {passive:false});
  canvas.addEventListener('touchend', e => { onUp(mouse.x, mouse.y); e.preventDefault(); }, {passive:false});

  // Buttons
  document.getElementById('newGameBtn').addEventListener('click', () => { newGame(); statusEl.textContent="New game started."; });
  document.getElementById('resetBtn').addEventListener('click', () => { resetRack(); statusEl.textContent="Balls re-racked."; });
  document.getElementById('helpBtn').addEventListener('click', () => showHelp(true));
  document.getElementById('closeHelp').addEventListener('click', () => showHelp(false));
  document.getElementById('soundToggle').addEventListener('change', e => { soundsOn = e.target.checked; if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume(); });

  function showHelp(show){
    document.getElementById('helpModal').classList.toggle('hidden', !show);
  }

  function roundRect(ctx,x,y,w,h,r,fill){
    ctx.beginPath();
    ctx.moveTo(x+r, y);
    ctx.arcTo(x+w, y, x+w, y+h, r);
    ctx.arcTo(x+w, y+h, x, y+h, r);
    ctx.arcTo(x, y+h, x, y, r);
    ctx.arcTo(x, y, x+w, y, r);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  }

  function loop(){
    step();
    draw();
    if (!anyMoving() && !cueReady){
      cueReady = true;
      statusEl.textContent = "Aim, click & drag to shoot";
    }
    requestAnimationFrame(loop);
  }

  // Init
  newGame();
  showHelp(true);
  loop();
})();
