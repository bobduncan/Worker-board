import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {execFileSync} from 'node:child_process'
import {integrateCandidate,recoverIntegration} from '../../src/work/routing/integration.mjs'
test('only the reviewed head fast-forwards; a moved target is left untouched',async()=>{
  const root=await mkdtemp(join(tmpdir(),'routing-git-'));const git=(...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',windowsHide:true}).trim()
  try{
    git('init','-b','main');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');await writeFile(join(root,'one'),'base');git('add','.');git('commit','-m','base');const base=git('rev-parse','HEAD')
    git('checkout','-b','feature');await writeFile(join(root,'one'),'approved');git('commit','-am','candidate');const head=git('rev-parse','HEAD'),tree=git('rev-parse','HEAD^{tree}');git('checkout','main')
    const candidate={id:'candidate',checks:{passed:true},review:{approved:true},components:[{repoKey:'board',baseSha:base,headSha:head,treeHash:tree}]}
    const journal={save:async()=>{}}
    assert.equal((await integrateCandidate({candidate,repositories:{board:{root,base:'main'}},journal})).status,'completed')
    assert.equal(git('rev-parse','HEAD'),head)
    await writeFile(join(root,'two'),'later');git('add','.');git('commit','-m','later');const moved=git('rev-parse','HEAD')
    assert.equal((await integrateCandidate({candidate,repositories:{board:{root,base:'main'}},journal})).status,'held')
    assert.equal(git('rev-parse','HEAD'),moved)
  }finally{await rm(root,{recursive:true,force:true})}
})
test('a partial integration cannot be blindly repeated after restart',()=>{
  const journal={candidateId:'c',components:[{repoKey:'a',baseSha:'old-a',headSha:'new-a'},{repoKey:'b',baseSha:'old-b',headSha:'new-b'}]}
  assert.equal(recoverIntegration({journal,currentGitFacts:{a:'new-a',b:'old-b'}}).status,'held')
  assert.equal(recoverIntegration({journal,currentGitFacts:{a:'new-a',b:'new-b'}}).status,'integrated')
})
