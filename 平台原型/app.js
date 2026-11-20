(function () {
  const D = window.PROTO_DATA;
  if (!D) {
    document.body.innerHTML = '<div style="padding:40px;font-family:sans-serif">data.js 未加载</div>';
    return;
  }
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  const fmtPct = (x, d = 1) => (x == null || isNaN(x) ? "—" : (x * 100).toFixed(d) + "%");
  const fmtNum = (x, d = 2) => (x == null || isNaN(x) ? "—" : x.toFixed(d));
  const state = {
    selected: { utr20: true, accrual: true, overnight: true, utd20: false },
    weights: { utr20: 1, accrual: 1, overnight: 1, utd20: 1 },
    cost: 10,
    period: "all",
    api: false,
    apiBase: "http://127.0.0.1:8765",
    search: "",
  };
  let lastRun = null;
  let lastCompare = null;
  const AUTO_COMPARE = (() => {
    try { return new URLSearchParams(location.search).get("compare") === "1"; } catch (e) { return false; }
  })();
  let autoCompared = false;
  try {
    state.api = localStorage.getItem("kb_api_mode") === "1";
    state.apiBase = localStorage.getItem("kb_api_base") || state.apiBase;
  } catch (e) {}
  try {
    if (new URLSearchParams(location.search).get("api") === "1") state.api = true;
  } catch (e) {}
  function updateBadge() {
    const el = $("#modeBadge");
    if (el) {
      el.textContent = state.api ? "API preview" : "静态计算";
      el.className = "pill dark";
    }
  }

  function updateApiUI() {
    const submit = $("#btnSubmit"), history = $("#historyPanel");
    if (submit) submit.hidden = !state.api;
    if (history) history.hidden = !state.api;
    if (!state.api) {
      const cc = $("#compareCard");
      if (cc) cc.hidden = true;
    }
    if (state.api) loadHistory();
  }

  function monthsFor(id) {
    return Object.keys(D.monthly[id] || {}).sort();
  }

  function selectedIds() {
    return D.factors.filter((f) => state.selected[f.id]).map((f) => f.id);
  }

  function intersect(ids) {
    if (!ids.length) return [];
    let out = null;
    ids.forEach((id) => {
      const s = new Set(monthsFor(id));
      out = out == null ? s : new Set([...out].filter((m) => s.has(m)));
    });
    return Array.from(out || []).sort();
  }

  function renderFactors() {
    const box = $("#factorList");
    const q = (state.search || "").trim().toLowerCase();
    const list = D.factors.filter((f) => !q || f.cn.toLowerCase().includes(q) || f.en.toLowerCase().includes(q) || f.report.toLowerCase().includes(q));
    if (!list.length) {
      box.innerHTML = '<p class="hint">没有匹配因子</p>';
      return;
    }
    const groups = ["日频", "财务", "分钟"];
    box.innerHTML = groups.map((group) => {
      const arr = list.filter((f) => f.group === group);
      if (!arr.length) return "";
      return `<div class="group-label">${group}</div>` + arr.map((f) => {
        const active = !!state.selected[f.id];
        const dir = f.direction < 0 ? "低值好" : "高值好";
        const cls = f.direction < 0 ? "neg" : "pos";
        const st = f.status === "有效" ? "ok" : "warn";
        return `<div class="factor-item ${active ? "active" : ""}" data-id="${f.id}">
          <input type="checkbox" ${active ? "checked" : ""} data-check="${f.id}">
          <div class="factor-name" data-detail="${f.id}">
            <b>${f.cn} <span class="status-pill ${st}">${f.status}</span></b>
            <span>${f.en} · <span class="dir ${cls}">${dir}</span> · ${f.report} · ${f.sample}</span>
          </div>
          <input class="factor-weight" type="number" min="0" max="10" step="0.1" value="${state.weights[f.id]}" data-weight="${f.id}" title="权重">
        </div>`;
      }).join("");
    }).join("");
    $$("#factorList input[data-check]").forEach((el) => {
      el.addEventListener("change", () => {
        state.selected[el.dataset.check] = el.checked;
        renderFactors();
        run();
      });
    });
    $$("#factorList input[data-weight]").forEach((el) => {
      el.addEventListener("input", () => {
        state.weights[el.dataset.weight] = Math.max(0, Number(el.value) || 0);
        run();
      });
    });
    $$("#factorList [data-detail]").forEach((el) => el.addEventListener("click", () => showDetail(el.dataset.detail)));
  }

  function showDetail(id) {
    const f = D.factors.find((x) => x.id === id);
    if (!f) return;
    const months = Object.keys(D.monthly[id] || {}).sort();
    const rets = months.map((m) => Number(D.monthly[id][m]));
    const mm = metrics(rets);
    const rep = D.reported[id] || {};
    $("#detailTitle").textContent = f.cn;
    $("#detailSub").textContent = `${f.en} · ${f.report} · ${f.sample} · ${f.status}`;
    $("#detailMeta").innerHTML = `
      <div class="k">因子名称</div><div class="v">${f.cn}（${f.en}）</div>
      <div class="k">方向</div><div class="v">${f.direction < 0 ? "低值好（多头=低分组）" : "高值好（多头=高分组）"}</div>
      <div class="k">公式</div><div class="v formula">${f.formula}</div>
      <div class="k">样本</div><div class="v">${f.sample}</div>
      ${f.group === "分钟" ? `<div class="k">数据源</div><div class="v">${D.minute.source} · ${D.minute.start} ~ ${D.minute.cutoff} · ${D.minute.stocks} 只</div>` : ""}
      <div class="k">复现年化/IR</div><div class="v">${fmtPct(mm.ann)} / ${fmtNum(mm.ir)}</div>
      <div class="k">参考</div><div class="v">${rep.label || "—"}：${fmtPct(rep.ann)} / ${fmtNum(rep.ir)}</div>`;
    $("#detailCard").hidden = false;
    $("#btnSolo").dataset.id = id;
    const cum = cumFromReturns(rets);
    drawEquity($("#detailChart"), months, [{ name: f.en, vals: cum, color: "#2e6da4" }]);
  }

  function renderMinute() {
    const meta = D.minute;
    if (!meta) return;
    $("#minuteCutoff").textContent = meta.cutoff;
    $("#minuteMeta").textContent = `${meta.source} · ${meta.freq} · ${meta.start} ~ ${meta.cutoff} · ${meta.stocks} 只 · ${meta.bars} · ${meta.note}`;
    const ids = D.factors.filter((f) => f.group === "分钟").map((f) => f.id);
    const rows = ids.map((id) => {
      const f = D.factors.find((x) => x.id === id);
      const months = Object.keys(D.monthly[id] || {}).sort();
      const mm = metrics(months.map((m) => Number(D.monthly[id][m])));
      const rep = D.reported[id] || {};
      return `<tr data-minute="${id}"><td><b>${f.cn}</b></td><td>${f.en}</td><td>${f.status}</td><td>${f.sample}</td><td>${fmtPct(rep.ann)} / ${fmtNum(rep.ir)}</td><td>${fmtPct(mm.ann)} / ${fmtNum(mm.ir)}</td></tr>`;
    }).join("");
    $("#minuteTable").innerHTML = `<table><thead><tr><th>因子</th><th>英文</th><th>状态</th><th>样本</th><th>参考 年化/IR</th><th>当前区间 年化/IR</th></tr></thead><tbody>${rows}</tbody></table>`;
    $$("#minuteTable [data-minute]").forEach((el) => el.addEventListener("click", () => showDetail(el.dataset.minute)));
  }

  function metrics(arr) {
    const x = arr.map(Number);
    const n = x.length;
    if (!n) return {};
    let cum = 1;
    const cur = [];
    x.forEach((r) => { cum *= (1 + r); cur.push(cum); });
    const ann = Math.pow(cum, 12 / n) - 1;
    const mean = x.reduce((a, b) => a + b, 0) / n;
    const sd = Math.sqrt(x.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(n - 1, 1));
    let peak = 1, mdd = 0;
    cur.forEach((v) => { peak = Math.max(peak, v); mdd = Math.min(mdd, v / peak - 1); });
    return { n, ann, vol: sd * Math.sqrt(12), ir: sd ? ann / (sd * Math.sqrt(12)) : NaN, mdd, win: x.filter((v) => v > 0).length / n, cur };
  }

  async function run() {
    const ids = selectedIds().filter((id) => state.weights[id] > 0);
    const warn = $("#warning");
    if (!ids.length) {
      $("#comboSummary").textContent = "请至少选择一个因子";
      ["#kpis", "#factorTable", "#compareTable", "#monthlyTable"].forEach((s) => $(s).innerHTML = "");
      $("#equityChart").innerHTML = "";
      $("#ddChart").innerHTML = "";
      $("#rollingChart").innerHTML = "";
      lastRun = null;
      return;
    }
    let months = intersect(ids);
    if (state.period === "2025") months = months.filter((m) => m >= "2025-01");
    if (!months.length) {
      warn.hidden = false; warn.textContent = "所选因子没有共同可用月份。";
      return;
    }
    const minuteIds = ids.filter((id) => (D.factors.find((x) => x.id === id) || {}).group === "分钟");
    if (minuteIds.length && state.period === "all") {
      warn.hidden = false;
      warn.textContent = `分钟因子只覆盖 ${D.minute.start} ~ ${D.minute.cutoff}；与其他因子组合时样本自动收敛到 2025，数据按更新批次聚合，不实时。`;
    } else {
      warn.hidden = true;
    }

    if (state.api) {
      try {
        await runApi(ids);
      } catch (e) {
        warn.hidden = false;
        warn.textContent = "API 请求失败：" + e.message + "。请先启动 08_可视化/平台后端/server.py。";
        $("#comboSummary").textContent = "API 模式未连接";
      }
      return;
    }

    const totalW = ids.reduce((a, id) => a + state.weights[id], 0);
    const gross = [], net = [], eq = [];
    months.forEach((m) => {
      let g = 0, e = 0;
      ids.forEach((id) => {
        const r = Number(D.monthly[id][m] || 0);
        g += state.weights[id] / totalW * r;
        e += r / ids.length;
      });
      gross.push(g);
      net.push(g - (state.cost / 10000) * 2 * (ids.length > 1 ? 1 : 1));
      eq.push(e);
    });
    const mg = metrics(gross), mn = metrics(net), me = metrics(eq);
    const summary = `${ids.length} 个因子 · ${months[0]} ~ ${months[months.length - 1]} · ${months.length} 个月 · 单边成本 ${state.cost}bp`;
    $("#comboSummary").textContent = summary;

    $("#kpis").innerHTML = [
      ["年化收益（扣费）", fmtPct(mn.ann), `毛 ${fmtPct(mg.ann)}`, mn.ann >= 0 ? "pos" : "neg"],
      ["信息比率", fmtNum(mn.ir), `毛 ${fmtNum(mg.ir)}`, mn.ir >= 0 ? "pos" : "neg"],
      ["最大回撤", fmtPct(mn.mdd), "扣费", "neg"],
      ["月度胜率", fmtPct(mn.win), `${mn.n} 个月`, "pos"],
      ["年化波动", fmtPct(mn.vol), "扣费", ""],
      ["等权基准 IR", fmtNum(me.ir), `年化 ${fmtPct(me.ann)}`, ""],
    ].map(([k, v, s, cls]) => `<div class="kpi"><div class="k">${k}</div><div class="v ${cls}">${v}</div><div class="s">${s}</div></div>`).join("");

    lastRun = { months, gross, net, eq, ids };
    drawEquity($("#equityChart"), months, [
      { name: "组合（扣费）", vals: mn.cur, color: "#2e6da4" },
      { name: "组合（毛）", vals: mg.cur, color: "#8a9aab" },
      { name: "等权基准", vals: me.cur, color: "#d9822b" },
    ]);
    drawDrawdown($("#ddChart"), months, mn.cur);
    drawRollingIR($("#rollingChart"), months, net);

    $("#factorTable").innerHTML = table(
      ["因子", "英文", "状态", "方向", "权重", "样本", "研报"],
      ids.map((id) => {
        const f = D.factors.find((x) => x.id === id);
        return [f.cn, f.en, f.status, f.direction < 0 ? "低值好" : "高值好", fmtNum(state.weights[id] / totalW, 2), f.sample, f.report];
      })
    );

    const cmpRows = ids.map((id) => {
      const f = D.factors.find((x) => x.id === id);
      const arr = months.map((m) => Number(D.monthly[id][m] || 0));
      const mm = metrics(arr);
      const rep = D.reported[id] || {};
      return [f.cn, f.en, rep.label || "—", `${fmtPct(rep.ann)} / ${fmtNum(rep.ir)}`, `${fmtPct(mm.ann)} / ${fmtNum(mm.ir)}`];
    });
    $("#compareTable").innerHTML = table(["因子", "英文", "口径", "原文/参考 年化/IR", "本区间 年化/IR"], cmpRows);

    const tail = [];
    const n = months.length;
    for (let i = Math.max(0, n - 8); i < n; i++) {
      tail.push([months[i], fmtPct(gross[i], 2), fmtPct(net[i], 2), fmtPct(eq[i], 2)]);
    }
    $("#monthlyTable").innerHTML = table(["月份", "组合毛", "组合净", "等权"], tail);

    const config = {
      universe: $("#universe").value,
      neutralization: $("#neutral").value,
      start: months[0],
      end: months[months.length - 1],
      cost_bps: state.cost,
      factors: ids.map((id) => ({
        id,
        name: D.factors.find((x) => x.id === id).en,
        weight: Number((state.weights[id] / totalW).toFixed(3)),
        direction: D.factors.find((x) => x.id === id).direction,
      })),
      data_version: D.as_of,
      note: "P1 prototype; monthly precomputed factor returns",
    };
    $("#configBox").textContent = JSON.stringify(config, null, 2);
  }

  function buildConfig(ids) {
    const totalW = ids.reduce((a, id) => a + state.weights[id], 0);
    return {
      universe: $("#universe").value,
      neutralization: $("#neutral").value,
      period: state.period,
      cost_bps: state.cost,
      factors: ids.map((id) => ({
        id,
        weight: Number((state.weights[id] / totalW).toFixed(4)),
      })),
    };
  }

  async function apiFetch(path, options) {
    const base = state.apiBase.replace(/\/+$/, "");
    const resp = await fetch(base + path, options);
    let body = {};
    try { body = await resp.json(); } catch (e) {}
    if (!resp.ok) throw new Error(body.error || ("HTTP " + resp.status));
    return body;
  }

  function paintApiResult(r, source) {
    const cfg = r.config || {};
    const ids = (cfg.factors || []).map((x) => x.id);
    if (!ids.length || !r.curve || !r.curve.length) throw new Error("API 结果为空");
    const weight = {};
    (cfg.factors || []).forEach((x) => { weight[x.id] = x.weight; });
    const totalW = Object.values(weight).reduce((a, b) => a + b, 0) || 1;
    const months = r.curve.map((x) => x.month);
    const gross = r.curve.map((x) => Number(x.gross_ret));
    const net = r.curve.map((x) => Number(x.net_ret));
    const eq = r.curve.map((x) => Number(x.equal_ret != null ? x.equal_ret : 0));
    const mg = metrics(gross), mn = metrics(net), me = metrics(eq);
    const tag = source === "api-task" ? "TASK" : "API preview";
    $("#comboSummary").textContent = `${tag} · ${ids.length} 个因子 · ${months[0]} ~ ${months[months.length - 1]} · ${months.length} 个月 · 单边成本 ${cfg.cost_bps}bp`;
    $("#kpis").innerHTML = [
      ["年化收益（扣费）", fmtPct(mn.ann), `毛 ${fmtPct(mg.ann)}`, mn.ann >= 0 ? "pos" : "neg"],
      ["信息比率", fmtNum(mn.ir), `毛 ${fmtNum(mg.ir)}`, mn.ir >= 0 ? "pos" : "neg"],
      ["最大回撤", fmtPct(mn.mdd), "扣费", "neg"],
      ["月度胜率", fmtPct(mn.win), `${mn.n} 个月`, "pos"],
      ["年化波动", fmtPct(mn.vol), "扣费", ""],
      ["等权基准 IR", fmtNum(me.ir), `年化 ${fmtPct(me.ann)}`, ""],
    ].map(([k, v, s, cls]) => `<div class="kpi"><div class="k">${k}</div><div class="v ${cls}">${v}</div><div class="s">${s}</div></div>`).join("");
    lastRun = { months, gross, net, eq, ids };
    drawEquity($("#equityChart"), months, [
      { name: "组合（扣费）", vals: mn.cur, color: "#2e6da4" },
      { name: "组合（毛）", vals: mg.cur, color: "#8a9aab" },
      { name: "等权基准", vals: me.cur, color: "#d9822b" },
    ]);
    drawDrawdown($("#ddChart"), months, mn.cur);
    drawRollingIR($("#rollingChart"), months, net);
    $("#factorTable").innerHTML = table(
      ["因子", "英文", "状态", "方向", "权重", "样本", "研报"],
      ids.map((id) => {
        const f = D.factors.find((x) => x.id === id);
        return [f.cn, f.en, f.status, f.direction < 0 ? "低值好" : "高值好", fmtNum(weight[id], 2), f.sample, f.report];
      })
    );
    const cmpRows = ids.map((id) => {
      const f = D.factors.find((x) => x.id === id);
      const arr = months.map((m) => Number(D.monthly[id][m] || 0));
      const mm = metrics(arr);
      const rep = D.reported[id] || {};
      return [f.cn, f.en, rep.label || "—", `${fmtPct(rep.ann)} / ${fmtNum(rep.ir)}`, `${fmtPct(mm.ann)} / ${fmtNum(mm.ir)}`];
    });
    $("#compareTable").innerHTML = table(["因子", "英文", "口径", "原文/参考 年化/IR", "本区间 年化/IR"], cmpRows);
    const tail = [];
    for (let i = Math.max(0, months.length - 8); i < months.length; i++) {
      tail.push([months[i], fmtPct(gross[i], 2), fmtPct(net[i], 2), fmtPct(eq[i], 2)]);
    }
    $("#monthlyTable").innerHTML = table(["月份", "组合毛", "组合净", "等权"], tail);
    $("#configBox").textContent = JSON.stringify({ ...cfg, source }, null, 2);
  }

  async function runApi(ids) {
    const cfg = buildConfig(ids);
    const body = await apiFetch("/api/combinations/preview", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cfg),
    });
    paintApiResult(body.result, "api-preview");
  }

  async function submitApi(ids) {
    const cfg = buildConfig(ids);
    const status = $("#taskStatus");
    status.className = "hint"; status.textContent = "提交中…";
    const job = await apiFetch("/api/backtests", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cfg),
    });
    const id = job.id;
    status.textContent = `任务 ${id} 已提交，等待…`;
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 500));
      const meta = await apiFetch(`/api/backtests/${id}`);
      if (meta.status === "done") {
        const cv = await apiFetch(`/api/backtests/${id}/curve`);
        paintApiResult({ curve: cv.curve, config: meta.config }, "api-task");
        status.className = "hint task-ok";
        status.textContent = `任务 ${id} 完成`;
        loadHistory();
        return id;
      }
      if (meta.status === "failed") throw new Error(meta.error || "任务失败");
      status.textContent = `任务 ${id}：${meta.status}…`;
    }
    throw new Error("任务超时");
  }

  async function loadRun(id) {
    const meta = await apiFetch(`/api/backtests/${id}`);
    if (meta.status !== "done") {
      $("#taskStatus").className = "hint";
      $("#taskStatus").textContent = `任务 ${id}：${meta.status}`;
      return;
    }
    const cv = await apiFetch(`/api/backtests/${id}/curve`);
    paintApiResult({ curve: cv.curve, config: meta.config }, "api-task");
    $("#taskStatus").className = "hint task-ok";
    $("#taskStatus").textContent = `已载入任务 ${id}`;
  }

  async function loadHistory() {
    if (!state.api) return;
    const box = $("#historyList");
    box.innerHTML = '<p class="hint">加载中…</p>';
    try {
      const body = await apiFetch("/api/backtests");
      if (!body.items || !body.items.length) {
        box.innerHTML = '<p class="hint">还没有任务</p>';
        return;
      }
      box.innerHTML = body.items.map((x) => {
        const st = x.status || "queued";
        return `<div class="history-item" data-run="${x.id}">
          <div><b>${x.id}</b><br><span>${x.created_at || ""}</span></div>
          <span class="run-status ${st}">${st}</span>
        </div>`;
      }).join("");
      $$("#historyList [data-run]").forEach((el) => el.addEventListener("click", () => {
        loadRun(el.dataset.run).catch((e) => {
          $("#taskStatus").className = "hint task-err";
          $("#taskStatus").textContent = "载入失败：" + e.message;
        });
      }));
      renderCompareOptions(body.items.filter((x) => x.status === "done"));
      if (AUTO_COMPARE && !autoCompared && body.items.filter((x) => x.status === "done").length >= 2) {
        autoCompared = true;
        setTimeout(() => compareRuns(), 120);
      }
    } catch (e) {
      box.innerHTML = `<p class="hint">API 未连接：${e.message}</p>`;
    }
  }

  function renderCompareOptions(items) {
    const a = $("#cmpA"), b = $("#cmpB");
    if (!a || !b) return;
    if (!items.length) {
      a.innerHTML = '<option value="">无完成任务</option>';
      b.innerHTML = '<option value="">无完成任务</option>';
      return;
    }
    const prevA = a.value, prevB = b.value;
    const opts = items.map((x) => `<option value="${x.id}">${x.id}</option>`).join("");
    a.innerHTML = opts; b.innerHTML = opts;
    a.value = items.some((x) => x.id === prevA) ? prevA : items[0].id;
    b.value = items.some((x) => x.id === prevB) ? prevB : (items[1] || items[0]).id;
  }

  function cumFromReturns(arr) {
    let c = 1;
    return arr.map((r) => { c *= 1 + r; return c; });
  }

  function corr(a, b) {
    const n = Math.min(a.length, b.length);
    if (n < 3) return NaN;
    const ma = a.reduce((x, y) => x + y, 0) / n;
    const mb = b.reduce((x, y) => x + y, 0) / n;
    let cov = 0, va = 0, vb = 0;
    for (let i = 0; i < n; i++) {
      const x = a[i] - ma, y = b[i] - mb;
      cov += x * y; va += x * x; vb += y * y;
    }
    return va && vb ? cov / Math.sqrt(va * vb) : NaN;
  }

  async function compareRuns() {
    const idA = $("#cmpA").value, idB = $("#cmpB").value;
    if (!idA || !idB) {
      $("#taskStatus").className = "hint task-err";
      $("#taskStatus").textContent = "至少需要两个已完成任务";
      return;
    }
    $("#taskStatus").className = "hint";
    $("#taskStatus").textContent = "对比加载中…";
    try {
      const [ma, ca, mb, cb] = await Promise.all([
        apiFetch(`/api/backtests/${idA}`), apiFetch(`/api/backtests/${idA}/curve`),
        apiFetch(`/api/backtests/${idB}`), apiFetch(`/api/backtests/${idB}/curve`),
      ]);
      const mapA = Object.fromEntries(ca.curve.map((x) => [x.month, x]));
      const mapB = Object.fromEntries(cb.curve.map((x) => [x.month, x]));
      const months = Object.keys(mapA).filter((m) => mapB[m]).sort();
      if (months.length < 6) throw new Error("共同月份不足 6 个月");
      const ra = months.map((m) => Number(mapA[m].net_ret));
      const rb = months.map((m) => Number(mapB[m].net_ret));
      const qa = metrics(ra), qb = metrics(rb);
      drawEquity($("#cmpChart"), months, [
        { name: "A " + idA, vals: cumFromReturns(ra), color: "#2e6da4" },
        { name: "B " + idB, vals: cumFromReturns(rb), color: "#d9822b" },
      ]);
      const c = corr(ra, rb);
      const rows = [
        ["年化收益", fmtPct(qa.ann), fmtPct(qb.ann), fmtPct(qa.ann - qb.ann)],
        ["信息比率", fmtNum(qa.ir), fmtNum(qb.ir), fmtNum(qa.ir - qb.ir)],
        ["最大回撤", fmtPct(qa.mdd), fmtPct(qb.mdd), fmtPct(qa.mdd - qb.mdd)],
        ["月度胜率", fmtPct(qa.win), fmtPct(qb.win), fmtPct(qa.win - qb.win)],
        ["月数", qa.n, qb.n, months.length],
        ["月收益相关", "—", "—", fmtNum(c)],
      ];
      $("#cmpTable").innerHTML = table(["指标", "A", "B", "A-B"], rows);
      const cfg = (m) => (m.config.factors || []).map((f) => `${f.id} ${(f.weight * 100).toFixed(1)}%`).join("<br>");
      $("#cmpConfig").innerHTML = `<table><thead><tr><th>项目</th><th>A</th><th>B</th></tr></thead><tbody>
        <tr><td>成本</td><td>${ma.config.cost_bps}bp</td><td>${mb.config.cost_bps}bp</td></tr>
        <tr><td>区间</td><td>${ma.config.period}</td><td>${mb.config.period}</td></tr>
        <tr><td>因子</td><td>${cfg(ma)}</td><td>${cfg(mb)}</td></tr>
      </tbody></table>`;
      $("#cmpSummary").textContent = `A ${idA} · B ${idB} · ${months.length} 个月 · 相关 ${fmtNum(c)}`;
      $("#compareCard").hidden = false;
      lastCompare = { a: idA, b: idB };
      $("#btnCmpCsv").disabled = false;
      $("#btnCmpDocx").disabled = false;
      $("#taskStatus").className = "hint task-ok";
      $("#taskStatus").textContent = "对比完成";
    } catch (e) {
      $("#taskStatus").className = "hint task-err";
      $("#taskStatus").textContent = "对比失败：" + e.message;
    }
  }

  function table(headers, rows) {
    return `<table><thead><tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr></thead>
      <tbody>${rows.map((r) => `<tr>${r.map((v) => `<td>${v}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
  }

  function drawEquity(el, labels, series) {
    const W = 980, H = 320, L = 52, R = 18, T = 16, B = 30;
    const all = series.flatMap((s) => s.vals);
    let mn = Math.min(...all), mx = Math.max(...all);
    if (!isFinite(mn) || !isFinite(mx)) return;
    const pad = (mx - mn) * .08 || .05;
    mn -= pad; mx += pad;
    const x = (i) => L + (W - L - R) * (labels.length === 1 ? .5 : i / (labels.length - 1));
    const y = (v) => T + (H - T - B) * (1 - (v - mn) / (mx - mn));
    let grid = "";
    for (let k = 0; k <= 4; k++) {
      const v = mn + (mx - mn) * k / 4;
      grid += `<line x1="${L}" y1="${y(v)}" x2="${W - R}" y2="${y(v)}" stroke="#e7edf4"/>`;
      grid += `<text x="${L - 8}" y="${y(v) + 3}" text-anchor="end" font-size="10" fill="#6b7b8c">${v.toFixed(2)}</text>`;
    }
    const paths = series.map((s) => {
      const d = s.vals.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
      return `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2"/>`;
    }).join("");
    const xs = [];
    const step = Math.max(1, Math.floor(labels.length / 6));
    for (let i = 0; i < labels.length; i += step) {
      xs.push(`<text x="${x(i)}" y="${H - 8}" text-anchor="middle" font-size="10" fill="#6b7b8c">${labels[i]}</text>`);
    }
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img">${grid}${paths}${xs.join("")}</svg>`;
  }

  function drawRollingIR(el, labels, r) {
    const W = 980, H = 180, L = 52, R = 18, T = 14, B = 24, win = 12;
    const vals = r.map((_, i) => {
      if (i < win - 1) return null;
      const s = r.slice(i - win + 1, i + 1);
      const mean = s.reduce((a, b) => a + b, 0) / win;
      const sd = Math.sqrt(s.reduce((a, b) => a + (b - mean) ** 2, 0) / (win - 1));
      return sd ? mean / sd * Math.sqrt(12) : null;
    });
    const valid = vals.filter((v) => v != null);
    if (!valid.length) { el.innerHTML = '<p class="muted">样本不足 12 个月</p>'; return; }
    const mn = Math.min(0, ...valid), mx = Math.max(0, ...valid);
    const pad = (mx - mn) * .12 || .2;
    const y0 = mn - pad, y1 = mx + pad;
    const x = (i) => L + (W - L - R) * (labels.length === 1 ? .5 : i / (labels.length - 1));
    const y = (v) => T + (H - T - B) * (1 - (v - y0) / (y1 - y0));
    const path = vals.map((v, i) => v == null ? null : `${x(i).toFixed(1)},${y(v).toFixed(1)}`).filter(Boolean).join(" ");
    const xs = [];
    const step = Math.max(1, Math.floor(labels.length / 6));
    for (let i = 0; i < labels.length; i += step) xs.push(`<text x="${x(i)}" y="${H - 8}" text-anchor="middle" font-size="10" fill="#6b7b8c">${labels[i]}</text>`);
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img">
      <line x1="${L}" y1="${y(0)}" x2="${W - R}" y2="${y(0)}" stroke="#c9d6e3" stroke-dasharray="4 4"/>
      <text x="${L - 8}" y="${y(0) + 3}" text-anchor="end" font-size="10" fill="#6b7b8c">0</text>
      <text x="${L - 8}" y="${y(y1 - pad) + 3}" text-anchor="end" font-size="10" fill="#6b7b8c">${(y1 - pad).toFixed(1)}</text>
      <text x="${L - 8}" y="${y(y0 + pad) + 3}" text-anchor="end" font-size="10" fill="#6b7b8c">${(y0 + pad).toFixed(1)}</text>
      <polyline points="${path}" fill="none" stroke="#2e6da4" stroke-width="1.8"/>
      ${xs.join("")}
    </svg>`;
  }

  function exportCsv() {
    if (!lastRun) return;
    const rows = [["month", "combo_gross", "combo_net", "equal_weight"]];
    lastRun.months.forEach((m, i) => rows.push([m, lastRun.gross[i], lastRun.net[i], lastRun.eq[i]]));
    const csv = rows.map((r) => r.join(",")).join("\n");
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `factor_combo_${lastRun.months[0]}_${lastRun.months[lastRun.months.length - 1]}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function drawDrawdown(el, labels, cum) {
    const W = 980, H = 180, L = 52, R = 18, T = 14, B = 24;
    let peak = 1, dd = [];
    cum.forEach((v) => { peak = Math.max(peak, v); dd.push(v / peak - 1); });
    const mn = Math.min(...dd, -0.0001), mx = 0;
    const x = (i) => L + (W - L - R) * (labels.length === 1 ? .5 : i / (labels.length - 1));
    const y = (v) => T + (H - T - B) * (v - mn) / (mx - mn || 1);
    const pts = dd.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
    const area = `M${x(0)},${y(0)} L${pts.split(" ").join(" L")} L${x(labels.length - 1)},${y(0)} Z`;
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img">
      <line x1="${L}" y1="${y(0)}" x2="${W - R}" y2="${y(0)}" stroke="#dbe3ec"/>
      <path d="${area}" fill="#2e6da4" opacity=".12"/>
      <polyline points="${pts}" fill="none" stroke="#2e6da4" stroke-width="1.8"/>
      <text x="${L - 8}" y="${y(0) + 3}" text-anchor="end" font-size="10" fill="#6b7b8c">0%</text>
      <text x="${L - 8}" y="${y(mn) + 3}" text-anchor="end" font-size="10" fill="#6b7b8c">${(mn * 100).toFixed(0)}%</text>
    </svg>`;
  }

  function init() {
    $("#asOf").textContent = "数据截至 " + D.as_of;
    D.factors.forEach((f) => {
      if (state.selected[f.id] == null) state.selected[f.id] = false;
      if (state.weights[f.id] == null) state.weights[f.id] = 1;
    });
    try {
      const rawCfg = new URLSearchParams(location.search).get("cfg");
      if (rawCfg) {
        const c = JSON.parse(rawCfg);
        if (c.selected && typeof c.selected === "object") Object.assign(state.selected, c.selected);
        if (c.weights && typeof c.weights === "object") Object.assign(state.weights, c.weights);
        if (c.cost != null) state.cost = Number(c.cost);
        if (c.period) state.period = String(c.period);
        if (c.api != null) state.api = !!c.api;
        if (c.search) state.search = String(c.search);
      }
    } catch (e) {}
    const apiMode = $("#apiMode"), apiBase = $("#apiBase"), apiBaseRow = $("#apiBaseRow");
    $("#cost").value = String(state.cost);
    $("#period").value = state.period;
    $("#factorSearch").value = state.search;
    apiMode.checked = state.api;
    apiBase.value = state.apiBase;
    apiBaseRow.hidden = !state.api;
    updateBadge();
    updateApiUI();
    apiMode.addEventListener("change", () => {
      state.api = apiMode.checked;
      apiBaseRow.hidden = !state.api;
      try { localStorage.setItem("kb_api_mode", state.api ? "1" : "0"); } catch (e) {}
      updateBadge();
      updateApiUI();
      run();
    });
    apiBase.addEventListener("input", () => {
      state.apiBase = apiBase.value.trim() || "http://127.0.0.1:8765";
      try { localStorage.setItem("kb_api_base", state.apiBase); } catch (e) {}
    });
    renderFactors();
    renderMinute();
    try {
      const detail = new URLSearchParams(location.search).get("detail");
      if (detail) showDetail(detail);
    } catch (e) {}
    $("#btnMinuteOnly").addEventListener("click", () => {
      const ids = D.factors.filter((f) => f.group === "分钟").map((f) => f.id);
      D.factors.forEach((f) => { state.selected[f.id] = f.group === "分钟"; if (f.group === "分钟") state.weights[f.id] = 1; });
      renderFactors(); $("#detailCard").hidden = true; run();
    });
    $("#btnRun").addEventListener("click", run);
    $("#factorSearch").addEventListener("input", (e) => {
      state.search = e.target.value.trim();
      renderFactors();
    });
    $("#btnCloseDetail").addEventListener("click", () => { $("#detailCard").hidden = true; });
    $("#btnSolo").addEventListener("click", () => {
      const id = $("#btnSolo").dataset.id;
      if (!id) return;
      D.factors.forEach((f) => { state.selected[f.id] = f.id === id; state.weights[f.id] = f.id === id ? 1 : state.weights[f.id]; });
      renderFactors(); $("#detailCard").hidden = true; run();
    });
    $("#btnShare").addEventListener("click", async () => {
      const payload = { selected: state.selected, weights: state.weights, cost: state.cost, period: state.period, search: state.search, api: state.api };
      const url = location.href.split("?")[0].split("#")[0] + "?cfg=" + encodeURIComponent(JSON.stringify(payload));
      try {
        await navigator.clipboard.writeText(url);
        $("#btnShare").textContent = "已复制";
        setTimeout(() => $("#btnShare").textContent = "分享配置", 1500);
      } catch (e) {
        window.prompt("复制分享链接：", url);
      }
    });
    $("#btnReset").addEventListener("click", () => {
      state.selected = { utr20: true, accrual: true, overnight: true, utd20: false };
      state.weights = { utr20: 1, accrual: 1, overnight: 1, utd20: 1 };
      state.cost = 10; state.period = "all"; state.search = "";
      $("#cost").value = "10"; $("#period").value = "all"; $("#factorSearch").value = "";
      $("#detailCard").hidden = true;
      renderFactors(); run();
    });
    $("#cost").addEventListener("change", (e) => { state.cost = Number(e.target.value); run(); });
    $("#period").addEventListener("change", (e) => { state.period = e.target.value; run(); });
    $("#btnCopy").addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText($("#configBox").textContent);
        $("#btnCopy").textContent = "已复制";
        setTimeout(() => $("#btnCopy").textContent = "复制配置 JSON", 1200);
      } catch (e) {
        const r = document.createRange(); r.selectNodeContents($("#configBox"));
        const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
      }
    });
    $("#btnPrint").addEventListener("click", () => window.print());
    $("#btnCsv").addEventListener("click", exportCsv);
    $("#btnSubmit").addEventListener("click", async () => {
      const ids = selectedIds().filter((id) => state.weights[id] > 0);
      if (!ids.length) return;
      try {
        await submitApi(ids);
      } catch (e) {
        $("#taskStatus").className = "hint task-err";
        $("#taskStatus").textContent = "提交失败：" + e.message;
      }
    });
    $("#btnHistory").addEventListener("click", () => loadHistory());
    $("#btnCompare").addEventListener("click", () => compareRuns());
    const openCompare = (ext) => {
      if (!lastCompare) return;
      const base = state.apiBase.replace(/\/+$/, "");
      window.open(`${base}/api/compare.${ext}?ids=${encodeURIComponent(lastCompare.a + "," + lastCompare.b)}`, "_blank");
    };
    $("#btnCmpCsv").addEventListener("click", () => openCompare("csv"));
    $("#btnCmpDocx").addEventListener("click", () => openCompare("docx"));
    run();
  }

  init();
})();
