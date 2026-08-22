total = 22528  # MiB per 2080Ti

# Measured data
int4_model = 9513     # MiB per GPU
cudagraph = 41
bytes_per_token = 20741  # measured from 519231 tokens in 10271 MiB

# What the user actually uses
context_tokens = 256000

print("=" * 70)
print("Actual memory usage at 256K context (not full KV pool)")
print("=" * 70)
print()

for label, util, pool_tokens in [
    ("INT4/0.88", 0.88, 519231),
    ("INT4/0.92", 0.92, 566960),
    ("FP8/0.958", 0.958, 390123),
]:
    budget = total * util
    kv_pool = budget - int4_model - cudagraph
    free = total - budget - cudagraph

    # Actual KV usage at 256K tokens
    kv_used = context_tokens * bytes_per_token / (1024 * 1024)
    kv_wasted = kv_pool - kv_used
    steady = int4_model + kv_used + cudagraph  # actual used, not pool
    actual_free = total - steady

    print(f"  {label}:")
    print(f"    GPU budget:      {budget:>8.0f} MiB (gpu_util={util})")
    print(f"    Model weights:   {int4_model:>8} MiB")
    print(f"    KV pool reserved:{kv_pool:>8.0f} MiB ({pool_tokens:,} tokens capacity)")
    print(f"    KV actually used:{kv_used:>8.0f} MiB (256K tokens)")
    print(f"    KV wasted:       {kv_wasted:>8.0f} MiB (reserved but empty)")
    print(f"    Free (budget):   {free:>8.0f} MiB (outside PyTorch pool)")
    print(f"    Free (actual):   {actual_free:>8.0f} MiB (if pool weren't over-reserved)")
    print()

print("=" * 70)
print("The REAL problem")
print("=" * 70)
print()
print("The 567K-token KV pool is PRE-ALLOCATED at startup by PyTorch.")
print("Even though you only use 256K, the full pool is reserved in VRAM.")
print("PyTorch's cudaMalloc reserves the pool -> nvidia-smi shows it as 'used'.")
print()
print("The int8kv dequant buffer (82 MiB) is allocated OUTSIDE the pool")
print("via a separate cudaMalloc call. It competes for the 'free' space")
print("that nvidia-smi reports.")
print()
print("At 0.92: free = 1,761 MiB. After fragmentation -> only 66 MiB contiguous.")
print("At 0.88: free = 2,662 MiB. After fragmentation -> ~1,200 MiB contiguous.")
print()
print("So even though 256K tokens only uses ~5 GiB of the 11 GiB pool,")
print("the WASTED 6 GiB is locked in PyTorch's pool and unavailable")
print("for the dequant cudaMalloc.")
