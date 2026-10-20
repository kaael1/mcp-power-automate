import { describe, expect, it } from 'vitest';

import { computeFlowBaseHash } from '../server/flow-base-hash.js';

const baseFlow = {
  displayName: 'Flow A',
  flow: {
    connectionReferences: { shared_office365: { connectionName: 'abc' } },
    definition: { actions: { Compose: { inputs: 'hello', type: 'Compose' } }, triggers: {} },
  },
};

describe('flow base hash', () => {
  it('computes a flow base hash that ignores key order but tracks content changes', () => {
    const reordered = {
      flow: {
        definition: { triggers: {}, actions: { Compose: { type: 'Compose', inputs: 'hello' } } },
        connectionReferences: { shared_office365: { connectionName: 'abc' } },
      },
      displayName: 'Flow A',
    };
    const changed = {
      ...baseFlow,
      flow: {
        ...baseFlow.flow,
        definition: { actions: { Compose: { inputs: 'changed', type: 'Compose' } }, triggers: {} },
      },
    };

    expect(computeFlowBaseHash(baseFlow)).toMatch(/^[0-9a-f]{64}$/);
    expect(computeFlowBaseHash(reordered)).toBe(computeFlowBaseHash(baseFlow));
    expect(computeFlowBaseHash(changed)).not.toBe(computeFlowBaseHash(baseFlow));
  });

  it('includes the display name in the base hash', () => {
    expect(computeFlowBaseHash({ ...baseFlow, displayName: 'Flow A (renamed)' })).not.toBe(computeFlowBaseHash(baseFlow));
  });

  it('hashes a missing display name the same as an empty one', () => {
    expect(computeFlowBaseHash({ flow: baseFlow.flow })).toBe(computeFlowBaseHash({ ...baseFlow, displayName: '' }));
  });
});
