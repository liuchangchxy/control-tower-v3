# Control Tower v3 — Brainstorm 问清楚的东西

**日期:** 2026-08-21
**状态:** 完成

---

## 你的硬件

- 双 RTX 2080Ti 22GB + NVLink（魔改版硬件）
- debian103 Linux 主机
- 浏览器 + SSH 远程操作（不在机器旁边）

## 你的项目

- vLLM 2080Ti Definitive Edition（v0.21.0 fork，硬件定制版）
- 单并发极致性能，27B/35B 模型
- 专门针对 2080Ti 优化（int8kv / MTP / CUDAGraph / FlashQLA）
- 不是多租户，是个人 agent 风格

## 你的工作方式

- 浏览器访问 UI，SSH 只用于启动服务
- 手动调参 → 重启 vLLM → benchmark 看结果 → 再调参 → 循环
- 调参范围非常灵活，20+ 参数全可调（GPU_UTIL / MAX_MODEL_LEN / MTP_K / KV_CACHE_DTYPE / MAX_NUM_SEQS / enable_prefix_caching / cudagraph_mode / int8kv 细节参数等）
- 保存为 .env profile 文件
- 目前有 18 个已测 profile

## 你要的系统

**一句话：完全控制 vLLM-2080Ti-Definitive 项目后端的 UI**

## 已确认的功能需求

### 1. Profile 管理

- 表单编辑（不是代码编辑器），下拉/输入框
- 20+ 参数全可调
- 每个参数有默认值，不改就用默认
- 保存为 .env 文件到 user/ 目录
- Profile diff（两个 profile 对比，高亮差异字段）
- Dry-run（检查参数合法性不启动）
- 一键回滚到上次成功的 profile

### 2. 批量轮换对比

- 自由选择多个 profile（不限数量，3个到20个都可能）
- 程序自动依次：启动 vLLM → 跑 benchmark → 记录结果 → 切换下一个
- 全自动，不需要手动干预
- vLLM 一次只能跑一个模型（换配置 = 重启 vLLM）
- 结果展示：表格 + 柱状图
- 表格所有参数都显示，可以拖动列顺序，顺序记忆持久化

### 3. vLLM 内部状态监控

- /metrics 接入
- KV cache 占用率（百分比 + 已用/总）
- KV cache 满预警（>85% 警告）
- 活跃请求数 / 等待队列
- prefill tok/s / generation tok/s
- 请求延迟分位数（p50/p99）
- TTFT（首 token 延迟）
- SSE 实时推前端

### 4. 简单 Chat

- 纯聊天界面（输入框 + 流式回复）
- 显示首字延迟 + tok/s
- 更专业的功能在 benchmark 里做
- 不做复杂功能（不做 tool calling、不做 history管理、不做采样参数控制）

### 5. Benchmark 面板

- 3档 prompt（短 17 tok / 中 313 tok / 长 3212 tok）
- 显示：tok/s、首 token 延迟、总耗时、prompt tok、gen tok
- 跑分历史

### 6. 启动错误分析 + 修复建议

- OOM → 建议 GPU_UTIL 降到 X
- CUDA error → 显示错误上下文 50 行
- Workspace 分配失败 → 建议关 int8kv prefill
- 端口冲突 → 列出占用进程
- 一键"Apply Fix"写入新 profile

### 7. GPU 硬件监控

- Throttle reasons（HW_SLOWDOWN / SW_THERMAL / SYNC_BOOST 等）
- Display mode 检测（双卡是否被 display 占用）
- 双卡负载并排对比

### 8. 实验记录

- 每次运行记录：profile 配置 + benchmark 结果 + 启动耗时
- 持久化存储
- 可回溯历史

### 9. 日志增强

- 全文搜索（Ctrl+F）
- 跳到错误（一键定位 OOM/CUDA 错误行）
- 下载完整日志

### 10. 进程管理

- 端口 9090（替代旧 tower）
- Restart 端点（stop + start 一调用）
- 启动进度条（已有 7 阶段）

### 11. UX 反馈

- Toast 通知（启动完成/失败、OOM、benchmark 完成、KV满预警）
- Loading overlay（启动中全屏提示）
- 状态变化高亮（temp >80 闪红、KV >85% 闪黄）

---

## 问清楚的决策

