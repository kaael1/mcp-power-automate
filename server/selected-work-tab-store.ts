import { promises as fs } from 'node:fs';

import type { SelectedWorkTab } from './schemas.js';
import { selectedWorkTabSchema } from './schemas.js';
import { getDataFilePath } from './runtime-paths.js';
import { markStoreMissing, readVersionedStore, readVersionedStoreSync, writeVersionedStore } from './store-utils.js';

const STORE_NAME = 'selected-work-tab';
const STORE_VERSION = 1;

let selectedWorkTab: SelectedWorkTab | null = null;

const getStoreFilePath = () => getDataFilePath('selected-work-tab.json');

const refreshSelectedWorkTab = () => {
  selectedWorkTab =
    readVersionedStoreSync({
      filePath: getStoreFilePath(),
      migrate: (value) => selectedWorkTabSchema.parse(value),
      name: STORE_NAME,
      parse: (value) => selectedWorkTabSchema.parse(value),
      version: STORE_VERSION,
    }) || null;

  return selectedWorkTab;
};

export const loadSelectedWorkTab = async () => {
  selectedWorkTab =
    (await readVersionedStore({
      filePath: getStoreFilePath(),
      migrate: (value) => selectedWorkTabSchema.parse(value),
      name: STORE_NAME,
      parse: (value) => selectedWorkTabSchema.parse(value),
      version: STORE_VERSION,
    })) || null;
  return selectedWorkTab;
};

export const getSelectedWorkTab = () => refreshSelectedWorkTab();

export const saveSelectedWorkTab = async (value: SelectedWorkTab) => {
  const parsed = selectedWorkTabSchema.parse(value);
  await writeVersionedStore({
    data: parsed,
    filePath: getStoreFilePath(),
    name: STORE_NAME,
    version: STORE_VERSION,
  });
  selectedWorkTab = parsed;
  return parsed;
};

export const clearSelectedWorkTab = async () => {
  selectedWorkTab = null;
  await fs.rm(getStoreFilePath(), { force: true });
  markStoreMissing(STORE_NAME, getStoreFilePath());
};
