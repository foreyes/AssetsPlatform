// Fail-closed source-evidence boundary. A renderer accepting a clip is not evidence.
export function verifiedAnimationRecord(record){
 return !!(record?.status==='ready'&&record.skinBindingVerified===true&&record.sourceCurvesVerified===true&&record.pixelVerified===true&&typeof record.dataUrl==='string'&&record.dataUrl&&typeof record.modelUrl==='string'&&record.modelUrl&&Array.isArray(record.verifiedPlayableClipIds)&&Array.isArray(record.playableClipIds)&&record.playableClipIds.length>0&&record.playableClipIds.every(id=>typeof id==='string'&&record.verifiedPlayableClipIds.includes(id)));
}
export function resolveAnimation({enabled=false,item,base,action,mode='constraint',references=[]}={}){
 const variant=action?.variants?.[mode]||base?.variants?.[mode];
 const variantMatches=variant?.objectId===item?.id&&variant?.sourceId===item?.sourceId;
 const record=enabled&&item?.isObject&&base?.objectId===item.id&&base?.sourceId===item.sourceId&&verifiedAnimationRecord(base)?(variantMatches&&verifiedAnimationRecord(variant)?variant:base):null;
 return {availability:record?'verified':references.length?'references-only':'none',record,verifiedPlayableClipIds:record?[...record.verifiedPlayableClipIds]:[],references};
}
export function verifiedViewerClips(record,clips=[]){
 if(!verifiedAnimationRecord(record))return [];
 const allowed=new Set(record.playableClipIds.filter(id=>record.verifiedPlayableClipIds.includes(id)));
 return clips.filter(clip=>allowed.has(clip.id));
}