| 问题 | 回答 |
|------|------|
| 端口 | 9090（替代旧 tower） |
| 认证 | 不需要（单用户 LAN） |
| 聊天 | 简单 chat + 首字延迟 + tok/s |
| 参数范围 | 20+ 全可调 |
| 调参目标 | 不 OOM + 更快吞吐 |
| 并发 | 单用户单模型 |
| GPU | 双 2080Ti 22GB + NVLink |
| Profile 触底 | 表单编辑，有默认值 |
| 批量对比 | 自由选多个，全自动轮换 |
| 结果展示 | 表格（列可拖动排序）+ 柱状图 |
| Benchmark | 3 档 prompt，自动测吞吐 |
| Playground | 移除，control-tower 替代 |
| 后端技术栈 | Node.js（已有 v2 代码） |
| 前端技术栈 | React + Vite + Tailwind（已有） |
| 部署方式 | debian103，node 进程 |
| Benchmark prompt 档位 | 3档全跑（短17/中313/长3212 tok） |
| Benchmark 轮数 | 可选轮数（1/3/5/10 次） |
| vLLM 挂了 | 通知手动决定（不自动重启） |
| Sleep Mode | 不用，只用重启 |
| 切换模型 | 全部重启（约5 分钟，有缓存约 3.5 分钟） |
| TP/PP 固定 | 双 2080Ti TP=2，不可改 |
| 重启等待 | 约5 分钟（有 torch.compile 缓存约 3.5 分钟） |
| 模型加载 | ~3 分钟（19.54 GiB, 6 个 safetensor shards） |
| torch.compile | ~30 秒（有缓存时从缓存加载） |
| CUDA graph | ~1 秒（PIECEWISE 模式，capture_sizes=[4]） |
| KV cache | 607,812 tokens（256K 上下文，最大并发 2.37x） |

---

## Brainstorm 总结（问清楚的所有东西）

### 硬件与项目

- 双 2080Ti 22GB + NVLink，魔改版硬件
- vLLM 2080Ti Definitive Edition (v0.21.0 fork)
- 单并发极致性能，27B/35B 模型
- 浏览器 + SSH 远程操作

### 核心需求

- **完全控制 vLLM-2080Ti-Definitive 项目后端的 UI**
- Profile 管理 + 批量轮换对比 + 实时监控 + 测试诊断
- 替代 vLLM Playground（移除）

### 12 个功能（全部重要）

1. **Profile 表单编辑**（18 个参数，分组平铺，下拉/输入框，默认值）
2. **批量轮换对比**（自由选多个 profile → 自动依次启动 → benchmark → 表格+柱状图+折线图）
3. **vLLM /metrics 实时监控**（KV cache / 队列 / tok/s / TTFT / latency）
4. **简单 Chat**（首字延迟 + tok/s）
5. **Benchmark 面板**（手动 + 批量，3档 prompt，可选轮数）
6. **启动错误分析 + 修复建议**（OOM/CUDA/端口 → 具体改哪个参数）
7. **GPU 硬件监控**（throttle reasons + display mode + 双卡对比）
8. **实验记录**（时间线 + 表格，持久化）
9. **日志增强**（全文搜索/跳到错误/下载/折叠）
10. **Restart 端点 + 端口 9090**
11. **Toast 通知**（4 种：成功/错误/警告/信息，右上角）
12. **Profile diff / dry-run / 回滚**

### UI 布局

- 侧边栏（5 项：Dashboard / Profiles / Benchmark / Logs / Settings）
- 右侧动态内容区
- Profile 表单分组平铺（核心/高级分组）
- 日志带折叠
- Settings 全部可编辑

### 技术决策

- 端口 9090（替代旧 tower）
- 不用 Sleep Mode，只用重启（约5 分钟）
- 直调 vLLM API（不通过 launcher wrapper）
- v2 架构为基础，吸收 v1/v2 精华
- 全部做完再部署
- 不需要 auth、swagger、mobile、playground 集成

### 已查清楚的技术细节

- vLLM /metrics Prometheus 字段（12 个核心指标）
- 18 个可调参数（6 核心 + 12 高级）
- 启动时间约5 分钟（有缓存约 3.5 分钟）
- KV cache 607,812 tokens（256K 上下文，最大并发 2.37x）

---

## 升维问题（已问清楚）

### 工具本质

- **配置优化工作台** + **运行控制台**（两者合一）
- 完全替代 vLLM Playground
- 核心价值：可视化控制特定 vLLM 版本 + 特定硬件，找最优配置

