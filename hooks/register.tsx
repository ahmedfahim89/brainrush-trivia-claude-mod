import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { TriviaQuestion, TriviaScore, TriviaStatus } from '../types'

const SITE = 'https://brainrush.integration.ninja'
const BOARD_MAX_CATEGORIES = 50 // api/questions.php
const SEEN_MAX = 5000 // api/questions.php BOARD_MAX_SEEN
const REFILL_BELOW = 3

const queue = atom({ plugin: 'brainrush-trivia', key: 'queue' } as const, [])
const current = atom({ plugin: 'brainrush-trivia', key: 'current' } as const, null)
const score = atom({ plugin: 'brainrush-trivia', key: 'score' } as const, { right: 0, total: 0 })
const isEnabled = atom({ plugin: 'brainrush-trivia', key: 'isEnabled' } as const, true)
const status = atom({ plugin: 'brainrush-trivia', key: 'status' } as const, 'idle')

type BoardQuestion = { id: number; question: string; answer: string; image: string | null }
type Board = {
  categories: { name: string; questions: Record<string, BoardQuestion> }[]
}

function shuffle<T>(list: T[]): T[] {
  const out = [...list]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/** Text questions only: picture questions (flags, landmarks) need the image to make sense. */
function flatten(board: Board): TriviaQuestion[] {
  return board.categories.flatMap(category =>
    Object.entries(category.questions)
      .filter(([, q]) => q.image === null)
      .map(([points, q]) => ({
        id: q.id,
        category: category.name,
        points: Number(points),
        question: q.question,
        answer: q.answer,
      })),
  )
}

async function seenIds($: EngineInterface): Promise<number[]> {
  const seen = await $.store.get('seen')
  return Array.isArray(seen) ? seen.filter((id): id is number => typeof id === 'number') : []
}

async function setStatus($: EngineInterface, next: TriviaStatus) {
  await update($, status, () => next)
  $.ui.status(next === 'offline' ? 'BrainRush trivia: offline' : undefined)
}

/** Draws one board from the live site and adds its unseen text questions to the queue. */
async function refill($: EngineInterface) {
  if ((await read($, status)) === 'loading') {
    return
  }
  await setStatus($, 'loading')
  try {
    const cats = await $.http.fetch(`${SITE}/api/categories.php?playable=1`)
    if (!cats.ok) {
      throw new Error(`categories: HTTP ${cats.status}`)
    }
    const ids = (JSON.parse(cats.text) as { id: number }[]).map(c => c.id).slice(0, BOARD_MAX_CATEGORIES)
    const seen = await seenIds($)
    const res = await $.http.fetch(`${SITE}/api/questions.php?board=1`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ categories: ids.join(','), seen }),
    })
    if (!res.ok) {
      throw new Error(`board: HTTP ${res.status}`)
    }
    const held = new Set((await read($, queue)).map(q => q.id))
    const now = await read($, current)
    if (now !== null) {
      held.add(now.question.id)
    }
    const fresh = shuffle(flatten(JSON.parse(res.text) as Board).filter(q => !held.has(q.id)))
    await update($, queue, list => [...list, ...fresh])
    await setStatus($, 'idle')
    if (now === null) {
      await advance($)
    }
  } catch {
    await setStatus($, 'offline')
  }
}

/** Moves the next queued question in, records it as seen, and refills when running low. */
async function advance($: EngineInterface) {
  const list = await read($, queue)
  const [first, ...rest] = list
  await update($, queue, () => rest)
  await update($, current, () => (first === undefined ? null : { question: first, isRevealed: false }))
  if (first !== undefined) {
    const seen = await seenIds($)
    await $.store.set('seen', [...seen.filter(id => id !== first.id), first.id].slice(-SEEN_MAX))
  }
  if (rest.length < REFILL_BELOW) {
    $.clock.after(0, () => void refill($))
  }
}

async function mark($: EngineInterface, isRight: boolean) {
  const next = await update($, score, s => ({ right: s.right + (isRight ? 1 : 0), total: s.total + 1 }))
  await $.store.set('score', next)
  await advance($)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'trivia',
      description: 'BrainRush trivia while Claude works: score, on, off, reset',
      argumentHint: '[on|off|reset]',
      immediate: true,
    })
    const saved = (await $.store.get('score')) as TriviaScore | undefined
    if (saved !== undefined) {
      await update($, score, () => saved)
    }
    const enabled = await $.store.get('isEnabled')
    await update($, isEnabled, () => enabled !== false)
    $.clock.after(0, () => void refill($))

    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    const now = await read($, current)
    if (now?.isRevealed) {
      await advance($)
    } else if (now === null && (await read($, status)) !== 'loading') {
      $.clock.after(0, () => void refill($))
    }

    return next(e)
  })

  on('command.run', { command: 'trivia' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'on' || arg === 'off') {
      await update($, isEnabled, () => arg === 'on')
      await $.store.set('isEnabled', arg === 'on')
    } else if (arg === 'reset') {
      await update($, score, () => ({ right: 0, total: 0 }))
      await $.store.set('score', { right: 0, total: 0 })
    } else if (arg !== '') {
      return { text: 'Usage: /trivia [on|off|reset]' }
    }
    const s = await read($, score)
    const state = (await read($, isEnabled)) ? 'on' : 'off'

    return { text: `BrainRush trivia is ${state}. Score: ${s.right}/${s.total}.` }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (!e.props.isWorking || e.props.hasSurvey || !(await read($, isEnabled))) {
      return next(e)
    }
    const now = await read($, current)
    if (now === null) {
      return next(e)
    }
    const s = await read($, score)
    const { question: q, isRevealed } = now
    const { Box, Button, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="column" width={e.props.bodyColumns}>
        <Box flexDirection="row" justifyContent="space-between">
          <Text color="cyan" weight="bold">
            BrainRush · {q.category} · {q.points}
          </Text>
          <Box key="score">
            <Text dimColor>
              Score {s.right}/{s.total}
            </Text>
          </Box>
        </Box>
        <Text wrap="wrap">{q.question}</Text>
        {isRevealed && (
          <Box key="answer">
            <Text color="green" wrap="wrap">
              Answer: {q.answer}
            </Text>
          </Box>
        )}
        {isRevealed ? (
          <Box flexDirection="row" gap={1}>
            <Button key="right" hotkey="1" label="Got it" variant="primary" onPress={() => mark($, true)} />
            <Button key="wrong" hotkey="2" label="Missed" onPress={() => mark($, false)} />
          </Box>
        ) : (
          <Box flexDirection="row" gap={1}>
            <Button
              key="reveal"
              hotkey="1"
              label="Reveal"
              variant="primary"
              onPress={() => update($, current, c => (c === null ? c : { ...c, isRevealed: true }))}
            />
            <Button key="skip" hotkey="2" label="Skip" onPress={() => advance($)} />
          </Box>
        )}
      </Box>
    )
  })
}
