// O'Neil base-pattern detector, same rules as the original Base Pattern Desk (scripts/pat.js).

/* O'Neil base-pattern detector. Input: daily bars ascending {time,open,high,low,close,volume}. */
const PAT=(function(){
const TICK=0; // IBD's updated rule: the buy point is the exact high of the pivot area (no +$0.10)
function argmax(b,f,t,k){let bi=f;for(let i=f+1;i<=t;i++)if(b[i][k]>b[bi][k])bi=i;return bi;}
function argmin(b,f,t,k){let bi=f;for(let i=f+1;i<=t;i++)if(b[i][k]<b[bi][k])bi=i;return bi;}
function maxClose(b,f,t){let m=-Infinity;for(let i=f;i<=t;i++)m=Math.max(m,b[i].close);return m;}
function avgVol(b,f,t){let s=0,c=0;for(let i=Math.max(0,f);i<=t;i++){s+=b[i].volume;c++;}return c?s/c:0;}
function prep(b){
  const n=b.length,av=new Array(n).fill(null),s50=new Array(n).fill(null),s200=new Array(n).fill(null);let vs=0,cs=0,c2=0;
  for(let i=0;i<n;i++){ // av[i] = average volume of the 50 sessions BEFORE i
    if(i>=50)av[i]=vs/50;
    vs+=b[i].volume;if(i>=50)vs-=b[i-50].volume;
    cs+=b[i].close;if(i>=50)cs-=b[i-50].close;if(i>=49)s50[i]=cs/50;
    c2+=b[i].close;if(i>=200)c2-=b[i-200].close;if(i>=199)s200[i]=c2/200;}
  // weeks: index of week for each day, and per-week ranges
  const wk=[],weeks=[];let key=null;
  for(let i=0;i<n;i++){const d=new Date(b[i].time*1000);const k=b[i].time-((d.getUTCDay()+6)%7)*86400;
    if(k!==key){key=k;weeks.push({f:i,t:i});}else weeks[weeks.length-1].t=i;wk.push(weeks.length-1);}
  return {av,s50,s200,wk,weeks};
}
function zigzag(b,f,t,pct){
  const out=[];let trend=0,ext=f,hi=f,lo=f;
  for(let i=f;i<=t;i++){
    if(trend===0){if(b[i].high>b[hi].high)hi=i;if(b[i].low<b[lo].low)lo=i;
      if(b[hi].high/b[lo].low-1>=pct){if(hi>lo){out.push({i:lo,p:b[lo].low,k:'L'});trend=1;ext=hi;}else{out.push({i:hi,p:b[hi].high,k:'H'});trend=-1;ext=lo;}}}
    else if(trend===1){if(b[i].high>=b[ext].high)ext=i;else if(1-b[i].low/b[ext].high>=pct){out.push({i:ext,p:b[ext].high,k:'H'});trend=-1;ext=argmin(b,ext,i,'low');}}
    else{if(b[i].low<=b[ext].low)ext=i;else if(b[i].high/b[ext].low-1>=pct){out.push({i:ext,p:b[ext].low,k:'L'});trend=1;ext=argmax(b,ext,i,'high');}}
  }
  if(trend===1)out.push({i:ext,p:b[ext].high,k:'H',open:true});else if(trend===-1)out.push({i:ext,p:b[ext].low,k:'L',open:true});
  return out;
}
const pct=x=>(x*100).toFixed(0)+'%';

/* ---- cup / double bottom / flat base family: left-side high = highest high of the base ---- */
function family(b,e,minStart,P){
  const out=[];const lo=Math.max(minStart,e-325,0);if(e-lo<24)return out;
  let a=argmax(b,lo,e,'close'); // left-side high = highest CLOSE: intraday pokes above it without a close don't restart the base
  // ...and neither do closes that creep above that close but stay under its buy point (high + 10¢): the base is still intact
  while(a>lo){const a0=argmax(b,lo,a-1,'close');if(maxClose(b,a0+1,e)<=b[a0].high+TICK)a=a0;else break;}
  const H=b[a].high,len=e-a+1;
  if(len<25)return out;
  const pre=argmin(b,Math.max(0,a-130),a,'low'),prior=H/b[pre].low-1;
  const m=argmin(b,a+1,e,'low'),L=b[m].low,depth=1-L/H,mid=L+(H-L)/2;
  const base={a,H,m,L,depth,len,weeks:len/5,prior,lowIdx:m};
  // Flat base (book: at least 6–7 weeks, correcting no more than 10–15%), usually a second-stage base
  if(depth<=0.15&&len>=30&&prior>=0.20){
    const notes=[];if(depth<=0.10)notes.push(['good','Tight: only '+pct(depth)+' deep']);
    if(len<35)notes.push(['warn','6-week flat base: the minimum (6–7+ weeks)']);
    if(prior<0.30)notes.push(['warn','Prior uptrend only '+pct(prior)+' (the book looks for 30%+)']);
    out.push({...base,type:'flat',name:'Flat base',pivot:H+TICK,pivotIdx:a,pts:[[a,H],[e,H]],box:[a,e,H,L],notes});
    return out;
  }
  if(depth<0.12||depth>0.50||len<20||prior<0.25)return out;
  if(len<30&&depth>0.35)return out; // short AND deep: not a base
  const lenNote=len<30?['bad','Only '+(len/5).toFixed(1)+' weeks long: O\'Neil wants 7 weeks (6 at the very least). Short bases fail more often']:len<35?['warn','6-week base: the bare minimum (7+ weeks preferred)']:null;
  const common=[];
  if(prior<0.30)common.push(['warn','Prior uptrend only '+pct(prior)+' (O\'Neil wants 30%+)']);else common.push(['good','Prior uptrend +'+pct(prior)]);
  if(depth>0.33)common.push(['warn','Deep: '+pct(depth)+' (over 33% is only normal in a bear market)']);
  // cup shape: U or V
  const R_i=argmax(b,m+1<=e?m+1:e,e,'high'),R=b[R_i].high;
  let bottomDays=0;for(let i=a;i<=R_i;i++)if(b[i].close<=L+(H-L)*0.30)bottomDays++;
  const uShape=bottomDays>=10;
  // Cup with handle
  const hLen=e-R_i;
  if(R>=H*0.88&&R_i-a>=12&&hLen>=2&&hLen<=Math.max(30,0.5*(R_i-a))){
    const hl=argmin(b,R_i+1,e,'low'),HL=b[hl].low,hd=1-HL/R,pos=(HL-L)/(H-L);
    if(hd<=0.15&&pos>=0.40){
      const notes=[...common];if(lenNote)notes.push(lenNote);
      notes.push(uShape?['good','Rounded U-shaped cup']:['warn','V-shaped cup (O\'Neil prefers a rounded U)']);
      if(hLen<5)notes.push(['bad','Handle only '+hLen+' day'+(hLen>1?'s':'')+' (O\'Neil: at least 1 week)']);
      notes.push(hd<=0.12?['good','Handle '+pct(hd)+' deep (within 10–15%)']:['warn','Handle '+pct(hd)+' deep, a bit loose (book: within 10–15%)']);
      if(pos<0.5)notes.push(['bad','Handle dips into the lower half of the base (faulty)']);else notes.push(['good','Handle in the upper half of the base']);
      if(P.s200[hl]!==null&&HL<P.s200[hl])notes.push(['bad','Handle below the 200-day line (the book: weak, failure-prone)']);
      else if(P.s50[hl]!==null&&HL<P.s50[hl])notes.push(['warn','Handle undercut the 50-day line']);
      const hv=avgVol(b,R_i+1,e),bv=P.av[e]||hv;
      notes.push(hv<bv*0.9?['good','Volume dried up in the handle (×'+(hv/bv).toFixed(2)+')']:['warn','Volume did not dry up in the handle (×'+(hv/bv).toFixed(2)+')']);
      if(hLen>=8&&hl-R_i<hLen/3&&b[e].low>HL*1.01)notes.push(['warn','Wedging handle: lows drift up instead of down']);
      out.push({...base,type:'cwh',name:'Cup with handle',R,R_i,hl,HL,hd,pivot:R+TICK,pivotIdx:R_i,handleWeeks:hLen/5,
        pts:[[a,H],[m,L],[R_i,R],[hl,HL],[e,b[e].close]],notes});
    }
  }
  // Double bottom: second low undercuts the first
  if(m-a>=15){
    const m1=argmin(b,a+1,m-10,'low'),L1=b[m1].low;
    if(L1>L&&L1<=L*1.08&&m-m1>=10){
      const k=argmax(b,m1+1,m-1,'high'),M=b[k].high;
      if(k-m1>=5&&m-k>=5&&M<H&&(M-L)/(H-L)>=0.40&&M/L1-1>=0.07&&maxClose(b,k+1,e)<=M+TICK){
        const notes=[...common,...(lenNote?[lenNote]:[]),['good','Second low undercuts the first by '+((1-L/L1)*100).toFixed(1)+'% (shakeout)']];
        out.push({...base,type:'dbl',name:'Double bottom',m1,L1,k,M,pivot:M+TICK,pivotIdx:k,pts:[[a,H],[m1,L1],[k,M],[m,L],[e,b[e].close]],notes});
      }
    }
  }
  // Cup without handle: right side back near the old high
  if(R>=H*0.90&&R_i-a>=15&&!out.some(p=>p.type==='cwh')){
    const notes=[...common];if(lenNote)notes.push(lenNote);notes.push(uShape?['good','Rounded U-shaped cup']:['warn','V-shaped cup (O\'Neil prefers a rounded U)']);
    if(hLen>=5)notes.push(['warn','Pullback after the right side is too deep or low to count as a handle']);
    out.push({...base,type:'cup',name:'Cup without handle',R,R_i,pivot:H+TICK,pivotIdx:a,pts:[[a,H],[m,L],[R_i,R]],notes});
  }
  out.forEach(p=>{p.faulty=p.notes.some(x=>x[0]==='bad');if(p.faulty)p.name+=' (faulty)';});
  return out;
}
/* ---- ascending base: three 10–20% pullbacks, rising highs and rising lows, 9–16 weeks ---- */
function ascending(b,e,minStart){
  const f=Math.max(minStart,e-95,0);if(e-f<40)return null;
  let z=zigzag(b,f,e,0.08);if(z.length&&z[z.length-1].k==='H'&&z.length>=2){const mx=Math.max(...z.filter(x=>x.k==='H'&&!x.open).map(x=>x.p));if(z[z.length-1].p<mx)z=z.slice(0,-1);}
  if(z.length<6||z[z.length-1].k!=='L')return null;
  const s=z.slice(-6);if(s[0].k!=='H')return null;
  const [H1,L1,H2,L2,H3,L3]=s;
  if(!(H1.p<H2.p&&H2.p<H3.p&&L1.p<L2.p&&L2.p<L3.p))return null;
  for(const [h,l] of [[H1,L1],[H2,L2],[H3,L3]]){const d=1-l.p/h.p;if(d<0.08||d>0.25)return null;}
  const span=e-H1.i;if(span<40||span>80)return null;
  if(argmax(b,H1.i,e,'high')!==H3.i)return null;
  const pre=argmin(b,Math.max(0,H1.i-130),H1.i,'low');const prior=H1.p/b[pre].low-1;if(prior<0.20)return null;
  return {type:'asc',name:'Ascending base',a:H1.i,H:H3.p,L:L1.p,lowIdx:L1.i,depth:1-L3.p/H3.p,len:span+1,weeks:(span+1)/5,prior,
    pivot:H3.p+TICK,pivotIdx:H3.i,pts:s.map(x=>[x.i,x.p]),notes:[['good','Three pullbacks, each low higher than the last'],['good','Prior uptrend +'+pct(prior)]]};
}
/* ---- high tight flag (book): +100–120% in 4–8 weeks, then 3–5 weeks correcting no more than 10–20% ---- */
function htf(b,e,minStart){
  if(e<60)return null;const f=argmax(b,Math.max(e-30,minStart),e,'high');const fl=e-f;if(fl<10||fl>30)return null;
  const FH=b[f].high;const p=argmin(b,Math.max(0,f-45),f-10,'low');const gain=FH/b[p].low-1;if(gain<1.00||f-p<15)return null;
  const q=argmin(b,f+1,e,'low');const corr=1-b[q].low/FH;if(corr>0.20)return null;
  return {type:'htf',name:'High tight flag',a:p,H:FH,L:b[q].low,lowIdx:q,depth:corr,len:e-p+1,weeks:fl/5,prior:gain,pivot:FH+TICK,pivotIdx:f,
    pts:[[p,b[p].low],[f,FH],[q,b[q].low],[e,b[e].close]],notes:[['good','Pole +'+pct(gain)+' in '+((f-p)/5).toFixed(0)+' weeks'],['good','Flag corrected '+pct(corr)+' (max 20%)']]};
}
/* ---- three weeks tight: 3 weekly closes within 1.5% ---- */
function twt(b,e,P,minStart){
  let w=P.wk[e];if(P.weeks[w].t!==e)w--;if(w<2)return null;
  const W=[w-2,w-1,w].map(x=>P.weeks[x]);if(W[0].f<minStart)return null;
  const cl=W.map(x=>b[x.t].close),mx=Math.max(...cl),mn=Math.min(...cl);if(mx/mn-1>0.015)return null;
  let hi=W[0].f;for(const x of W){const j=argmax(b,x.f,x.t,'high');if(b[j].high>b[hi].high)hi=j;}
  const H=b[hi].high;if(maxClose(b,W[2].t+1,e)>H+TICK)return null;
  const lo=argmin(b,W[0].f,e,'low');
  const h52=b[argmax(b,Math.max(0,e-250),e,'high')].high;if(b[e].close<h52*0.85)return null;
  if(P.s50[e]===null||b[e].close<P.s50[e])return null;
  const pre=argmin(b,Math.max(0,W[0].f-130),W[0].f,'low');const prior=H/b[pre].low-1;if(prior<0.20)return null;
  return {type:'3wt',name:'Three weeks tight',a:W[0].f,H,L:b[lo].low,lowIdx:lo,depth:1-b[lo].low/H,len:e-W[0].f+1,weeks:3,prior,pivot:H+TICK,pivotIdx:hi,
    box:[W[0].f,W[2].t,H,b[lo].low],pts:[],notes:[['good','Weekly closes within '+((mx/mn-1)*100).toFixed(1)+'% of each other']]};
}
/* ---- descending (faulty) base: lower highs and lower lows ---- */
function descending(b,e,P){
  const f=Math.max(0,e-150);const z=zigzag(b,f,e,0.08);const hs=z.filter(x=>x.k==='H'&&!x.open).slice(-3),ls=z.filter(x=>x.k==='L').slice(-3);
  if(hs.length<3||ls.length<2)return null;
  if(!(hs[0].p>hs[1].p&&hs[1].p>hs[2].p))return null;
  const lz=ls.filter(x=>x.i>hs[0].i);if(lz.length<2)return null;for(let i=1;i<lz.length;i++)if(lz[i].p>=lz[i-1].p)return null;
  if(P.s50[e]===null||b[e].close>P.s50[e])return null;
  const pts=z.filter(x=>x.i>=hs[0].i).map(x=>[x.i,x.p]);
  return {type:'desc',name:'Descending base',a:hs[0].i,H:hs[0].p,L:lz[lz.length-1].p,lowIdx:lz[lz.length-1].i,depth:1-lz[lz.length-1].p/hs[0].p,len:e-hs[0].i+1,weeks:(e-hs[0].i+1)/5,
    pivot:null,pts,notes:[['bad','Lower highs and lower lows, below the 50-day line'],['bad','O\'Neil treats this as a faulty base: no buy point until a proper base forms']]};
}
const ORDER=['htf','cwh','dbl','cup','asc','flat','3wt'];
function detectAt(b,e,minStart,P){
  const r=[];const h=htf(b,e,minStart);if(h)r.push(h);
  r.push(...family(b,e,minStart,P));
  const s=ascending(b,e,minStart);if(s)r.push(s);
  const t=twt(b,e,P,minStart);if(t)r.push(t);
  r.sort((x,y)=>(x.faulty?1:0)-(y.faulty?1:0)||ORDER.indexOf(x.type)-ORDER.indexOf(y.type));
  return r;
}
function scan(b){
  const n=b.length,P=prep(b);const hist=[];let minStart=0,stage=0,prevLow=null,active=null,faultyA=-1;
  for(let t=Math.min(60,n-1);t<n;t++){
    // a breakout that closes 2%+ back under its buy point within 5 weeks (before gaining 15%) has failed: the base keeps forming
    if(active){const g=b[t].high/active.pivot-1;active.run=Math.max(active.run,g);
      if(active.run>=0.15||t-active.bo>25)active=null;
      else if(b[t].close<active.pivot*0.98){active.failed=t;minStart=active.saved.minStart;stage=active.saved.stage;prevLow=active.saved.prevLow;active=null;}}
    const e=t-1;const ps=detectAt(b,e,minStart,P);if(!ps.length)continue;
    const p=ps.find(x=>b[t].close>x.pivot);if(!p)continue;
    if(p.faulty){if(p.a===faultyA)continue;faultyA=p.a;
      const vr0=P.av[t]?b[t].volume/P.av[t]:null;let best0=0,stop0=null;for(let j=t;j<Math.min(n,t+65);j++){best0=Math.max(best0,b[j].high/p.pivot-1);if(b[j].close<=p.pivot*0.92){stop0=j;break;}}
      hist.push({...p,e,bo:t,volRatio:vr0,stage:'—',addOn:false,best:best0,stopped:stop0,open:t+65>n&&stop0===null,run:0});continue;}
    for(let k=hist.length-1;k>=0&&hist[k].faulty;k--)if(hist[k].a===p.a)hist.splice(k,1); // the sound breakout of the same base replaces the earlier faulty one
    const saved={minStart,stage,prevLow};
    if(p.type!=='3wt'){stage=(prevLow!==null&&p.L<prevLow)?1:stage+1;prevLow=p.L;}
    const vr=P.av[t]?b[t].volume/P.av[t]:null;
    // outcome: best gain within 13 weeks unless the 8% stop hit first
    let best=0,stopped=null;for(let j=t;j<Math.min(n,t+65);j++){best=Math.max(best,b[j].high/p.pivot-1);if(b[j].close<=p.pivot*0.92){stopped=j;break;}}
    const rec={...p,e,bo:t,volRatio:vr,stage:p.type==='3wt'?stage:stage,addOn:p.type==='3wt',best,stopped,open:t+65>n&&stopped===null,run:0,saved};
    hist.push(rec);active=rec;
    minStart=t;
  }
  const e=n-1;let cur=detectAt(b,e,minStart,P);
  const last=hist[hist.length-1];
  cur=cur.filter(p=>!(p.faulty&&last&&last.faulty&&last.a===p.a));
  const d=descending(b,e,P);if(d&&!cur.length)cur.push(d);
  cur.forEach(p=>{p.stage=p.type==='3wt'?stage:((prevLow!==null&&p.L<prevLow)?1:stage+1);p.e=e;p.dist=p.pivot?b[e].close/p.pivot-1:null;});
  const hiIdx=argmax(b,Math.max(0,e-250),e,'high');
  hist.forEach(h=>{delete h.saved;});
  cur.forEach(p=>{if(p.faulty&&p.dist!=null&&p.dist>0)p.brokeOut=true;});
  return {hist,cur,last,P,sinceHigh:e-hiIdx,extended:P.s50[e]?b[e].close/P.s50[e]-1:null};
}
return {scan,zigzag,prep};
})();

export default PAT;
