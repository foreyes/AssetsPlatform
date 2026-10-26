// Local, deterministic semantic sidecar. No model, network, storage or DOM calls.
import {declaredDimension} from './preview-status.mjs';
export const SEMANTIC_SCHEMA_VERSION = 1;
export const SEMANTIC_RULE_VERSION = 'controlled-v1';
export const CATEGORY_PARENTS = Object.freeze({food:'item', firearm:'weapon', weapon:'item'});
export const CATEGORIES = Object.freeze(['environment','plant','creature','character','item','food','weapon','firearm','tool','structure','vehicle','effect','ui','other']);
export const TAGS = Object.freeze(['environment-decoration','collectible','edible','equippable','usable','interactive','ui','sprite','variant']);
export const DIMENSIONS = Object.freeze(['2D','3D','mixed','unknown']);
export const ANIMATION_FACTS = Object.freeze(['sourceTracks','skeletonPresent','bindingConfirmed','conversionSupported','playbackVerified']);
const own = (o,k) => Object.prototype.hasOwnProperty.call(o,k);
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const clone = v => JSON.parse(JSON.stringify(v));
const unique = xs => [...new Set(xs)];
const assert = (ok,message) => { if(!ok) throw new TypeError(message); };
const key = v => { assert(typeof v === 'string' && v.trim() && !['__proto__','prototype','constructor'].includes(v), 'unsafe or empty identity'); return v; };
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (object(value)) return `{${Object.keys(value).sort().filter(k=>value[k]!==undefined).map(k=>`${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`;
  return JSON.stringify(value ?? null);
}
function hash(value) {
  let n=0xcbf29ce484222325n;
  for(const c of new TextEncoder().encode(stable(value))) { n^=BigInt(c); n=BigInt.asUintN(64,n*0x100000001b3n); }
  return n.toString(16).padStart(16,'0');
}
export function inputFingerprint(record) { assert(object(record), 'asset record required'); return `fnv1a64:${hash(record)}`; }
export function createAnnotationState({projectId,datasetId}={}) {
  return {schemaVersion:SEMANTIC_SCHEMA_VERSION,ruleVersion:SEMANTIC_RULE_VERSION,identity:{projectId:key(projectId),datasetId:key(datasetId)},revision:0,entries:{},history:[]};
}
function stateCheck(state) {
  assert(object(state) && state.schemaVersion===SEMANTIC_SCHEMA_VERSION && state.ruleVersion===SEMANTIC_RULE_VERSION, 'incompatible annotation state/rules');
  assert(object(state.identity) && object(state.entries) && Array.isArray(state.history), 'invalid annotation state');
}
function itemMap(items) {
  assert(Array.isArray(items), 'items must be an array');
  const map=new Map();
  for(const item of items) { assert(object(item), 'invalid asset'); const id=key(item.id); assert(!map.has(id), `duplicate asset ID: ${id}`); map.set(id,item); }
  return map;
}
function dimension(record) {
  const explicit=record.semanticDimension ?? record.dimension ?? record.representationDimension ?? record.facets?.dimension;
  if(explicit!==undefined) { assert(DIMENSIONS.includes(explicit), 'invalid explicit representation dimension'); return explicit; }
  const independentImage=record.isIndependentImage===true || record.isSprite===true || ['sprite','ui-image','2d-object'].includes(record.role);
  if(independentImage && (record.modelUrl||record.modelAsset)) return 'mixed';
  if(independentImage && (record.imageUrl||record.originalUrl)) return '2D';
  return declaredDimension(record);
}
function animation(record) {
  const raw=object(record.animationFacts)?record.animationFacts:{};
  const facts={};
  for(const name of ANIMATION_FACTS) {
    const entry=raw[name];
    let value=null,evidence=[];
    if(object(entry) && (entry.value===true || entry.value===false) && Array.isArray(entry.evidence)) {
      evidence=entry.evidence.filter(e=>object(e)&&typeof e.source==='string'&&e.source.trim()&&typeof e.reference==='string'&&e.reference.trim()).map(e=>({source:e.source,reference:e.reference}));
      if(evidence.length && (name!=='playbackVerified' || entry.verifiedBy==='human')) value=entry.value;
    }
    facts[name]={value,evidence:value===null?[]:evidence};
  }
  return facts;
}
export function extractDeterministicFacts(record) {
  assert(object(record), 'asset record required');
  const type=typeof record.type==='string'&&record.type.trim()?record.type.trim().toLowerCase():'unknown';
  return {assetId:key(record.id),technicalType:type,dimension:dimension(record),animation:animation(record)};
}
function checkpoint(state) {
  state.history.push({revision:state.revision,entries:clone(state.entries)});
  // Keep exported sidecars bounded; callers should export checkpoints externally for longer retention.
  if(state.history.length>20) state.history.shift();
  state.revision++;
}
function ensureEntry(state,id) { return state.entries[id] ||= {fingerprint:null,facts:null,proposals:[],rejections:[],overrides:{},needsReview:false}; }
export function reconcileInputs(state,items) {
  stateCheck(state); const map=itemMap(items),changed=[],unchanged=[],missing=[];
  for(const [id,item] of map) {
    const fingerprint=inputFingerprint(item), old=state.entries[id];
    if(old?.fingerprint===fingerprint) { unchanged.push(id); continue; }
    if(changed.length===0) checkpoint(state);
    const entry=ensureEntry(state,id);
    entry.fingerprint=fingerprint; entry.facts=extractDeterministicFacts(item);
    entry.needsReview=!!old?.fingerprint;
    for(const proposal of entry.proposals) if(!proposal.locked && proposal.status!=='stale') proposal.status='stale';
    changed.push(id);
  }
  for(const id of Object.keys(state.entries)) if(!map.has(id)) missing.push(id);
  return {changed,unchanged,missing,revision:state.revision};
}
function validateSuggestion(raw) {
  assert(object(raw),'proposal must be an object');
  const field=raw.field, value=raw.value;
  assert(['category','tag','dimension'].includes(field),'unsupported proposal field');
  assert((field==='category'?CATEGORIES:field==='tag'?TAGS:DIMENSIONS).includes(value),'proposal outside controlled vocabulary');
  return {field,value};
}
function validateProvenance(raw) {
  assert(object(raw) && typeof raw.method==='string' && raw.method.trim() && typeof raw.version==='string' && raw.version.trim(), 'proposal method/version required');
  assert(Array.isArray(raw.evidence) && raw.evidence.length>0, 'proposal evidence required');
  const evidence=raw.evidence.map(e=>{ assert(object(e)&&typeof e.source==='string'&&e.source.trim()&&typeof e.reference==='string'&&e.reference.trim(), 'invalid proposal evidence'); return {source:e.source,reference:e.reference}; });
  return {method:raw.method,version:raw.version,evidence};
}
// payload: {identity, ruleVersion, proposals:[{assetId,field,value,inputFingerprint,method,version,evidence,confidence?,conflicts?}]}
export function importProposals(state,payload,items) {
  stateCheck(state); const map=itemMap(items);
  assert(object(payload) && stable(payload.identity)===stable(state.identity), 'proposal project/dataset mismatch');
  assert(payload.ruleVersion===state.ruleVersion && Array.isArray(payload.proposals), 'proposal rule version/list mismatch');
  const accepted=[],stale=[],ignored=[],prepared=[],seen=new Set();
  for(const raw of payload.proposals) {
    const assetId=key(raw?.assetId), item=map.get(assetId);
    if(!item) {ignored.push({assetId,reason:'asset not in catalog'});continue;}
    const suggestion=validateSuggestion(raw), provenance=validateProvenance(raw), entry=state.entries[assetId];
    const current=inputFingerprint(item);
    if(raw.inputFingerprint!==current || entry?.fingerprint!==current) { stale.push(assetId); continue; }
    const id=`proposal:${hash({assetId,...suggestion,provenance,fp:current})}`;
    if(entry.proposals.some(p=>p.id===id)||seen.has(id)) { ignored.push({assetId,reason:'duplicate'}); continue; }
    if((entry.rejections||[]).some(r=>r.field===suggestion.field&&r.value===suggestion.value&&(r.locked||r.inputFingerprint===current))) { ignored.push({assetId,reason:'human rejection'}); continue; }
    prepared.push({id,assetId,...suggestion,...provenance,inputFingerprint:current,confidence:Number.isFinite(raw.confidence)?Math.max(0,Math.min(1,raw.confidence)):null,conflicts:Array.isArray(raw.conflicts)?raw.conflicts.filter(x=>typeof x==='string'):[],status:'pending'});
    seen.add(id);
  }
  if(prepared.length)checkpoint(state);
  for(const proposal of prepared) {state.entries[proposal.assetId].proposals.push(proposal);accepted.push(proposal.id);}
  return {accepted,stale,ignored,revision:state.revision};
}
function proposalById(state,id) { for(const entry of Object.values(state.entries)) {const p=entry.proposals.find(p=>p.id===id);if(p)return [entry,p];} throw new Error('proposal not found'); }
export function reviewProposal(state,id,decision,{locked=false}={}) {
  return reviewProposals(state,[id],decision,{locked})[0];
}
export function reviewProposals(state,ids,decision,{locked=false}={}) {
  stateCheck(state); assert(['accept','reject'].includes(decision),'decision must be accept/reject');
  assert(Array.isArray(ids),'proposal IDs must be an array');
  const selected=unique(ids).map(id=>proposalById(state,id));
  for(const [entry,p] of selected) {
    assert(p.status!=='stale','stale proposal cannot be reviewed');
    if(decision==='accept' && (entry.rejections||[]).some(r=>r.field===p.field&&r.value===p.value&&r.locked)) throw new Error('locked rejection prevents acceptance');
  }
  if(selected.length)checkpoint(state);
  for(const [entry,p] of selected) {
    p.status=decision==='accept'?'accepted':'rejected'; p.locked=locked===true;
  if(decision==='reject') {
    if(entry.overrides[p.field]?.sourceProposalId===p.id)delete entry.overrides[p.field];
    entry.rejections ||= [];
    entry.rejections.push({field:p.field,value:p.value,inputFingerprint:p.inputFingerprint,locked:locked===true});
  } else {
    entry.rejections=(entry.rejections||[]).filter(r=>r.locked||r.field!==p.field||r.value!==p.value);
    // Accepted locked proposals remain individual values, not a single field override.
    // Thus accepting two tags/categories cannot erase the first one.
  }
  entry.needsReview=false;
  }
  return selected.map(([,p])=>p);
}
export function setSemanticOverride(state,assetId,field,value,{locked=true}={}) {
  setSemanticOverrides(state,[assetId],field,value,{locked});
}
export function setSemanticOverrides(state,assetIds,field,value,{locked=true}={}) {
  stateCheck(state); assert(Array.isArray(assetIds),'asset IDs must be an array');
  assert(['category','tag','dimension'].includes(field),'unsupported override field');
  assert(value===null || (field==='category'?CATEGORIES:field==='tag'?TAGS:DIMENSIONS).includes(value),'override outside controlled vocabulary');
  const ids=unique(assetIds);
  for(const id of ids) {key(id);assert(own(state.entries,id),'unknown asset ID');}
  if(ids.length)checkpoint(state);
  for(const id of ids) {state.entries[id].overrides[field]={value,locked:locked===true}; state.entries[id].needsReview=false;}
}
export function effectiveSemantics(item,state) {
  stateCheck(state); const id=key(item?.id), entry=state.entries[id];
  const facts=entry?.fingerprint===inputFingerprint(item)?entry.facts:extractDeterministicFacts(item);
  const current=entry?.fingerprint===inputFingerprint(item);
  const accepted=entry?.proposals.filter(p=>p.status==='accepted'&&(p.locked||current&&p.inputFingerprint===entry.fingerprint))||[];
  const chosen=field=>entry?.overrides[field] ? entry.overrides[field].value : (accepted.filter(p=>p.field===field).map(p=>p.value));
  const rawCategories=chosen('category'), rawTags=chosen('tag'), rawDimension=chosen('dimension');
  const categories=Array.isArray(rawCategories)?rawCategories:rawCategories?[rawCategories]:[];
  const tags=Array.isArray(rawTags)?rawTags:rawTags?[rawTags]:[];
  const inherited=new Set(categories);
  for(const c of categories) {let parent=CATEGORY_PARENTS[c]; while(parent) {inherited.add(parent);parent=CATEGORY_PARENTS[parent];}}
  const dimensionProposals=Array.isArray(rawDimension)?unique(rawDimension):[];
  const dimensionConflict=dimensionProposals.length>1;
  const dimensionValue=typeof rawDimension==='string'?rawDimension:dimensionProposals[0]&&!dimensionConflict?dimensionProposals[0]:facts.dimension;
  return {assetId:id,categories:[...inherited],directCategories:categories,tags:unique(tags),dimension:dimensionValue,technicalType:facts.technicalType,animation:facts.animation,unannotated:!categories.length&&!tags.length&&!accepted.some(p=>p.field==='dimension')&&!entry?.overrides.category&&!entry?.overrides.tag&&!entry?.overrides.dimension,needsReview:!current||!!entry?.needsReview||dimensionConflict||!!entry?.proposals.some(p=>p.status==='pending')};
}
function selector(values,raw) {
  const q=Array.isArray(raw)?{any:raw}:raw;
  if(!q)return true;
  assert(object(q),'invalid query selector');
  const have=new Set(values);
  for(const field of ['any','all','exclude']) if(q[field]!==undefined) assert(Array.isArray(q[field]), `selector.${field} must be array`);
  return (!q.any?.length || q.any.some(v=>have.has(v))) && (!q.all?.length || q.all.every(v=>have.has(v))) && (!q.exclude?.length || q.exclude.every(v=>!have.has(v)));
}
export function semanticMatches(item,state,query={}) {
  assert(object(query),'query must be an object');
  const s=effectiveSemantics(item,state);
  if(query.unannotated===true&&!s.unannotated || query.unknown===true&&s.dimension!=='unknown') return false;
  if(!selector(s.categories,query.categories) || !selector(s.tags,query.tags) || !selector([s.dimension],query.dimensions) || !selector([s.technicalType],query.types)) return false;
  if(query.animation) for(const [name,want] of Object.entries(query.animation)) {
    assert(ANIMATION_FACTS.includes(name) && [true,false,null].includes(want),'invalid animation filter');
    if(s.animation[name].value!==want)return false;
  }
  if(query.any) {assert(Array.isArray(query.any),'query.any must be array'); if(query.any.length&&!query.any.some(part=>semanticMatches(item,state,part)))return false;}
  return true;
}
export function filterSemanticItems(items,state,query={}, {scope='matched',page=1,pageSize=50}={}) {
  const map=itemMap(items); assert(['catalog','matched','page'].includes(scope),'invalid scope');
  assert(Number.isInteger(page)&&page>0&&Number.isInteger(pageSize)&&pageSize>0,'invalid page');
  const all=[...map.values()], matched=all.filter(item=>semanticMatches(item,state,query));
  const selected=scope==='catalog'?all:scope==='page'?matched.slice((page-1)*pageSize,page*pageSize):matched;
  return {items:selected,total:all.length,matched:matched.length,page,pageSize,pageCount:Math.ceil(matched.length/pageSize),scope};
}
export function exportAnnotations(state) {stateCheck(state);return clone(state);}
function validateEntry(id,entry) {
  key(id);
  assert(object(entry)&&Array.isArray(entry.proposals)&&object(entry.overrides),'invalid backup entry');
  const fingerprint=value=>typeof value==='string'&&/^fnv1a64:[0-9a-f]{16}$/.test(value);
  for(const p of entry.proposals) {
    validateSuggestion(p); validateProvenance(p);
    assert(['pending','accepted','rejected','stale'].includes(p.status)&&p.assetId===id&&typeof p.id==='string'&&fingerprint(p.inputFingerprint),'invalid backup proposal');
    assert(p.locked===undefined||typeof p.locked==='boolean','invalid backup proposal lock');
  }
  for(const [field,override] of Object.entries(entry.overrides)) { assert(['category','tag','dimension'].includes(field)&&object(override),'invalid backup override'); assert(override.value===null||(field==='category'?CATEGORIES:field==='tag'?TAGS:DIMENSIONS).includes(override.value),'invalid backup override value'); }
  assert(entry.rejections===undefined||Array.isArray(entry.rejections),'invalid backup rejection ledger');
  for(const r of entry.rejections||[]) {validateSuggestion(r);assert(fingerprint(r.inputFingerprint)&&typeof r.locked==='boolean','invalid backup rejection');}
  assert(entry.fingerprint===null||fingerprint(entry.fingerprint),'invalid backup fingerprint');
}
function validateBackup(state,backup,{withHistory=false}={}) {
  assert(object(backup)&&backup.schemaVersion===state.schemaVersion&&backup.ruleVersion===state.ruleVersion&&stable(backup.identity)===stable(state.identity)&&object(backup.entries),'annotation backup identity/schema mismatch');
  for(const [id,entry] of Object.entries(backup.entries))validateEntry(id,entry);
  if(withHistory) {
    assert(Number.isSafeInteger(backup.revision)&&backup.revision>=0&&Array.isArray(backup.history)&&backup.history.length<=20,'invalid backup revision/history');
    let last=-1;
    for(const point of backup.history) {
      assert(object(point)&&Number.isSafeInteger(point.revision)&&point.revision>=0&&point.revision<backup.revision&&point.revision>last&&object(point.entries),'invalid backup checkpoint');
      last=point.revision;
      for(const [id,entry] of Object.entries(point.entries))validateEntry(id,entry);
    }
  }
}
export function importAnnotations(state,backup,items,{mode='merge'}={}) {
  stateCheck(state); const map=itemMap(items);
  validateBackup(state,backup);
  assert(['merge','replace'].includes(mode),'invalid import mode');
  const next=mode==='replace'?{}:clone(state.entries),imported=[],stale=[];
  for(const [id,entry] of Object.entries(backup.entries)) {
    if(!map.has(id))continue;
    const value=clone(entry),fp=inputFingerprint(map.get(id)),local=mode==='merge'?state.entries[id]:null;
    value.rejections ||= [];
    assert(Array.isArray(value.rejections),'invalid backup rejection ledger');
    if(local) {
      const byId=new Map(value.proposals.map(p=>[p.id,p]));
      for(const p of local.proposals)byId.set(p.id,clone(p)); // Existing human decision has priority.
      value.proposals=[...byId.values()];
      value.rejections=[...value.rejections,...clone(local.rejections||[])];
      value.overrides={...value.overrides,...clone(local.overrides)}; // Current override wins.
      value.needsReview=!!(value.needsReview||local.needsReview);
    }
    value.fingerprint=fp;
    value.facts=extractDeterministicFacts(map.get(id));
    if(entry.fingerprint!==fp) {value.needsReview=true;stale.push(id);}
    for(const p of value.proposals) {
      if(p.inputFingerprint!==fp&&!p.locked)p.status='stale';
      else if(value.rejections.some(r=>r.field===p.field&&r.value===p.value&&(r.locked||r.inputFingerprint===fp)))p.status='rejected';
    }
    next[id]=value; imported.push(id);
  }
  checkpoint(state);state.entries=next;
  return {imported,stale,revision:state.revision};
}
// For trusted localStorage round trips. Unlike merge import, this retains bounded checkpoints.
export function restoreAnnotationState(backup,identity,items) {
  const empty=createAnnotationState(identity);
  validateBackup(empty,backup,{withHistory:true});
  itemMap(items);
  const state=clone(backup);
  // Historical facts are never playback authority: rollback replaces them with live facts.
  reconcileInputs(state,items);
  for(const item of items)if(state.entries[item.id]?.fingerprint===inputFingerprint(item))state.entries[item.id].facts=extractDeterministicFacts(item);
  return state;
}
export function rollbackAnnotations(state,revision) {
  stateCheck(state); const point=state.history.findLast(x=>x.revision===revision);
  assert(!!point,'rollback revision not retained'); checkpoint(state);
  const previous=state.entries;
  state.entries=clone(point.entries);
  for(const [id,entry] of Object.entries(state.entries)) {
    const live=previous[id];
    entry.fingerprint=live?.fingerprint||null;
    entry.facts=live?.facts||null;
    if(!live?.fingerprint)entry.needsReview=true;
    for(const p of entry.proposals)if(p.inputFingerprint!==entry.fingerprint&&!p.locked)p.status='stale';
  }
  return {revision:state.revision,restoredFrom:revision};
}
