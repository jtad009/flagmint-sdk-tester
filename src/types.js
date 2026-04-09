/**
 * @typedef {Object} Profile
 * @property {string} id - UUID v4
 * @property {string} name - User-friendly profile name
 * @property {string} apiUrl - API endpoint URL
 * @property {string} apiKey - SDK API key
 * @property {'websocket'|'longpolling'} transport - Connection type
 * @property {Object} [context] - Evaluation context (user/org data); defaults to `{}` when omitted
 * @property {string} color - Hex color for UI differentiation
 * @property {number} createdAt - Timestamp
 * @property {number} lastUsed - Timestamp
 */
