import React, { useState, useEffect, useRef, useCallback } from "react";
import Layout from "./ui/Layout";
import Card from "./ui/Card";
import { api, getSession, clearSession } from "./api";

export default function Plinko({ onLogout, onNavigate }) {
  const [betAmount, setBetAmount] = useState(5000);
  const [risk, setRisk] = useState("medium");
  const [rows, setRows] = useState(10);
  const [autoDrop, setAutoDrop] = useState(false);
  const [dropping, setDropping] = useState(false);
  const [history, setHistory] = useState([]);
  const [err, setErr] = useState("");
  const [lastWin, setLastWin] = useState(null);
  const [balance, setBalance] = useState(0);
  const [username, setUsername] = useState("");

  const canvasRef = useRef(null);
  const activeBallsRef = useRef([]);
  const autoDropTimerRef = useRef(null);

  // Fetch account info (balance + username) on mount
  useEffect(() => {
    api.me().then((data) => {
      if (data) {
        setBalance(data.balance ?? 0);
        setUsername(data.username ?? "");
      }
    }).catch(() => {});
  }, []);

  // Fetch initial history
  useEffect(() => {
    api.plinkoHistory?.()
      .then((h) => setHistory(Array.isArray(h) ? h : []))
      .catch(() => {});
  }, []);

  // Multiplier presets matching backend
  const getMultipliers = useCallback((rRisk, rRows) => {
    const numSlots = rRows + 1;
    const multipliers = [];
    for (let i = 0; i < numSlots; i++) {
      const dist = Math.abs(i - rRows / 2);
      let val = 1.0;
      if (rRisk === "high") {
        if (dist === 0) val = 0.2;
        else if (dist <= 1) val = 0.3;
        else if (dist <= 2) val = 1.2;
        else if (dist <= 3) val = 3.0;
        else if (dist <= 4) val = 10.0;
        else if (dist <= 5) val = 25.0;
        else val = 75.0;
      } else if (rRisk === "low") {
        if (dist === 0) val = 0.8;
        else if (dist <= 1) val = 0.9;
        else if (dist <= 2) val = 1.1;
        else if (dist <= 3) val = 1.5;
        else if (dist <= 4) val = 2.2;
        else val = 4.0;
      } else {
        // Medium
        if (dist === 0) val = 0.4;
        else if (dist <= 1) val = 0.7;
        else if (dist <= 2) val = 1.3;
        else if (dist <= 3) val = 2.5;
        else if (dist <= 4) val = 6.0;
        else val = 15.0;
      }
      multipliers.push(val);
    }
    return multipliers;
  }, []);

  const currentMultipliers = getMultipliers(risk, rows);

  // Drop ball API handler (allows rapid concurrent calls!)
  const dropBall = useCallback(async () => {
    setErr("");
    if (!betAmount || betAmount < 1000) {
      setErr("Số tiền cược tối thiểu là 1,000 ₫");
      return;
    }
    if (balance < betAmount) {
      setErr("Số dư không đủ để cược");
      setAutoDrop(false);
      return;
    }

    // Trừ số dư tức thì ở giao diện Client (Optimistic Update)
    setBalance((prev) => prev - betAmount);

    try {
      setDropping(true);
      const res = await api.dropPlinko(betAmount, risk, rows);
      if (res && res.ok) {
        // Đồng bộ số dư mới nhất từ Server response
        if (res.new_balance !== undefined) {
          setBalance(res.new_balance);
        }

        // Add animated ball to canvas board
        const ball = {
          id: res.ball_id || Math.random().toString(),
          path: res.path || [],
          slot: res.slot,
          multiplier: res.multiplier,
          payout: res.payout,
          betAmount: res.bet_amount,
          step: 0,
          progress: 0,
          x: 0,
          y: 0,
          vx: 0,
          vy: 0,
          color: res.multiplier >= 2 ? "#ef4444" : res.multiplier >= 1 ? "#f59e0b" : "#3b82f6",
          completed: false
        };

        activeBallsRef.current.push(ball);

        // Update last win display
        setLastWin({
          multiplier: res.multiplier,
          payout: res.payout,
          bet: res.bet_amount
        });

        // Update history
        setHistory((prev) => [
          {
            id: ball.id,
            bet_amount: res.bet_amount,
            multiplier: res.multiplier,
            payout: res.payout,
            slot: res.slot,
            risk,
            rows,
            created_at: new Date().toISOString()
          },
          ...prev.slice(0, 19)
        ]);
      }
    } catch (e) {
      // Hoàn lại tiền nếu API lỗi
      setBalance((prev) => prev + betAmount);
      setErr(e.message || "Lỗi khi thả bóng");
      setAutoDrop(false);
    } finally {
      setDropping(false);
    }
  }, [betAmount, risk, rows, balance]);

  // Handle Auto Drop Timer
  useEffect(() => {
    if (autoDrop) {
      autoDropTimerRef.current = setInterval(() => {
        dropBall();
      }, 250);
    } else {
      if (autoDropTimerRef.current) clearInterval(autoDropTimerRef.current);
    }

    return () => {
      if (autoDropTimerRef.current) clearInterval(autoDropTimerRef.current);
    };
  }, [autoDrop, dropBall]);

  // Canvas Animation Render Loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    let animId;

    const render = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const width = canvas.width;
      const height = canvas.height;
      const startY = 40;
      const endY = height - 60;
      const rowHeight = (endY - startY) / rows;

      // 1. Draw Pyramid Pegs
      ctx.fillStyle = "#94a3b8";
      for (let r = 0; r <= rows; r++) {
        const py = startY + r * rowHeight;
        const numPegs = r + 1;
        const pegSpacing = Math.min(36, (width - 60) / (rows + 1));
        const startX = width / 2 - ((numPegs - 1) * pegSpacing) / 2;

        for (let i = 0; i < numPegs; i++) {
          const px = startX + i * pegSpacing;
          ctx.beginPath();
          ctx.arc(px, py, 3.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // 2. Draw Bottom Multiplier Slots
      const slotCount = rows + 1;
      const slotWidth = Math.min(36, (width - 60) / (rows + 1));
      const slotsStartX = width / 2 - (slotCount * slotWidth) / 2;

      currentMultipliers.forEach((mult, idx) => {
        const sx = slotsStartX + idx * slotWidth;
        const color =
          mult >= 10 ? "#dc2626" : mult >= 3 ? "#ea580c" : mult >= 1 ? "#ca8a04" : "#475569";

        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.roundRect(sx + 2, endY + 8, slotWidth - 4, 28, 6);
        ctx.fill();

        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 10px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(`${mult}x`, sx + slotWidth / 2, endY + 25);
      });

      // 3. Render and update Active Balls
      activeBallsRef.current.forEach((ball) => {
        if (ball.completed) return;

        ball.progress += 0.15; // Animation speed
        if (ball.progress >= 1) {
          ball.progress = 0;
          ball.step += 1;
        }

        if (ball.step >= rows) {
          ball.completed = true;
          return;
        }

        // Calculate positions
        const r = ball.step;
        const numPegs = r + 1;
        const pegSpacing = Math.min(36, (width - 60) / (rows + 1));
        const startX = width / 2 - ((numPegs - 1) * pegSpacing) / 2;

        // Current bounce index sum of path up to step
        const currentPathSum = ball.path.slice(0, r).reduce((a, b) => a + b, 0);
        const currX = startX + currentPathSum * pegSpacing;
        const currY = startY + r * rowHeight;

        // Next position
        const nextPathSum = ball.path.slice(0, r + 1).reduce((a, b) => a + b, 0);
        const nextNumPegs = r + 2;
        const nextStartX = width / 2 - ((nextNumPegs - 1) * pegSpacing) / 2;
        const nextX = nextStartX + nextPathSum * pegSpacing;
        const nextY = startY + (r + 1) * rowHeight;

        // Linear interpolation
        ball.x = currX + (nextX - currX) * ball.progress;
        ball.y = currY + (nextY - currY) * ball.progress;

        // Bounce arch curve
        const bounceHeight = Math.sin(ball.progress * Math.PI) * 6;

        ctx.fillStyle = ball.color;
        ctx.beginPath();
        ctx.arc(ball.x, ball.y - bounceHeight, 7, 0, Math.PI * 2);
        ctx.fill();

        ctx.shadowColor = ball.color;
        ctx.shadowBlur = 8;
        ctx.fill();
        ctx.shadowBlur = 0;
      });

      // Filter out completed balls
      activeBallsRef.current = activeBallsRef.current.filter((b) => !b.completed);

      animId = requestAnimationFrame(render);
    };

    render();
    return () => cancelAnimationFrame(animId);
  }, [rows, currentMultipliers]);

  const logout = () => {
    clearSession();
    onLogout?.();
  };

  return (
    <Layout user={username} env="LAB" onLogout={logout} page="plinko" onNavigate={onNavigate}>
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Control Panel */}
        <Card
          title="🎮 Plinko Casino"
          desc="Thả bóng liên tục - Thắng lớn liền tay!"
        >
          <div className="space-y-4">
            {/* Số Dư Tài Khoản hiện tại */}
            <div className="rounded-2xl bg-gradient-to-r from-blue-600 to-indigo-600 p-4 text-white shadow-md">
              <div className="text-xs font-medium text-blue-100 uppercase tracking-wider">
                Số Dư Tài Khoản Hiện Tại
              </div>
              <div className="mt-1 text-2xl font-black">
                {balance.toLocaleString()} ₫
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">
                Số Tiền Cược (VND)
              </label>
              <div className="flex gap-2">
                <input
                  type="number"
                  min="1000"
                  step="1000"
                  value={betAmount}
                  onChange={(e) => setBetAmount(Number(e.target.value))}
                  className="w-full rounded-xl border px-3 py-2 text-sm font-bold text-slate-900 outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                  onClick={() => setBetAmount((b) => b * 2)}
                  className="rounded-xl border px-3 text-xs font-bold hover:bg-slate-50"
                >
                  2x
                </button>
                <button
                  onClick={() => setBetAmount((b) => Math.max(1000, Math.floor(b / 2)))}
                  className="rounded-xl border px-3 text-xs font-bold hover:bg-slate-50"
                >
                  1/2
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">
                Mức Rủi Ro
              </label>
              <div className="grid grid-cols-3 gap-2">
                {["low", "medium", "high"].map((r) => (
                  <button
                    key={r}
                    onClick={() => setRisk(r)}
                    className={`rounded-xl py-2 text-xs font-bold uppercase transition ${
                      risk === r
                        ? r === "high"
                          ? "bg-red-600 text-white shadow-lg"
                          : r === "medium"
                          ? "bg-amber-500 text-white shadow-lg"
                          : "bg-emerald-600 text-white shadow-lg"
                        : "border text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">
                Số Hàng Đinh ({rows})
              </label>
              <input
                type="range"
                min="8"
                max="16"
                value={rows}
                onChange={(e) => setRows(Number(e.target.value))}
                className="w-full accent-blue-600"
              />
            </div>

            <div className="pt-2 space-y-2">
              <button
                onClick={dropBall}
                className="w-full rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 py-3 text-sm font-bold text-white shadow-lg hover:from-emerald-600 hover:to-teal-700 active:scale-95 transition"
              >
                ⚾ THẢ BÓNG (Drop Ball)
              </button>

              <button
                onClick={() => setAutoDrop(!autoDrop)}
                className={`w-full rounded-xl py-2.5 text-xs font-bold transition border ${
                  autoDrop
                    ? "bg-red-500 text-white border-red-600 animate-pulse"
                    : "bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100"
                }`}
              >
                {autoDrop
                  ? "⏹ Đang Thả Tự Động (Dừng)"
                  : "⚡ Kích Hoạt Thả Tự Động (Auto)"}
              </button>
            </div>

            {err && (
              <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                {err}
              </div>
            )}

            {lastWin && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-center">
                <div className="text-xs text-amber-700 font-medium">Lượt vừa thả</div>
                <div className="text-lg font-extrabold text-amber-900">
                  {lastWin.multiplier}x Multiplier → +{lastWin.payout.toLocaleString()} ₫
                </div>
              </div>
            )}
          </div>
        </Card>

        {/* Plinko Canvas Board */}
        <div className="lg:col-span-2 space-y-4">
          <div className="relative rounded-2xl overflow-hidden shadow-2xl border border-slate-800 bg-slate-900 flex justify-center p-2">
            <canvas
              ref={canvasRef}
              width={520}
              height={460}
              className="w-full max-w-[520px]"
            />
          </div>

          {/* Live History */}
          <Card title="Lịch Sử Chơi Plinko" desc="20 lượt gần nhất">
            <div className="max-h-48 overflow-y-auto space-y-2">
              {history.length === 0 ? (
                <div className="text-xs text-slate-500">Chưa có lượt thả bóng nào.</div>
              ) : (
                history.map((h, i) => (
                  <div
                    key={h.id || i}
                    className="flex items-center justify-between rounded-xl border bg-slate-50 px-3 py-2 text-xs"
                  >
                    <div className="font-semibold text-slate-700">
                      Cược {h.bet_amount?.toLocaleString()} ₫ ({h.risk}, {h.rows} hàng)
                    </div>
                    <div
                      className={`font-black ${
                        h.multiplier >= 2
                          ? "text-red-600"
                          : h.multiplier >= 1
                          ? "text-amber-600"
                          : "text-slate-500"
                      }`}
                    >
                      {h.multiplier}x ({h.payout?.toLocaleString()} ₫)
                    </div>
                  </div>
                ))
              )}
            </div>
          </Card>
        </div>
      </div>
    </Layout>
  );
}
