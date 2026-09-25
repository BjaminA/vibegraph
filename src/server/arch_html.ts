// M-ARCH.5 (PLAN-M-ARCH.md) — `architecture.html`: the architecture map as
// ONE self-contained file. SVG drawn by inline JS, no react-flow, no
// network: open it from a tarball, a mail attachment or a PR artifact.
//
// Laid out AND ROUTED by the same deterministic functions the GUI map uses
// (webview/system/archLayout.ts → arch_route.ts), once per lens, at export
// time — so the file and the view cannot disagree about where anything is or
// which way an edge runs, and nothing in it was placed by a model. The story
// beats come from arch_trace.ts too. Interactions: five lenses (Overview and
// Trust fold tools into one box per category), find, click or Enter on a
// box / edge / group for what it is and WHY, upstream / downstream reach, a
// route between two boxes, the start-here path played as a story, pan and
// zoom, a theme toggle. The first view is READABLE (fit all when labels stay
// ≥ 11px, else fit the width, else the floor — reviews/m-arch/COMPARE.md).
//
// Byte-stable: no timestamps, no randomness; the model's own ordering.

import type { ArchModelRecord, ArchNodeRecord, ArchEdgeRecord } from "../shared/protocol.ts";
import { ARCH_LENSES, buildArchLayout, cardHeight, CARD_W, LEGIBLE_LABEL_PX } from "../webview/system/archLayout.ts";
import { storyBeats, toDrawn } from "../webview/system/arch_trace.ts";

export interface ArchHtmlOptions { title: string; commit?: string | null; tool?: string }

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

const nodeRec = (n: ArchNodeRecord) => ({
  id: n.id, kind: n.kind, label: n.label, sublabel: n.sublabel, category: n.category, source: n.source,
  labelSource: n.labelSource ?? null, derivedLabel: n.derivedLabel ?? null,
  roleStatedBy: n.roleStatedBy ?? null, wrappedBy: n.wrappedBy ?? [], members: n.members ?? [],
  dispatches: n.dispatches ?? [], callers: n.callers ?? [],
  threads: n.threads, refs: n.refs,
});
const edgeRec = (e: ArchEdgeRecord) => ({
  id: e.id, from: e.from, to: e.to, kind: e.kind, protocol: e.protocol, basis: e.protocolBasis,
  presence: !!e.protocolPresence, confidence: e.confidence, count: e.count, via: e.via ?? [],
  threads: e.threads, refs: e.refs, payloads: e.payloads ?? [], members: e.members ?? [],
});

/** The embedded data: per-lens geometry and routes, story beats, and the facts for the panel. */
export function archHtmlData(model: ArchModelRecord): Record<string, unknown> {
  const lenses: Record<string, unknown> = {};
  const extraNodes = new Map<string, ArchNodeRecord>();
  const extraEdges = new Map<string, ArchEdgeRecord>();
  const known = new Set(model.nodes.map((n) => n.id));
  const knownE = new Set(model.edges.map((e) => e.id));
  for (const lens of ARCH_LENSES) {
    const l = buildArchLayout(model, lens);
    for (const n of l.nodes) { const r = (n.data as { node?: ArchNodeRecord }).node; if (r && !known.has(r.id)) extraNodes.set(r.id, r); }
    for (const e of l.edges) { const r = (e.data as { edge: ArchEdgeRecord }).edge; if (!knownE.has(r.id)) extraEdges.set(r.id, r); }
    const drawn = l.edges.map((e) => ({ id: e.id, from: e.source, to: e.target, members: (e.data as { edge: ArchEdgeRecord }).edge.members }));
    const into = new Map<string, string>();
    for (const n of l.nodes) for (const m of ((n.data as { node?: ArchNodeRecord }).node?.members ?? [])) into.set(m, n.id);
    const story = model.primaryPath?.entryPoints.length
      ? storyBeats(model.nodes, model.edges, model.primaryPath.entryPoints).map((b) => ({ ...b, ...toDrawn(b, drawn, (id) => into.get(id) ?? id) }))
      : [];
    lenses[lens] = {
      nodes: l.nodes.map((n) => n.type === "archGroup"
        ? { id: n.id, g: (n.data as { group: { id: string } }).group.id, x: n.position.x, y: n.position.y, w: n.width, h: n.height }
        : { id: n.id, x: n.position.x, y: n.position.y, h: cardHeight((n.data as { node: ArchNodeRecord }).node) }),
      edges: l.edges.map((e) => {
        const d = e.data as { points: [number, number][]; labelAt: { cx: number; cy: number } | null; weak: boolean; hop: boolean };
        // A label the router found no free spot for is not drawn; the edge's
        // title and the panel still carry it.
        return { id: e.id, s: e.source, t: e.target, label: typeof e.label === "string" ? e.label : "", full: (d as { fullLabel?: string }).fullLabel ?? "", weak: d.weak, hop: d.hop, p: d.points, at: (d as { labelClear?: boolean }).labelClear === false ? null : d.labelAt };
      }),
      hidden: l.hiddenTools,
      story,
    };
  }
  return {
    lenses,
    nodes: [...model.nodes, ...extraNodes.values()].map(nodeRec),
    edges: [...model.edges, ...extraEdges.values()].map(edgeRec),
    groups: model.groups,
    unplaced: model.unplaced,
    primaryPath: model.primaryPath ?? null,
  };
}

