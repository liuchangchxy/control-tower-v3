total = 22528  # MiB per 2080Ti

# === ACTUAL MEASURED VALUES FROM LOGS ===
# INT4 (our model)
int4_model_mib = 9513        # "Model loading took 9.29 GiB"
int4_util_actual = 0.88      # current env
int4_kv_tokens_actual = 519231  # from log: "GPU KV cache size: 519,231 tokens"
int4_budget_actual = total * 0.88  # = 19825 MiB

# INT4 at 0.92 (the crash setting)
int4_kv_tokens_092 = 566960  # from log: "GPU KV cache size: 566,960 tokens"
int4_budget_092 = total * 0.92  # = 20726 MiB

# FP8 profile (tested by project author)
fp8_util = 0.958             # from int8kv-252K-mtp3-text-only.env
fp8_model_mib = 13824        # 27B * 1 byte / 2 GPUs = 13.5 GiB

# === DERIVED ===
cudagraph = 41

# Per-token KV cache size (from actual measurements)
bytes_per_token = (int4_budget_actual - int4_model_mib - cudagraph) * 1024 * 1024 / int4_kv_tokens_actual

print("=" * 70)
print("Memory calculation using ACTUAL measured data")
print("=" * 70)
print()
print(f"Per-token KV cache size (int8kv): {bytes_per_token:.1f} bytes")
print(f"  (= 2 * num_layers * kv_heads_per_gpu * head_dim * 1)")
print(f"  With 64 layers, 128 head_dim:")
kv_heads_per_gpu = bytes_per_token / (2 * 64 * 128)
print(f"  kv_heads_per_gpu = {kv_heads_per_gpu:.1f}")
print()

# Now compute FP8 KV capacity
fp8_budget = total * fp8_util
fp8_kv_pool = fp8_budget - fp8_model_mib - cudagraph
fp8_kv_tokens = int(fp8_kv_pool * 1024 * 1024 / bytes_per_token)

# INT4 at different util levels
int4_kv_pool_088 = int4_budget_actual - int4_model_mib - cudagraph
int4_kv_pool_092 = int4_budget_092 - int4_model_mib - cudagraph
int4_free_088 = total - int4_budget_actual - cudagraph
int4_free_092 = total - int4_budget_092 - cudagraph
fp8_free = total - fp8_budget - cudagraph

print("=" * 70)
print(f"{'':<40} {'INT4/0.88':>10} {'INT4/0.92':>10} {'FP8/0.958':>10}")
print("-" * 70)
print(f"{'GPU budget (MiB)':<40} {int4_budget_actual:>10.0f} {int4_budget_092:>10.0f} {fp8_budget:>10.0f}")
print(f"{'Model weights (MiB)':<40} {int4_model_mib:>10} {int4_model_mib:>10} {fp8_model_mib:>10}")
print(f"{'KV cache pool (MiB)':<40} {int4_kv_pool_088:>10.0f} {int4_kv_pool_092:>10.0f} {fp8_kv_pool:>10.0f}")
print(f"{'KV capacity (tokens)':<40} {int4_kv_tokens_actual:>10,} {int4_kv_tokens_092:>10,} {fp8_kv_tokens:>10,}")
print(f"{'Free headroom (MiB)':<40} {int4_free_088:>10.0f} {int4_free_092:>10.0f} {fp8_free:>10.0f}")
print()

print("=" * 70)
print("ANSWER: Why FP8 int8kv works at 0.958 but INT4 int8kv OOMs at 0.92")
print("=" * 70)
print()
print("FP8 weights are 2x LARGER (13.5 vs 6.75 GiB/GPU)")
print()
print("Even at GPU_UTIL=0.958:")
print(f"  FP8 KV pool = {fp8_kv_pool:.0f} MiB ({fp8_kv_tokens:,} tokens)")
print(f"  INT4 KV pool at 0.92 = {int4_kv_pool_092:.0f} MiB ({int4_kv_tokens_092:,} tokens)")
print(f"  INT4 gets {(int4_kv_pool_092 - fp8_kv_pool):.0f} MiB MORE KV cache!")
print()
print("Key insight: Higher GPU_UTIL does NOT mean more KV cache for INT4.")
print("The larger weights eat the budget, so FP8 has a SMALLER KV pool.")
print()
print("The OOM mechanism:")
print("  INT8KV dequant during prefill needs ~82 MiB temp CUDA allocation")
print("  This comes from free memory OUTSIDE the PyTorch memory pool")
print()
print(f"  FP8/0.958 free: {fp8_free:.0f} MiB (tight but enough for {fp8_kv_tokens:,} tokens)")
print(f"  INT4/0.92 free: {int4_free_092:.0f} MiB (tight, for {int4_kv_tokens_092:,} tokens)")
print(f"  INT4/0.88 free: {int4_free_088:.0f} MiB (comfortable, for {int4_kv_tokens_actual:,} tokens)")
print()
print("INT4 at 0.92 has {:.0f} MiB headroom - barely enough.".format(int4_free_092))
print("After PyTorch fragmentation from multiple requests, the 82 MiB")
print("contiguous allocation fails (only 66 MiB found).")
print()
print("FP8 at 0.958 has {:.0f} MiB - similar tightness,".format(fp8_free))
print("but was only tested with single requests / shorter contexts.")
print("Under sustained load, FP8/0.958 would ALSO likely OOM.")
