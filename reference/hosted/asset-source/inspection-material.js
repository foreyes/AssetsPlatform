import * as THREE from './vendor/three.module.js';

// Keep Three's skinning/morph/UV/alpha chunks. Only replace preview lighting.
export function createInspectionMaterial(parameters, mode, style) {
  const material = new THREE.MeshStandardMaterial(parameters);
  material.toneMapped = false;
  material.onBeforeCompile = shader => {
    const vector = key => new THREE.Vector3(...style[key]);
    Object.assign(shader.uniforms, {
      inspectLight:{value:vector('lightDirection')}, inspectAmbientColor:{value:vector('ambientColor')},
      inspectKeyColor:{value:vector('keyLightColor')}, inspectShadow:{value:vector('shadowColor')},
      inspectTint:{value:vector('baseTint')}, inspectAmbient:{value:style.ambientStrength},
      inspectKey:{value:style.keyLightStrength}, inspectBands:{value:style.bands},
      inspectThreshold:{value:style.lightThreshold}, inspectSaturation:{value:style.saturation},
      inspectContrast:{value:style.contrast},
    });
    shader.fragmentShader = `uniform vec3 inspectLight,inspectAmbientColor,inspectKeyColor,inspectShadow,inspectTint;
uniform float inspectAmbient,inspectKey,inspectBands,inspectThreshold,inspectSaturation,inspectContrast;
` + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', `
float inspectNdl=max(dot(normalize(normal),normalize(inspectLight)),0.0);
float inspectBand=inspectNdl;
${mode==='toon'?'float inspectSteps=max(inspectBands-1.0,1.0);inspectBand=clamp(floor(inspectNdl*inspectSteps+1.0-inspectThreshold)/inspectSteps,0.0,1.0);':''}
vec3 inspectAlbedo=${mode==='clay'?'vec3(0.42,0.46,0.43)':'diffuseColor.rgb'}*inspectTint;
vec3 inspectLighting=inspectAmbientColor*inspectAmbient+mix(inspectShadow,inspectKeyColor,inspectBand)*inspectKey;
outgoingLight=inspectAlbedo*inspectLighting;
${mode==='soft'?`vec3 inspectHalf=normalize(normalize(inspectLight)+normalize(vViewPosition));
float inspectExponent=clamp(2.0/(max(0.04,roughnessFactor)*max(0.04,roughnessFactor))-2.0,1.0,128.0);
vec3 inspectF0=mix(vec3(0.04),inspectAlbedo,metalnessFactor);
outgoingLight=inspectAlbedo*inspectLighting*(1.0-metalnessFactor*0.6)+inspectF0*pow(max(dot(normal,inspectHalf),0.0),inspectExponent)*inspectNdl*inspectKey*inspectKeyColor;`:''}
${mode!=='clay'?'outgoingLight+=totalEmissiveRadiance;':''}
#include <opaque_fragment>`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <colorspace_fragment>', `#include <colorspace_fragment>
float inspectGrey=dot(gl_FragColor.rgb,vec3(0.2126,0.7152,0.0722));
gl_FragColor.rgb=clamp((mix(vec3(inspectGrey),gl_FragColor.rgb,inspectSaturation)-0.5)*inspectContrast+0.5,0.0,1.0);`);
  };
  material.customProgramCacheKey = () => 'asset-review-inspection/v1/'+mode;
  return material;
}
