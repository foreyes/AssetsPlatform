// The single review/selection persistence contract, with legacy format codecs.
export function loadReviewState(storage,config){
 let reviews=Object.create(null),selected=[],legacySelected=[],ok=true;
 try{const raw=JSON.parse(storage.getItem(config.reviewKey)||'{}');if(raw.version===1){reviews=raw.reviews||{};legacySelected=Array.isArray(raw.selected)?raw.selected:[];if(!config.selectionStorageKey&&!config.sharedSelections)selected=legacySelected.filter(x=>typeof x==='string');}}
 catch{ok=false}
 if(config.selectionStorageKey){try{const ids=JSON.parse(storage.getItem(config.selectionStorageKey)||'[]');if(Array.isArray(ids))selected=ids.filter(x=>typeof x==='string');}catch{ok=false}}
 return {reviews,selected,legacySelected,ok};
}
export function saveReviewState(storage,config,{reviews,selected,legacySelected}){
 try{storage.setItem(config.reviewKey,JSON.stringify({version:1,updatedAt:new Date().toISOString(),reviews,selected:config.selectionStorageKey||!config.sharedSelections?[...selected]:legacySelected}));if(config.selectionStorageKey)storage.setItem(config.selectionStorageKey,JSON.stringify([...selected]));return true}catch{return false}
}
