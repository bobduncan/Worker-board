// The asset provider for sound effects made by ElevenLabs, which the board runs by itself (mode "auto"). Part 1 only knows
// whether it can work now; part 2 adds `provide` (POST /v1/sound-generation). The key and the plan question are shared with
// the other two ElevenLabs providers (elevenlabs-key.mjs); the key goes to api.elevenlabs.io in one header and is in no
// answer, line of text, file or error.

import { ANSWER_MS, KEY_VARIABLE, askPlan, planAnswer } from './elevenlabs-key.mjs'

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
}
