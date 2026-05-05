/**
 * Healthcheck utilities extracted from HealthcheckPanel.js.
 * Service healthcheck parsing and endpoint extraction.
 */

import { serviceMeta } from './AdditionalServicesStep';
import { mediaServerMeta } from './mediaServerMeta';

/**
 * Map a service key (e.g. "sonarr") to its compose.healthcheck
 * definition, walking through both serviceMeta and mediaServerMeta.
 * Returns null if the service has no healthcheck.
 */
export function getHealthcheck(serviceKey) {
  const meta = serviceMeta[serviceKey] || mediaServerMeta[serviceKey];
  if (!meta?.compose?.healthcheck) return null;
  const hc = meta.compose.healthcheck;
  // healthcheck.test is typically ['CMD-SHELL', 'wget …'] — surface the
  // command string so users can reproduce it manually.
  let command = '';
  if (Array.isArray(hc.test)) {
    command = hc.test.length > 1 ? hc.test.slice(1).join(' ') : hc.test[0];
  } else if (typeof hc.test === 'string') {
    command = hc.test;
  }
  return {
    command,
    interval:    hc.interval     || '30s',
    timeout:     hc.timeout      || '10s',
    retries:     hc.retries      || 3,
    startPeriod: hc.start_period || '0s',
  };
}

/**
 * Pull `localhost:PORT/path` out of a healthcheck wget/curl command, so
 * we can render a clickable link the user can spot-check from the
 * browser. Returns null if the command doesn't include an http URL.
 */
export function extractHttpEndpoint(command) {
  if (!command) return null;
  const match = command.match(/https?:\/\/[^\s'"|<>]+/);
  return match ? match[0] : null;
}
