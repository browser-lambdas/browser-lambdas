import { tutorialResources, TUTORIAL_STATUS_KEY, TUTORIAL_PROJECT, TUTORIAL_VERSION_KEY, TUTORIAL_VERSION } from '../shared/tutorial.js';
import { mutateStorageRecords } from './storageRepository.js';

const keys = {
  lambdas: 'local_storage_key_lambdas', secrets: 'local_storage_key_secrets',
  triggers: 'local_storage_key_triggers', styles: 'local_storage_key_shellcss'
};
const archiveKey = 'local_storage_key_tutorial_archive';
const settingsKey = 'local_storage_key_project_settings';

async function readTutorialCollections() {
  const saved = await chrome.storage.local.get([...Object.values(keys), TUTORIAL_STATUS_KEY, TUTORIAL_VERSION_KEY, archiveKey, settingsKey]);
  const collections = Object.fromEntries(Object.entries(keys).map(([name, key]) => {
    let items;
    try { items = JSON.parse(saved[key] ?? '[]'); }
    catch { throw new Error('Existing resources could not be read. Nothing was changed.'); }
    if (!Array.isArray(items)) throw new Error('Existing resources could not be read. Nothing was changed.');
    return [name, items];
  }));
  return { saved, collections };
}

async function saveTutorial(collections, storage, extra = {}) {
  await chrome.storage.local.set({
    ...Object.fromEntries(Object.entries(keys).map(([name, key]) => [key, JSON.stringify(collections[name])])),
    local_storage_key_storage: JSON.stringify(storage),
    [TUTORIAL_STATUS_KEY]: 'created',
    [TUTORIAL_VERSION_KEY]: TUTORIAL_VERSION,
    ...extra
  });
}

function addTutorialSecrets(collections, tutorial) {
  if (tutorial.secrets.some(example => collections.secrets.some(item => item.key === example.key))) {
    throw new Error('Tutorial answer secret names are already in use. Existing items were preserved.');
  }
  collections.secrets.push(...tutorial.secrets);
}

export function createTutorial() {
  return mutateStorageRecords(async (storage) => {
    const { saved, collections } = await readTutorialCollections();
    if (saved[TUTORIAL_STATUS_KEY] === 'created') throw new Error('The tutorial has already been created.');
    const tutorial = tutorialResources();
    if (Object.values(collections).some(items => items.some(item => item.project === TUTORIAL_PROJECT))
      || Object.hasOwn(saved[settingsKey] ?? {}, TUTORIAL_PROJECT)
      || collections.lambdas.some(item => tutorial.lambdas.some(example => example.name === item.name))
      || storage.some(item => tutorial.storage.some(example => example.key === item.key))) {
      throw new Error('Tutorial names are already in use. Rename those items before trying again. Nothing was changed.');
    }
    collections.lambdas.push(...tutorial.lambdas);
    collections.triggers.push(...tutorial.triggers);
    addTutorialSecrets(collections, tutorial);
    await saveTutorial(collections, [...storage, ...tutorial.storage]);
    // K-V was saved with the other collections; the queue must not write it again.
    return { changed: false, success: true, start: tutorial.lambdas[0] };
  });
}

export function updateTutorial() {
  return mutateStorageRecords(async (storage) => {
    const { saved, collections } = await readTutorialCollections();
    if (saved[TUTORIAL_STATUS_KEY] !== 'created' || saved[TUTORIAL_VERSION_KEY] >= TUTORIAL_VERSION) return { changed: false, success: true };
    if (saved[TUTORIAL_VERSION_KEY] >= 5) {
      const first = collections.secrets.find(item => item.key === 'tutorial-answer-1');
      if (first?.value === 'ctx.kv') first.value = 'ctx.kv.get()';
      await chrome.storage.local.set({ [keys.secrets]: JSON.stringify(collections.secrets), [TUTORIAL_VERSION_KEY]: TUTORIAL_VERSION });
      return { changed: false, success: true };
    }
    const tutorial = tutorialResources();
    const archives = saved[archiveKey] ?? [];
    if (!Array.isArray(archives)) throw new Error('The tutorial archive could not be read. Existing items were preserved.');
    if (saved[TUTORIAL_VERSION_KEY] === 4) {
      const answer = collections.lambdas.find(item => item.project === TUTORIAL_PROJECT && item.name === 'answer');
      const archived = { version: 4, lambdas: answer ? [{ ...answer }] : [] };
      if (answer) answer.func = tutorial.lambdas.find(item => item.name === 'answer').func;
      addTutorialSecrets(collections, tutorial);
      await saveTutorial(collections, storage, { [archiveKey]: [...archives, archived] });
      return { changed: false, success: true };
    }
    const isTutorial = item => ['tutorial', TUTORIAL_PROJECT].includes(item.project);
    const oldFunctions = ['let-the-game-begin', 'begin-the-hunt', 'check-site', 'auto-check'];
    const oldTriggers = ['tutorial-treasure-hunt', 'auto-check'];
    const archived = {
      version: saved[TUTORIAL_VERSION_KEY] ?? 1,
      lambdas: collections.lambdas.filter(item => isTutorial(item) && oldFunctions.includes(item.name)),
      triggers: collections.triggers.filter(item => isTutorial(item) && oldTriggers.includes(item.name)),
      storage: storage.filter(item => ['tutorial-started', 'tutorial-visited'].includes(item.key)),
      secrets: collections.secrets.filter(item => item.key === 'tutorial-location')
    };
    collections.lambdas = collections.lambdas.filter(item => !archived.lambdas.includes(item));
    collections.triggers = collections.triggers.filter(item => !archived.triggers.includes(item));
    collections.secrets = collections.secrets.filter(item => !archived.secrets.includes(item));
    storage = storage.filter(item => !archived.storage.includes(item));
    for (const example of tutorial.lambdas) {
      const existing = collections.lambdas.find(item => item.name === example.name);
      if (existing && !(example.name === 'deactivate-demo' && isTutorial(existing))) {
        throw new Error(`${example.name} already exists. Existing tutorial items were preserved.`);
      }
      if (!existing) collections.lambdas.push(example);
    }
    if (storage.some(item => item.key === 'tutorial-progress')) throw new Error('tutorial-progress already exists. Existing tutorial items were preserved.');
    for (const example of tutorial.triggers) {
      if (!collections.triggers.some(item => isTutorial(item) && item.name === example.name)) collections.triggers.push(example);
    }
    addTutorialSecrets(collections, tutorial);
    await saveTutorial(collections, [...storage, ...tutorial.storage], { [archiveKey]: [...archives, archived] });
    return { changed: false, success: true };
  });
}
