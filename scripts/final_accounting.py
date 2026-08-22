# Exact numbers from crash log
model = 9.48          # GiB, "Model loading took 9.48 GiB"
kv_budget = 10.04     # GiB, "Available KV cache memory: 10.04 GiB"
cudagraph = 0.06      # GiB, "Estimated CUDA graph memory: 0.06 GiB"
profiler_total = model + kv_budget + cudagraph  # 19.58

pytorch_allocated = 20.70  # GiB at crash
pytorch_reserved = 0.47    # GiB (467.95 MiB)
gpu_total = 21.66          # GiB
gpu_free = 0.07            # GiB (66 MiB)
non_pytorch = 21.59 - 20.70 - 0.02  # 0.87 GiB

kv_tokens = 556836
bytes_per_token_measured = 20742  # measured from pool
kv_actual_gib = kv_tokens * bytes_per_token_measured / (1024**3)

bytes_per_token_profiler = kv_budget * (1024**3) / kv_tokens

gap = pytorch_allocated - profiler_total  # 1.12 GiB

print("=" * 65)
print("PROFILER vs ACTUAL")
print("=" * 65)
print(f"Profiler measured: {profiler_total:.2f} GiB total")
print(f"  model={model}  KV_budget={kv_budget}  cudagraph={cudagraph}")
print()
print(f"PyTorch at crash: {pytorch_allocated:.2f} GiB allocated")
print(f"Gap: +{gap:.2f} GiB not accounted by profiler")
print()
print(f"Profiler bytes/token: {bytes_per_token_profiler:.0f}")
print(f"Actual bytes/token:   {bytes_per_token_measured}")
print(f"Extra per token:      {bytes_per_token_measured - bytes_per_token_profiler:.0f}")
print(f"Extra total at {kv_tokens} tokens: +{(bytes_per_token_measured - bytes_per_token_profiler) * kv_tokens / (1024**3):.2f} GiB")

print()
print("=" * 65)
print("FULL MEMORY AT CRASH (GPU 0)")
print("=" * 65)
items = [
    ("Model weights", 9.48),
    ("KV cache (profiler budget)", 10.04),
    ("KV scale+padding overhead (+)", 1.12),
    ("CUDA graph", 0.06),
]
subtotal = sum(s for _, s in items)
print(f"  {'Item':<40s} {'GiB':>8s}")
print(f"  {'-'*40} {'--------':>8}")
for name, size in items:
    print(f"  {name:<40s} {size:>8.2f}")
print(f"  {'Subtotal (PyTorch allocated)':<40s} {subtotal:>8.2f}")
print(f"  {'PyTorch reserved (pool free list)':<40s} {pytorch_reserved:>8.2f}")
print(f"  {'Non-PyTorch (CUDA context)':<40s} {non_pytorch:>8.2f}")
print(f"  {'-'*40} {'--------':>8}")
total_used = subtotal + pytorch_reserved + non_pytorch
print(f"  {'TOTAL GPU USED':<40s} {total_used:>8.2f}")
print(f"  {'GPU CAPACITY':<40s} {gpu_total:>8.2f}")
print(f"  {'FREE':<40s} {gpu_total - total_used:>8.2f}")

print()
print("=" * 65)
print("ROOT CAUSE")
print("=" * 65)
print()
print(f"gpu_util=0.92 gives {gpu_total*0.92:.2f} GiB budget")
print(f"Profiler thought non-KV needs: {model + cudagraph:.2f} GiB")
print(f"  -> left {gpu_total*0.92 - model - cudagraph:.2f} GiB for KV")
print(f"  -> profiler reported: {kv_budget:.2f} GiB available")
print()
print(f"BUT profiler missed {gap:.2f} GiB of KV overhead:")
print(f"  - int8 per-token-head scale factors")
print(f"  - block padding (6.25% waste from 3 extra layers)")
print(f"  - torch.compile artifacts")
print()
print(f"Actual total: {subtotal:.2f} GiB")
print(f"GPU capacity: {gpu_total:.2f} GiB")
print(f"Headroom:     {gpu_total - subtotal:.2f} GiB")
print(f"  minus pool reserved: {gpu_total - subtotal - pytorch_reserved:.2f} GiB")
print(f"  = ~{int((gpu_total - subtotal - pytorch_reserved)*1024)} MiB actual free")
print()
print(f"Dequant k_data.to(float32) needs 82 MiB")
print(f"Only {int(gpu_free*1024)} MiB available -> OOM")
print()
print(f"With gpu_util=0.88:")
budget_88 = gpu_total * 0.88
kv_88 = budget_88 - model - cudagraph
# With same overhead ratio: actual = kv_88 * (1 + 1.12/10.04)
actual_88 = model + kv_88 * (1 + 1.12/10.04) + cudagraph
headroom_88 = gpu_total - actual_88
print(f"  budget={budget_88:.2f} GiB, KV_budget={kv_88:.2f} GiB")
print(f"  actual usage ~{actual_88:.2f} GiB (same overhead ratio)")
print(f"  headroom ~{headroom_88:.2f} GiB = ~{int(headroom_88*1024)} MiB")
print(f"  minus pool reserved ~{int((headroom_88 - 0.47)*1024)} MiB")
print(f"  82 MiB dequant -> FITS with margin")
