import { tutorialResources, TUTORIAL_STATUS_KEY, TUTORIAL_PROJECT } from '../shared/tutorial.js';
import { mutateStorageRecords } from './storageRepository.js';

export function createTutorial() {
  return mutateStorageRecords(async () => {
    const keys = {
      lambdas: 'local_storage_key_lambdas', secrets: 'local_storage_key_secrets',
      triggers: 'local_storage_key_triggers', styles: 'local_storage_key_shellcss'
    };
    const saved = await chrome.storage.local.get([...Object.values(keys), TUTORIAL_STATUS_KEY, 'local_storage_key_project_settings']);
    if (saved[TUTORIAL_STATUS_KEY] === 'created') throw new Error('The tutorial has already been created.');
    const collections = Object.fromEntries(Object.entries(keys).map(([name, key]) => {
      let items;
      try { items = JSON.parse(saved[key] ?? '[]'); }
      catch { throw new Error('Existing resources could not be read. Nothing was changed.'); }
      if (!Array.isArray(items)) throw new Error('Existing resources could not be read. Nothing was changed.');
      return [name, items];
    }));
    const tutorial = tutorialResources();
    if (Object.values(collections).some(items => items.some(item => item.project === TUTORIAL_PROJECT))
      || Object.hasOwn(saved.local_storage_key_project_settings ?? {}, TUTORIAL_PROJECT)
      || collections.lambdas.some(item => tutorial.lambdas.some(example => example.name === item.name))
      || collections.secrets.some(item => tutorial.secrets.some(example => example.key === item.key))) {
      throw new Error('Tutorial names are already in use. Nothing was changed.');
    }
    await chrome.storage.local.set({
      [keys.lambdas]: JSON.stringify([...collections.lambdas, ...tutorial.lambdas]),
      [keys.secrets]: JSON.stringify([...collections.secrets, ...tutorial.secrets]),
      [TUTORIAL_STATUS_KEY]: 'created'
    });
    return { changed: false, success: true, start: tutorial.lambdas[0] };
  });
}
