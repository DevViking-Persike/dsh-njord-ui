import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
/**
 * Browser plugin contributing the Knowledge settings section: the skills,
 * decision records, and documentation one session can draw on.
 *
 * It defines no service and owns no RPC domain. Skills come from the existing
 * `skill.*` catalog and Markdown from the editor's workspace-fenced file
 * calls, so this section adds no second route to the disk.
 */
import type { ClientRemote, RemoteFailure } from '@deepseek-ai/dsh-api-remotes/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the 'settings.section' SlotMap row is declared by the shell.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { en, NS, zh } from './locales.ts'
import { KnowledgeSection } from './KnowledgeSection.tsx'
import type { KnowledgeInjected } from './KnowledgeSection.tsx'

export type {
  KnowledgeDoc, KnowledgeInjected, KnowledgeSectionProps, KnowledgeSkill,
} from './KnowledgeSection.tsx'

/** Required services: the settings slot registry, the wire client, the locale service, and the session list. */
export const inject = ['slots', 'remote', 'remote.editor', 'remote.treadmill', 'remote.skills', 'remote.settings', 'remote.session', 'locale', 'sessions']

/** Marker for a composition serving neither skills nor a filesystem. */
export class KnowledgeUnavailable extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'KnowledgeUnavailable'
  }
}

/**
 * Narrow a domain refusal so the section can separate an absent seam from an
 * ordinary failure.
 * @param error - the RPC error the host answered with.
 * @returns the error the injected call rejects with.
 */
function knowledgeFailure(error: RemoteFailure): Error {
  if (error.code === 'editor-unavailable') return new KnowledgeUnavailable(error.message)
  return new Error(`${error.code}: ${error.message}`)
}

/**
 * Client plugin body: register the Knowledge settings section.
 * @param ctx - client root context.
 */
/** Provider name of the harness-owned Treadmill installation, listed in its own pane. */
const TREADMILL_PROVIDER = 'treadmill'

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-knowledge: dictionaries')
  const t = ctx.locale.bind(NS)
  const api = ctx.remote

  const editor = (): ClientRemote['editor'] => api.editor

  // The settings shell renders one section at root scope, while both wire
  // domains are addressed by session. The list publishes which session is
  // current, and that is the project the operator has open behind the panel.
  const currentSession = () => Object.values(ctx.sessions.list.getSnapshot().byId)
    .find(session => (session.retainedBy.mainView ?? 0) > 0)?.id

  const injected: KnowledgeInjected = {
    listSkills: async (signal) => {
      const sessionId = currentSession()
      if (sessionId === undefined) return []
      const response = await api.skills.list({ sessionId }, signal)
      if (!response.ok) throw knowledgeFailure(response.error)
      // The Skills pane lists what the project, the user, and the composition
      // bring; the Treadmill installation has its own pane.
      return response.value.skills.filter(skill => skill.provider !== TREADMILL_PROVIDER).map(skill => ({
        name: skill.name,
        description: skill.description,
        ...skill.whenToUse === undefined ? {} : { whenToUse: skill.whenToUse },
        modelInvocable: skill.modelInvocable,
        source: skill.source,
        ...skill.path === undefined ? {} : { path: skill.path },
      }))
    },
    listDir: async (path, signal) => {
      const sessionId = currentSession()
      const response = await editor().listDir({
        ...sessionId === undefined ? {} : { sessionId },
        ...path === undefined ? {} : { path },
      }, signal)
      if (!response.ok) throw knowledgeFailure(response.error)
      return response.value
    },
    readFile: async (path, signal) => {
      const sessionId = currentSession()
      const response = await editor().readFile({
        ...sessionId === undefined ? {} : { sessionId },
        path,
      }, signal)
      if (!response.ok) throw knowledgeFailure(response.error)
      return { content: response.value.content }
    },
    editFile: async (path, signal) => {
      const response = await api.session.openWorkspacePath({ path }, signal)
      if (!response.ok) throw knowledgeFailure(response.error)
    },
    describeTreadmill: async (signal) => {
      const response = await api.treadmill.describe({}, signal)
      if (!response.ok) throw knowledgeFailure(response.error)
      const { root, enabled, files, pipelineError } = response.value
      return { root, enabled, files, ...pipelineError === undefined ? {} : { pipelineError } }
    },
    readTreadmillFile: async (path, signal) => {
      const response = await api.treadmill.readFile({ path }, signal)
      if (!response.ok) throw knowledgeFailure(response.error)
      return response.value.content
    },
    writeTreadmillFile: async (path, content, signal) => {
      const response = await api.treadmill.writeFile({ path, content }, signal)
      if (!response.ok) throw knowledgeFailure(response.error)
    },
    saveTreadmillFileToProject: async (path, content, signal) => {
      const sessionId = currentSession()
      if (sessionId === undefined) throw new Error(t('treadmill.noProject'))
      const response = await api.treadmill.saveToProject({ sessionId, path, content }, signal)
      if (!response.ok) throw knowledgeFailure(response.error)
      return response.value.path
    },
    setTreadmillEnabled: async (enabled, signal) => {
      signal.throwIfAborted()
      const response = await api.settings.update('treadmill', { enabled }, undefined)
      if (!response.ok) throw knowledgeFailure(response.error)
    },
  }

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'knowledge',
    // After Plugins (15) and before Agent presets (20) would split a pair that
    // reads together, so this sits after both.
    order: 25,
    locale: NS,
    label: () => t('section.label'),
    inject: () => injected,
  }, KnowledgeSection))
}