### 工作流

- **循环流程**：调参 → 测试 → 再调参 → 再测试
- **半自动**：用户选参数范围 → 程序跑 → 用户看结果 → 再选范围
- **数据驱动**：工具给数据，用户做决策
- **迭代优化**：不断缩小搜索范围，逼近最优

### 搜索方式

- **手动选候选**：用户选几个 profile，跑 benchmark 对比
- **自动网格搜索**：基于默认 profile，选参数+值，生成所有组合
- **默认 profile**：int8kv-256K-nomtp-text-only
- **所有参数都可选**：完全自由定义搜索空间
- **跑完就停**：没有提前停止条件

### 数据展示

- **原始数据**：表格，所有数字
- **可视化**：图表，趋势
- **两者都要**

### 架构

- **实时同步**：vLLM 状态 SSE 推送到 UI
- **代理模式**：前端 → control-tower 后端 → vLLM API
- **后端做业务逻辑**：profile 管理、benchmark、实验记录、状态管理

### 部署

- 全部做完再部署
- 不需要 auth、swagger、mobile、playground 集成

### vLLM /metrics Prometheus 字段（已确认）

**核心指标：**
- `vllm:num_requests_running` — 活跃请求数
- `vllm:num_requests_waiting` — 等待队列
- `vllm:kv_cache_usage_perc` — KV cache 占用率（0-1）
- `vllm:prompt_tokens` — 累计 prefill token 数
- `vllm:generation_tokens` — 累计 generation token 数
- `vllm:time_to_first_token_seconds` — TTFT 直方图（p50/p90/p99）
- `vllm:inter_token_latency_seconds` — token 间延迟直方图
- `vllm:e2e_request_latency_seconds` — 端到端请求延迟直方图
- `vllm:prefix_cache_hits` / `vllm:prefix_cache_queries` — prefix cache 命中率
- `vllm:num_preemptions` — 累计抢占次数
- `vllm:engine_sleep_state` — 睡眠状态

**从这些字段计算：**
- tok/s = delta(prompt_tokens + generation_tokens) / delta(time)
- TTFT p99 = 从直方图 bucket 计算
- KV cache 满预警 = kv_cache_usage_perc > 0.85

### 现有 .env 参数（已确认，**65 个可配置**）

launcher.sh 有 65 个可配置参数（31 个 ROUTE_PROFILE_KEYS + 34 个 NON_INTERACTIVE_CONFIG_KEYS）。

文档之前列出的 18 个只是 .env 文件里常用的子集。

**常用参数（18 个）：**

| 参数 | 类型 | 说明 | 核心/高级 |
|------|------|------|-----------|
| SERVED_NAME | string | 模型服务名 | 元数据 |
| COMPATIBLE_MODES | string | 兼容模式 | 元数据 |
| MODEL_FAMILY | string | 模型家族 | 元数据 |
| PROFILE_GROUP | string | 配置组 | 元数据 |
| MODEL_VARIANT | string | 量化方式 | 元数据 |
| KV_CACHE_DTYPE | string | KV cache 数据类型 | **核心** |
| MAX_MODEL_LEN | number | 最大上下文长度 | **核心** |
| GPU_UTIL | number | GPU 内存利用率 | **核心** |
| MAX_BATCHED_TOKENS | number | 最大批处理 token 数 | **核心** |
| MAX_NUM_SEQS | number | 最大并发序列数 | **核心** |
| MTP_K | number | MTP speculative steps | **核心** |
| LANGUAGE_MODEL_ONLY | 0/1 | 只用语言模型 | 高级（固定1） |
| SKIP_MM_PROFILING | 0/1 | 跳过多模态 profiling | 高级（固定1） |
| VLLM_INT8KV_FA_PREFILL | 0/1 | int8kv fast attention prefill | 高级 |
| VLLM_INT8KV_FA_CONTINUATION_DEQUANT | 0/1 | int8kv continuation dequant | 高级 |
| VLLM_INT8KV_FA_CASCADE_DEQUANT | 0/1 | int8kv cascade dequant | 高级 |
| VLLM_INT8KV_FA_CASCADE_TILE_TOKENS | number | int8kv cascade tile tokens | 高级 |
| COMPILATION_CONFIG_JSON | JSON string | 编译配置 | 高级 |

