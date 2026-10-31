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
  /** Its transcript file, for reading its conversation (server side only uses it). */
  transcript: string
}

/** One live session (Claude Code or Codex): an office. */
export interface Office {
  /** Which agent runs it. */
  kind: 'claude' | 'codex'
  sessionId: string
  project: string
  cwd: string | null
  title: string | null
  manager: Agent
  staff: Agent[]
  interns: Agent[]
  /** Helpers that finished and left, counted only. */
  wentHome: number
  /** The Claude Code process running it, when there is one: its id and what it says it's doing. */
  process: { pid: number; status: string | null } | null
  /** Its process has ended (known only where Claude Code keeps `~/.claude/sessions`). */
  ended: boolean
  updatedAt: number
}

/** What happened when the page asked to go to a session (`POST /api/jump`). */
export interface JumpResult {
  done: 'opened' | 'copy'
  /** What the page says: "Opened its tab in Terminal", or why it couldn't. */
  message: string
  /** For `copy`: the command that resumes the session. */
  command?: string
}

/**
 * Something an agent asks you: a permission prompt, or questions to choose answers for. Claude
 * Code hands it to AgentHQ's hook, which waits for your answer here; the terminal can still
 * answer it, and then it goes away.
 */
export interface Ask {
  id: string
  sessionId: string
  /** Who asks: its agent in the office (the manager when it can't tell). */
  agentId: string
  kind: 'permission' | 'question'
  tool: Tool
  /** What it wants to run or change, for reading (cut when long). */
  input: string | null
  /** For a question: what it asks, with its choices. */
  questions: AskQuestion[]
  /** Ways to allow it from now on, as Claude Code offers them ("Always allow npm test…"). */
  always: string[]
  at: number
}

export interface AskQuestion {
  question: string
  header: string | null
  multiSelect: boolean
  options: { label: string; description: string | null }[]
}

/** Your answer: allow once, one of its "always" choices (by index), deny with a reason, or your answers to its questions. */
export type AskAnswer =
  | { id: string; choice: 'once' }
  | { id: string; choice: 'always'; index: number }
  | { id: string; choice: 'deny'; message?: string }
  | { id: string; choice: 'answers'; answers: Record<string, string> }
