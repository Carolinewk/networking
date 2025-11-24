import { Vibi } from "../src/vibi.ts";
import { on_sync, ping, gen_name } from "../src/client.ts";

type Role = "chaser" | "prey";

type Chaser = {
    role: "chaser";
    x: number;
    y: number;
    score: number;
};

type Prey = {
    role: "prey";
    x: number;
    y: number;
    w: number;
    a: number;
    s: number;
    d: number;
};

type GameState = {
  [char: string]: Chaser | Prey;
};

type GamePost =
  | { $: "spawn"; nick: string; role: Role; x: number; y: number }
  | { $: "down"; key: "w" | "a" | "s" | "d"; player: string }
  | { $: "up"; key: "w" | "a" | "s" | "d"; player: string }
  | { $: "click"; player: string; role: Role; x: number; y: number;}
  | { $: "move_mouse"; player: string; x: number; y: number };

const TICK_RATE         = 30; // ticks per second
const TOLERANCE         = 100; // max tolerance in ms (adaptive per client)
const PIXELS_PER_SECOND = 200;
const PIXELS_PER_TICK   = PIXELS_PER_SECOND / TICK_RATE;
const PREY_WIDTH        = 45;
const PREY_HEIGHT       = 55;

const canvas: HTMLCanvasElement = document.getElementById("game") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;

const GAME_WIDTH  = 1100;
const GAME_HEIGHT = Math.min(700, window.innerHeight)
const SUNRISE_ANGLE_DEG = 126;
const SUNRISE_STOP_OFFSETS: [number, number, number] = [0.12, 0.55, 0.96];

function readSunriseStops(): [string, string, string] {
  const style = getComputedStyle(document.documentElement);
  const stop1 = style.getPropertyValue("--sunrise-stop-1").trim() || "#fff3a2";
  const stop2 = style.getPropertyValue("--sunrise-stop-2").trim() || "#ffd447";
  const stop3 = style.getPropertyValue("--sunrise-stop-3").trim() || "#f2a93b";
  return [stop1, stop2, stop3];
}

const sunriseStops = readSunriseStops();

const initial: GameState = {};

function on_tick(state: GameState): GameState {
  const new_state: GameState = {};

  for (const [char, player] of Object.entries(state)) {
    switch (player.role) {
      case "prey": {
        const nextX = player.x + (player.d * PIXELS_PER_TICK) + (player.a * -PIXELS_PER_TICK);
        const nextY = player.y + (player.s * PIXELS_PER_TICK) + (player.w * -PIXELS_PER_TICK);
        const clampedX = Math.max(0, Math.min(GAME_WIDTH, nextX));
        const clampedY = Math.max(0, Math.min(GAME_HEIGHT, nextY));

        new_state[char] = {
          role: player.role,
          x: clampedX,
          y: clampedY,
          w: player.w,
          a: player.a,
          s: player.s,
          d: player.d
        };
        break;
      }
      case "chaser": {
        const clampedX = Math.max(0, Math.min(GAME_WIDTH, player.x));
        const clampedY = Math.max(0, Math.min(GAME_HEIGHT, player.y));
        new_state[char] = {
          role: player.role,
          x: clampedX,
          y: clampedY,
          score: player.score
        };
        break;
      }
    }

  }

  return new_state;
}

