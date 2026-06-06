import { pgTable, text, jsonb, timestamp } from 'drizzle-orm/pg-core'
import type { Chunk } from './types'

export const articles = pgTable('articles', {
  id:        text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  url:       text('url').notNull().unique(),
  title:     text('title').notNull(),
  byline:    text('byline'),
  chunks:    jsonb('chunks').notNull().$type<Chunk[]>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})
