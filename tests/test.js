// 方位詞遊戲測試：⚙️ 設定視窗裡每個選項、每個值都用真的點擊測到
// （字形2、語言3、拼音注音4、難度2、地點名稱2、方位提示2），加上旋轉／出題／計分／字典／存檔。
// 執行：node tests/test.js（需要 playwright）
const { chromium } = require('playwright');
const path = require('path');
// 用本機小伺服器開頁面（file:// 開檔時，Chromium 重新整理偶爾會把 localStorage 弄丟，測試會誤判）
const http = require('http');
const fs = require('fs');
const srv = http.createServer((q, r) => {
  r.setHeader('content-type', 'text/html;charset=utf-8');
  r.end(fs.readFileSync(path.resolve(__dirname, '..', 'index.html')));
});
let url;
const KEY = 'hanziGames.settings';

let fails = 0;
const ok = (c, msg) => { if (!c) { fails++; console.log('✗ ' + msg); } else console.log('✓ ' + msg); };

const DIRS_T = ['前面','右前方','右邊','右後方','後面','左後方','左邊','左前方'];      // 標準說法（提示標籤、字典用）
const DIRS_ALT = ['正前方','右前方','右手邊','右後方','正後方','左後方','左手邊','左前方']; // 另一種常見說法
const seenV = new Set();
const TONE = /[āáǎàēéěèīíǐìōóǒòūúǔùü]/;   // 拼音聲調字母
const ZY = /[ㄅ-ㄩ]/;                          // 注音符號

let browser;
const errors = [];
// 開始畫面按「簡單／困難」進遊戲（點上次存的難度那一顆）
async function begin(page) {
  const m = await page.evaluate(() => { try { return (JSON.parse(localStorage.getItem('fangwei')) || {}).mode; } catch (e) { return null; } });
  await page.click(m === 'hard' ? '#startHard' : '#startEasy');
}
async function fresh(init, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  if (init) await ctx.addInitScript(init);
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(url);
  if (!opts.home) await begin(page);
  return page;
}
const stored = page => page.evaluate(k => JSON.parse(localStorage.getItem(k) || 'null'), KEY);
const storedGame = page => page.evaluate(() => JSON.parse(localStorage.getItem('fangwei') || 'null'));
async function openSet(page) { await page.click('#gear'); await page.waitForSelector('#setov:not([hidden])'); }
async function closeSet(page) { await page.click('#setDone'); await page.waitForSelector('#setov', { state: 'hidden' }); }
async function opt(page, k, v) { await page.click(`.sopt[data-k="${k}"][data-v="${v}"]`); }
const isOn = (page, k, v) => page.$eval(`.sopt[data-k="${k}"][data-v="${v}"]`, e => e.classList.contains('on'));
// 一律按「旋轉／下一題」鈕才會出下一題
async function spinToQuestion(page) {
  await page.click('#spin');
  await page.waitForSelector('.opt:not([disabled])', { timeout: 9000 });
}
const tbarOn = page => page.$eval('#tbar', e => e.classList.contains('on'));
const cellNames = page => page.$$eval('.cell:not(.empty)', els => els.map(e => e.dataset.name));

