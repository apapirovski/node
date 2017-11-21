// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

'use strict';

const kEvents = Symbol('eventsList');
const kEventsProxy = Symbol('eventsListProxy');

var domain;
var spliceOne;

function EventEmitter() {
  EventEmitter.init.call(this);
}
module.exports = EventEmitter;

// Backwards-compat with node 0.10.x
EventEmitter.EventEmitter = EventEmitter;

EventEmitter.usingDomains = false;

EventEmitter.prototype.domain = undefined;
EventEmitter.prototype[kEvents] = undefined;
EventEmitter.prototype[kEventsProxy] = undefined;
EventEmitter.prototype._maxListeners = undefined;

// By default EventEmitters will print a warning if more than 10 listeners are
// added to it. This is a useful default which helps finding memory leaks.
var defaultMaxListeners = 10;

var errors;
function lazyErrors() {
  if (errors === undefined)
    errors = require('internal/errors');
  return errors;
}

Object.defineProperty(EventEmitter, 'defaultMaxListeners', {
  enumerable: true,
  get: function() {
    return defaultMaxListeners;
  },
  set: function(arg) {
    // check whether the input is a positive number (whose value is zero or
    // greater and not a NaN).
    if (typeof arg !== 'number' || arg < 0 || arg !== arg) {
      const errors = lazyErrors();
      throw new errors.TypeError('ERR_OUT_OF_RANGE', 'defaultMaxListeners');
    }
    defaultMaxListeners = arg;
  }
});

EventEmitter.init = function() {
  this.domain = null;
  if (EventEmitter.usingDomains) {
    // if there is an active domain, then attach to it.
    domain = domain || require('domain');
    if (domain.active && !(this instanceof domain.Domain)) {
      this.domain = domain.active;
    }
  }

  if (!this._maxListeners)
    this._maxListeners = undefined;
};

// Events proxy for compatibility with older user-land code
const proxyEventsHandler = {
  deleteProperty({ emitter }, prop) {
    const events = emitter[kEvents];
    if (events !== undefined)
      events.delete(prop);
    return true;
  },
  get({ emitter }, prop) {
    const events = emitter[kEvents];
    if (events === undefined)
      return;
    return events.get(prop);
  },
  getOwnPropertyDescriptor({ emitter }, prop) {
    const events = emitter[kEvents];
    if (events === undefined)
      return undefined;
    const value = events.get(prop);
    if (value === undefined)
      return undefined;
    return {
      value,
      writable: true,
      configurable: true,
      enumerable: true
    };
  },
  getPrototypeOf() {
    return null;
  },
  has({ emitter }, prop) {
    const events = emitter[kEvents];
    if (events === undefined)
      return false;
    return events.has(prop);
  },
  ownKeys({ emitter }) {
    const events = emitter[kEvents];
    if (events === undefined || events.size === 0)
      return [];
    return [...events.keys()];
  },
  set({ emitter }, prop, value) {
    let events = emitter[kEvents];
    if (events === undefined)
      events = emitter[kEvents] = new Map();
    events.set(prop, value);
    return true;
  }
};

Object.defineProperty(EventEmitter.prototype, '_events', {
  configurable: true,
  enumerable: true,
  get() {
    const proxy = this[kEventsProxy];
    // The proxy target has to be an empty object with a single configurable
    // key, because of rules around Proxy handler.ownKeys behaviour
    if (proxy === undefined ||
        this[kEventsProxy] === Object.getPrototypeOf(this)[kEventsProxy])
      return this[kEventsProxy] = new Proxy({ emitter: this },
                                            proxyEventsHandler);
    return proxy;
  },
  set(value) {
    if (value === undefined)
      this[kEvents] = undefined;
  }
});

// Obviously not all Emitters should be limited to 10. This function allows
// that to be increased. Set to zero for unlimited.
EventEmitter.prototype.setMaxListeners = function setMaxListeners(n) {
  if (typeof n !== 'number' || n < 0 || isNaN(n)) {
    const errors = lazyErrors();
    throw new errors.TypeError('ERR_OUT_OF_RANGE', 'n');
  }
  this._maxListeners = n;
  return this;
};

function $getMaxListeners(that) {
  if (that._maxListeners === undefined)
    return EventEmitter.defaultMaxListeners;
  return that._maxListeners;
}

EventEmitter.prototype.getMaxListeners = function getMaxListeners() {
  return $getMaxListeners(this);
};

