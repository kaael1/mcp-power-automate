import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { publicCommandNames } from '../server/command-registry.js';

const expectedV1Commands = [
  'get_context',
  'doctor',
  'connect_flow',
  'list_flows',
  'get_flow',
  'preview_flow_update',
  'validate_flow',
  'apply_flow_update',
  'get_last_update',
  'revert_last_update',
  'list_runs',
  'get_latest_run',
  'get_run',
  'get_run_actions',
  'wait_for_run',
  'get_trigger_callback_url',
  'invoke_trigger',
  'create_flow',
  'clone_flow',
];

const removedAliases = [
  'get_status',
  'get_health',
  'set_active_flow',
  'set_active_flow_from_tab',
  'select_flow',
  'select_tab_flow',
  'select_work_tab',
  'list_captured_tabs',
  'refresh_flows',
  'update_flow',
];

describe('command registry', () => {
  it('exposes the v1 command surface without compatibility aliases', () => {
    expect(publicCommandNames).toEqual(expectedV1Commands);

    for (const alias of removedAliases) {
      expect(publicCommandNames).not.toContain(alias);
    }
  });

  it('keeps README and skill command references aligned with the registry', async () => {
    const root = process.cwd();
    const docs = [
      await readFile(path.join(root, 'README.md'), 'utf8'),
      await readFile(path.join(root, 'skills', 'power-automate-mcp', 'SKILL.md'), 'utf8'),
    ].join('\n');

    for (const command of expectedV1Commands) {
      expect(docs).toContain(`\`${command}\``);
    }

    for (const alias of removedAliases) {
      expect(docs).not.toContain(`\`${alias}\``);
    }
  });
});
