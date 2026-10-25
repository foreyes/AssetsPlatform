// A single clock for the two detail viewers. It never animates catalogue cards.
export function createPlaybackTimeline({onFrame=()=>{},onState=()=>{},requestFrame=callback=>requestAnimationFrame(callback),cancelFrame=id=>cancelAnimationFrame(id)}={}){
  let clips=[],selected=null,time=0,speed=1,playing=false,last=null,pending=null,generation=0,disposed=false,loopMode="source";
  const state=()=>({clipId:selected?.id||null,duration:selected?.duration||0,loop:loopMode==="repeat"||(loopMode==="source"&&!!selected?.loop),sourceLoop:!!selected?.loop,loopMode,time,speed,playing,available:clips.length>0});
  const emit=()=>{onFrame(state());onState(state())};
  const stopClock=()=>{generation++;if(pending!==null)cancelFrame(pending);pending=null;last=null};
  function schedule(){if(!playing||disposed||pending!==null)return;const expected=generation;pending=requestFrame(stamp=>{if(disposed||expected!==generation)return;pending=null;const current=Number(stamp);if(!Number.isFinite(current)){schedule();return}if(last!==null){const next=time+Math.max(0,current-last)/1000*speed;if(state().loop)time=next%selected.duration;else{time=Math.min(selected.duration,next);if(time>=selected.duration)playing=false}}last=current;emit();if(playing)schedule();else stopClock()})}
  function pause(){playing=false;stopClock();if(!disposed)onState(state())}
  return {
    configure(values){if(disposed)return;pause();clips=(Array.isArray(values)?values:[]).filter((clip,index,list)=>clip&&typeof clip.id==='string'&&clip.id&&Number.isFinite(clip.duration)&&clip.duration>0&&list.findIndex(other=>other?.id===clip.id)===index).map(clip=>({id:clip.id,duration:clip.duration,loop:clip.loop===true}));selected=clips[0]||null;time=0;speed=1;loopMode="source";emit();return state()},
    select(id){if(disposed)return false;const clip=clips.find(clip=>clip.id===id);if(!clip)return false;pause();selected=clip;time=0;emit();return true},
    play(){if(disposed||!selected||playing)return false;if(!state().loop&&time>=selected.duration)time=0;playing=true;last=null;emit();schedule();return true},
    pause,
    seek(value){if(disposed||!selected||!Number.isFinite(Number(value)))return false;time=Math.max(0,Math.min(selected.duration,Number(value)));stopClock();emit();schedule();return true},
    setSpeed(value){const candidate=Number(value);if(disposed||!Number.isFinite(candidate)||candidate<0.1||candidate>2)return false;speed=candidate;last=null;onState(state());return true},
    setLoopMode(value){if(disposed||!["source","once","repeat"].includes(value))return false;loopMode=value;onState(state());return true},
    getState:state,
    dispose(){if(disposed)return;pause();disposed=true;clips=[];selected=null}
  }
}
