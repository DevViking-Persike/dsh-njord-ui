/**
 * Docker view: a projection of the host's `docker.*` RPC domain — containers
 * (including stopped ones), one container's recent logs on demand, locally
 * available images, and a compose picker that browses the host filesystem for
 * a compose file. Lifecycle never runs from here directly: the picker asks the
 * session's agent to call `docker_compose_up` / `docker_compose_down`, so the
 * session log records every machine-state change. An unreachable engine is an
 * ordinary state, not a failure, and renders as a calm empty message.
 */

import { useCallback, useEffect, useState } from 'react'
import clsx from 'clsx'
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  DockerComposeBrowse, DockerContainerEntry, DockerEngineStatusView, DockerImageEntry,
} from '@persike/dsh-project-tools/types'
import { ComposePicker } from './ComposePicker.tsx'
import { EnginePanel } from './EnginePanel.tsx'
import css from './DockerView.module.css'

/** One container listing plus one image listing, read in the same refresh. */
export interface DockerInventory {
  containers: readonly DockerContainerEntry[]
  images: readonly DockerImageEntry[]
}

/** One container's recent log output as the host capped it. */
export interface DockerLogs {
  content: string
  /** The host or the engine dropped older entries; only the newest text survives. */
  truncated: boolean
}

/**
 * Wire calls injected from the plugin's apply closure. Each rejects with the
 * abort reason when its signal fires, and with a `DockerUnreachable` when no
 * engine answered — the calm empty state, distinct from any other failure.
 */
export interface DockerViewInjected {
  /** Read every container the engine knows, running or not. */
  loadInventory: (signal: AbortSignal) => Promise<DockerInventory>
  /** Read one container's recent log output. */
  loadLogs: (container: string, signal: AbortSignal) => Promise<DockerLogs>
  /**
   * Apply one lifecycle action to a single container. Resolving means the
   * engine settled the action; the caller re-reads the list afterwards.
   */
  controlContainer: (container: string, action: 'start' | 'stop' | 'restart') => Promise<void>
  /**
   * Remove one container. Resolving means the engine deleted it; the caller
   * re-reads the list afterwards. A running container is stopped first.
   */
  removeContainer: (container: string) => Promise<void>
  /** Remove one locally stored image, by id. */
  removeImage: (image: string) => Promise<void>
  /**
   * Ask the session's agent to open a shell inside a container. Resolving
   * means the request reached the agent, not that a shell is open: the
   * session itself is a logged tool call visible in Chat.
   */
  openShell: (container: string) => Promise<void>
  /** Read whether an engine answers and what could be done about it. */
  engineStatus: (signal: AbortSignal) => Promise<DockerEngineStatusView>
  /** Start the local container runtime; resolves once the attempt settled. */
  startEngine: () => Promise<void>
  /** Install a container runtime; resolves once the attempt settled. */
  installEngine: () => Promise<void>
  /** Browse one host directory level, filtered to directories and compose files. */
  browseCompose: (path: string | undefined, signal: AbortSignal) => Promise<DockerComposeBrowse>
  /**
   * Ask the session's agent to start the Compose project at an absolute host
   * path. Resolving means the request reached the agent, not that the project
   * is up: the run itself is a logged tool call visible in Chat.
   */
  composeUp: (file: string) => Promise<void>
  /** Ask the session's agent to stop the Compose project at an absolute host path. */
  composeDown: (file: string) => Promise<void>
}

/**
 * Marker for "no Docker engine answered": the host's `docker-unavailable`
 * refusal, raised by the injected calls so the view can separate a stopped
 * engine from a genuine read failure.
 */
export class DockerUnreachable extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DockerUnreachable'
  }
}

/** Inventory load state; `unavailable` is the stopped-engine empty state. */
type InventoryState =
  | { kind: 'loading' }
  | { kind: 'ready'; inventory: DockerInventory }
  | { kind: 'unavailable'; engine: DockerEngineStatusView | undefined }
  | { kind: 'failed'; reason: string }

/** Log-read state for the currently expanded container. */
type LogsState =
  | { kind: 'loading' }
  | { kind: 'ready'; logs: DockerLogs }
  | { kind: 'failed'; reason: string }

/** Failure text for a rejected read: an Error's own message, else its string form. */
function failureText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Size in the largest unit that keeps the number readable (bytes below 1 MB, then MB, then GB). */
function sizeText(bytes: number, t: DockerViewProps['t']): string {
  const mb = bytes / (1024 * 1024)
  if (mb < 1) return t('size.bytes', { size: bytes })
  const gb = mb / 1024
  if (gb < 1) return t('size.mb', { size: mb.toFixed(1) })
  return t('size.gb', { size: gb.toFixed(1) })
}

