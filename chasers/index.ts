import { Vibi } from "../src/vibi.ts";
import { on_sync, ping, gen_name } from "../src/client.ts";

type Role = "chaser" | "prey";
type Avatar = "woman" | "man" | undefined

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
  | { $: "spawn"; nick: string; role: Role; avatar: Avatar; x: number; y: number }
  | { $: "down"; key: "w" | "a" | "s" | "d"; player: string }
  | { $: "up"; key: "w" | "a" | "s" | "d"; player: string }
  | { $: "click"; player: string; role: Role; x: number; y: number;}
  | { $: "move_mouse"; player: string; x: number; y: number };

const TICK_RATE         = 30; // ticks per second
const TOLERANCE         = 100; // max tolerance in ms (adaptive per client)
const PIXELS_PER_SECOND = 200;
const PIXELS_PER_TICK   = PIXELS_PER_SECOND / TICK_RATE;

const canvas: HTMLCanvasElement = document.getElementById("game") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;

const GAME_WIDTH  = 1100;
const GAME_HEIGHT = Math.min(700, window.innerHeight)

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
          d: player.d,
          avatar: player.avatar
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
        const player = {role: post.role, x: 200, y: 200, w: 0, a: 0, s: 0, d: 0, avatar: post.avatar};
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
      if (player.role !== "chaser") return state;
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
      if (player.role !== "chaser") return state;
      for (const [char, prey] of Object.entries(state)) {
        if (prey.role !== "prey") continue;
        if (prey.x <= x + 5 && prey.y >= y - 15 && prey.x >= x - 10 && prey.y <= y + 20) {
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

let room = prompt("Enter room name:");
if (!room) room = gen_name();

const nick_input = (prompt("Enter your nickname (single character):")?.trim() ?? "");
if (!nick_input) {
  alert("Nickname must have at least one character!");
  throw new Error("Nickname must have at least one character");
}
const nick: string = nick_input;

const role_input = prompt("Choose your role: chaser or prey");
if (!role_input  || !["chaser", "prey"].includes(role_input)) {
  alert("Role must be either 'chaser' or 'prey'!");
  throw new Error("Role must be either 'chaser' or 'prey'");
}

const choosen_role = role_input as Role;

// let avatar_input = undefined;

// switch (choosen_role) {
//     case "prey":
//         avatar_input = prompt("Choose your avatar: woman or man");
//         if (!avatar_input || avatar_input !== "woman" && avatar_input !== "man") {
//             alert("Avatar must be either woman or man");
//             throw new Error("Avatar must be either woman or man");
//         }
//         break;
//     case "chaser":
//         avatar_input = undefined;
//         break;
// }

// const choosen_avatar : Avatar = avatar_input;

console.log("[GAME] Room:", room, "Nick:", nick, "Role", choosen_role);

const smooth = (past: GameState, curr: GameState): GameState => {
  if (curr[nick]) {
    past[nick] = curr[nick];
  }
  return past;
};

const game: Vibi<GameState, GamePost> = create_game(room, smooth);
const key_states: Record<string, boolean> = { w: false, a: false, s: false, d: false };

on_sync(() => {
  const spawn_x = choosen_role === "prey" ? 200 : 400;
  const spawn_y = choosen_role === "prey" ? 200 : 400;

  console.log(`[GAME] Synced; spawning '${nick}' at (${spawn_x},${spawn_y})`);

  game.post({ $: "spawn", nick: nick, role: choosen_role, x: spawn_x, y: spawn_y });

  const valid_keys = new Set(["w", "a", "s", "d"]);

  function handle_key_event(e: KeyboardEvent) {
    const key     = e.key.toLowerCase();
    const is_down = e.type === "keydown";

    if (!valid_keys.has(key)) {
      return;
    }

    if (key_states[key] === is_down) {
      return;
    }

    key_states[key] = is_down;
    const action = is_down ? "down" : "up";
    game.post({ $: action, key: key as any, player: nick });
  }

  function handle_mouse_event(e: MouseEvent) {
    
    if (choosen_role === "prey") {
        return;
    }

    const rect = canvas.getBoundingClientRect(); // canvas position on the page

    const gameLeft = (canvas.width - GAME_WIDTH) / 2;
    const gameTop  = (canvas.height - GAME_HEIGHT) / 2;

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

  window.addEventListener("keydown", handle_key_event);
  window.addEventListener("keyup", handle_key_event);

  window.addEventListener("click", handle_mouse_event);
 
  window.addEventListener("mousemove", handle_mouse_event);

  setInterval(render, 1000 / TICK_RATE);
});


const psyduck = new Image();
psyduck.src = "./img/psyduck.png";
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

// Walking animation state per prey (client-side only)
type WalkAnimState = { x: number; y: number; accum: number; frame: 0 | 1 };
const walkState: Record<string, WalkAnimState> = {};
const STEP_SIZE_PX = 12; // distance in pixels per footstep toggle

function render() {

  ctx.fillStyle = "#5f4119ff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  
  const gameAreaWidth = GAME_WIDTH;
  const gameAreaHeight = Math.min(GAME_HEIGHT, canvas.height);
  const positionX = (canvas.width - gameAreaWidth) / 2;
  const positionY = (canvas.height - gameAreaHeight) / 2;

  const curr_tick = game.server_tick();
  const state     = game.compute_render_state(); // retorna no passado caso a atualizacoa de state seja do player

  const st  = game.server_time();
  const pc  = (game as any).post_count ? (game as any).post_count() : 0;

  if (state[nick].role === "chaser") {
    canvas.style.cursor = "url('./img/pokeball.png') 8 8, auto";
  }

  ctx.font         = "14px monospace";
  ctx.textAlign    = "left";
  ctx.textBaseline = "top";
  ctx.fillStyle = "#eb8532ff";
  
  ctx.fillText(`room: ${room}`, 8, 8);
  ctx.fillText(`time: ${st}`, 8, 24);
  ctx.fillText(`tick: ${curr_tick}`, 8, 42);
  ctx.fillText(`post: ${pc}`, 8, 60);

  ctx.fillStyle = "#e6bca1ff"
  ctx.strokeStyle = "#a17d5eff"
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.rect(positionX, positionY, gameAreaWidth, gameAreaHeight);
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

  const rtt = ping();

  // Center overlays horizontally within the game area
  ctx.fillText(
    `chaser score: ${state[nick] && state[nick].role === "chaser" ? (state[nick] as Chaser).score : 0}`,
    positionX + gameAreaWidth / 2,
    positionY + 8
  );
  if (isFinite(rtt)) {
    ctx.fillText(
      `ping: ${Math.round(rtt)} ms`,
      positionX + gameAreaWidth / 2,
      positionY + 24
    );
  }
  
  ctx.fillStyle    = "#fff";
  ctx.font         = "40px monospace";
  ctx.textAlign    = "center";
  ctx.textBaseline = "middle";

  for (const [char, player] of Object.entries(state)) {
    if (player.role !== "prey") return
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
      ctx.drawImage(img, x, y, 30, 40);
    }

    // Persist updated state for this prey
    walkState[char] = { x: xWorld, y: yWorld, accum, frame };
  }
  ctx.restore()
}
