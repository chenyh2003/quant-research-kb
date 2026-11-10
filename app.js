/* 研报知识库可视化选读 */
(function () {
  const D = window.KB_DATA;
  if (!D) {
    document.body.innerHTML = '<div style="padding:40px;font-family:sans-serif">data.js 未加载：请先运行 build_site_data.py 生成数据。</div>';
    return;
  }
  const PUBLIC = location.protocol === "http:" || location.protocol === "https:";
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
  const fmt = (n) => (n == null ? "" : String(n));

  const state = {
    q: "", topics: new Set(), directions: new Set(), firm: "", year: "",
    minScore: 0, quick: "all", sort: "score_desc", page: 1, pageSize: 24,
  };

  const QUICK = [
    ["all", "全部"],
    ["deep", "精读已覆盖"],
    ["a", "A级复现"],
    ["method", "方法论必读"],
    ["suspect", "高绩效存疑"],
    ["cost", "有成本"],
    ["oos", "有样本外"],
    ["nocap", "容量未讨论"],
    ["top", "质量分≥8"],
  ];

  const BM_KEY = "kb_bookmarks_v1";

  function getBm() {
    try { return new Set(JSON.parse(localStorage.getItem(BM_KEY) || "[]")); } catch (e) { return new Set(); }
  }
  function setBm(s) { localStorage.setItem(BM_KEY, JSON.stringify(Array.from(s))); updateBmCount(); }

  function origLink(p) {
    if (PUBLIC) return "";
    const base = "";
    return base + encodeURI((p.rel || "").replace(/\\/g, "/"));
  }
  function cardLink(p) { return PUBLIC ? "" : "../" + (p.card_path || "").replace(/\\/g, "/"); }
  function deepLink(note) { return (PUBLIC ? "" : "../") + (note.path || "").replace(/\\/g, "/"); }
  function problemLink(p) { return (PUBLIC ? "" : "../") + (p.path || "").replace(/\\/g, "/"); }

  function tagsHtml(p, opts) {
    opts = opts || {};
    const maxT = opts.maxTopics == null ? 3 : opts.maxTopics;
    const maxD = opts.maxDirections == null ? 6 : opts.maxDirections;
    const out = [];
    (p.topics || []).slice(0, maxT).forEach((t) => out.push(`<span class="tag topic">${esc(t)}</span>`));
    (p.direction || []).slice(0, maxD).forEach((t) => out.push(`<span class="tag direction">${esc(t)}</span>`));
    (p.data || []).forEach((t) => out.push(`<span class="tag data">${esc(t)}</span>`));
    const keep = ["有成本", "有样本外", "容量未讨论", "重复副本"];
    (p.value || []).filter((v) => keep.includes(v)).forEach((t) => out.push(`<span class="tag value">${esc(t)}</span>`));
    return out.join("");
  }

  function badgesHtml(p) {
    const out = [];
    if ((p.value || []).includes("精读")) out.push('<span class="badge deep">精读</span>');
    if ((p.value || []).includes("A级复现")) out.push('<span class="badge a">A级复现</span>');
    if ((p.value || []).includes("方法论必读")) out.push('<span class="badge method">方法论</span>');
    if ((p.value || []).includes("高绩效存疑")) out.push('<span class="badge suspect">高绩效存疑</span>');
    if ((p.value || []).includes("重复副本")) out.push('<span class="badge dup">副本</span>');
    return out.join("");
  }

  function scoreClass(s) { return s >= 8 ? "high" : s >= 6 ? "mid" : "low"; }
  function cardClass(s) { return s >= 8 ? "s-high" : s >= 6 ? "s-mid" : "s-low"; }

  function renderTopStats() {
    const s = D.stats;
    $("#topStats").innerHTML = [
      ["研报", s.papers], ["主题", s.topics], ["问题", s.problems], ["深读", s.deep_notes],
      ["A级复现", s.a_count], ["高绩效存疑", s.suspect_count],
    ].map(([k, v]) => `<span class="ts"><b>${v}</b>${esc(k)}</span>`).join("");
  }

  function renderQuick() {
    $("#quickViews").innerHTML = QUICK.map(([k, label]) =>
      `<button class="quick-btn ${state.quick === k ? "active" : ""}" data-quick="${k}">${esc(label)}</button>`).join("");
    $$("#quickViews .quick-btn").forEach((b) => b.addEventListener("click", () => {
      state.quick = b.dataset.quick; state.page = 1; renderQuick(); renderReports();
    }));
  }

  function renderTopics() {
    const counts = new Map(D.stats.topic_counts);
    const all = D.stats.topic_counts;
    $("#topicFilters").innerHTML = all.map(([name, n]) =>
      `<label class="check-item"><input type="checkbox" value="${esc(name)}" ${state.topics.has(name) ? "checked" : ""}><span>${esc(name)}</span><span class="n">${n}</span></label>`).join("");
    $$("#topicFilters input").forEach((cb) => cb.addEventListener("change", () => {
      if (cb.checked) state.topics.add(cb.value); else state.topics.delete(cb.value);
      state.page = 1; renderReports();
    }));
  }

  function directionCounts() {
    const c = new Map();
    D.papers.forEach((p) => (p.direction || []).forEach((t) => c.set(t, (c.get(t) || 0) + 1)));
    return Array.from(c.entries()).sort((a, b) => b[1] - a[1]).slice(0, 48);
  }

  function renderDirections() {
    $("#directionFilters").innerHTML = directionCounts().map(([t, n]) =>
      `<button class="tagbtn ${state.directions.has(t) ? "active" : ""}" data-dir="${esc(t)}">${esc(t)} <span class="muted">${n}</span></button>`).join("");
    $$("#directionFilters .tagbtn").forEach((b) => b.addEventListener("click", () => {
      const t = b.dataset.dir;
      if (state.directions.has(t)) state.directions.delete(t); else state.directions.add(t);
      state.page = 1; renderDirections(); renderReports();
    }));
  }

  function initSelects() {
    const firms = D.stats.firm_counts;
    $("#firmSelect").innerHTML = '<option value="">全部机构</option>' + firms.map(([f, n]) => `<option value="${esc(f)}">${esc(f)} (${n})</option>`).join("");
    const years = D.stats.year_counts.slice().sort((a, b) => String(b[0]).localeCompare(String(a[0])));
    $("#yearSelect").innerHTML = '<option value="">全部年份</option>' + years.map(([y, n]) => `<option value="${esc(y)}">${esc(y)} (${n})</option>`).join("");
    $("#firmSelect").addEventListener("change", (e) => { state.firm = e.target.value; state.page = 1; renderReports(); });
    $("#yearSelect").addEventListener("change", (e) => { state.year = e.target.value; state.page = 1; renderReports(); });
    $("#sortSelect").addEventListener("change", (e) => { state.sort = e.target.value; state.page = 1; renderReports(); });
    $("#pageSize").addEventListener("change", (e) => { state.pageSize = e.target.value === "all" ? "all" : Number(e.target.value); state.page = 1; renderReports(); });
    $("#scoreRange").addEventListener("input", (e) => {
      state.minScore = Number(e.target.value); $("#scoreVal").textContent = state.minScore; state.page = 1; renderReports();
    });
  }

  function matches(p) {
    if (state.q) {
      const q = state.q.toLowerCase();
      if (!p.search.includes(q)) return false;
    }
    if (state.topics.size && !(p.topics || []).some((t) => state.topics.has(t))) return false;
    if (state.directions.size && !(p.direction || []).some((t) => state.directions.has(t))) return false;
    if (state.firm && p.firm !== state.firm) return false;
    if (state.year && p.year !== state.year) return false;
    if (p.score < state.minScore) return false;
    switch (state.quick) {
      case "deep": return (p.value || []).includes("精读");
      case "a": return (p.value || []).includes("A级复现");
      case "method": return (p.value || []).includes("方法论必读");
      case "suspect": return (p.value || []).includes("高绩效存疑");
      case "cost": return (p.value || []).includes("有成本");
      case "oos": return (p.value || []).includes("有样本外");
      case "nocap": return (p.value || []).includes("容量未讨论");
      case "top": return p.score >= 8;
      default: return true;
    }
  }

  function sortedFiltered() {
    const arr = D.papers.filter(matches);
    const cmp = {
      score_desc: (a, b) => b.score - a.score || a.id.localeCompare(b.id),
      score_asc: (a, b) => a.score - b.score || a.id.localeCompare(b.id),
      date_desc: (a, b) => (b.date || "").localeCompare(a.date || "") || a.id.localeCompare(b.id),
      date_asc: (a, b) => (a.date || "9999").localeCompare(b.date || "9999") || a.id.localeCompare(b.id),
      firm_asc: (a, b) => a.firm.localeCompare(b.firm) || a.id.localeCompare(b.id),
      title_asc: (a, b) => a.title.localeCompare(b.title),
    };
    return arr.sort(cmp[state.sort] || cmp.score_desc);
  }

  function paperCard(p, bm) {
    const flagged = (p.flags || []).filter((f) => ["无成本假设", "无样本外", "无稳健性检验", "疑似全样本寻优"].includes(f)).slice(0, 2).join(" · ");
    return `<article class="card ${cardClass(p.score)}">
      <div class="card-top">
        <div class="score ${scoreClass(p.score)}" title="质量分（证据披露完整度）">${p.score.toFixed(1)}</div>
        <div style="flex:1;min-width:0">
          <h3 class="card-title"><a href="#" data-paper="${p.id}">${esc(p.title)}</a></h3>
          <div class="card-meta">${esc(p.firm)} · ${esc(p.date || "日期未标")} · ${esc(p.series || "无系列")} · ${p.pages || "?"} 页</div>
          <div class="card-badges" style="margin-top:5px">${badgesHtml(p)}</div>
        </div>
      </div>
      <div class="tags">${tagsHtml(p)}</div>
      <div class="summary">${esc(p.summary || "无摘要")}</div>
      <div class="card-foot">
        <span>${esc(p.sample_period || "样本期未标")}${p.pool ? " · " + esc(p.pool) : ""}</span>
        ${flagged ? `<span class="flagline">${esc(flagged)}</span>` : ""}
        <div class="card-actions">
          <button class="mini" data-paper="${p.id}">详情</button>
          ${origLink(p) ? `<a class="mini" href="${origLink(p)}" target="_blank" rel="noopener">原文</a>` : ""}
          <button class="mini star ${bm.has(p.id) ? "on" : ""}" data-bm="${p.id}" title="收藏">${bm.has(p.id) ? "★" : "☆"}</button>
        </div>
      </div>
    </article>`;
  }

  function renderReports() {
    const arr = sortedFiltered();
    const bm = getBm();
    const total = arr.length;
    const size = state.pageSize === "all" ? Math.max(total, 1) : state.pageSize;
    const pages = Math.max(1, Math.ceil(total / size));
    if (state.page > pages) state.page = pages;
    const start = (state.page - 1) * size;
    const items = arr.slice(start, start + size);
    $("#resultCount").textContent = `共 ${total} 篇${state.quick !== "all" ? "（" + (QUICK.find((q) => q[0] === state.quick) || ["", ""])[1] + "）" : ""}`;
    $("#cards").innerHTML = items.length ? items.map((p) => paperCard(p, bm)).join("") : '<div style="padding:30px;color:#6b7280">没有匹配的研报，试试重置筛选。</div>';
    $$("#cards [data-paper]").forEach((el) => el.addEventListener("click", (e) => {
      e.preventDefault(); openPaper(el.dataset.paper);
    }));
    $$("#cards [data-bm]").forEach((el) => el.addEventListener("click", (e) => {
      e.stopPropagation(); toggleBookmark(el.dataset.bm);
    }));
    renderPagination(total, size, pages);
    renderActiveChips();
  }

  function renderPagination(total, size, pages) {
    if (state.pageSize === "all" || pages <= 1) { $("#pagination").innerHTML = ""; return; }
    const cur = state.page;
    const nums = [];
    const add = (n) => { if (n >= 1 && n <= pages && !nums.includes(n)) nums.push(n); };
    add(1); add(2);
    for (let i = cur - 2; i <= cur + 2; i++) add(i);
    add(pages - 1); add(pages);
    nums.sort((a, b) => a - b);
    let html = `<button class="page-btn" data-page="${cur - 1}" ${cur <= 1 ? "disabled" : ""}>上一页</button>`;
    let prev = 0;
    nums.forEach((n) => {
      if (prev && n - prev > 1) html += '<span class="page-btn" style="border:none;background:transparent">…</span>';
      html += `<button class="page-btn ${n === cur ? "active" : ""}" data-page="${n}">${n}</button>`;
      prev = n;
    });
    html += `<button class="page-btn" data-page="${cur + 1}" ${cur >= pages ? "disabled" : ""}>下一页</button>`;
    $("#pagination").innerHTML = html;
    $$("#pagination [data-page]").forEach((b) => b.addEventListener("click", () => {
      const n = Number(b.dataset.page); if (n >= 1 && n <= pages) { state.page = n; renderReports(); window.scrollTo({ top: 0, behavior: "smooth" }); }
    }));
  }

  function renderActiveChips() {
    const chips = [];
    if (state.q) chips.push(["搜索: " + state.q, "q"]);
    if (state.quick !== "all") chips.push([(QUICK.find((q) => q[0] === state.quick) || ["", ""])[1], "quick"]);
    state.topics.forEach((t) => chips.push([t, "topic:" + t]));
    state.directions.forEach((t) => chips.push([t, "dir:" + t]));
    if (state.firm) chips.push([state.firm, "firm"]);
    if (state.year) chips.push([state.year, "year"]);
    if (state.minScore > 0) chips.push(["质量分≥" + state.minScore, "score"]);
    $("#activeChips").innerHTML = chips.map(([label, key]) => `<span class="chip">${esc(label)}<button data-chip="${esc(key)}">×</button></span>`).join("");
    $$("#activeChips [data-chip]").forEach((b) => b.addEventListener("click", () => {
      const k = b.dataset.chip;
      if (k === "q") { state.q = ""; $("#searchInput").value = ""; }
      else if (k === "quick") state.quick = "all";
      else if (k === "firm") { state.firm = ""; $("#firmSelect").value = ""; }
      else if (k === "year") { state.year = ""; $("#yearSelect").value = ""; }
      else if (k === "score") { state.minScore = 0; $("#scoreRange").value = 0; $("#scoreVal").textContent = "0"; }
      else if (k.startsWith("topic:")) state.topics.delete(k.slice(6));
      else if (k.startsWith("dir:")) state.directions.delete(k.slice(4));
      state.page = 1; renderQuick(); renderTopics(); renderDirections(); renderReports();
    }));
  }

  function toggleBookmark(id) {
    const bm = getBm();
    if (bm.has(id)) bm.delete(id); else bm.add(id);
    setBm(bm);
    renderReports();
    renderBm();
  }

  function updateBmCount() { const n = getBm().size; $("#bmCount").textContent = n; }

  function paperById(id) { return D.papers.find((p) => p.id === id); }

  function openPaper(id) {
    const p = paperById(id);
    if (!p) return;
    const bm = getBm();
    const tags = tagsHtml(p, { maxTopics: 99, maxDirections: 99 });
    const metrics = (p.metrics || []).map((x) => `<li>${esc(x)}</li>`).join("") || "<li>未提取到结构化指标</li>";
    const deep = (p.deep || []).map((n) => `<div style="margin:5px 0"><a href="#" data-deep-path="${esc(n.path)}"><b>${esc(n.title)}</b></a> ${n.rating ? '<span class="rating">' + esc(n.rating) + "</span>" : ""}</div>`).join("") || "<p>暂无专门精读；可读卡片与原文。</p>";
    const flags = (p.flags || []).map((f) => `<span class="tag value">${esc(f)}</span>`).join("") || '<span class="tag plain">无显著红旗</span>';
    $("#modalContent").innerHTML = `
      <h1>${esc(p.title)}</h1>
      <div class="meta">${esc(p.firm)} · ${esc(p.date || "日期未标")} · ${esc(p.series || "无系列")} · ${p.pages || "?"} 页 · <b>质量分 ${p.score.toFixed(1)}</b></div>
      <div class="tags" style="margin-bottom:8px">${tags}</div>
      <div class="card-badges">${badgesHtml(p)}</div>
      <h2>一句话/摘要</h2>
      <div class="quote">${esc(p.summary || "无摘要")}</div>
      <h2>原文结论段</h2>
      <div class="quote">${esc(p.conclusion || "未定位到独立结论段，见摘要。")}</div>
      <h2>指标摘录（自动提取）</h2>
      <ul>${metrics}</ul>
      <h2>风险与局限</h2>
      <p>${esc(p.risk || "原文风险提示未提取到；使用时注意样本期、股票池、成本假设。")}</p>
      <h2>关键词</h2>
      <p>${esc((p.keywords || []).join("、") || "无")}</p>
      <h2>质量证据（自动抽取）</h2>
      <div class="kv">
        <div class="k">样本期</div><div>${esc(p.sample_period || "未标")}</div>
        <div class="k">股票池</div><div>${esc(p.pool || "未标")}</div>
        <div class="k">频率</div><div>${esc(p.freq || "未标")}</div>
        <div class="k">调仓</div><div>${esc(p.rebalance || "未标")}</div>
        <div class="k">数据源</div><div>${esc(p.datasource || "未标")}</div>
      </div>
      <h2>证据缺口 / 红旗</h2>
      <div class="tags">${flags}</div>
      <h2>深读笔记</h2>
      ${deep}
      <h2>引用与文件</h2>
      <p>引用：<code>[${p.id}] ${esc(p.firm)}《${esc(p.title)}》</code></p>
      <div class="links">
        ${origLink(p) ? `<a class="btn small" href="${origLink(p)}" target="_blank" rel="noopener">打开原文 PDF</a>` : ""}
        ${cardLink(p) ? `<a class="btn small" href="${cardLink(p)}" target="_blank" rel="noopener">打开研报卡片</a>` : ""}
        <button class="btn small" id="btnCopyCite">复制引用</button>
        <button class="btn small ${bm.has(p.id) ? "active" : ""}" id="btnModalBm">${bm.has(p.id) ? "★ 已收藏" : "☆ 收藏"}</button>
      </div>
      ${PUBLIC ? '<p class="muted" style="font-size:11.5px;margin-top:8px">公开版不提供原始 PDF/研报卡片；摘要与笔记仅供研究参考，原文版权归原机构所有。</p>' : ""}`;
    $("#modal").hidden = false;
    $("#btnCopyCite").onclick = () => copyText(`[${p.id}] ${p.firm}《${p.title}》`);
    $("#btnModalBm").onclick = () => { toggleBookmark(p.id); openPaper(p.id); };
    $$("#modalContent [data-deep-path]").forEach((a) => a.addEventListener("click", (e) => {
      e.preventDefault(); openDeepByPath(a.dataset.deepPath);
    }));
  }

  function openProblem(id) {
    const p = D.problems.find((x) => x.id === id);
    if (!p) return;
    const sols = (p.solutions || []).map((s) => `<span class="sol">方案 ${esc(s.letter)}：${esc(s.name)}</span>`).join(" ") || "见正文";
    $("#modalContent").innerHTML = `
      <h1>${esc(p.title)}</h1>
      <div class="meta">${esc(p.path)}</div>
      <h2>候选方案</h2>
      <div class="sol-list">${sols}</div>
      <h2>完整内容</h2>
      <pre class="md-pre">${esc(p.content)}</pre>
      <div class="links"><a class="btn small" href="${problemLink(p)}" target="_blank" rel="noopener">打开 Markdown</a></div>`;
    $("#modal").hidden = false;
  }

  function openDeepByPath(path) {
    const n = D.deep_notes.find((x) => x.path === path);
    if (!n) return;
    $("#modalContent").innerHTML = `
      <h1>${esc(n.title)}</h1>
      <div class="meta">${esc(n.path)} ${n.rating ? '· <span class="rating">' + esc(n.rating) + "</span>" : ""}</div>
      <pre class="md-pre">${esc(n.content)}</pre>
      <div class="links"><a class="btn small" href="${deepLink(n)}" target="_blank" rel="noopener">打开 Markdown</a></div>`;
    $("#modal").hidden = false;
  }

  const REPRO_NAMES = {
    ret20: "20日反转 Ret20", turn20: "20日换手 Turn20", str20: "量稳换手 STR20",
    vol20: "20日波动 Vol20", cpv_close_vol: "日频CPV(收盘价,量)", cpv_ret_vol: "日频CPV(收益,量)",
    amp20: "20日振幅 Amp20", amp60: "60日振幅 Amp60",
    cpv_20: "CPV(分钟价量)", utd_20: "UTD换手分布均匀度", hf_skew_20: "高频偏度",
    downside_20: "下行波动占比", RPV_B: "RPV(日内-隔夜)",
  };

  const L2_NAMES = { ret: "反转", turn: "换手", str: "量稳换手", vol: "波动", amp: "振幅", cpv: "日频CPV" };

  function renderL2() {
    const s = D.l2 || { summary: [], pbo: [], tscv: [], amp: {} };
    const get = (fam, win, neu) => s.summary.find((x) => x.family === fam && x.window === win && x.neutral === neu);
    const getPbo = (fam, neu) => (s.pbo.find((x) => x.family === fam && x.neutral === neu) || {}).pbo;
    const families = ["ret", "turn", "str", "vol", "cpv", "amp"];
    const rows = families.map((fam) => {
      const raw = get(fam, 20, "raw"), ind = get(fam, 20, "ind_size");
      if (!raw || !ind) return "";
      const p1 = getPbo(fam, "raw"), p2 = getPbo(fam, "ind_size");
      return `<tr>
        <td><b>${esc(L2_NAMES[fam])}</b></td>
        <td>${raw.ic.toFixed(3)}</td><td class="${raw.ls >= 0 ? "pos" : "neg"}">${(raw.ls * 100).toFixed(1)}% / ${raw.ir.toFixed(2)}</td>
        <td>${ind.ic.toFixed(3)}</td><td class="${ind.ls >= 0 ? "pos" : "neg"}">${(ind.ls * 100).toFixed(1)}% / ${ind.ir.toFixed(2)}</td>
        <td class="${(p1 || 0) > 0.5 ? "neg" : ""}">${p1 == null ? "—" : p1.toFixed(2)} / ${p2 == null ? "—" : p2.toFixed(2)}</td>
      </tr>`;
    }).join("");
    const grid = families.map((fam) => {
      const cells = [10, 20, 40, 60].map((w) => {
        const x = get(fam, w, "ind_size");
        return x ? `<td class="${x.ls >= 0 ? "pos" : "neg"}">${(x.ls * 100).toFixed(1)}% / ${x.ir.toFixed(2)}</td>` : "<td>—</td>";
      }).join("");
      return `<tr><td><b>${esc(L2_NAMES[fam])}</b></td>${cells}</tr>`;
    }).join("");
    const tscv = s.tscv.filter((x) => x.neutral === "ind_size").map((x) => `<tr>
      <td>${esc(L2_NAMES[x.family])}</td>
      <td>${(x.tscv_ann * 100).toFixed(1)}% / ${x.tscv_ir.toFixed(2)}</td>
      <td>${(x.fixed20_ann * 100).toFixed(1)}% / ${x.fixed20_ir.toFixed(2)}</td>
      <td>${x.best_window} 日</td>
    </tr>`).join("");
    const amp = s.amp || {};
    const ampNote = amp.amp20 ? `Amp20 低-低-低子样本：+${(amp.amp20.ann * 100).toFixed(1)}% 年化、IR ${amp.amp20.ir.toFixed(2)}；Amp60：+${(amp.amp60 ? (amp.amp60.ann * 100).toFixed(1) : "—")}% 年化、IR ${amp.amp60 ? amp.amp60.ir.toFixed(2) : "—"}。无条件仍为负。` : "";
    return `
      <div class="section-head" style="margin-top:22px">
        <h2 style="font-size:16px">L2 行业中性 + 参数网格 + PBO</h2>
        <p>L2 修正了 L1 股票池偏差（加入当前中证1000成分，全 A 并集 5194 只）；以下为验证结果，不是策略。</p>
      </div>
      <div class="repro-note">
        <b>关键结论</b>：反转与日频 CPV 较稳；换手/量稳换手的 raw alpha 主要是市值/行业暴露，中性后更强；20 日是稳健平台不是尖峰；振幅无条件仍为负。
      </div>
      <table class="repro-table">
        <thead><tr><th>因子</th><th>raw IC</th><th>raw 多空 / IR</th><th>行业+市值 IC</th><th>行业+市值 多空 / IR</th><th>PBO raw / 中性</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="l2-grid">
        <div class="stat-card"><h3>参数网格（行业+市值中性，多空 / IR）</h3>
          <table class="repro-table"><thead><tr><th>因子</th><th>10日</th><th>20日</th><th>40日</th><th>60日</th></tr></thead><tbody>${grid}</tbody></table>
        </div>
        <div class="stat-card"><h3>时序 CV（中性）：动态选窗 vs 固定20</h3>
          <table class="repro-table"><thead><tr><th>因子</th><th>动态选窗</th><th>固定20</th><th>全样本最优</th></tr></thead><tbody>${tscv}</tbody></table>
          <p class="muted" style="font-size:11.5px;margin:8px 0 0">动态选窗没有稳定超过固定20；说明继续调窗口的边际价值低。</p>
        </div>
      </div>
      <div class="repro-note" style="margin-top:12px"><b>振幅专项</b>：${esc(ampNote)}</div>`;
  }

  const L3_STATUS = {
    cpv_20: "未复现（≈0）",
    utd_20: "方向一致，弱",
    hf_skew_20: "方向一致，多空弱",
    downside_20: "方向一致，弱",
    RPV_A: "未复现",
    RPV_B: "未复现",
  };

  function renderL3Full() {
    const full = D.l3_full || { summary: [], quantile: [] };
    const status = {
      cpv_20: "IC 对，多空失败",
      utd_20: "方向+多空中等",
      hf_skew_20: "IC 对，多空失败",
      downside_20: "IC 对，多空失败",
      RPV_A: "方向弱",
      RPV_B: "IC 对，多空弱",
    };
    const rows = full.summary.map((x) => `<tr>
      <td><b>${esc(x.name)}</b></td>
      <td>${x.months}</td>
      <td>${x.avg_stocks}</td>
      <td>${x.ic.toFixed(3)}</td>
      <td>${x.icir.toFixed(2)}</td>
      <td class="${x.ls >= 0 ? "pos" : "neg"}">${(x.ls * 100).toFixed(1)}%</td>
      <td>${x.ir.toFixed(2)}</td>
      <td><span class="status ${(status[x.factor] || "").includes("失败") ? "bad" : "warn"}">${esc(status[x.factor] || "—")}</span></td>
    </tr>`).join("");
    const qmap = {};
    (full.quantile || []).forEach((x) => { qmap[x.factor] = x.q; });
    const qrows = full.summary.map((x) => {
      const q = qmap[x.factor] || [];
      return `<tr><td><b>${esc(x.name)}</b></td>${[0,1,2,3,4].map((i) => `<td class="${(q[i] || 0) >= 0 ? "pos" : "neg"}">${q[i] == null ? "—" : (q[i] * 100).toFixed(2) + "%"}</td>`).join("")}</tr>`;
    }).join("");
    const rb = D.l3_robust || { summary: [], bootstrap: [], size: [] };
    const rget = (f, mode) => rb.summary.find((x) => x.factor === f && x.mode === mode);
    const pget = (f, mode) => (rb.bootstrap.find((x) => x.factor === f && x.mode === mode) || {}).p;
    const sget = (f) => rb.size.find((x) => x.factor === f) || {};
    const robustRows = ["utd_20", "hf_skew_20", "downside_20", "cpv_20", "RPV_B"].map((f) => {
      const raw = rget(f, "raw"), sz = rget(f, "size"), ind = rget(f, "ind_size"), s = sget(f);
      if (!raw || !ind) return "";
      const fmt = (x) => x ? `${(x.ls * 100).toFixed(1)}% / ${x.ir.toFixed(2)}` : "—";
      return `<tr><td><b>${esc(REPRO_NAMES[f] || f)}</b></td><td>${fmt(raw)}</td><td>${fmt(sz)}</td><td>${fmt(ind)}</td>
        <td>${pget(f, "ind_size") == null ? "—" : pget(f, "ind_size").toFixed(3)}</td>
        <td>${s.small_ls == null ? "—" : (s.small_ls * 100).toFixed(1) + "% / " + s.small_ir.toFixed(2)}</td>
        <td>${s.big_ls == null ? "—" : (s.big_ls * 100).toFixed(1) + "% / " + s.big_ir.toFixed(2)}</td></tr>`;
    }).join("");
    return `
      <div class="section-head" style="margin-top:22px">
        <h2 style="font-size:16px">L3 全 A：分钟 CPV / UTD / 偏度 / 下行波动 / RPV（2025）</h2>
        <p>全 A 分钟→日频派生因子（仓库只读聚合），月度截面约 3,051 只；12 个月；未做行业/市值中性，未扣成本。</p>
      </div>
      <div class="repro-note">
        <b>关键结论</b>：五个因子的 <b>IC 方向全部与研报一致</b>；但只有 UTD 的多空勉强像样（+10.9%/IR 1.38）。
        CPV/RPV 的 IC 对但多空失败；偏度/下行波动分位非单调。<b>IC 对 ≠ 多空对</b>。
      </div>
      <table class="repro-table">
        <thead><tr><th>因子</th><th>月数</th><th>月均股票</th><th>IC</th><th>年化ICIR</th><th>多空年化</th><th>多空IR</th><th>初步结论</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="stat-card" style="margin-top:12px"><h3>分位平均月收益（Q1 低 → Q5 高）</h3>
        <table class="repro-table"><thead><tr><th>因子</th><th>Q1</th><th>Q2</th><th>Q3</th><th>Q4</th><th>Q5</th></tr></thead><tbody>${qrows}</tbody></table>
        <p class="muted" style="font-size:11.5px;margin:8px 0 0">CPV/偏度/下行波动呈“中间高/两端低”，线性多空抓不到；UTD 的 Q1>Q5 最接近研报。分钟数据仅覆盖 2024-09~2025-12，无法覆盖研报 2014-2022 样本期。</p>
      </div>
      <div class="stat-card" style="margin-top:12px"><h3>L3 稳健性：raw / 市值 / 行业+市值（多空 / IR）</h3>
        <table class="repro-table"><thead><tr><th>因子</th><th>raw</th><th>市值</th><th>行业+市值</th><th>p(boot)</th><th>小盘</th><th>大盘</th></tr></thead><tbody>${robustRows}</tbody></table>
        <p class="muted" style="font-size:11.5px;margin:8px 0 0"><b>UTD 是唯一通过“中性+成本+bootstrap+大小盘”四关的因子</b>；偏度/下行仅小盘有效且高度共线；CPV 不稳健；RPV 多空弱。详见 L3 稳健性报告。</p>
      </div>
      ${renderUtdDeep()}`;
  }

  function renderUtdDeep() {
    const ud = D.utd_deep || { summary: [], bootstrap: [], size: [] };
    if (!ud.summary.length) return "";
    const get = (f, mode) => ud.summary.find((x) => x.factor === f && x.mode === mode);
    const bp = (f, mode) => (ud.bootstrap.find((x) => x.factor === f && x.mode === mode) || {}).p_boot;
    const sz = (f) => ud.size.find((x) => x.factor === f) || {};
    const fmt = (x) => x ? `${(x.ls_ann * 100).toFixed(1)}% / ${x.ls_ir.toFixed(2)}` : "—";
    const rows = [10, 20, 40, 60].map((w) => {
      const f = `utd_${w}`, ind = get(f, "ind_size"), res = get(f, "resid"), s = sz(f);
      if (!ind) return "";
      const n = { ls_ann: ind.net10_ann, ls_ir: ind.net10_ir };
      const p = bp(f, "resid");
      const note = w === 10 ? "独立强，增量边缘" : (w === 20 ? "独立强，增量无" : "独立中，增量无");
      return `<tr><td><b>${w} 日</b></td><td>${fmt(ind)}</td><td>${fmt(n)}</td><td>${fmt(res)}</td>
        <td>${p == null ? "—" : p.toFixed(3)}</td>
        <td>${s.small_ls == null ? "—" : `${(s.small_ls * 100).toFixed(1)}% / ${s.small_ir.toFixed(2)}`}</td>
        <td>${s.big_ls == null ? "—" : `${(s.big_ls * 100).toFixed(1)}% / ${s.big_ir.toFixed(2)}`}</td>
        <td><span class="status ${w === 10 ? "warn" : "bad"}">${note}</span></td></tr>`;
    }).join("");
    return `<div class="stat-card" style="margin-top:12px"><h3>UTD 深度：窗口 / 成本 / 对日频因子的增量（2025）</h3>
      <table class="repro-table"><thead><tr><th>窗口</th><th>行业+市值 多空/IR</th><th>扣0.1% 后</th><th>对日频残差 多空/IR</th><th>残差 p</th><th>小盘</th><th>大盘</th><th>判断</th></tr></thead><tbody>${rows}</tbody></table>
      <p class="muted" style="font-size:11.5px;margin:8px 0 0"><b>残差</b>控制 turn20/str20/vol20/ret20 + 市值 + 行业。UTD 独立看很稳，但残差 IC 10 日仅 -0.017（p=0.084），20/40/60 日 p&gt;0.5；效果集中在小盘，Q5 为负。<b>结论：稳健的小盘换手/波动风格，不是强增量 alpha。</b></p>
      <div class="links" style="margin-top:8px"><a class="btn small" href="${PUBLIC ? "" : "../"}09_复现/05_报告/复现报告_UTD深度验证.md" target="_blank" rel="noopener">UTD 深度报告</a></div>
    </div>`;
  }

  function renderL3() {
    if (D.l3_full && D.l3_full.summary && D.l3_full.summary.length) return renderL3Full();
    const s = D.l3 || { summary: [], variants: [] };
    if (!s.summary.length) return "";
    const rows = s.summary.map((x) => `<tr>
      <td><b>${esc(x.name)}</b></td>
      <td>${x.months}</td>
      <td>${x.ic.toFixed(3)}</td>
      <td>${x.icir.toFixed(2)}</td>
      <td class="${x.ls >= 0 ? "pos" : "neg"}">${(x.ls * 100).toFixed(1)}%</td>
      <td>${x.ir.toFixed(2)}</td>
      <td><span class="status ${L3_STATUS[x.factor] && (L3_STATUS[x.factor].includes("未复现")) ? "bad" : "warn"}">${esc(L3_STATUS[x.factor] || "—")}</span></td>
    </tr>`).join("");
    const vrows = s.variants.map((x) => `<tr>
      <td>${esc(x.variant)}</td><td>${x.ic.toFixed(3)}</td><td>${x.icir.toFixed(2)}</td>
      <td class="${x.ls >= 0 ? "pos" : "neg"}">${(x.ls * 100).toFixed(1)}%</td><td>${x.ir.toFixed(2)}</td>
    </tr>`).join("");
    return `
      <div class="section-head" style="margin-top:22px">
        <h2 style="font-size:16px">L3 小样本：分钟 CPV / UTD / 偏度 / 下行波动 / RPV</h2>
        <p>80 只流动股票、2025 年、约 456 万条连续竞价分钟 bar；12 个月度截面。仅方向性抽检，未做行业/市值中性，未扣成本。</p>
      </div>
      <div class="repro-note">
        <b>关键结论</b>：UTD、高频偏度、下行波动方向与研报一致但很弱；CPV/RPV 在该样本中未复现出研报强度。
        80 只/12 个月的 IC 不显著，不能据此判定研报对错；需要更大样本/更贴近原文口径的 L3 复核。
      </div>
      <table class="repro-table">
        <thead><tr><th>因子</th><th>月数</th><th>IC</th><th>年化ICIR</th><th>多空年化</th><th>多空IR</th><th>初步结论</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="stat-card" style="margin-top:12px"><h3>CPV 口径对比（为什么可能没复现）</h3>
        <table class="repro-table"><thead><tr><th>口径</th><th>IC</th><th>年化ICIR</th><th>多空年化</th><th>多空IR</th></tr></thead><tbody>${vrows}</tbody></table>
      </div>`;
  }

  function renderRepro() {
    const rows = (D.repro || []).filter((r) => REPRO_NAMES[r.factor]).slice().sort((a, b) => {
      const order = ["ret20", "turn20", "str20", "vol20", "cpv_close_vol", "cpv_ret_vol", "amp20", "amp60"];
      return order.indexOf(a.factor) - order.indexOf(b.factor) || (a.neutral ? 1 : 0) - (b.neutral ? 1 : 0);
    });
    const statusCls = (s) => s.includes("不成立") ? "bad" : (s.includes("弱") || s.includes("条件")) ? "warn" : "ok";
    const table = `<table class="repro-table">
      <thead><tr><th>因子</th><th>处理</th><th>月度IC</th><th>年化ICIR</th><th>多空年化</th><th>多空IR</th><th>扣0.1%年化</th><th>扣0.1%IR</th><th>初步验证结论</th></tr></thead>
      <tbody>${rows.map((r) => `<tr>
        <td><b>${esc(REPRO_NAMES[r.factor] || r.factor)}</b></td>
        <td>${r.neutral ? "市值中性" : "raw"}</td>
        <td>${r.ic.toFixed(3)}</td>
        <td>${r.icir.toFixed(2)}</td>
        <td class="${r.ls >= 0 ? "pos" : "neg"}">${(r.ls * 100).toFixed(1)}%</td>
        <td>${r.ir.toFixed(2)}</td>
        <td>${(r.net10 * 100).toFixed(1)}%</td>
        <td>${r.net10_ir.toFixed(2)}</td>
        <td><span class="status ${statusCls(r.status)}">${esc(r.status)}</span></td>
      </tr>`).join("")}</tbody>
    </table>`;
    const imgs = Array.from(new Map(rows.filter((r) => r.image).map((r) => [r.image, r])).values());
    const imgGrid = imgs.length ? `<div class="repro-imgs">${imgs.map((r) => `
      <div class="repro-img-card">
        <div class="cap">${esc(REPRO_NAMES[r.factor] || r.factor)} · ${r.neutral ? "市值中性" : "raw"}</div>
        <img src="${PUBLIC ? "" : "../"}09_复现/04_图表/${encodeURI(r.image)}" alt="${esc(r.factor)}">
      </div>`).join("")}</div>` : "";
    $("#reproContent").innerHTML = `
      <div class="repro-note">
        <b>定位</b>：本页是 <b>L1 初步简单验证</b>（日频、单一股票池、无行业中性/分钟/逐笔），只回答研报结论是否“初步对得上”，<b>不是完整复现，也不是策略推荐/实盘依据</b>；不评估容量、冲击成本与执行。
        <br><b>读法</b>：IC 为月度 RankIC；多空为五分组等权、按因子预期方向取“有利端-不利端”；扣 0.1% 单边成本按两腿换手扣减。
        2026 年多只股票单月 ±100% 以上，主口径剔除 2026，避免把异常行情误读为因子失效。
      </div>
      ${table}
      <div class="section-head" style="margin-top:18px"><h2 style="font-size:16px">多空净值（gross vs 扣 0.1%）</h2></div>
      ${imgGrid}
      <div class="links" style="margin-top:14px">
        <a class="btn small" href="${PUBLIC ? "" : "../"}09_复现/05_报告/复现报告_第一批.md" target="_blank" rel="noopener">打开 L1 报告</a>
        <a class="btn small" href="${PUBLIC ? "" : "../"}09_复现/05_报告/复现报告_第二批_L2.md" target="_blank" rel="noopener">打开 L2 报告</a>
        <a class="btn small" href="${PUBLIC ? "" : "../"}09_复现/05_报告/复现报告_第三批_L3_全A.md" target="_blank" rel="noopener">打开 L3 全 A 报告</a>
        <a class="btn small" href="${PUBLIC ? "" : "../"}09_复现/05_报告/复现报告_第三批_L3_小样本.md" target="_blank" rel="noopener">L3 小样本</a>
        <a class="btn small" href="${PUBLIC ? "" : "../"}09_复现/05_报告/复现报告_第三批_L3_稳健性.md" target="_blank" rel="noopener">L3 稳健性</a>
        <a class="btn small" href="${PUBLIC ? "" : "../"}09_复现/01_数据/可行性清单.md" target="_blank" rel="noopener">可行性清单</a>
        <a class="btn small" href="${PUBLIC ? "" : "../"}09_复现/01_数据/缺失数据清单.md" target="_blank" rel="noopener">缺失数据清单</a>
      </div>
      ${renderL2()}
      ${renderL3()}`;
  }

  function renderProblems() {
    $("#problemList").innerHTML = D.problems.map((p) => {
      const sols = (p.solutions || []).slice(0, 8).map((s) => `<span class="sol">${esc(s.letter)}. ${esc(s.name)}</span>`).join("");
      return `<article class="problem-card" data-problem="${p.id}">
        <h3>${esc(p.title)}</h3>
        <div class="path">${esc(p.path)}</div>
        <div class="sol-list">${sols || "见正文"}</div>
      </article>`;
    }).join("");
    $$("#problemList [data-problem]").forEach((el) => el.addEventListener("click", () => openProblem(el.dataset.problem)));
  }

  function renderDeep() {
    $("#deepList").innerHTML = D.deep_notes.map((n, i) => `
      <article class="deep-card" data-deep="${i}">
        <h3>${esc(n.title)}</h3>
        <div class="path">${esc(n.path)}</div>
        <div style="margin-top:6px">${n.rating ? '<span class="rating">评级：' + esc(n.rating) + "</span>" : '<span class="tag plain">方法论/核验</span>'}</div>
      </article>`).join("");
    $$("#deepList [data-deep]").forEach((el) => el.addEventListener("click", () => {
      const n = D.deep_notes[Number(el.dataset.deep)];
      openDeepByPath(n.path);
    }));
  }

  function barRow(label, n, max, onclick) {
    const w = max ? Math.max(2, Math.round(n / max * 100)) : 0;
    return `<div class="bar-row" ${onclick ? 'style="cursor:pointer" data-bar="' + esc(label) + '"' : ""}>
      <span class="bar-label" title="${esc(label)}">${esc(label)}</span>
      <div class="bar-track"><div class="bar-fill" style="width:${w}%"></div></div>
      <span class="bar-num">${n}</span>
    </div>`;
  }

  function renderStats() {
    const s = D.stats;
    const noOos = D.papers.filter((p) => (p.flags || []).includes("无样本外")).length;
    const noCost = D.papers.filter((p) => (p.flags || []).includes("无成本假设")).length;
    const noCap = D.papers.filter((p) => (p.flags || []).includes("未讨论容量")).length;
    const suspicious = D.papers.filter((p) => (p.flags || []).includes("疑似全样本寻优")).length;
    const pct = (n) => (n / s.papers * 100).toFixed(1) + "%";
    const maxTopic = Math.max(...s.topic_counts.map((x) => x[1]));
    const maxFirm = Math.max(...s.firm_counts.slice(0, 15).map((x) => x[1]));
    const maxYear = Math.max(...s.year_counts.map((x) => x[1]));
    const maxBucket = Math.max(...s.score_buckets.map((x) => x[1]));
    const topicBars = s.topic_counts.map(([n, c]) => barRow(n, c, maxTopic)).join("");
    const firmBars = s.firm_counts.slice(0, 15).map(([n, c]) => barRow(n, c, maxFirm)).join("");
    const yearBars = s.year_counts.slice().sort((a, b) => String(a[0]).localeCompare(String(b[0]))).map(([n, c]) => barRow(String(n), c, maxYear)).join("");
    const scoreBars = s.score_buckets.map(([n, c]) => barRow(n, c, maxBucket)).join("");
    $("#statsContent").innerHTML = `
      <div class="stat-card wide">
        <h3>关键指标</h3>
        <div class="kpi-grid">
          <div class="kpi"><b>${s.papers}</b><span>研报卡片</span></div>
          <div class="kpi"><b>${s.deep_notes}</b><span>深读笔记</span></div>
          <div class="kpi"><b>${s.problems}</b><span>问题方案卡</span></div>
          <div class="kpi"><b>${pct(noOos)}</b><span>无样本外</span></div>
          <div class="kpi"><b>${pct(noCost)}</b><span>无成本假设</span></div>
          <div class="kpi"><b>${pct(noCap)}</b><span>容量未讨论</span></div>
          <div class="kpi"><b>${pct(suspicious)}</b><span>疑似全样本寻优</span></div>
          <div class="kpi"><b>${s.a_count}</b><span>A级复现清单</span></div>
        </div>
      </div>
      <div class="stat-card"><h3>主题分布</h3>${topicBars}</div>
      <div class="stat-card"><h3>机构分布（前 15）</h3>${firmBars}</div>
      <div class="stat-card"><h3>年份分布</h3>${yearBars}</div>
      <div class="stat-card"><h3>质量分分布</h3>${scoreBars}</div>
      <div class="stat-card wide">
        <h3>使用提醒</h3>
        <p style="font-size:12.5px;color:#475569;margin:0">质量分是“证据披露完整度”关键词评分，不是收益预测；高分不代表策略有效，低分不代表没有价值（外文理论/专著会偏低）。标签为自动提取，公式/参数请回原文核对。</p>
      </div>`;
    // 主题条点击筛选
    $$("#statsContent .bar-row[data-bar]").forEach((el) => el.addEventListener("click", () => {
      const name = el.dataset.bar;
      if (!D.stats.topic_counts.some(([n]) => n === name)) return;
      state.topics = new Set([name]); state.quick = "all"; state.page = 1;
      renderQuick(); renderTopics(); renderReports(); switchTab("reports");
    }));
  }

  function renderBm() {
    const bm = getBm();
    const arr = Array.from(bm).map(paperById).filter(Boolean);
    $("#bmList").innerHTML = arr.length ? arr.map((p) => `
      <div class="bm-item">
        <b>${esc(p.title)}</b>
        <div class="m">[${p.id}] ${esc(p.firm)} · ${esc(p.date || "?")} · 质量分 ${p.score.toFixed(1)}</div>
        <div class="ops">
          <button class="btn small" data-bm-open="${p.id}">查看</button>
          <button class="btn small danger" data-bm-del="${p.id}">移除</button>
        </div>
      </div>`).join("") : '<p style="color:#6b7280">还没有收藏。点研报卡片上的 ☆ 加入清单。</p>';
    $$("#bmList [data-bm-open]").forEach((b) => b.addEventListener("click", () => openPaper(b.dataset.bmOpen)));
    $$("#bmList [data-bm-del]").forEach((b) => b.addEventListener("click", () => toggleBookmark(b.dataset.bmDel)));
  }

  function exportCsv() {
    const bm = getBm();
    const arr = Array.from(bm).map(paperById).filter(Boolean);
    const rows = [["ID", "机构", "日期", "标题", "主题", "方向", "质量分", "原文路径"]];
    arr.forEach((p) => rows.push([p.id, p.firm, p.date, p.title, (p.topics || []).join("/"), (p.direction || []).join("/"), p.score, p.rel]));
    const csv = rows.map((r) => r.map((x) => '"' + String(x == null ? "" : x).replace(/"/g, '""') + '"').join(",")).join("\r\n");
    download("研报阅读清单.csv", "\ufeff" + csv);
  }

  function copyMarkdown() {
    const bm = getBm();
    const arr = Array.from(bm).map(paperById).filter(Boolean);
    const md = arr.map((p) => `- [${p.id}] ${p.firm}《${p.title}》（${p.date || "日期未标"}，质量分 ${p.score.toFixed(1)}）`).join("\n");
    copyText(md || "（清单为空）");
  }

  function download(name, text) {
    const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function copyText(t) {
    if (navigator.clipboard) navigator.clipboard.writeText(t).then(() => toast("已复制")).catch(() => toast("复制失败"));
    else { const ta = document.createElement("textarea"); ta.value = t; document.body.appendChild(ta); ta.select(); document.execCommand("copy"); ta.remove(); toast("已复制"); }
  }

  let toastTimer = null;
  function toast(msg) {
    let el = document.getElementById("toast");
    if (!el) { el = document.createElement("div"); el.id = "toast"; document.body.appendChild(el); }
    el.textContent = msg;
    el.style.cssText = "position:fixed;left:50%;bottom:30px;transform:translateX(-50%);background:#111827;color:#fff;padding:8px 14px;border-radius:8px;font-size:12px;z-index:100;box-shadow:0 8px 20px rgba(0,0,0,.25)";
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.remove(), 1800);
  }

  function switchTab(tab) {
    $$(".tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
    $$(".view").forEach((v) => (v.hidden = true));
    const v = document.getElementById("view-" + tab);
    if (v) v.hidden = false;
    if (tab === "problems") renderProblems();
    if (tab === "deep") renderDeep();
    if (tab === "repro") renderRepro();
    if (tab === "stats") renderStats();
  }

  function resetAll() {
    state.q = ""; state.topics = new Set(); state.directions = new Set();
    state.firm = ""; state.year = ""; state.minScore = 0; state.quick = "all"; state.page = 1;
    $("#searchInput").value = ""; $("#firmSelect").value = ""; $("#yearSelect").value = ""; $("#scoreRange").value = 0; $("#scoreVal").textContent = "0";
    renderQuick(); renderTopics(); renderDirections(); renderReports();
  }

  function init() {
    renderTopStats(); renderQuick(); renderTopics(); renderDirections(); initSelects();
    updateBmCount(); renderReports();

    $("#searchInput").addEventListener("input", (e) => {
      state.q = e.target.value.trim(); state.page = 1; renderReports();
    });
    $("#btnReset").addEventListener("click", resetAll);
    $("#btnBookmarks").addEventListener("click", () => { renderBm(); $("#bookmarkPanel").hidden = false; });
    $("#btnHelp").addEventListener("click", () => { $("#helpPanel").hidden = false; });
    $("#btnToggleSide").addEventListener("click", () => $("#sidebar").classList.toggle("open"));
    $$(".tab").forEach((b) => b.addEventListener("click", () => switchTab(b.dataset.tab)));
    $$("[data-close]").forEach((el) => el.addEventListener("click", () => { $("#modal").hidden = true; }));
    $$("[data-close-drawer]").forEach((el) => el.addEventListener("click", () => { $("#bookmarkPanel").hidden = true; $("#helpPanel").hidden = true; }));
    $("#btnExportCsv").addEventListener("click", exportCsv);
    $("#btnCopyMd").addEventListener("click", copyMarkdown);
    $("#btnClearBm").addEventListener("click", () => { if (confirm("清空收藏清单？")) { setBm(new Set()); renderBm(); renderReports(); } });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { $("#modal").hidden = true; $("#bookmarkPanel").hidden = true; $("#helpPanel").hidden = true; }
      if (e.key === "/" && document.activeElement !== $("#searchInput")) { e.preventDefault(); $("#searchInput").focus(); }
    });
    handleHash();
    window.addEventListener("hashchange", handleHash);
  }

  function handleHash() {
    const raw = (location.hash || "").replace(/^#/, "") || (location.search || "").replace(/^\?/, "");
    if (!raw) return;
    const params = new URLSearchParams(raw);
    const tab = params.get("tab");
    let changed = false;
    const q = params.get("q");
    if (q) { state.q = q; $("#searchInput").value = q; changed = true; }
    const topic = params.get("topic");
    if (topic) { state.topics.add(topic); changed = true; }
    const dir = params.get("dir");
    if (dir) { state.directions.add(dir); changed = true; }
    const firm = params.get("firm");
    if (firm) { state.firm = firm; $("#firmSelect").value = firm; changed = true; }
    const year = params.get("year");
    if (year) { state.year = year; $("#yearSelect").value = year; changed = true; }
    const quick = params.get("quick");
    if (quick) { state.quick = quick; changed = true; }
    if (changed) { state.page = 1; renderQuick(); renderTopics(); renderDirections(); renderReports(); }
    if (tab) switchTab(tab);
    const paper = params.get("paper");
    if (paper) openPaper(paper);
    const problem = params.get("problem");
    if (problem) openProblem(problem);
  }

  window.openPaper = openPaper;
  window.openProblem = openProblem;
  window.openDeepByPath = openDeepByPath;
  window.toggleBookmark = toggleBookmark;

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
