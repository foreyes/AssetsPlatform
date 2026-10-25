// Presentation only: never relax resource verification or retry denied requests.
export function describePreviewFailure(error){
 const seen=new Set();
 function isContextFailure(value,depth=0){
  if(!value||depth>3||seen.has(value))return false;seen.add(value);
  const message=typeof value.message==='string'?value.message:'';
  if(value.code==='WEBGL_CONTEXT_LOST'||/Error creating WebGL context|Could not create a WebGL context|WebGL 上下文已丢失|此浏览器无法使用 WebGL/i.test(message))return true;
  return isContextFailure(value.cause,depth+1)||(Array.isArray(value.errors)&&value.errors.slice(0,8).some(e=>isContextFailure(e,depth+1)));
 }
 if(isContextFailure(error))return{kind:'graphics-unavailable',title:'当前浏览器的 3D 渲染不可用',detail:'无法创建 WebGL 画面。仍可查看资源信息、选择物件和填写备注。',guidance:'可继续查看元数据和审阅记录，稍后在支持 WebGL 的浏览器中验证画面。'};
 return{kind:'preview-unavailable',title:'3D 预览暂未成功加载',detail:'本次模型读取或渲染失败，资源信息和审阅记录仍保留。',guidance:'请检查网络及访问权限后重新打开详情；不会自动切换来源或绕过校验。'};
}
export function showPreviewFailure(container,failure,document=globalThis.document){
 const note=document.createElement('p');note.className='resource-note';note.setAttribute('role','status');note.textContent=failure.title+'。'+failure.detail;container.append(note);
}
