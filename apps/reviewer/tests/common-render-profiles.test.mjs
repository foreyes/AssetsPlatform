import test from 'node:test';
import assert from 'node:assert/strict';
import {COMMON_RENDER_PROFILES,commonIndexedProfiles} from '../shared/common-render-profiles.mjs';

test('six self-authored generic inspection modes have distinct identities and valid renderer modes',()=>{
  const ids=['material','clay','toon','neutral-soft','cool-bands','warm-bands'];
  assert.deepEqual(COMMON_RENDER_PROFILES.map(p=>p.id),ids);
  assert.equal(new Set(ids).size,6);
  assert(COMMON_RENDER_PROFILES.every(p=>['material','clay','toon'].includes(p.mode) && p.implemented===true));
  assert.equal(COMMON_RENDER_PROFILES[3].parameters.ambientStrength,0.6);
  assert.notDeepEqual(COMMON_RENDER_PROFILES[4].parameters.shadowColor,COMMON_RENDER_PROFILES[5].parameters.shadowColor);
});
test('catalogue source material remains available without letting data replace core presets',()=>{
  const result=commonIndexedProfiles([{id:'material',mode:'toon',parameters:{bands:2},implemented:false,status:'unavailable',description:'attempted collision'},
    {id:'toon',mode:'material',label:'attempted collision'},
    {id:'custom',mode:'material',label:'own optional profile'}]);
  assert.equal(result.length,7);
  assert.equal(result[0].label,'GLB 材质');
  assert.equal(result[0].mode,'material');
  assert.equal(result[0].implemented,true);
  assert.deepEqual(result[0].parameters,{});
  assert.equal(result[2].mode,'toon');
  assert.equal(result[6].id,'custom');
  result[1].parameters.baseTint[0]=0;
  assert.equal(COMMON_RENDER_PROFILES[1].parameters.baseTint[0],1);
});
