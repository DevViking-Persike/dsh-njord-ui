import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
/**
 * Browser Docker plugin contributing one entry to the conversation view slot
 * without defining a service. The `docker.*` RPC domain is stateless and read
 * by this plugin alone, so the wire calls stay in this apply closure (the
 * ui-settings-models / ui-skill route) rather than becoming a client-runtime
 * object-layer service; nothing here is shared, subscribed to, or cached.
 */
import type {
  ClientRemote, RemoteFailure, SessionId,
} from '@deepseek-ai/dsh-api-remotes/client'
import type { DockerComposeBrowse } from '@persike/dsh-project-tools/types'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the 'conversation.view' SlotMap row (declared by the slot's
// owning package) must be in the program for the register call to type.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { en, NS, zh } from './locales.ts'
import { DockerUnreachable, DockerView } from './DockerView.tsx'
import type { DockerInventory, DockerLogs, DockerViewInjected } from './DockerView.tsx'

export type { DockerInventory, DockerLogs, DockerViewInjected, DockerViewProps } from './DockerView.tsx'

/**
 * Required services: the conversation slot registry, the wire client, the
 * session registry (lifecycle runs as a prompt to the session's agent), and
 * the locale service.
 */
export const inject = ['slots', 'remote', 'remote.docker', 'sessions', 'locale']

/**
 * Narrow a docker-domain refusal: an unreachable or absent engine becomes the
 * view's calm empty state, every other code an ordinary read failure.
 * @param error - the RPC error the host answered with.
 * @returns the error the injected call rejects with.
 */
function dockerFailure(error: RemoteFailure): Error {
  return error.code === 'docker-unavailable'
    ? new DockerUnreachable(error.message)
    : new Error(`${error.code}: ${error.message}`)
}

/**
 * Client plugin body: register the Docker view tab. The registration rides the
 * slot service's effect wrapper, so plugin unload removes the tab.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-docker: dictionaries')
  // Registration-time text (the view tab label) reads through the bound
  // translate as a thunk, so it follows the active locale without
  // re-registration.
  const t = ctx.locale.bind(NS)
  const api = ctx.remote

  const docker = (): ClientRemote['docker'] => api.docker

  // Built once so the identities stay stable across inject reads: the view
  // keys its load effects on them, and a fresh closure per read would restart
  // every request on each render.
  const loadInventory = async (signal: AbortSignal): Promise<DockerInventory> => {
    // `all: true` because a stopped container is exactly what an operator
    // opens this tab to find; a running-only list would hide the container
    // whose exit is being diagnosed.
    const rows = docker()
    const [containers, images] = await Promise.all([
      rows.listContainers({ all: true }, signal),
      rows.listImages({}, signal),
    ])
    if (!containers.ok) throw dockerFailure(containers.error)
    if (!images.ok) throw dockerFailure(images.error)
    return { containers: containers.value.containers, images: images.value.images }
  }
  const loadLogs = async (container: string, signal: AbortSignal): Promise<DockerLogs> => {
    const response = await docker().logs({ container }, signal)
    if (!response.ok) throw dockerFailure(response.error)
    return { content: response.value.content, truncated: response.value.truncated }
  }

  // Compose selection is a host-path browse: a browser file input yields a
  // sandboxed handle, never the path the Docker CLI has to be given.
  const browseCompose = async (path: string | undefined, signal: AbortSignal): Promise<DockerComposeBrowse> => {
    const response = await docker().browseCompose(path === undefined ? {} : { path }, signal)
    if (!response.ok) throw dockerFailure(response.error)
    return response.value
  }
  /**
   * Ask the session's agent to run one Compose lifecycle action. The mutation
   * goes through the agent's `docker_compose_up` / `docker_compose_down` tool
   * call, so the session log records it; an RPC button would change machine
   * state leaving no such record. The prompt names the absolute host path the
   * person picked, so the agent has nothing to infer.
   * @param sessionId - the conversation whose agent runs the action.
   * @param action - which lifecycle direction to request.
   * @param file - absolute host path of the chosen compose file.
   * @returns nothing; the turn's progress is visible in Chat.
   * @throws Error when the session is unavailable or refused the prompt.
   */
  const requestCompose = async (
    sessionId: SessionId,
    action: 'up' | 'down',
    file: string,
  ): Promise<void> => {
    const session = ctx.sessions.binding(sessionId)?.session
    if (session === undefined) throw new Error(`ui-docker: session "${sessionId}" is unavailable`)
    const tool = action === 'up' ? 'docker_compose_up' : 'docker_compose_down'
    const text = `Run the ${tool} tool with file set to the absolute path ${file}. Use exactly that path and report the resulting container states.`
    // `queue` rather than `steer`: the action is a new request, not a
    // correction of whatever turn is already running.
    const result = await session.prompt([{ type: 'text', text }], 'queue')
    if (!result.ok) throw new Error(result.error.message)
  }

  /**
   * Ask the session's agent to open a shell inside a container. A shell is an
   * interactive session, which this read-only tab cannot host; the agent owns
   * terminals, so the container is handed to it and the work stays in Chat.
   * @param sessionId - the conversation whose agent opens the shell.
   * @param container - the container id to enter.
   * @returns nothing; the session is visible in Chat.
   * @throws Error when the session is unavailable or refused the prompt.
   */
  const requestShell = async (sessionId: SessionId, container: string): Promise<void> => {
    const session = ctx.sessions.binding(sessionId)?.session
    if (session === undefined) throw new Error(`ui-docker: session "${sessionId}" is unavailable`)
    const text = `Open an interactive shell inside the running Docker container ${container} and keep it available for follow-up commands. Report what shell you obtained.`
    const result = await session.prompt([{ type: 'text', text }], 'queue')
    if (!result.ok) throw new Error(result.error.message)
  }

  const controlContainer = async (container: string, action: 'start' | 'stop' | 'restart'): Promise<void> => {
    const response = await docker().control({ container, action })
    if (!response.ok) throw dockerFailure(response.error)
  }

  // Removal is forced from here because the tab already asked the operator to
  // confirm: refusing a running container after a confirmed delete would be a
  // second gate over the same decision.
  const removeContainer = async (container: string): Promise<void> => {
    const response = await docker().removeContainer({ container, force: true })
    if (!response.ok) throw dockerFailure(response.error)
  }
  const removeImage = async (image: string): Promise<void> => {
    const response = await docker().removeImage({ image, force: true })
    if (!response.ok) throw dockerFailure(response.error)
  }

  const engineStatus = async (signal: AbortSignal) => {
    const response = await docker().engineStatus({}, signal)
    if (!response.ok) throw dockerFailure(response.error)
    return response.value.status
  }
  const startEngine = async (): Promise<void> => {
    const response = await docker().startEngine({})
    if (!response.ok) throw dockerFailure(response.error)
  }
  const installEngine = async (): Promise<void> => {
    const response = await docker().installEngine({})
    if (!response.ok) throw dockerFailure(response.error)
  }
  const injected = (sessionId: SessionId): DockerViewInjected => ({
    loadInventory,
    loadLogs,
    engineStatus,
    startEngine,
    installEngine,
    controlContainer,
    removeContainer,
    removeImage,
    openShell: container => requestShell(sessionId, container),
    browseCompose,
    composeUp: file => requestCompose(sessionId, 'up', file),
    composeDown: file => requestCompose(sessionId, 'down', file),
  })

  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view',
    id: 'docker',
    // After Trajectory (10), which itself sits after Chat.
    order: 20,
    locale: NS,
    label: () => t('view.docker'),
    inject: injected,
  }, DockerView))
}
