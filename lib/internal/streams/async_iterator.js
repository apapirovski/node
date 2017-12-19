'use strict';

const { promisify } = require('util');

class Item {
  constructor(value, done) {
    this.done = done;
    this.value = value;
  }
}

function readAndResolve(iter) {
  if (iter.lastResolve !== null) {
    const data = iter.stream.read();
    // we defer if data is null
    // we can be expecting either 'end' or
    // 'error'
    if (data !== null) {
      iter.lastResolve(new Item(data, false));
      iter.lastResolve = null;
      iter.lastReject = null;
    }
  }
}

class ReadableAsyncIterator {
  constructor(stream) {
    this.stream = stream;
    this.lastResolve = null;
    this.lastReject = null;
    this.error = null;
    this.ended = false;
    this.lastPromise = null;

    stream.on('readable', () => {
      // we wait for the next tick, because it might
      // emit an error with process.nextTick
      process.nextTick(readAndResolve, this);
    });

    stream.on('end', () => {
      if (this.lastResolve !== null) {
        this.lastResolve(new Item(null, true));
        this.lastReject = null;
        this.lastResolve = null;
      }
      this.ended = true;
    });

    stream.on('error', (err) => {
      // reject if we are waiting for data in the Promise
      // returned by next() and store the error
      if (this.lastReject !== null) {
        this.lastReject(err);
        this.lastReject = null;
        this.lastResolve = null;
      }
      this.error = err;
    });

    // the function passed to new Promise
    // is cached so we avoid allocating a new
    // closure at every run
    this._handlePromise = (resolve, reject, promise) => {
      if (promise === this.lastPromise) {
        this.lastPromise = null;
      } else if (promise === undefined && this.lastPromise !== null) {
        const boundFn =
          this._handlePromise.bind(this, resolve, reject, this.lastPromise);
        this.lastPromise.then(boundFn, boundFn);
        return;
      }
      const data = this.stream.read();
      if (data) {
        resolve(new Item(data, false));
      } else {
        this.lastResolve = resolve;
        this.lastReject = reject;
      }
    };
  }

  next() {
    // if we have detected an error in the meanwhile
    // reject straight away
    if (this.error !== null)
      throw Promise.reject(this.error);

    if (this.ended)
      return Promise.resolve(new Item(null, true));

    return this.lastPromise = new Promise(this._handlePromise);
  }

  async return() {
    // destroy(err, cb) is a private API
    // we can guarantee we have that here, because we control the
    // Readable class this is attached to
    const destroy = promisify(this.stream.destroy.bind(this.stream));
    await destroy(null);
    return new Item(null, true);
  }
}

module.exports = ReadableAsyncIterator;