/** Compose project/service pair as one label; absent when the container carries neither label. */
function composeText(container: DockerContainerEntry): string | undefined {
  if (container.project === undefined) return undefined
  return container.service === undefined ? container.project : `${container.project}/${container.service}`
}

/** Full props: the conversation-view standard kit, the injected wire calls, and the locale seat. */
export type DockerViewProps = ConvViewProps & InjectFace<DockerViewInjected> & PropsLocale<'docker'>

/** One container row plus its expanded log panel. */
function ContainerRow({
  container, expanded, logs, busy, confirming, onToggle, onControl, onShell, onRemove, onAskRemove, onCancelRemove, t,
}: {
  container: DockerContainerEntry
  expanded: boolean
  logs: LogsState | undefined
  /** A lifecycle action on this container is in flight. */
  busy: boolean
  /** This row is asking the operator to confirm a delete. */
  confirming: boolean
  onToggle: () => void
  onControl: (action: 'start' | 'stop' | 'restart') => void
  onShell: () => void
  onRemove: () => void
  onAskRemove: () => void
  onCancelRemove: () => void
  t: DockerViewProps['t']
}) {
  const compose = composeText(container)
  const running = container.state === 'running'
  return (
    <li className={css.row}>
      <div className={css.rowLine}>
        <button
          type="button"
          className={css.rowHeader}
          aria-expanded={expanded}
          onClick={onToggle}
        >
          <span className={clsx(css.state, running && css.stateRunning)}>
            {container.state}
          </span>
          <span className={css.name}>{container.name}</span>
          <span className={css.image} title={container.image}>{container.image}</span>
          {compose !== undefined && <span className={css.compose}>{compose}</span>}
          {container.ports.length > 0 && (
            <span className={css.ports}>{t('containers.ports', { ports: container.ports.join(', ') })}</span>
          )}
          <span className={css.status}>{container.status}</span>
        </button>
        <div className={css.rowActions}>
          {/* Start and stop are the same seat: only one of them can apply to a
              container, and showing both would offer an action that fails. */}
          <button
            type="button"
            className={css.rowAction}
            disabled={busy}
            title={running ? t('action.stop') : t('action.start')}
            onClick={() => { onControl(running ? 'stop' : 'start') }}
          >
            {running ? t('action.stop') : t('action.start')}
          </button>
          <button
            type="button"
            className={css.rowAction}
            disabled={busy || !running}
            title={t('action.restart')}
            onClick={() => { onControl('restart') }}
          >
            {t('action.restart')}
          </button>
          <button
            type="button"
            className={css.rowAction}
            title={t('action.logs')}
            onClick={onToggle}
          >
            {t('action.logs')}
          </button>
          {/* A shell is an interactive session, which this read-only tab cannot
              host; the agent owns terminals, so the button hands the container
              to it and the work stays in the conversation. */}
          <button
            type="button"
            className={css.rowAction}
            disabled={!running}
            title={t('action.shell.title')}
            onClick={onShell}
          >
            {t('action.shell')}
          </button>
          {/* Deleting a container is irreversible, so the button asks first and
              the confirmation replaces it in place: no dialog to mis-click
              through, and the row keeps saying which container it is about. */}
          <button
            type="button"
            className={clsx(css.rowAction, css.rowActionDanger)}
            disabled={busy}
            title={t('action.remove.container.title')}
            onClick={onAskRemove}
          >
            {t('action.remove')}
          </button>
        </div>
      </div>
      {confirming && (
        <div className={css.confirm} role="alertdialog" aria-label={t('action.remove.container.title')}>
          <span className={css.confirmText}>
            {t('action.remove.container.ask', { name: container.name })}
          </span>
          <button
            type="button"
            className={clsx(css.rowAction, css.rowActionDanger)}
            disabled={busy}
            onClick={onRemove}
          >
            {t('action.remove.confirm')}
          </button>
          <button
            type="button"
            className={css.rowAction}
            disabled={busy}
            onClick={onCancelRemove}
          >
            {t('action.remove.cancel')}
          </button>
        </div>
      )}
      {expanded && (
        <div className={css.logs}>
          {logs === undefined || logs.kind === 'loading'
            ? <p className={css.note}>{t('logs.loading')}</p>
            : logs.kind === 'failed'
              ? <p className={css.note}>{t('logs.failed', { reason: logs.reason })}</p>
              : logs.logs.content === ''
                ? <p className={css.note}>{t('logs.empty')}</p>
                : (
                  <>
                    {logs.logs.truncated && <p className={css.note}>{t('logs.truncated')}</p>}
                    <pre className={css.logText}>{logs.logs.content}</pre>
                  </>
                )}
        </div>
      )}
    </li>
  )
}

