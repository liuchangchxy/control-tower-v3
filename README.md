# Control Tower v3

vLLM 配置优化工作台 + 运行时控制台。专为双 RTX 2080Ti 22GB + NVLink 设计。

## 功能

- **一键启停** — vLLM 服务启动/停止/重启/Kill/回滚，带实时进度条
- **Profile 管理** — 65 个参数分组编辑，.env 预览，验证，diff 对比
- **GPU 硬件监控** — 双卡温度/功耗/利用率/VRAM，throttle reasons，双卡对比
- **实时 Metrics** — vLLM /metrics Prometheus 解析，KV Cache / TTFT / TPOT / throughput
- **Benchmark** — 5 档 preset（quick/chat/summary/longgen/stress），TTFT/TPOT/ITL p50/p90/p99
- **批量轮换对比** — 选多 profile → 自动启停 → benchmark → 图表对比 → CSV/JSON 导出
- **Chat** — 流式对话，实时显示 TTFT + tok/s
- **实验记录** — 每次启动/benchmark 自动持久化，表格 + 时间线视图
- **日志增强** — 全文搜索(Ctrl+F)，跳转错误，下载，stage 折叠
- **错误诊断** — OOM/CUDA/port 冲突自动分析，一键修复建议
- **Toast 通知** — 全局 Context，启动完成/失败、benchmark 完成、KV Cache 预警

## 架构

```
server/              Express + TypeScript 后端 (port 9092)
  routes/            API 路由 (/api/server, /api/gpu, /api/benchmark, ...)
  services/          核心服务 (processManager, gpuMonitor, benchmark, ...)
client/              React + Vite + Tailwind CSS 前端
  src/
    components/      UI 组件
    hooks/           React hooks (useGPU, useMetrics, useSSE, ...)
    pages/           页面 (Dashboard, Benchmark, Chat, Experiments, ...)
    lib/             工具函数
tests/               单元测试 + E2E 测试
```

## 开发

```bash
npm install
cd client && npm install && cd ..

# 开发模式（前后端热重载）
npm run dev

# 构建
npm run build

# 生产运行
npm start
```

## 部署到 debian103

```bash
# 从本地同步到远程
./deploy.sh

# 或手动：
rsync -avz --exclude node_modules --exclude dist --exclude .git \
  ./ debian103:/home/chang/control-tower-v3/
ssh debian103 "cd /home/chang/control-tower-v3 && npm run build && \
  pkill -f 'node dist/server' ; nohup node dist/server/index.js &"
```

## vLLM 要求

- vLLM 2080Ti Definitive Edition (v0.21.0 fork)
- Python venv: `~/vLLM-2080Ti-Definitive/.venv/bin/python3`
- 双 RTX 2080Ti 22GB + NVLink, TP=2

## License

MIT
