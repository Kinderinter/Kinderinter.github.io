/* =========================================================
   教资备考工作台 · 应用逻辑（纯前端，无构建）
   视图：刷题 / 错题本 / 进度看板 / 整卷模考 / 资料库 / 设置
   ========================================================= */
(function () {
  "use strict";

  /* ---------- 工具 ---------- */
  const $ = (sel, root = document) => root.querySelector(sel);
  const appEl = $("#app");
  const titleEl = $("#view-title");
  const metaEl = $("#topbar-meta");

  // 轻量 hyperscript，动态文本一律走文本节点，天然防 XSS
  function h(tag, attrs, ...children) {
    const e = document.createElement(tag);
    attrs = attrs || {};
    for (const k in attrs) {
      const v = attrs[k];
      if (v == null) continue;
      if (k === "class") e.className = v;
      else if (k === "html") e.innerHTML = v;
      else if (k.startsWith("on") && typeof v === "function") e.addEventListener(k.slice(2), v);
      else if (k === "dataset") Object.assign(e.dataset, v);
      else e.setAttribute(k, v);
    }
    children.flat().forEach((c) => {
      if (c == null || c === false) return;
      e.append(c.nodeType ? c : document.createTextNode(String(c)));
    });
    return e;
  }
  const clear = (n) => { while (n.firstChild) n.removeChild(n.firstChild); };

  let toastTimer;
  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg; t.hidden = false;
    requestAnimationFrame(() => t.classList.add("show"));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.classList.remove("show"); setTimeout(() => (t.hidden = true), 300); }, 2200);
  }

  /* ---------- 全局状态 ---------- */
  let state = { view: "practice", practice: null, mock: null };

  /* ---------- 路由 ---------- */
  function setView(view) {
    state.view = view;
    document.querySelectorAll(".nav-item").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
    const titles = { practice: "刷题", wrong: "错题本", dashboard: "进度看板", mock: "整卷模考", notes: "资料库", settings: "设置" };
    titleEl.textContent = titles[view] || view;
    state.practice = null; state.mock = null;
    render();
  }

  async function render() {
    clear(appEl); metaEl.textContent = "";
    switch (state.view) {
      case "practice": return renderPractice();
      case "wrong": return renderWrong();
      case "dashboard": return renderDashboard();
      case "mock": return renderMock();
      case "notes": return renderNotes();
      case "settings": return renderSettings();
    }
  }

  /* ========================================================
     刷题
     ======================================================== */
  async function renderPractice() {
    const questions = await DB.getAll("questions");
    if (!questions.length) return emptyState("题库为空，请先「导入数据」或从设置恢复示例。");

    const subjects = ["全部", ...Array.from(new Set(questions.map((q) => q.subject)))];
    subjectSel = h("select", {}, ...subjects.map((s) => h("option", { value: s }, s)));
    const discSet = Array.from(new Set(questions.filter((q) => q.discipline).map((q) => q.discipline)));
    discSel = h("select", {}, h("option", { value: "" }, "全部学科"), ...discSet.map((d) => h("option", { value: d }, d)));
    chapSel = h("select", {}, h("option", { value: "" }, "全部章节"));
    typeSel = h("select", {}, h("option", { value: "" }, "全部题型"),
      ...Array.from(new Set(questions.map((q) => q.type))).map((t) => h("option", { value: t }, t)));
    skipChk = h("input", { type: "checkbox" });
    skipChk.checked = true;

    function refreshChapters() {
      const sub = subjectSel.value;
      const chaps = Array.from(new Set(questions
        .filter((q) => sub === "全部" || q.subject === sub)
        .map((q) => q.chapter)));
      clear(chapSel);
      chapSel.append(h("option", { value: "" }, "全部章节"));
      chaps.forEach((c) => chapSel.append(h("option", { value: c }, c)));
    }
    subjectSel.addEventListener("change", refreshChapters);

    const startBtn = h("button", { class: "btn", onclick: startSession }, "开始刷题");

    const filters = h("div", { class: "filters" },
      subjectSel, discSel, chapSel, typeSel,
      h("label", { class: "row", style: "gap:6px;font-size:13px;color:var(--ink-soft)" }, skipChk, "跳过已掌握")
    );
    const wrap = h("div", {}, filters, h("div", { class: "row" }, startBtn, h("span", { class: "muted", id: "prac-meta" })));
    appEl.append(wrap);
    refreshChapters();
  }

  let subjectSel, discSel, chapSel, typeSel, skipChk;

  function buildQueue(questions) {
    const sub = subjectSel.value, disc = discSel.value, chap = chapSel.value, type = typeSel.value;
    let q = questions.filter((x) =>
      (sub === "全部" || x.subject === sub) &&
      (!disc || x.discipline === disc) &&
      (!chap || x.chapter === chap) &&
      (!type || x.type === type)
    );
    if (skipChk.checked) {
      // 依赖进度：已掌握(via progress.mastered) 跳过
      return q; // 实际跳过在渲染时结合 progress 判断
    }
    return q;
  }

  async function startSession() {
    const all = await DB.getAll("questions");
    let queue = buildQueue(all);
    const pmap = await DB.getProgressMap();
    if (skipChk.checked) queue = queue.filter((q) => !(pmap[q.id] && pmap[q.id].mastered));
    if (!queue.length) { toast("没有符合条件的题目"); return; }
    // 打乱顺序
    queue = queue.slice().sort(() => Math.random() - 0.5);
    state.practice = { queue, idx: 0, pmap };
    metaEl.textContent = `共 ${queue.length} 题`;
    showPracticeQuestion();
  }

  async function showPracticeQuestion() {
    const ps = state.practice;
    clear(appEl);
    if (ps.idx >= ps.queue.length) return finishPractice();
    const q = ps.queue[ps.idx];
    ps.pmap = ps.pmap || await DB.getProgressMap();
    const prog = ps.pmap[q.id];

    const meta = h("div", { class: "q-meta" },
      h("span", { class: "tag accent" }, q.subject),
      q.discipline ? h("span", { class: "tag teal" }, q.discipline) : null,
      h("span", { class: "tag" }, q.chapter),
      h("span", { class: "tag" }, q.type),
      q.aiFlag === "suspect" ? h("span", { class: "tag warn" }, "AI 存疑") : null,
      q.aiFlag === "ok" ? h("span", { class: "tag" }, "AI 已核") : null,
      prog ? h("span", { class: "muted", style: "font-size:12px" }, `已答${prog.total} 对${prog.correct}`) : null
    );

    const stem = h("p", { class: "q-stem" }, q.stem);
    const body = h("div", { class: "card q-card" }, meta, stem);

    const isChoice = Array.isArray(q.options) && q.options.length;
    const isMulti = q.type && q.type.indexOf("多选") >= 0;

    if (isChoice) {
      const optsBox = h("div", { class: "options" });
      const selected = new Set();
      q.options.forEach((opt) => {
        const letter = (opt.match(/^[A-Za-z]/) || [""])[0].toUpperCase();
        const row = h("div", { class: "option", dataset: { letter } },
          h("span", { class: "mark" }, letter),
          h("span", {}, opt.replace(/^[A-Za-z][.\s、]/, ""))
        );
        row.addEventListener("click", () => {
          if (isMulti) {
            if (selected.has(letter)) { selected.delete(letter); row.classList.remove("sel"); }
            else { selected.add(letter); row.classList.add("sel"); }
          } else {
            optsBox.querySelectorAll(".option").forEach((o) => o.classList.remove("sel"));
            selected.clear(); selected.add(letter); row.classList.add("sel");
          }
        });
        optsBox.append(row);
      });
      body.append(optsBox);
      const submit = h("button", { class: "btn", style: "margin-top:16px" }, "提交");
      submit.addEventListener("click", () => {
        if (!selected.size) { toast("请先选择答案"); return; }
        const userAns = Array.from(selected).sort().join("");
        const correct = userAns === String(q.answer).toUpperCase().replace(/[^A-Z]/g, "").split("").sort().join("");
        revealChoice(optsBox, q, correct, userAns);
        submit.remove();
        gradeAndShow(q, correct === userAns, body);
      });
      body.append(submit);
    } else {
      const ta = h("textarea", { placeholder: "在此作答……（提交后展示参考答案与解析）" });
      const submit = h("button", { class: "btn", style: "margin-top:14px" }, "提交");
      submit.addEventListener("click", () => {
        if (!ta.value.trim()) { toast("请先作答"); return; }
        submit.remove(); ta.disabled = true;
        showSubjectiveFeedback(body, q, ta.value);
      });
      body.append(h("div", { class: "answer-area" }, ta), submit);
    }

    appEl.append(
      h("div", { class: "row", style: "margin-bottom:12px" },
        h("span", { class: "muted" }, `第 ${ps.idx + 1} / ${ps.queue.length} 题`),
        h("span", { class: "spacer" }),
        h("button", { class: "btn ghost", onclick: () => { ps.idx++; showPracticeQuestion(); } }, "跳过此题")
      ),
      body
    );
  }

  function revealChoice(box, q, correctLetters, userAns) {
    const correctSet = correctLetters.split("");
    box.querySelectorAll(".option").forEach((o) => {
      const L = o.dataset.letter;
      if (correctSet.includes(L)) o.classList.add("correct");
      if (o.classList.contains("sel") && !correctSet.includes(L)) o.classList.add("wrong");
    });
  }

  function gradeAndShow(q, correct, body) {
    DB.recordAttempt(q.id, correct);
    const fb = h("div", { class: "feedback" },
      h("div", { class: "verdict " + (correct ? "ok" : "bad") }, correct ? "✓ 回答正确" : "✗ 回答错误"),
      h("span", { class: "label" }, "参考答案"), h("div", { class: "analysis" }, q.answer),
      q.analysis ? h("span", { class: "label" }, "解析") : null,
      q.analysis ? h("div", { class: "analysis" }, q.analysis) : null,
      nextBtn()
    );
    body.append(fb);
  }

  function showSubjectiveFeedback(body, q, userText) {
    const fb = h("div", { class: "feedback" },
      h("span", { class: "label" }, "参考答案"), h("div", { class: "analysis" }, q.answer),
      q.analysis ? h("span", { class: "label" }, "解析") : null,
      q.analysis ? h("div", { class: "analysis" }, q.analysis) : null,
      h("span", { class: "label" }, "自评（用于统计正确率）"),
      h("div", { class: "self-rate" },
        h("button", { class: "btn", onclick: () => { DB.recordAttempt(q.id, true); afterSelf(); } }, "答对了"),
        h("button", { class: "btn secondary", onclick: () => { DB.recordAttempt(q.id, false); afterSelf(); } }, "部分对"),
        h("button", { class: "btn ghost", onclick: () => { DB.recordAttempt(q.id, false); afterSelf(); } }, "答错了")
      )
    );
    function afterSelf() { fb.querySelector(".self-rate").replaceWith(nextBtn()); }
    body.append(fb);
  }

  function nextBtn() {
    const ps = state.practice;
    return h("button", { class: "btn", style: "margin-top:16px", onclick: () => { ps.idx++; showPracticeQuestion(); } },
      ps.idx + 1 >= ps.queue.length ? "完成" : "下一题");
  }

  function finishPractice() {
    clear(appEl);
    appEl.append(h("div", { class: "card", style: "text-align:center;padding:40px" },
      h("h2", {}, "本轮刷题完成 🎉"),
      h("p", { class: "muted" }, `共练习 ${state.practice.queue.length} 题。去「进度看板」看看你的薄弱点吧。`),
      h("div", { class: "row", style: "justify-content:center;margin-top:16px" },
        h("button", { class: "btn", onclick: startSession }, "再来一轮"),
        h("button", { class: "btn ghost", onclick: () => setView("dashboard") }, "看进度")
      )
    ));
  }

  /* ========================================================
     错题本
     ======================================================== */
  async function renderWrong() {
    const [questions, pmap] = await Promise.all([DB.getAll("questions"), DB.getProgressMap()]);
    const wrong = questions.filter((q) => pmap[q.id] && pmap[q.id].wrong > 0 && !pmap[q.id].mastered);
    if (!wrong.length) return emptyState("暂无错题。答错的题目会自动出现在这里。");

    const list = h("div", { class: "list" });
    wrong.forEach((q) => {
      const p = pmap[q.id];
      const item = h("div", { class: "item" },
        h("div", { class: "item-head" },
          h("span", { class: "item-title" }, q.subject + (q.discipline ? "·" + q.discipline : "")),
          h("span", { class: "tag" }, q.chapter),
          h("span", { class: "tag accent" }, q.type),
          h("span", { class: "muted", style: "font-size:12px" }, `错 ${p.wrong} / 答 ${p.total}`)
        ),
        h("div", { class: "item-body" }, q.stem),
        h("div", { class: "item-actions" },
          h("button", { class: "btn ghost", onclick: () => practiceThese([q]) }, "重练此题"),
          h("button", { class: "btn ghost", onclick: async () => { p.mastered = true; await DB.put("progress", p); toast("已标记为掌握"); renderWrong(); } }, "标记掌握")
        )
      );
      list.append(item);
    });
    appEl.append(h("p", { class: "muted", style: "margin-bottom:12px" }, `共 ${wrong.length} 道错题`), list);
  }

  async function practiceThese(list) {
    state.practice = { queue: list.slice(), idx: 0, pmap: await DB.getProgressMap() };
    metaEl.textContent = `重练 ${list.length} 题`;
    setView("practice"); // 确保视图切换
    state.view = "practice";
    titleEl.textContent = "错题重练";
    await showPracticeQuestion();
  }

  /* ========================================================
     进度看板
     ======================================================== */
  async function renderDashboard() {
    const [questions, pmap] = await Promise.all([DB.getAll("questions"), DB.getProgressMap()]);
    const answered = Object.values(pmap).filter((p) => p.total > 0);
    const totalAttempts = answered.reduce((s, p) => s + p.total, 0);
    const totalCorrect = answered.reduce((s, p) => s + p.correct, 0);
    const acc = totalAttempts ? Math.round((totalCorrect / totalAttempts) * 100) : 0;

    const statGrid = h("div", { class: "stat-grid" },
      stat(questions.length, "题库总量"),
      stat(answered.length, "已练习题数"),
      stat(totalAttempts, "总作答次数"),
      stat(acc + "%", "平均正确率")
    );

    // 按科目
    const bySubject = groupAcc(questions, pmap, (q) => q.subject);
    // 按章节
    const byChapter = groupAcc(questions, pmap, (q) => q.chapter).sort((a, b) => a.rate - b.rate);

    appEl.append(
      statGrid,
      h("h3", { style: "margin:18px 0 12px" }, "按科目正确率"),
      bars(bySubject),
      h("h3", { style: "margin:24px 0 12px" }, "薄弱章节（红=正确率偏低）"),
      bars(byChapter, true)
    );
  }

  function stat(num, lbl) { return h("div", { class: "stat" }, h("div", { class: "num" }, String(num)), h("div", { class: "lbl" }, lbl)); }

  function groupAcc(questions, pmap, keyFn) {
    const map = {};
    questions.forEach((q) => {
      const k = keyFn(q);
      map[k] = map[k] || { total: 0, correct: 0, answered: 0 };
      const p = pmap[q.id];
      if (p && p.total > 0) { map[k].total += p.total; map[k].correct += p.correct; map[k].answered += 1; }
    });
    return Object.entries(map).map(([name, v]) => ({
      name, answered: v.answered, rate: v.total ? Math.round((v.correct / v.total) * 100) : 0
    }));
  }

  function bars(arr, weak) {
    const box = h("div", {});
    if (!arr.length) return h("p", { class: "muted" }, "暂无数据，先去刷题吧。");
    arr.forEach((r) => {
      box.append(h("div", { class: "bar-row" },
        h("div", { style: "font-size:13px;color:var(--ink-soft);overflow:hidden;text-overflow:ellipsis;white-space:nowrap" }, r.name),
        h("div", { class: "bar-track" }, h("div", { class: "bar-fill" + (weak && r.rate < 60 && r.answered ? " weak" : ""), style: `width:${r.rate}%` })),
        h("div", { class: "bar-val" }, r.answered ? r.rate + "%" : "—")
      ));
    });
    return box;
  }

  /* ========================================================
     整卷模考
     ======================================================== */
  async function renderMock() {
    const questions = await DB.getAll("questions");
    if (!questions.length) return emptyState("题库为空，无法组卷。");

    const subjects = Array.from(new Set(questions.map((q) => q.subject)));
    const subSel = h("select", {}, ...subjects.map((s) => h("option", { value: s }, s)));
    const numInput = h("input", { type: "number", value: "10", min: "1", max: String(questions.length), style: "width:90px" });
    const timeInput = h("input", { type: "number", value: "30", min: "1", style: "width:90px" });

    const startBtn = h("button", { class: "btn", onclick: () => {
      const n = Math.max(1, parseInt(numInput.value) || 10);
      const mins = Math.max(1, parseInt(timeInput.value) || 30);
      let pool = questions.filter((q) => q.subject === subSel.value);
      if (pool.length < n) { toast(`该科目题目不足 ${n} 道，已用全部 ${pool.length} 道`); }
      const pick = pool.sort(() => Math.random() - 0.5).slice(0, Math.min(n, pool.length));
      startMock(pick, mins);
    } }, "开始模考");

    appEl.append(h("div", { class: "card" },
      h("h3", { style: "margin-top:0" }, "组卷设置"),
      h("div", { class: "filters" },
        h("label", { class: "row", style: "gap:6px" }, "科目 ", subSel),
        h("label", { class: "row", style: "gap:6px" }, "题量 ", numInput),
        h("label", { class: "row", style: "gap:6px" }, "限时(分钟) ", timeInput)
      ),
      h("p", { class: "hint" }, "模考会按设置从题库随机抽取题目并计时；客观题自动判分，主观题交卷后自评。"),
      startBtn
    ));
  }

  let mockTimer;
  async function startMock(pick, mins) {
    state.mock = { queue: pick, idx: 0, mins, deadline: Date.now() + mins * 60000, results: [], pmap: await DB.getProgressMap() };
    clear(appEl);
    const timerEl = h("span", { class: "muted", id: "mock-timer" });
    metaEl.append(timerEl);
    tickTimer(timerEl);
    mockTimer = setInterval(() => tickTimer(timerEl), 1000);
    appEl.append(h("div", { class: "card", style: "margin-bottom:14px" },
      h("div", { class: "row" },
        h("strong", {}, `模考进行中 · ${pick.length} 题`),
        h("span", { class: "spacer" }),
        h("button", { class: "btn secondary", onclick: finishMock }, "交卷")
      )
    ));
    showMockQuestion();
  }

  function tickTimer(el) {
    const left = Math.max(0, state.mock.deadline - Date.now());
    const m = Math.floor(left / 60000), s = Math.floor((left % 60000) / 1000);
    el.textContent = `剩余 ${m}:${String(s).padStart(2, "0")}`;
    if (left <= 0) { clearInterval(mockTimer); finishMock(); }
  }

  async function showMockQuestion() {
    const mk = state.mock;
    if (mk.idx >= mk.queue.length) return finishMock();
    const q = mk.queue[mk.idx];
    const card = h("div", { class: "mock-q" },
      h("div", { class: "q-meta" }, h("span", { class: "tag accent" }, q.subject), h("span", { class: "tag" }, q.type), h("span", { class: "tag" }, q.chapter)),
      h("p", { class: "q-stem" }, q.stem)
    );
    const isChoice = Array.isArray(q.options) && q.options.length;
    const isMulti = q.type && q.type.indexOf("多选") >= 0;

    if (isChoice) {
      const box = h("div", { class: "options" }); const sel = new Set();
      q.options.forEach((opt) => {
        const letter = (opt.match(/^[A-Za-z]/) || [""])[0].toUpperCase();
        const row = h("div", { class: "option", dataset: { letter } }, h("span", { class: "mark" }, letter), h("span", {}, opt.replace(/^[A-Za-z][.\s、]/, "")));
        row.addEventListener("click", () => {
          if (isMulti) { if (sel.has(letter)) { sel.delete(letter); row.classList.remove("sel"); } else { sel.add(letter); row.classList.add("sel"); } }
          else { box.querySelectorAll(".option").forEach((o) => o.classList.remove("sel")); sel.clear(); sel.add(letter); row.classList.add("sel"); }
        });
        box.append(row);
      });
      card.append(box, h("button", { class: "btn", style: "margin-top:14px" }, "确认"), );
      const btn = card.querySelector("button");
      btn.addEventListener("click", () => {
        if (!sel.size) { toast("请选择"); return; }
        const userAns = Array.from(sel).sort().join("");
        const correct = String(q.answer).toUpperCase().replace(/[^A-Z]/g, "").split("").sort().join("");
        revealChoice(box, q, correct, userAns);
        btn.remove();
        const ok = userAns === correct;
        mk.results.push({ q, correct: ok, auto: true });
        DB.recordAttempt(q.id, ok);
        card.append(h("div", { class: "feedback" }, h("div", { class: "verdict " + (ok ? "ok" : "bad") }, ok ? "✓" : "✗"),
          h("span", { class: "label" }, "参考答案"), h("div", { class: "analysis" }, q.answer),
          mockNext()));
      });
    } else {
      const ta = h("textarea", { placeholder: "在此作答……" });
      card.append(h("div", { class: "answer-area" }, ta), h("button", { class: "btn", style: "margin-top:12px" }, "确认"));
      const btn = card.querySelector("button");
      btn.addEventListener("click", () => {
        if (!ta.value.trim()) { toast("请作答"); return; }
        btn.remove(); ta.disabled = true;
        card.append(h("div", { class: "feedback" },
          h("span", { class: "label" }, "参考答案"), h("div", { class: "analysis" }, q.answer),
          h("span", { class: "label" }, "自评"),
          h("div", { class: "self-rate" },
            h("button", { class: "btn", onclick: () => commitMock(q, true) }, "答对"),
            h("button", { class: "btn secondary", onclick: () => commitMock(q, false) }, "答错")
          )
        ));
      });
    }
    appEl.append(h("div", { class: "card" }, h("div", { class: "row", style: "margin-bottom:10px" }, h("span", { class: "muted" }, `第 ${mk.idx + 1} / ${mk.queue.length} 题`)), card));
  }
  function mockNext() { return h("button", { class: "btn", style: "margin-top:14px", onclick: () => { state.mock.idx++; showMockQuestion(); } }, state.mock.idx + 1 >= state.mock.queue.length ? "交卷" : "下一题"); }
  function commitMock(q, ok) { state.mock.results.push({ q, correct: ok, auto: false }); DB.recordAttempt(q.id, ok); state.mock.idx++; showMockQuestion(); }

  function finishMock() {
    clearInterval(mockTimer);
    const mk = state.mock; if (!mk) return;
    const auto = mk.results.filter((r) => r.auto);
    const subj = mk.results.filter((r) => !r.auto);
    const autoCorrect = auto.filter((r) => r.correct).length;
    const subjCorrect = subj.filter((r) => r.correct).length;
    clear(appEl); metaEl.textContent = "";
    appEl.append(h("div", { class: "card", style: "text-align:center;padding:36px" },
      h("h2", {}, "模考结束"),
      h("div", { class: "mock-summary", style: "max-width:420px;margin:18px auto" },
        stat(mk.results.length, "总题数"),
        stat(autoCorrect + "/" + auto.length, "客观题正确"),
        stat(subjCorrect + "/" + subj.length, "主观题自评正确")
      ),
      h("p", { class: "muted" }, "客观题已自动判分；主观题按你的自评计入。完整掌握情况已写入进度看板。"),
      h("div", { class: "row", style: "justify-content:center;margin-top:16px" },
        h("button", { class: "btn", onclick: () => setView("dashboard") }, "看进度"),
        h("button", { class: "btn ghost", onclick: () => setView("mock") }, "再考一次")
      )
    ));
  }

  /* ========================================================
     资料库 / 笔记
     ======================================================== */
  async function renderNotes() {
    const notes = await DB.getAll("notes");
    notes.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    const questions = await DB.getAll("questions");
    const subjSet = Array.from(new Set(questions.map((q) => q.subject)));

    const search = h("input", { type: "text", placeholder: "搜索标题或内容…", style: "flex:1;min-width:160px" });
    const subjFilter = h("select", {}, h("option", { value: "" }, "全部科目"), ...subjSet.map((s) => h("option", { value: s }, s)));

    // 新增表单
    const fTitle = h("input", { type: "text", placeholder: "标题，如：科目二 德育原则口诀" });
    const fKind = h("select", {}, h("option", { value: "笔记" }, "笔记"), h("option", { value: "资料" }, "资料"));
    const fSubj = h("select", {}, h("option", { value: "" }, "不绑定科目"), ...subjSet.map((s) => h("option", { value: s }, s)));
    const fBody = h("textarea", { placeholder: "内容（支持纯文本，按需记录知识点、口诀、易错点…）" });
    const addBtn = h("button", { class: "btn", onclick: async () => {
      if (!fTitle.value.trim()) { toast("请填写标题"); return; }
      const note = { id: "n_" + Date.now(), title: fTitle.value.trim(), kind: fKind.value, subject: fSubj.value, body: fBody.value, updatedAt: Date.now() };
      await DB.put("notes", note); toast("已保存"); fTitle.value = ""; fBody.value = ""; renderNotes();
    } }, "添加");

    const form = h("div", { class: "card note-form" },
      h("div", { class: "field" }, h("label", {}, "标题"), fTitle),
      h("div", { class: "row" }, h("div", { class: "field", style: "flex:1" }, h("label", {}, "类型"), fKind), h("div", { class: "field", style: "flex:1" }, h("label", {}, "科目"), fSubj)),
      h("div", { class: "field" }, h("label", {}, "内容"), fBody),
      h("div", {}, addBtn)
    );

    const listBox = h("div", { class: "list", id: "notes-list" });
    function drawList() {
      const kw = search.value.trim().toLowerCase();
      const sf = subjFilter.value;
      clear(listBox);
      const filtered = notes.filter((n) =>
        (!sf || n.subject === sf) &&
        (!kw || (n.title + n.body).toLowerCase().indexOf(kw) >= 0)
      );
      if (!filtered.length) { listBox.append(h("div", { class: "empty" }, "没有匹配的笔记/资料。")); return; }
      filtered.forEach((n) => {
        listBox.append(h("div", { class: "item" },
          h("div", { class: "item-head" },
            h("span", { class: "item-title" }, n.title),
            h("span", { class: "tag teal" }, n.kind),
            n.subject ? h("span", { class: "tag" }, n.subject) : null
          ),
          h("div", { class: "item-body" }, n.body || "（无内容）"),
          h("div", { class: "item-actions" },
            h("button", { class: "btn ghost", onclick: async () => { if (confirm("确定删除？")) { await DB.del("notes", n.id); renderNotes(); } } }, "删除")
          )
        ));
      });
    }
    search.addEventListener("input", drawList);
    subjFilter.addEventListener("change", drawList);

    appEl.append(
      h("div", { class: "filters" }, search, subjFilter),
      form,
      h("h3", { style: "margin:18px 0 12px" }, `资料与笔记（${notes.length}）`),
      listBox
    );
    drawList();
  }

  /* ========================================================
     设置（AI 校验 + 数据）
     ======================================================== */
  async function renderSettings() {
    const s = await DB.getSettings();
    const endpoint = h("input", { type: "text", value: s.aiEndpoint || "https://api.deepseek.com/v1/chat/completions" });
    const apiKey = h("input", { type: "password", placeholder: "仅保存在本机浏览器", value: s.aiKey || "" });
    const model = h("input", { type: "text", value: s.aiModel || "deepseek-chat" });

    async function save() {
      await Promise.all([
        DB.setSetting("aiEndpoint", endpoint.value.trim()),
        DB.setSetting("aiKey", apiKey.value.trim()),
        DB.setSetting("aiModel", model.value.trim())
      ]);
      toast("AI 设置已保存（仅存本机）");
    }

    const verifyBtn = h("button", { class: "btn", onclick: runVerify }, "校验全部可疑题目");

    appEl.append(
      h("div", { class: "card" },
        h("h3", { style: "margin-top:0" }, "AI 后台校验"),
        h("p", { class: "hint", style: "margin-top:0" }, "爬取的答案由大模型核对，可疑的标“AI 存疑”。密钥仅存本机，调用走你自己的账户额度。"),
        settingRow("接口地址", endpoint),
        settingRow("API 密钥", apiKey),
        settingRow("模型名", model),
        h("div", { class: "row" }, h("button", { class: "btn", onclick: save }, "保存设置"), verifyBtn)
      ),
      h("div", { class: "card", style: "margin-top:16px" },
        h("h3", { style: "margin-top:0" }, "数据与版权"),
        h("p", { class: "hint" }, "本工具为个人及小组内部非商业学习用途。题库来自爬取的公开真题，请勿外传或商用。导出/导入用于小组内共享文件。"),
        h("div", { class: "row" },
          h("button", { class: "btn ghost", onclick: async () => { if (confirm("恢复示例题库？（会追加示例题，已存在的不会重复）")) { await DB.seedIfEmpty(); toast("已确保示例题库存在"); } } }, "恢复示例题库")
        )
      )
    );
  }

  function settingRow(label, input) { return h("div", { class: "setting-row" }, h("label", {}, label), input); }

  async function runVerify() {
    const s = await DB.getSettings();
    if (!s.aiEndpoint || !s.aiKey) { toast("请先填写接口地址与密钥并保存"); return; }
    const questions = (await DB.getAll("questions")).filter((q) => q.aiFlag !== "ok");
    if (!questions.length) { toast("没有待校验的题目"); return; }
    if (!confirm(`将对 ${questions.length} 道题逐一调用 AI 校验，可能产生 API 费用。继续？`)) return;
    let done = 0;
    for (const q of questions) {
      try {
        const r = await aiVerify(q, s);
        q.aiFlag = r.verdict;
        await DB.put("questions", q);
      } catch (e) {
        toast("校验中断：" + e.message); break;
      }
      done++;
      metaEl.textContent = `校验中 ${done}/${questions.length}`;
    }
    metaEl.textContent = "";
    toast(`校验完成 ${done} 题`);
    renderSettings();
  }

  async function aiVerify(q, s) {
    const prompt = `你是教师资格证考试题库校验助手。请判断这道题的参考答案是否正确、是否存在明显事实错误。
题目类型：${q.type}
题干：${q.stem}
${q.options ? "选项：\n" + q.options.join("\n") : ""}
参考答案：${q.answer}
解析：${q.analysis || "（无）"}
请只输出 JSON：{"verdict":"ok"|"suspect","reason":"简短中文说明"}`;
    const resp = await fetch(s.aiEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + s.aiKey },
      body: JSON.stringify({ model: s.aiModel || "deepseek-chat", temperature: 0, messages: [{ role: "user", content: prompt }] })
    });
    if (!resp.ok) throw new Error("HTTP " + resp.status);
    const data = await resp.json();
    const text = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || "";
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return { verdict: "suspect", reason: "无法解析返回" };
    try {
      const j = JSON.parse(m[0]);
      return { verdict: j.verdict === "ok" ? "ok" : "suspect", reason: j.reason || "" };
    } catch (e) { return { verdict: "suspect", reason: "JSON 解析失败" }; }
  }

  /* ========================================================
     导入 / 导出
     ======================================================== */
  function initIO() {
    $("#btn-export").addEventListener("click", async () => {
      const json = await DB.exportAll();
      const blob = new Blob([json], { type: "application/json" });
      const a = h("a", { href: URL.createObjectURL(blob), download: "教资备考数据_" + new Date().toISOString().slice(0, 10) + ".json" });
      a.click(); URL.revokeObjectURL(a.href);
      toast("已导出数据文件");
    });
    const fileInput = $("#file-input");
    $("#btn-import").addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", async () => {
      const f = fileInput.files[0]; if (!f) return;
      try {
        const obj = JSON.parse(await f.text());
        const mode = confirm("点「确定」= 替换全部数据；点「取消」= 合并导入") ? "replace" : "merge";
        const n = await DB.importAll(obj, mode);
        toast(`已导入 ${n} 道题`);
        setView(state.view);
      } catch (e) { toast("导入失败：" + e.message); }
      fileInput.value = "";
    });
  }

  /* ---------- 空状态 ---------- */
  function emptyState(msg) { appEl.append(h("div", { class: "empty" }, msg)); }

  /* ---------- 启动 ---------- */
  async function init() {
    await DB.open();
    await DB.seedIfEmpty();
    document.querySelectorAll(".nav-item").forEach((b) => b.addEventListener("click", () => setView(b.dataset.view)));
    initIO();
    setView("practice");
  }
  init();
})();
