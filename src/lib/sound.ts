let cached: HTMLAudioElement | null = null;

function getAudio(): HTMLAudioElement {
  if (!cached) {
    cached = new Audio('/sounds/complete.mp3');
    cached.preload = 'auto';
    cached.volume = 0.5;
  }
  return cached;
}

export function playCompletionSound(): void {
  try {
    const audio = getAudio();
    audio.currentTime = 0;
    void audio.play().catch(() => {});
  } catch {}
}
