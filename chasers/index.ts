import { Vibi } from "../src/vibi.ts";
import { on_sync, ping, gen_name } from "../src/client.ts";

type Chaser = {
    role: "chaser";
    x: number;
    y: number;
    score: number;
};

type Avatar = "woman" | "man" 

type ChasedPlayer = {
  role: "chased";
  x: number;
  y: number;
  w: number;
  a: number;
  s: number;
  d: number;
  avatar: Avatar
};

type GameState = {
  [char: string]: Chaser | ChasedPlayer;
};

type GamePost =
  | { $: "spawn"; nick: string; role: Chaser | ChasedPlayer; avatar: Avatar; px: number; py: number }
  | { $: "down"; key: "w" | "a" | "s" | "d"; player: string }
  | { $: "up"; key: "w" | "a" | "s" | "d"; player: string }
  | { $: "click"; role: Chaser | ChasedPlayer; x: number; y: number;}
  | { $: "move_mouse"; role: Chaser | ChasedPlayer; x: number; y: number; };

const TICK_RATE         = 30; // ticks per second
const TOLERANCE         = 100; // max tolerance in ms (adaptive per client)
const PIXELS_PER_SECOND = 200;
const PIXELS_PER_TICK   = PIXELS_PER_SECOND / TICK_RATE;

const initial: GameState = {};

function on_tick(state: GameState): GameState {
  const new_state: GameState = {};

  for (const [char, player] of Object.entries(state)) {
    switch (player.role) {
      case "chased":
        new_state[char] = {
          role: player.role,
          x: player.x + (player.d * PIXELS_PER_TICK) + (player.a * -PIXELS_PER_TICK),
          y: player.y + (player.s * PIXELS_PER_TICK) + (player.w * -PIXELS_PER_TICK),
          w: player.w,
          a: player.a,
          s: player.s,
          d: player.d,
          avatar: player.avatar
        };
        break;
      case "chaser":
          new_state[char] = {
          role: player.role,
          x: player.x,// logic for mous
          y: player.y,// logic for mouse
          score: player.score
        };
        break;
    }

  }

  return new_state;
}

// on_post: handle player commands
function on_post(post: GamePost, state: GameState): GameState {
  switch (post.$) {
    case "spawn": {
      const player = { px: 200, py: 200, w: 0, a: 0, s: 0, d: 0 };
      return { ...state, [post.nick]: player };
    }
    case "down": {
      const updated = { ...state[post.player], [post.key]: 1 };
      return { ...state, [post.player]: updated };
    }
    case "up": {
      const updated = { ...state[post.player], [post.key]: 0 };
      return { ...state, [post.player]: updated };
    }
  }
  return state;
}

// Create and export game function
export function create_game(room: string, smooth: (past: GameState, curr: GameState) => GameState) {
  return new Vibi<GameState, GamePost>(room, initial, on_tick, on_post, smooth, TICK_RATE, TOLERANCE);
}

// ---- App bootstrap (no JS in HTML) ----
const canvas: HTMLCanvasElement = document.getElementById("game") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;

function resize_canvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
resize_canvas();
window.addEventListener("resize", resize_canvas);

let room = prompt("Enter room name:");
if (!room) room = gen_name();

const nick = prompt("Enter your nickname (single character):");
if (!nick) {
  alert("Nickname must have at least one character!");
  throw new Error("Nickname must have at least one character");
}

const choosen_avatar = prompt("Choose your avatar: chaser or chased");
if (!choosen_avatar  || !["chaser", "chased"].includes(choosen_avatar)) {
  alert("Avatar must be either 'chaser' or 'chased'!");
  throw new Error("Avatar must be either 'chaser' or 'chased'");
}

console.log("[GAME] Room:", room, "Nick:", nick);

const smooth = (past: GameState, curr: GameState): GameState => {
  if (curr[nick]) {
    past[nick] = curr[nick];
  }
  return past;
};

const game: Vibi<GameState, GamePost> = create_game(room, smooth);
// document.title = `Walkers ${pkg.version}`;

const key_states: Record<string, boolean> = { w: false, a: false, s: false, d: false };

on_sync(() => {
  const spawn_x = 200;
  const spawn_y = 200;
  console.log(`[GAME] Synced; spawning '${nick}' at (${spawn_x},${spawn_y})`);
  game.post({ $: "spawn", nick: nick, px: spawn_x, py: spawn_y });

  const valid_keys = new Set(["w", "a", "s", "d"]);

  function handle_key_event(e: KeyboardEvent) {
    const key     = e.key.toLowerCase();
    const is_down = e.type === "keydown";

    if (!valid_keys.has(key)) {
      return;
    }

    if (key_states[key] === is_down) {
      return; // no state change (filters repeats)
    }

    key_states[key] = is_down;
    const action = is_down ? "down" : "up";
    game.post({ $: action, key: key as any, player: nick });
  }
  window.addEventListener("keydown", handle_key_event);
  window.addEventListener("keyup", handle_key_event);

  setInterval(render, 1000 / TICK_RATE);
});

function render() {
  ctx.fillStyle = "#768d9cff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const curr_tick = game.server_tick();
  const state     = game.compute_render_state(); // retorna no passado caso a atualizacoa de state seja do player

  // ctx.fillStyle    = "#000";
  ctx.font         = "14px monospace";
  ctx.textAlign    = "left";
  ctx.textBaseline = "top";

  try {
    const st  = game.server_time();
    const pc  = (game as any).post_count ? (game as any).post_count() : 0;
    const rtt = ping();

    ctx.fillText(`room: ${room}`, 8, 6);
    ctx.fillText(`time: ${st}`, 8, 24);
    ctx.fillText(`tick: ${curr_tick}`, 8, 42);
    ctx.fillText(`post: ${pc}`, 8, 60);

    if (isFinite(rtt)) {
      ctx.fillText(`ping: ${Math.round(rtt)} ms`, 8, 78);
    }
  } catch {}

  ctx.fillStyle    = "#000";
  ctx.font         = "24px monospace";
  ctx.textAlign    = "center";
  ctx.textBaseline = "middle";

  for (const [char, player] of Object.entries(state)) {
    const x = Math.floor(player.px);
    const y = Math.floor(player.py);
    ctx.fillText(char, x, y);
  }
}
