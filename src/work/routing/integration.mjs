import {realpath} from 'node:fs/promises'
import {runCommand} from './validation.mjs'
import {candidateEvidenceMatches} from './candidates.mjs'

const locks=new Set()
async function git(root,args,runner){const result=await runner({executable:'git',args:['-C',root,...args],cwd:root,timeoutMs:120000});if(result.exitCode!==0||result.timedOut||result.error)throw Error('Git operation failed or its outcome is unknown.');return result.stdout.trim()}
export async function integrateCandidate({candidate,repositories,journal,runner=runCommand,signal}){
  const state={candidateId:candidate?.id,status:'held',components:[],reason:null}
  if(!candidate?.checks?.passed||!candidate?.review?.approved||!candidateEvidenceMatches(candidate,candidate.checks)||!candidateEvidenceMatches(candidate,candidate.review)||!candidate.components?.length)return {...state,reason:'Required exact-candidate checks/review are not approved.'}
  if(typeof journal?.save!=='function')return {...state,reason:'A durable integration journal is required.'}
  const held=[]
  try{
    for(const component of candidate.components){
      const configured=repositories?.[component.repoKey]
      if(!configured?.root||!/^[-\w./]+$/.test(configured.base??''))throw Error('A configured target repository and branch are required.')
      const root=await realpath(configured.root)
      const identity=path=>process.platform==='win32'?String(path).replaceAll('\\','/').toLowerCase():path
      if(component.targetBranch!==configured.base||identity(component.repositoryId)!==identity(root))throw Error('Approved target branch or repository identity changed; resubmit.')
      const common=await git(root,['rev-parse','--path-format=absolute','--git-common-dir'],runner)
      const lock=common.toLowerCase();if(locks.has(lock))throw Error('Another integration holds this repository.')
      locks.add(lock);held.push(lock)
      const branch=await git(root,['branch','--show-current'],runner),target=await git(root,['rev-parse',configured.base],runner)
      if(branch!==configured.base||target!==component.baseSha)throw Error('Target branch changed; resubmit against its current revision.')
      if(await git(root,['status','--porcelain'],runner)!=='')throw Error('Target checkout has uncommitted work.')
      if(await git(root,['rev-parse',`${component.headSha}^{tree}`],runner)!==component.treeHash)throw Error('Candidate tree changed.')
      await git(root,['merge-base','--is-ancestor',component.baseSha,component.headSha],runner)
      state.components.push({...component,root,base:configured.base,status:'pending'})
    }
    state.status='prepared';await journal.save(structuredClone(state))
    for(const component of state.components){
      if(signal?.aborted)throw Error('Integration cancelled; inspect the journal before resuming.')
      if(await git(component.root,['rev-parse',component.base],runner)!==component.baseSha)throw Error('Target moved after approval; no merge was attempted.')
      state.status='integrating';component.status='starting';await journal.save(structuredClone(state))
      await git(component.root,['merge','--ff-only',component.headSha],runner)
      if(await git(component.root,['rev-parse',component.base],runner)!==component.headSha)throw Error('Integrated target differs from the approved candidate.')
      component.status='integrated';await journal.save(structuredClone(state))
    }
    state.status='completed';await journal.save(structuredClone(state));return state
  }catch(error){state.status='held';state.reason=error.message;await journal.save(structuredClone(state));return state}
  finally{for(const lock of held)locks.delete(lock)}
}
export function recoverIntegration({journal,currentGitFacts}){
  if(!journal?.components?.length)return {status:'held',nextSafeAction:'Inspect the incomplete journal; no merge is replayed.'}
  if(journal.components.every(c=>currentGitFacts[c.repoKey]===c.headSha))return {status:'integrated',nextSafeAction:'Verify backup and report checks; do not repeat integration.'}
  return {status:'held',nextSafeAction:'Inspect partial or changed repositories and approve a recovery plan before further integration.'}
}
