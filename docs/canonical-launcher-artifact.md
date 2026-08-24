# Canonical launcher deployment artifact

- Host: `debian103`
- Launcher: `/home/chang/vLLM-2080Ti-Definitive-0.2.1-pre2/launcher.sh`
- Launcher revision reported to Tower: `vllm-2080ti-definitive-0.2.1-pre2`
- Launcher SHA-256 (after capability/handoff patch): `b84884ff3536f038d16118296694cb3520ecdc219fd9ac968074d1573590966e`
- FlashQLA artifact: `.deps/FlashQLA-SM70-SM75/.torch_extensions_vllm_flashqla_legacy/flash_qla_legacy_gdn/flash_qla_legacy_gdn.so`
- Runtime evidence: `Using FlashQLA legacy SM70/SM75 GDN prefill kernel`

The launcher patch is intentionally recorded separately from Control Tower. Tower only consumes the versioned handoff and launcher-owned log evidence.
