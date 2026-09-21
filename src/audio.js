// AudioManager: three subtle synthesized tones. Silent unless the sound setting is on.

const TONES = {
  ok: [{ hz: 660, at: 0, ms: 70 }, { hz: 880, at: 0.08, ms: 90 }],
  miss: [{ hz: 233, at: 0, ms: 160 }],
  cue: [{ hz: 520, at: 0, ms: 60 }],
};
const TONE_GAIN = 0.06;

let audioContext = null;

export function playTone(name, enabled) {
  if (!enabled) return;
  try {
    audioContext ??= new (window.AudioContext ?? window.webkitAudioContext)();
    if (audioContext.state === 'suspended') audioContext.resume();
    TONES[name].forEach(({ hz, at, ms }) => {
      const start = audioContext.currentTime + at;
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = hz;
      gain.gain.setValueAtTime(TONE_GAIN, start);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + ms / 1000);
      oscillator.connect(gain).connect(audioContext.destination);
      oscillator.start(start);
      oscillator.stop(start + ms / 1000);
    });
  } catch (error) {
    console.warn('Audio unavailable', error);
  }
}