const CSS = `
:root{--bg:hsl(222 18% 9%);--panel:hsl(222 16% 13%);--node:hsl(222 15% 15%);--border:hsl(222 12% 26%);
--text:hsl(220 20% 92%);--text2:hsl(220 12% 72%);--muted:hsl(220 9% 52%);--thread:hsl(172 55% 50%);
--config:hsl(38 35% 55%);--io:hsl(212 70% 64%);--iow:hsl(268 55% 70%);--iom:hsl(212 25% 55%);--proposed:hsl(190 20% 58%)}
@media (prefers-color-scheme: light){:root:not([data-theme=dark]){--bg:hsl(220 20% 98%);--panel:hsl(0 0% 100%);--node:hsl(0 0% 100%);
--border:hsl(220 14% 84%);--text:hsl(222 25% 14%);--text2:hsl(222 12% 34%);--muted:hsl(220 9% 48%);--thread:hsl(172 60% 32%);
--config:hsl(34 60% 38%);--io:hsl(212 70% 44%);--iow:hsl(268 45% 48%);--iom:hsl(212 25% 45%);--proposed:hsl(190 25% 40%)}}
:root[data-theme=light]{--bg:hsl(220 20% 98%);--panel:hsl(0 0% 100%);--node:hsl(0 0% 100%);--border:hsl(220 14% 84%);
--text:hsl(222 25% 14%);--text2:hsl(222 12% 34%);--muted:hsl(220 9% 48%);--thread:hsl(172 60% 32%);--config:hsl(34 60% 38%);
--io:hsl(212 70% 44%);--iow:hsl(268 45% 48%);--iom:hsl(212 25% 45%);--proposed:hsl(190 25% 40%)}
*{box-sizing:border-box}html,body{margin:0;height:100%;background:var(--bg);color:var(--text);font:13px/1.4 Inter,system-ui,sans-serif}
body{display:flex;flex-direction:column}
header{display:flex;flex-wrap:wrap;gap:8px 16px;align-items:center;padding:12px 16px;border-bottom:1px solid var(--border)}
h1{font-size:16px;margin:0;font-weight:600}.meta{color:var(--muted);font-size:12px}
.bar{display:flex;gap:4px;background:var(--panel);border:1px solid var(--border);border-radius:8px;padding:4px}
.bar button,.tool{border:0;background:transparent;color:var(--text2);border-radius:4px;padding:4px 8px;font:inherit;font-size:12px;cursor:pointer}
.bar button[aria-pressed=true]{background:color-mix(in oklab,var(--thread) 20%,transparent);color:var(--text)}
#story{color:var(--thread)}
input{background:var(--panel);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:4px 8px;font:inherit;font-size:12px;width:200px}
main{position:relative;flex:1;min-height:0;overflow:hidden}svg{width:100%;height:100%;cursor:grab;display:block}
.n rect{fill:var(--node);stroke-width:1}.n text{fill:var(--text);font-size:13px;font-weight:600}.n .sub{fill:var(--muted);font-size:11px;font-weight:400}
.n .chip{fill:var(--muted);font:11px "JetBrains Mono",ui-monospace,monospace}
.n.tool text:first-of-type{font-family:"JetBrains Mono",ui-monospace,monospace}
.n,.e,.grp{cursor:pointer;outline:none}.dim{opacity:.15}.hit rect,.lit rect{stroke-width:2.5}.lit path{stroke-width:3;opacity:1}
.n:focus-visible rect,.grp:focus-visible rect{stroke-width:3;stroke:var(--thread)}.e:focus-visible path{stroke-width:4}
.e path{fill:none}.e .lb{fill:var(--bg);opacity:.92}.e text{font:11px "JetBrains Mono",ui-monospace,monospace;fill:var(--text2)}
.e.weak text{fill:var(--muted)}.grp rect{stroke-width:1}.grp text{font-size:12px;font-weight:600;fill:var(--text)}
.grp .k{fill:var(--muted);font-weight:400;font-family:"JetBrains Mono",ui-monospace,monospace;font-size:11px}
aside{position:absolute;top:12px;right:12px;width:360px;max-height:calc(100% - 24px);overflow:auto;background:var(--panel);
border:1px solid var(--border);border-radius:8px;padding:12px;font-size:12px;color:var(--text2);display:none}
aside.on{display:block}aside h2{font-size:13px;color:var(--text);margin:0 0 4px}aside h3{font-size:12px;color:var(--text);margin:12px 0 4px;font-weight:600}
aside code{font:11px "JetBrains Mono",ui-monospace,monospace;color:var(--text);overflow-wrap:anywhere}
aside .acts{display:flex;gap:4px;flex-wrap:wrap;margin-top:8px}aside .acts button{border:1px solid var(--border);background:transparent;color:var(--text);border-radius:4px;padding:4px 8px;font:inherit;font-size:11px;cursor:pointer}
.chip{font:11px "JetBrains Mono",ui-monospace,monospace;border:1px solid var(--border);border-radius:4px;padding:0 4px;margin-right:4px}
#legend{position:absolute;left:12px;bottom:12px;max-width:380px;background:var(--panel);border:1px solid var(--border);border-radius:8px;padding:8px 12px;font-size:11px;color:var(--muted)}
#trace{position:absolute;left:50%;bottom:12px;transform:translateX(-50%);max-width:min(640px,calc(100% - 24px));display:none;align-items:center;gap:8px;
background:var(--panel);border:1px solid var(--border);border-radius:8px;padding:8px 12px;font-size:12px;color:var(--text2)}
#trace.on{display:flex}#trace button{border:0;background:transparent;color:var(--text2);cursor:pointer;font:inherit;padding:4px}
#trace .t{color:var(--text);font-weight:600}#trace .c{font:11px "JetBrains Mono",ui-monospace,monospace;overflow-wrap:anywhere}
@media (max-width:640px){aside{left:12px;width:auto}#legend{display:none}input{width:140px}}
`;

