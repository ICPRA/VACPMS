# VACPMS

**可视化 Agent 协作项目管理系统** —— 一个本机工作台：规格以节点形式存在于可查询的图中，工作被派发到真实的 AI 会话里执行，交付锚定在真实的 Git 提交上，人与多个 Agent 在同一套契约下协作。

[English](README.md) | [简体中文](README.zh-CN.md)

> 状态：活跃开发中。31 项规划能力中 26 项源码已实现；正式节点合并（F27）与最终完整检查（F28）待完成。尚无安装包，未做总体验收。逐项功能状态以 [REQUIREMENTS-REVIEW.md](REQUIREMENTS-REVIEW.md) 为准。

## 能做什么

- **规格图即项目计划** —— 需求与工作项是带意图、阶段、版本、依赖和具名决定的节点；可创建草稿、批准后进入执行、拆分或（正式）合并，并可追溯每个决定的来源。
- **派发到原生 AI 会话** —— 节点经准备后派发进真实的 T3 Code 会话，模型与工作区由你审核确认。准备是幂等的：结果未知时按原命令身份恢复而不是悄悄重试；停止须人工确认后才解除写入责任。
- **交付锚定 Git** —— Git 是文件、提交、diff、合并与回退的唯一所有者。交付引用真实提交，评审比较固定双端提交；系统不复制提交图，也不给归属不明的改动猜测作者。
- **程序节点与有界循环** —— 机械/创新循环带次数上限、明确的通过/未知/失败结果、具名满意判断，预算耗尽即转人工。
- **Agent 邮件** —— 节点间以绑定身份的邮件协作：发送、回复、转发、确认、关闭、移交与退场接管。转邮件负责人不等于转任务执行者。
- **不偷调模型的知识检索** —— 同一入口搜索规格、文件与历史对话，按来源组呈现命中原因；普通搜索绝不调用模型，只有明确的"向 AI 提问"动作才会打开原生对话草稿。
- **中英双语界面**。

核心分工原则：语义判断（需求合理性、相关性、满意度、合并策略）归对话中的 LLM 或人；程序只提供原来源、真实身份、结构化记录、授权操作和必要的并发/预算检查——不建设冒充语义裁决的引擎。

## 仓库结构

VACPMS 由三个必须并列放在同一父目录下的兄弟仓库组成：

| 仓库 | 角色 | 许可证 |
|---|---|---|
| `project-workbench`（本仓库） | 产品文档、工作台扩展（`@project-workbench/ui`、`@project-workbench/mail`、桌面 stdio 桥）、启动脚本、`kimi-cursor-shim` | Apache-2.0 |
| `specgraph-src` | [specgraph/specgraph](https://github.com/specgraph/specgraph) 的 fork —— `workbench` 分支承载后端子系统（Go + PostgreSQL）：程序循环、派单、知识、邮件、交付钩子 | Apache-2.0（见其 `FORK-NOTICE.md`） |
| `t3code-git` | [pingdotgg/t3code](https://github.com/pingdotgg/t3code) 的 fork —— `workbench` 分支承载工作台页面、i18n、桌面 IPC 桥与服务端钩子 | 上游许可证 |

两个 fork 持续跟踪上游并定期 rebase；定制各自收在单个 `workbench` 分支上。本仓库的 `desktop-runtime.json` 用相对路径把三个检出绑定在一起。

## 运行（当前开发环境）

目前目标平台是 Windows，需要 PostgreSQL 17、Go、Node.js + pnpm（vite-plus）。

```bat
:: 先从 specgraph fork 构建后端候选程序，然后在本仓库：
start-workbench-stack.bat   :: 自守护 specgraph（:8690）与 vite 客户端（:5733）
launch-t3-workbench.bat     :: 以定制客户端启动 T3 Code
```

`launch-vacpms.bat` 是另一个入口：直接运行构建出的源码桌面端（不需要 vite dev server）。确切契约见 `extensions/workbench-desktop/README.md`。

## 开发

- 后端改动：`specgraph-src` 的 `workbench` 分支；`go build ./...`，按需跑聚焦的 `go test`（依赖 PostgreSQL 的测试在缺少环境变量时自动跳过）。
- 宿主改动：`t3code-git` 的 `workbench` 分支；`pnpm install`、`pnpm run typecheck`、聚焦的 `vp test`。
- 动过宿主集成点后，运行 `node extensions/workbench-ui/check-host.mjs <t3code 检出路径>` 验证集成标记仍在。
- `extensions/workbench-ui/t3-workbench-host.patch` 是 68 个专属宿主文件的再生成快照；git 分支才是权威历史。

## 文档

- [PRODUCT-DESIGN.md](PRODUCT-DESIGN.md) —— 业务合同与设计决定
- [REQUIREMENTS-REVIEW.md](REQUIREMENTS-REVIEW.md) —— 逐项功能状态（F01–F31）
- [TODO.md](TODO.md) —— 只列真实剩余动作
- [STATE.md](STATE.md) —— 按时间的实施证据
- [QA-TEST-PLAN.md](QA-TEST-PLAN.md) —— QA 流程：需求审核 → 设计审核 → 测试设计 → 代码实现 → 交付测试
- [design-drafts/](design-drafts/) —— 界面设计稿

## 许可证

本仓库采用 [Apache-2.0](LICENSE)（版权见 `NOTICE`）。两个 fork 保留各自上游许可证；specgraph fork 按 Apache-2.0 第 4(b) 条附 `FORK-NOTICE.md`。
