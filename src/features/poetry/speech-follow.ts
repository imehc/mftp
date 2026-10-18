import { gsap } from "gsap";

import type { SpeechSnapshot } from "~/bindings";
import { prefersReducedMotion } from "~/lib/motion";

import { locateSpeechText, type PoetrySpeechDocument } from "./speech-document";
import { followScrollDelta, SpeechLines } from "./speech-lines";

const HIGHLIGHT_NAME = "poetry-speaking";
export const SPEECH_FOLLOW_IDLE_MS = 3000;

/** 高亮和自动跟随只管理当前详情容器，销毁时一并撤销监听、绘制与动画。 */
export class PoetrySpeechFollow {
  private readonly abort = new AbortController();
  private readonly resize: ResizeObserver;
  private readonly pointers = new Set<number>();
  private readonly fallback: HTMLDivElement;
  private snapshot: SpeechSnapshot | null = null;
  private suspended = false;
  private disposed = false;
  private idleUntil = 0;
  private idleTimer: number | undefined;
  private tween: gsap.core.Tween | null = null;
  private autoScrollTop: number | null = null;
  private currentElement: HTMLElement | null = null;
  private lines: SpeechLines | null = null;
  private range: Range | null = null;
  private highlight: Highlight | null = null;

  constructor(
    private readonly root: HTMLElement,
    private readonly viewport: HTMLElement,
    private readonly text: PoetrySpeechDocument,
  ) {
    this.fallback = document.createElement("div");
    this.fallback.setAttribute("aria-hidden", "true");
    this.fallback.className = "poetry-speech-overlay";
    viewport.append(this.fallback);
    const options = { signal: this.abort.signal, capture: true };
    document.addEventListener("pointerdown", this.pointerDown, options);
    document.addEventListener("pointerup", this.pointerUp, options);
    document.addEventListener("pointercancel", this.pointerUp, options);
    document.addEventListener("pointermove", this.pointerMove, options);
    document.addEventListener("wheel", this.interact, {
      ...options,
      passive: true,
    });
    document.addEventListener("keydown", this.interact, options);
    document.addEventListener("selectionchange", this.interact, options);
    document.addEventListener("visibilitychange", this.blur, options);
    window.addEventListener("blur", this.blur, options);
    window.addEventListener("focus", this.interact, options);
    viewport.addEventListener("scroll", this.scrolled, {
      ...options,
      passive: true,
    });
    this.resize = new ResizeObserver(this.invalidate);
    this.resize.observe(root);
    this.resize.observe(viewport);
    document.fonts?.addEventListener("loadingdone", this.invalidate);
  }

  update(snapshot: SpeechSnapshot | null, suspended: boolean): void {
    this.snapshot = snapshot;
    this.suspended = suspended;
    if (snapshot?.phase !== "speaking" && snapshot?.phase !== "paused") {
      this.clear();
      return;
    }
    if (snapshot.phase === "paused" || suspended) this.cancelScroll();
    const target = locateSpeechText(this.text, snapshot);
    if (!target) {
      this.clear();
      return;
    }
    const element = this.root.querySelector<HTMLElement>(
      `[data-poetry-speech="${target.key}"]`,
    );
    if (!element) {
      this.clear();
      return;
    }
    if (this.currentElement !== element || !this.lines) {
      this.currentElement = element;
      this.lines = new SpeechLines(element);
    }
    const range = this.lines.lineAt(target.offset);
    if (!range) {
      this.clear();
      return;
    }
    if (this.range !== range) {
      this.cancelScroll();
      this.paint(range);
    }
    this.follow();
  }

