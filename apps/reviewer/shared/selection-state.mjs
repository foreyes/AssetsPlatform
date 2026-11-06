// Resolve Storage only when a guarded read or write actually runs.
export const browserStorage = {
 getItem(key) { return globalThis.localStorage.getItem(key); },
 setItem(key, value) { globalThis.localStorage.setItem(key, value); }
};

// The single review/selection persistence contract, with legacy format codecs.
export function loadReviewState(storage, config) {
 let reviews = Object.create(null), selected = [], legacySelected = [];
 let reviewOK = true, selectionOK = true;
 try {
  const raw = JSON.parse(storage.getItem(config.reviewKey) || '{}');
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) ||
      (raw.version !== 1 && Object.keys(raw).length) ||
      (raw.reviews !== undefined && (!raw.reviews || typeof raw.reviews !== 'object' || Array.isArray(raw.reviews))) ||
      (raw.selected !== undefined && !Array.isArray(raw.selected))) throw Error('Invalid stored review');
  if (raw.version === 1) {
   const hasWrongProject = raw.projectId !== undefined && raw.projectId !== config.projectId;
   const hasWrongDataset = raw.datasetId !== undefined && raw.datasetId !== config.datasetId;
   if (hasWrongProject || hasWrongDataset) throw Error('Stored review identity mismatch');
   reviews = raw.reviews || {};
   legacySelected = raw.selected || [];
   if (!config.selectionStorageKey && !config.sharedSelections) selected = legacySelected.filter(id => typeof id === 'string');
  }
 } catch { reviewOK = false; }
 if (config.selectionStorageKey) {
  try {
   const ids = JSON.parse(storage.getItem(config.selectionStorageKey) || '[]');
   if (!Array.isArray(ids)) throw Error('Invalid stored selection');
   selected = ids.filter(id => typeof id === 'string');
  } catch { selectionOK = false; }
 }
 return {reviews, selected, legacySelected, ok: reviewOK && selectionOK, reviewOK, selectionOK};
}
export function saveReviewState(storage,config,{reviews,selected,legacySelected}){
 try{storage.setItem(config.reviewKey,JSON.stringify({version:1,...(config.projectId&&config.datasetId?{projectId:config.projectId,datasetId:config.datasetId}:{}),updatedAt:new Date().toISOString(),reviews,selected:config.selectionStorageKey||!config.sharedSelections?[...selected]:legacySelected}));if(config.selectionStorageKey)storage.setItem(config.selectionStorageKey,JSON.stringify([...selected]));return true}catch{return false}
}

// Intents are rebased synchronously before writing. This is not an atomic
// cross-process transaction: truly simultaneous read/modify/write can still race.
function applySelections(ids, intents) {
 const selected = new Set(ids);
 for (const intent of intents) {
  if (intent.clear) selected.clear();
  for (const id of intent.add || []) selected.add(id);
  for (const id of intent.remove || []) selected.delete(id);
 }
 return [...selected];
}
function applyReviews(reviews, intents) {
 const result = Object.assign(Object.create(null), reviews);
 for (const intent of intents) {
  for (const [id, review] of Object.entries(intent.reviews || {})) result[id] = {...review};
  if (intent.patch) {
   const {id, ...fields} = intent.patch;
   result[id] = {status: 'pending', comment: '', ...result[id], ...fields};
  }
 }
 return result;
}
export function createReviewWriter(storage, config) {
 let reviewPending = [], selectionPending = [];
 return {
  reset() { reviewPending = []; selectionPending = []; },
  save(intent, fallback) {
   const ownsSelection = !!config.selectionStorageKey || !config.sharedSelections;
   if (intent.patch || intent.reviews || (intent.selection && ownsSelection)) reviewPending.push(intent);
   if (intent.selection && config.selectionStorageKey) selectionPending.push(intent.selection);
   const latest = loadReviewState(storage, config);
   const reviews = applyReviews(latest.reviewOK ? latest.reviews : fallback.reviews, reviewPending);
   const legacySelected = applySelections(latest.reviewOK ? latest.legacySelected : fallback.legacySelected,
    ownsSelection ? reviewPending.flatMap(change => change.selection ? [change.selection] : []) : []);
   const persistedSelected = ownsSelection
    ? config.selectionStorageKey
     ? applySelections(latest.selectionOK ? latest.selected : fallback.selected, selectionPending)
     : legacySelected
    : applySelections(fallback.selected, intent.selection ? [intent.selection] : []);
   if (reviewPending.length && latest.reviewOK) {
    try {
     storage.setItem(config.reviewKey, JSON.stringify({version: 1,
      ...(config.projectId && config.datasetId ? {projectId: config.projectId, datasetId: config.datasetId} : {}),
      updatedAt: new Date().toISOString(), reviews, selected: legacySelected}));
     reviewPending = [];
    } catch { latest.reviewOK = false; }
   }
   // Each key acknowledges its own fragments; a failed sibling must not replay
   // a successful import later over another tab's newer edits.
   if (selectionPending.length && latest.selectionOK) {
    try {
     storage.setItem(config.selectionStorageKey, JSON.stringify(persistedSelected));
     selectionPending = [];
    } catch { latest.selectionOK = false; }
   }
   const selected = config.sharedSelections
    ? applySelections(fallback.selected, intent.selection ? [intent.selection] : [])
    : persistedSelected;
   return {reviews, selected, legacySelected,
    ok: latest.reviewOK && latest.selectionOK && !reviewPending.length && !selectionPending.length};
  }
 };
}
