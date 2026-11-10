/* ride-store.js — IndexedDB for Road Check: rides, their scored segments, and raw readings in 10 s chunks.
 * Segments and chunks are written as they are produced, so a dead battery or a closed tab loses at most
 * the last 10 seconds. If IndexedDB is unavailable (some private windows) everything stays in memory and
 * `mem` is true: the app then says "export before closing".
 * Somdeep Kundu, RuDRA Lab, C-TARA, IIT Bombay · MIT License */
(function (root) {
  'use strict';
  function open(name = 'road-check') {
    const DB = { mem: false, db: null };
    const M = { rides: {}, segs: [], chunks: [], seq: 1 };
    DB.ready = new Promise(resolve => {
      let rq;
      try { rq = indexedDB.open(name, 1); } catch (e) { DB.mem = true; resolve(DB); return; }
      rq.onupgradeneeded = () => {
        const d = rq.result;
        d.createObjectStore('rides', { keyPath: 'id' });
        d.createObjectStore('segs', { keyPath: 'k' }).createIndex('ride', 'ride');
        d.createObjectStore('chunks', { keyPath: 'id', autoIncrement: true }).createIndex('ride', 'ride');
      };
      rq.onsuccess = () => { DB.db = rq.result; resolve(DB); };
      rq.onerror = rq.onblocked = () => { DB.mem = true; resolve(DB); };
    });
    const tx = (store, mode, fn) => new Promise((res, rej) => {
      const t = DB.db.transaction(store, mode), r = fn(t.objectStore(store));
      t.oncomplete = () => res(r && r.result); t.onerror = t.onabort = () => rej(t.error || new Error('storage error'));
    });
    const segKey = (ride, n) => ride + '#' + String(n).padStart(6, '0');

    DB.putRide = r => DB.mem ? (M.rides[r.id] = Object.assign({}, r), Promise.resolve()) : tx('rides', 'readwrite', s => s.put(r));
    DB.getRide = id => DB.mem ? Promise.resolve(M.rides[id] || null) : tx('rides', 'readonly', s => s.get(id)).then(r => r || null);
    DB.listRides = async () => {
      const all = DB.mem ? Object.values(M.rides) : ((await tx('rides', 'readonly', s => s.getAll())) || []);
      return all.sort((a, b) => b.started - a.started);
    };
    DB.putSeg = (ride, seg) => {
      const rec = Object.assign({ k: segKey(ride, seg.seg), ride }, seg);
      if (DB.mem) { M.segs.push(rec); return Promise.resolve(); }
      return tx('segs', 'readwrite', s => s.put(rec));
    };
    DB.segsFor = async ride => {
      const all = DB.mem ? M.segs.filter(s => s.ride === ride) : ((await tx('segs', 'readonly', s => s.index('ride').getAll(ride))) || []);
      return all.sort((a, b) => a.seg - b.seg);
    };
    /* Returns the new chunk's id. `data` is an ArrayBuffer of Float32 (layout: RoadCore.RAW_COLS). */
    DB.putChunk = c => {
      if (DB.mem) { const id = M.seq++; M.chunks.push(Object.assign({ id }, c)); return Promise.resolve(id); }
      return tx('chunks', 'readwrite', s => s.add(c));
    };
    DB.chunksFor = async ride => {
      const all = DB.mem ? M.chunks.filter(c => c.ride === ride) : ((await tx('chunks', 'readonly', s => s.index('ride').getAll(ride))) || []);
      return all.sort((a, b) => a.t0 - b.t0);
    };
    DB.dropChunks = ids => {
      if (!ids.length) return Promise.resolve();
      if (DB.mem) { M.chunks = M.chunks.filter(c => !ids.includes(c.id)); return Promise.resolve(); }
      return tx('chunks', 'readwrite', s => { ids.forEach(id => s.delete(id)); });
    };
    DB.deleteRide = async id => {
      if (DB.mem) { delete M.rides[id]; M.segs = M.segs.filter(s => s.ride !== id); M.chunks = M.chunks.filter(c => c.ride !== id); return; }
      const drop = store => new Promise((res, rej) => {
        const t = DB.db.transaction(store, 'readwrite'), rq = t.objectStore(store).index('ride').openKeyCursor(IDBKeyRange.only(id));
        rq.onsuccess = () => { const c = rq.result; if (c) { t.objectStore(store).delete(c.primaryKey); c.continue(); } };
        t.oncomplete = res; t.onerror = () => rej(t.error);
      });
      await drop('segs'); await drop('chunks'); await tx('rides', 'readwrite', s => s.delete(id));
    };
    return DB;
  }
  root.RideStore = { open };
})(typeof self !== 'undefined' ? self : this);
