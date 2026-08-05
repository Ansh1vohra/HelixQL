import type { EndpointConfig } from "../shared/types";

/**
 * Where the two cloud tiers live. Neither is a secret — they're just
 * addresses — so they can come from the environment and be overridden from
 * the login screen when an enterprise runs its own deployment.
 *
 * Deliberately not persisted to disk: nothing in this app touches the
 * filesystem, which keeps the "no local artifacts" property simple to
 * verify rather than something that depends on which files we chose to
 * write.
 */
const endpoints: EndpointConfig = {
  controlPlaneUrl: process.env.HELIXQL_CONTROL_PLANE_URL || "http://localhost:3000",
  gatewayUrl: process.env.HELIXQL_GATEWAY_URL || "http://localhost:8000",
};

export function getEndpoints(): EndpointConfig {
  return { ...endpoints };
}

export function setEndpoints(next: Partial<EndpointConfig>): EndpointConfig {
  if (next.controlPlaneUrl?.trim()) {
    endpoints.controlPlaneUrl = next.controlPlaneUrl.trim().replace(/\/+$/, "");
  }
  if (next.gatewayUrl?.trim()) {
    endpoints.gatewayUrl = next.gatewayUrl.trim().replace(/\/+$/, "");
  }
  return getEndpoints();
}

/** Ceiling on the client-side self-healing loop (FR-4.5). The gateway
 * enforces the same limit independently. */
export const MAX_REPAIR_ATTEMPTS = 3;

/** Guards against a runaway query holding a connection open forever. */
export const QUERY_TIMEOUT_MS = 30_000;

