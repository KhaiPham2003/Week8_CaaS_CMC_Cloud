import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Layout from "./ui/Layout";
import Card from "./ui/Card";
import { api, getSession, clearSession } from "./api";

const MAX_BOARD_WIDTH = 560;
const MIN_BOARD_WIDTH = 260;
const ROW_HEIGHT = 26;

// Color coding matches the "hotter = better payout" convention used by real Plinko games.
function multiplierColor(m) {
  if (m >= 10) return "bg-red-500 text-white";
  if (m >= 2) return "bg-orange-400 text-white";
  if (m >= 1) return "bg-amber-300 text-amber-900";
  return "bg-slate-200 text-slate-600";
}

function Board({ rows, table, ball }) {
  const wrapRef = useRef(null);
  const [width, setWidth] = useState(MAX_BOARD_WIDTH);

  // Measure the actual available width instead of assuming a fixed 560px, so the
  // board never overflows its card on narrow screens or tighter grid columns.
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => {
      const w = Math.round(el.getBoundingClientRect().width);
      if (w > 0) setWidth(Math.max(MIN_BOARD_WIDTH, Math.min(MAX_BOARD_WIDTH, w)));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const spacing = width / (rows + 2);
  const center = width / 2;
  const boardHeight = rows * ROW_HEIGHT;

  const pegs = [];
  for (let r = 0; r < rows; r++) {
    const count = r + 1;
    for (let i = 0; i < count; i++) {
      const x = center + (i - r / 2) * spacing;
      pegs.push(
        <div
          key={`${r}-${i}`}
          className="absolute h-2 w-2 rounded-full bg-slate-300"
          style={{ left: x - 4, top: r * ROW_HEIGHT }}
        />
      );
    }
  }

  const ballTop = ball ? ball.step * ROW_HEIGHT : 0;
  const ballLeft = ball ? center + ball.offset * (spacing / 2) - 7 : center - 7;

  return (
    <div ref={wrapRef} className="w-full max-w-[560px] space-y-2">
      <div
        className="relative w-full overflow-hidden rounded-2xl bg-slate-50"
        style={{ height: boardHeight + 8 }}
      >
        {pegs}
        {ball && (
          <div
            className="absolute h-3.5 w-3.5 rounded-full bg-blue-600 shadow-md transition-all duration-200 ease-linear"
            style={{ top: ballTop, left: ballLeft }}
          />
        )}
      </div>
      <div className="flex w-full">
        {table.map((m, i) => (
          <div
            key={i}
            className={`flex-1 mx-0.5 rounded-lg py-2 text-center text-[11px] font-bold ${multiplierColor(m)} ${
              ball && ball.done && ball.slot === i ? "ring-4 ring-blue-500" : ""
            }`}
          >
            x{m}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Plinko({ onLogout, onNavigate }) {
  const [me, setMe] = useState(null);
  const [config, setConfig] = useState(null);
  const [risk, setRisk] = useState("medium");
  const [rows, setRows] = useState(16);
  const [bet, setBet] = useState(10000);
  const [ball, setBall] = useState(null);
  const [lastResult, setLastResult] = useState(null);
  const [history, setHistory] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const timers = useRef([]);

  const session = getSession();

  const load = async () => {
    const [m, cfg, h] = await Promise.all([
      api.me(),
      api.plinkoConfig(),
      api.plinkoHistory().catch(() => []),
    ]);
    setMe(m);
    setConfig(cfg);
    setHistory(h);
  };

  useEffect(() => {
    load().catch((e) => setErr(e.message));
    return () => timers.current.forEach(clearTimeout);
  }, []);

  const table = useMemo(() => {
    if (!config) return null;
    return config.tables?.[risk]?.[rows] || null;
  }, [config, risk, rows]);

  const logout = () => {
    clearSession();
    onLogout?.();
  };

  const drop = async () => {
    setErr("");
    setLastResult(null);
    const amount = Number(bet);

    if (!amount || amount <= 0) {
      setErr("Nhập số tiền cược hợp lệ");
      return;
    }
    if (config && (amount < config.min_bet || amount > config.max_bet)) {
      setErr(`Cược từ ${config.min_bet.toLocaleString()}đ đến ${config.max_bet.toLocaleString()}đ`);
      return;
    }
    if (me && amount > me.balance) {
      setErr("Số dư không đủ");
      return;
    }

    setBusy(true);
    try {
      const r = await api.plinkoPlay(amount, risk, rows);

      // Animate the ball bouncing row by row along the path the server picked.
      timers.current.forEach(clearTimeout);
      timers.current = [];
      let offset = 0;
      setBall({ step: 0, offset: 0, done: false, slot: null });

      r.path.forEach((bit, i) => {
        const t = setTimeout(() => {
          offset += bit === 1 ? 1 : -1;
          const isLast = i === r.path.length - 1;
          setBall({ step: i + 1, offset, done: isLast, slot: isLast ? r.slot_index : null });
          if (isLast) {
            setLastResult(r);
            setMe((prev) => (prev ? { ...prev, balance: r.balance } : prev));
            setBusy(false);
            api.plinkoHistory().then(setHistory).catch(() => {});
          }
        }, (i + 1) * 180);
        timers.current.push(t);
      });
    } catch (e) {
      setErr(e.message);
      setBusy(false);
    }
  };

  return (
    <Layout user={me?.username} env="LAB" onLogout={logout} page="plinko" onNavigate={onNavigate}>
      <div className="space-y-6">
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <Card title="Plinko" desc="Thả bóng, trúng ô nhân tiền" right={
              <span className="rounded-full border px-3 py-1 text-xs font-semibold text-slate-600">
                Số dư: {(me?.balance ?? 0).toLocaleString()} ₫
              </span>
            }>
              <div className="flex flex-col items-center gap-4">
                {table ? (
                  <Board rows={rows} table={table} ball={ball} />
                ) : (
                  <div className="text-sm text-slate-500">Đang tải bảng...</div>
                )}

                {lastResult && (
                  <div
                    className={`w-full rounded-xl px-4 py-3 text-center text-sm font-semibold ${
                      lastResult.net >= 0
                        ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                        : "bg-red-50 text-red-700 border border-red-200"
                    }`}
                  >
                    Ô x{lastResult.multiplier} → nhận {lastResult.payout.toLocaleString()}đ
                    {" "}({lastResult.net >= 0 ? "+" : ""}
                    {lastResult.net.toLocaleString()}đ)
                  </div>
                )}
                {err && (
                  <div className="w-full rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                    {err}
                  </div>
                )}
              </div>
            </Card>
          </div>

          <div className="space-y-6">
            <Card title="Cược" desc="Chọn mức rủi ro, số hàng và số tiền">
              <div className="space-y-3">
                <div>
                  <div className="mb-1 text-xs text-slate-500">Số tiền cược</div>
                  <input
                    type="number"
                    className="w-full rounded-xl border px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                    value={bet}
                    onChange={(e) => setBet(e.target.value)}
                    disabled={busy}
                  />
                </div>

                <div>
                  <div className="mb-1 text-xs text-slate-500">Mức rủi ro</div>
                  <div className="grid grid-cols-3 gap-2">
                    {(config?.risk_levels || ["low", "medium", "high"]).map((r) => (
                      <button
                        key={r}
                        onClick={() => setRisk(r)}
                        disabled={busy}
                        className={`rounded-xl border px-3 py-2 text-xs font-semibold capitalize ${
                          risk === r ? "border-blue-500 bg-blue-50 text-blue-700" : "text-slate-600 hover:bg-slate-50"
                        }`}
                      >
                        {r}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="mb-1 text-xs text-slate-500">Số hàng (rows)</div>
                  <div className="grid grid-cols-3 gap-2">
                    {(config?.row_options || [8, 12, 16]).map((n) => (
                      <button
                        key={n}
                        onClick={() => setRows(n)}
                        disabled={busy}
                        className={`rounded-xl border px-3 py-2 text-xs font-semibold ${
                          rows === n ? "border-blue-500 bg-blue-50 text-blue-700" : "text-slate-600 hover:bg-slate-50"
                        }`}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                </div>

                <button
                  onClick={drop}
                  disabled={busy}
                  className="w-full rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {busy ? "Đang thả..." : "Thả bóng"}
                </button>
              </div>
            </Card>

            <Card title="Cách hoạt động" desc="Tiền đi đâu khi bạn chơi">
              <ul className="list-disc pl-5 text-sm text-slate-700 space-y-2">
                <li>Mỗi tài khoản mới được cấp <b>1.000.000đ</b> để chơi thử.</li>
                <li>Tiền cược được giữ bởi một tài khoản hệ thống <b>casino_house</b> (giống tài khoản admin).</li>
                <li>Ô &lt; x1: phần chênh lệch chuyển từ bạn sang <b>casino_house</b>.</li>
                <li>Ô ≥ x1: phần thắng được <b>casino_house</b> trả lại cho bạn.</li>
                <li>Toàn bộ giao dịch chạy trong 1 transaction DB (giống transfer-service).</li>
              </ul>
            </Card>
          </div>
        </div>

        <Card title="Lịch sử" desc="20 lượt chơi gần nhất">
          <div className="space-y-2">
            {history.length === 0 && (
              <div className="rounded-xl border bg-slate-50 px-4 py-3 text-sm text-slate-600">
                Chưa có lượt chơi nào.
              </div>
            )}
            {history.map((h) => (
              <div key={h.id} className="flex items-center justify-between rounded-xl border px-4 py-2 text-sm">
                <div className="text-slate-600">
                  {h.risk} · {h.rows} hàng · cược {h.bet_amount.toLocaleString()}đ
                </div>
                <div className={`font-semibold ${h.net >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                  x{h.multiplier} ({h.net >= 0 ? "+" : ""}
                  {h.net.toLocaleString()}đ)
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </Layout>
  );
}