// The first-view rule is readableViewport() in archLayout.ts; this is its
// port into the page, pinned by the browser test's label-height check.
const JS = `
const D=JSON.parse(document.getElementById("vg-data").textContent);
const W=${CARD_W},FLOOR=${LEGIBLE_LABEL_PX}/13;
const ACC={frontend:"--config",backend:"--thread",scripts:"--thread",agent:"--thread",pipeline:"--thread",platform:"--iow",database:"--iow",cache:"--iom",queue:"--io",model:"--io",cloud:"--io",external:"--io",unknown:"--muted"};
const node=Object.fromEntries(D.nodes.map(n=>[n.id,n])),edge=Object.fromEntries(D.edges.map(e=>[e.id,e])),grp=Object.fromEntries(D.groups.map(g=>[g.id,g]));
const svg=document.getElementById("map"),aside=document.getElementById("panel"),find=document.getElementById("find"),bar=document.getElementById("trace");
const E=s=>String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const cut=(s,n)=>s.length>n?s.slice(0,n-1)+"\\u2026":s;
let lens=(()=>{try{return localStorage.getItem("vg-arch-html-lens")||"overview"}catch{return "overview"}})();if(!D.lenses[lens])lens="overview";
let vb=null,sel=null,trace=null,pick=null,beat=-1,timer=null;
function rounded(p){let d="M"+p[0][0]+","+p[0][1];for(let i=1;i<p.length-1;i++){const[a,b]=p[i-1],[x,y]=p[i],[c,e]=p[i+1];const r=Math.min(8,Math.hypot(x-a,y-b)/2,Math.hypot(c-x,e-y)/2);d+=" L"+(x-Math.sign(x-a)*r)+","+(y-Math.sign(y-b)*r)+" Q"+x+","+y+" "+(x+Math.sign(c-x)*r)+","+(y+Math.sign(e-y)*r);}const l=p[p.length-1];return d+" L"+l[0]+","+l[1];}
function draw(){
  const L=D.lenses[lens];const pos={};for(const n of L.nodes)if(!n.g)pos[n.id]=n;
  let o="";
  for(const n of L.nodes)if(n.g){const g=grp[n.g];const prop=g.source==="proposed",inf=prop&&!(g.evidence||[]).length;const c=prop?"var(--proposed)":"var(--config)";
    o+=\`<g class="grp" data-id="\${E(g.id)}" tabindex="0" role="button" aria-label="\${E(g.kind+" "+g.label)}" opacity="\${inf?.6:1}"><rect x="\${n.x}" y="\${n.y}" width="\${n.w}" height="\${n.h}" rx="16" fill="color-mix(in oklab,\${c} 5%,transparent)" stroke="\${c}" stroke-dasharray="\${prop?"6 4":""}"/><text x="\${n.x+12}" y="\${n.y+20}">\${E(g.label)} <tspan class="k">\${E(g.kind)}\${prop?(inf?" \\u00b7 proposed \\u00b7 INFERRED":" \\u00b7 proposed"):""}</tspan></text></g>\`;}
  for(const e of L.edges){if(!e.p||e.p.length<2)continue;
    const c=e.hop?"var(--thread)":\`var(\${ACC[(node[e.t]||{}).category]||"--muted"})\`;
    const lw=e.label?e.label.length*6.6+12:0;
    o+=\`<g class="e\${e.weak?" weak":""}" data-id="\${E(e.id)}" tabindex="0" role="button" aria-label="\${E(((node[e.s]||{}).label||e.s)+" to "+((node[e.t]||{}).label||e.t)+": "+(e.full||e.label))}"><path d="\${rounded(e.p)}" stroke="\${c}" stroke-width="\${e.hop?2:1.5}" opacity="\${e.weak?.55:.85}" stroke-dasharray="\${e.weak?"5 4":""}" marker-end="url(#m)"/>\${e.label&&e.at?\`<rect class="lb" x="\${e.at.cx-lw/2}" y="\${e.at.cy-10}" width="\${lw}" height="20" rx="4"/><text x="\${e.at.cx}" y="\${e.at.cy+4}" text-anchor="middle">\${E(e.label)}</text>\`:""}<title>\${E(e.full||e.label)}</title></g>\`;}
  for(const id in pos){const n=node[id],p=pos[id];const c=\`var(\${ACC[n.category]||"--muted"})\`;
    const chips=[n.dispatches.length?n.dispatches.reduce((k,g)=>k+g.scripts.length,0)+" scripts":"",n.members.length?n.members.length+" tools":"",n.roleStatedBy?"role \\u00b7 "+n.roleStatedBy:"",n.labelSource?"named \\u00b7 "+n.labelSource:"",n.source!=="derived"?n.source:""].filter(Boolean).join("  ");
    o+=\`<g class="n \${n.kind}" data-id="\${E(id)}" tabindex="0" role="button" aria-label="\${E(n.label+", "+n.sublabel)}"><rect x="\${p.x}" y="\${p.y}" width="\${W}" height="\${p.h}" rx="\${n.kind==="tool"?8:14}" stroke="\${c}" stroke-dasharray="\${n.source==="proposed"?"5 4":""}"/><text x="\${p.x+16}" y="\${p.y+23}">\${E(cut(n.label,30))}</text><text class="sub" x="\${p.x+16}" y="\${p.y+41}">\${E(cut(n.sublabel,40))}</text>\${chips&&p.h>60?\`<text class="chip" x="\${p.x+16}" y="\${p.y+66}">\${E(chips)}</text>\`:""}<title>\${E(n.label+"\\n"+n.sublabel)}</title></g>\`;}
  svg.innerHTML=\`<defs><marker id="m" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="var(--text2)"/></marker></defs><g id="vp">\${o}</g>\`;
  if(!vb)fit();else apply();
  document.querySelectorAll("[data-lens]").forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.lens===lens)));
  document.getElementById("empty").style.display=lens==="trust"&&!D.groups.length?"block":"none";
  const h=document.getElementById("hidden");h.textContent=L.hidden.length?L.hidden.length+" unclassified tool"+(L.hidden.length===1?"":"s")+" not drawn here (Tools lens): "+L.hidden.map(x=>x.replace(/^tool:/,"")).join(", "):"";
  document.getElementById("story").style.display=L.story.length?"":"none";
  highlight();
}
function fit(){const b=svg.querySelector("#vp").getBBox(),r=svg.getBoundingClientRect(),pad=24;const aw=Math.max(1,r.width-2*pad),ah=Math.max(1,r.height-2*pad);
  const all=Math.min(aw/b.width,ah/b.height,1.2);let z,x,y;
  if(all>=FLOOR){z=all;x=b.x-(aw/z-b.width)/2;y=b.y-(ah/z-b.height)/2;}else{z=Math.max(Math.min(aw/b.width,1.2),FLOOR);x=b.x;y=b.y;}
  vb=[x-pad/z,y-pad/z,r.width/z,r.height/z];apply();}
function apply(){svg.setAttribute("viewBox",vb.join(" "));}
function edges(){return D.lenses[lens].edges;}
function reach(start,dir){const ns=new Set([start]),es=new Set(),q=[start];while(q.length){const c=q.shift();for(const e of edges()){const[h,t]=dir==="down"?[e.s,e.t]:[e.t,e.s];if(h!==c)continue;es.add(e.id);if(!ns.has(t)){ns.add(t);q.push(t);}}}return{nodes:[...ns],edges:[...es]};}
function route(a,b){const prev={},seen=new Set([a]),q=[a];const es=[...edges()].sort((x,y)=>x.id<y.id?-1:x.id>y.id?1:0);while(q.length){const c=q.shift();if(c===b)break;for(const e of es){if(e.s!==c||seen.has(e.t))continue;seen.add(e.t);prev[e.t]=e;q.push(e.t);}}
  if(!seen.has(b))return null;const ns=[b],hs=[];for(let n=b;n!==a;){const e=prev[n];hs.push(e.id);n=e.s;ns.push(n);}return{nodes:ns.reverse(),edges:hs.reverse()};}
function lbl(id){return (node[id]||{label:id}).label;}
function showTrace(t,html){trace=t;bar.innerHTML=html+\`<button id="tclose" aria-label="Clear trace">\\u00d7</button>\`;bar.classList.add("on");document.getElementById("tclose").onclick=clearTrace;highlight();}
function clearTrace(){trace=null;pick=null;beat=-1;clearInterval(timer);timer=null;bar.classList.remove("on");highlight();}
function storyAt(i){const S=D.lenses[lens].story;beat=Math.max(0,Math.min(S.length-1,i));const b=S[beat];
  showTrace(b,\`<button id="sprev" aria-label="Previous beat">\\u2039</button><button id="splay" aria-label="\${timer?"Pause":"Play"} story">\${timer?"\\u275a\\u275a":"\\u25b6"}</button><button id="snext" aria-label="Next beat">\\u203a</button><div><div class="t" data-story-title>\${beat+1}/\${S.length} \\u00b7 \${E(b.title)}</div><div class="c">\${E(b.caption)}</div></div>\`);
  document.getElementById("sprev").onclick=()=>storyAt(beat-1);document.getElementById("snext").onclick=()=>storyAt(beat+1);
  document.getElementById("splay").onclick=()=>{if(timer){clearInterval(timer);timer=null;storyAt(beat);}else{timer=setInterval(()=>{if(beat>=S.length-1){clearInterval(timer);timer=null;storyAt(beat);}else storyAt(beat+1);},2400);storyAt(beat);}};}
function highlight(){const q=find.value.trim().toLowerCase();
  const near=new Set();if(sel&&!trace){near.add(sel);for(const e of edges()){if(e.id===sel){near.add(e.s);near.add(e.t)}if(e.s===sel||e.t===sel){near.add(e.id);near.add(e.s);near.add(e.t)}}}
  const tn=trace?new Set([...trace.nodes,...trace.edges]):null;
  svg.querySelectorAll(".n,.e").forEach(el=>{const id=el.dataset.id;const n=node[id]||edge[id];
    const hitQ=q&&n&&((n.label||n.protocol||"")+" "+(n.sublabel||"")+" "+id).toLowerCase().includes(q);
    const dim=tn?!tn.has(id):((!!q&&!hitQ&&!el.classList.contains("e"))||(!!sel&&!near.has(id)));
    el.classList.toggle("dim",dim);el.classList.toggle("lit",!!tn&&tn.has(id));el.classList.toggle("hit",!!hitQ||id===sel);});}
function refs(list){return list.length?\`<h3>where in the code</h3>\`+list.map(r=>\`<div><code>\${E(r.file)}\${r.text?" \\u2014 "+E(r.text):""}</code></div>\`).join(""):"";}
function threads(list){return list.length?\`<h3>threads (\${list.length})</h3>\`+list.slice(0,20).map(t=>\`<div><code>\${E(t)}</code></div>\`).join("")+(list.length>20?\`<div>+\${list.length-20} more</div>\`:""):"";}
function show(id){if(pick){const a=pick;pick=null;const t=route(a,id);aside.classList.remove("on");sel=null;
    if(t)showTrace(t,\`<span data-trace-text>Route \${E(lbl(a))} \\u2192 \${E(lbl(id))}: \${t.edges.length} hop\${t.edges.length===1?"":"s"}</span>\`);
    else showTrace({nodes:[a,id],edges:[]},\`<span data-trace-text>No directed route from \${E(lbl(a))} to \${E(lbl(id))} in this lens</span>\`);return;}
  sel=id;const n=node[id],e=edge[id],g=grp[id];let h="";
  if(n){h=\`<h2>\${E(n.label)}</h2><div>\${E(n.sublabel)}</div>\`+(n.members.length?\`<h3>\${n.members.length} tools in this box (the Tools lens draws each)</h3>\`+n.members.map(m=>\`<div><code>\${E(m.replace(/^tool:/,""))}</code></div>\`).join(""):"")+(n.dispatches.length?\`<h3>dispatches \${n.dispatches.reduce((k,g)=>k+g.scripts.length,0)} scripts</h3>\`+n.dispatches.map(g=>\`<details\${n.dispatches.length<=3?" open":""}><summary><code>\${E(g.dir)}/</code> (\${g.scripts.length})</summary>\`+g.scripts.map(s=>\`<div><code>\${E(s.file)}</code></div>\`).join("")+\`</details>\`).join("")+(n.callers.length?\`<details><summary>named by \${n.callers.length} files</summary>\`+n.callers.map(c=>\`<div><code>\${E(c)}</code></div>\`).join("")+\`</details>\`:""):"")+(n.labelSource?\`<div>name \${E(n.labelSource)}; the code calls it \${E(n.derivedLabel)}</div>\`:"")+(n.roleStatedBy?\`<div>role stated by \${E(n.roleStatedBy)}, not a table</div>\`:"")+(n.wrappedBy.length?\`<div>project funnels: <code>\${E(n.wrappedBy.join(", "))}</code></div>\`:"")
    +\`<div class="acts"><button data-act="up">Upstream</button><button data-act="down">Downstream</button><button data-act="route">Route from here\\u2026</button></div>\`+threads(n.threads)+refs(n.refs);}
  else if(e){h=\`<h2>\${E(lbl(e.from))} \\u2192 \${E(lbl(e.to))}</h2><div><code>\${E(e.protocol)}</code></div><div>why: \${E(e.basis)}</div><div>\${e.kind==="uses"?"calls":e.kind+" hops"} \\u00b7 \${e.count} \\u00b7 confidence \${E(e.confidence)}\${e.via.length?" \\u00b7 via "+E(e.via.join(", ")):""}</div>\`;
    if(e.payloads.length)h+=\`<h3>what crosses it</h3>\`+e.payloads.map(p=>\`<div><span class="chip">\${p.side==="caller"?"sends":p.side==="callee"?"accepts":E(p.side)}</span><span class="chip">\${E(p.source)}</span><code>\${E(p.text)}</code>\${p.keys&&p.keys.length?\`<div>keys: <code>\${E(p.keys.join(", "))}</code></div>\`:""}\${p.note?\`<div>\${E(p.note)}</div>\`:""}</div>\`).join("");
    h+=threads(e.threads)+refs(e.refs);}
  else if(g){h=\`<h2>\${E(g.label)}</h2><div>\${E(g.kind)} \\u00b7 \${g.source==="stated"?"stated in .vibegraph/architecture.json":(g.evidence||[]).length?"proposed, not ratified":"proposed, INFERRED \\u2014 no evidence cited"}</div><h3>wraps</h3>\`+g.wraps.map(w=>\`<div><code>\${E((node[w]||grp[w]||{label:w}).label)}</code></div>\`).join("")+((g.evidence||[]).length?\`<h3>evidence</h3>\`+g.evidence.map(x=>\`<div><code>\${E(x)}</code></div>\`).join(""):"");}
  aside.innerHTML=h+\`<p><button class="tool" id="close">close</button></p>\`;aside.classList.toggle("on",!!h);
  aside.querySelectorAll("[data-act]").forEach(b=>b.onclick=()=>{const a=b.dataset.act;aside.classList.remove("on");sel=null;
    if(a==="route"){pick=id;showTrace({nodes:[id],edges:[]},\`<span data-trace-text>Route from \${E(lbl(id))}: click the box to route to</span>\`);return;}
    const t=reach(id,a);showTrace(t,\`<span data-trace-text>\${a==="down"?"Downstream":"Upstream"} of \${E(lbl(id))}: \${t.nodes.length-1} boxes, \${t.edges.length} edges</span>\`);});
  const c=document.getElementById("close");if(c)c.onclick=()=>{sel=null;aside.classList.remove("on");highlight();};highlight();}
svg.addEventListener("click",ev=>{if(moved)return;const t=ev.target.closest(".n,.e,.grp");if(t)show(t.dataset.id);else{sel=null;aside.classList.remove("on");highlight();}});
svg.addEventListener("keydown",ev=>{if(ev.key!=="Enter"&&ev.key!==" ")return;const t=ev.target.closest&&ev.target.closest(".n,.e,.grp");if(t){ev.preventDefault();show(t.dataset.id);}});
let drag=null,moved=false;
svg.addEventListener("pointerdown",ev=>{drag={x:ev.clientX,y:ev.clientY,vb:vb.slice()};moved=false;});
window.addEventListener("pointermove",ev=>{if(!drag)return;const r=svg.getBoundingClientRect(),k=vb[2]/r.width;const dx=ev.clientX-drag.x,dy=ev.clientY-drag.y;if(Math.abs(dx)+Math.abs(dy)>3)moved=true;vb=[drag.vb[0]-dx*k,drag.vb[1]-dy*k,vb[2],vb[3]];apply();});
window.addEventListener("pointerup",()=>{drag=null;setTimeout(()=>{moved=false},0);});
svg.addEventListener("wheel",ev=>{ev.preventDefault();const r=svg.getBoundingClientRect();const f=ev.deltaY>0?1.1:1/1.1;const px=vb[0]+(ev.clientX-r.left)/r.width*vb[2],py=vb[1]+(ev.clientY-r.top)/r.height*vb[3];vb=[px-(px-vb[0])*f,py-(py-vb[1])*f,vb[2]*f,vb[3]*f];apply();},{passive:false});
document.querySelectorAll("[data-lens]").forEach(b=>b.onclick=()=>{lens=b.dataset.lens;try{localStorage.setItem("vg-arch-html-lens",lens)}catch{}vb=null;sel=null;clearTrace();aside.classList.remove("on");draw();});
document.getElementById("fit").onclick=fit;
document.getElementById("story").onclick=()=>storyAt(0);
document.getElementById("theme").onclick=()=>{const r=document.documentElement;const cur=r.dataset.theme||(matchMedia("(prefers-color-scheme: light)").matches?"light":"dark");r.dataset.theme=cur==="light"?"dark":"light";};
find.addEventListener("input",highlight);
document.addEventListener("keydown",ev=>{if(ev.key==="Escape"){sel=null;find.value="";aside.classList.remove("on");clearTrace();}});
draw();
`;

