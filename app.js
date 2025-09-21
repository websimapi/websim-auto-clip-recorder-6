/* ...existing code... */
import { saveClips, loadClips } from './storage.js';
import { initOutroSelector, getSelectedOutro } from './outroSelector.js';
import { createRecorder } from './recorder.js';

const els = {
  pick: document.getElementById("btn-pick-tab"),
  start: document.getElementById("btn-start"),
  stop: document.getElementById("btn-stop"),
  split: document.getElementById("btn-split"),
  grid: document.getElementById("clips-grid"),
  navUrl: document.getElementById("nav-url"),
  navGo: document.getElementById("nav-go"),
  autoSplit: document.getElementById("auto-split-on-nav"),
  navigator: document.getElementById("navigator"),
  composeBtn: document.getElementById("btn-compose"),
  composeStatus: document.getElementById("compose-status"),
  autoSplitCaptured: document.getElementById("auto-split-captured"),
  modalBackdrop: document.getElementById('modal-backdrop'),
  modalVideo: document.getElementById('modal-video'),
  modalClose: document.getElementById('modal-close'),
  outroGrid: document.getElementById('outro-audio-grid'),
  editModal: {
    backdrop: document.getElementById('edit-modal-backdrop'),
    video: document.getElementById('edit-modal-video'),
    sliderContainer: document.getElementById('trim-slider-container'),
    startTime: document.getElementById('trim-start-time'),
    endTime: document.getElementById('trim-end-time'),
    duration: document.getElementById('trim-duration'),
    cancel: document.getElementById('edit-modal-cancel'),
    save: document.getElementById('edit-modal-save'),
  }
};

let clips = [];
let sessionChunks = []; // Store chunks for the current recording session

function fmtTime(ms){ const s = Math.round(ms/1000); return `${String(Math.floor(s/60)).padStart(2,"0")}:${String(s%60).padStart(2,"0")}`; }

async function getVideoDuration(blob){ return new Promise((resolve)=>{ const v=document.createElement('video'); v.preload='metadata'; v.onloadedmetadata=()=>{ URL.revokeObjectURL(v.src); resolve(v.duration*1000); }; v.onerror=()=>resolve(0); v.src=URL.createObjectURL(blob); }); }
async function makeThumb(blob){ return new Promise((res)=>{ const v=document.createElement("video"); v.src=URL.createObjectURL(blob); v.muted=true; v.addEventListener("loadeddata", ()=>{ v.currentTime=Math.min(0.25,(v.duration||1)*0.1); }, {once:true}); v.addEventListener("seeked", ()=>{ const c=document.createElement("canvas"); c.width=320; c.height=180; c.getContext("2d").drawImage(v,0,0,c.width,c.height); c.toBlob(b=>res(URL.createObjectURL(b)),"image/jpeg",0.7); URL.revokeObjectURL(v.src); }, {once:true}); }); }

function getClipBlob(clip) {
  if (clip.blob) return clip.blob;
  // This logic is for clips derived from a session recording
  if (clip.sessionChunks && typeof clip.startChunk !== 'undefined' && typeof clip.endChunk !== 'undefined') {
    const chunks = clip.sessionChunks.slice(clip.startChunk, clip.endChunk + 1);
    if (chunks.length > 0) {
      return new Blob(chunks, { type: "video/webm" });
    }
  }
  return null;
}

function toggleComposeBtn(){ els.composeBtn.disabled = !(clips.some(c=>c.selected && !c.composing && getClipBlob(c))); }

function renderClips(){
  els.grid.innerHTML = "";
  clips.forEach((c, idx)=>{
    const card=document.createElement("div"); card.className="clip";
    const img=document.createElement("img"); img.className="thumb"; img.src=c.thumb||"";
    const clipBlob = getClipBlob(c);
    if (clipBlob) {
      img.addEventListener('click',()=>{ 
        els.modalVideo.src=URL.createObjectURL(clipBlob); 
        els.modalBackdrop.style.display='flex'; 
        els.modalVideo.play().catch(()=>{});
      });
    }

    const info=document.createElement("div"); info.className="clip-info";
    const meta=document.createElement("div"); meta.className="meta"; meta.textContent=`Clip ${idx+1} • ${c.duration?fmtTime(c.duration):'--:--'} • ${new Date(c.createdAt).toLocaleTimeString()}`;
    const sel=document.createElement("label"); sel.className="sel";
    const cb=document.createElement("input"); cb.type="checkbox"; cb.checked=c.selected??true; cb.addEventListener("change",()=>{ c.selected=cb.checked; saveClips(clips); toggleComposeBtn(); });
    sel.appendChild(cb); sel.appendChild(document.createTextNode("Select")); info.appendChild(meta); info.appendChild(sel);
    
    card.appendChild(img); card.appendChild(info);

    const actions=document.createElement("div"); actions.style.padding="0 10px 8px"; actions.style.display="flex"; actions.style.gap="10px";
    
    const dl=document.createElement("a"); dl.textContent="Download";
    if(clipBlob){ dl.href=URL.createObjectURL(clipBlob); } else { dl.href='#'; dl.style.pointerEvents='none'; dl.style.opacity='0.5'; }
    dl.download=`clip-${idx+1}-composed.webm`;
    actions.appendChild(dl);

    if (c.sessionChunks) {
      const editBtn = document.createElement("button");
      editBtn.textContent = "Edit";
      editBtn.onclick = () => openClipEditor(c);
      actions.appendChild(editBtn);
    }
    
    card.appendChild(actions);

    if(c.composing){ const overlay=document.createElement('div'); overlay.className='composing-overlay'; overlay.textContent='Composing...'; card.appendChild(overlay); }
    els.grid.appendChild(card);
  });
  toggleComposeBtn();
}

