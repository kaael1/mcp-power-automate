import { randomUUID } from 'node:crypto';

import type { BridgeMode } from './bridge-types.js';
import { bridgeHost, bridgePort } from './schemas.js';
import { packageVersion } from './version.js';

const startedAt = new Date().toISOString();
const instanceId = randomUUID();

let bridgeMode: BridgeMode = 'owned';

export const setBridgeMode = (mode: BridgeMode) => {
  bridgeMode = mode;
};

export const getBridgeRuntimeInfo = () => ({
  host: bridgeHost,
  instanceId,
  mode: bridgeMode,
  pid: process.pid,
  port: bridgePort,
  startedAt,
  version: packageVersion,
});

export const getBridgeMode = () => bridgeMode;

export const getBridgeCommandBaseUrl = () => `http://${bridgeHost}:${bridgePort}/v1/commands`;
