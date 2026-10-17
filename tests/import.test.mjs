import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const root=new URL('../',import.meta.url);
async function appEnvironment() {
  const elements=new Map(),saved=new Map();
  function element(id) {
    if(!elements.has(id)) {
      const classes=new Set();
      elements.set(id,{textContent:'',classList:{contains:name=>classes.has(name),add:name=>classes.add(name),remove:name=>classes.delete(name),toggle(name,on){on?classes.add(name):classes.delete(name);}}});
    }
    return elements.get(id);
  }
  function node() {return {gain:{value:1},connect(){},threshold:{},knee:{},ratio:{},attack:{},release:{}};}
  class Audio {
    state='suspended';destination={};
    createGain(){return node();}
    createDynamicsCompressor(){return node();}
    addEventListener(){}
    decodeAudioData(bytes,success){
      assert(Buffer.from(bytes).includes(Buffer.from('soun')));
      assert(!Buffer.from(bytes).includes(Buffer.from('vide')));
      success({sampleRate:44100,length:66150,numberOfChannels:1,duration:1.5,getChannelData:()=>new Float32Array(66150).fill(.1)});
    }
  }
  const database={transaction(){const tx={objectStore:name=>({put(value,key){saved.set(name==='sounds'?'sound-'+value.id:key,value);}})};queueMicrotask(()=>tx.oncomplete());return tx;}};
  const context=vm.createContext({document:{getElementById:element,body:element('body')},window:{webkitAudioContext:Audio},
    Blob,TextEncoder,TextDecoder,atob,setTimeout:(callback,ms)=>{const timer=setTimeout(callback,ms);if(ms>100)timer.unref();return timer;},clearTimeout,setInterval,clearInterval,__database:database});
  const modules=new Map(),entry=new URL('js/app.js',root).href;
  function module(url) {
    if(!modules.has(url)) {
      let source=readFileSync(new URL(url),'utf8');
      if(url===entry)source=source.replace('initializeSampler();\ninitializePwa({ beforeUpdate: prepareAppUpdate });',
        'ready=true; db=__database; renderAll=()=>{}; stopVoice=()=>{}; export { importAudio }; export const testPad=index=>pads[index];');
      modules.set(url,new vm.SourceTextModule(source,{context,identifier:url}));
    }
    return modules.get(url);
  }
  const app=module(entry);await app.link((specifier,from)=>module(new URL(specifier,from.identifier).href));await app.evaluate();
  return {app:app.namespace,element,saved};
}
test('actual import handler replaces and saves the selected pad with video audio',async()=>{
  const e=await appEnvironment();
  const blob=Object.assign(new Blob([readFileSync(new URL('tests/fixtures/video/aac-video.mov',root))],{type:'video/quicktime'}),{name:'IMG_0123.MOV'});
  await e.app.importAudio([blob],12);
  assert.equal(e.app.testPad(12).name,'IMG_0123');
  assert.equal(e.app.testPad(12).audio.channels[0].length,66150);
  assert.equal(e.saved.get('sound-12').audio.channels[0].length,66150);
  assert.equal(e.saved.get('current').bank,1);
  assert.match(e.element('importStatus').textContent,/取込・保存完了/);
  assert.equal(e.element('body').classList.contains('busy'),false);
});
test('failed video import preserves existing PCM and leaves a readable result',async()=>{
  const e=await appEnvironment();
  const valid=Object.assign(new Blob([readFileSync(new URL('tests/fixtures/video/aac-video.mp4',root))],{type:'video/mp4'}),{name:'valid.mp4'});
  await e.app.importAudio([valid],0);
  const original=e.app.testPad(0),saved=e.saved.get('sound-0');
  const silent=Object.assign(new Blob([readFileSync(new URL('tests/fixtures/video/no-audio.mp4',root))],{type:'video/mp4'}),{name:'silent.mp4'});
  await e.app.importAudio([silent],0);
  assert.equal(e.app.testPad(0),original);
  assert.equal(e.saved.get('sound-0'),saved);
  assert.match(e.element('importStatus').textContent,/音声トラックがありません/);
  assert.equal(e.element('body').classList.contains('busy'),false);
});
test('file picker includes video files as well as audio files',()=>{
  const markup=readFileSync(new URL('index.html',root),'utf8');
  const picker=markup.match(/<input\b[^>]*id="audioFiles"[^>]*>/)[0];
  assert.match(picker,/audio\/\*/);assert.match(picker,/video\/\*/);assert.match(picker,/\.mov/);assert.match(picker,/\.mp4/);
});
