/* A Rainy Day in the Temple — shared sound, rain, haptics, phone shake, ink and toss physics. */
(function(){
const T = window.Temple = {};
const R = T.R = (a,b) => a + Math.random()*(b-a);
T.reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
T.rand = () => { try{ const a=new Uint32Array(1); crypto.getRandomValues(a); return a[0]/4294967296; }catch(e){ return Math.random(); } };
T.rbit = () => T.rand() < .5 ? 1 : 0;
T.buzz = p => { try{ navigator.vibrate && navigator.vibrate(p); }catch(e){} };
const load = (k,d) => { try{ const v=localStorage.getItem("temple."+k); return v===null?d:JSON.parse(v); }catch(e){ return d; } };
const save = (k,v) => { try{ localStorage.setItem("temple."+k, JSON.stringify(v)); }catch(e){} };

/* ---------------- shared SVG defs (copper, lacquer, ink) ---------------- */
const injectDefs = () => {
  if(document.getElementById("t-defs")) return;
  const d = document.createElement("div");
  d.innerHTML = `<svg id="t-defs" width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
    <radialGradient id="cu" cx="36%" cy="30%" r="80%"><stop offset="0" stop-color="#c8a272"/><stop offset=".35" stop-color="#a27d4f"/><stop offset=".75" stop-color="#735638"/><stop offset="1" stop-color="#4c3923"/></radialGradient>
    <radialGradient id="cuB" cx="62%" cy="70%" r="85%"><stop offset="0" stop-color="#b58f60"/><stop offset=".45" stop-color="#8e6c44"/><stop offset=".85" stop-color="#5f4730"/><stop offset="1" stop-color="#45341f"/></radialGradient>
    <linearGradient id="rim" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e2c194"/><stop offset=".45" stop-color="#9a7448"/><stop offset="1" stop-color="#3d2d1b"/></linearGradient>
    <radialGradient id="spec" cx="32%" cy="26%" r="45%"><stop offset="0" stop-color="#fff6e6" stop-opacity=".55"/><stop offset="1" stop-color="#fff6e6" stop-opacity="0"/></radialGradient>
    <linearGradient id="brass" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f0d792"/><stop offset=".5" stop-color="#c49a45"/><stop offset="1" stop-color="#7d5d22"/></linearGradient>
    <linearGradient id="bronze" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#3a3026"/><stop offset=".3" stop-color="#7a6447"/><stop offset=".5" stop-color="#9c8461"/><stop offset=".75" stop-color="#5a4a37"/><stop offset="1" stop-color="#2c241c"/></linearGradient>
    <radialGradient id="lacq" cx="40%" cy="30%" r="85%"><stop offset="0" stop-color="#c2483a"/><stop offset=".5" stop-color="#97291f"/><stop offset="1" stop-color="#5a1410"/></radialGradient>
    <linearGradient id="lacqFlat" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#a6372b"/><stop offset="1" stop-color="#7a2018"/></linearGradient>
    <radialGradient id="gloss" cx="35%" cy="20%" r="55%"><stop offset="0" stop-color="#fff" stop-opacity=".55"/><stop offset=".5" stop-color="#fff" stop-opacity=".08"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
    <filter id="patina" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".09" numOctaves="3" seed="4" result="t"/><feColorMatrix in="t" values="0 0 0 0 .40  0 0 0 0 .48  0 0 0 0 .40  0 0 0 2.6 -1.35" result="p"/><feComposite in="p" in2="SourceAlpha" operator="in"/></filter>
    <filter id="wear" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="1.6" numOctaves="2" seed="9" result="t"/><feColorMatrix in="t" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1.4 -.55" result="p"/><feComposite in="p" in2="SourceAlpha" operator="in"/></filter>
    <filter id="rough" x="-5%" y="-40%" width="110%" height="180%"><feTurbulence type="fractalNoise" baseFrequency=".8" numOctaves="2" seed="3"/><feDisplacementMap in="SourceGraphic" scale="1.8"/></filter>
    <filter id="inkbleed" x="-5%" y="-5%" width="110%" height="110%"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" seed="8"/><feDisplacementMap in="SourceGraphic" scale="1.1"/></filter>
  </defs></svg>`;
  document.body.prepend(d.firstChild);
};
if(document.body) injectDefs(); else document.addEventListener("DOMContentLoaded", injectDefs);

/* ---------------- sound ---------------- */
const S = T.snd = { on: load("sound", true), ctx:null, bufs:{} };
function audio(){
  if(S.ctx) return S.ctx;
  const c = S.ctx = new (window.AudioContext||window.webkitAudioContext)();
  S.master = c.createGain(); S.master.gain.value = S.on?1:0; S.master.connect(c.destination);
  const len = c.sampleRate*2.6, ir = c.createBuffer(2,len,c.sampleRate);
  for(let ch=0;ch<2;ch++){ const d=ir.getChannelData(ch); for(let i=0;i<len;i++){ const t=i/len; d[i]=(Math.random()*2-1)*Math.pow(1-t,3.2)*(i<c.sampleRate*.012?.2:1); } }
  S.verb = c.createConvolver(); S.verb.buffer = ir;
  S.wet = c.createGain(); S.wet.gain.value = .3; S.verb.connect(S.wet).connect(S.master);
  S.dry = c.createGain(); S.dry.connect(S.master); S.dry.connect(S.verb);
  rainSound();
  return c;
}
T.wake = () => { if(S.on) audio(); if(S.ctx && S.ctx.state==="suspended") S.ctx.resume(); };
addEventListener("pointerdown", T.wake, {passive:true});
addEventListener("keydown", T.wake);
function nb(sec){ const k=sec.toFixed(2); if(S.bufs[k]) return S.bufs[k]; const c=S.ctx,b=c.createBuffer(1,Math.max(1,c.sampleRate*sec|0),c.sampleRate),d=b.getChannelData(0); for(let i=0;i<d.length;i++) d[i]=Math.random()*2-1; return S.bufs[k]=b; }
function noise({dur=.05,type="bandpass",f=1000,q=1,vol=.2,attack=.001,at=0,out}){
  const c=S.ctx,t=c.currentTime+at,s=c.createBufferSource(); s.buffer=nb(Math.max(.02,dur+.02));
  const fl=c.createBiquadFilter(); fl.type=type; fl.frequency.value=f; fl.Q.value=q;
  const g=c.createGain(); g.gain.setValueAtTime(0,t); g.gain.linearRampToValueAtTime(vol,t+attack); g.gain.exponentialRampToValueAtTime(.0001,t+dur);
  s.connect(fl).connect(g).connect(out||S.dry); s.start(t); s.stop(t+dur+.05); return {fl,g,t};
}
function modal(f0,parts,vol,at=0){
  const c=S.ctx,t=c.currentTime+at;
  parts.forEach(([r,a,d])=>{ const o=c.createOscillator(),g=c.createGain(); o.frequency.value=f0*r*R(.996,1.004);
    g.gain.setValueAtTime(0,t); g.gain.linearRampToValueAtTime(vol*a,t+.0015); g.gain.exponentialRampToValueAtTime(.0001,t+d*R(.75,1.2));
    o.connect(g).connect(S.dry); o.start(t); o.stop(t+d*1.3+.05); });
}
const ok = () => S.ctx && S.on;
T.sfx = {
  clink(vol=.5,pitch=1){ if(!ok())return; modal(R(2200,3300)*pitch,[[1,1,.55],[2.32,.45,.32],[4.25,.28,.18],[6.63,.14,.1],[9.1,.07,.06]],vol*.16); noise({dur:.015,f:7000,q:1.2,vol:vol*.12}); },
  thud(vol=.5,surface="felt"){ if(!ok())return; const c=S.ctx,t=c.currentTime;
    const f = surface==="stone"?1600:surface==="wood"?1000:650;
    noise({dur:surface==="stone"?.05:.07,type:"lowpass",f,vol:vol*.5});
    const o=c.createOscillator(),g=c.createGain(); o.frequency.setValueAtTime(surface==="stone"?260:170,t); o.frequency.exponentialRampToValueAtTime(70,t+.09);
    g.gain.setValueAtTime(vol*.35,t); g.gain.exponentialRampToValueAtTime(.0001,t+.1); o.connect(g).connect(S.dry); o.start(t); o.stop(t+.12); },
  wood(vol=.5,pitch=1,at=0){ if(!ok())return; modal(R(520,860)*pitch,[[1,1,.11],[2.76,.4,.06],[5.4,.16,.035]],vol*.3,at); noise({dur:.012,f:2600,q:.9,vol:vol*.18,at}); },
  bamboo(vol=.5,pitch=1,at=0){ if(!ok())return; modal(R(900,1400)*pitch,[[1,1,.08],[2.4,.5,.05],[3.9,.25,.03]],vol*.28,at); noise({dur:.01,f:3800,q:1,vol:vol*.15,at}); },
  bowl(f=196,vol=.09){ if(!ok())return; const c=S.ctx,t=c.currentTime+.2;
    [[1,1],[2.71,.4],[5.1,.18]].forEach(([r,a])=>{ const o=c.createOscillator(),g=c.createGain(); o.frequency.value=f*r; g.gain.setValueAtTime(0,t); g.gain.linearRampToValueAtTime(vol*a,t+.02); g.gain.exponentialRampToValueAtTime(.0001,t+5.5); o.connect(g).connect(S.dry); o.start(t); o.stop(t+6); }); },
  brush(){ if(!ok())return; noise({dur:.5,f:3200,q:.6,vol:.05,attack:.06}); },
  paper(dur=.5,vol=.07){ if(!ok())return; const n=noise({dur,type:"highpass",f:2600,q:.5,vol,attack:.02});
    for(let i=0;i<14;i++) n.g.gain.setValueAtTime(vol*R(.2,1),n.t+.02+i*(dur/16)); },
  strike(){ if(!ok())return; noise({dur:.18,f:3000,q:.7,vol:.12,attack:.005}); for(let i=0;i<6;i++) noise({dur:.02,f:R(2000,6000),q:3,vol:R(.02,.06),at:.05+i*R(.03,.08)}); },
  water(dur=1.1){ if(!ok())return; const n=noise({dur,f:700,q:.9,vol:.16,attack:.08}); n.fl.frequency.linearRampToValueAtTime(1300,n.t+dur*.6);
    const c=S.ctx; for(let i=0;i<9;i++){ const t=c.currentTime+R(.1,dur),o=c.createOscillator(),g=c.createGain(); o.frequency.setValueAtTime(R(300,500),t); o.frequency.exponentialRampToValueAtTime(R(900,1600),t+.06);
      g.gain.setValueAtTime(0,t); g.gain.linearRampToValueAtTime(R(.015,.04),t+.005); g.gain.exponentialRampToValueAtTime(.0001,t+.07); o.connect(g).connect(S.dry); o.start(t); o.stop(t+.1); } },
  clap(){ if(!ok())return; noise({dur:.06,f:1300,q:.7,vol:.7,attack:.001}); noise({dur:.03,type:"highpass",f:2500,q:.5,vol:.25}); },
  bell(){ if(!ok())return; for(let i=0;i<10;i++){ modal(R(3100,4300),[[1,1,.3],[1.52,.5,.2],[2.33,.25,.12]],.035,R(0,.45)); } },
  slide(){ if(!ok())return; noise({dur:.32,type:"lowpass",f:900,q:.4,vol:.18,attack:.12}); T.sfx.wood(.4,.7,.3); },
  match(){ if(!ok())return; T.sfx.strike(); }
};
function rainSound(){
  const c=S.ctx, src=c.createBufferSource(); src.buffer=nb(5); src.loop=true;
  const hp=c.createBiquadFilter(); hp.type="highpass"; hp.frequency.value=350;
  const lp=c.createBiquadFilter(); lp.type="lowpass"; lp.frequency.value=2600;
  const g=c.createGain(); g.gain.value=0; g.gain.setTargetAtTime(.07,c.currentTime,1.5);
  const lfo=c.createOscillator(),lg=c.createGain(); lfo.frequency.value=.07; lg.gain.value=.022; lfo.connect(lg).connect(g.gain); lfo.start();
  src.connect(hp).connect(lp).connect(g).connect(S.master); g.connect(S.verb); src.start();
  const s2=c.createBufferSource(); s2.buffer=nb(4); s2.loop=true; const l2=c.createBiquadFilter(); l2.type="lowpass"; l2.frequency.value=260;
  const g2=c.createGain(); g2.gain.value=.045; s2.connect(l2).connect(g2).connect(S.master); s2.start();
  const drop=()=>{ if(S.on){ const v=Math.random()<.08?R(.05,.09):R(.008,.03); noise({dur:R(.01,.04),f:R(1800,6500),q:R(3,9),vol:v}); } setTimeout(drop,R(25,140)); };
  drop();
}
T.soundButton = btn => {
  const paint=()=>{ btn.textContent = S.on?"Sound on":"Sound off"; btn.classList.toggle("on",S.on); btn.setAttribute("aria-pressed",S.on); };
  paint();
  btn.addEventListener("click",()=>{ S.on=!S.on; save("sound",S.on); paint(); if(S.on) audio(); if(S.master) S.master.gain.setTargetAtTime(S.on?1:0,S.ctx.currentTime,.25); });
};

/* ---------------- rain, two depths ---------------- */
T.rain = () => {
  const layer=(cls,{density,len,speed,alpha,width})=>{
    const cv=document.createElement("canvas"); cv.className="t-rain "+cls; cv.setAttribute("aria-hidden","true"); document.body.prepend(cv);
    const ctx=cv.getContext("2d"); let w,h,drops=[]; const dpr=Math.min(2,devicePixelRatio||1);
    const mk=any=>({x:Math.random()*w*1.15,y:any?Math.random()*h:-40,l:R(len[0],len[1]),v:R(speed[0],speed[1]),a:R(alpha[0],alpha[1])});
    const fit=()=>{ w=innerWidth; h=innerHeight; cv.width=w*dpr; cv.height=h*dpr; ctx.setTransform(dpr,0,0,dpr,0,0); drops=Array.from({length:Math.round(w*h/density)},()=>mk(true)); };
    let col="#c2c2bf";
    matchMedia("(prefers-color-scheme: dark)").addEventListener("change",()=>col=getComputedStyle(document.documentElement).getPropertyValue("--faint").trim());
    const frame=()=>{ ctx.clearRect(0,0,w,h); ctx.strokeStyle=col; ctx.lineWidth=width; ctx.lineCap="round";
      for(const d of drops){ ctx.globalAlpha=d.a; ctx.beginPath(); ctx.moveTo(d.x,d.y); ctx.lineTo(d.x-d.l*.14,d.y+d.l); ctx.stroke();
        if(!T.reduce){ d.y+=d.v; d.x-=d.v*.14; if(d.y>h+30) Object.assign(d,mk(false)); } }
      ctx.globalAlpha=1; if(!T.reduce) requestAnimationFrame(frame); };
    fit(); addEventListener("resize",fit); frame();
  };
  layer("far",{density:14000,len:[10,18],speed:[2.6,3.8],alpha:[.12,.28],width:.8});
};

/* ---------------- shake the phone ---------------- */
T.onShake = (start, end) => {
  let calm=null, on=false;
  const h=e=>{ const a=e.accelerationIncludingGravity||e.acceleration; if(!a) return;
    const j=Math.abs(Math.hypot(a.x||0,a.y||0,a.z||0)-9.8);
    if(j>7){ if(!on){ on=true; start(); } clearTimeout(calm); calm=setTimeout(()=>{ on=false; end(); },380); } };
  const enable=()=>{ if(!("DeviceMotionEvent" in window)) return;
    if(typeof DeviceMotionEvent.requestPermission==="function") DeviceMotionEvent.requestPermission().then(p=>{ if(p==="granted") addEventListener("devicemotion",h); }).catch(()=>{});
    else addEventListener("devicemotion",h); };
  addEventListener("pointerdown",enable,{once:true});
};

/* press-and-hold helper (pointer + keyboard) */
T.hold = (el, down, up) => {
  el.addEventListener("pointerdown",e=>{ e.preventDefault(); el.setPointerCapture?.(e.pointerId); down(); });
  ["pointerup","pointercancel","lostpointercapture"].forEach(ev=>el.addEventListener(ev,up));
  el.addEventListener("keydown",e=>{ if((e.key===" "||e.key==="Enter")&&!e.repeat){ e.preventDefault(); down(); } });
  el.addEventListener("keyup",e=>{ if(e.key===" "||e.key==="Enter") up(); });
};

/* ---------------- ink brush lines ---------------- */
function brushPath(x0,x1,h,seed){
  let s=seed; const rnd=()=>{ s=(s*9301+49297)%233280; return s/233280; };
  const top=[],bot=[],mid=h/2;
  for(let x=x0;x<=x1;x+=5){ const tp=x<x0+8?1.12:x>x1-6?.86:1; top.push([x,mid-h/2*tp+(rnd()-.5)*1.1]); bot.push([x,mid+h/2*tp+(rnd()-.5)*1.3]); }
  top.push([x1,mid-h/2*.8]); bot.push([x1,mid+h/2*.85]);
  let d=`M${x0+2},${top[0][1]} `+top.map(p=>`L${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  d+=` Q${x1+3},${mid} ${bot[bot.length-1][0]},${bot[bot.length-1][1]} `+bot.reverse().map(p=>`L${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  return d+` Q${x0-3},${mid+1} ${x0+2},${top[0][1]}Z`;
}
T.brush = (yang,w,h,seed,cls="") => {
  const ps = yang ? [brushPath(0,w,h,seed)] : [brushPath(0,w*.42,h,seed),brushPath(w*.58,w,h,seed+7)];
  const r=h/2, segs = yang ? [[0,w]] : [[0,w*.43],[w*.57,w]];
  return `<svg class="t-brush ${cls}" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><g fill="var(--ink)">${segs.map(([a,b])=>`<rect x="${a}" y="0" width="${b-a}" height="${h}" rx="${Math.min(r,3)}"/>`).join("")}</g></svg>`;
};
T.draw = el => requestAnimationFrame(()=>requestAnimationFrame(()=>el.classList.add("drawn")));

/* ---------------- objects that are thrown, bounce and settle on a face ---------------- */
/* opts: count, w, h, front(i) / back(i) html, edge html, thickness, surface, onImpact(hard,item) */
T.Tosser = class {
  constructor(stage, o){
    this.stage=stage; this.o=Object.assign({count:3,w:76,h:76,thickness:4,surface:"felt",layers:5},o);
    this.items=[]; this.state="idle"; this.raf=0; this.build();
    addEventListener("resize",()=>this.size());
  }
  size(){ const r=this.stage.getBoundingClientRect(); this.W=r.width; this.H=r.height; const s=this.W<520?.82:1; this.k=s; }
  build(){
    this.size(); this.items.forEach(it=>{ it.el.remove(); it.sh.remove(); }); this.items=[];
    const o=this.o;
    for(let i=0;i<o.count;i++){
      const w=o.w*this.k,h=o.h*this.k;
      const sh=document.createElement("div"); sh.className="t-shadow";
      Object.assign(sh.style,{position:"absolute",left:0,top:0,width:w+"px",height:h+"px",margin:`${-h/2}px 0 0 ${-w/2}px`,borderRadius:o.shadowRadius||"50%",
        background:"rgba(40,30,20,.13)",pointerEvents:"none",willChange:"transform,opacity,filter"});
      const el=document.createElement("div");
      Object.assign(el.style,{position:"absolute",left:0,top:0,width:w+"px",height:h+"px",margin:`${-h/2}px 0 0 ${-w/2}px`,transformStyle:"preserve-3d",willChange:"transform",pointerEvents:"none"});
      const lay=[]; for(let k=0;k<o.layers;k++){ const z=-o.thickness/2+o.thickness*k/(o.layers-1); lay.push(`<div style="position:absolute;inset:0;transform:translateZ(${z.toFixed(2)}px)">${o.edge}</div>`); }
      el.innerHTML = lay.join("")+
        `<div style="position:absolute;inset:0;backface-visibility:hidden;-webkit-backface-visibility:hidden;transform:translateZ(${o.thickness/2+.2}px)">${o.front(i)}</div>`+
        `<div style="position:absolute;inset:0;backface-visibility:hidden;-webkit-backface-visibility:hidden;transform:rotateX(180deg) translateZ(${o.thickness/2+.2}px)">${o.back(i)}</div>`;
      this.stage.append(sh,el);
      const it={el,sh,i,x:this.W*(.5+(i-(o.count-1)/2)*.2),y:this.H*.55+R(-6,6),z:0,vx:0,vy:0,vz:0,th:(o.startFaces?o.startFaces[i]:i%2)*Math.PI,w:0,rz:(o.startRz?o.startRz(i):R(-40,40)),vrz:0,phase:"rest"};
      this.items.push(it); this.render(it);
    }
  }
  render(c){
    c.el.style.transform=`translate3d(${c.x}px,${c.y}px,${c.z}px) rotateZ(${c.rz}deg) rotateX(${c.th}rad)`;
    const lift=Math.max(0,c.z), flat=Math.abs(Math.cos(c.th));
    c.sh.style.transform=`translate(${c.x+3+lift*.12}px,${c.y+5+lift*.22}px) rotate(${c.rz}deg) scale(${(1+lift/320)},${(1+lift/320)*(.55+.45*flat)})`;
    c.sh.style.opacity=Math.max(.25,1-lift/380); c.sh.style.filter=`blur(${.6+lift/45}px)`;
  }
  gather(){ // held in cupped hands, jostling
    if(this.state!=="idle") return false; this.size(); this.state="shaking";
    this.items.forEach((c,i)=>{ c.ox=(i-(this.items.length-1)/2)*24*this.k+R(-4,4); c.oy=R(-8,8); c.phase="hand"; });
    this.loop(); return true;
  }
  toss(want){ // want[i]: 0 = front up, 1 = back up
    return new Promise(res=>{
      this.done=res; this.state="tossing";
      this.items.forEach((c,i)=>{ c.want=want[i]; c.phase="air"; c.b=0; c.prev=0; c.touch={};
        c.vz=R(820,1060); c.vx=R(-140,140)+(i-(this.items.length-1)/2)*R(60,120); c.vy=-R(.3,.44)*this.H;
        c.w=R(16,26)*(Math.random()<.5?-1:1); c.vrz=R(-260,260); });
      if(T.reduce){ this.items.forEach((c,i)=>{ c.x=this.W*(.5+(i-(this.items.length-1)/2)*.22); c.y=this.H*.45; c.z=0; c.th=c.want*Math.PI; c.phase="rest"; this.render(c); });
        this.state="idle"; res(); return; }
      this.loop();
    });
  }
  loop(){ if(!this.raf){ this.last=performance.now(); this.raf=requestAnimationFrame(t=>this.step(t)); } }
  step(t){
    const dt=Math.min(.033,(t-this.last)/1000||.016); this.last=t; const o=this.o; let moving=false;
    const rx=o.w*this.k/2+12, ry=o.h*this.k/2+12, rr=Math.max(o.w,o.h)*this.k*.48;
    for(const c of this.items){
      if(this.state==="shaking"){
        const cx=this.W*.5+Math.sin(t/70+c.i)*6, cy=this.H*.8;
        c.x+=(cx+c.ox-c.x)*.25+R(-3,3); c.y+=(cy+c.oy-c.y)*.25+R(-3,3); c.z=26+Math.sin(t/55+c.ox)*10; c.th+=R(-.6,.6); c.rz+=R(-8,8);
        if(Math.random()<dt*9) o.onRattle&&o.onRattle();
        moving=true; this.render(c); continue;
      }
      if(c.phase==="air"){
        moving=true; c.vz-=2600*dt; c.z+=c.vz*dt; c.x+=c.vx*dt; c.y+=c.vy*dt; c.th+=c.w*dt; c.rz+=c.vrz*dt;
        if(c.x<rx||c.x>this.W-rx){ c.vx*=-.5; c.x=Math.min(this.W-rx,Math.max(rx,c.x)); o.onImpact&&o.onImpact(.25,c); }
        if(c.y<ry||c.y>this.H-ry){ c.vy*=-.5; c.y=Math.min(this.H-ry,Math.max(ry,c.y)); o.onImpact&&o.onImpact(.25,c); }
        if(c.z<=0&&c.vz<0){
          c.z=0; c.b++; const hard=Math.min(1,Math.abs(c.vz)/900);
          o.onImpact&&o.onImpact(hard,c); T.buzz(Math.round(8+hard*14));
          if(c.b<3&&Math.abs(c.vz)>260){ c.vz=-c.vz*.34; c.w*=.5; c.vx*=.55; c.vy*=.55; c.vrz*=.5; }
          else { c.phase="settle"; c.vz=0; let k=Math.round(c.th/Math.PI); if(((k%2)+2)%2!==c.want) k+=(c.th/Math.PI-k)>0?1:-1; c.target=k*Math.PI; }
        }
        this.render(c);
      } else if(c.phase==="settle"){
        moving=true; c.w+=(-210*(c.th-c.target)-7.5*c.w)*dt; c.th+=c.w*dt;
        c.x+=c.vx*dt; c.y+=c.vy*dt; c.vx*=Math.exp(-5*dt); c.vy*=Math.exp(-5*dt); c.rz+=c.vrz*dt; c.vrz*=Math.exp(-4*dt);
        if(Math.sign(c.th-c.target)!==Math.sign(c.prev||0)&&Math.abs(c.w)>1.2) o.onWobble&&o.onWobble(Math.min(.3,Math.abs(c.w)/40),c);
        c.prev=c.th-c.target;
        if(Math.abs(c.th-c.target)<.004&&Math.abs(c.w)<.06){ c.th=c.target; c.w=0; c.phase="rest"; }
        this.render(c);
      }
    }
    if(this.state==="tossing"){
      for(let i=0;i<this.items.length;i++) for(let j=i+1;j<this.items.length;j++){
        const A=this.items[i],B=this.items[j]; if(A.z>8||B.z>8) continue;
        const dx=B.x-A.x,dy=B.y-A.y,d=Math.hypot(dx,dy)||1,min=rr*2.05;
        if(d<min){ const p=(min-d)/2,ux=dx/d,uy=dy/d; A.x-=ux*p; A.y-=uy*p; B.x+=ux*p; B.y+=uy*p;
          if(!A.touch[j]){ A.touch[j]=1; o.onImpact&&o.onImpact(.2,A); } this.render(A); this.render(B); }
      }
      if(this.items.every(c=>c.phase==="rest")){ this.state="idle"; const d=this.done; this.done=null; d&&d(); }
    }
    if(moving||this.state!=="idle") this.raf=requestAnimationFrame(t=>this.step(t)); else this.raf=0;
  }
};

/* ---------------- coin artwork (开元通宝), flat and outlined ---------------- */
const RING="M2,50a48,48 0 1,0 96,0a48,48 0 1,0 -96,0Z M40,40h20v20h-20Z";
T.coin = front => `<svg viewBox="0 0 100 100" width="100%" height="100%">
  <path d="${RING}" fill-rule="evenodd" fill="${front?"#f6d77e":"#f2cc66"}" stroke="#3a3a3a" stroke-width="2.6"/>
  <circle cx="50" cy="50" r="41" fill="none" stroke="#3a3a3a" stroke-width="1.4" opacity=".55"/>
  <rect x="35" y="35" width="30" height="30" fill="none" stroke="#3a3a3a" stroke-width="1.4" opacity=".55"/>
  ${front?`<g font-family="Noto Serif SC,Songti SC,STSong,serif" font-size="15" font-weight="600" fill="#3a3a3a" text-anchor="middle" dominant-baseline="central"><text x="50" y="22">开</text><text x="50" y="79">元</text><text x="79" y="50">通</text><text x="21" y="50">宝</text></g>`
    :`<path d="M37,23 Q50,30 63,23" fill="none" stroke="#3a3a3a" stroke-width="2" stroke-linecap="round"/>`}
  <path d="M20,30 Q26,20 36,16" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".7"/></svg>`;
T.coinEdge = `<svg viewBox="0 0 100 100" width="100%" height="100%"><path d="${RING}" fill-rule="evenodd" fill="#d9ad4a" stroke="#3a3a3a" stroke-width="2.6"/></svg>`;

/* ---------------- small icons ---------------- */
T.icon = {
  back:`<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M13 8H3M7 4L3 8l4 4"/></svg>`,
  send:`<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2L7 9M14 2l-4.5 12-2.5-5-5-2.5z"/></svg>`
};

/* ---------------- the master: a naive old face ---------------- */
T.master = (blink=false) => `<svg viewBox="0 0 100 100" width="100%" height="100%" aria-hidden="true">
  <path d="M30,56 Q30,92 50,96 Q70,92 70,56 Z" fill="#fff" stroke="#3a3a3a" stroke-width="1.4"/>
  <path d="M27,44 Q26,20 50,18 Q74,20 73,44 Q74,64 50,68 Q26,64 27,44Z" fill="#f6c6a8" stroke="#3a3a3a" stroke-width="1.4"/>
  <path d="M27,40 Q18,38 20,50 Q22,58 29,54" fill="#e8e6e1" stroke="#3a3a3a" stroke-width="1.2"/>
  <path d="M73,40 Q82,38 80,50 Q78,58 71,54" fill="#e8e6e1" stroke="#3a3a3a" stroke-width="1.2"/>
  <path d="M36,34 Q42,31 46,34 M54,34 Q58,31 64,34" fill="none" stroke="#3a3a3a" stroke-width="1.6" stroke-linecap="round"/>
  ${blink?`<path d="M37,42 h8 M55,42 h8" stroke="#3a3a3a" stroke-width="1.6" stroke-linecap="round"/>`
    :`<path d="M37,42 Q41,45 45,42 M55,42 Q59,45 63,42" fill="none" stroke="#3a3a3a" stroke-width="1.5" stroke-linecap="round"/>`}
  <path d="M50,40 Q46,50 49,53 Q52,54 53,52" fill="#f5a3b8" stroke="#3a3a3a" stroke-width="1.2"/>
  <path d="M34,58 Q50,72 66,58 Q66,82 50,90 Q34,82 34,58Z" fill="#fff" stroke="#3a3a3a" stroke-width="1.4"/>
  <path d="M43,62 Q50,65 57,62" fill="none" stroke="#3a3a3a" stroke-width="1.3" stroke-linecap="round"/>
  <ellipse cx="34" cy="50" rx="4" ry="2.4" fill="#f4a59a" opacity=".6"/><ellipse cx="66" cy="50" rx="4" ry="2.4" fill="#f4a59a" opacity=".6"/>
</svg>`;
})();
