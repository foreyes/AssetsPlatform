// The public snapshot omits generated renderer dependencies. Publication
// fixtures use the canonical resolver and exercise JSON only.
const stub = source => ({url: 'data:text/javascript,' + encodeURIComponent(source), shortCircuit: true});

export function resolve(specifier, context, next) {
  if (context.parentURL?.endsWith('/manifest.mjs')) {
    if (specifier.endsWith('/shared/resource-url.mjs')) {
      return next(new URL('../review-frontend/shared/resource-url.mjs', import.meta.url).href, context);
    }
    if (specifier.endsWith('/model-resource.js')) {
      return stub('export const validateSelfContainedGLB = () => {throw Error("GLB outside test scope")}; export const enforceThumbnailBudget = validateSelfContainedGLB, retireModel = validateSelfContainedGLB;');
    }
    if (specifier.endsWith('/GLTFLoader.js')) return stub('export class GLTFLoader {}');
    if (specifier.endsWith('/three.module.js')) return stub('export class Texture {}');
  }
  if (specifier.endsWith('/entity-supplemental-pins.mjs')) {
    return stub('export const supplementalPin=()=>null, supplementalRoot=()=>{throw Error("No synthetic supplemental pins")};');
  }
  return next(specifier, context);
}
