/* ...existing code... */
import { composeClips, concatenateClips } from './composer.js';
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
    sliderTrack: document.getElementById('trim-slider-track'),
    thumbStart: document.getElementById('trim-slider-thumb-start'),
    thumbEnd: document.getElementById('trim-slider-thumb-end'),
    startTime: document.getElementById('trim-start-time'),
    endTime: document.getElementById('trim-end-time'),
    duration: document.getElementById('trim-duration'),
    cancel: document.getElementById('edit-modal-cancel'),
    save: document.getElementById('edit-modal-save'),
  }
};

let clips = [];
let sessionChunks = []; // Store chunks for the current recording session
let sessionBlob = null; // A blob of the entire session for editing

function fmtTime(s_in){ const s = Math.round(s_in); return `${String(Math.floor(s/60)).padStart(2,"0")}:${String(s%60).padStart(2,"0")}`; }

async function getVideoDuration(blob){ return new Promise((resolve)=>{ const v=document.createElement('video'); v.preload='metadata'; v.onloadedmetadata=()=>{ URL.revokeObjectURL(v.src); resolve(v.duration); }; v.onerror=()=>resolve(0); v.src=URL.createObjectURL(blob); }); }
async function makeThumb(blob){ return new Promise((res)=>{ const v=document.createElement("video"); v.src=URL.createObjectURL(blob); v.muted=true; v.addEventListener("loadeddata", ()=>{ v.currentTime=Math.min(0.25,(v.duration||1)*0.1); }, {once:true}); v.addEventListener("seeked", ()=>{ const c=document.createElement("canvas"); c.width=320; c.height=180; c.getContext("2d").drawImage(v,0,0,c.width,c.height); c.toBlob(b=>res(URL.createObjectURL(b)),"image/jpeg",0.7); URL.revokeObjectURL(v.src); }, {once:true}); }); }

function getClipBlob(clip) {
  if (clip.blob) return clip.blob;
  // This logic is for clips derived from a session recording that haven't been composed yet.
  if (clip.rawBlob) return clip.rawBlob;
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

    if (c.rawBlob) { // Only show edit button for clips that can be edited (from current session)
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
    sessionBlob = new Blob(chunks, { type: 'video/webm' });
    const allMarkers = [0, ...markers, chunks.length];
    
    for (let i = 0; i < allMarkers.length - 1; i++) {
        const startChunk = allMarkers[i];
        const endChunk = allMarkers[i+1];
        if (startChunk >= endChunk) continue;

        const createdAt=Date.now();
        const rawBlob = new Blob(chunks.slice(startChunk, endChunk), { type: 'video/webm' });
        
        const thumb = await makeThumb(rawBlob);
        const clip={ id: createdAt+Math.random(), rawBlob, blob:null, createdAt, duration:0, thumb, selected:true, composing:true, startChunk, endChunk };
        clips.push(clip); 
        renderClips(); 
        saveClips(clips);
        
        try{
          const { composeClips } = await import("./composer.js");
          const outro = getSelectedOutro();
          const composedBlob = await composeClips([rawBlob], { outroSeconds:3, logoUrl:"/logowhite.png", outroAudio:outro.file, outroAudioRegion:outro.region||null, width:1280, height:720, fps:30 });
          const ref = clips.find(c=>c.id===clip.id); if(ref){ ref.blob=composedBlob; ref.composing=false; ref.duration=await getVideoDuration(composedBlob); renderClips(); saveClips(clips); }
        }catch(e){ console.error("Auto-composition failed", e); const ref=clips.find(c=>c.id===clip.id); if(ref){ ref.composing=false; ref.blob=ref.rawBlob; ref.duration = await getVideoDuration(ref.rawBlob); renderClips(); saveClips(clips); } }
    }
  }
});

let activeEditClip = null;
let sessionChunkTimestamps = [];

async function calculateChunkTimestamps() {
    if (sessionChunkTimestamps.length > 0) return;
    const tempVideo = document.createElement('video');
    tempVideo.src = URL.createObjectURL(sessionBlob);
    await new Promise(res => tempVideo.onloadedmetadata = res);
    const duration = tempVideo.duration;
    URL.revokeObjectURL(tempVideo.src);

    const chunkCount = sessionChunks.length;
    // This is an approximation. A more accurate method would require parsing the webm file.
    for (let i = 0; i < chunkCount; i++) {
        sessionChunkTimestamps.push((i / chunkCount) * duration);
    }
}

