import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function chromePath() {
  const candidates = [
    process.env.QA_CHROME,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ];
  const found = candidates.find(
    (candidate) => candidate && fs.existsSync(candidate),
  );
  if (!found)
    throw new Error(
      "Install Chrome/Chromium or set QA_CHROME to its executable",
    );
  return found;
}

export async function launchBrowser() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "mftp-qa-chrome-"));
  const child = spawn(
    chromePath(),
    [
      "--headless=new",
      "--no-first-run",
      "--no-default-browser-check",
      "--remote-debugging-port=0",
      `--user-data-dir=${profile}`,
      "about:blank",
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  const cleanup = () => child.kill("SIGTERM");
  const interrupted = () => {
    cleanup();
    process.exit(1);
  };
  process.once("exit", cleanup);
  process.once("SIGTERM", interrupted);
  let socket;
  try {
    const address = await new Promise((resolve, reject) => {
      let stderr = "";
      const timeout = setTimeout(
        () => reject(new Error("Chrome startup timed out")),
        60000,
      );
      child.once("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.once("exit", () => {
        clearTimeout(timeout);
        reject(new Error("Isolated Chrome exited before connecting"));
      });
      child.stderr.on("data", (chunk) => {
        stderr = (stderr + chunk).slice(-16384);
        const url = stderr.match(/DevTools listening on (ws:\/\/\S+)/)?.[1];
        if (url) {
          clearTimeout(timeout);
          resolve(url);
        }
      });
    });
    socket = new WebSocket(address);
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Chrome connection timed out")),
        10000,
      );
      socket.addEventListener(
        "open",
        () => {
          clearTimeout(timeout);
          resolve();
        },
        { once: true },
      );
      socket.addEventListener(
        "error",
        () => {
          clearTimeout(timeout);
          reject(new Error("Chrome connection failed"));
        },
        { once: true },
      );
    });
    let id = 0;
    const pending = new Map();
    const listeners = new Set();
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id) {
        const request = pending.get(message.id);
        if (!request) return;
        pending.delete(message.id);
        clearTimeout(request.timer);
        if (message.error) request.reject(new Error(message.error.message));
        else request.resolve(message.result);
      } else for (const listener of listeners) listener(message);
    });
    socket.addEventListener("close", () => {
      for (const request of pending.values()) {
        clearTimeout(request.timer);
        request.reject(new Error("Chrome connection closed"));
      }
      pending.clear();
    });
    const send = (method, params = {}, sessionId) =>
      new Promise((resolve, reject) => {
        const requestId = ++id;
        const timer = setTimeout(() => {
          pending.delete(requestId);
          reject(new Error(`CDP timeout: ${method}`));
        }, 90000);
        pending.set(requestId, { resolve, reject, timer });
        socket.send(
          JSON.stringify({
            id: requestId,
            method,
            params,
            ...(sessionId ? { sessionId } : {}),
          }),
        );
      });
    const { targetId } = await send("Target.createTarget", {
      url: "about:blank",
    });
    const { sessionId } = await send("Target.attachToTarget", {
      targetId,
      flatten: true,
    });
    await send("Page.enable", {}, sessionId);
    return {
      send: (method, params) => send(method, params, sessionId),
      version: await send("Browser.getVersion"),
      loaded: (signal) =>
        new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            listeners.delete(listener);
            signal?.removeEventListener("abort", cancel);
            reject(new Error("Page load timed out"));
          }, 30000);
          const listener = (message) => {
            if (
              message.sessionId === sessionId &&
              message.method === "Page.loadEventFired"
            ) {
              clearTimeout(timeout);
              listeners.delete(listener);
              signal?.removeEventListener("abort", cancel);
              resolve();
            }
          };
          const cancel = () => {
            clearTimeout(timeout);
            listeners.delete(listener);
            resolve();
          };
          signal?.addEventListener("abort", cancel, { once: true });
          listeners.add(listener);
        }),
      close: async () => {
        try {
          await send("Browser.close");
        } catch {
          /* 浏览器关闭会先断开 CDP。 */
        }
        socket.close();
        process.removeListener("exit", cleanup);
        process.removeListener("SIGTERM", interrupted);
        if (child.exitCode === null && child.signalCode === null) {
          await new Promise((resolve) => {
            const timeout = setTimeout(() => {
              child.kill("SIGTERM");
              resolve();
            }, 5000);
            child.once("exit", () => {
              clearTimeout(timeout);
              resolve();
            });
          });
        }
      },
    };
  } catch (error) {
    socket?.close();
    child.kill("SIGTERM");
    throw error;
  }
}

export async function navigate(browser, url) {
  const controller = new AbortController();
  try {
    await Promise.all([
      browser.loaded(controller.signal),
      browser.send("Page.navigate", { url }).then((result) => {
        if (result.errorText) throw new Error(result.errorText);
      }),
    ]);
  } finally {
    controller.abort();
  }
}

export async function evaluate(browser, expression) {
  const result = await browser.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails)
    throw new Error(
      result.exceptionDetails.exception?.description ||
        result.exceptionDetails.text,
    );
  return result.result.value;
}
