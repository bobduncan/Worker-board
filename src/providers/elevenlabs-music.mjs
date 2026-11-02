// The asset provider for music made by ElevenLabs (Eleven Music, mode "auto"): whole tracks from a description. Part A only
// knows whether it can work now, with the same key and plan question as the other ElevenLabs providers.

import { KEY_VARIABLE, askPlan, keepAudio, makeAudio, planAnswer } from './elevenlabs-key.mjs'

/**
 * Part C: where a track is made: Eleven Music's compose (POST /v1/music, ElevenLabs' API reference looked up 2026-11-02:
 * `prompt`, optional `music_length_ms` 3000 to 600000 and `model_id`, default music_v1; the answer is the audio file).
 */
export const MUSIC_URL = 'https://api.elevenlabs.io/v1/music?output_format=mp3_44100_128'

export const elevenlabsMusic = {
  name: 'elevenlabs-music',
  mode: 'auto',
  kinds: ['music'],
  keyVariable: KEY_VARIABLE,
  card: { title: 'ElevenLabs Music', line: 'Whole tracks from a description', facts: ['Licensed for commercial use', '~900 credits a minute'], icon: 'elevenlabs' },
  /** Whether the key is set and ElevenLabs answers it (see elevenlabs.mjs). It never throws and never puts the key in its answer. */
  async check(tools = {}) {
    return planAnswer(await askPlan(tools))
  },
  /**
   * Part C: makes the request's track from its words (`{ prompt }`: the model picks the length) and keeps it as `1.mp3`
   * in the request's folder: `{ files }`, or `{ failed: why }`. It never throws and never puts the key in its answer.
   */
  async provide(request, tools = {}) {
    return keepAudio(await makeAudio(MUSIC_URL, { prompt: String(request?.text ?? '') }, tools), request.folder)
  },
}
