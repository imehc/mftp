import type { SpeechAction, SpeechRequest, SpeechSnapshot } from "~/bindings";
import type * as ipc from "~/lib/ipc";

type SpeechPort = Pick<
  typeof ipc,
  "speechStart" | "speechControl" | "speechStop"
>;

// 页面卸载后的停止与下一页面的开始保持顺序，避免迟到请求重新发声。
let queue: Promise<unknown> = Promise.resolve();

function serialize<T>(operation: () => Promise<T>): Promise<T> {
  const result = queue.then(operation);
  queue = result.catch(() => undefined);
  return result;
}

export class PoetrySpeechSession {
  private id: string | null = null;
  private disposed = false;

  constructor(
    private readonly port: SpeechPort,
    private readonly receive: (snapshot: SpeechSnapshot) => void,
  ) {}

  accepts(snapshot: SpeechSnapshot): boolean {
    return !this.disposed && snapshot.sessionId === this.id;
  }

  start(input: Omit<SpeechRequest, "sessionId">): Promise<void> {
    if (this.disposed) return Promise.resolve();
    const sessionId = crypto.randomUUID();
    this.id = sessionId;
    return serialize(async () => {
      if (this.disposed || this.id !== sessionId) return;
      const snapshot = await this.port.speechStart({ ...input, sessionId });
      if (this.accepts(snapshot)) this.receive(snapshot);
    });
  }

  control(action: SpeechAction): Promise<void> {
    const sessionId = this.id;
    return serialize(async () => {
      if (this.disposed || !sessionId || this.id !== sessionId) return;
      const snapshot = await (action === "stop"
        ? this.port.speechStop(sessionId)
        : this.port.speechControl(sessionId, action));
      if (this.accepts(snapshot)) this.receive(snapshot);
    });
  }

  dispose(): Promise<void> {
    this.disposed = true;
    const sessionId = this.id;
    return serialize(async () => {
      if (sessionId) await this.port.speechStop(sessionId);
    });
  }
}

export function newerSpeechSnapshot(
  current: SpeechSnapshot | null,
  incoming: SpeechSnapshot,
): SpeechSnapshot {
  return current && current.revision >= incoming.revision ? current : incoming;
}
