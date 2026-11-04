// 方位詞遊戲測試：每個選項都測（難度、繁簡、拼音、提示、字典三個分頁、答對／答錯、10 題結算、再玩一次）
const { chromium } = require('playwright');
const path = require('path');
const url = 'file://' + path.resolve(__dirname, '..', 'index.html');

let fails = 0;
const ok = (c, msg) => { if (!c) { fails++; console.log('✗ ' + msg); } else console.log('✓ ' + msg); };

const DIRS_T = ['前面','右前面','右邊','右後面','後面','左後面','左邊','左前面'];

async function playRound(page, mode, wantCorrect) {
  await page.click('#spin');
  await page.waitForSelector('.opt', { timeout: 6000 });
  const info = await page.evaluate(() => {
    const qb = document.querySelector('#qbox');
    const ch = document.querySelector('#char');
    const m = /rotate\((-?[\d.]+)deg\)/.exec(ch.style.transform);
    return { type: qb.dataset.type, cell: +qb.dataset.cell, rel: +qb.dataset.rel,
      facing: +ch.dataset.facing, angle: m ? +m[1] : null,
      texts: [...document.querySelectorAll('.opt')].map(b => b.firstChild.textContent),
      correct: [...document.querySelectorAll('.opt')].map(b => b.dataset.correct) };
  });
  // 幾何：轉角要等於 facing*45；相對方位要等於 (cell - facing) mod 8
  ok(((info.angle % 360) + 360) % 360 === info.facing * 45, `轉角 ${info.angle} 與朝向 ${info.facing} 一致`);
  ok(info.rel === (info.cell - info.facing + 8) % 8, `格 ${info.cell} 朝向 ${info.facing} → 相對方位 ${info.rel}`);
  if (mode === 'easy') ok(info.facing % 2 === 0 && info.cell % 2 === 0, '簡單模式只用 4 個方向');
  const ci = info.correct.indexOf('1');
  ok(info.correct.filter(c => c === '1').length === 1, '只有一個正確選項');
  if (info.type === 'zai') ok(info.texts[ci] === '在我的' + DIRS_T[info.rel], '「在」題正確答案文字：' + info.texts[ci]);
  const placeName = await page.$eval('#cell-' + info.cell, e => e.dataset.name);
  if (info.type === 'you') ok(info.texts[ci] === '有' + placeName, '「有」題正確答案文字：' + info.texts[ci]);
  ok(info.texts.length === 4, '4 個選項');
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
  ok(await page.$eval('#spin', e => e.textContent.includes('結果') || e.textContent.includes('结果')), '第 10 題後按鈕變「看結果」');
  await page.click('#spin');
  ok(await page.$eval('#end', e => !e.hidden), '結算視窗出現');
  const txt = await page.$eval('#endText', e => e.textContent);
  ok(txt.includes(correct + ' / 10'), `結算分數 ${correct} / 10：${txt}`);
  await page.click('#again');
  ok(await page.$eval('#end', e => e.hidden), '再玩一次關閉結算');
  ok((await page.$eval('#score', e => e.textContent)).startsWith('0 / 10'), '分數歸零');
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(url);

  // --- 簡單模式 ---
  console.log('== 簡單模式 ==');
  ok((await page.$eval('#bMode', e => e.textContent)).includes('簡單'), '預設簡單模式');
  ok((await page.$$('.cell:not(.empty)')).length === 4, '簡單模式 4 個地點');
  ok((await page.$$('.cell.empty')).length === 4, '簡單模式 4 個空格');
  ok(await page.$eval('#spin', e => !e.disabled), '一開始可旋轉');
  await page.click('#spin');
  ok(await page.$eval('#spin', e => e.disabled), '旋轉中鈕被鎖');
  await page.waitForSelector('.opt');
  ok(await page.$eval('#spin', e => e.disabled), '未答題前鈕被鎖');
  await page.click('.opt[data-i="0"]');
  await page.reload();
  await fullGame(page, 'easy');

  // --- 繁簡 ---
  console.log('== 繁簡切換 ==');
  await page.click('#bScript');
  ok((await page.$eval('#bScript', e => e.textContent)) === '简体', '切到簡體');
  ok((await page.$eval('#title', e => e.textContent)).includes('转一转'), '標題變簡體');
  const simpNames = await page.$$eval('.cell:not(.empty)', els => els.map(e => e.dataset.name));
  ok(!simpNames.some(n => /[廳圖館銀郵醫學藥園]/.test(n)), '地點名稱為簡體：' + simpNames.join(','));
  await page.click('#spin');
  await page.waitForSelector('.opt');
  const qtxt = await page.$eval('.q', e => e.textContent);
  ok(!/[裡麼邊後]/.test(qtxt), '題目為簡體：' + qtxt);
  await page.click('.opt[data-i="0"]');
  await page.click('#bScript');
  ok((await page.$eval('#bScript', e => e.textContent)) === '繁體', '切回繁體');

  // --- 圖片與文字開關 ---
  console.log('== 圖片與文字 ==');
  ok((await page.$$('.cell:not(.empty) .img svg')).length === 4, '每個地點格都有圖片（4 張）');
  ok((await page.$$('.cell:not(.empty) .n')).length === 4, '預設圖片下有文字');
  ok(await page.$eval('#bText', e => e.classList.contains('on')), '「文字」鈕預設亮著');
  const imgs = await page.$$eval('.cell:not(.empty) .img', els => els.map(e => e.innerHTML));
  ok(new Set(imgs).size === 4, '4 張圖片各不相同');
  await page.click('#bText');
  ok((await page.$$('.cell:not(.empty) .n')).length === 0, '關文字後格子沒有地點名稱');
  ok((await page.$$('.cell:not(.empty) .img svg')).length === 4, '關文字後圖片還在');
  ok(await page.$eval('#bText', e => !e.classList.contains('on')), '「文字」鈕熄掉');
  await page.click('#spin');
  await page.waitForSelector('.opt');
  ok(await page.$('.q') !== null, '關文字後題目仍正常出現');
  await page.click('.opt[data-i="0"]');
  await page.click('#bText');
  ok((await page.$$('.cell:not(.empty) .n')).length === 4, '再開文字，名稱回來');

  // --- 拼音 ---
  console.log('== 拼音 ==');
  ok(await page.$('.cell .p') === null, '預設無拼音');
  await page.click('#bPy');
  ok(await page.$('.cell .p') !== null, '開拼音後格子有拼音');
  ok(await page.$('.opt .op') !== null, '選項有拼音');
  ok(await page.$('.qp') !== null, '題目有拼音');
  await page.click('#bPy');
  ok(await page.$('.cell .p') === null, '關拼音');

  // --- 提示 ---
  console.log('== 提示 ==');
  await page.click('#spin').catch(() => {});
  await page.reload();
  await page.click('#bHint');
  ok(await page.$('.cell .h') !== null, '開提示後格子有方位標籤');
  await page.click('#spin');
  await page.waitForSelector('.opt');
  const hintInfo = await page.evaluate(() => {
    const f = +document.querySelector('#char').dataset.facing;
    return [...document.querySelectorAll('.cell:not(.empty)')].map(c => ({ s: +c.dataset.cell, h: c.querySelector('.h').textContent, f }));
  });
  ok(hintInfo.every(x => x.h === DIRS_T[(x.s - x.f + 8) % 8]), '提示標籤與計算一致');
  await page.click('#bHint');
  ok(await page.$('.cell .h') === null, '關提示');

  // --- 字典 ---
  console.log('== 小字典 ==');
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
  await page.click('#bScript').catch(() => {}); // 字典遮住時不應可按
  await page.click('#dClose');
  ok(await page.$eval('#dict', e => e.hidden), '字典關閉');

  // --- 困難模式 ---
  console.log('== 困難模式 ==');
  await page.click('#bMode');
  ok((await page.$eval('#bMode', e => e.textContent)).includes('困難'), '切到困難');
  ok((await page.$$('.cell:not(.empty)')).length === 8, '困難模式 8 個地點');
  const names = await page.$$eval('.cell:not(.empty)', els => els.map(e => e.dataset.name));
  ok(new Set(names).size === 8, '8 個地點不重複');
  await fullGame(page, 'hard');
  await page.click('#bMode');
  ok((await page.$$('.cell:not(.empty)')).length === 4, '切回簡單 4 個地點');

  // --- 重新整理保留設定 ---
  console.log('== 設定保留 ==');
  await page.click('#bPy');
  await page.click('#bText');
  await page.reload();
  ok(await page.$('.cell .p') === null, '文字關閉後，拼音也跟著不顯示（拼音屬於文字）');
  ok((await page.$$('.cell:not(.empty) .n')).length === 0, '重新整理後仍是關文字');
  await page.click('#bText');
  ok(await page.$('.cell .p') !== null, '重新整理後仍開著拼音');

  ok(errors.length === 0, '沒有 JS 錯誤' + (errors.length ? '：' + errors.join('; ') : ''));
  await browser.close();
  console.log(fails === 0 ? '\n全部通過' : `\n${fails} 項失敗`);
  process.exit(fails === 0 ? 0 : 1);
})();
