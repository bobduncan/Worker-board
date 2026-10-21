/* Spending reads aggregate local usage. It never calls a model or changes a quality floor. */
(() => {
  'use strict'
  let selected='7',lastState=null,lastKey='',message=''
  const dollars=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:2}).format(n)
  const count=n=>n===null||n===undefined?'Unknown':new Intl.NumberFormat(undefined,{notation:'compact',maximumFractionDigits:1}).format(n)
  function costLabel(summary){if(summary?.coverage?.unavailable)return 'Unavailable';const {low=0,high=0}=summary?.knownCost??{};return !low&&!high&&summary?.unknownCostMessages?'Unknown':Math.abs(high-low)<.005?dollars(low):`${dollars(low)}–${dollars(high)}`}
  function qualityLabel(summary){return summary?.qualitySample>0?`${summary.firstPassPercent}%`:'Not measured'}
  function node(tag,className,text){const n=document.createElement(tag);if(className)n.className=className;if(text!==undefined)n.textContent=String(text);return n}
  const add=(parent,...children)=>{for(const child of children)parent.append(child);return parent}
  function metric(title,value,note){return add(node('section','spending-metric'),node('p','spending-eyebrow',title),node('strong','spending-number',value),node('p','spending-muted',note))}
  function rowsTable(title,rows,{keyLabel='Name',task=false,open=false}={}){
    const detail=node('details','spending-table-panel');detail.dataset.spendingDetail=title;detail.open=open
    detail.append(node('summary','',title))
    const wrapper=node('div','spending-table-scroll'),table=node('table','spending-table'),head=node('thead'),body=node('tbody')
    const tr=node('tr');for(const t of [keyLabel,'Messages','Estimated USD'])tr.append(node('th','',t));head.append(tr)
    for(const row of rows.slice(0,100)){
      const line=node('tr'),name=node('td'),text=task&&row.outcome?.title?`${row.key} · ${row.outcome.title}`:row.key
      name.append(node('span','',text));if(task&&row.outcome)name.append(node('small','spending-muted',row.outcome.accepted?'Finished':row.outcome.attempts>1?'Open · repairs included':'Open / unfinished'))
      const cost=costLabel({knownCost:row,unknownCostMessages:row.unknown});add(line,name,node('td','',count(row.messages)),node('td','',`${cost}${row.unknown&&row.high?' + unknown':''}`));body.append(line)
    }
    if(!rows.length){const line=node('tr'),cell=node('td','spending-muted','No reported usage in this period.');cell.colSpan=3;line.append(cell);body.append(line)}
    add(table,head,body);wrapper.append(table);detail.append(wrapper)
    if(rows.length>100)detail.append(node('p','spending-muted',`Showing the 100 most expensive of ${rows.length}. CSV includes all aggregate rows.`))
    return detail
  }
  function download(summary){
    const cell=value=>{const t=String(value??'');return `"${/^[=+@\-\t\r]/.test(t)?"'":''}${t.replaceAll('"','""')}"`}
    const rows=[['Category','Name','Messages','Estimated cost low USD','Estimated cost high USD','Unknown-cost messages']]
    for(const key of ['scope','pendingFiles','pendingBytes','childTranscripts','unavailableTranscripts','unknownMessages','skippedLongLines','discoveryLimited','retentionLimited','unavailable','problem'])if(summary.coverage?.[key]!==undefined)rows.push(['coverage',`${key}: ${summary.coverage[key]}`])
    for(const category of ['models','efforts','chats','phases','tasks','daily'])for(const r of summary[category]??[])rows.push([category,r.key,r.messages,r.low,r.high,r.unknown])
    const blob=new Blob(['\uFEFF'+rows.map(r=>r.map(cell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'})
    const url=URL.createObjectURL(blob),link=node('a');link.href=url;link.download=`worker-board-spending-${selected}-days.csv`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
  }
  async function changeMode(value,select,status){
    select.disabled=true;message=''
    try{
      const answer=await fetch('/api/settings',{method:'POST',headers:{'Content-Type':'application/json','X-Board-Token':document.querySelector('meta[name="board-token"]').content},body:JSON.stringify({key:'routingMode',value})})
      const result=await answer.json();if(!answer.ok||result.ok===false)throw Error(result.why??result.error??'The setting could not be saved.')
      lastState.routing={...lastState.routing,mode:value};message='Saved. This changes recommendations only; automatic execution remains held.';draw(lastState,true)
    }catch(error){message=error.message;status.textContent=message;select.value=lastState.routing?.mode==='observe'?'observe':'off'}finally{select.disabled=false}
  }
  function draw(state,force=false){
    lastState=state
    const root=document.getElementById('spending-content');if(!root)return
    const summary=state.spending?.periods?.[selected]
    const key=JSON.stringify({selected,summary:summary?{...summary,until:0,coverage:{...summary.coverage,lastScanAt:0,collecting:false}}:null,routing:state.routing,quota:state.limits?.week?.used,message})
    if(!force&&key===lastKey)return;lastKey=key
    const opened=new Map([...root.querySelectorAll('details[data-spending-detail]')].map(d=>[d.dataset.spendingDetail,d.open]))
    root.replaceChildren()
    const header=node('header','spending-head'),intro=add(node('div'),node('p','spending-eyebrow','WORKER BOARD INSIGHTS'),node('h1','','Spending'),node('p','spending-muted','See where usage goes and which changes are worth keeping.'))
    const controls=node('div','spending-controls'),label=node('label','','Period '),select=node('select')
    select.setAttribute('aria-label','Spending period')
    for(const [value,text]of [['1','Last 24 hours'],['7','Last 7 days'],['30','Last 30 days'],['all','All recorded']]){const option=node('option','',text);option.value=value;option.selected=selected===value;select.append(option)}
    select.addEventListener('change',()=>{selected=select.value;draw(lastState,true)});label.append(select);controls.append(label)
    const exportButton=node('button','spending-button','Export CSV');exportButton.disabled=!summary?.messages;exportButton.addEventListener('click',()=>download(summary));controls.append(exportButton);add(header,intro,controls);root.append(header)
    if(!summary){root.append(node('p','spending-notice','Spending collection starts after the board reads its local transcripts. No model calls are needed.'));return}
    if(state.isDemo)root.append(node('p','spending-notice','Demo board — sample figures for previewing the view, not your account spending.'))
    root.append(node('p','spending-notice','API-equivalent estimates for comparing work. These are not extra charges, your subscription bill, or an exact conversion of your weekly allowance.'))
    const gaps=summary.coverage??{}
    if(gaps.unavailable)root.append(node('p','spending-notice',gaps.problem??'Spending is unavailable; local history is preserved.'))
    else if(gaps.pendingFiles||gaps.pendingBytes||gaps.unavailableTranscripts||gaps.discoveryLimited)root.append(node('p','spending-notice',`Incomplete coverage: ${count(gaps.pendingFiles??0)} files await scanning, ${count(gaps.pendingBytes??0)} known bytes remain, ${count(gaps.unavailableTranscripts??0)} transcripts unavailable.${gaps.discoveryLimited?' Some child files could not be discovered.':''} Costs will change as collection catches up.`))
    const cards=node('div','spending-metrics')
    add(cards,metric('Estimated usage cost',costLabel(summary),summary.unknownCostMessages?`${count(summary.unknownCostMessages)} messages have unknown costs; known costs only.`:'Includes cached tokens and all observed work.'),metric('Finished tasks',count(summary.accepted),'Unfinished and rejected work still contributes to spending.'),metric('Linked to a task',summary.attributionPercent===null?'Not measured':`${summary.attributionPercent}%`,'Unassigned coordination and review remain visible.'),metric('First-pass results',qualityLabel(summary),summary.qualitySample?`Based on ${summary.qualitySample} tasks with measured attempts.`:'Needs attempt history; no quality claim yet.'))
    root.append(cards)
    const allowance=node('p','spending-muted'),limits=state.limits??{},pieces=[]
    for(const [key,label]of [['week','Weekly'],['fiveHour','Five-hour']]){const value=limits[key];if(value?.used!==undefined&&value?.used!==null)pieces.push(`${label}: ${value.used}% used${value.at?` (read ${new Date(value.at).toLocaleString()})`:''}`)}
    if(pieces.length){allowance.textContent=`Claude allowance across all chats — ${pieces.join(' · ')}. This is separate from the cost estimates below.`;root.append(allowance)}
    const grid=node('div','spending-grid'),trend=add(node('section','spending-panel'),node('h2','','Daily usage cost'),node('p','spending-muted','Estimated USD, by UTC day. The chart shows known costs.'))
    if(summary.daily.length){const chart=node('div','spending-chart'),max=Math.max(...summary.daily.map(d=>d.high),.00001);for(const day of summary.daily.slice(-31)){const column=node('div','spending-chart-column'),bar=node('div','spending-chart-bar');bar.style.height=`${Math.max(day.high>0?3:0,day.high/max*140)}px`;bar.title=`${day.key}: ${dollars(day.low)}–${dollars(day.high)}`;bar.setAttribute('role','img');bar.setAttribute('aria-label',bar.title);add(column,bar,node('small','',day.key.slice(5)));chart.append(column)}trend.append(chart)}else trend.append(node('p','spending-empty','No reported usage in this period yet.'))
    const tuning=add(node('section','spending-panel'),node('h2','','What to investigate'))
    const list=node('ul','spending-suggestions');for(const suggestion of summary.suggestions)list.append(node('li','',suggestion.text));tuning.append(list);tuning.append(node('p','spending-muted',summary.comparison.why));add(grid,trend,tuning);root.append(grid)
    const tables=node('div','spending-grid')
    for(const [title,data,options]of [['By model',summary.models,{open:true}],['Planning, review and repair',summary.phases,{open:true}],['By chat',summary.chats,{}],['By effort',summary.efforts,{}],['Most expensive tasks',summary.tasks,{task:true,keyLabel:'Task'}]]){const table=rowsTable(title,data,options);if(opened.has(title))table.open=opened.get(title);tables.append(table)}root.append(tables)
    const setup=add(node('section','spending-panel spending-routing'),node('h2','','Routing and quality safeguards'))
    const modeLabel=node('label','','Recommendations '),mode=node('select');mode.setAttribute('aria-label','Routing recommendations')
    for(const [value,text]of [['off','Off'],['observe','Observe']]){const option=node('option','',text);option.value=value;option.selected=state.routing?.mode===value;mode.append(option)}
    const status=node('p','spending-muted',message);status.setAttribute('role','status');mode.addEventListener('change',()=>changeMode(mode.value,mode,status));modeLabel.append(mode);setup.append(modeLabel)
    setup.append(node('p','spending-muted',state.routing?.problem??state.routing?.readiness?.why??'Automatic cheaper execution requires verified chat controls.'))
    setup.append(node('p','spending-muted','Proposed baseline: Sonnet for Main and normal work; Haiku for verified narrow tasks; Opus for critical decisions. A lower-cost model never waives checks or independent review.'));setup.append(status);root.append(setup)
    const coverage=add(node('details','spending-panel'),node('summary','','Sources, coverage and observed tokens'));coverage.dataset.spendingDetail='coverage';coverage.open=opened.get('coverage')??false
    for(const [name,value]of Object.entries(summary.tokens))coverage.append(node('p','spending-muted',`${name}: ${count(value)} reported tokens`))
    coverage.append(node('p','spending-muted',`${summary.coverage.scope} ${summary.coverage.lastScanAt?`Last scan: ${new Date(summary.coverage.lastScanAt).toLocaleString()}.`:''}`))
    coverage.append(node('p','spending-muted',`${count(summary.coverage.childTranscripts??0)} native child transcripts discovered; their reported costs are included as scanned. Child usage without an explicit task link remains unattributed.`))
    if(summary.coverage.problem)coverage.append(node('p','spending-notice',summary.coverage.problem))
    if(summary.coverage.retentionLimited)coverage.append(node('p','spending-notice','History is limited to the latest 50,000 recorded messages. All recorded means retained history.'))
    if(summary.coverage.pendingBytes)coverage.append(node('p','spending-muted',`${count(summary.coverage.pendingBytes)} bytes of historical transcripts remain to be scanned. Figures are incomplete while this catches up.`))
    if(summary.coverage.skippedLongLines)coverage.append(node('p','spending-notice',`${summary.coverage.skippedLongLines} oversized transcript lines were excluded; their usage is unknown.`))
    if(summary.coverage.unknownMessages)coverage.append(node('p','spending-notice',`${summary.coverage.unknownMessages} messages could not be safely identified and are excluded.`))
    const price=node('a','',`Price basis: ${summary.priceBasis.date}, USD. Cache write duration is shown as a range.`);price.href=summary.priceBasis.source;price.target='_blank';price.rel='noopener noreferrer';coverage.append(price)
    const week=state.limits?.week;if(week?.used!==undefined&&week?.used!==null)coverage.append(node('p','spending-muted',`Account-wide weekly allowance: ${week.used}% used${week.at?`, read ${new Date(week.at).toLocaleString()}`:''}. Other projects and chats share this allowance.`))
    root.append(coverage)
  }
  window.BoardSpending={draw,costLabel,qualityLabel}
})()
