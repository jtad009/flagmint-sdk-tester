/**
 * Pre-baked Flagmint targets for the SDK tester.
 * Handshake / REST / QA → apiUrl
 * SSE EventSource → streamUrl (may be a grey-cloud stream host)
 */

export const ENVIRONMENTS = [
  {
    id: 'local',
    label: 'Local',
    apiUrl: 'http://localhost:3000',
    streamUrl: 'http://localhost:3000',
  },
  {
    id: 'staging',
    label: 'Staging',
    apiUrl: 'https://staging-api.flagmint.com',
    streamUrl: 'https://staging-stream.flagmint.com',
  },
  {
    id: 'production',
    label: 'Production',
    apiUrl: 'https://api.flagmint.com',
    streamUrl: 'https://stream.flagmint.com',
  },
  {
    id: 'custom',
    label: 'Custom',
    apiUrl: '',
    streamUrl: '',
  },
];

export function getEnvironment(id) {
  return ENVIRONMENTS.find((e) => e.id === id) || ENVIRONMENTS[0];
}

/** Infer preset from a stored API URL (migration from single-url tester). */
export function inferEnvironmentId(apiUrl) {
  const normalized = String(apiUrl || '').replace(/\/+$/, '');
  const match = ENVIRONMENTS.find(
    (e) => e.id !== 'custom' && e.apiUrl === normalized,
  );
  return match?.id || 'custom';
}