const recorder = createRecorder({
  autoSplitOnCaptured: ()=>els.autoSplitCaptured.checked,
  onIframeNavSplit: ()=>els.autoSplit.checked,
  onSessionFinished: async ({ chunks, markers }) => {
    sessionChunks = chunks;
    const allMarkers = [0, ...markers, chunks.length];
    
    for (let i = 0; i < allMarkers.length - 1; i++) {
        const startChunk = allMarkers[i];
        const endChunk = allMarkers[i+1] - 1;
        if (startChunk > endChunk) continue;

        const createdAt=Date.now();
        const rawBlob = new Blob(chunks.slice(startChunk, endChunk + 1), { type: 'video/webm' });
        
        const thumb = await makeThumb(rawBlob);
        const clip={ id: createdAt+Math.random(), rawBlob, blob:null, createdAt, duration:0, thumb, selected:true, composing:true, sessionChunks, startChunk, endChunk, originalStartChunk: startChunk, originalEndChunk: endChunk };
        clips.push(clip); 
        renderClips(); 
        saveClips(clips); // Note: sessionChunks won't be saved, editing is session-only for now.
        
        try{
          const { composeClips } = await import("./composer.js");
          const outro = getSelectedOutro();
          const composedBlob = await composeClips([rawBlob], { outroSeconds:3, logoUrl:"/logowhite.png", outroAudio:outro.file, outroAudioRegion:outro.region||null, width:1280, height:720, fps:30 });
          const ref = clips.find(c=>c.id===clip.id); if(ref){ ref.blob=composedBlob; ref.composing=false; ref.duration=await getVideoDuration(composedBlob); renderClips(); saveClips(clips); }
        }catch(e){ console.error("Auto-composition failed", e); const ref=clips.find(c=>c.id===clip.id); if(ref){ ref.composing=false; ref.blob=rawBlob; ref.duration = await getVideoDuration(rawBlob); renderClips(); saveClips(clips); } }
    }
  }
});

function openClipEditor(clip) {
  // Not implemented yet
  alert("Clip editor is not fully implemented yet, but the foundation is here!");
}

function setupNavigator(){
  const go=()=>{ const url=els.navUrl.value.trim(); if(!url) return; const href=/^https?:\/\//i.test(url)?url:`https://${url}`; els.navigator.src=href; };
  els.navGo.addEventListener("click", go);
  els.navUrl.addEventListener("keydown",(e)=>{ if(e.key==="Enter") go(); });
  els.navigator.addEventListener("load", ()=>{ if(recorder.isRecording() && els.autoSplit.checked) recorder.split(); });
}

document.getElementById("btn-compose").addEventListener("click", async ()=>{
  const selected = clips.filter(c=>c.selected && !c.composing).map(c => getClipBlob(c)).filter(Boolean);
  if(!selected.length) return;
  els.composeStatus.textContent="Composing..."; els.composeStatus.style.color=""; els.composeBtn.disabled=true;
  try{
    const { concatenateClips } = await import("./composer.js");
    const out = await concatenateClips(selected, { width:1280, height:720, fps:30 });
    const url=URL.createObjectURL(out);
    const prev=document.getElementById("final-preview"); prev.src=url; prev.play().catch(()=>{});
    const a=document.getElementById("download-link"); a.href=url; a.style.display="inline-block";
    els.composeStatus.textContent="Done.";
  }catch(e){ console.error(e); els.composeStatus.textContent="Failed."; els.composeStatus.style.color="crimson"; alert("Composition failed. See console for details."); }
  finally{ els.composeBtn.disabled=false; }
});

els.pick.addEventListener("click", recorder.pickTab);
els.start.addEventListener("click", recorder.start);
els.split.addEventListener("click", recorder.split);
els.stop.addEventListener("click", recorder.stop);

els.modalClose.addEventListener('click', ()=>{ els.modalBackdrop.style.display='none'; els.modalVideo.pause(); els.modalVideo.src=''; });
els.modalBackdrop.addEventListener('click',(e)=>{ if(e.target===els.modalBackdrop) els.modalClose.click(); });

setupNavigator();
initOutroSelector(els.outroGrid);
loadClips().then(restored=>{ clips = restored; renderClips(); });