import {spawn} from 'node:child_process'
import {realpath} from 'node:fs/promises'
import {isAbsolute} from 'node:path'

export function runCommand({executable,args,cwd,signal,timeoutMs=900000}){
  return new Promise(resolve=>{
    let stdout='',stderr='',ended=false,timedOut=false
    const finish=result=>{if(ended)return;ended=true;clearTimeout(timer);signal?.removeEventListener('abort',stop);resolve({...result,stdout,stderr,timedOut})}
    const child=spawn(executable,args,{cwd,shell:false,windowsHide:true,stdio:['ignore','pipe','pipe']})
    const stop=()=>{timedOut=true;if(process.platform==='win32'&&child.pid){const killer=spawn('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});killer.on('error',()=>child.kill())}else child.kill('SIGTERM')}
    const timer=setTimeout(stop,timeoutMs)
    child.stdout?.on('data',data=>{stdout=(stdout+String(data)).slice(-65536)})
    child.stderr?.on('data',data=>{stderr=(stderr+String(data)).slice(-65536)})
    child.on('error',error=>finish({exitCode:null,error:error.code??'spawn failed'}))
    child.on('close',code=>finish({exitCode:code}))
    signal?.addEventListener('abort',stop,{once:true});if(signal?.aborted)stop()
  })
}
export function createValidationQueue(run){let tail=Promise.resolve();return value=>{const result=tail.then(()=>run(value));tail=result.catch(()=>{});return result}}
export async function runValidation({candidate,profile,runner=runCommand,signal}){
  const base={candidateId:candidate?.id,fingerprint:candidate?.fingerprint,profileHash:candidate?.profileHash,at:Date.now()}
  const fail=why=>({...base,passed:false,checks:[],why})
  if(!candidate||!profile||profile.hash!==candidate.profileHash)return fail('Validation profile changed or is unavailable.')
  if(!isAbsolute(profile.cwd??'')||!Array.isArray(profile.commands)||!profile.commands.length)return fail('A configured candidate worktree and validation commands are required.')
  let cwd;try{cwd=await realpath(profile.cwd)}catch{return fail('Candidate worktree cannot be resolved.')}
  if(profile.allowedRoot){let root;try{root=await realpath(profile.allowedRoot)}catch{return fail('Configured worktree root unavailable.')};if(cwd.toLowerCase()!==root.toLowerCase())return fail('Validation cwd is not the configured candidate worktree.')}
  const checks=[]
  for(const command of profile.commands){
    if(typeof command.id!=='string'||!isAbsolute(command.executable??'')||!Array.isArray(command.args)||command.args.some(arg=>typeof arg!=='string')||command.shell)return fail('Validation commands use configured absolute executables and argv arrays, never task shell text.')
    if(signal?.aborted)return {...base,passed:false,checks,why:'Validation cancelled.'}
    const result=await runner({...command,cwd,signal,timeoutMs:Math.min(command.timeoutMs??900000,900000)})
    checks.push({id:command.id,...result,passed:result.exitCode===0&&!result.timedOut&&!result.error})
  }
  return {...base,passed:checks.every(check=>check.passed),checks}
}
