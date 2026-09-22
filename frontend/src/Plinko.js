import React, { useState, useEffect, useRef, useCallback } from "react";
import Card from "./ui/Card";
import { api } from "./api";

export default function Plinko({ me, onBalanceUpdate }) {
  const [betAmount, setBetAmount] = useState(5000);
  const [risk, setRisk] = useState("medium");
  const [rows, setRows] = useState(10);
  const [autoDrop, setAutoDrop] = useState(false);
  const [dropping, setDropping] = useState(false);
  const [history, setHistory] = useState([]);
  const [err, setErr] = useState("");
  const [lastWin, setLastWin] = useState(null);

  const canvasRef = useRef(null);
  const activeBallsRef = useRef([]);
  const autoDropTimerRef = useRef(null);

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

  // Fetch initial history
  useEffect(() => {
    api
      .plinkoHistory?.()
      .then((h) => setHistory(Array.isArray(h) ? h : []))
      .catch(() => {});
  }, []);

  // Drop ball API handler (allows rapid concurrent calls!)
  const dropBall = useCallback(async () => {
    setErr("");
    if (!betAmount || betAmount < 1000) {
      setErr("Số tiền cược tối thiểu là 1,000 ₫");
      return;
    }
    if (me && me.balance < betAmount) {
      setErr("Số dư không đủ để cược");
      setAutoDrop(false);
      return;
    }

    try {
      setDropping(true);
      const res = await api.dropPlinko(betAmount, risk, rows);
      if (res && res.ok) {
        onBalanceUpdate?.(res.new_balance);

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
          color:
            res.multiplier >= 2
              ? "#ef4444"
              : res.multiplier >= 1
                ? "#f59e0b"
                : "#3b82f6",
          completed: false,
        };

        activeBallsRef.current.push(ball);

        // Update last win display
        setLastWin({
          multiplier: res.multiplier,
          payout: res.payout,
          bet: res.bet_amount,
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
            created_at: new Date().toISOString(),
          },
          ...prev.slice(0, 19),
        ]);
      }
    } catch (e) {
      setErr(e.message || "Lỗi khi thả bóng");
      setAutoDrop(false);
    } finally {
      setDropping(false);
    }
  }, [betAmount, risk, rows, me, onBalanceUpdate]);

  // Handle Auto-drop interval
  useEffect(() => {
    if (autoDrop) {
      dropBall();
      autoDropTimerRef.current = setInterval(() => {
        dropBall();
      }, 250); // Drop a ball every 250ms
    } else {
      if (autoDropTimerRef.current) {
        clearInterval(autoDropTimerRef.current);
        autoDropTimerRef.current = null;
      }
    }

    return () => {
      if (autoDropTimerRef.current) {
        clearInterval(autoDropTimerRef.current);
      }
    };
  }, [autoDrop, dropBall]);

  // Canvas Animation loop for rendering Plinko peg board & multiple active balls
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    let animId;

    const render = () => {
      const width = canvas.width;
      const height = canvas.height;
      ctx.clearRect(0, 0, width, height);

      // Background board styling
      ctx.fillStyle = "#0f172a";
      ctx.fillRect(0, 0, width, height);

      const topPadding = 40;
      const bottomPadding = 60;
      const boardHeight = height - topPadding - bottomPadding;
      const rowHeight = boardHeight / rows;
      const pegRadius = 4;
      const startX = width / 2;

      // Draw Pegs (Pyramid layout)
      ctx.fillStyle = "#94a3b8";
      for (let r = 0; r <= rows; r++) {
        const pegsInRow = r + 3;
        const rowWidth = pegsInRow * 32;
        const rowStartX = startX - rowWidth / 2 + 16;
        const y = topPadding + r * rowHeight;

        for (let p = 0; p < pegsInRow; p++) {
          const x = rowStartX + p * 32;
          ctx.beginPath();
          ctx.arc(x, y, pegRadius, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Draw Multipliers at bottom
      const numSlots = rows + 1;
      const slotWidth = Math.min(32, (width - 40) / numSlots);
      const slotsStartX = startX - (numSlots * slotWidth) / 2;
      const slotY = height - 45;

      currentMultipliers.forEach((mult, idx) => {
        const sx = slotsStartX + idx * slotWidth;
        const color =
          mult >= 10
            ? "#dc2626"
            : mult >= 3
              ? "#ea580c"
              : mult >= 1
                ? "#ca8a04"
                : "#475569";

        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.roundRect(sx + 2, slotY, slotWidth - 4, 30, 6);
        ctx.fill();

        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 10px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(`${mult}x`, sx + slotWidth / 2, slotY + 18);
      });

      // Animate active bouncing balls
      const speed = 0.15; // Animation step speed
      activeBallsRef.current.forEach((ball) => {
        if (ball.completed) return;

        ball.progress += speed;
        if (ball.progress >= 1) {
          ball.progress = 0;
          ball.step += 1;
        }

        if (ball.step >= rows) {
          ball.completed = true;
          return;
        }

        // Compute current ball position (x, y) along trajectory
        let currentLefts = 0;
        for (let i = 0; i < ball.step; i++) {
          currentLefts += ball.path[i] || 0;
        }
        const nextMove = ball.path[ball.step] || 0;
        const interpolatedLefts = currentLefts + nextMove * ball.progress;

        const currentPegsInRow = ball.step + 3;
        const rowWidth = currentPegsInRow * 32;
        const rowStartX = startX - rowWidth / 2 + 16;
        const startBallX = rowStartX + (currentLefts + 1) * 32 - 16;
        const targetBallX = startBallX + (nextMove === 1 ? 16 : -16);

        const bx = startBallX + (targetBallX - startBallX) * ball.progress;
        const by = topPadding + (ball.step + ball.progress) * rowHeight;

        // Draw bouncing ball
        ctx.fillStyle = ball.color;
        ctx.shadowColor = ball.color;
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.arc(bx, by, 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      });

      // Filter out completed balls
      activeBallsRef.current = activeBallsRef.current.filter(
        (b) => !b.completed,
      );

      animId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animId);
    };
  }, [rows, currentMultipliers]);

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      {/* Control Panel */}
      <Card
        title="🎮 Plinko Casino"
        desc="Thả bóng liên tục - Thắng lớn liền tay!"
      >
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">
              Số tiền cược (₫)
            </label>
            <div className="flex gap-2">
              <input
                type="number"
                min="1000"
                max="10000000"
                step="1000"
                className="w-full rounded-xl border px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-blue-500 font-semibold"
                value={betAmount}
                onChange={(e) => setBetAmount(Number(e.target.value))}
              />
              <button
                onClick={() => setBetAmount((b) => b * 2)}
                className="rounded-xl border px-3 text-xs font-bold hover:bg-slate-50"
              >
                2x
              </button>
              <button
                onClick={() =>
                  setBetAmount((b) => Math.max(1000, Math.floor(b / 2)))
                }
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
                  className={`rounded-xl py-2 text-xs font-bold capitalize transition-all ${
                    risk === r
                      ? r === "high"
                        ? "bg-red-600 text-white shadow-lg"
                        : r === "medium"
                          ? "bg-amber-500 text-white shadow-lg"
                          : "bg-emerald-600 text-white shadow-lg"
                      : "border text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  {r === "low" ? "Thấp" : r === "medium" ? "Trung Bình" : "Cao"}
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
              className="w-full accent-blue-600 cursor-pointer"
            />
          </div>

          <div className="pt-2 flex flex-col gap-2">
            <button
              onClick={dropBall}
              className="w-full rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-600 py-4 text-base font-extrabold text-white shadow-lg shadow-emerald-500/30 hover:scale-[1.02] active:scale-[0.98] transition-all"
            >
              🟢 THẢ BÓNG (Drop Ball)
            </button>

            <button
              onClick={() => setAutoDrop((prev) => !prev)}
              className={`w-full rounded-xl py-3 text-xs font-bold transition-all border ${
                autoDrop
                  ? "bg-red-50 text-red-700 border-red-300 animate-pulse"
                  : "bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100"
              }`}
            >
              {autoDrop
                ? "⏹ Đang Thả Tự Động (Dừng)"
                : "⚡ Kích Hoạt Thả Tự Động (Auto)"}
            </button>
          </div>

          {err && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">
              {err}
            </div>
          )}

          {lastWin && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-center">
              <div className="text-xs text-amber-700 font-medium">
                Lượt vừa thả
              </div>
              <div className="text-lg font-extrabold text-amber-900">
                {lastWin.multiplier}x Multiplier → +
                {lastWin.payout.toLocaleString()} ₫
              </div>
            </div>
          )}
        </div>
      </Card>

      {/* Plinko Canvas Canvas Board */}
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
              <div className="text-xs text-slate-500">
                Chưa có lượt thả bóng nào.
              </div>
            ) : (
              history.map((h, i) => (
                <div
                  key={h.id || i}
                  className="flex items-center justify-between rounded-xl border px-4 py-2 text-xs"
                >
                  <div className="font-semibold text-slate-900">
                    Cược: {h.bet_amount?.toLocaleString()} ₫ ({h.risk})
                  </div>
                  <div
                    className={`font-bold ${
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
  );
}
