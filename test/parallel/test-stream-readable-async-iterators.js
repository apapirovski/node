'use strict'

const common = require('../common');
const { Readable } = require('stream');
const assert = require('assert');

common.crashOnUnhandledRejection();

async function tests () {
  await (async function() {
    console.log('read without for..await');
    const max = 5;
    let readed = 0;
    let received = 0;
    const readable = new Readable({
      objectMode: true,
      read() {}
    });

    const iter = readable[Symbol.asyncIterator]();
    const values = [];
    for (var i = 0; i < max; i++) {
      values.push(iter.next());
    }
    Promise.all(values).then(common.mustCall((values) => {
      values.forEach(common.mustCall(
        item => assert.strictEqual(item.value, 'hello'), 5));
    }));

    readable.push('hello');
    readable.push('hello');
    readable.push('hello');
    readable.push('hello');
    readable.push('hello');
    readable.push(null);

    const last = await iter.next();
    assert.strictEqual(last.done, true);
  })();

  await (async function() {
    console.log('read object mode');
    const max = 42;
    let readed = 0;
    let received = 0;
    const readable = new Readable({
      objectMode: true,
      read() {
        this.push('hello');
        if (++readed === max) {
          this.push(null);
        }
      }
    });

    for await (const k of readable) {
      received++;
      assert.equal(k, 'hello');
    }

    assert.equal(readed, received);
  })();

  await (async function() {
    console.log('destroy sync');
    const readable = new Readable({
      objectMode: true,
      read() {
        this.destroy(new Error('kaboom from read'));
      }
    });

    let err;
    try {
      for await (const k of readable) {}
    } catch (e) {
      err = e;
    }
    assert.equal(err.message, 'kaboom from read');
  })();

  await (async function() {
    console.log('destroy async');
    const readable = new Readable({
      objectMode: true,
      read() {
        if (!this.pushed) {
          this.push('hello');
          this.pushed = true;

          setImmediate(() => {
            this.destroy(new Error('kaboom'));
          });
        }
      }
    });

    let received = 0;

    let err = null
    try {
      for await (const k of readable) {
        received++
      }
    } catch (e) {
      err = e;
    }

    assert.equal(err.message, 'kaboom');
    assert.equal(received, 1);
  })();

  await (async function() {
    console.log('destroyed by throw');
    const readable = new Readable({
      objectMode: true,
      read() {
        this.push('hello')
      }
    });

    let err = null;
    try {
      for await (const k of readable) {
        throw new Error('kaboom')
      }
    } catch (e) {
      err = e;
    }

    assert.equal(err.message, 'kaboom');
    assert.equal(readable.destroyed, true);
  })();

  await (async function() {
    console.log('destroyed sync after push');
    const readable = new Readable({
      objectMode: true,
      read() {
        this.push('hello');
        this.destroy(new Error('kaboom'));
      }
    });

    let received = 0;

    let err = null
    try {
      for await (const k of readable) {
        received++
      }
    } catch (e) {
      err = e;
    }

    assert.equal(err.message, 'kaboom');
    assert.equal(received, 1);
  })();

  await (async function() {
    console.log('push async');
    const max = 42;
    let readed = 0;
    let received = 0;
    const readable = new Readable({
      objectMode: true,
      read() {
        setImmediate(() => {
          this.push('hello');
          if (++readed === max) {
            this.push(null);
          }
        });
      }
    });

    for await (const k of readable) {
      received++;
      assert.equal(k, 'hello');
    }

    assert.equal(readed, received);
  })();

  await (async function() {
    console.log('push binary async');
    const max = 42;
    let readed = 0;
    const readable = new Readable({
      read() {
        setImmediate(() => {
          this.push('hello');
          if (++readed === max) {
            this.push(null);
          }
        });
      }
    });

    let expected = ''
    readable.setEncoding('utf8');
    readable.pause();
    readable.on('data', (chunk) => {
      expected += chunk
    });

    let data = ''
    for await (const k of readable) {
      data += k
    }

    assert.equal(data, expected);
  })();
}

tests().then(common.mustCall()); // to avoid missing some tests if a promise does not resolve
