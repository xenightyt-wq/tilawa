/**
 * Lecture des versets (EveryAyah.com, un MP3 par verset) avec cache local
 * (Cache Storage) pour l'écoute hors ligne.
 */
const CACHE = 'ayah-audio-v1';

export function ayahUrl(reciter: string, sura: number, aya: number): string {
  const f = String(sura).padStart(3, '0') + String(aya).padStart(3, '0');
  return `https://everyayah.com/data/${reciter}/${f}.mp3`;
}

async function blobFor(url: string): Promise<Blob> {
  if ('caches' in window) {
    try {
      const c = await caches.open(CACHE);
      const hit = await c.match(url);
      if (hit) return hit.blob();
      const res = await fetch(url, { mode: 'cors' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await c.put(url, res.clone());
      return res.blob();
    } catch (e) {
      if (!navigator.onLine) throw e;
    }
  }
  const res = await fetch(url, { mode: 'cors' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.blob();
}

export class AyahPlayer {
  private audio = new Audio();
  private objectUrl: string | null = null;
  private queue: { sura: number; aya: number }[] = [];
  private idx = 0;
  loop = false;
  onChange?: (playing: { sura: number; aya: number } | null) => void;

  constructor(private reciter: string) {
    this.audio.addEventListener('ended', () => void this.advance());
  }

  setReciter(r: string) {
    this.reciter = r;
  }

  get playing(): boolean {
    return !this.audio.paused;
  }

  /** Joue une liste de versets ; `loop` répète la liste. */
  async play(verses: { sura: number; aya: number }[], loop = false) {
    this.stop();
    this.queue = verses;
    this.idx = 0;
    this.loop = loop;
    await this.playCurrent();
  }

  private async playCurrent() {
    const v = this.queue[this.idx];
    if (!v) return this.stop();
    const blob = await blobFor(ayahUrl(this.reciter, v.sura, v.aya));
    if (this.queue[this.idx] !== v) return; // interrompu entre-temps
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = URL.createObjectURL(blob);
    this.audio.src = this.objectUrl;
    this.onChange?.(v);
    await this.audio.play();
  }

  private async advance() {
    this.idx++;
    if (this.idx >= this.queue.length) {
      if (!this.loop) return this.stop();
      this.idx = 0;
    }
    await this.playCurrent();
  }

  stop() {
    this.audio.pause();
    this.queue = [];
    this.onChange?.(null);
  }
}

/** Télécharge à l'avance l'audio d'une liste de versets (écoute hors ligne). */
export async function prefetch(reciter: string, verses: { sura: number; aya: number }[]) {
  for (const v of verses) await blobFor(ayahUrl(reciter, v.sura, v.aya)).catch(() => {});
}