function on_post(post: GamePost, state: GameState): GameState {
  switch (post.$) {
    case "spawn": {
      if (post.role === "chaser") {
        const player = { role: post.role, x : 400, y: 400, score: 0 }
        return { ...state, [post.nick]: player };
      } else if (post.role === "prey") {
        const player = {role: post.role, x: 200, y: 200, w: 0, a: 0, s: 0, d: 0};
        return { ...state, [post.nick]: player };
      }
      break
    }
    case "down": {
      const p = state[post.player];
      if (!p || p.role !== "prey") return state;
      const updated: Prey = { ...p };
      updated[post.key] = 1;
      return { ...state, [post.player]: updated };
    }
    case "up": {
      const p = state[post.player];
      if (!p || p.role !== "prey") return state;
      const updated: Prey = { ...p };
      updated[post.key] = 0;
      return { ...state, [post.player]: updated };
    }
    case "move_mouse": {
      const player = state[post.player];
      if (!player || player.role !== "chaser") return state;
      // Incoming coordinates are in world space; clamp to game bounds
      const x = Math.max(0, Math.min(GAME_WIDTH, post.x));
      const y = Math.max(0, Math.min(GAME_HEIGHT, post.y));
      const updated = { ...player, x, y };
      return { ...state, [post.player]: updated };
    }
    case "click": {
      const player = state[post.player];
      const x = post.x;
      const y = post.y;
      if (!player || player.role !== "chaser") return state;
      for (const [char, prey] of Object.entries(state)) {
        if (prey.role !== "prey") continue;
        // Hitbox matches the drawn sprite bounds (no extra padding)
        const left = prey.x;
        const right = prey.x + PREY_WIDTH;
        const top = prey.y;
        const bottom = prey.y + PREY_HEIGHT;
        if (x >= left && x <= right && y >= top && y <= bottom) {
          return { ...state, [post.player]: { ...player, score: player.score + 1}}
        }
      }
    }
  }
  return state;
}

// Create and export game function
export function create_game(room: string, smooth: (past: GameState, curr: GameState) => GameState) {
  return new Vibi<GameState, GamePost>(room, initial, on_tick, on_post, smooth, TICK_RATE, TOLERANCE);
}

function resize_canvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
resize_canvas();

window.addEventListener("resize", resize_canvas);

let room = "";
let nick = "";
let choosen_role: Role | null = null;
let game: Vibi<GameState, GamePost> | null = null;
const key_states: Record<"w" | "a" | "s" | "d", boolean> = { w: false, a: false, s: false, d: false };
const validKeys = new Set<"w" | "a" | "s" | "d">(["w", "a", "s", "d"]);
let controlsAttached = false;
type Step = "room" | "nick" | "role";
let currentStep: Step = "room";

const setupLayer = document.getElementById("setup-layer") as HTMLDivElement;
const setupForm  = document.getElementById("setup-card") as HTMLFormElement;
const roomInput  = document.getElementById("room-input") as HTMLInputElement;
const nickInput  = document.getElementById("nick-input") as HTMLInputElement;
const helper     = document.getElementById("form-helper") as HTMLParagraphElement;
const roleButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-role]"));
const stepPanels = Array.from(document.querySelectorAll<HTMLElement>("[data-step]"));
const enterButton = document.getElementById("enter-game") as HTMLButtonElement;
const hudRoom = document.getElementById("hud-room");
const hudTime = document.getElementById("hud-time");
const hudTick = document.getElementById("hud-tick");
const hudPost = document.getElementById("hud-post");
const hudScore = document.getElementById("hud-score");
const hudPing = document.getElementById("hud-ping");

const hudCache: Partial<Record<"room" | "time" | "tick" | "post" | "score" | "ping", string>> = {};
function updateHud(values: Partial<Record<"room" | "time" | "tick" | "post" | "score" | "ping", string>>) {
  const map = {
    room: hudRoom,
    time: hudTime,
    tick: hudTick,
    post: hudPost,
    score: hudScore,
    ping: hudPing
  } as const;

  (Object.keys(values) as Array<keyof typeof map>).forEach((key) => {
    const val = values[key];
    const el  = map[key];
    if (!el || typeof val === "undefined") return;
    if (hudCache[key] === val) return;
    hudCache[key] = val;
    el.textContent = val;
  });
}

const suggestedRoom = gen_name();
roomInput.value = suggestedRoom;
roomInput.placeholder = suggestedRoom;
nickInput.placeholder = "psyduck-fan";
focusAndSelect(roomInput);

function setHelper(message: string) {
  helper.textContent = message;
}

function focusAndSelect(input: HTMLInputElement) {
  requestAnimationFrame(() => {
    input.focus();
    input.select();
  });
}