EventEmitter.prototype.emit = function emit(type, ...args) {
  let doError = (type === 'error');

  const events = this[kEvents];
  if (events !== undefined)
    doError = (doError && !events.has('error'));
  else if (!doError)
    return false;

  const domain = this.domain;

  // If there is no 'error' event listener then throw.
  if (doError) {
    let er;
    if (args.length > 0)
      er = args[0];
    if (domain !== null && domain !== undefined) {
      if (!er) {
        const errors = lazyErrors();
        er = new errors.Error('ERR_UNHANDLED_ERROR');
      }
      if (typeof er === 'object' && er !== null) {
        er.domainEmitter = this;
        er.domain = domain;
        er.domainThrown = false;
      }
      domain.emit('error', er);
    } else if (er instanceof Error) {
      throw er; // Unhandled 'error' event
    } else {
      // At least give some kind of context to the user
      const errors = lazyErrors();
      const err = new errors.Error('ERR_UNHANDLED_ERROR', er);
      err.context = er;
      throw err;
    }
    return false;
  }

  const handler = events.get(type);

  if (handler === undefined)
    return false;

  const hasDomain = domain !== null &&
                    domain !== undefined &&
                    this !== process;
  if (hasDomain)
    domain.enter();

  if (typeof handler === 'function') {
    handler.apply(this, args);
  } else {
    handler.emitting = true;
    for (var i = 0; i < handler.length; ++i)
      handler[i].apply(this, args);
    handler.emitting = false;
  }

  if (hasDomain)
    domain.exit();

  return true;
};

function _addListener(target, type, listener, prepend) {
  var events;
  var existing;

  if (typeof listener !== 'function') {
    const errors = lazyErrors();
    throw new errors.TypeError('ERR_INVALID_ARG_TYPE', 'listener', 'Function');
  }

  events = target[kEvents];
  if (events === undefined) {
    events = target[kEvents] = new Map();
  } else {
    // To avoid recursion in the case that type === "newListener"! Before
    // adding it to the listeners, first emit "newListener".
    if (events.has('newListener')) {
      target.emit('newListener', type, listener.listener || listener);

      // Re-assign `events` because a newListener handler could have caused the
      // this[kEvents] to be assigned to a new Map
      events = target[kEvents];
      if (events === undefined)
        events = target[kEvents] = new Map();
    }
    existing = events.get(type);
  }

  if (existing === undefined) {
    // Optimize the case of one listener. Don't need the extra array object.
    events.set(type, listener);
    return target;
  }

  if (typeof existing === 'function') {
    // Adding the second element, need to change to array.
    existing = prepend ? [listener, existing] : [existing, listener];
    events.set(type, existing);
  } else if (existing.emitting) {
    const { warned } = existing;
    existing = arrayCloneWithElement(existing, listener, prepend ? 1 : 0);
    events.set(type, existing);
    if (warned)
      existing.warned = true;
  } else if (prepend) {
    existing.unshift(listener);
  } else {
    existing.push(listener);
  }

  // Check for listener leak
  const m = $getMaxListeners(target);
  if (m > 0 && existing.length > m && !existing.warned) {
    existing.warned = true;
    // No error code for this since it is a Warning
    const w = new Error('Possible EventEmitter memory leak detected. ' +
                        `${existing.length} ${String(type)} listeners ` +
                        'added. Use emitter.setMaxListeners() to ' +
                        'increase limit');
    w.name = 'MaxListenersExceededWarning';
    w.emitter = target;
    w.type = type;
    w.count = existing.length;
    process.emitWarning(w);
  }

  return target;
}

EventEmitter.prototype.addListener = function addListener(type, listener) {
  return _addListener(this, type, listener, false);
};

EventEmitter.prototype.on = EventEmitter.prototype.addListener;

EventEmitter.prototype.prependListener =
    function prependListener(type, listener) {
      return _addListener(this, type, listener, true);
    };

function onceWrapper(...args) {
  if (!this.fired) {
    this.target.removeListener(this.type, this.wrapFn);
    this.fired = true;
    this.listener.apply(this.target, args);
  }
}

function _onceWrap(target, type, listener) {
  var state = { fired: false, wrapFn: undefined, target, type, listener };
  var wrapped = onceWrapper.bind(state);
  wrapped.listener = listener;
  state.wrapFn = wrapped;
  return wrapped;
}

EventEmitter.prototype.once = function once(type, listener) {
  if (typeof listener !== 'function') {
    const errors = lazyErrors();
    throw new errors.TypeError('ERR_INVALID_ARG_TYPE', 'listener', 'Function');
  }
  this.on(type, _onceWrap(this, type, listener));
  return this;
};

EventEmitter.prototype.prependOnceListener =
    function prependOnceListener(type, listener) {
      if (typeof listener !== 'function') {
        const errors = lazyErrors();
        throw new errors.TypeError('ERR_INVALID_ARG_TYPE', 'listener',
                                   'Function');
      }
      this.prependListener(type, _onceWrap(this, type, listener));
      return this;
    };

