'use strict';

require('../common');
const assert = require('assert');
const EventEmitter = require('events');

const _events = EventEmitter.prototype._events;

const ee = new EventEmitter();
const noop = () => {};

assert.notStrictEqual(_events, ee._events);

assert(!(ee._events instanceof Object));
assert.notStrictEqual(ee._events, undefined);
assert.deepStrictEqual(Object.keys(ee._events), []);
assert.strictEqual(ee._events.foo, undefined);
assert.doesNotThrow(() => delete ee._events.foo);
assert.strictEqual('foo' in ee._events, false);
assert.strictEqual(Object.getOwnPropertyDescriptor(ee._events, 'foo'),
                   undefined);

assert.doesNotThrow(() => ee._events.foo = noop);

assert.strictEqual(ee._events.foo, noop);
assert.deepStrictEqual(Object.keys(ee._events), ['foo']);
assert.deepStrictEqual(ee.listeners('foo'), [noop]);
assert.strictEqual('foo' in ee._events, true);
assert.deepStrictEqual(Object.getOwnPropertyDescriptor(ee._events, 'foo'),
                       {
                         value: noop,
                         writable: true,
                         configurable: true,
                         enumerable: true
                       });

assert.doesNotThrow(() => delete ee._events.foo);
assert.strictEqual(ee._events.foo, undefined);
assert.deepStrictEqual(Object.keys(ee._events), []);
assert.strictEqual('foo' in ee._events, false);
assert.strictEqual(ee.listenerCount('foo'), 0);
assert.strictEqual(Object.getOwnPropertyDescriptor(ee._events, 'foo'),
                   undefined);