function showStep(step: Step) {
  currentStep = step;
  stepPanels.forEach((panel) => {
    panel.classList.toggle("active", panel.dataset.step === step);
  });

  switch (step) {
    case "room":
      enterButton.textContent = "Next: nickname";
      setHelper("Pick your room name inside the arena to begin.");
      focusAndSelect(roomInput);
      break;
    case "nick":
      enterButton.textContent = "Next: pick role";
      setHelper("Now choose your nickname for this room.");
      focusAndSelect(nickInput);
      break;
    case "role": {
      enterButton.textContent = "Enter game";
      const helperCopy = choosen_role
        ? (choosen_role === "chaser"
          ? "Chaser: click psyducks with the pokeball."
          : "Prey: dodge around with the WASD keys.")
        : "Choose between the pokeball (chaser) or psyduck (prey).";
      setHelper(helperCopy);
      enterButton.focus();
      break;
    }
  }
}

roleButtons.forEach((btn) => {
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    const role = (btn.dataset.role || "prey") as Role;
    choosen_role = role;
    roleButtons.forEach((b) => b.classList.toggle("active", b === btn));
    setHelper(role === "chaser"
      ? "Chaser: click psyducks with the pokeball."
      : "Prey: dodge around with the WASD keys.");
    showStep("role");
  });
});

function handle_key_event(e: KeyboardEvent) {
  if (!game || !choosen_role) return;
  const key     = e.key.toLowerCase();
  const is_down = e.type === "keydown";

  if (!validKeys.has(key as "w" | "a" | "s" | "d")) {
    return;
  }

  if (key_states[key as "w" | "a" | "s" | "d"] === is_down) {
    return;
  }

  key_states[key as "w" | "a" | "s" | "d"] = is_down;
  const action = is_down ? "down" : "up";
  game.post({ $: action, key: key as any, player: nick });
}

function handle_mouse_event(e: MouseEvent) {
  if (!game || !choosen_role || choosen_role === "prey") {
    return;
  }

  const rect = canvas.getBoundingClientRect();

  const gameLeft = (canvas.width - GAME_WIDTH) / 2;
  const gameHeight = Math.min(GAME_HEIGHT, canvas.height);
  const gameTop  = (canvas.height - gameHeight) / 2;

  const xCanvas = e.clientX - rect.left;
  const yCanvas = e.clientY - rect.top;

  const xWorldUnclamped = xCanvas - gameLeft;
  const yWorldUnclamped = yCanvas - gameTop;

  const x = Math.max(0, Math.min(GAME_WIDTH, xWorldUnclamped));
  const y = Math.max(0, Math.min(GAME_HEIGHT, yWorldUnclamped));

  switch (e.type) {
    case "mousemove":
      game.post({ $: "move_mouse", player: nick, x, y });
      break;
    case "click":
      game.post({ $: "click", player: nick, role: choosen_role, x, y });
      break;
  }
}

function startGame() {
  if (!choosen_role || game || !room || !nick) {
    return;
  }

  const smooth = (past: GameState, curr: GameState): GameState => {
    if (curr[nick]) {
      past[nick] = curr[nick];
    }
    return past;
  };

  game = create_game(room, smooth);

  on_sync(() => {
    if (!game || !choosen_role) {
      return;
    }
    const spawn_x = choosen_role === "prey" ? 200 : 400;
    const spawn_y = choosen_role === "prey" ? 200 : 400;

    game.post({ $: "spawn", nick: nick, role: choosen_role, x: spawn_x, y: spawn_y });

    if (!controlsAttached) {
      window.addEventListener("keydown", handle_key_event);
      window.addEventListener("keyup", handle_key_event);
      window.addEventListener("click", handle_mouse_event);
      window.addEventListener("mousemove", handle_mouse_event);
      controlsAttached = true;
    }
  });
}