export function renderArchHtml(model: ArchModelRecord, opts: ArchHtmlOptions): string {
  const data = JSON.stringify(archHtmlData(model)).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
  const u = model.unplaced;
  const left = [
    u.tests ? `${u.tests} tests` : "",
    u.unmatchedHops ? `${u.unmatchedHops} unmatched hops` : "",
    u.toolsPresentNotCalled.length ? `${u.toolsPresentNotCalled.length} tools present, never called` : "",
    u.unattributedBoundaries ? `${u.unattributedBoundaries} unattributed call sites` : "",
  ].filter(Boolean);
  const lensLabel: Record<string, string> = { birdseye: "Bird's-eye", overview: "Overview", tools: "Tools", flows: "Flows", payloads: "Payloads", trust: "Trust" };
  const primary = model.primaryPath ? `<div>start here (${esc(model.primaryPath.source)}): ${esc(model.primaryPath.entryPoints.join(", "))}</div>` : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(opts.title)} architecture</title>
<meta name="generator" content="${esc(opts.tool ?? "VibeGraph")}">
<style>${CSS}</style>
</head>
<body>
<header>
<h1>${esc(opts.title)}</h1>
<span class="meta">derived from the code by ${esc(opts.tool ?? "VibeGraph")}${opts.commit ? ` at ${esc(opts.commit)}` : ""} · ${model.nodes.length} boxes · ${model.edges.length} edges</span>
<div class="bar" role="group" aria-label="Lens">${ARCH_LENSES.map((l) => `<button data-lens="${l}" aria-pressed="false">${lensLabel[l] ?? l}</button>`).join("")}</div>
<input id="find" type="search" placeholder="find a box or protocol" aria-label="Find">
<button class="tool" id="story" style="display:none">Play start-here path</button>
<button class="tool" id="fit">fit</button><button class="tool" id="theme">theme</button>
</header>
<main>
<svg id="map" role="group" aria-label="${esc(opts.title)} architecture: boxes and edges are focusable, Enter opens one"></svg>
<div id="empty" style="display:none;position:absolute;top:16px;left:16px;color:var(--muted)">No deployment or trust boundary is stated yet: the Trust lens draws only edges that cross one.</div>
<aside id="panel" aria-live="polite"></aside>
<div id="trace" role="status"></div>
<div id="legend">
<div>solid = seen called · dashed = ambiguous, presence-only or unclassified</div>
<div>boxes around cards: solid = stated · dashed = proposed · faint = INFERRED</div>
${primary}${left.length ? `<div>not drawn: ${esc(left.join(" · "))}</div>` : ""}
<div id="hidden"></div>
</div>
</main>
<script type="application/json" id="vg-data">${data}</script>
<script>${JS}</script>
</body>
</html>
`;
}
