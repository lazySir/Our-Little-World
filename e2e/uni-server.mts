import { startTestServer } from './test-server.mts';

export default async function setupUniServer() {
  return startTestServer('uni');
}