setupForm.addEventListener("submit", (e) => {
  e.preventDefault();
  if (currentStep === "room") {
    const roomValue = roomInput.value.trim() || roomInput.placeholder.trim();
    if (!roomValue) {
      setHelper("Give your room a name inside the arena first.");
      focusAndSelect(roomInput);
      return;
    }
    room = roomValue;
    showStep("nick");
    return;
  }

  if (currentStep === "nick") {
    const nickValue = nickInput.value.trim() || nickInput.placeholder.trim();
    if (!nickValue) {
      setHelper("Pick the nickname you'll use in this room.");
      focusAndSelect(nickInput);
      return;
    }
    nick = nickValue;
    showStep("role");
    return;
  }

  if (!choosen_role) {
    setHelper("Choose between the pokeball (chaser) or psyduck (prey).");
    return;
  }

  setHelper("");
  setupLayer.classList.add("hidden");
  startGame();
});


const psyduck = new Image();
psyduck.src = "./img/psyduckright.png";
let psyduckLoaded = false;
psyduck.onload = () => {
  psyduckLoaded = true;
};

const psyduckLeft = new Image();
psyduckLeft.src = "./img/psyduckleft.png";
let psyduckLeftLoaded = false;
psyduckLeft.onload = () => {
  psyduckLeftLoaded = true;
};

const pokeball = new Image();
pokeball.src = "./img/pokeball.png";
const POKEBALL_CURSOR_SIZE = 32;
let pokeballCursorUrl: string | null = null;
let pokeballCursorHotspot = Math.floor(POKEBALL_CURSOR_SIZE / 2);
pokeball.onload = () => {
  // Downscale the large pokeball asset so browsers accept it as a cursor
  const size = Math.max(1, Math.min(POKEBALL_CURSOR_SIZE, pokeball.width, pokeball.height));
  const offscreen = document.createElement("canvas");
  offscreen.width = size;
  offscreen.height = size;
  const offCtx = offscreen.getContext("2d");
  if (!offCtx) return;
  offCtx.drawImage(pokeball, 0, 0, size, size);
  pokeballCursorUrl = offscreen.toDataURL("image/png");
  pokeballCursorHotspot = Math.floor(size / 2);
};

// Walking animation state per prey (client-side only)
type WalkAnimState = { x: number; y: number; accum: number; frame: 0 | 1 };
const walkState: Record<string, WalkAnimState> = {};
const STEP_SIZE_PX = 12; // distance in pixels per footstep toggle

