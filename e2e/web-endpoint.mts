/** Keep the browser, isolated server and teardown on the same local origin. */
export function webTestEndpoint(value = process.env.WEB_E2E_BASE) {
  const url = new URL(value || 'http://127.0.0.1:5174');
  if (
    url.protocol !== 'http:' ||
    url.hostname !== '127.0.0.1' ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    Number(url.port || 80) < 1 ||
    Number(url.port || 80) === 3001
  )
    throw new Error(
      'WEB_E2E_BASE must be a local http://127.0.0.1:<port> origin, separate from API port 3001',
    );
  return { origin: url.origin, port: Number(url.port || 80) };
}
