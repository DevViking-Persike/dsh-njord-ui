/** Styles owned by the installed client plugin. */
const styles = new Map<string, string>()
/** Record CSS without touching the document during module evaluation. */
export function defineStyle(id: string, css: string): void { styles.set(id, css) }
/** Attach styles for one plugin lifetime and return their disposer. */
export function installStyles(): () => void {
  const elements = [...styles].map(([id, css]) => {
    const style = document.createElement('style')
    style.dataset.njord = id
    style.textContent = css
    document.head.append(style)
    return style
  })
  return () => { for (const element of elements) element.remove() }
}