  private paint(range: Range): void {
    this.range = range;
    if (typeof Highlight !== "undefined" && CSS.highlights) {
      // 复用同一高亮对象并清空旧范围，避免 WKWebView 替换注册项时残留旧行绘制。
      if (!this.highlight) {
        this.highlight = new Highlight();
        CSS.highlights.set(HIGHLIGHT_NAME, this.highlight);
      }
      this.highlight.clear();
      this.highlight.add(range);
      return;
    }
    // 旧 WebView 用绝对定位背景兼容，既不切分文本，也不改变段落折行。
    const viewport = this.viewport.getBoundingClientRect();
    this.fallback.replaceChildren();
    for (const rect of range.getClientRects()) {
      const mark = document.createElement("div");
      mark.className = "poetry-speech-line";
      Object.assign(mark.style, {
        left: `${rect.left - viewport.left + this.viewport.scrollLeft}px`,
        top: `${rect.top - viewport.top + this.viewport.scrollTop}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
      });
      this.fallback.append(mark);
    }
  }

  private clearHighlight(): void {
    this.highlight?.clear();
    if (
      typeof CSS !== "undefined" &&
      CSS.highlights?.get(HIGHLIGHT_NAME) === this.highlight
    ) {
      CSS.highlights.delete(HIGHLIGHT_NAME);
    }
    this.highlight = null;
    this.range = null;
    this.fallback.replaceChildren();
  }

  private cancelScroll(): void {
    this.tween?.kill();
    this.tween = null;
    window.clearTimeout(this.idleTimer);
    this.idleTimer = undefined;
  }

  private clear(): void {
    this.clearHighlight();
    this.cancelScroll();
    this.lines = null;
    this.currentElement = null;
  }

  private interact = (): void => {
    this.idleUntil = performance.now() + SPEECH_FOLLOW_IDLE_MS;
    this.cancelScroll();
    this.autoScrollTop = null;
    this.follow();
  };

  private pointerDown = (event: PointerEvent): void => {
    this.pointers.add(event.pointerId);
    this.interact();
  };

  private pointerUp = (event: PointerEvent): void => {
    this.pointers.delete(event.pointerId);
    this.interact();
  };

  private pointerMove = (): void => {
    if (this.pointers.size) this.interact();
  };

  private scrolled = (): void => {
    // 自动动画触发的 scroll 不算用户操作；手动拖动偏离动画位置则立即退出跟随。
    if (
      this.autoScrollTop !== null &&
      Math.abs(this.viewport.scrollTop - this.autoScrollTop) < 1
    )
      return;
    this.interact();
  };

  private blur = (): void => {
    this.pointers.clear();
    this.interact();
  };

  private invalidate = (): void => {
    this.lines = null;
    this.range = null;
    this.cancelScroll();
    this.update(this.snapshot, this.suspended);
  };

  private follow(): void {
    window.clearTimeout(this.idleTimer);
    this.idleTimer = undefined;
    if (
      this.disposed ||
      this.suspended ||
      this.snapshot?.phase !== "speaking" ||
      !this.range ||
      document.hidden ||
      !document.hasFocus() ||
      this.pointers.size ||
      document.getSelection()?.isCollapsed === false ||
      document.querySelector('[role="dialog"], [role="alertdialog"]')
    )
      return;
    const remaining = this.idleUntil - performance.now();
    if (remaining > 0) {
      this.idleTimer = window.setTimeout(() => this.follow(), remaining);
      return;
    }
    if (this.tween) return;
    const rect = this.range.getBoundingClientRect();
    const viewport = this.viewport.getBoundingClientRect();
    if (!rect.height || !viewport.height) return;
    const padding = Math.min(24, viewport.height / 10);
    const delta = followScrollDelta(rect, viewport, padding);
    const top = Math.max(
      0,
      Math.min(
        this.viewport.scrollHeight - this.viewport.clientHeight,
        this.viewport.scrollTop + delta,
      ),
    );
    if (Math.abs(top - this.viewport.scrollTop) < 1) return;
    this.autoScrollTop = this.viewport.scrollTop;
    if (prefersReducedMotion()) {
      this.autoScrollTop = top;
      this.viewport.scrollTop = top;
      return;
    }
    this.tween = gsap.to(this.viewport, {
      scrollTop: top,
      duration: 0.2,
      ease: "power2.out",
      onUpdate: () => {
        this.autoScrollTop = this.viewport.scrollTop;
      },
      onComplete: () => {
        this.tween = null;
      },
    });
  }

  dispose(): void {
    this.disposed = true;
    this.abort.abort();
    this.resize.disconnect();
    document.fonts?.removeEventListener("loadingdone", this.invalidate);
    this.clear();
    this.fallback.remove();
  }
}
