import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  emptyCopyStoreSnapshot,
  MemoryCopyStore,
  type CopyStoreSnapshot,
} from "./store";

export class JsonFileCopyStore extends MemoryCopyStore {
  private persistTail = Promise.resolve();

  private constructor(
    private readonly filePath: string,
    initialState: CopyStoreSnapshot,
  ) {
    super(initialState);
  }

  static async open(filePath: string) {
    let state = emptyCopyStoreSnapshot();

    try {
      const raw = await readFile(filePath, "utf8");
      const parsed = JSON.parse(raw) as CopyStoreSnapshot;
      if (parsed.version !== 1) {
        throw new Error(`Unsupported copy store version: ${parsed.version}`);
      }
      state = parsed;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") throw error;
    }

    return new JsonFileCopyStore(filePath, state);
  }

  protected override async afterMutation() {
    const snapshot = this.snapshot();
    const directory = path.dirname(this.filePath);
    const temporaryPath = `${this.filePath}.${process.pid}.tmp`;

    this.persistTail = this.persistTail.then(async () => {
      await mkdir(directory, { recursive: true });
      await writeFile(
        temporaryPath,
        `${JSON.stringify(snapshot, null, 2)}\n`,
        "utf8",
      );
      await rename(temporaryPath, this.filePath);
    });

    await this.persistTail;
  }

  async close() {
    await this.persistTail;
  }
}
