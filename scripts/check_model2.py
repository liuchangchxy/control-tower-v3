import json
import os

# 1. Count actual self_attn vs linear_attn layers
idx = json.load(open('/home/chang/models/Qwen3.8-27B-GPTQ-Int4/model.safetensors.index.json'))
names = sorted(idx['weight_map'].keys())

self_attn_layers = set()
linear_attn_layers = set()
for n in names:
    parts = n.split('.')
    if 'layers' in parts:
        idx = parts.index('layers')
        if idx + 1 < len(parts):
            try:
                layer_num = int(parts[idx + 1])
                if 'self_attn' in n:
                    self_attn_layers.add(layer_num)
                if 'linear_attn' in n:
                    linear_attn_layers.add(layer_num)
            except ValueError:
                pass

print("=" * 60)
print("Qwen3.8-27B model architecture")
print("=" * 60)
print(f"Total layers: {len(self_attn_layers) + len(linear_attn_layers)}")
print(f"Self-attention layers (have KV cache): {len(self_attn_layers)}")
print(f"Linear-attention layers (no KV cache): {len(linear_attn_layers)}")
print(f"Self-attn layer indices: {sorted(self_attn_layers)}")
print()

# 2. Measure actual per-token KV cache size
# From log: 519,231 tokens in ~9.7 GiB KV pool
kv_pool_mib = 10271  # at gpu_util=0.88
kv_tokens = 519231
bytes_per_token_total = kv_pool_mib * 1024 * 1024 / kv_tokens
print(f"Per-token KV cache (measured): {bytes_per_token_total:.0f} bytes")
print(f"  = {len(self_attn_layers)} self_attn layers * num_kv_heads * head_dim * 2(K+V) * 1(int8)")
num_kv_heads_per_gpu = 2  # 4 total / TP=2
head_dim = 128
expected = len(self_attn_layers) * num_kv_heads_per_gpu * head_dim * 2 * 1
print(f"  Expected with {num_kv_heads_per_gpu} KV heads/GPU, {head_dim} dim: {expected} bytes")
print(f"  Match: {'YES' if abs(bytes_per_token_total - expected) < 100 else 'NO - need head_dim=' + str(int(bytes_per_token_total / (len(self_attn_layers) * num_kv_heads_per_gpu * 2)))}")
print()

# 3. Workspace calculation
PREFILL_MAX_SEQ_LEN = 131072
# workspace per layer: [seq_len, num_kv_heads, head_size] float32
ws_per_tensor = PREFILL_MAX_SEQ_LEN * num_kv_heads_per_gpu * head_dim * 4
ws_total = ws_per_tensor * 2  # k + v
print(f"int8kv prefill workspace:")
print(f"  PREFILL_MAX_SEQ_LEN = {PREFILL_MAX_SEQ_LEN}")
print(f"  k_workspace [{PREFILL_MAX_SEQ_LEN}, {num_kv_heads_per_gpu}, {head_dim}] float32")
print(f"  v_workspace [{PREFILL_MAX_SEQ_LEN}, {num_kv_heads_per_gpu}, {head_dim}] float32")
print(f"  Per tensor: {ws_per_tensor/(1024*1024):.0f} MiB")
print(f"  Total (k+v): {ws_total/(1024*1024):.0f} MiB")
print(f"  Allocated ONCE on first prefill, cached at module level, NEVER freed")
print(f"  NOT accounted for in vLLM memory profiler")
print()

# 4. The actual crash
print("=" * 60)
print("Crash analysis")
print("=" * 60)
print(f"gpu_util=0.92 budget: {22528*0.92:.0f} MiB")
print(f"Model weights: ~9513 MiB")
print(f"CUDA graph: ~41 MiB")
print(f"KV cache budget: {22528*0.92 - 9513 - 41:.0f} MiB")
print(f"Workspace (NOT in budget): {ws_total/(1024*1024):.0f} MiB")
print()
print(f"Total committed: {22528*0.92 + ws_total/(1024*1024):.0f} MiB")
print(f"GPU total: 22528 MiB")
print(f"Remaining: {22528 - 22528*0.92 - ws_total/(1024*1024):.0f} MiB")
print()
print("This 256 MiB workspace is the 'hidden' memory consumer")
print("that vLLM's memory profiler doesn't know about.")