async function openClipEditor(clip) {
    if (!sessionBlob) {
        alert("Session data is not available for editing. Please edit clips before refreshing the page.");
        return;
    }
    activeEditClip = clip;
    await calculateChunkTimestamps();
    
    const { video, backdrop, sliderContainer, thumbStart, thumbEnd, sliderTrack, startTime, endTime, duration, save, cancel } = els.editModal;

    const sessionDuration = sessionChunkTimestamps[sessionChunkTimestamps.length - 1] || (await getVideoDuration(sessionBlob));
    video.src = URL.createObjectURL(sessionBlob);
    video.load();

    let startPercent = (clip.startChunk / sessionChunks.length) * 100;
    let endPercent = (clip.endChunk / sessionChunks.length) * 100;
    
    const updateUI = () => {
        thumbStart.style.left = `${startPercent}%`;
        thumbEnd.style.left = `${endPercent}%`;
        sliderTrack.style.left = `${startPercent}%`;
        sliderTrack.style.width = `${endPercent - startPercent}%`;

        const startTimeSec = (startPercent / 100) * sessionDuration;
        const endTimeSec = (endPercent / 100) * sessionDuration;

        startTime.textContent = fmtTime(startTimeSec);
        endTime.textContent = fmtTime(endTimeSec);
        duration.textContent = fmtTime(endTimeSec - startTimeSec);
        
        if (video.paused) {
            video.currentTime = startTimeSec;
        }
    };
    
    video.ontimeupdate = () => {
        const startTimeSec = (startPercent / 100) * sessionDuration;
        const endTimeSec = (endPercent / 100) * sessionDuration;
        if (video.currentTime < startTimeSec || video.currentTime > endTimeSec) {
            video.currentTime = startTimeSec;
            video.play().catch(()=>{});
        }
    };

    let activeThumb = null;
    const sliderRect = sliderContainer.getBoundingClientRect();

    const onPointerMove = (e) => {
        if (!activeThumb) return;
        let p = ((e.clientX - sliderRect.left) / sliderRect.width) * 100;
        p = Math.max(0, Math.min(100, p));

        if (activeThumb === thumbStart) {
            startPercent = Math.min(p, endPercent);
        } else {
            endPercent = Math.max(p, startPercent);
        }
        updateUI();
    };

    const onPointerUp = () => {
        activeThumb = null;
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
    };

    const makePointerDown = (thumb) => (e) => {
        e.preventDefault();
        activeThumb = thumb;
        window.addEventListener('pointermove', onPointerMove);
        window.addEventListener('pointerup', onPointerUp);
    };

    thumbStart.onpointerdown = makePointerDown(thumbStart);
    thumbEnd.onpointerdown = makePointerDown(thumbEnd);
    
    const closeEditor = () => {
        activeEditClip = null;
        video.pause();
        URL.revokeObjectURL(video.src);
        video.src = "";
        backdrop.style.display = 'none';
        thumbStart.onpointerdown = null;
        thumbEnd.onpointerdown = null;
    };

    save.onclick = async () => {
        const newStartChunk = Math.floor((startPercent / 100) * sessionChunks.length);
        const newEndChunk = Math.ceil((endPercent / 100) * sessionChunks.length);
        
        if (newStartChunk !== activeEditClip.startChunk || newEndChunk !== activeEditClip.endChunk) {
            activeEditClip.startChunk = newStartChunk;
            activeEditClip.endChunk = newEndChunk;

            // Re-create rawBlob and re-compose
            activeEditClip.composing = true;
            renderClips();

            const newRawBlob = new Blob(sessionChunks.slice(newStartChunk, newEndChunk), { type: 'video/webm' });
            activeEditClip.rawBlob = newRawBlob;
            
            try {
                const outro = getSelectedOutro();
                const composedBlob = await composeClips([newRawBlob], { outroSeconds:3, logoUrl:"/logowhite.png", outroAudio:outro.file, outroAudioRegion:outro.region||null, width:1280, height:720, fps:30 });
                activeEditClip.blob = composedBlob;
                activeEditClip.duration = await getVideoDuration(composedBlob);
                activeEditClip.thumb = await makeThumb(composedBlob);
            } catch(e) {
                console.error("Re-composition failed", e);
                activeEditClip.blob = newRawBlob;
                activeEditClip.duration = await getVideoDuration(newRawBlob);
                activeEditClip.thumb = await makeThumb(newRawBlob);
            }
            activeEditClip.composing = false;
            saveClips(clips);
            renderClips();
        }
        closeEditor();
    };
    
    cancel.onclick = closeEditor;

    backdrop.style.display = 'flex';
    updateUI();
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