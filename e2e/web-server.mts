import { startTestServer } from './test-server.mts';

export default async function setupWebServer() {
  return startTestServer('web');
}
