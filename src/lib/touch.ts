/**
 * 触控目标密度。
 *
 * 粗指针（手机、平板）与窄窗口都需要至少约 44×44 CSS px 的可点区域，
 * 但两者不是同一件事：宽屏平板同样是触摸输入，窄桌面窗口仍用鼠标。
 * 因此这里同时判断宽度和输入方式，而不是只看 `max-md`。
 *
 * `min-*` 会扩大控件的真实布局尺寸，容器必须为它留出空间。
 * 缩小界面时仍保留 44px 下限；放大时随 rem 增长。
 * 页面试点用 App.css 的 ui-density-adaptive 统一接入；Tabs 单独保留紧凑外观。
 */
export const TOUCH_TARGET_CLASS =
  "max-md:min-h-[max(44px,2.75rem)] max-md:min-w-[max(44px,2.75rem)] pointer-coarse:min-h-[max(44px,2.75rem)] pointer-coarse:min-w-[max(44px,2.75rem)]";

/**
 * 让容器内的按钮（含 asChild 渲染的链接）在粗指针/窄屏下达到触控尺寸。
 * 用于标题栏这类由调用方传入任意操作的共享区域，避免要求每个调用方
 * 自己记住密度类。
 */
export const TOUCH_TARGET_CHILDREN_CLASS =
  "[&_a]:max-md:min-h-[max(44px,2.75rem)] [&_a]:max-md:min-w-[max(44px,2.75rem)] [&_a]:pointer-coarse:min-h-[max(44px,2.75rem)] [&_a]:pointer-coarse:min-w-[max(44px,2.75rem)] [&_button]:max-md:min-h-[max(44px,2.75rem)] [&_button]:max-md:min-w-[max(44px,2.75rem)] [&_button]:pointer-coarse:min-h-[max(44px,2.75rem)] [&_button]:pointer-coarse:min-w-[max(44px,2.75rem)]";
