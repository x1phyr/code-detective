import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allMessages, detectPromptLocale, getLocale, resolveLocale, setLocale, t, type MessageKey } from '../shared/i18n';

const placeholders = (text: string): string[] => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]!).sort();

test('语言标签归一到 zh-CN / en', () => {
  assert.equal(resolveLocale('zh-cn'), 'zh-CN');
  assert.equal(resolveLocale('zh-TW'), 'zh-CN');
  assert.equal(resolveLocale(' zh_CN '), 'zh-CN');
  assert.equal(resolveLocale('ZH_hant_HK'), 'zh-CN');
  assert.equal(resolveLocale('zhx'), 'en');
  assert.equal(resolveLocale('en-US'), 'en');
  assert.equal(resolveLocale('ja'), 'en');
  assert.equal(resolveLocale(undefined), 'en');
});

test('预览问答和工具足迹按所选语言渲染，插值不被当作模板再次替换', () => {
  assert.match(t('webview.previewAnswer', { title: 'Read {record}', cite: '`src/example.ts:3`' }, 'en'), /Read \{record\}/);
  assert.equal(t('ai.sourceFile', undefined, 'en'), 'source file');
  assert.equal(t('ai.sourceFile', undefined, 'zh-CN'), '源码文件');
  assert.doesNotMatch(t('webview.appTitle', undefined, 'en'), /\p{Script=Han}/u);
  assert.match(t('webview.appTitle', undefined, 'zh-CN'), /代码侦探/);
});

test('每条文案两种语言都非空，且占位符一致', () => {
  for (const [key, message] of Object.entries(allMessages())) {
    assert.ok(message['zh-CN'].trim(), `${key} 缺少中文`);
    assert.ok(message.en.trim(), `${key} 缺少英文`);
    assert.deepEqual(placeholders(message.en), placeholders(message['zh-CN']), `${key} 占位符不一致`);
  }
});

test('英文文案里不残留中文', () => {
  for (const [key, message] of Object.entries(allMessages())) {
    assert.doesNotMatch(message.en, /[一-鿿]/, `${key} 的英文里有中文`);
  }
});

test('t() 按当前语言插值，且可选 locale 覆盖不污染全局语言', () => {
  const keys = Object.keys(allMessages()) as MessageKey[];
  if (keys.length === 0) return;
  const previous = getLocale();
  try {
    setLocale('en');
    assert.equal(typeof t(keys[0]!), 'string');
    assert.equal(t('chat.unknownReason', undefined, 'zh-CN'), '未知原因');
    assert.equal(getLocale(), 'en');
  } finally {
    setLocale(previous);
  }
});

test('detectPromptLocale 根据用户发起的对话文本识别语言，纯代码符号回退到界面语言', () => {
  const previous = getLocale();
  try {
    setLocale('en');
    assert.equal(detectPromptLocale('背包打开流程'), 'zh-CN');
    assert.equal(detectPromptLocale('`closeBagPanel` 怎么销毁面板'), 'zh-CN');
    assert.equal(detectPromptLocale('closeBagPanel'), 'en');
    assert.equal(detectPromptLocale('openBagPanel (bag-panel.ts:6)'), 'en');
    assert.equal(detectPromptLocale('src/bag-panel.ts:18-19'), 'en');
    assert.equal(detectPromptLocale('q'), 'en');
    assert.equal(detectPromptLocale(''), 'en');
    assert.equal(detectPromptLocale(undefined), 'en');

    setLocale('zh-CN');
    assert.equal(detectPromptLocale('bag opening flow'), 'en');
    assert.equal(detectPromptLocale('Explain closeBagPanel'), 'en');
    assert.equal(detectPromptLocale('Why does `refreshList` check `!panel`?'), 'en');
    assert.equal(detectPromptLocale('Why?'), 'en');
    assert.equal(detectPromptLocale('Explain src/登录.ts'), 'en');
    assert.equal(detectPromptLocale('Why: src/登录.ts'), 'en');
    assert.equal(detectPromptLocale('解释 src/login.ts 的流程'), 'zh-CN');
    assert.equal(detectPromptLocale('为什么src/login.ts会失败？'), 'zh-CN');
    assert.equal(detectPromptLocale('Explain src/用户/login.ts'), 'en');
    assert.equal(detectPromptLocale('バッグパネルを閉じる流れ'), 'en');
    assert.equal(detectPromptLocale('가방 패널 닫기 흐름'), 'en');
    assert.equal(detectPromptLocale('closeBagPanel'), 'zh-CN');
    assert.equal(detectPromptLocale('openBagPanel (bag-panel.ts:6)'), 'zh-CN');
    assert.equal(detectPromptLocale('src/bag-panel.ts:18-19'), 'zh-CN');
    assert.equal(detectPromptLocale('q'), 'zh-CN');
    assert.equal(detectPromptLocale(''), 'zh-CN');
    assert.equal(detectPromptLocale(undefined), 'zh-CN');
  } finally {
    setLocale(previous);
  }
});
