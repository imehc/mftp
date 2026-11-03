interface PartyRuntime {
  generation: number;
  sequence: number;
  tail: Promise<void>;
}

// 同一房间重开或重新装配时延续身份计数；这里不保存局面、凭据或模型配置。
const runtimes = new Map<string, PartyRuntime>();

function runtime(instanceId: string): PartyRuntime {
  let value = runtimes.get(instanceId);
  if (!value) {
    value = { generation: 0, sequence: 0, tail: Promise.resolve() };
    runtimes.set(instanceId, value);
  }
  return value;
}

export function nextPartyGeneration(instanceId: string): number {
  const value = runtime(instanceId);
  if (value.generation >= 0xffffffff)
    throw new Error("Game generation exhausted");
  return ++value.generation;
}

export function nextPartySequence(instanceId: string): number {
  const value = runtime(instanceId);
  if (value.sequence >= 0xffffffff) throw new Error("Game sequence exhausted");
  return ++value.sequence;
}

export function queuePartyOperation(
  instanceId: string,
  work: () => Promise<void>,
): Promise<void> {
  const value = runtime(instanceId);
  const result = value.tail.then(work);
  value.tail = result.catch(() => {});
  return result;
}

export function releasePartyRuntime(instanceId: string): void {
  runtimes.delete(instanceId);
}
