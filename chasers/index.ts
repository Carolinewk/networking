import { Vibi } from "../src/vibi.ts";
import { on_sync, ping, gen_name } from "../src/client.ts";

type Role = "chaser" | "chased";
type Avatar = "woman" | "man" | undefined

type Chaser = {
    role: Role;
    x: number;
    y: number;
    score: number;
};

type ChasedPlayer = {
    role: Role;
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
  | { $: "spawn"; nick: string; role: Role; avatar: Avatar; x: number; y: number }
  | { $: "down"; key: "w" | "a" | "s" | "d"; player: string }
  | { $: "up"; key: "w" | "a" | "s" | "d"; player: string }
  | { $: "click"; role: Role; x: number; y: number;}
  | { $: "move_mouse"; role: Role; x: number; y: number; };

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

function on_post(post: GamePost, state: GameState): GameState {
  switch (post.$) {
    case "spawn": {
      if (post.role === "chaser") {
        const player = { role: post.role, x : 400, y: 400, score: 0 }
        return { ...state, [post.nick]: player };
      } else if (post.role === "chased") {
        const player = {role: post.role, x: 200, y: 200, w: 0, a: 0, s: 0, d: 0, avatar: post.avatar};
        return { ...state, [post.nick]: player };
      }
      break
    }
    case "down": {
      const updated = { ...state[post.player], [post.key]: 1 };
      return { ...state, [post.player]: updated };
    }
    case "up": {
      const updated = { ...state[post.player], [post.key]: 0 };
      return { ...state, [post.player]: updated };
    }
    case "move_mouse": {
        if (post.role === "chased") {
            return state;
        }
        const updated = { ...state, }
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

const role_input = prompt("Choose your role: chaser or chased");
if (!role_input  || !["chaser", "chased"].includes(role_input)) {
  alert("Avatar must be either 'chaser' or 'chased'!");
  throw new Error("Avatar must be either 'chaser' or 'chased'");
}

const choosen_role = role_input as Role;

let avatar_input = undefined;

switch (choosen_role) {
    case "chased":
        avatar_input = prompt("Choose your avatar: woman or man");
        if (!avatar_input || avatar_input !== "woman" && avatar_input !== "man") {
            alert("Avatar must be either woman or man");
            throw new Error("Avatar must be either woman or man");
        }
        break;
    case "chaser":
        avatar_input = undefined;
        break;
}

const choosen_avatar : Avatar = avatar_input;

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
  const spawn_x = choosen_role === "chased" ? 200 : 400;
  const spawn_y = choosen_role === "chased" ? 200 : 400;

  console.log(`[GAME] Synced; spawning '${nick}' at (${spawn_x},${spawn_y})`);

  game.post({ $: "spawn", nick: nick, role: choosen_role, avatar: choosen_avatar, x: spawn_x, y: spawn_y });

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
    
    if (choosen_role === "chased") {
        return;
    }

    const rect = canvas.getBoundingClientRect(); // where is the canvas in the page
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    switch (e.type) {
        case "mousemove":
            game.post( { $: "move_mouse", role: choosen_role, x: x, y: y });
            break;
        case "click":
            game.post( { $: "click", role: choosen_role, x: x, y: y });
            break;
    }
  }

  window.addEventListener("keydown", handle_key_event);
  window.addEventListener("keyup", handle_key_event);

  window.addEventListener("mousemove", handle_mouse_event);
  window.addEventListener("click", handle_mouse_event);

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
