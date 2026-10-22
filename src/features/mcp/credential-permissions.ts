import type { McpCredential, ModuleGrant } from "~/bindings";

export const ALL_MODULES = "*";

export function globalGrant(
  credential: McpCredential | null,
): ModuleGrant | undefined {
  return credential?.grants[ALL_MODULES];
}

export function clientPermission(credential: McpCredential) {
  const global = globalGrant(credential);
  const grants = global ? [global] : Object.values(credential.grants);
  const uniform =
    grants.length > 0 &&
    grants.every(
      (grant) =>
        grant.read === grants[0].read &&
        grant.write === grants[0].write &&
        grant.delete === grants[0].delete,
    );
  return { global: !!global, uniform, grant: uniform ? grants[0] : undefined };
}

export function changePermission(
  current: ModuleGrant,
  permission: keyof ModuleGrant,
  enabled: boolean,
): ModuleGrant {
  const next = { ...current, [permission]: enabled };
  next.write = next.read && next.write;
  next.delete = next.write && next.delete;
  return next;
}
