export class SceneHistory {
  private snapshots: string[] = [];
  private pointer = -1;

  constructor(private readonly maxSnapshots = 200) {}

  public push(snapshot: string) {
    if (!snapshot) {
      return;
    }
    if (this.pointer >= 0 && this.snapshots[this.pointer] === snapshot) {
      return;
    }

    if (this.pointer < this.snapshots.length - 1) {
      this.snapshots = this.snapshots.slice(0, this.pointer + 1);
    }
    this.snapshots.push(snapshot);
    if (this.snapshots.length > this.maxSnapshots) {
      this.snapshots.shift();
    }
    this.pointer = this.snapshots.length - 1;
  }

  public replaceCurrent(snapshot: string) {
    if (this.pointer < 0 || this.pointer >= this.snapshots.length) {
      this.push(snapshot);
      return;
    }
    this.snapshots[this.pointer] = snapshot;
  }

  public canUndo(): boolean {
    return this.pointer > 0;
  }

  public canRedo(): boolean {
    return this.pointer >= 0 && this.pointer < this.snapshots.length - 1;
  }

  public undo(currentSnapshot: string): string | null {
    if (this.pointer >= 0 && this.snapshots[this.pointer] !== currentSnapshot) {
      this.push(currentSnapshot);
    }
    if (!this.canUndo()) {
      return null;
    }
    this.pointer -= 1;
    return this.snapshots[this.pointer];
  }

  public redo(): string | null {
    if (!this.canRedo()) {
      return null;
    }
    this.pointer += 1;
    return this.snapshots[this.pointer];
  }
}
