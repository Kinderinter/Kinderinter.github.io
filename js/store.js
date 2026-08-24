/* 纯前端存储层：IndexedDB 封装。零后端、零依赖。
   存储对象：
   - questions：题库（keyPath id）
   - progress：每题作答统计（keyPath qid）
   - notes：资料/笔记（keyPath id）
   - settings：键值配置（keyPath key） */
(function () {
  const DB_NAME = "jiaozi_prep";
  const VERSION = 1;
  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains("questions"))
          db.createObjectStore("questions", { keyPath: "id" });
        if (!db.objectStoreNames.contains("progress"))
          db.createObjectStore("progress", { keyPath: "qid" });
        if (!db.objectStoreNames.contains("notes"))
          db.createObjectStore("notes", { keyPath: "id" });
        if (!db.objectStoreNames.contains("settings"))
          db.createObjectStore("settings", { keyPath: "key" });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  function tx(store, mode) {
    return open().then((db) => db.transaction(store, mode).objectStore(store));
  }

  function reqToPromise(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function getAll(store) {
    const os = await tx(store, "readonly");
    return reqToPromise(os.getAll());
  }
  async function get(store, key) {
    const os = await tx(store, "readonly");
    return reqToPromise(os.get(key));
  }
  async function put(store, val) {
    const os = await tx(store, "readwrite");
    await reqToPromise(os.put(val));
    return val;
  }
  async function bulkPut(store, arr) {
    const os = await tx(store, "readwrite");
    arr.forEach((v) => os.put(v));
    return reqToPromise(os.transaction.objectStore(store).count()).then(() => arr.length);
  }
  async function del(store, key) {
    const os = await tx(store, "readwrite");
    return reqToPromise(os.delete(key));
  }
  async function clear(store) {
    const os = await tx(store, "readwrite");
    return reqToPromise(os.clear());
  }

  /* ---------- 业务方法 ---------- */

  async function seedIfEmpty() {
    const qs = await getAll("questions");
    if (qs.length === 0 && window.SEED_QUESTIONS) {
      await bulkPut("questions", window.SEED_QUESTIONS.map((q) => ({ ...q })));
    }
  }

  // 进度更新：根据本次作答结果（correct: true/false）更新统计
  async function recordAttempt(qid, correct) {
    let p = (await get("progress", qid)) || {
      qid, total: 0, correct: 0, wrong: 0, streak: 0, mastered: false, lastAt: 0, lastResult: null
    };
    p.total += 1;
    if (correct) {
      p.correct += 1; p.streak += 1;
    } else {
      p.wrong += 1; p.streak = 0; p.mastered = false;
    }
    // 连续答对 3 次视为掌握
    if (p.total >= 3 && p.streak >= 3) p.mastered = true;
    p.lastAt = Date.now();
    p.lastResult = correct;
    await put("progress", p);
    return p;
  }

  async function getProgressMap() {
    const arr = await getAll("progress");
    const m = {};
    arr.forEach((p) => (m[p.qid] = p));
    return m;
  }

  async function getSettings() {
    const s = await getAll("settings");
    const out = {};
    s.forEach((x) => (out[x.key] = x.value));
    return out;
  }
  async function setSetting(key, value) {
    return put("settings", { key, value });
  }

  // 导出全部数据为 JSON 字符串
  async function exportAll() {
    const [questions, progress, notes, settings] = await Promise.all([
      getAll("questions"), getAll("progress"), getAll("notes"), getAll("settings")
    ]);
    return JSON.stringify(
      { app: "jiaozi-prep", version: 1, exportedAt: new Date().toISOString(), questions, progress, notes, settings },
      null, 2
    );
  }

  // 导入：mode = 'replace' | 'merge'
  async function importAll(obj, mode) {
    if (!obj || !Array.isArray(obj.questions)) throw new Error("文件格式不正确：缺少 questions 数组");
    if (mode === "replace") {
      await Promise.all([clear("questions"), clear("progress"), clear("notes")]);
    }
    if (Array.isArray(obj.questions)) await bulkPut("questions", obj.questions);
    if (Array.isArray(obj.progress)) await bulkPut("progress", obj.progress);
    if (Array.isArray(obj.notes)) await bulkPut("notes", obj.notes);
    if (Array.isArray(obj.settings)) await bulkPut("settings", obj.settings);
    return obj.questions.length;
  }

  window.DB = {
    open, getAll, get, put, bulkPut, del, clear,
    seedIfEmpty, recordAttempt, getProgressMap,
    getSettings, setSetting, exportAll, importAll, DB_NAME
  };
})();
