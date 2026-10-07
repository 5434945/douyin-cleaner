"""Local browser fixture only: supply mock GM APIs and a recommendation URL."""
import pathlib,re
root=pathlib.Path(__file__).resolve().parent.parent
script=(root/'userscript/douyin-cleaner.user.js').read_text(encoding='utf-8')
script=script.replace('const localScope = {};',"const location={href:'https://www.douyin.com/?recommend=1',origin:window.location.origin}; const localScope = {};")
script=script.replace('// Local compatibility layer.',"window.originalCore=localScope.DouyinCleanerCore;window.DouyinCleanerCore=localScope.DouyinCleanerCore;window.DouyinCleanerFeed=localScope.DouyinCleanerFeed;\n// Local compatibility layer.")
script=script.replace('for (const initialize of installedListeners) initialize();','window.fixtureDispatch=dispatch; window.chrome=chrome; for (const initialize of installedListeners) initialize();')
(root/'tests/userscript-fixture.js').write_text(script,encoding='utf-8')
mock="""const storageData={};const GM_getValue=key=>storageData[key];const GM_setValue=(key,value)=>{storageData[key]=structuredClone(value)};const GM_addValueChangeListener=()=>{};const GM_registerMenuCommand=()=>{};const unsafeWindow=window;"""
(root/'tests/userscript-mock.js').write_text(mock,encoding='utf-8')
html=(root/'tests/fixture.html').read_text(encoding='utf-8')
html=re.sub(r'<script src="../blocked-authors.js">.*?<script src="fixture-tests.js"></script>', '<script src="userscript-mock.js"></script><script src="userscript-fixture.js"></script><script src="fixture-tests.js"></script>',html,flags=re.S)
(root/'tests/userscript-fixture.html').write_text(html,encoding='utf-8')
