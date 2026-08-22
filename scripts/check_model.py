import json
idx = json.load(open('/home/chang/models/Qwen3.8-27B-GPTQ-Int4/model.safetensors.index.json'))
names = sorted(idx['weight_map'].keys())

linear_attn_layers = set()
self_attn_layers = set()
for n in names:
    if 'linear_attn' in n:
        layer_num = int(n.split('.')[3])
        linear_attn_layers.add(layer_num)
    if 'self_attn' in n:
        layer_num = int(n.split('.')[3])
        self_attn_layers.add(layer_num)

print(f"Total layers with linear_attn: {len(linear_attn_layers)}")
print(f"Total layers with self_attn: {len(self_attn_layers)}")
print(f"Layer numbers with self_attn: {sorted(self_attn_layers)}")
print()

self_attn_weights = [n for n in names if 'self_attn' in n]
print("self_attn weight names (first layer):")
for n in self_attn_weights[:20]:
    if '.0.' in n:
        print(f"  {n}")

print()
# Find k_proj shape
from safetensors import safe_open
for shard in ['model-00001-of-00005.safetensors', 'model-00002-of-00005.safetensors']:
    f = f'/home/chang/models/Qwen3.8-27B-GPTQ-Int4/{shard}'
    try:
        with safe_open(f, framework='pt') as sf:
            for k in sf.keys():
                if 'self_attn' in k and ('k_proj' in k or 'q_proj' in k):
                    t = sf.get_tensor(k)
                    print(f'{k}: shape={list(t.shape)} dtype={t.dtype}')
                    break
    except:
        pass
