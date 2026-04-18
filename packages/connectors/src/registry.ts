import { BreezeError } from "@breeze/common";
import type { Connector, ConnectorCapability } from "./types.js";

const connectors = new Map<string, Connector>();
const capabilitiesByKey = new Map<string, { connector: Connector; capability: ConnectorCapability }>();

export function registerConnector(c: Connector): void {
  if (connectors.has(c.meta.key)) {
    throw new Error(`Connector already registered: ${c.meta.key}`);
  }
  connectors.set(c.meta.key, c);
  for (const cap of c.capabilities) {
    if (capabilitiesByKey.has(cap.key)) {
      throw new Error(`Duplicate capability key: ${cap.key}`);
    }
    capabilitiesByKey.set(cap.key, { connector: c, capability: cap });
  }
}

export function getConnector(key: string): Connector | undefined {
  return connectors.get(key);
}

export function listConnectors(): Connector[] {
  return [...connectors.values()];
}

export function requireCapability(
  connectorKey: string,
  capabilityKey: string
): ConnectorCapability {
  const entry = capabilitiesByKey.get(capabilityKey);
  if (!entry) {
    throw new BreezeError("validation", `Unknown capability: ${capabilityKey}`);
  }
  if (entry.connector.meta.key !== connectorKey) {
    throw new BreezeError(
      "validation",
      `Capability ${capabilityKey} does not belong to connector ${connectorKey}`
    );
  }
  return entry.capability;
}

export interface PublicCapability {
  connector: string;
  key: string;
  displayName: string;
  description: string;
  sensitivity: string;
  mutatesState: boolean;
  approvalHint: string;
}

/**
 * The planner receives only this subset — never raw SDKs. Limited to
 * connectors the user has actually connected.
 */
export function publicCatalog(connectedKeys: Set<string>): PublicCapability[] {
  const out: PublicCapability[] = [];
  for (const c of connectors.values()) {
    if (!connectedKeys.has(c.meta.key)) continue;
    for (const cap of c.capabilities) {
      out.push({
        connector: c.meta.key,
        key: cap.key,
        displayName: cap.displayName,
        description: cap.description,
        sensitivity: cap.sensitivity,
        mutatesState: cap.mutatesState,
        approvalHint: cap.approvalHint,
      });
    }
  }
  return out;
}
