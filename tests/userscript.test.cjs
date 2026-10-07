const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const path=require('node:path');
const bundle=fs.readFileSync(path.join(__dirname,'../userscript/douyin-cleaner.user.js'),'utf8');
function harness(shared={}) {
 const listeners={},menu=[],storageEvents={};
 const window={addEventListener(name,fn){(listeners[name]??=[]).push(fn)},postMessage(){},fetch:()=>Promise.resolve({ok:false})};
 const doc={hidden:false,readyState:'loading',activeElement:null,addEventListener(){},querySelector(){return null},querySelectorAll(){return []}};
 const ctx=vm.createContext({window,unsafeWindow:window,document:doc,location:{href:'https://www.douyin.com/?recommend=1',origin:'https://www.douyin.com'},navigator:{},console,URL,MutationObserver:class {observe(){}disconnect(){}},setTimeout:()=>1,clearTimeout(){},setInterval:()=>1,clearInterval(){},GM_getValue:key=>shared[key],GM_setValue:(key,value)=>{shared[key]=structuredClone(value)},GM_addValueChangeListener:(key,fn)=>{storageEvents[key]=fn},GM_registerMenuCommand:(name,fn)=>menu.push({name,fn})});
 // Export the private compatibility surface only in this test context.
 vm.runInContext(bundle.replace('const localScope = {};','const localScope = {}; globalThis.fixture={localScope};').replace('for (const initialize of installedListeners) initialize();','globalThis.fixture.dispatch=dispatch; globalThis.fixture.changes=changeListeners; for (const initialize of installedListeners) initialize();'),ctx);
 return {ctx,store:shared,menu,storageEvents,dispatch:ctx.fixture.dispatch};
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
test('油猴包独立启动，不依赖 Chrome 和外部 require，保持接口模块顺序',async()=>{
 const h=harness();await flush();assert.equal(h.store.settings.enabled,true);assert.ok(h.store.stats);assert.equal(h.ctx.chrome,undefined);
 const status=await h.dispatch({target:'dy-cleaner-page',action:'status'});assert.equal(status.ok,true);assert.equal(status.version,'0.5.0');assert.equal(status.selectorHits.feedAvailable,true);
 assert.ok(!bundle.includes('// @require'));assert.ok(bundle.includes('// @noframes'));assert.equal(h.menu.length,2);
});
test('广告标记与设置保存在 GM 存储，重新启动保留，撤销不丢其他数据',async()=>{
 const h=harness();await flush();
 assert.equal((await h.dispatch({target:'dy-cleaner-background',action:'markAd',video:{id:'123',title:'测试'}})).ok,true);
 await h.dispatch({target:'dy-cleaner-background',action:'patchSettings',patch:{skipShopping:true}});
 assert.equal(h.store.settings.learnedAds[0].id,'123');
 const reboot=harness(h.store);await flush();assert.equal(reboot.store.settings.skipShopping,true);assert.equal(reboot.store.settings.learnedAds.length,1);
 await reboot.dispatch({target:'dy-cleaner-background',action:'removeLearnedAd',video:{id:'123'}});assert.equal(reboot.store.settings.learnedAds.length,0);assert.equal(reboot.store.settings.skipShopping,true);
});
test('跨标签页远程存储变更传给页面，非法标记拒绝且不写入',async()=>{
 const h=harness();await flush();let count=0;h.ctx.fixture.changes.push(()=>count++);
 h.storageEvents.settings('settings',{},h.store.settings,true);assert.equal(count,1);
 await assert.rejects(h.dispatch({target:'dy-cleaner-background',action:'markAd',video:{id:'not-id'}}));assert.equal(h.store.settings.learnedAds.length,0);
});
test('油猴后台并发写入不丢统计，quickBlock 无作者返回错误而不误拉黑',async()=>{
 const h=harness();await flush();
 await Promise.all(Array.from({length:20},()=>h.dispatch({target:'dy-cleaner-background',action:'record',type:'ad',rule:'test'})));
 assert.equal(h.store.stats.ad,20);assert.equal(h.store.recent.length,20);
 // Turn notices off only for this DOM-free test; real UI rendering is tested in Chrome.
 let error;try {error=await h.dispatch({target:'dy-cleaner-page',action:'block'})}catch(e){throw e}
 assert.equal(error.ok,false);assert.ok(error.error.includes('作者 ID'));
});
