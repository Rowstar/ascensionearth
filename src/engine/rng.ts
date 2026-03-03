export class Rng {
  private state: number;

  constructor(seed: string) {
    this.state = Rng.hash(seed);
  }

  static hash(seed: string): number {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < seed.length; i += 1) {
      h ^= seed.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  next(): number {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  nextInt(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }

  rollDie(sides = 6, bonus = 0): number {
    const roll = this.nextInt(1, sides);
    return Math.max(1, roll + bonus);
  }

  pick<T>(list: T[]): T {
    return list[this.nextInt(0, list.length - 1)];
  }

  shuffle<T>(list: T[]): T[] {
    const copy = [...list];
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = this.nextInt(0, i);
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  snapshot(): number {
    return this.state >>> 0;
  }

  restore(state: number): void {
    this.state = (state >>> 0) || 1;
  }
}
