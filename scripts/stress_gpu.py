"""GPU stress test - per-device independent run.

Usage:
  python stress_gpu.py --device 0 --duration 600 --label gpu0

Designed to be launched in parallel across all GPUs. Records per-second
temperature, sm/mem clock, power, throttle-reasons to a per-device CSV.
"""
import argparse
import csv
import os
import sys
import time
from datetime import datetime

import torch

NVML_PYNVML = None
PYNVML_OK = False
try:
    import pynvml as _pnv
    _pnv.nvmlInit()
    PYNVML_OK = True
    pynvml = _pnv
except Exception as e:
    pynvml = None
    PYNVML_OK = False
    print(f"[warn] pynvml unavailable: {e}", file=sys.stderr)


def throttle_reasons(handle):
    """Return set of active throttle reason names."""
    reasons = set()
    if not PYNVML_OK:
        return reasons
    try:
        SUPPORTED = {
            pynvml.NVML_PERF_LIMITER_REASON_HW_SLOWDOWN: "HW_SLOWDOWN",
            pynvml.NVML_PERF_LIMITER_REASON_SW_THERMAL_SLOWDOWN: "SW_THERMAL_SLOWDOWN",
            pynvml.NVML_PERF_LIMITER_REASON_HW_THERMAL_SLOWDOWN: "HW_THERMAL_SLOWDOWN",
            pynvml.NVML_PERF_LIMITER_REASON_HW_POWER_BRAKE: "HW_POWER_BRAKE",
            pynvml.NVML_PERF_LIMITER_REASON_APPLICATION_CLOCKS: "APP_CLOCKS",
            pynvml.NVML_PERF_LIMITER_REASON_SYNC_BOOST: "SYNC_BOOST",
        }
        info = pynvml.nvmlDeviceGetPerfStateReasons(handle)
        for mask, name in SUPPORTED.items():
            if info & mask:
                reasons.add(name)
    except Exception:
        pass
    return reasons


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--device", type=int, required=True)
    ap.add_argument("--duration", type=int, default=600, help="seconds")
    ap.add_argument("--matrix", type=int, default=8192,
                    help="tensor size N for matmul; N*N floats * 4B")
    ap.add_argument("--label", default="gpu")
    args = ap.parse_args()

    torch.cuda.set_device(args.device)
    device = torch.device(f"cuda:{args.device}")

    out_csv = f"/tmp/stress_{args.label}_d{args.device}.csv"
    f = open(out_csv, "w", newline="")
    w = csv.writer(f)
    w.writerow(["wall_ts", "t_s", "temp_C", "sm_mhz", "mem_mhz",
                "power_W", "gpu_util_pct", "throttle_reasons",
                "throttle_hit_ever", "matmul_iters"])

    if PYNVML_OK:
        h = pynvml.nvmlDeviceGetHandleByIndex(args.device)
    else:
        h = None

    # Workload: huge matmul + element-wise recip, all on this device only.
    a = torch.randn(args.matrix, args.matrix, device=device)
    b = torch.randn(args.matrix, args.matrix, device=device)

    # Warm-up + verify the card is actually being used.
    for _ in range(3):
        c = torch.matmul(a, b)
        d = c * 0.5
    torch.cuda.synchronize()

    print(f"[{args.label}] device={args.device} matrix={args.matrix}x{args.matrix} dur={args.duration}s out={out_csv}", flush=True)

    iters = 0
    throttle_ever = set()
    start = time.time()
    next_sample = start
    interval = 5.0  # 5s sampling; ~120 samples per 10min

    while True:
        now = time.time()
        if (now - start) >= args.duration:
            break

        # Heavy compute burst until next sample window
        next_sample_target = min(now + 2.0, start + args.duration)
        while time.time() < next_sample_target:
            c = torch.matmul(a, b)
            d = torch.reciprocal(c + 0.1)
            iters += 1
        torch.cuda.synchronize()

        # Sample via NVML
        if PYNVML_OK:
            try:
                temp = pynvml.nvmlDeviceGetTemperature(h, pynvml.NVML_TEMPERATURE_GPU)
                sm_mhz, mem_mhz = pynvml.nvmlDeviceGetClockInfo(h, pynvml.NVML_CLOCK_SM), pynvml.nvmlDeviceGetClockInfo(h, pynvml.NVML_CLOCK_MEM)
                power_mw = pynvml.nvmlDeviceGetPowerUsage(h)
                util_pct = pynvml.nvmlDeviceGetUtilizationRates(h).gpu
            except Exception:
                temp, sm_mhz, mem_mhz, power_mw, util_pct = -1, -1, -1, -1, -1
            reasons = throttle_reasons(h)
        else:
            temp, sm_mhz, mem_mhz, power_mw, util_pct, reasons = -1, -1, -1, -1, -1, ""
        throttle_ever |= reasons

        w.writerow([datetime.now().isoformat(), round(now - start, 1),
                    temp, sm_mhz, mem_mhz,
                    round(power_mw / 1000.0, 1) if power_mw > 0 else -1,
                    util_pct,
                    "|".join(sorted(reasons)) if reasons else "",
                    "|".join(sorted(throttle_ever)) if throttle_ever else "",
                    iters])
        f.flush()

    f.close()
    print(f"[{args.label}] DONE t={time.time()-start:.1f}s iters={iters}", flush=True)


if __name__ == "__main__":
    main()
