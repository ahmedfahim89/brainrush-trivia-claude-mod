export type TriviaQuestion = {
  id: number
  category: string
  points: number
  question: string
  answer: string
}

export type TriviaCurrent = { question: TriviaQuestion; isRevealed: boolean }

export type TriviaScore = { right: number; total: number }

export type TriviaStatus = 'idle' | 'loading' | 'offline'

declare module 'claude-code' {
  interface PluginState {
    'brainrush-trivia': {
      queue: TriviaQuestion[]
      current: TriviaCurrent | null
      score: TriviaScore
      isEnabled: boolean
      status: TriviaStatus
    }
  }
}
