// The day format: what the agent knows about a person. One record per logical day, a plan of
// tasks, and "you" — the person's own base habits, intentions and planning rules. Every field
// that a real routine app may not have is optional; the agent must cope without it.
import type { LocalTime, LogicalDate } from './time.ts'

export type ScreenCategory = 'work' | 'study' | 'video' | 'games' | 'social' | 'messaging' | 'calls' | 'other'
export type MealKind = 'breakfast' | 'lunch' | 'dinner' | 'snack'
export type TaskSize = 'small' | 'normal' | 'big'

/** The night that ended on the morning of the day */
export interface Sleep {
  /** Went to bed */
  bed: LocalTime
  /** Put the phone away to sleep */
  asleep: LocalTime
  /** Woke up */
  wake: LocalTime
  /** Got up */
  rise: LocalTime
  /** "How did you sleep?": rested −1…1 (worn out … fresh), quality −1…1 (restless … deep) */
  feel?: { rested: number; quality: number }
}

export interface Mood {
  at: LocalTime
  /** −1 unpleasant … 1 pleasant */
  valence: number
  /** −1 low energy … 1 high */
  arousal: number
  /** 0 calm … 1 tense */
  tension?: number
  words: string[]
}

/** Self-rated charge, 0 … 1 */
export interface Energy {
  at: LocalTime
  level: number
}

export interface Meal {
  at: LocalTime
  kind: MealKind
}

export interface Routine {
  from: LocalTime
  to: LocalTime
  /** Ids of routine items done; base items (Profile.base) among them */
  done: string[]
}

export interface ScreenTime {
  device: 'phone' | 'laptop'
  category: ScreenCategory
  minutes: number
  /** Of them, after 22:00 */
  lateMinutes: number
}

export interface Workout {
  at: LocalTime
  kind: string
  minutes: number
}

export interface Note {
  at: LocalTime
  /** Free text written by the person — untrusted content for the agent */
  text: string
}

export interface Day {
  date: LogicalDate
  sleep?: Sleep
  mood: Mood[]
  energy: Energy[]
  meals: Meal[]
  routines: { morning?: Routine; evening?: Routine }
  /** Absent when no source covered the day (e.g. the laptop was off) */
  screen?: ScreenTime[]
  steps?: number
  workout?: Workout
  notes: Note[]
}

export interface Task {
  id: string
  title: string
  /** Area of life, e.g. work, study, home, health, people */
  sphere: string
  size: TaskSize
  /** Planned day; none — inbox (or `someday`) */
  date?: LogicalDate
  /** Decided to do "some day", no date */
  someday?: boolean
  createdAt: LocalTime
  doneAt?: LocalTime
  /** Let go: not done and not needed any more */
  droppedAt?: LocalTime
  /** How many times it was moved to another day */
  moves: number
  /** The day it was first planned for, if it was moved since */
  firstDate?: LogicalDate
  /** Repeats every N days from the last time */
  repeatEvery?: number
  /** Optional: must be done by this day (may be planned earlier) */
  deadline?: LogicalDate
  /** Optional: fixed time of day, e.g. an appointment */
  time?: string
}

/** Small things the person always wants to do, with their cost and reason in the person's words */
export interface BaseHabit {
  id: string
  title: string
  cost: string
  why: string
}

export interface Intention {
  text: string
  why: string
  since: LogicalDate
}

/** "You": the person as they described themselves when thinking clearly */
export interface Profile {
  name: string
  about: string
  base: BaseHabit[]
  intentions: Intention[]
  /** Planning rules in the person's words ("no work after 21:00") */
  rules: string[]
}

/** A reminder the person will get at a moment, optionally about a task */
export interface Reminder {
  id: string
  text: string
  at: LocalTime
  taskId?: string
}

export interface Dataset {
  version: 1
  /** The fixed "today" of the dataset */
  today: LogicalDate
  profile: Profile
  days: Day[]
  tasks: Task[]
  /** Scheduled reminders; absent — none yet */
  reminders?: Reminder[]
}