**其他参数（47 个）：** 包括 MODEL_DIR, PORT, TP_SIZE, REASONING_PARSER, ENABLE_AUTO_TOOL_CHOICE, TOOL_CALL_PARSER, ENABLE_PREFIX_CACHING, ENFORCE_EAGER, VLLM_SM75_SPEC_SYNC_MODE 等。

### 启动时间分解（已确认，从日志实测）

```
08:09:38  启动 vLLM 进程
08:10:05  引擎初始化完成（27秒）
08:10:17  开始加载模型
08:13:22  模型加载完成（183秒，约3分钟）
08:14:27  torch.compile 完成（30秒，有缓存时从缓存加载）
08:14:36  CUDA graph capture 完成（1秒）
08:14:36  引擎就绪

总计：约5 分钟（有 torch.compile 缓存约 3.5 分钟）
```

---

## 漏掉的问题（已问清楚）

### 批量轮换

- 错误处理：记录错误，继续跑下一个
- 进度显示：显示进度条（7 阶段）
- 完成通知：浏览器通知 + UI 状态

### Benchmark

- Prompt：固定 3 档 + 可自定义
- 预热：先跑 1-2 次预热，再正式跑
- 轮数：可选（1/3/5/10 次）

### Profile

- 命名：自动生成（基于参数）+ 可手动修改
- 默认模板：int8kv-256K-nomtp-text-only
- 搜索空间：所有参数都可选，完全自由定义

### 结果

- 导出：能导出 CSV/JSON + 能复制到剪贴板
- 展示：表格 + 柱状图 + 折线图
- 保存：自动保存到实验记录

### 日志

- 管理：手动管理（不自动清理）
- 增强：全文搜索/跳到错误/下载/折叠

### GPU

- 碎片化：自动检测并提示
- 监控：throttle reasons + display mode + 双卡对比

---

## Launcher.sh 评估（已决策）

### 决策：替代 launcher.sh

v3 直接管理 vLLM 进程，不包装 launcher.sh。

### 理由

1. v3 需要完全控制日志解析（错误分析、进度条）
2. v3 需要完全控制进程生命周期（批量轮换）
3. Display GPU 警告和 KV cache 监控可以在 Node.js 中重新实现
4. 配置注册表用 TypeScript 类型系统替代（更安全）

### 需要重新实现的功能

- Display GPU 警告（检测 Xorg/gnome-shell 等进程占用 GPU）
- KV cache 监控（从 vLLM /metrics 获取，不需要从日志解析）
- 配置注册表（用 TypeScript 接口定义）

### v1/v2 精华吸收

| 功能 | v1 | v2 | v3 需要 |
|------|----|----|---------|
| pynvml GPU 监控（throttle/display） | ✅ | ❌ | ✅ |
| 启动 watchdog | ✅ | ❌ | ✅ |
| Worker 清理 | ✅ | ❌ | ✅ |
| Benchmark 面板 | ✅ | ❌ | ✅ |
| Profile CRUD | ❌ | ✅ | ✅ |
| 7阶段进度条 | ❌ | ✅ | ✅ |
| 状态恢复 | ❌ | ✅ | ✅ |

---

## PCIe 状态（已查明原因）

### 当前状态（重启后）

| GPU | 型号 | 当前 Gen | 最大 Gen | 当前宽度 | 最大宽度 |
|-----|------|----------|----------|----------|----------|
| 0 | RTX 2080 Ti | Gen1 | Gen3 | x8 | x16 |
| 1 | RTX 2080 Ti | Gen1 | Gen3 | x16 | x16 |

### 根本原因

**驱动禁用了 Gen3：**
```
EnablePCIeGen3: 0
```

nvidia 驱动参数 `EnablePCIeGen3=0` 表示 Gen3 被显式禁用。不管 BIOS 怎么设，驱动都不让用 Gen3。

### 需要做的

1. 启用 Gen3：`sudo modprobe nvidia NVreg_EnablePCIeGen3=1`
2. 或者在 `/etc/modprobe.d/nvidia.conf` 中添加 `options nvidia NVreg_EnablePCIeGen3=1`
3. GPU 0 宽度 x8（可能是物理插槽限制，需要检查主板）

### 影响

- Gen1 带宽：~8 GB/s（x16）或 ~4 GB/s（x8）
- Gen3 带宽：~16 GB/s（x16）或 ~8 GB/s（x8）
- 模型加载时 CPU→GPU 数据传输会慢 2-4 倍
- vLLM 运行时 PCIe 不是瓶颈（NVLink 用于 GPU 间通信）

