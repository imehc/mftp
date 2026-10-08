import "/src/App.css";
import React from "react";
import { createRoot } from "react-dom/client";
import { I18nProvider } from "@lingui/react";
import { i18n } from "@lingui/core";
import { messages } from "/src/locales/en/messages.ts";
import SettingsChoicesDialog from "/src/features/settings/SettingsChoicesDialog";
import { Calendar } from "/src/components/ui/calendar";
import { useSettingsStore } from "/src/store/settings";
import {
  applyStoredDisplaySize,
  applyDisplaySize,
} from "/src/lib/display-size";
import {
  useVirtualizerFontSize,
  observeRootFontSize,
} from "/src/lib/root-font-size";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
i18n.load("en", messages);
i18n.activate("en");
applyStoredDisplaySize();
useSettingsStore.subscribe((state) => applyDisplaySize(state.displaySize));
document.documentElement.classList.add("dark");
function List() {
  const ref = React.useRef(null);
  // 与生产列表相同：直接验证 TanStack Virtual，不将其返回函数传给记忆化组件。
  // eslint-disable-next-line react-hooks/incompatible-library
  const v = useVirtualizer({
    count: 100,
    getScrollElement: () => ref.current,
    estimateSize: () => 40,
    overscan: 2,
  });
  useVirtualizerFontSize(v);
  return (
    <div id="list" ref={ref} style={{ height: 200, overflow: "auto" }}>
      <div style={{ height: v.getTotalSize(), position: "relative" }}>
        {v.getVirtualItems().map((row) => (
          <div
            key={row.key}
            ref={v.measureElement}
            data-index={row.index}
            style={{
              position: "absolute",
              top: 0,
              width: "100%",
              height: "2.5rem",
              transform: `translateY(${row.start}px)`,
            }}
          >
            Row {row.index}
          </div>
        ))}
      </div>
    </div>
  );
}
function App() {
  const [open, setOpen] = React.useState(true);
  return (
    <I18nProvider i18n={i18n}>
      <button id="open" onClick={() => setOpen(true)}>
        Open
      </button>
      <div id="calendar" style={{ maxWidth: "100%", overflow: "auto" }}>
        <Calendar mode="single" />
      </div>
      <List />
      <div id="terminal" style={{ width: "100%", height: "12rem" }} />
      <SettingsChoicesDialog
        choice={open ? "display" : null}
        onClose={() => setOpen(false)}
      />
    </I18nProvider>
  );
}
createRoot(document.getElementById("root")).render(<App />);
window.qa = { store: useSettingsStore, ready: true };
setTimeout(() => {
  const term = new Terminal();
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.open(document.getElementById("terminal"));
  observeRootFontSize((px) => {
    term.options.fontSize = (px * 13) / 16;
    fit.fit();
  });
  window.qa.term = term;
}, 300);
