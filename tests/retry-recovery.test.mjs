import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../Bk-Trans-Test/index.html', import.meta.url), 'utf8');
const sw = fs.readFileSync(new URL('../Bk-Trans-Test/sw.js', import.meta.url), 'utf8');

const appVersion = html.match(/const APP_VERSION = '([^']+)'/)?.[1];
const cacheVersion = sw.match(/const CACHE_VER = '([^']+)'/)?.[1];
assert.equal(appVersion, cacheVersion, 'APP_VERSION and CACHE_VER must match');
assert.equal(appVersion, 'v20.55t');

const helperStart = html.indexOf('function _newStableId(');
const helperEnd = html.indexOf('function saveChatHistory(', helperStart);
assert.ok(helperStart >= 0 && helperEnd > helperStart, 'chat migration helpers must exist');

let seq = 0;
const context = {
  window: { crypto: { randomUUID: () => `uuid-${++seq}` } },
  chat: [
    { role: 'user', text: 'first' },
    { role: 'assistant', text: 'error:first', retryId: 'e1', retrySrc: 'first', retryN: 3 },
    { role: 'user', text: 'second' },
    { role: 'assistant', text: 'error:second', retryId: 'e1', retrySrc: 'second', retryN: 3, status: 'retrying', retrying: true },
  ],
};
vm.createContext(context);
vm.runInContext(html.slice(helperStart, helperEnd), context);

// The production detector uses the Korean error prefix. Keep test data ASCII, then set it here.
context.chat[1].text = '\uc624\ub958: first';
context.chat[3].text = '\uc624\ub958: second';
assert.equal(context._migrateChatRecords(), true);

const errors = context.chat.filter((m) => m.role === 'assistant');
assert.equal(new Set(errors.map((m) => m.messageId)).size, 2, 'reloaded errors need unique IDs');
assert.ok(errors.every((m) => m.retryId === m.messageId), 'retry target must be the stable message ID');
assert.ok(errors.every((m) => m.status === 'failed' && !m.retrying),
  'a reload must recover stale in-flight retries as failed work');
assert.equal(context.chat[0].jobId, context.chat[1].jobId, 'first source/result pair must share job ID');
assert.equal(context.chat[2].jobId, context.chat[3].jobId, 'second source/result pair must share job ID');

assert.doesNotMatch(html, /var _errSeq\s*=\s*0/, 'page-local sequential error IDs must not return');
assert.doesNotMatch(html, /retryN\s*\|\|\s*0\)\s*>=\s*3/, 'stored retry count must not permanently block recovery');
assert.match(html, /liveTarget\s*=\s*_findChatMessageById\(_targetMessageId\)/,
  'retry success must update the requested bubble directly');
assert.match(html, /if\(res && res\.ok\)\{[\s\S]*?_removeUrlQueueItem\(item\.id\)/,
  'URL work may be removed after success');
assert.match(html, /translate-failed-keep/,
  'failed URL work must remain durable for a later resume');

console.log('retry-recovery regression checks passed');
