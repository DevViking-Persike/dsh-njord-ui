/** Archify composer action contributed independently of the native skill plugin. */
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { ArchifySeat } from './ArchifySeat.tsx'
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { njordArchify: 'archify.action' | 'archify.running' | 'archify.hint' }
}
export const inject = ['locale', 'slots', 'sessions']
export function apply(ctx: Context): void {
  const NS = 'njordArchify'
  const en = { 'archify.action': 'Generate architecture', 'archify.running': 'Generating…', 'archify.hint': 'Use Archify to create editable architecture files under docs/architecture/generated' }
  const zh = { 'archify.action': '生成架构', 'archify.running': '生成中…', 'archify.hint': '使用 Archify 在 docs/architecture/generated 中生成可编辑的架构文件' }
  ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'njord: Archify locale')
  const sessions = ctx.sessions
  ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
    name: 'conversation.input.left',
    id: 'archify',
    order: 10,
    locale: NS,
    inject: () => ({
      generate: async (sessionId: SessionId) => {
        const binding = sessions.binding(sessionId)
        if (binding === undefined) throw new Error('the current session is not materialized')
        const request = [
          '/archify',
          'Analise este repositório e gere uma documentação de arquitetura atualizada.',
          'Salve os artefatos persistentes em docs/architecture/generated/.',
          'Inclua um HTML navegável, um SVG editável e um Markdown que explique componentes, fluxos e arquivos-fonte usados como evidência.',
          'Valide todos os arquivos gerados antes de concluir.',
        ].join(' ')
        const result = await binding.session.prompt([{ type: 'text', text: request }], 'queue')
        if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)
      },
    }),
  }, ArchifySeat))
}
