const audioRegistry = new Set<HTMLAudioElement>();

export function registerAudio(el: HTMLAudioElement): () => void {
  audioRegistry.add(el);
  return () => {
    audioRegistry.delete(el);
  };
}

export function pauseOthers(activeEl: HTMLAudioElement | null): void {
  for (const el of audioRegistry) {
    if (el !== activeEl && !el.paused) {
      el.pause();
    }
  }
}

export function pauseAllAudio(): void {
  for (const el of audioRegistry) {
    if (!el.paused) {
      el.pause();
    }
  }
}
