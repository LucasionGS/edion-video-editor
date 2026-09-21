import { applyPatches, enablePatches, produceWithPatches, type Draft, type Patch } from 'immer'

enablePatches()

interface Entry {
  label: string
  patches: Patch[]
  inverse: Patch[]
}

/**
 * Patch-based undo/redo over an immutable state. Transactions fold many small edits
 * (every mouse move of a drag) into a single undo step.
 */
export class History<T extends object> {
  private undoStack: Entry[] = []
  private redoStack: Entry[] = []
  private transaction: Entry | null = null

  constructor(private readonly limit = 300) {}

  get canUndo(): boolean {
    return this.undoStack.length > 0
  }
  get canRedo(): boolean {
    return this.redoStack.length > 0
  }
  get undoLabel(): string | undefined {
    return this.undoStack[this.undoStack.length - 1]?.label
  }
  get redoLabel(): string | undefined {
    return this.redoStack[this.redoStack.length - 1]?.label
  }

  apply(state: T, label: string, recipe: (draft: Draft<T>) => void): T {
    const [next, patches, inverse] = produceWithPatches(state, recipe)
    if (patches.length === 0) return state
    if (this.transaction) {
      this.transaction.patches.push(...patches)
      this.transaction.inverse.unshift(...inverse)
    } else {
      this.push({ label, patches, inverse })
    }
    return next
  }

  begin(label: string): void {
    this.transaction ??= { label, patches: [], inverse: [] }
  }

  commit(): void {
    const entry = this.transaction
    this.transaction = null
    if (entry && entry.patches.length > 0) this.push(entry)
  }

  /** Abandons the open transaction and returns the state from before it began. */
  rollback(state: T): T {
    const entry = this.transaction
    this.transaction = null
    return entry && entry.inverse.length > 0 ? applyPatches(state, entry.inverse) : state
  }

  undo(state: T): T {
    this.commit()
    const entry = this.undoStack.pop()
    if (!entry) return state
    this.redoStack.push(entry)
    return applyPatches(state, entry.inverse)
  }

  redo(state: T): T {
    this.commit()
    const entry = this.redoStack.pop()
    if (!entry) return state
    this.undoStack.push(entry)
    return applyPatches(state, entry.patches)
  }

  clear(): void {
    this.undoStack = []
    this.redoStack = []
    this.transaction = null
  }

  private push(entry: Entry): void {
    this.undoStack.push(entry)
    if (this.undoStack.length > this.limit) this.undoStack.shift()
    this.redoStack = []
  }
}
