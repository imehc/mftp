import type { EventCallback, UnlistenFn } from "@tauri-apps/api/event";

export interface Registration {
  topic: string;
  callback: EventCallback<unknown>;
  active: boolean;
  cleaned: number;
  cleanupThrows: boolean;
  cleanupRejects: boolean;
  resolve(): void;
  reject(error: unknown): void;
}

export const registrations: Registration[] = [];
let automatic = true;

export function resetEvents(auto = true) {
  registrations.length = 0;
  automatic = auto;
}

export function listen<T>(
  topic: string,
  callback: EventCallback<T>,
): Promise<UnlistenFn> {
  return new Promise((resolve, reject) => {
    const registration: Registration = {
      topic,
      callback: callback as EventCallback<unknown>,
      active: true,
      cleaned: 0,
      cleanupThrows: false,
      cleanupRejects: false,
      resolve: () =>
        resolve(() => {
          registration.cleaned++;
          if (registration.cleanupThrows) throw new Error("cleanup failure");
          registration.active = false;
          if (registration.cleanupRejects)
            return Promise.reject(new Error("async cleanup failure"));
        }),
      reject: (error) => {
        registration.active = false;
        reject(error);
      },
    };
    registrations.push(registration);
    if (automatic) registration.resolve();
  });
}

export function emit(topic: string, payload: unknown) {
  for (const registration of registrations) {
    if (registration.active && registration.topic === topic) {
      registration.callback({ event: topic, id: 0, payload });
    }
  }
}
