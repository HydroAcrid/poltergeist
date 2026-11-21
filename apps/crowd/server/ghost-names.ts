// System-assigned ghost names (World's request on #2). Each device gets an "Adjective Noun" name
// from a curated, display-safe vocabulary, derived from a hash of its device id (so it survives
// reloads and server restarts) and probed forward on collision (so everyone in the room is distinct).
// Clients can't choose names, and the name never reveals the device id.
import { createHash } from "node:crypto";

const ADJECTIVES = [
  "Misty", "Dusty", "Hollow", "Silent", "Velvet", "Pale", "Gentle", "Lunar", "Amber", "Frosty",
  "Shadow", "Quiet", "Wispy", "Smoky", "Rusty", "Ashen", "Cobalt", "Crimson", "Foggy", "Gloomy",
  "Hazy", "Inky", "Jolly", "Lucky", "Mossy", "Murky", "Nimble", "Olive", "Plucky", "Rainy",
  "Sleepy", "Snowy", "Spooky", "Starry", "Mellow", "Cosmic", "Silver", "Golden", "Copper", "Sable",
] as const;

const NOUNS = [
  "Lantern", "Candle", "Moth", "Raven", "Willow", "Teacup", "Pocket", "Button", "Whisper", "Shutter",
  "Pumpkin", "Cobweb", "Wisp", "Specter", "Phantom", "Spirit", "Banshee", "Gremlin", "Goblin", "Owl",
  "Bat", "Comet", "Ember", "Thistle", "Acorn", "Pebble", "Marble", "Feather", "Sock", "Kettle",
  "Chimney", "Attic", "Lamp", "Mitten", "Biscuit", "Muffin", "Drizzle", "Echo", "Bellows", "Fern",
] as const;

const SPACE = ADJECTIVES.length * NOUNS.length; // 1600 distinct names

export class GhostNames {
  private byDevice = new Map<string, string>();
  private taken = new Set<string>();

  static vocabulary(): readonly string[] {
    return [...ADJECTIVES, ...NOUNS];
  }

  nameFor(deviceId: string): string {
    const existing = this.byDevice.get(deviceId);
    if (existing) return existing;
    const start = createHash("sha256").update(deviceId).digest().readUInt32BE(0) % SPACE;
    for (let k = 0; k < SPACE; k++) {
      const i = (start + k) % SPACE;
      const name = `${ADJECTIVES[i % ADJECTIVES.length]} ${NOUNS[Math.floor(i / ADJECTIVES.length)]}`;
      if (!this.taken.has(name)) {
        this.taken.add(name);
        this.byDevice.set(deviceId, name);
        return name;
      }
    }
    // More than 1600 people: fall back to a numbered name (still ≤ 16 chars, still unique).
    const name = `Ghost ${this.byDevice.size + 1}`;
    this.byDevice.set(deviceId, name);
    return name;
  }
}
