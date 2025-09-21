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
};

let clips = [];

function fmtTime(ms){ const s = Math.round(ms/1000); return `${Math.floor(s/60)}:${String(s%60).padStart(2,"0")}`; }

async function getVideoDuration(blob){ return new Promise((resolve)=>{ const v=document.createElement('video'); v.preload='metadata'; v.onloadedmetadata=()=>{ URL.revokeObjectURL(v.src); resolve(v.duration*1000); }; v.onerror=()=>resolve(0); v.src=URL.createObjectURL(blob); }); }
async function makeThumb(blob){ return new Promise((res)=>{ const v=document.createElement("video"); v.src=URL.createObjectURL(blob); v.muted=true; v.addEventListener("loadeddata", ()=>{ v.currentTime=Math.min(0.25,(v.duration||1)*0.1); }, {once:true}); v.addEventListener("seeked", ()=>{ const c=document.createElement("canvas"); c.width=320; c.height=180; c.getContext("2d").drawImage(v,0,0,c.width,c.height); c.toBlob(b=>res(URL.createObjectURL(b)),"image/jpeg",0.7); URL.revokeObjectURL(v.src); }, {once:true}); }); }

function toggleComposeBtn(){ els.composeBtn.disabled = !(clips.some(c=>c.selected && !c.composing && c.blob)); }
function renderClips(){
  els.grid.innerHTML = "";
  clips.forEach((c, idx)=>{
    const card=document.createElement("div"); card.className="clip";
    const img=document.createElement("img"); img.className="thumb"; img.src=c.thumb||""; img.addEventListener('click',()=>{ if(c.blob){ els.modalVideo.src=URL.createObjectURL(c.blob); els.modalBackdrop.style.display='flex'; els.modalVideo.play().catch(()=>{});} });
    const info=document.createElement("div"); info.className="clip-info";
    const meta=document.createElement("div"); meta.className="meta"; meta.textContent=`Clip ${idx+1} • ${c.duration?fmtTime(c.duration):'--:--'} • ${new Date(c.createdAt).toLocaleTimeString()}`;
    const sel=document.createElement("label"); sel.className="sel";
    const cb=document.createElement("input"); cb.type="checkbox"; cb.checked=c.selected??true; cb.addEventListener("change",()=>{ c.selected=cb.checked; saveClips(clips); toggleComposeBtn(); });
    const dl=document.createElement("a"); dl.textContent="Download"; dl.href=c.blob?URL.createObjectURL(c.blob):'#'; if(!c.blob){ dl.style.pointerEvents='none'; dl.style.opacity='0.5'; } dl.download=`clip-${idx+1}-composed.webm`;
    sel.appendChild(cb); sel.appendChild(document.createTextNode("Select")); info.appendChild(meta); info.appendChild(sel);
    card.appendChild(img); card.appendChild(info);
    const actions=document.createElement("div"); actions.style.padding="0 10px 8px"; actions.appendChild(dl); card.appendChild(actions);
    if(c.composing){ const overlay=document.createElement('div'); overlay.className='composing-overlay'; overlay.textContent='Composing...'; card.appendChild(overlay); }
    els.grid.appendChild(card);
  });
  toggleComposeBtn();
}

const recorder = createRecorder({
  autoSplitOnCaptured: ()=>els.autoSplitCaptured.checked,
  onIframeNavSplit: ()=>els.autoSplit.checked,
  onNewRawClip: async (rawBlob)=>{
    const createdAt=Date.now();
    const thumb = await makeThumb(rawBlob);
    const clip={ id: createdAt+Math.random(), rawBlob, blob:null, createdAt, duration:0, thumb, selected:true, composing:true };
    clips.push(clip); renderClips(); saveClips(clips);
    try{
      const { composeClips } = await import("./composer.js");
      const outro = getSelectedOutro();
      const composedBlob = await composeClips([rawBlob], { outroSeconds:3, logoUrl:"/logowhite.png", outroAudio:outro.file, outroAudioRegion:outro.region||null, width:1280, height:720, fps:30 });
      const ref = clips.find(c=>c.id===clip.id); if(ref){ ref.blob=composedBlob; ref.composing=false; ref.duration=await getVideoDuration(composedBlob); renderClips(); saveClips(clips); }
    }catch(e){ console.error("Auto-composition failed", e); const ref=clips.find(c=>c.id===clip.id); if(ref){ ref.composing=false; ref.blob=rawBlob; renderClips(); saveClips(clips); } }
  }
});

function setupNavigator(){
  const go=()=>{ const url=els.navUrl.value.trim(); if(!url) return; const href=/^https?:\/\//i.test(url)?url:`https://${url}`; els.navigator.src=href; };
  els.navGo.addEventListener("click", go);
  els.navUrl.addEventListener("keydown",(e)=>{ if(e.key==="Enter") go(); });
  els.navigator.addEventListener("load", ()=>{ if(recorder.isRecording() && els.autoSplit.checked) recorder.split(); });
}

document.getElementById("btn-compose").addEventListener("click", async ()=>{
  const selected = clips.filter(c=>c.selected && c.blob && !c.composing);
  if(!selected.length) return;
  els.composeStatus.textContent="Composing..."; els.composeStatus.style.color=""; els.composeBtn.disabled=true;
  try{
    const { concatenateClips } = await import("./composer.js");
    const out = await concatenateClips(selected.map(c=>c.blob), { width:1280, height:720, fps:30 });
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