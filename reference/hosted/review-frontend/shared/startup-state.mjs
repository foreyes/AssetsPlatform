// Fail visibly before the canonical controller is initialized. Never change auth,
// project selection, stored reviews or resource policy to recover a failed boot.
export function showStartupFailure({document=globalThis.document,reload=()=>globalThis.location.reload()}={}){
 if(!document||document.getElementById('startup-error'))return;
 const host=document.getElementById('grid')||document.querySelector('main')||document.body;
 const summary=document.getElementById('result-description');
 if(summary)summary.textContent='资产工作区未能启动';
 for(const control of document.querySelectorAll('button,input,select'))control.disabled=true;
 const panel=document.createElement('section');panel.id='startup-error';panel.className='empty-state';panel.setAttribute('role','alert');panel.setAttribute('style','grid-column: 1 / -1; padding: 1.5rem;');
 const title=document.createElement('h2');title.textContent='暂时无法打开资产工作区';
 const message=document.createElement('p');message.textContent='项目配置或预览模块未能加载。请检查网络和当前账号的访问权限后重试；这不表示资产已丢失。';
 const note=document.createElement('p');note.textContent='审阅记录未被清除，不会自动切换项目或放宽访问权限。';
 const retry=document.createElement('button');retry.type='button';retry.className='light-btn';retry.textContent='重新加载当前项目';
 retry.addEventListener('click',()=>{if(retry.disabled)return;retry.disabled=true;retry.textContent='正在重新加载…';reload();});
 panel.append(title,message,note,retry);host.replaceChildren(panel);retry.focus();
}
export async function guardStartup(operation,options){
 try{return await operation();}catch(error){showStartupFailure(options);throw error;}
}