/**
 * Render the Docker tab.
 * @param props - the conversation-view kit, the injected wire calls, and `t`.
 * @returns the containers section, the images section, and their honest states.
 */
export function DockerView({
  loadInventory, loadLogs, engineStatus, startEngine, installEngine,
  controlContainer, removeContainer, removeImage, openShell, browseCompose, composeUp, composeDown, t,
}: DockerViewProps) {
  const [state, setState] = useState<InventoryState>({ kind: 'loading' })
  // Bumped by Refresh: the load effect re-runs, and its cleanup aborts the
  // superseded requests on the wire rather than only discarding their results.
  const [generation, setGeneration] = useState(0)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [logs, setLogs] = useState<LogsState | undefined>(undefined)
  // The container a lifecycle action is running on, so only its own row locks.
  const [acting, setActing] = useState<string | undefined>(undefined)
  const [actionError, setActionError] = useState<string | undefined>(undefined)
  // Id of the container or image whose delete is awaiting confirmation; one at
  // a time, so a second Delete moves the question instead of stacking it.
  const [confirmRemove, setConfirmRemove] = useState<string | undefined>(undefined)

  useEffect(() => {
    const controller = new AbortController()
    setState({ kind: 'loading' })
    loadInventory(controller.signal).then(
      (inventory) => {
        if (controller.signal.aborted) return
        setState({ kind: 'ready', inventory })
      },
      (error: unknown) => {
        if (controller.signal.aborted) return
        if (!(error instanceof DockerUnreachable)) {
          setState({ kind: 'failed', reason: failureText(error) })
          return
        }
        // An unreachable engine is where the remedies matter, so the panel's
        // offers are read only once the inventory has actually failed.
        setState({ kind: 'unavailable', engine: undefined })
        engineStatus(controller.signal).then(
          (engine) => {
            if (controller.signal.aborted) return
            setState({ kind: 'unavailable', engine })
          },
          () => {
            // A status probe that fails leaves the plain empty state, which
            // already tells the operator the engine is unreachable.
          },
        )
      },
    )
    return () => { controller.abort() }
  }, [loadInventory, engineStatus, generation])

  useEffect(() => {
    if (expanded === null) return
    const controller = new AbortController()
    setLogs({ kind: 'loading' })
    loadLogs(expanded, controller.signal).then(
      (result) => {
        if (controller.signal.aborted) return
        setLogs({ kind: 'ready', logs: result })
      },
      (error: unknown) => {
        if (controller.signal.aborted) return
        setLogs({ kind: 'failed', reason: failureText(error) })
      },
    )
    return () => { controller.abort() }
  }, [loadLogs, expanded, generation])

  const toggle = useCallback((id: string) => {
    setExpanded(current => current === id ? null : id)
  }, [])

  const refresh = useCallback(() => { setGeneration(value => value + 1) }, [])
  const closePicker = useCallback(() => { setPickerOpen(false) }, [])

  return (
    <div className={css.root}>
      <div className={css.toolbar}>
        <button
          type="button"
          className={css.refresh}
          onClick={() => { setPickerOpen(true) }}
        >
          {t('compose.open')}
        </button>
        <button
          type="button"
          className={css.refresh}
          disabled={state.kind === 'loading'}
          // A new refresh supersedes the expanded container's log read too,
          // so the panel never shows text from before the reload.
          onClick={refresh}
        >
          {t('refresh')}
        </button>
      </div>
      {pickerOpen && (
        <ComposePicker
          browseCompose={browseCompose}
          composeUp={composeUp}
          composeDown={composeDown}
          onClose={closePicker}
          t={t}
        />
      )}
      {state.kind === 'loading' && <p className={css.note} role="status">{t('loading')}</p>}
      {state.kind === 'unavailable' && (
        <EnginePanel
          status={state.engine}
          startEngine={async () => {
            await startEngine()
            // A settled attempt re-reads the inventory: a started engine turns
            // the panel into the container list without another gesture.
            setGeneration(value => value + 1)
          }}
          installEngine={async () => {
            await installEngine()
            setGeneration(value => value + 1)
          }}
          t={t}
        />
      )}
      {state.kind === 'failed' && <p className={css.note} role="status">{t('failed', { reason: state.reason })}</p>}
      {state.kind === 'ready' && (
        <>
          {/* One seat for the last failed action, shared by both sections: the
              state is shared, so two copies would report it twice. */}
          {actionError !== undefined && (
            <p className={css.note} role="status">{t('action.failed', { reason: actionError })}</p>
          )}
          <section className={css.section}>
            <h2 className={css.heading}>{t('containers')}</h2>
            {state.inventory.containers.length === 0
              ? <p className={css.note}>{t('containers.empty')}</p>
              : (
                <ul className={css.list}>
                  {state.inventory.containers.map(container => (
                    <ContainerRow
                      key={container.id}
                      container={container}
                      expanded={expanded === container.id}
                      logs={expanded === container.id ? logs : undefined}
                      busy={acting === container.id}
                      confirming={confirmRemove === container.id}
                      onToggle={() => { toggle(container.id) }}
                      onControl={(action) => {
                        setActing(container.id)
                        setActionError(undefined)
                        controlContainer(container.id, action).then(
                          () => {
                            setActing(undefined)
                            // The settled state lives in the engine, so the
                            // row refreshes from a new listing.
                            setGeneration(value => value + 1)
                          },
                          (error: unknown) => {
                            setActing(undefined)
                            setActionError(failureText(error))
                          },
                        )
                      }}
                      onShell={() => {
                        setActionError(undefined)
                        openShell(container.id).catch((error: unknown) => {
                          setActionError(failureText(error))
                        })
                      }}
                      onAskRemove={() => {
                        setActionError(undefined)
                        setConfirmRemove(container.id)
                      }}
                      onCancelRemove={() => { setConfirmRemove(undefined) }}
                      onRemove={() => {
                        setActing(container.id)
                        setActionError(undefined)
                        removeContainer(container.id).then(
                          () => {
                            setActing(undefined)
                            setConfirmRemove(undefined)
                            // The row is gone in the engine, so the list comes
                            // from a new listing rather than from local state.
                            setGeneration(value => value + 1)
                          },
                          (error: unknown) => {
                            setActing(undefined)
                            setActionError(failureText(error))
                          },
                        )
                      }}
                      t={t}
                    />
                  ))}
                </ul>
              )}
          </section>
          <section className={css.section}>
            <h2 className={css.heading}>{t('images')}</h2>
            {state.inventory.images.length === 0
              ? <p className={css.note}>{t('images.empty')}</p>
              : (
                <ul className={css.list}>
                  {state.inventory.images.map(image => (
                    <li key={image.id} className={css.imageRow}>
                      <span className={css.name}>
                        {image.tags.length === 0 ? t('images.untagged') : image.tags.join(', ')}
                      </span>
                      <span className={css.size}>{sizeText(image.size, t)}</span>
                      {confirmRemove === image.id
                        ? (
                          <span className={css.confirmInline} role="alertdialog" aria-label={t('action.remove.image.title')}>
                            <span className={css.confirmText}>
                              {t('action.remove.image.ask', {
                                name: image.tags.length === 0 ? image.id : image.tags[0] ?? image.id,
                              })}
                            </span>
                            <button
                              type="button"
                              className={clsx(css.rowAction, css.rowActionDanger)}
                              disabled={acting === image.id}
                              onClick={() => {
                                setActing(image.id)
                                setActionError(undefined)
                                removeImage(image.id).then(
                                  () => {
                                    setActing(undefined)
                                    setConfirmRemove(undefined)
                                    setGeneration(value => value + 1)
                                  },
                                  (error: unknown) => {
                                    setActing(undefined)
                                    setActionError(failureText(error))
                                  },
                                )
                              }}
                            >
                              {t('action.remove.confirm')}
                            </button>
                            <button
                              type="button"
                              className={css.rowAction}
                              disabled={acting === image.id}
                              onClick={() => { setConfirmRemove(undefined) }}
                            >
                              {t('action.remove.cancel')}
                            </button>
                          </span>
                        )
                        : (
                          <button
                            type="button"
                            className={clsx(css.rowAction, css.rowActionDanger)}
                            title={t('action.remove.image.title')}
                            onClick={() => {
                              setActionError(undefined)
                              setConfirmRemove(image.id)
                            }}
                          >
                            {t('action.remove')}
                          </button>
                        )}
                    </li>
                  ))}
                </ul>
              )}
          </section>
        </>
      )}
    </div>
  )
}
