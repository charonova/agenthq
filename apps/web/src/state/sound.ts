/** A short chime, made with Web Audio: no sound files. "waiting" rises; "finished" is softer. */
let audio: AudioContext | null = null

export function chime(kind: 'waiting' | 'finished'): void {
  try {
    audio ??= new AudioContext()
    if (audio.state === 'suspended') void audio.resume()
    const notes = kind === 'waiting' ? [659.25, 880] : [523.25, 659.25]
    const start = audio.currentTime
    notes.forEach((frequency, i) => {
      const oscillator = audio!.createOscillator()
      const gain = audio!.createGain()
      oscillator.type = 'sine'
      oscillator.frequency.value = frequency
      const at = start + i * 0.13
      gain.gain.setValueAtTime(0, at)
      gain.gain.linearRampToValueAtTime(kind === 'waiting' ? 0.18 : 0.1, at + 0.015)
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.45)
      oscillator.connect(gain).connect(audio!.destination)
      oscillator.start(at)
      oscillator.stop(at + 0.5)
    })
  } catch {
    // No audio here (autoplay blocked until the page is used): stay quiet.
  }
}
