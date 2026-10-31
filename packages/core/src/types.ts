/** What an agent is doing, as the office shows it. */
export type Activity =
  | 'thinking' // waiting on the model: at the desk, typing
  | 'edit' // writing files: at the desk, typing fast
  | 'read' // reading or searching: at the bookshelf
  | 'run' // running a command: at the server rack
  | 'test' // running tests: at the lab bench
  | 'web' // on the web: at the window with a laptop
  | 'delegate' // starting a helper: on the phone
  | 'message' // talking to a teammate: at the meeting table
  | 'plan' // updating its to-do list: at the whiteboard
  | 'tool' // any other tool

export type State =
  | 'working'
  | 'waiting' // a tool call with no answer for a while: probably waiting for you
  | 'idle'
  | 'done' // just finished its turn
  | 'gone' // a helper that finished: it went home

/** Where an idle agent spends its time; an idle manager watches its team while anyone works. */
export type Rest = 'coffee' | 'couch' | 'watching' | null

export interface Tool {
  name: string
  /** What it's working on: a file name, a command, a search… */
  target: string | null
  activity: Activity
}

/** One tool call, for an agent's timeline. */
export interface Step {
  /** When it was called (milliseconds). */
  at: number
  tool: Tool
}

/** What the end of a transcript says. */
export interface Tail {
  step: 'finished' | 'calledTool' | 'awaitingModel' | null
  tool: Tool | null
  lastText: string | null
  title: string | null
  cwd: string | null
  model: string | null
  permissionMode: string | null
  /** The context window in use at the last reply. */
  contextTokens: number | null
  lastEventAt: number | null
  /** Its latest tool calls, oldest first (at most `HISTORY` of them). */
  history: Step[]
}

export type Role = 'manager' | 'staff' | 'intern'

export interface Agent {
  id: string
  name: string
  role: Role
  /** The team colour Claude Code gave a teammate ("green"…), when it has one. */
  color: string | null
  /** For interns: the agent that started them. */
  parentId: string | null
  /** What it was asked to do. */
  task: string | null
  model: string | null
  state: State
  rest: Rest
  /** What it's doing right now while working: the tool it's waiting on, or thinking. */
  activity: Activity | null
  /** The last tool it called (may have finished). */
  tool: Tool | null
  lastText: string | null
  contextTokens: number | null
  /** Its latest tool calls, oldest first: the timeline. */
  history: Step[]
  /** When its transcript last changed. */
  updatedAt: number
}

/** One live Claude Code session: an office. */
export interface Office {
  sessionId: string
  project: string
  cwd: string | null
  title: string | null
  manager: Agent
  staff: Agent[]
  interns: Agent[]
  /** Helpers that finished and left, counted only. */
  wentHome: number
  updatedAt: number
}
