"""Bundle original project code with a private GM compatibility layer; no remote dependencies."""
import json
import pathlib
import re

ROOT=pathlib.Path(__file__).resolve().parent.parent
HERE=ROOT/'userscript'
def read(name): return (ROOT/name).read_text(encoding='utf-8')
def module(name):
 return read(name).replace("typeof globalThis !== 'undefined' ? globalThis : this",'localScope').replace('})(globalThis);','})(localScope);')
metadata='''// ==UserScript==
// @name         抖音清爽刷 · 广告直播带货过滤
// @namespace    https://github.com/5434945/douyin-cleaner
// @version      0.5.0
// @description  自动跳过抖音推荐流的明确广告、直播推荐和可选带货视频，支持手动标记广告、作者黑名单和快速拉黑；数据仅保存在本机。
// @author       5434945
// @license      MIT
// @match        https://www.douyin.com/*
// @match        https://douyin.com/*
// @run-at       document-start
// @noframes
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addValueChangeListener
// @grant        GM_registerMenuCommand
// @grant        unsafeWindow
// @homepageURL  https://github.com/5434945/douyin-cleaner
// @supportURL   https://github.com/5434945/douyin-cleaner/issues
// ==/UserScript==
'''
background=read('background.js').replace("importScripts('blocked-authors.js', 'core.js');",'').replace('const Core = DouyinCleanerCore;','const Core = localScope.DouyinCleanerCore;').replace('queue.then(fn)','queue.then(() => withStorageLock(fn))')
content=read('content.js').replace('const Core = DouyinCleanerCore;','const Core = localScope.DouyinCleanerCore;').replace('globalThis.DouyinCleanerFeed','localScope.DouyinCleanerFeed')
content=content.replace('event.source !== window', '(event.source !== window && event.source !== unsafeWindow)')
content=content.replace('const focused = document.activeElement;', 'const focused = document.activeElement?.shadowRoot?.activeElement || document.activeElement;')
content=content.replace('event.composedPath().includes(uiHost)', "(event.composedPath().includes(uiHost) || event.composedPath().some(node => node?.id === 'dy-cleaner-userscript'))")
capture=read('feed-capture.js').replace('const Feed = globalThis.DouyinCleanerFeed;', 'const Feed = localScope.DouyinCleanerFeed;').replace('(function () {','(function (window) {',1)
capture=capture.rsplit('})();',1)[0]+'})(unsafeWindow);'
body=re.search(r'<body>(.*?)</body>',read('popup.html'),re.S).group(1)
body=re.sub(r'<script.*?</script>','',body,flags=re.S).replace('v0.4.5','v0.5.0 油猴版')
css=read('popup.css')+'\n'+read('content.css')
panel='''
function mountPanel() {
  const host = document.createElement('div'); host.id = 'dy-cleaner-userscript';
  host.style.cssText = 'position:fixed;right:20px;top:70px;z-index:2147483647;';
  const shadow = host.attachShadow({mode:'open'});
  const style = document.createElement('style'); style.textContent = PANEL_CSS + `
    :host { all:initial; color-scheme:dark; } .shell { display:flex;flex-direction:column;align-items:flex-end; }
    .panel { font:13px/1.5 system-ui,"Microsoft YaHei",sans-serif;color:#e7eef4;width:min(440px,calc(100vw - 40px));max-height:calc(100vh - 160px);overflow:auto;background:#10171f;border:1px solid #33454e;border-radius:14px;padding:16px;box-shadow:0 8px 32px #0008; }
    .panel[hidden] {display:none;} .toggle {background:#153c39;color:#a3f4e3;border:1px solid #448477;border-radius:8px;padding:9px 13px;font:14px system-ui;margin-bottom:8px;cursor:pointer;}
  `;
  const shell=document.createElement('div'); shell.className='shell';
  const toggle=document.createElement('button'); toggle.type='button'; toggle.className='toggle';toggle.textContent='清爽刷设置';toggle.setAttribute('aria-expanded','false');
  const panel=document.createElement('section'); panel.className='panel';panel.hidden=true;panel.innerHTML=PANEL_HTML;
  shell.append(toggle,panel);shadow.append(style,shell);document.documentElement.append(host);
  const noticeStyle=document.createElement('style');noticeStyle.textContent='#dy-cleaner-ui {position:fixed;right:24px;bottom:28px;z-index:2147483647;}';document.documentElement.append(noticeStyle);
  function open() {panel.hidden=false;toggle.setAttribute('aria-expanded','true');}
  toggle.addEventListener('click',()=>{panel.hidden=!panel.hidden;toggle.setAttribute('aria-expanded',String(!panel.hidden));});
  GM_registerMenuCommand('打开抖音清爽刷设置',open);
  // Pass a DOM facade to the original popup implementation so IDs stay inside Shadow DOM.
  (function(document) {
    POPUP_CODE
  })({getElementById:id=>shadow.getElementById(id),createElement:tag=>document.createElement(tag)});
}
GM_registerMenuCommand('屏蔽当前作者（Alt + Shift + B）',()=>dispatch({target:'dy-cleaner-page',action:'quickBlock'}).catch(console.warn));
GM_registerMenuCommand('开启／暂停过滤（Alt + Shift + S）',()=>commandListeners.forEach(fn=>fn('toggle-enabled')));
document.addEventListener('keydown',event=>{
  if (!event.isTrusted || event.repeat || !event.altKey || !event.shiftKey || event.ctrlKey || event.metaKey) return;
  const focused=document.activeElement?.shadowRoot?.activeElement || document.activeElement;
  if (document.hidden || focused?.matches('input,textarea,select,[contenteditable]:not([contenteditable="false"])')) return;
  const command=event.code==='KeyB'?'block-current-author':event.code==='KeyS'?'toggle-enabled':null;
  if (command) {event.preventDefault(); commandListeners.forEach(fn=>fn(command));}
},true);
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mountPanel,{once:true});else mountPanel();
'''
popup=read('popup.js').replace('const Core = DouyinCleanerCore;','const Core = localScope.DouyinCleanerCore;').replace('在 Chrome 重新加载插件后','重新启用油猴脚本后').replace('重新加载插件','重新启用油猴脚本')
panel=panel.replace('PANEL_CSS',json.dumps(css,ensure_ascii=False)).replace('PANEL_HTML',json.dumps(body,ensure_ascii=False)).replace('POPUP_CODE',popup)
parts=[metadata,'(function () {\n"use strict";\nconst localScope = {};',module('blocked-authors.js'),module('core.js'),module('feed-data.js'),read('userscript/adapter.js'),background,'for (const initialize of installedListeners) initialize();',
 'try {\n'+capture+'\n} catch (error) { console.warn("清爽刷：接口辅助识别不可用，页面识别仍可运行", error); }',content,panel,'})();\n']
(HERE/'douyin-cleaner.user.js').write_text('\n\n'.join(parts),encoding='utf-8')
print('Built userscript/douyin-cleaner.user.js')
