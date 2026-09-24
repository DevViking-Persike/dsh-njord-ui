import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
/** Browser Treadmill plugin: project cursor projection and logged Session execution. */
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { TreadmillView } from './TreadmillView.tsx'
import { createFollower } from './follower.ts'
import { en, NS, zh, type TreadmillKey } from './locales.ts'
import {
  INSTALL_PROMPT, FINISH_PROMPT, automaticStage, canFinishStages, parseCursor, projectStages, runnableStage, stagePrompt, stagesFromHost,
  type TreadmillCursor, type StageSpec,
} from './stages.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { treadmill: TreadmillKey }
}
export const inject = ['remote', 'remote.editor', 'remote.treadmill', 'sessions', 'slots', 'locale']

/** Register the Treadmill view after Docker. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-treadmill: dictionaries')
  const api = ctx.remote
  const sessions = ctx.get('sessions') as ISessions
  const submit = async (id: SessionId, text: string) => {
    const session = sessions.binding(id)?.session
    if (session === undefined) throw new Error('the current Session is unavailable')
    const result = await session.prompt([{ type: 'text', text }], 'queue')
    if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)
  }
  const loadCursor = async (id: SessionId, signal?: AbortSignal): Promise<TreadmillCursor | null> => {
    const response = await api.editor.readFile({ sessionId: id, path: '.spec/esteira-state.yaml' }, signal)
    if (!response.ok) {
      if (response.error.code === 'editor-not-found') return null
      throw new Error(`${response.error.code}: ${response.error.message}`)
    }
    return parseCursor(response.value.content)
  }

  /**
   * Follow-through: after a Treadmill-started run ends, the next stage runs
   * by itself while the cursor moved and the stage's gate is `auto`. A
   * `manual` gate, an unmoved cursor, an error verdict, or a switched-off
   * follower leaves the next step to the run action.
   */
  const follower = createFollower({
    session: (id: SessionId) => sessions.binding(id)?.session,
    next: async (id: SessionId) => {
      const [cursor, table] = await Promise.all([loadCursor(id), loadTable(id)])
      if (cursor === null) return undefined
      const stage = automaticStage(cursor, table)
      if (stage === undefined) return undefined
      return { cursorStage: cursor.stage, stage, prompt: stagePrompt(stage, cursor, table) }
    },
    submit,
    warn: (message: string) => { ctx.logger.warn(`ui-treadmill: ${message}`) },
  })
  ctx.effect(() => () => { follower.dispose() }, 'ui-treadmill: follow-through watchers')

  /** The effective stage table of one session's project, so a stage prompt can name the disabled stages. */
  const loadTable = async (id: SessionId): Promise<StageSpec[]> => {
    const response = await api.treadmill.describe({ sessionId: id })
    if (!response.ok) throw new Error(`${response.error.code}: ${response.error.message}`)
    if (!response.value.enabled) throw new Error(ctx.locale.bind(NS)('disabled'))
    if (response.value.pipelineError !== undefined) throw new Error(response.value.pipelineError)
    return stagesFromHost(response.value.stages)
  }
  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view', id: 'treadmill', order: 30, locale: NS,
    label: () => ctx.locale.bind(NS)('view.treadmill'),
    inject: (sessionId: SessionId) => ({
      loadCursor: (signal: AbortSignal) => loadCursor(sessionId, signal),
      runStage: async (id: SessionId, stage: StageSpec) => {
        const [cursor, table] = await Promise.all([loadCursor(id), loadTable(id)])
        if (cursor === null || cursor.awaiting !== undefined
          || runnableStage(projectStages(cursor, false, table))?.id !== stage.id) {
          throw new Error(ctx.locale.bind(NS)('stageUnavailable'))
        }
        const current = table.find(candidate => candidate.id === stage.id)
        if (current === undefined) throw new Error(ctx.locale.bind(NS)('stageUnavailable'))
        await submit(id, stagePrompt(current, cursor, table))
        follower.started(id, stage.id)
      },
      finishTreadmill: async (id: SessionId) => {
        const [cursor, table] = await Promise.all([loadCursor(id), loadTable(id)])
        if (cursor === null || !canFinishStages(cursor, projectStages(cursor, false, table))) {
          throw new Error(ctx.locale.bind(NS)('stageUnavailable'))
        }
        await submit(id, FINISH_PROMPT)
      },
      updateStage: async (stageId: string, patch: { enabled?: boolean; gate?: 'manual' | 'auto' }) => {
        const response = await api.treadmill.updateStage({ sessionId, id: stageId, ...patch })
        if (!response.ok) throw new Error(`${response.error.code}: ${response.error.message}`)
      },
      followThrough: {
        get: () => follower.enabled(sessionId),
        set: (enabled: boolean) => { follower.setEnabled(sessionId, enabled) },
      },
      installTreadmill: (id: SessionId) => submit(id, INSTALL_PROMPT),
      loadInstallation: async (signal: AbortSignal) => {
        const response = await api.treadmill.describe({ sessionId }, signal)
        if (!response.ok) throw new Error(`${response.error.code}: ${response.error.message}`)
        const { enabled, stages, pipelineError, tableSource } = response.value
        return { enabled, stages: stagesFromHost(stages), tableSource, ...pipelineError === undefined ? {} : { pipelineError } }
      },
    }),
  }, TreadmillView))
}
