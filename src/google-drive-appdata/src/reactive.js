// Deep Proxy that calls `onChange` whenever any nested plain object/array is mutated.

const isTrackable = (v) => {
  if (v === null || typeof v !== 'object') return false;
  if (Array.isArray(v)) return true;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
};

export function createReactive(root, onChange) {
  const proxies = new WeakMap(); // raw -> proxy
  const raws = new WeakMap(); // proxy -> raw

  const unwrap = (v) => (v !== null && typeof v === 'object' && raws.has(v) ? raws.get(v) : v);

  const wrap = (v) => {
    if (!isTrackable(v)) return v;
    let p = proxies.get(v);
    if (!p) {
      p = new Proxy(v, handler);
      proxies.set(v, p);
      raws.set(p, v);
    }
    return p;
  };

  const handler = {
    get(target, key) {
      return wrap(Reflect.get(target, key));
    },
    set(target, key, value) {
      value = unwrap(value);
      const existed = Object.prototype.hasOwnProperty.call(target, key);
      const old = target[key];
      // No receiver: avoids re-entering the defineProperty trap.
      const ok = Reflect.set(target, key, value);
      if (ok && (!existed || !Object.is(old, value))) onChange();
      return ok;
    },
    deleteProperty(target, key) {
      const existed = Object.prototype.hasOwnProperty.call(target, key);
      const ok = Reflect.deleteProperty(target, key);
      if (ok && existed) onChange();
      return ok;
    },
    defineProperty(target, key, descriptor) {
      if ('value' in descriptor) descriptor = { ...descriptor, value: unwrap(descriptor.value) };
      const ok = Reflect.defineProperty(target, key, descriptor);
      if (ok) onChange();
      return ok;
    },
  };

  return wrap(root);
}
