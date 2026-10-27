// 提示音：Web Audio 现场合成，不用音频文件（设计语言板的声音栏）。都在 0.4 秒内，柔和，默认音量 30%。
// 只在“你没在看也该知道”的时候出声：发送、提交（L1，极轻）、完成（L2）、询问和出错（L3）；按键音默认关。

export type SoundKind = 'send' | 'commit' | 'done' | 'ask' | 'error' | 'tick'

let ac: AudioContext | null = null
let settings = { enabled: true, volume: 0.3, keyTick: false }

export function setSoundSettings(s: Partial<typeof settings>) { settings = { ...settings, ...s } }
export function soundSettings() { return settings }

export function play(kind: SoundKind) {
  if (!settings.enabled) return
  if (kind === 'tick' && !settings.keyTick) return
  try {
    const C = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    if (!C) return
    if (!ac) ac = new C()
    if (ac.state === 'suspended') void ac.resume()
    const ctx = ac
    const t = ctx.currentTime + 0.02
    const out = ctx.createGain()
    out.gain.value = settings.volume
    out.connect(ctx.destination)
    const note = (f: number, at: number, dur: number, type: OscillatorType = 'sine', g = 0.5, f2?: number) => {
      const o = ctx.createOscillator()
      const v = ctx.createGain()
      o.type = type
      o.frequency.setValueAtTime(f, t + at)
      if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + at + dur * 0.8)
      v.gain.setValueAtTime(0.0001, t + at)
      v.gain.linearRampToValueAtTime(g, t + at + 0.012)
      v.gain.exponentialRampToValueAtTime(0.0001, t + at + dur)
      o.connect(v)
      v.connect(out)
      o.start(t + at)
      o.stop(t + at + dur + 0.03)
    }
    switch (kind) {
      case 'send': note(620, 0, 0.12, 'sine', 0.45, 940); break
      case 'done': note(659.3, 0, 0.22, 'sine', 0.5); note(987.8, 0.11, 0.3, 'sine', 0.45); break
      case 'ask': note(784, 0, 0.16, 'triangle', 0.45); note(932.3, 0.17, 0.22, 'triangle', 0.45); break
      case 'error': note(329.6, 0, 0.18, 'triangle', 0.5); note(261.6, 0.15, 0.26, 'triangle', 0.5); break
      case 'commit': note(523.3, 0, 0.32, 'sine', 0.3); note(659.3, 0.03, 0.32, 'sine', 0.26); note(784, 0.06, 0.36, 'sine', 0.24); break
      case 'tick': note(2200, 0, 0.03, 'sine', 0.25); break
    }
  } catch { /* 没有声卡或被系统禁止时安静地失败 */ }
}
