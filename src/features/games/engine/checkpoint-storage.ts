export interface CheckpointStorage {
  read(gameId: string): Promise<unknown>;
  write(gameId: string, value: unknown): Promise<void>;
  remove(gameId: string): Promise<void>;
}

const DATABASE = "mftp-game-checkpoints";
const TABLE = "sessions";
let pending: Promise<unknown> = Promise.resolve();

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let blocked = false;
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(TABLE))
        request.result.createObjectStore(TABLE);
    };
    request.onsuccess = () => {
      if (blocked) request.result.close();
      else resolve(request.result);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => {
      blocked = true;
      reject(new Error("Game checkpoint database blocked"));
    };
  });
}

function transaction<T>(
  mode: IDBTransactionMode,
  operation: (table: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const result = pending
    .catch(() => {})
    .then(async () => {
      const database = await openDatabase();
      try {
        return await new Promise<T>((resolve, reject) => {
          const current = database.transaction(TABLE, mode, {
            durability: "strict",
          });
          const request = operation(current.objectStore(TABLE));
          current.oncomplete = () => resolve(request.result);
          current.onabort = () =>
            reject(
              current.error ?? new Error("Game checkpoint transaction aborted"),
            );
          current.onerror = () =>
            reject(
              current.error ?? new Error("Game checkpoint transaction failed"),
            );
        });
      } finally {
        database.close();
      }
    });
  pending = result;
  return result;
}

export const checkpointStorage: CheckpointStorage = {
  read: (gameId) => transaction("readonly", (table) => table.get(gameId)),
  write: async (gameId, value) => {
    await transaction("readwrite", (table) => table.put(value, gameId));
  },
  remove: async (gameId) => {
    await transaction("readwrite", (table) => table.delete(gameId));
  },
};

export async function clearGameCheckpoints(): Promise<void> {
  await transaction("readwrite", (table) => table.clear());
}
