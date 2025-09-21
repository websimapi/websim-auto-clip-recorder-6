import { set as idbSet, get as idbGet } from "idb-keyval";

export async function saveClips(clips){
  try{
    await idbSet("auto-clip-clips", clips.map(c=>({ 
      ...c, 
      blob: undefined, 
      rawBlob: undefined, 
      blobUrl: c.blob ? URL.createObjectURL(c.blob) : null 
    })));
  }catch{}
}

export async function loadClips(){
  try{
    const saved = await idbGet("auto-clip-clips");
    if(Array.isArray(saved)){
      const restored = await Promise.all(saved.map(async s=>{
        if(s.composing) return { ...s, blob:null, composing:false };
        if(s.blobUrl){ 
          try{ 
            const blob=await fetch(s.blobUrl).then(r=>r.blob()); 
            return { ...s, blob, composing:false }; 
          }catch{ 
            return { ...s, blob:null, composing:false }; 
          } 
        }
        return { ...s, composing:false };
      }));
      return restored;
    }
  }catch{}
  return [];
}