// Emits a 'removeListener' event if and only if the listener was removed.
EventEmitter.prototype.removeListener =
    function removeListener(type, listener) {
      var list, events, originalListener;

      if (typeof listener !== 'function') {
        const errors = lazyErrors();
        throw new errors.TypeError('ERR_INVALID_ARG_TYPE', 'listener',
                                   'Function');
      }

      events = this[kEvents];
      if (events === undefined)
        return this;

      list = events.get(type);
      if (list === undefined)
        return this;

      if (list === listener || list.listener === listener) {
        events.delete(type);
        if (events.size && events.has('removeListener'))
          this.emit('removeListener', type, list.listener || listener);
        return this;
      }

      if (typeof list !== 'function') {
        let position = -1;

        for (var i = list.length - 1; i >= 0; i--) {
          if (list[i] === listener || list[i].listener === listener) {
            originalListener = list[i].listener;
            position = i;
            break;
          }
        }

        if (position < 0)
          return this;

        if (list.length === 2)
          events.set(type, list[position ? 0 : 1]);
        else if (list.emitting) {
          const { warned } = list;
          list = sliceOne(list, position);
          events.set(type, list);
          if (warned)
            list.warned = true;
        } else if (position === 0)
          list.shift();
        else if (position === list.length - 1)
          list.pop();
        else {
          if (spliceOne === undefined)
            spliceOne = require('internal/util').spliceOne;
          spliceOne(list, position);
        }

        if (events.has('removeListener'))
          this.emit('removeListener', type, originalListener || listener);
      }

      return this;
    };

EventEmitter.prototype.removeAllListeners =
    function removeAllListeners(type) {
      var listeners, events, i;

      events = this[kEvents];
      if (events === undefined)
        return this;

      // not listening for removeListener, no need to emit
      if (!events.has('removeListener')) {
        if (arguments.length === 0)
          this[kEvents] = new Map();
        else
          events.delete(type);
        return this;
      }

      // emit removeListener for all listeners on all events
      if (arguments.length === 0) {
        var keys = events.keys();
        var key;
        for (key of keys) {
          if (key === 'removeListener') continue;
          this.removeAllListeners(key);
        }
        this.removeAllListeners('removeListener');
        this[kEvents] = new Map();
        return this;
      }

      listeners = events.get(type);

      if (typeof listeners === 'function') {
        this.removeListener(type, listeners);
      } else if (listeners !== undefined) {
        // LIFO order
        for (i = listeners.length - 1; i >= 0; i--) {
          this.removeListener(type, listeners[i]);
        }
      }

      return this;
    };

EventEmitter.prototype.listeners = function listeners(type, unwrap = true) {
  const events = this[kEvents];

  if (events === undefined || !events.size)
    return [];

  const evlistener = events.get(type);
  if (evlistener === undefined)
    return [];

  if (typeof evlistener === 'function')
    return [evlistener.listener || evlistener];

  return unwrap ? unwrapListeners(evlistener) : arrayClone(evlistener);
};

EventEmitter.listenerCount = function(emitter, type) {
  if (typeof emitter.listenerCount === 'function') {
    return emitter.listenerCount(type);
  } else {
    return listenerCount.call(emitter, type);
  }
};

EventEmitter.prototype.listenerCount = listenerCount;
function listenerCount(type) {
  const events = this[kEvents];

  if (events !== undefined) {
    const evlistener = events.get(type);

    if (typeof evlistener === 'function') {
      return 1;
    } else if (evlistener !== undefined) {
      return evlistener.length;
    }
  }

  return 0;
}

EventEmitter.prototype.eventNames = function eventNames() {
  const events = this[kEvents];
  return events !== undefined && events.size ? [...events.keys()] : [];
};

function arrayClone(arr) {
  const copy = new Array(arr.length);
  for (var i = 0; i < arr.length; ++i)
    copy[i] = arr[i];
  return copy;
}

function arrayCloneWithElement(arr, element, prepend) {
  const len = arr.length;
  const copy = new Array(len + 1);
  for (var i = 0 + prepend; i < len + prepend; ++i)
    copy[i] = arr[i - prepend];
  copy[prepend ? 0 : len] = element;
  return copy;
}

function sliceOne(arr, index) {
  const len = arr.length - 1;
  const copy = new Array(len);
  for (var i = 0, offset = 0; i < len; ++i) {
    if (i === index)
      offset = 1;
    copy[i] = arr[i + offset];
  }
  return copy;
}

function unwrapListeners(arr) {
  const ret = new Array(arr.length);
  for (var i = 0; i < ret.length; ++i) {
    ret[i] = arr[i].listener || arr[i];
  }
  return ret;
}
