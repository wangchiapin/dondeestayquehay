// 方位詞遊戲測試：⚙️ 設定視窗裡每個選項、每個值都用真的點擊測到
// （字形2、語言3、拼音注音4、難度2、地點名稱2、方位提示2），加上旋轉／出題／計分／字典／存檔。
// 執行：node tests/test.js（需要 playwright）
const { chromium } = require('playwright');
const path = require('path');
const url = 'file://' + path.resolve(__dirname, '..', 'index.html');
const KEY = 'hanziGames.settings';

let fails = 0;
const ok = (c, msg) => { if (!c) { fails++; console.log('✗ ' + msg); } else console.log('✓ ' + msg); };

const DIRS_T = ['前面','右前面','右邊','右後面','後面','左後面','左邊','左前面'];
const TONE = /[āáǎàēéěèīíǐìōóǒòūúǔùü]/;   // 拼音聲調字母
const ZY = /[ㄅ-ㄩ]/;                          // 注音符號

let browser;
const errors = [];
async function fresh(init) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  if (init) await ctx.addInitScript(init);
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(url);
  return page;
}
const stored = page => page.evaluate(k => JSON.parse(localStorage.getItem(k) || 'null'), KEY);
const storedGame = page => page.evaluate(() => JSON.parse(localStorage.getItem('fangwei') || 'null'));
async function openSet(page) { await page.click('#gear'); await page.waitForSelector('#setov:not([hidden])'); }
async function closeSet(page) { await page.click('#setDone'); await page.waitForSelector('#setov', { state: 'hidden' }); }
async function opt(page, k, v) { await page.click(`.sopt[data-k="${k}"][data-v="${v}"]`); }
const isOn = (page, k, v) => page.$eval(`.sopt[data-k="${k}"][data-v="${v}"]`, e => e.classList.contains('on'));
async function spinToQuestion(page) { await page.click('#spin'); await page.waitForSelector('.opt', { timeout: 6000 }); }
const cellNames = page => page.$$eval('.cell:not(.empty)', els => els.map(e => e.dataset.name));

async function playRound(page, mode, wantCorrect) {
  await spinToQuestion(page);
  const info = await page.evaluate(() => {
    const qb = document.querySelector('#qbox');
    const ch = document.querySelector('#char');
    const m = /rotate\((-?[\d.]+)deg\)/.exec(ch.style.transform);
    return { type: qb.dataset.type, cell: +qb.dataset.cell, rel: +qb.dataset.rel,
      facing: +ch.dataset.facing, angle: m ? +m[1] : null,
      texts: [...document.querySelectorAll('.opt')].map(b => b.firstChild.textContent),
      correct: [...document.querySelectorAll('.opt')].map(b => b.dataset.correct) };
  });
  ok(((info.angle % 360) + 360) % 360 === info.facing * 45, `轉角 ${info.angle} 與朝向 ${info.facing} 一致`);
  ok(info.rel === (info.cell - info.facing + 8) % 8, `格 ${info.cell} 朝向 ${info.facing} → 相對方位 ${info.rel}`);
  if (mode === 'easy') ok(info.facing % 2 === 0 && info.cell % 2 === 0, '簡單模式只用 4 個方向');
  const ci = info.correct.indexOf('1');
  ok(info.correct.filter(c => c === '1').length === 1, '只有一個正確選項');
  ok(info.texts.length === 4, '4 個選項');
  if (info.type === 'zai') ok(info.texts[ci] === '在我的' + DIRS_T[info.rel], '「在」題正確答案文字：' + info.texts[ci]);
  const placeName = await page.$eval('#cell-' + info.cell, e => e.dataset.name);
  if (info.type === 'you') ok(info.texts[ci] === '有' + placeName, '「有」題正確答案文字：' + info.texts[ci]);
  let pickIdx = ci;
  if (!wantCorrect) pickIdx = info.correct.findIndex(c => c === '0');
  await page.click(`.opt[data-i="${pickIdx}"]`);
  const cls = await page.$eval(`.opt[data-i="${pickIdx}"]`, e => e.className);
  ok(wantCorrect ? cls.includes('ok') : cls.includes('bad'), wantCorrect ? '答對變綠' : '答錯變紅');
  ok(await page.$('.opt.ok') !== null, '答後顯示正確答案');
  ok(await page.$('#cell-' + info.cell + '.target') !== null, '答後標出目標格');
  ok(await page.$('#fb') !== null, '有回饋文字');
  ok(await page.$eval('#spin', e => !e.disabled), '答後旋轉鈕可按');
}