---

## Brainstorm 最终总结

### 工具定位

**vLLM 配置优化工作台 + 运行控制台，完全替代 Playground**

### 核心工作流

```
选参数 → 启动 vLLM → benchmark → 看数据 → 调参 → 循环
```

半自动：用户选参数范围，程序跑，用户看结果，再选范围。

### 12 个功能（全部重要）

1. **Profile 表单编辑**（18 个参数，分组平铺，下拉/输入框，默认值）
2. **批量轮换对比**（自由选多个 profile → 自动依次启动 → benchmark → 表格+柱状图+折线图）
3. **vLLM /metrics 实时监控**（KV cache / 队列 / tok/s / TTFT / latency）
4. **简单 Chat**（首字延迟 + tok/s）
5. **Benchmark 面板**（手动 + 批量，3档 prompt，可选轮数）
6. **启动错误分析 + 修复建议**（OOM/CUDA/端口 → 具体改哪个参数）
7. **GPU 硬件监控**（throttle reasons + display mode + 双卡对比）
8. **实验记录**（时间线 + 表格，持久化）
9. **日志增强**（全文搜索/跳到错误/下载/折叠）
10. **Restart 端点 + 端口 9090**
11. **Toast 通知**（4 种：成功/错误/警告/信息，右上角）
12. **Profile diff / dry-run / 回滚**

### UI 布局

- 侧边栏（5 项：Dashboard / Profiles / Benchmark / Logs / Settings）
- 右侧动态内容区
- Profile 表单分组平铺（核心/高级分组）
- 日志带折叠
- Settings 全部可编辑

### 技术决策

| 决策 | 选择 | 理由 |
|------|------|------|
| 端口 | 9090（替代旧 tower） | 替代 v1 |
| Launcher | 替代 launcher.sh | 完全控制日志/进程 |
| vLLM 通信 | 直调 API | 不通过 launcher wrapper |
| 架构基础 | v2 代码 | 吸收 v1/v2 精华 |
| 部署策略 | 全部做完再部署 | 一次性交付 |
| vLLM 版本 | 只支持当前 fork | 简化设计 |
| 认证 | 不需要 | 单用户 LAN |
| Playground | 移除 | v3 替代 |

### 搜索与优化

- **搜索方式**：手动选候选 + 自动网格搜索
- **默认 profile**：int8kv-256K-nomtp-text-only
- **搜索空间**：所有参数可选，完全自由定义
- **停止条件**：跑完就停
- **结果展示**：表格 + 柱状图 + 折线图
- **结果导出**：CSV/JSON + 剪贴板

### 批量轮换

- 错误处理：记录错误，继续跑下一个
- 进度显示：进度条（7 阶段）
- 完成通知：浏览器通知 + UI 状态
- 预热：先跑 1-2 次预热

### 数据展示

- **原始数据**：表格，所有数字
- **可视化**：图表，趋势
- **两者都要**

### 架构

- **实时同步**：vLLM 状态 SSE 推送到 UI
- **代理模式**：前端 → control-tower 后端 → vLLM API
- **后端做业务逻辑**：profile 管理、benchmark、实验记录、状态管理

### 已查清楚的技术细节

- vLLM /metrics Prometheus 字段（12 个核心指标）
- 18 个可调参数（6 核心 + 12 高级）
- 启动时间约5 分钟（有缓存约 3.5 分钟）
- KV cache 607,812 tokens（256K 上下文，最大并发 2.37x）
- 硬件：双 2080Ti 22GB + NVLink，CMP 50HX 不参与，**Gen3 未启用**（需要手动启用）

---

## 冲突和遗漏处理（已解决）

| 问题 | 决策 |
|------|------|
| PCIe 状态 | Gen3 未启用，需要手动启用 |
| 参数数量 | 65 个（不是 18 个） |
| Sleep Mode | 删除（不用的功能） |
| vLLM 启动 | 学习 launcher.sh 后用 Node.js 重新实现 |
| vLLM 就绪检测 | AI 自行决定 |
| GPU 碎片化检测 | AI 自行决定 |
| Display GPU 警告 | 必须实现 |
| Benchmark 预热 | AI 自行决定 |
| Profile 命名 | AI 自行决定 |
| 批量轮换错误记录 | AI 自行决定 |

**Brainstorm 完成。**