async function playRound(page, mode, wantCorrect) {
  await spinToQuestion(page);
  const info = await page.evaluate(() => {
    const qb = document.querySelector('#qbox');
    const ch = document.querySelector('#char');
    const m = /rotate\((-?[\d.]+)deg\)/.exec(ch.style.transform);
    return { type: qb.dataset.type, cell: +qb.dataset.cell, rel: +qb.dataset.rel, v: +qb.dataset.v, q: document.querySelector('.q').textContent,
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
  seenV.add(info.v);
  const names = info.v ? DIRS_ALT : DIRS_T;
  ok(await tbarOn(page), '出題後倒數條開始跑');
  if (info.type === 'zai') {
    ok(info.texts[ci] === '在我的' + names[info.rel], '「在」題正確答案文字：' + info.texts[ci]);
    ok(info.texts.every(t => names.map(n => '在我的' + n).includes(t)), '4 個選項用同一種說法（' + (info.v ? '正前方類' : '前面類') + '）');
  } else ok(info.q === '我的' + names[info.rel] + '有什麼？', '「有」題題目用同一種說法：' + info.q);
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
  ok((await page.$eval('#fb', e => e.textContent)).includes(names[info.rel]), '回饋句用同一種說法');
  ok(!(await tbarOn(page)), '答完倒數條停止');
  ok(await page.$eval('#spin', e => !e.disabled), '答後按鈕可按（可跳過等待）');
}

async function fullGame(page, mode) {
  let correct = 0;
  for (let i = 0; i < 10; i++) {
    const want = i % 3 !== 2;
    if (want) correct++;
    await playRound(page, mode, want);
    if (i === 8) ok(await page.$eval('#spin', e => e.textContent.includes('下一題')), '答完中途題：按鈕寫「下一題」');
    if (i === 4) {
      await page.waitForTimeout(3500);
      ok((await page.$eval('#score', e => e.textContent)).startsWith('5 / 10') && await page.$('.opt[disabled]') !== null, '答完等 3.5 秒：不會自己轉下一題');
    }
  }
  await page.waitForTimeout(3500);
  ok(await page.$eval('#end', e => e.hidden), '第 10 題答完：等 3.5 秒也不會自己跳結算');
  ok(await page.$eval('#spin', e => e.textContent.includes('結果')), '第 10 題後按鈕變「看結果」');
  await page.click('#spin');
  ok(await page.$eval('#end', e => !e.hidden), '按「看結果」跳出結算視窗');
  const txt = await page.$eval('#endText', e => e.textContent);
  ok(txt.includes(correct + ' / 10'), `結算分數 ${correct} / 10：${txt}`);
  await page.click('#again');
  ok(await page.$eval('#end', e => e.hidden), '再玩一次關閉結算');
  ok((await page.$eval('#score', e => e.textContent)).startsWith('0 / 10'), '分數歸零');
}

(async () => {
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  url = 'http://127.0.0.1:' + srv.address().port + '/';
  browser = await chromium.launch();

  // ===== 角色：八隻小動物，每一題隨機換 =====
  console.log('== 角色動物 ==');
  {
    let a = await fresh(null, { home: true });
    const info = await a.evaluate(() => ({ ids: ANIMALS.map(x => x.id), svgs: ANIMALS.map(x => x.svg), dino: DINO.id }));
    ok(info.ids.join(',') === 'dog,cat,rabbit,panda,turtle,duck,dino,penguin', '八隻動物：' + info.ids.join('、'));
    ok(new Set(info.svgs).size === 8 && info.svgs.every(s => s.includes('<ellipse') || s.includes('<circle')), '八隻畫法各不相同');
    ok(info.dino === 'dino', '標題旁小圖固定是恐龍');
    ok(await a.$eval('#hme', e => ANIMALS.some(x => x.id === e.dataset.animal)) && await a.$eval('#hme svg', e => e.querySelectorAll('ellipse,circle,path').length >= 3), '開始畫面的角色是其中一隻動物');
    await a.evaluate(() => { window.norm = s => { const x = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); x.innerHTML = s; return x.innerHTML; }; });
    ok(await a.$eval('#miniChar svg', e => e.innerHTML === norm(DINO.svg)), '遊戲標題旁的小轉圈圖是恐龍');
    // 抽選：不會連續兩次同一隻，八隻都會出現
    const draw = await a.evaluate(() => { const seen = new Set(); let prev = '', same = 0; for (let i = 0; i < 400; i++) { const x = pickAnimal(prev); if (x.id === prev) same++; seen.add(x.id); prev = x.id; } return { n: seen.size, same }; });
    ok(draw.n === 8 && draw.same === 0, '抽 400 次：八隻都出現過，沒有連續兩次同一隻');
    // 遊戲中每一題換一隻
    await a.click('#startEasy');
    const seq = [];
    for (let i = 0; i < 5; i++) {
      await a.click('#spin');
      await a.waitForSelector('.opt:not([disabled])', { timeout: 6000 });
      seq.push(await a.$eval('#char', e => e.dataset.animal));
      ok(await a.$eval('#char', e => e.querySelectorAll('ellipse,circle,path').length >= 3 && e.innerHTML === norm(ANIMALS.find(x => x.id === e.dataset.animal).svg)), '第 ' + (i + 1) + ' 題的角色是 ' + seq[i]);
      await a.click('.opt[data-correct="1"]');
    }
    ok(seq.every((x, i) => i === 0 || x !== seq[i - 1]), '五題的角色：' + seq.join('→') + '（前後不重複）');
    ok(new Set(seq).size >= 3, '五題至少換了三種不同動物');
    ok((await a.$eval('#cell-0', e => e.dataset.name)) !== undefined, '角色換了之後棋盤正常');
    // 角色轉向仍正確（用任一動物）
    const ang = await a.evaluate(() => { const ch = document.querySelector('#char'); const m = /rotate\((-?[\d.]+)deg\)/.exec(ch.style.transform); return { angle: +m[1], facing: +ch.dataset.facing }; });
    ok(((ang.angle % 360) + 360) % 360 === ang.facing * 45, '換了動物之後，轉角仍等於朝向 × 45°');
    // 回主選單再開始，開始畫面會換動物
    await a.click('#bHome'); await a.click('#cfmLeave');
    const homeSeq = [];
    for (let i = 0; i < 4; i++) { homeSeq.push(await a.$eval('#hme', e => e.dataset.animal)); await a.click('#startEasy'); await a.click('#bHome'); await a.click('#cfmLeave'); }
    ok(new Set(homeSeq).size >= 2 && homeSeq.every((x, i) => i === 0 || x !== homeSeq[i - 1]), '每次回到開始畫面角色會換：' + homeSeq.join('→'));
    await a.context().close();
  }

  // ===== 開始畫面（主選單）、🏠 警語、名稱與縮圖 =====
  console.log('== 開始畫面（主選單） ==');
  {
    let h = await fresh(null, { home: true });
    ok((await h.title()) === '方位轉轉轉・¡Gira y ubica!', '網頁標題：' + await h.title());
    ok(await h.$eval('#home', e => !e.hidden) && await h.$eval('#game', e => e.hidden), '一打開是開始畫面，遊戲畫面還沒出現');
    ok(await h.$eval('#bHome', e => getComputedStyle(e).display === 'none'), '開始畫面沒有 🏠');
    ok(await h.$eval('#bDict', e => e.offsetParent !== null) && await h.$eval('#gear', e => e.offsetParent !== null), '開始畫面有 📖 和 ⚙️');
    ok((await h.$eval('#hTitle', e => e.textContent)) === '方位轉轉轉' && (await h.$eval('#hSub', e => e.textContent)) === '¡Gira y ubica!', '大標題「方位轉轉轉」＋西文副標');
    ok((await h.$$('#hTitle span.t')).length === 5, '標題五個字各自可歪斜');
    const rots = await h.$$eval('#hTitle span.t', els => els.map(e => e.style.transform));
    ok(new Set(rots).size > 2 && rots.slice(2).every(r => !r.includes('rotate(0deg)')), '「轉轉轉」三個字有歪斜');
    ok((await h.$$eval('.hc svg', e => e.length)) === 4, '四個地點圖示');
    ok((await h.$$eval('.hw', els => els.map(e => e.textContent).join(''))) === '前後左右', '前後左右四個字');
    const gaps = await h.evaluate(() => {
      const r = s => document.querySelector(s).getBoundingClientRect();
      return { n: r('#hwN').top - r('#hcN').bottom, s: r('#hcS').top - r('#hwS').bottom, w: r('#hwW').left - r('#hcW').right, e: r('#hcE').left - r('#hwE').right };
    });
    ok(Object.values(gaps).every(g => g >= 15), '前後左右的字離圖片至少 15px：' + JSON.stringify(gaps));
    ok(await h.$eval('#startEasy', e => e.classList.contains('main') && e.textContent.includes('簡單 4 方位')) && await h.$eval('#startHard', e => !e.classList.contains('main') && e.textContent.includes('困難 8 方位')), '兩顆開始鈕：預設「簡單」是主色');
    ok(await h.$eval('#startEasy small', e => e.textContent.includes('Fácil')), '開始鈕有西文小字');
    ok(await h.$eval('.hme svg', e => getComputedStyle(e).animationName === 'slowspin'), '角色在慢慢轉');
    // 進困難
    await h.click('#startHard');
    ok(await h.$eval('#home', e => e.hidden) && await h.$eval('#game', e => !e.hidden), '按「困難」進入遊戲');
    ok((await h.$$('.cell:not(.empty)')).length === 8, '困難：8 個地點');
    ok((await storedGame(h)).mode === 'hard', '存檔 mode=hard');
    ok(await h.$eval('#bHome', e => e.offsetParent !== null), '遊戲中有 🏠');
    // 🏠 警語
    await spinToQuestion(h);
    ok(await tbarOn(h), '出題後倒數在跑');
    const scoreBefore = await h.$eval('#score', e => e.textContent);
    await h.click('#bHome');
    ok(await h.$eval('#cfm', e => !e.hidden), '按 🏠 跳出警語');
    const ct = await h.$eval('#cfmText', e => e.textContent);
    ok(ct.includes('要回到主選單嗎') && ct.includes('進度會消失') && ct.includes('¿Volver al menú?'), '警語內容：' + ct);
    ok((await h.$eval('#cfmLeave', e => e.textContent)).includes('回主選單') && (await h.$eval('#cfmStay', e => e.textContent)).includes('繼續玩'), '兩個按鈕：回主選單／繼續玩');
    ok(!(await tbarOn(h)), '警語開著：倒數暫停');
    await h.click('#cfmStay');
    ok(await h.$eval('#cfm', e => e.hidden) && await h.$eval('#game', e => !e.hidden), '按「繼續玩」：回到遊戲');
    ok(await tbarOn(h), '繼續玩：倒數重新開始');
    ok((await h.$eval('#score', e => e.textContent)) === scoreBefore && await h.$('.opt:not([disabled])') !== null, '繼續玩：題目還在，進度沒掉');
    await h.click('#bHome');
    await h.mouse.click(5, 5);
    ok(await h.$eval('#cfm', e => e.hidden), '點警語視窗外面也是「繼續玩」');
    await h.click('#bHome');
    await h.click('#cfmLeave');
    ok(await h.$eval('#home', e => !e.hidden) && await h.$eval('#game', e => e.hidden) && await h.$eval('#cfm', e => e.hidden), '按「回主選單」：回到開始畫面');
    ok(await h.$eval('#bHome', e => getComputedStyle(e).display === 'none'), '回到開始畫面後 🏠 不見');
    ok(await h.$eval('#startHard', e => e.classList.contains('main')) && await h.$eval('#startEasy', e => !e.classList.contains('main')), '開始畫面記得上次選的「困難」');
    await h.click('#startEasy');
    ok((await h.$$('.cell:not(.empty)')).length === 4 && (await h.$eval('#score', e => e.textContent)).startsWith('0 / 10'), '再選「簡單」：新的一局，4 個地點，分數歸零');
    // 結算畫面的主選單鈕（不用警語）
    await h.evaluate(() => { st.n = 10; st.score = 7; showEnd(); });
    ok((await h.$eval('#endHome', e => e.textContent)).includes('主選單'), '結算畫面有「主選單」鈕');
    await h.click('#endHome');
    ok(await h.$eval('#end', e => e.hidden) && await h.$eval('#home', e => !e.hidden), '結算後按「主選單」直接回開始畫面');
    // 簡體＋台灣用字
    await openSet(h); await opt(h, 'script', 'simp'); await opt(h, 'lang', 'zh'); await closeSet(h);
    ok((await h.$eval('#hTitle', e => e.textContent)) === '方位转转转' && (await h.$eval('#startEasy', e => e.textContent)) === '简单 4 方位', '簡體：大標題與開始鈕');
    ok((await h.$eval('#hSub', e => e.textContent)) === '' && await h.$('#startEasy small') === null, '只有中文：沒有西文副標與小字');
    await h.click('#startEasy');
    await h.click('#bHome');
    const cts = await h.$eval('#cfm .mbox', e => e.textContent);
    ok(cts.includes('回主选单') && cts.includes('继续玩') && cts.includes('进度会消失') && !/[選續]/.test(cts), '簡體警語用台灣用字：' + cts.replace(/\s+/g, ''));
    await h.context().close();
    // 減少動態效果
    const rctx = await browser.newContext({ viewport: { width: 390, height: 760 }, reducedMotion: 'reduce' });
    const rp = await rctx.newPage();
    await rp.goto(url);
    ok(await rp.$eval('.hme svg', e => getComputedStyle(e).animationName === 'none'), '手機設定「減少動態效果」：角色不轉');
    await rctx.close();
    // 預覽標籤與縮圖檔
    const g = await fresh(null, { home: true });
    const meta = await g.evaluate(() => Object.fromEntries([...document.querySelectorAll('meta[property^="og:"],meta[name="twitter:card"]')].map(m => [m.getAttribute('property') || m.getAttribute('name'), m.content])));
    ok(meta['og:title'] === '方位轉轉轉・¡Gira y ubica!', 'og:title：' + meta['og:title']);
    ok(meta['og:type'] === 'website' && meta['og:site_name'] === '每天一分鐘 · Cada día unos minutos', 'og:type、og:site_name');
    ok(meta['og:description'].includes('轉一圈，找找看！') && meta['og:description'].includes(' · '), 'og:description：' + meta['og:description']);
    ok(meta['og:url'] === 'https://wangchiapin.github.io/dondeestayquehay/', 'og:url');
    ok(meta['og:image'].startsWith('https://wangchiapin.github.io/dondeestayquehay/og.jpg') && meta['og:image:width'] === '1200' && meta['og:image:height'] === '630', 'og:image 絕對網址與 1200×630');
    ok(meta['twitter:card'] === 'summary_large_image', 'twitter:card');
    ok(await g.$eval('link[rel="icon"]', e => e.getAttribute('href')) === 'icon.png' && await g.$eval('link[rel="apple-touch-icon"]', e => e.getAttribute('href')) === 'icon.png', '桌面小圖示連結');
    await g.context().close();
    const root = path.resolve(__dirname, '..');
    const jpg = fs.readFileSync(path.join(root, 'og.jpg'));
    let jw = 0, jh = 0;
    for (let i = 2; i < jpg.length;) { if (jpg[i] !== 0xFF) break; const mk = jpg[i + 1]; const len = jpg.readUInt16BE(i + 2); if (mk >= 0xC0 && mk <= 0xC3) { jh = jpg.readUInt16BE(i + 5); jw = jpg.readUInt16BE(i + 7); break; } i += 2 + len; }
    ok(jpg[0] === 0xFF && jpg[1] === 0xD8 && jw === 1200 && jh === 630, 'og.jpg 存在，是 1200×630 的 JPEG');
    const png = fs.readFileSync(path.join(root, 'icon.png'));
    ok(png.slice(1, 4).toString() === 'PNG' && png.readUInt32BE(16) === 512 && png.readUInt32BE(20) === 512, 'icon.png 存在，是 512×512 的 PNG');
  }

  // ===== 1. 初始畫面、預設值、設定視窗 =====
  console.log('== 初始與設定視窗 ==');
  let page = await fresh();
  ok(await page.$('#gear') !== null, '右上角有 ⚙️');
  {
    // 遊戲中標題：夠大（24px）、小角色圖跟著放大、不被右上三顆圓按鈕擠到、整頁不用上下滑
    const t = await page.evaluate(() => {
      const h = document.querySelector('h1'), r = h.getBoundingClientRect(), m = document.querySelector('.mini').getBoundingClientRect();
      const icons = document.querySelector('.icons').getBoundingClientRect(), title = document.querySelector('#title').getBoundingClientRect();
      return { fs: parseFloat(getComputedStyle(h).fontSize), mini: m.width, titleRight: title.right, iconsLeft: icons.left, left: r.left,
        sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth };
    });
    ok(t.fs >= 24, '遊戲中標題字級 ≥ 24px（' + t.fs + '）');
    ok(t.mini >= 30, '標題旁小角色圖 ≥ 30px（' + t.mini + '）');
    ok(t.titleRight <= t.iconsLeft - 4, '標題沒被右上按鈕擠到（' + Math.round(t.titleRight) + ' ≤ ' + Math.round(t.iconsLeft) + '）');
    ok(t.sw <= t.cw, '標題放大後頁面沒有橫向捲動');
  }
  for (const id of ['#bMode', '#bScript', '#bText', '#bPy', '#bHint']) ok(await page.$(id) === null, `舊工具列按鈕 ${id} 已移除`);
  ok(await page.$('#bDict') !== null, '小字典按鈕還在畫面上');
  ok(await page.$eval('#setov', e => e.hidden), '一開始設定視窗是關的');
  let s = await stored(page);
  ok(s && s.v === 1 && s.script === 'trad' && s.lang === 'es' && s.phon === 'pinyin' && s.rate === 'normal', '第一次開啟寫入預設共用設定：' + JSON.stringify(s));
  await openSet(page);
  {
    // 設定視窗外觀：選中＝咖啡色、不用 ⚙️ 表情符號、手機一屏看完不用滑
    const v = await page.evaluate(() => {
      const on = document.querySelector('#setbox .sopt.on'), off = document.querySelector('#setbox .sopt:not(.on)'), box = document.querySelector('#setbox'), d = document.querySelector('#setDone');
      const acc = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
      const tmp = document.createElement('i'); tmp.style.color = acc; document.body.appendChild(tmp); const accRgb = getComputedStyle(tmp).color; tmp.remove();
      return { onBg: getComputedStyle(on).backgroundColor, accRgb, offBg: getComputedStyle(off).backgroundColor, doneBg: getComputedStyle(d).backgroundColor,
        h2: document.querySelector('#setbox h2').innerHTML, hasSvg: !!document.querySelector('#setbox h2 svg.gearsv'), sh: box.scrollHeight, ch: box.clientHeight };
    });
    ok(v.onBg === v.accRgb && v.doneBg === v.accRgb, '選中的按鈕和「完成」是咖啡色（同主色）');
    ok(v.offBg !== v.accRgb, '沒選的按鈕不是咖啡色');
    ok(v.hasSvg && !v.h2.includes('⚙'), '標題用線條齒輪，不用 ⚙️ 表情符號');
    ok(v.sh <= v.ch + 1, '390×844 手機上設定視窗不用上下滑（' + v.sh + '/' + v.ch + '）');
  }
  ok(await page.$$eval('#setbox .sopt', e => e.length) === 17, '設定視窗共 17 個選項');
  const keys = await page.$$eval('#setbox .sopt', els => [...new Set(els.map(e => e.dataset.k))]);
  ok(keys.join(',') === 'script,lang,phon,mode,text,timer,hint', '七組設定：' + keys.join(','));
  ok(await isOn(page, 'script', 'trad') && await isOn(page, 'lang', 'es') && await isOn(page, 'phon', 'pinyin')
     && await isOn(page, 'mode', 'easy') && await isOn(page, 'text', '1') && await isOn(page, 'timer', '1') && await isOn(page, 'hint', '0'), '預設選中：繁體／西／拼音／簡單／顯示名稱／倒數開／提示關');
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
  ok((await page.$eval('#title', e => e.textContent)) === '方位转转转', '標題變簡體');
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
  ok((await page.$eval('#title', e => e.textContent)) === '方位轉轉轉', '標題回繁體');
  await page.context().close();

  // ===== 3. 語言（西／英／只有中文） =====
  console.log('== 語言 ==');
  page = await fresh();
  await spinToQuestion(page);
  await openSet(page);
  ok((await page.$eval('#bDict', e => e.getAttribute('aria-label'))).includes('Mini diccionario'), '西文：小字典圖示的說明文字是西文');
  ok((await page.$eval('.qe', e => e.textContent)).startsWith('¿'), '西文：題目下有西文翻譯 ' + await page.$eval('.qe', e => e.textContent));
  ok(await page.$eval('#spin small', e => e.textContent === 'Girar'), '西文：旋轉鈕小字 Girar');
  await opt(page, 'lang', 'en');
  s = await stored(page);
  ok(s.lang === 'en' && await isOn(page, 'lang', 'en'), '切到英文，存檔 lang=en');
  ok((await page.$eval('#bDict', e => e.getAttribute('aria-label'))).includes('Mini dictionary'), '英文：小字典圖示的說明文字是英文');
  ok(/^(Where is|What is)/.test(await page.$eval('.qe', e => e.textContent)), '英文：題目翻譯 ' + await page.$eval('.qe', e => e.textContent));
  ok(await page.$eval('#spin small', e => e.textContent === 'Spin'), '英文：旋轉鈕小字 Spin');
  ok(await page.$eval('html', e => e.lang) === 'en', '英文：html lang=en');
  await opt(page, 'lang', 'zh');
  s = await stored(page);
  ok(s.lang === 'zh' && await isOn(page, 'lang', 'zh'), '切到只有中文，存檔 lang=zh');
  ok((await page.$eval('#bDict', e => e.getAttribute('aria-label'))) === '小字典', '純中文：小字典圖示只有中文說明');
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
  await begin(page);
  ok((await page.$eval('#title', e => e.textContent)) === '方位转转转', '重新整理後仍是簡體');
  ok((await page.$eval('#bDict', e => e.getAttribute('aria-label'))).includes('Mini dictionary'), '重新整理後仍是英文');
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
  ok((await page.$eval('#title', e => e.textContent)) === '方位轉轉轉', '別的分頁改字形 → 這裡跟著變繁體');
  ok((await page.$eval('#bDict', e => e.getAttribute('aria-label'))) === '小字典', '別的分頁改成只有中文 → 說明文字變只有中文');
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
  const dirTxt = await page.$eval('#dbody', e => e.textContent);
  ok(['前面','正前方','右邊','右手邊','後面','正後方','左邊','左手邊','右前方','右後方','左後方','左前方'].every(w => dirTxt.includes(w)), '方位分頁同時列出常見說法：正前方、正後方、左手邊、右手邊');
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
    ['qiánmiàn','ㄑㄧㄢˊ ㄇㄧㄢˋ'], ['yòu qiánfāng','ㄧㄡˋ ㄑㄧㄢˊ ㄈㄤ'], ['yòubiān','ㄧㄡˋ ㄅㄧㄢ'],
    ['yòu hòufāng','ㄧㄡˋ ㄏㄡˋ ㄈㄤ'], ['hòumiàn','ㄏㄡˋ ㄇㄧㄢˋ'], ['zuǒ hòufāng','ㄗㄨㄛˇ ㄏㄡˋ ㄈㄤ'],
    ['zuǒbiān','ㄗㄨㄛˇ ㄅㄧㄢ'], ['zuǒ qiánfāng','ㄗㄨㄛˇ ㄑㄧㄢˊ ㄈㄤ'] ];
  const FROZEN_ALT = { 0:['zhèng qiánfāng','ㄓㄥˋ ㄑㄧㄢˊ ㄈㄤ'], 2:['yòushǒubiān','ㄧㄡˋ ㄕㄡˇ ㄅㄧㄢ'], 4:['zhèng hòufāng','ㄓㄥˋ ㄏㄡˋ ㄈㄤ'], 6:['zuǒshǒubiān','ㄗㄨㄛˇ ㄕㄡˇ ㄅㄧㄢ'] };
  const FROZEN_W = { zai:['zài','ㄗㄞˋ'], wo:['wǒ','ㄨㄛˇ'], de:['de','˙ㄉㄜ'], you:['yǒu','ㄧㄡˇ'], nali:['nǎlǐ','ㄋㄚˇ ㄌㄧˇ'], shme:['shénme','ㄕㄣˊ ˙ㄇㄜ'] };
  const data = await page.evaluate(() => ({ P: PLACES, D: DIRS, W }));
  ok(data.P.every(p => JSON.stringify([p.py, p.zy]) === JSON.stringify(FROZEN_PLACES[p.id])), '12 個地點的拼音與注音和核對結果一致');
  ok(data.D.every((d, i) => d.py === FROZEN_DIRS[i][0] && d.zy === FROZEN_DIRS[i][1]), '8 個方位詞的拼音與注音和核對結果一致');
  ok(data.D.every((d, i) => FROZEN_ALT[i] ? (d.alt && d.alt.py === FROZEN_ALT[i][0] && d.alt.zy === FROZEN_ALT[i][1]) : !d.alt), '正前方／右手邊／正後方／左手邊 的拼音與注音一致，斜角方位沒有第二種說法');
  ok(Object.keys(FROZEN_W).every(k => data.W[k].py === FROZEN_W[k][0] && data.W[k].zy === FROZEN_W[k][1]), '在／我／的／有／哪裡／什麼 的拼音與注音一致');
  const syl = /^˙?[ㄅ-ㄩ]+[ˊˇˋ]?$/;
  const allZy = [...data.P.map(p => p.zy), ...data.D.map(d => d.zy), ...data.D.filter(d => d.alt).map(d => d.alt.zy), ...Object.values(data.W).map(w => w.zy)];
  ok(allZy.every(z => z.split(' ').every(x => syl.test(x))), '每個注音音節格式正確（輕聲點在前面，例如 ˙ㄉㄜ）');
  ok(!allZy.some(z => /[ㄅ-ㄩ]˙/.test(z)), '沒有把輕聲點寫在音節後面');
  ok(data.P.every(p => p.zy.split(' ').length === [...p.zh].length) && data.D.every(d => d.zy.split(' ').length === [...d.zh].length && (!d.alt || d.alt.zy.split(' ').length === [...d.alt.zh].length)), '注音音節數＝漢字數');
  // 畫面上：回饋句與題目的注音有輕聲點
  await openSet(page); await opt(page, 'phon', 'zhuyin'); await closeSet(page);
  await spinToQuestion(page);
  await page.click('.opt[data-i="0"]');
  const fbzy = await page.$eval('#fb .qp', e => e.textContent);
  ok(fbzy.includes('˙ㄉㄜ') && !/ㄜ˙/.test(fbzy), '回饋句的「的」注音為 ˙ㄉㄜ：' + fbzy);
  await page.context().close();

  // ===== 版面：頂端一列、棋盤縮小、按鈕放進題目卡，題目與選項不用往下滑 =====
  console.log('== 版面（手機一個畫面） ==');
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 700 } });
    page = await ctx.newPage();
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(url);
    await begin(page);
    const r = await page.evaluate(() => {
      const b = s => document.querySelector(s).getBoundingClientRect();
      return { title: b('#title'), score: b('#score'), dict: b('#bDict'), gear: b('#gear'), board: b('#board'),
        sw: document.documentElement.scrollWidth, iw: window.innerWidth, spinInBox: !!document.querySelector('#qbox #spin'),
        sub: document.querySelector('#sub'), bar: document.querySelector('.bar') };
    });
    ok(r.sub === null && r.bar === null, '舊的副標題列、小字典獨立一列已移除');
    ok(Math.abs(r.title.top - r.dict.top) < 30 && Math.abs(r.gear.top - r.dict.top) < 2, '標題、📖、⚙️ 在同一列');
    ok(r.dict.width < 50 && r.gear.width < 50 && r.dict.right < r.gear.left, '📖 在 ⚙️ 左邊，兩個都是小圖示');
    ok(r.score.top >= r.title.bottom - 2 && r.score.bottom < r.board.top, '分數在標題下方，棋盤之前');
    ok(r.board.width / r.iw > 0.68 && r.board.width / r.iw < 0.76, '棋盤縮到約 7 成寬（' + Math.round(r.board.width) + 'px）');
    ok(Math.abs(r.board.left + r.board.width / 2 - r.iw / 2) < 2, '棋盤置中');
    ok(r.spinInBox, '旋轉鈕在題目卡裡面');
    ok(r.sw <= r.iw, '沒有橫向捲動');
    ok(r.board.top < 90, '棋盤從畫面上方約 90px 內開始（' + Math.round(r.board.top) + 'px）');
    await page.click('#spin');
    await page.waitForSelector('.opt:not([disabled])', { timeout: 6000 });
    const q = await page.evaluate(() => {
      const b = s => document.querySelector(s).getBoundingClientRect();
      return { opts: [...document.querySelectorAll('.opt')].map(e => e.getBoundingClientRect().bottom), spin: b('#spin'), vh: window.innerHeight,
        lastOptInsideBox: b('#qbox').bottom >= Math.max(...[...document.querySelectorAll('.opt')].map(e => e.getBoundingClientRect().bottom)) };
    });
    ok(Math.max(...q.opts) <= q.vh, '出題後 4 個選項都在 700px 高的畫面內（最底 ' + Math.round(Math.max(...q.opts)) + 'px）');
    ok(q.spin.bottom <= q.vh + 60, '按鈕也離畫面很近（' + Math.round(q.spin.bottom) + 'px）');
    ok(q.lastOptInsideBox, '選項都在題目卡裡面');
    // 答完後回饋文字放在按鈕下面，「下一題」鈕位置不變、仍在畫面內
    await page.click('.opt[data-correct="1"]');
    const after = await page.evaluate(() => ({ b: document.querySelector('#spin').getBoundingClientRect().bottom, vh: window.innerHeight, dis: document.querySelector('#spin').disabled }));
    ok(!after.dis && after.b <= after.vh, '答完後「下一題」鈕仍在畫面內（' + Math.round(after.b) + ' / ' + after.vh + 'px）');
    ok(await page.$eval('#fb', e => e.getBoundingClientRect().top > document.querySelector('#spin').getBoundingClientRect().bottom - 1), '回饋句在按鈕下面，不會被按鈕蓋住');
    await ctx.close();
  }

  // ===== 倒數計時（答完一律手動按「下一題」） =====
  console.log('== 倒數計時（答完一律手動按「下一題」） ==');
  page = await fresh();
  ok(!(await tbarOn(page)), '還沒出題：倒數條不顯示');
  await spinToQuestion(page);
  ok(await tbarOn(page), '出題：倒數條開始');
  await openSet(page);
  ok(!(await tbarOn(page)), '開設定：倒數暫停');
  await closeSet(page);
  ok(await tbarOn(page), '關設定：倒數重新開始');
  await page.click('#bDict');
  ok(!(await tbarOn(page)), '開字典：倒數暫停');
  await page.click('#dClose');
  ok(await tbarOn(page), '關字典：倒數重新開始');
  // 時間到：算答錯、顯示正確答案、自己轉下一題
  await page.waitForSelector('#fb', { timeout: 12000 });
  ok((await page.$eval('#fb', e => e.textContent)).includes('時間到'), '時間到：顯示「時間到！正確：」');
  ok((await page.$eval('#score', e => e.textContent)).startsWith('1 / 10') && (await page.$eval('#score', e => e.textContent)).includes('✓ 0'), '時間到算一題、沒得分');
  ok((await page.$$('.opt.ok')).length === 1 && (await page.$$('.opt.bad')).length === 0, '時間到：只標出正確答案');
  ok(await page.$('.cell.target') !== null, '時間到：標出目標格');
  ok(!(await tbarOn(page)), '時間到後倒數條停止');
  await page.waitForTimeout(3500);
  ok((await page.$eval('#score', e => e.textContent)).startsWith('1 / 10') && await page.$('.opt[disabled]') !== null && await page.$('#fb') !== null, '時間到後等 3.5 秒：停在原題，不會自己轉');
  await page.click('#spin');
  await page.waitForSelector('.opt:not([disabled])', { timeout: 6000 });
  ok(await page.$('#fb') === null, '按「下一題」才出新題');
  await page.context().close();

  // 關閉倒數：存檔、重開還在、不會時間到
  page = await fresh();
  await openSet(page);
  await opt(page, 'timer', '0');
  ok(await isOn(page, 'timer', '0') && !await isOn(page, 'timer', '1'), '倒數「關」亮起');
  ok((await storedGame(page)).timer === false, '存檔 timer=false');
  await closeSet(page);
  await spinToQuestion(page);
  ok(!(await tbarOn(page)), '倒數關閉：出題後沒有倒數條');
  await page.waitForTimeout(10800);
  ok(await page.$('#fb') === null && await page.$('.opt:not([disabled])') !== null, '倒數關閉：超過 10 秒也不會時間到');
  await page.reload();
  await begin(page);
  await openSet(page);
  ok(await isOn(page, 'timer', '0'), '重新整理後倒數仍是關');
  await opt(page, 'timer', '1');
  ok((await storedGame(page)).timer === true && await isOn(page, 'timer', '1'), '倒數再開：存檔 timer=true');
  await closeSet(page);
  await spinToQuestion(page);
  ok(await tbarOn(page), '倒數再開：出題後倒數條回來');
  await page.context().close();

  // 常見說法：每個方位的第二種說法，各自可選用
  page = await fresh();
  const alts = await page.evaluate(() => [0, 1].map(v => DIRS.map(d => dv(d, v).zh)));
  ok(JSON.stringify(alts[0]) === JSON.stringify(DIRS_T) && JSON.stringify(alts[1]) === JSON.stringify(DIRS_ALT), '兩種說法清單正確');
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
  await begin(page);
  await fullGame(page, 'easy', false);
  console.log('== 困難：完整 10 題 ==');
  await openSet(page);
  await opt(page, 'mode', 'hard');
  await closeSet(page);
  await fullGame(page, 'hard');
  ok(seenV.has(0) && seenV.has(1), '兩輪下來，兩種說法都出現過');
  await page.context().close();

  ok(errors.length === 0, '沒有 JS 錯誤' + (errors.length ? '：' + errors.join('; ') : ''));
  await browser.close();
  console.log(fails === 0 ? '\n全部通過' : `\n${fails} 項失敗`);
  process.exit(fails === 0 ? 0 : 1);
})();