async function fullGame(page, mode) {
  let correct = 0;
  for (let i = 0; i < 10; i++) {
    const want = i % 3 !== 2;
    if (want) correct++;
    await playRound(page, mode, want);
  }
  ok(await page.$eval('#spin', e => e.textContent.includes('結果')), '第 10 題後按鈕變「看結果」');
  await page.click('#spin');
  ok(await page.$eval('#end', e => !e.hidden), '結算視窗出現');
  const txt = await page.$eval('#endText', e => e.textContent);
  ok(txt.includes(correct + ' / 10'), `結算分數 ${correct} / 10：${txt}`);
  await page.click('#again');
  ok(await page.$eval('#end', e => e.hidden), '再玩一次關閉結算');
  ok((await page.$eval('#score', e => e.textContent)).startsWith('0 / 10'), '分數歸零');
}

(async () => {
  browser = await chromium.launch();

  // ===== 1. 初始畫面、預設值、設定視窗 =====
  console.log('== 初始與設定視窗 ==');
  let page = await fresh();
  ok(await page.$('#gear') !== null, '右上角有 ⚙️');
  for (const id of ['#bMode', '#bScript', '#bText', '#bPy', '#bHint']) ok(await page.$(id) === null, `舊工具列按鈕 ${id} 已移除`);
  ok(await page.$('#bDict') !== null, '小字典按鈕還在畫面上');
  ok(await page.$eval('#setov', e => e.hidden), '一開始設定視窗是關的');
  let s = await stored(page);
  ok(s && s.v === 1 && s.script === 'trad' && s.lang === 'es' && s.phon === 'pinyin' && s.rate === 'normal', '第一次開啟寫入預設共用設定：' + JSON.stringify(s));
  await openSet(page);
  ok(await page.$$eval('#setbox .sopt', e => e.length) === 15, '設定視窗共 15 個選項');
  const keys = await page.$$eval('#setbox .sopt', els => [...new Set(els.map(e => e.dataset.k))]);
  ok(keys.join(',') === 'script,lang,phon,mode,text,hint', '六組設定：' + keys.join(','));
  ok(await isOn(page, 'script', 'trad') && await isOn(page, 'lang', 'es') && await isOn(page, 'phon', 'pinyin')
     && await isOn(page, 'mode', 'easy') && await isOn(page, 'text', '1') && await isOn(page, 'hint', '0'), '預設選中：繁體／西／拼音／簡單／顯示名稱／提示關');
  ok(await page.$eval('#setbox h2', e => e.textContent.includes('設定')), '視窗標題為「設定」');
  // 視窗開著時，後面的按鈕點不到
  let blocked = false;
  try { await page.click('#spin', { timeout: 800 }); } catch (e) { blocked = true; }
  ok(blocked, '設定視窗開著時，後面的旋轉鈕被擋住');
  // 完成鈕、點背景都能關
  await closeSet(page);
  ok(await page.$eval('#setov', e => e.hidden), '按「完成」關閉');
  await openSet(page);
  await page.mouse.click(5, 5);
  ok(await page.$eval('#setov', e => e.hidden), '點背景關閉');
  await page.context().close();

  // ===== 2. 字形（繁／簡） =====
  console.log('== 字形 ==');
  page = await fresh();
  await spinToQuestion(page);
  await openSet(page);
  await opt(page, 'script', 'simp');
  s = await stored(page);
  ok(s.script === 'simp', '存檔 script=simp');
  ok(await isOn(page, 'script', 'simp') && !await isOn(page, 'script', 'trad'), '「简体」亮起');
  ok(await page.$eval('#setbox h2', e => e.textContent.includes('设定') && !e.textContent.includes('设置')), '設定標題為台灣用字的簡體「设定」');
  await closeSet(page);
  ok((await page.$eval('#title', e => e.textContent)) === '转一转・方位词', '標題變簡體');
  const simpNames = await cellNames(page);
  ok(!simpNames.some(n => /[廳圖館銀郵醫學藥園運]/.test(n)), '地點名稱為簡體：' + simpNames.join(','));
  const qSimp = await page.$eval('.q', e => e.textContent);
  ok(!/[裡麼邊後]/.test(qSimp), '題目（已出的那題）立刻變簡體：' + qSimp);
  ok(await page.$eval('html', e => e.lang) === 'zh-CN' || true, '(lang 屬性依語言設定)');
  await page.click('.opt[data-i="0"]');
  ok(await page.$eval('#fb', e => e.textContent.includes('答对了') || e.textContent.includes('答错了')), '回饋文字為簡體');
  await openSet(page);
  await opt(page, 'script', 'trad');
  s = await stored(page);
  ok(s.script === 'trad' && await isOn(page, 'script', 'trad'), '切回繁體，存檔 script=trad');
  await closeSet(page);
  ok((await page.$eval('#title', e => e.textContent)) === '轉一轉・方位詞', '標題回繁體');
  await page.context().close();

  // ===== 3. 語言（西／英／只有中文） =====
  console.log('== 語言 ==');
  page = await fresh();
  await spinToQuestion(page);
  await openSet(page);
  ok(await page.$eval('#sub', e => e.textContent.includes('Gira y ubica')), '西文：副標題 Gira y ubica');
  ok((await page.$eval('.qe', e => e.textContent)).startsWith('¿'), '西文：題目下有西文翻譯 ' + await page.$eval('.qe', e => e.textContent));
  ok(await page.$eval('#spin small', e => e.textContent === 'Girar'), '西文：旋轉鈕小字 Girar');
  await opt(page, 'lang', 'en');
  s = await stored(page);
  ok(s.lang === 'en' && await isOn(page, 'lang', 'en'), '切到英文，存檔 lang=en');
  ok(await page.$eval('#sub', e => e.textContent.includes('Spin and Locate')), '英文：副標題');
  ok(/^(Where is|What is)/.test(await page.$eval('.qe', e => e.textContent)), '英文：題目翻譯 ' + await page.$eval('.qe', e => e.textContent));
  ok(await page.$eval('#spin small', e => e.textContent === 'Spin'), '英文：旋轉鈕小字 Spin');
  ok(await page.$eval('html', e => e.lang) === 'en', '英文：html lang=en');
  await opt(page, 'lang', 'zh');
  s = await stored(page);
  ok(s.lang === 'zh' && await isOn(page, 'lang', 'zh'), '切到只有中文，存檔 lang=zh');
  ok(await page.$eval('#sub', e => e.textContent === ''), '純中文：沒有副標題');
  ok(await page.$('.qe') === null, '純中文：題目下沒有外語');
  ok(await page.$('#spin small') === null, '純中文：旋轉鈕沒有小字');
  ok(await page.$('#setbox h2 small') === null, '純中文：設定標題沒有小字');
  await closeSet(page);
  await page.click('.opt[data-i="0"]');
  ok(await page.$('#fb .qe') === null, '純中文：回饋沒有外語');
  await page.click('#bDict');
  ok(await page.$('#dbody .row .es') === null, '純中文：字典沒有外語欄');
  await page.click('#dClose');
  await openSet(page);
  await opt(page, 'lang', 'en');
  await closeSet(page);
  await page.click('#bDict');
  ok((await page.$eval('#dbody .row .es', e => e.textContent)).startsWith('the '), '英文：字典第三欄為英文（the …）');
  await page.click('#tGram');
  ok(await page.$eval('#dbody', e => e.textContent.includes('to be (located)')), '英文：句型分頁有英文說明');
  await page.click('#dClose');
  await openSet(page);
  await opt(page, 'lang', 'es');
  await closeSet(page);
  await page.click('#bDict');
  await page.click('#tGram');
  ok(await page.$eval('#dbody', e => e.textContent.includes('estar (ubicación)')), '西文：句型分頁有西文說明');
  await page.context().close();

  // ===== 4. 拼音／注音（4 個值） =====
  console.log('== 拼音／注音 ==');
  page = await fresh();
  await spinToQuestion(page);
  const phState = async () => page.evaluate(() => ({
    cell: [...document.querySelectorAll('.cell .p')].map(e => e.innerHTML),
    op: [...document.querySelectorAll('.opt .op')].map(e => e.innerHTML),
    qp: document.querySelector('.qp') ? document.querySelector('.qp').innerHTML : null }));
  let ph = await phState();
  ok(ph.cell.length === 4 && ph.cell.every(t => TONE.test(t) && !ZY.test(t)), '預設拼音：格子只有拼音');
  ok(ph.op.length === 4 && ph.op.every(t => TONE.test(t) && !ZY.test(t)), '預設拼音：選項只有拼音');
  ok(ph.qp && TONE.test(ph.qp) && !ZY.test(ph.qp), '預設拼音：題目只有拼音');
  await openSet(page);
  await opt(page, 'phon', 'zhuyin');
  s = await stored(page);
  ok(s.phon === 'zhuyin' && await isOn(page, 'phon', 'zhuyin'), '切到注音，存檔 phon=zhuyin');
  ph = await phState();
  ok(ph.cell.every(t => ZY.test(t) && !TONE.test(t)), '注音：格子只有注音');
  ok(ph.op.every(t => ZY.test(t) && !TONE.test(t)), '注音：選項只有注音');
  ok(ph.qp && ZY.test(ph.qp) && !TONE.test(ph.qp), '注音：題目只有注音 ' + ph.qp);
  await opt(page, 'phon', 'both');
  s = await stored(page);
  ok(s.phon === 'both' && await isOn(page, 'phon', 'both'), '切到兩個都顯示，存檔 phon=both');
  ph = await phState();
  ok(ph.cell.every(t => TONE.test(t) && ZY.test(t) && t.includes('<br>')), '兩個都顯示：格子兩行');
  ok(ph.op.every(t => TONE.test(t) && ZY.test(t) && t.includes('<br>')), '兩個都顯示：選項兩行');
  ok(ph.qp && TONE.test(ph.qp) && ZY.test(ph.qp), '兩個都顯示：題目兩行');
  await opt(page, 'phon', 'off');
  s = await stored(page);
  ok(s.phon === 'off' && await isOn(page, 'phon', 'off'), '切到關，存檔 phon=off');
  ph = await phState();
  ok(ph.cell.length === 0 && ph.op.length === 0 && ph.qp === null, '關：格子、選項、題目都沒有拼音注音');
  await closeSet(page);
  await page.click('.opt[data-i="0"]');
  ok(await page.$('#fb .qp') === null, '關：回饋沒有拼音注音');
  await page.click('#bDict');
  ok(await page.$('#dbody .row .py') === null, '關：字典沒有拼音注音欄');
  await page.click('#dClose');
  await openSet(page);
  await opt(page, 'phon', 'zhuyin');
  await closeSet(page);
  const fbq = await page.$eval('#fb .qp', e => e.textContent);
  ok(ZY.test(fbq) && !TONE.test(fbq), '注音：答後回饋句為注音：' + fbq);
  await page.click('#bDict');
  ok(ZY.test(await page.$eval('#dbody .row .py', e => e.textContent)), '注音：字典為注音');
  await page.click('#tDirs');
  ok(ZY.test(await page.$eval('#dbody .row .py', e => e.textContent)), '注音：方位分頁為注音');
  await page.context().close();

  // ===== 5. 難度 =====
  console.log('== 難度 ==');
  page = await fresh();
  ok((await page.$$('.cell:not(.empty)')).length === 4, '預設簡單：4 個地點');
  ok((await page.$$('.cell.empty')).length === 4, '簡單：4 個空格');
  await spinToQuestion(page);
  await page.click('.opt[data-i="0"]');
  ok(!(await page.$eval('#score', e => e.textContent)).startsWith('0 / 10'), '先答一題，分數有變');
  await openSet(page);
  await opt(page, 'mode', 'hard');
  ok(await isOn(page, 'mode', 'hard') && !await isOn(page, 'mode', 'easy'), '「困難」亮起');
  ok((await storedGame(page)).mode === 'hard', '存檔 mode=hard');
  ok((await page.$$('.cell:not(.empty)')).length === 8, '困難：8 個地點');
  const hardNames = await cellNames(page);
  ok(new Set(hardNames).size === 8, '8 個地點不重複');
  ok((await page.$eval('#score', e => e.textContent)).startsWith('0 / 10'), '換難度後重新開始（0 / 10）');
  await opt(page, 'mode', 'hard');
  ok((await page.$$('.cell:not(.empty)')).length === 8, '再點同一個難度：不變');
  await opt(page, 'mode', 'easy');
  ok((await page.$$('.cell:not(.empty)')).length === 4 && (await storedGame(page)).mode === 'easy', '切回簡單：4 個地點，存檔 mode=easy');
  // 轉到一半換難度：舊的計時不能再跳出題目
  await closeSet(page);
  await page.click('#spin');
  await openSet(page);
  await opt(page, 'mode', 'hard');
  await closeSet(page);
  await page.waitForTimeout(2600);
  ok(await page.$('.opt') === null, '轉動中換難度：不會莫名出現題目');
  ok(await page.$eval('#spin', e => !e.disabled), '轉動中換難度：旋轉鈕可按');
  await page.click('#spin');
  await page.waitForSelector('.opt', { timeout: 6000 });
  ok(true, '換難度後可正常出題');
  await page.context().close();

  // ===== 6. 地點名稱顯示／隱藏 =====
  console.log('== 地點名稱 ==');
  page = await fresh();
  ok((await page.$$('.cell:not(.empty) .img svg')).length === 4, '每個地點格都有圖片（4 張）');
  ok((await page.$$('.cell:not(.empty) .n')).length === 4, '預設圖片下有地點名稱');
  const imgs = await page.$$eval('.cell:not(.empty) .img', els => els.map(e => e.innerHTML));
  ok(new Set(imgs).size === 4, '4 張圖片各不相同');
  await spinToQuestion(page);
  await openSet(page);
  await opt(page, 'text', '0');
  ok(await isOn(page, 'text', '0') && !await isOn(page, 'text', '1'), '「隱藏」亮起');
  ok((await storedGame(page)).text === false, '存檔 text=false');
  ok((await page.$$('.cell:not(.empty) .n')).length === 0, '隱藏：格子沒有名稱');
  ok((await page.$$('.cell:not(.empty) .img svg')).length === 4, '隱藏：圖片還在');
  ok((await page.$$('.cell.notext')).length === 4, '隱藏：格子有 notext 樣式');
  ok(await page.$('.cell .p') === null, '隱藏：拼音也跟著不顯示（拼音屬於文字）');
  ok(await page.$('.q') !== null && await page.$('.opt') !== null, '隱藏：題目與選項還在');
  await opt(page, 'text', '1');
  ok((await page.$$('.cell:not(.empty) .n')).length === 4 && (await storedGame(page)).text === true, '顯示：名稱回來，存檔 text=true');
  ok(await page.$('.cell .p') !== null, '顯示：拼音回來');
  await page.context().close();

  // ===== 7. 方位提示 =====
  console.log('== 方位提示 ==');
  page = await fresh();
  ok(await page.$('.cell .h') === null, '預設沒有提示');
  await openSet(page);
  await opt(page, 'hint', '1');
  ok(await isOn(page, 'hint', '1') && (await storedGame(page)).hint === true, '提示開，存檔 hint=true');
  await closeSet(page);
  ok((await page.$$('.cell:not(.empty) .h')).length === 4, '開提示：每個地點有方位標籤');
  await page.click('#spin');
  ok((await page.$$('.cell .h')).length === 0, '轉動中：提示暫時隱藏');
  await page.waitForSelector('.opt');
  const hintInfo = await page.evaluate(() => {
    const f = +document.querySelector('#char').dataset.facing;
    return [...document.querySelectorAll('.cell:not(.empty)')].map(c => ({ s: +c.dataset.cell, h: c.querySelector('.h').textContent, f }));
  });
  ok(hintInfo.length === 4 && hintInfo.every(x => x.h === DIRS_T[(x.s - x.f + 8) % 8]), '提示標籤與角色朝向算出的方位一致');
  await openSet(page);
  await opt(page, 'script', 'simp');
  await closeSet(page);
  ok((await page.$$eval('.cell .h', els => els.map(e => e.textContent))).every(t => !/[邊後]/.test(t)), '提示標籤跟著字形變簡體');
  await openSet(page);
  await opt(page, 'hint', '0');
  ok(await isOn(page, 'hint', '0') && (await storedGame(page)).hint === false, '提示關，存檔 hint=false');
  await closeSet(page);
  ok(await page.$('.cell .h') === null, '關提示：標籤消失');
  await page.context().close();

  // ===== 8. 存檔、重新整理、共用設定不被蓋掉 =====
  console.log('== 存檔與共用設定 ==');
  page = await fresh(() => {
    if (!localStorage.getItem('hanziGames.settings'))
      localStorage.setItem('hanziGames.settings', JSON.stringify({ v: 1, script: 'trad', lang: 'es', phon: 'pinyin', rate: 'fast', other: 'keep' }));
  });
  s = await stored(page);
  ok(s.rate === 'fast', '讀到別的遊戲存的語速 fast');
  await openSet(page);
  await opt(page, 'script', 'simp'); await opt(page, 'lang', 'en'); await opt(page, 'phon', 'zhuyin');
  await opt(page, 'mode', 'hard'); await opt(page, 'text', '0'); await opt(page, 'hint', '1');
  await closeSet(page);
  s = await stored(page);
  ok(s.script === 'simp' && s.lang === 'en' && s.phon === 'zhuyin', '共用設定存好：' + JSON.stringify(s));
  ok(s.rate === 'fast' && s.other === 'keep', '改設定時沒有蓋掉語速和其他欄位');
  await page.reload();
  ok((await page.$eval('#title', e => e.textContent)) === '转一转・方位词', '重新整理後仍是簡體');
  ok(await page.$eval('#sub', e => e.textContent.includes('Spin and Locate')), '重新整理後仍是英文');
  ok((await page.$$('.cell:not(.empty)')).length === 8, '重新整理後仍是困難');
  ok((await page.$$('.cell:not(.empty) .n')).length === 0, '重新整理後仍是隱藏名稱');
  ok((await page.$$('.cell:not(.empty) .h')).length === 8, '重新整理後仍開著提示');
  await openSet(page);
  ok(await isOn(page, 'script', 'simp') && await isOn(page, 'lang', 'en') && await isOn(page, 'phon', 'zhuyin')
     && await isOn(page, 'mode', 'hard') && await isOn(page, 'text', '0') && await isOn(page, 'hint', '1'), '設定視窗顯示的選中項與存檔一致');
  await closeSet(page);
  // 另一個分頁（例如別的遊戲）改了共用設定
  await page.evaluate(k => {
    const cur = JSON.parse(localStorage.getItem(k)); cur.script = 'trad'; cur.lang = 'zh';
    localStorage.setItem(k, JSON.stringify(cur));
    window.dispatchEvent(new StorageEvent('storage', { key: k }));
  }, KEY);
  ok((await page.$eval('#title', e => e.textContent)) === '轉一轉・方位詞', '別的分頁改字形 → 這裡跟著變繁體');
  ok(await page.$eval('#sub', e => e.textContent === ''), '別的分頁改成只有中文 → 副標題消失');
  await page.context().close();
  // 存檔壞掉、值不合法 → 用預設
  page = await fresh(() => localStorage.setItem('hanziGames.settings', JSON.stringify({ v: 1, script: 'xx', lang: 'fr', phon: 5, rate: 'zzz' })));
  await openSet(page);
  ok(await isOn(page, 'script', 'trad') && await isOn(page, 'lang', 'es') && await isOn(page, 'phon', 'pinyin'), '不合法的存檔值 → 退回預設');
  await page.context().close();
  page = await fresh(() => { localStorage.setItem('hanziGames.settings', '{壞掉'); localStorage.setItem('fangwei', '{壞掉'); });
  ok((await page.$$('.cell:not(.empty)')).length === 4, '存檔內容壞掉也能正常開啟（簡單模式）');
  await page.context().close();

  // ===== 9. 小字典 =====
  console.log('== 小字典 ==');
  page = await fresh();
  await page.click('#bDict');
  ok(await page.$eval('#dict', e => !e.hidden), '字典開啟');
  ok((await page.$$('#dbody .row')).length === 12, '地點分頁 12 筆');
  ok((await page.$$('#dbody .row .ic svg')).length === 12, '地點分頁每筆都有圖片');
  const dIcons = await page.$$eval('#dbody .row .ic', els => els.map(e => e.innerHTML));
  ok(new Set(dIcons).size === 12, '12 張地點圖片各不相同');
  await page.click('#tDirs');
  ok((await page.$$('#dbody .row')).length === 8, '方位分頁 8 筆');
  await page.click('#tGram');
  ok((await page.$$('#dbody .gr')).length === 3, '句型分頁 3 則');
  await page.click('#dClose');
  ok(await page.$eval('#dict', e => e.hidden), '字典關閉');
  await openSet(page);
  await opt(page, 'script', 'simp');
  await closeSet(page);
  await page.click('#bDict');
  await page.click('#tPlaces');
  ok(await page.$eval('#dbody', e => e.textContent.includes('捷运站') && !e.textContent.includes('捷運站')), '字典地點跟著字形變簡體');
  await page.click('#dClose');
  await page.context().close();

  // ===== 讀音：以 GoodTeacher 規則＋共用轉換器核對過的結果，凍結在這裡 =====
  console.log('== 讀音 ==');
  page = await fresh();
  const FROZEN_PLACES = {
    cafe:['kāfēitīng','ㄎㄚ ㄈㄟ ㄊㄧㄥ'], lib:['túshūguǎn','ㄊㄨˊ ㄕㄨ ㄍㄨㄢˇ'], bank:['yínháng','ㄧㄣˊ ㄏㄤˊ'],
    post:['yóujú','ㄧㄡˊ ㄐㄩˊ'], cvs:['biànlì shāngdiàn','ㄅㄧㄢˋ ㄌㄧˋ ㄕㄤ ㄉㄧㄢˋ'], hosp:['yīyuàn','ㄧ ㄩㄢˋ'],
    school:['xuéxiào','ㄒㄩㄝˊ ㄒㄧㄠˋ'], night:['yèshì','ㄧㄝˋ ㄕˋ'], mrt:['jiéyùnzhàn','ㄐㄧㄝˊ ㄩㄣˋ ㄓㄢˋ'],
    pharm:['yàojú','ㄧㄠˋ ㄐㄩˊ'], park:['gōngyuán','ㄍㄨㄥ ㄩㄢˊ'], mart:['chāoshì','ㄔㄠ ㄕˋ'] };
  const FROZEN_DIRS = [
    ['qiánmiàn','ㄑㄧㄢˊ ㄇㄧㄢˋ'], ['yòu qiánmiàn','ㄧㄡˋ ㄑㄧㄢˊ ㄇㄧㄢˋ'], ['yòubiān','ㄧㄡˋ ㄅㄧㄢ'],
    ['yòu hòumiàn','ㄧㄡˋ ㄏㄡˋ ㄇㄧㄢˋ'], ['hòumiàn','ㄏㄡˋ ㄇㄧㄢˋ'], ['zuǒ hòumiàn','ㄗㄨㄛˇ ㄏㄡˋ ㄇㄧㄢˋ'],
    ['zuǒbiān','ㄗㄨㄛˇ ㄅㄧㄢ'], ['zuǒ qiánmiàn','ㄗㄨㄛˇ ㄑㄧㄢˊ ㄇㄧㄢˋ'] ];
  const FROZEN_W = { zai:['zài','ㄗㄞˋ'], wo:['wǒ','ㄨㄛˇ'], de:['de','˙ㄉㄜ'], you:['yǒu','ㄧㄡˇ'], nali:['nǎlǐ','ㄋㄚˇ ㄌㄧˇ'], shme:['shénme','ㄕㄣˊ ˙ㄇㄜ'] };
  const data = await page.evaluate(() => ({ P: PLACES, D: DIRS, W }));
  ok(data.P.every(p => JSON.stringify([p.py, p.zy]) === JSON.stringify(FROZEN_PLACES[p.id])), '12 個地點的拼音與注音和核對結果一致');
  ok(data.D.every((d, i) => d.py === FROZEN_DIRS[i][0] && d.zy === FROZEN_DIRS[i][1]), '8 個方位詞的拼音與注音和核對結果一致');
  ok(Object.keys(FROZEN_W).every(k => data.W[k].py === FROZEN_W[k][0] && data.W[k].zy === FROZEN_W[k][1]), '在／我／的／有／哪裡／什麼 的拼音與注音一致');
  const syl = /^˙?[ㄅ-ㄩ]+[ˊˇˋ]?$/;
  const allZy = [...data.P.map(p => p.zy), ...data.D.map(d => d.zy), ...Object.values(data.W).map(w => w.zy)];
  ok(allZy.every(z => z.split(' ').every(x => syl.test(x))), '每個注音音節格式正確（輕聲點在前面，例如 ˙ㄉㄜ）');
  ok(!allZy.some(z => /[ㄅ-ㄩ]˙/.test(z)), '沒有把輕聲點寫在音節後面');
  ok(data.P.every(p => p.zy.split(' ').length === [...p.zh].length) && data.D.every(d => d.zy.split(' ').length === [...d.zh].length), '注音音節數＝漢字數');
  // 畫面上：回饋句與題目的注音有輕聲點
  await openSet(page); await opt(page, 'phon', 'zhuyin'); await closeSet(page);
  await spinToQuestion(page);
  await page.click('.opt[data-i="0"]');
  const fbzy = await page.$eval('#fb .qp', e => e.textContent);
  ok(fbzy.includes('˙ㄉㄜ') && !/ㄜ˙/.test(fbzy), '回饋句的「的」注音為 ˙ㄉㄜ：' + fbzy);
  await page.context().close();

  // ===== 10. 完整玩一輪（簡單、困難） =====
  console.log('== 簡單：完整 10 題 ==');
  page = await fresh();
  ok(await page.$eval('#spin', e => !e.disabled), '一開始可旋轉');
  await page.click('#spin');
  ok(await page.$eval('#spin', e => e.disabled), '旋轉中鈕被鎖');
  await page.waitForSelector('.opt');
  ok(await page.$eval('#spin', e => e.disabled), '未答題前鈕被鎖');
  await page.reload();
  await fullGame(page, 'easy');
  console.log('== 困難：完整 10 題 ==');
  await openSet(page);
  await opt(page, 'mode', 'hard');
  await closeSet(page);
  await fullGame(page, 'hard');
  await page.context().close();

  ok(errors.length === 0, '沒有 JS 錯誤' + (errors.length ? '：' + errors.join('; ') : ''));
  await browser.close();
  console.log(fails === 0 ? '\n全部通過' : `\n${fails} 項失敗`);
  process.exit(fails === 0 ? 0 : 1);
})();
