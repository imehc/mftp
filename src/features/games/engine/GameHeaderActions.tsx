import {
  createContext,
  type ReactNode,
  use,
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

interface ActionTargets {
  header: HTMLDivElement | null;
  menu: HTMLDivElement | null;
  setHeader(node: HTMLDivElement | null): void;
  setMenu(node: HTMLDivElement | null): void;
  registerMenuAction(handler: (action: () => void) => void): () => void;
  invokeMenuAction(action: () => void): void;
}

const ActionContext = createContext<ActionTargets | null>(null);
const InvokeActionContext = createContext<(action: () => void) => void>(
  (action) => action(),
);

export function useGameHeaderAction() {
  return use(InvokeActionContext);
}

/** 槽位随游戏页面销毁；对局仍拥有动作和可用性，标题栏只接收表现节点。 */
export function GameHeaderActionsProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [header, setHeader] = useState<HTMLDivElement | null>(null);
  const [menu, setMenu] = useState<HTMLDivElement | null>(null);
  const menuAction = useRef<((action: () => void) => void) | null>(null);

  const registerMenuAction = (handler: (action: () => void) => void) => {
    menuAction.current = handler;
    return () => {
      if (menuAction.current === handler) menuAction.current = null;
    };
  };

  const invokeMenuAction = (action: () => void) => {
    if (menuAction.current) menuAction.current(action);
    else action();
  };

  return (
    <ActionContext
      value={{
        header,
        menu,
        setHeader,
        setMenu,
        registerMenuAction,
        invokeMenuAction,
      }}
    >
      {children}
    </ActionContext>
  );
}

export function GameHeaderActionsSlot() {
  const headerRef = use(ActionContext)?.setHeader;
  return headerRef ? (
    <div
      ref={headerRef}
      className="game-header-actions-slot flex items-center gap-1 empty:hidden"
    />
  ) : null;
}

export function GameMenuActionsSlot({
  closeThen,
}: {
  closeThen(action: () => void): void;
}) {
  const { setMenu: menuRef, registerMenuAction } = use(ActionContext) ?? {};
  useEffect(
    () => registerMenuAction?.(closeThen),
    [registerMenuAction, closeThen],
  );
  return menuRef ? (
    <div ref={menuRef} className="game-menu-actions-slot empty:hidden" />
  ) : null;
}

export function GameHeaderActions({
  children,
  menu = false,
}: {
  children: ReactNode;
  menu?: boolean;
}) {
  const targets = use(ActionContext);
  const target = menu ? targets?.menu : targets?.header;
  return target
    ? createPortal(
        <InvokeActionContext
          value={(action) => {
            if (menu && targets) targets.invokeMenuAction(action);
            else action();
          }}
        >
          {children}
        </InvokeActionContext>,
        target,
      )
    : null;
}
