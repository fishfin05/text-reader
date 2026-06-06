export interface WordTimestamp {
  word: string
  startTime: number
}

export interface Chunk {
  index: number
  text: string
  wordTimestamps: WordTimestamp[]
  audioUrl: string | null
}

export interface Article {
  id: string
  url: string
  title: string
  byline: string | null
  chunks: Chunk[]
  createdAt: string
}
