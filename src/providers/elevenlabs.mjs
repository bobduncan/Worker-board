// The asset provider for sound effects made by ElevenLabs, which the board runs by itself (mode "auto"). Part 1 only knows
// whether it can work now; part 2 adds `provide` (POST /v1/sound-generation). The key and the plan question are shared with
// the other two ElevenLabs providers (elevenlabs-key.mjs); the key goes to api.elevenlabs.io in one header and is in no
// answer, line of text, file or error.

import { ANSWER_MS, KEY_VARIABLE, askPlan, keepAudio, makeAudio, planAnswer } from './elevenlabs-key.mjs'

/** Part C: where a sound effect is made (ElevenLabs' sound generation; the answer is an mp3). */
export const SOUND_URL = 'https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_128'

export { ANSWER_MS, KEY_VARIABLE }

export const elevenlabs = {
  name: 'elevenlabs',
  mode: 'auto',
  kinds: ['sound effect'],
  keyVariable: KEY_VARIABLE,
  card: { title: 'ElevenLabs', line: 'Made from a description, automatically', facts: ['Free plan: testing only', 'Starter ~$6/mo for release'], icon: 'elevenlabs' },
  /**
   * Whether the key is set and ElevenLabs answers it: GET /v1/user/subscription, which makes nothing and costs no
   * credits. `tools.key` and `tools.fetch` stand in for the key and `fetch` (the tests'). It never throws, waits at
   * most ANSWER_MS and never puts the key in what it answers. `state`: works, or needs (a key, or a key that works).
   */
  async check(tools = {}) {
    return planAnswer(await askPlan(tools))
  },
  /**
   * Part C: makes the request's sound from its words (POST /v1/sound-generation, `{ text }`; ElevenLabs picks the
   * length) and keeps it as `1.mp3` in the request's folder: `{ files }`, or `{ failed: why }`. `tools.key` and
   * `tools.fetch` stand in for the key and `fetch` (the tests'). It never throws and never puts the key in its answer.
   */
  async provide(request, tools = {}) {
    return keepAudio(await makeAudio(SOUND_URL, { text: String(request?.text ?? '') }, tools), request.folder)
  },
}