function render() {

  // 126deg gradient backdrop that stays outside the gameplay area
  const gradientAngleRad = (SUNRISE_ANGLE_DEG * Math.PI) / 180;
  const dirX = Math.sin(gradientAngleRad);
  const dirY = -Math.cos(gradientAngleRad);
  const halfDiagonal = Math.hypot(canvas.width, canvas.height) / 2;
  const centerX = canvas.width / 2;
  const centerY = canvas.height / 2;
  const backdropGradient = ctx.createLinearGradient(
    centerX - (dirX * halfDiagonal),
    centerY - (dirY * halfDiagonal),
    centerX + (dirX * halfDiagonal),
    centerY + (dirY * halfDiagonal)
  );
  const [sunriseStop1, sunriseStop2, sunriseStop3] = sunriseStops;
  backdropGradient.addColorStop(SUNRISE_STOP_OFFSETS[0], sunriseStop1);
  backdropGradient.addColorStop(SUNRISE_STOP_OFFSETS[1], sunriseStop2);
  backdropGradient.addColorStop(SUNRISE_STOP_OFFSETS[2], sunriseStop3);
  ctx.fillStyle = backdropGradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  
  const gameAreaWidth = GAME_WIDTH;
  const gameAreaHeight = Math.min(GAME_HEIGHT, canvas.height);
  const positionX = (canvas.width - gameAreaWidth) / 2;
  const positionY = (canvas.height - gameAreaHeight) / 2;

  const state: GameState = game ? game.compute_render_state() : {};
  const me               = game && nick ? state[nick] : undefined;
  const curr_tick        = game ? game.server_tick() : null;
  const st               = game ? game.server_time() : null;
  const pc               = game ? game.post_count() : 0;

  if (me?.role === "chaser") {
    if (pokeballCursorUrl) {
      canvas.style.cursor = `url('${pokeballCursorUrl}') ${pokeballCursorHotspot} ${pokeballCursorHotspot}, auto`;
    } else {
      canvas.style.cursor = "crosshair";
    }
  } else {
    canvas.style.cursor = "auto";
  }

  ctx.font         = "14px monospace";
  ctx.textAlign    = "left";
  ctx.textBaseline = "top";
  ctx.fillStyle = "#fff";

  const hudTimeVal = st !== null ? `${st}` : (game ? "syncing..." : "—");
  const hudTickVal = curr_tick !== null ? `${curr_tick}` : (game ? "syncing..." : "—");
  const trainerScore = (() => {
    if (!game) return 0;
    if (me?.role === "chaser") return (me as Chaser).score;
    for (const player of Object.values(state)) {
      if (player.role === "chaser") {
        return (player as Chaser).score;
      }
    }
    return 0;
  })();
  const rtt = ping();
  const pingDisplay = isFinite(rtt) ? `${Math.round(rtt)} ms` : "—";

  updateHud({
    room: room || "—",
    time: hudTimeVal,
    tick: hudTickVal,
    post: game ? `${pc}` : "—",
    score: `${trainerScore}`,
    ping: pingDisplay
  });

  ctx.strokeStyle = "#deb452"
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.rect(positionX, positionY, gameAreaWidth, gameAreaHeight);
  ctx.fillStyle = "#f6de8b";
  ctx.fill();
  ctx.strokeRect(positionX, positionY, gameAreaWidth, gameAreaHeight);

  // create a clipping mask so everything else cant be drawn outside the game
  ctx.save();
  ctx.beginPath();
  ctx.rect(positionX, positionY, gameAreaWidth, gameAreaHeight);
  ctx.clip(); 

  ctx.font         = "16px monospace";
  ctx.textAlign    = "center";
  ctx.textBaseline = "top";
  ctx.fillStyle    = "#000";

  const showHitboxStroke = choosen_role === "chaser";
  
  ctx.fillStyle    = "#fff";
  ctx.font         = "40px monospace";
  ctx.textAlign    = "center";
  ctx.textBaseline = "middle";

  if (!game) {
    ctx.fillStyle = "rgba(0, 0, 0, 0.8)";
    ctx.font = "18px monospace";
    ctx.fillText(
      "Step through room, nickname, then pick a role to start.",
      positionX + gameAreaWidth / 2,
      positionY + gameAreaHeight / 2 - 12
    );
    ctx.font = "14px monospace";
    ctx.fillText(
      "Everything happens inside this framed arena.",
      positionX + gameAreaWidth / 2,
      positionY + gameAreaHeight / 2 + 8
    );
    ctx.restore();
    return;
  }

  for (const [char, player] of Object.entries(state)) {
    if (player.role !== "prey") continue;
    const xWorld = player.x;
    const yWorld = player.y;
    const x = Math.floor(positionX + xWorld);
    const y = Math.floor(positionY + yWorld);

    // Initialize state if first time seeing this prey
    const prev = walkState[char] ?? { x: xWorld, y: yWorld, accum: 0, frame: 0 };
    let accum = prev.accum;
    let frame = prev.frame;

    // Accumulate traveled distance; toggle when exceeding step size
    const dx = xWorld - prev.x;
    const dy = yWorld - prev.y;
    const dist = Math.hypot(dx, dy);
    if (dist > 0) {
      accum += dist;
      if (accum >= STEP_SIZE_PX) {
        frame = (frame ^ 1) as 0 | 1; // toggle 0<->1
        accum = 0;
      }
    }

    // Choose current frame image
    const img = frame === 0 ? psyduck : psyduckLeft;
    const imgReady = frame === 0 ? psyduckLoaded : psyduckLeftLoaded;
    if (imgReady) {
      ctx.drawImage(img, x, y, PREY_WIDTH, PREY_HEIGHT);
    }

    if (showHitboxStroke) {
      ctx.strokeStyle = "rgba(255, 255, 255, 0.85)";
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, PREY_WIDTH, PREY_HEIGHT);
    }

    // Persist updated state for this prey
    walkState[char] = { x: xWorld, y: yWorld, accum, frame };
  }
  ctx.restore()
}

render();
setInterval(render, 1000 / TICK_RATE);

showStep("room");
