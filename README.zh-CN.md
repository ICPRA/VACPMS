# VACPMS

**可视化 Agent 协作项目管理系统** —— 一个本机工作台：规格以节点形式存在于可查询的图中，工作被派发到真实的 AI 会话里执行，交付锚定在真实的 Git 提交上，人与多个 Agent 在同一套契约下协作。

[English](README.md) | [简体中文](README.zh-CN.md)

> 状态：活跃开发中，目前是单机环境。31 项规划能力中 26 项源码已实现；正式节点合并（F27）与最终完整检查（F28）待完成。没有安装包，新机器初始化流程尚未建设——下面的步骤描述的是作者本机的实际接法。逐项功能状态见 [REQUIREMENTS-REVIEW.md](REQUIREMENTS-REVIEW.md)。

## 结构总览

VACPMS 由三个仓库组成，必须**并列克隆在同一父目录下**（启动脚本按目录名解析）：

```
%USERPROFILE%\
├── project-workbench\   ← 本仓库：文档、扩展、启动脚本
├── specgraph-src\       ← specgraph/specgraph 的 fork，`workbench` 分支（Go 后端）
└── t3code-git\          ← pingdotgg/t3code 的 fork，`workbench` 分支（桌面/Web 宿主）
```

- **specgraph fork** 在 `:8690` 提供工作台 API（规格、节点、执行、邮件、知识、交付钩子），存储用 PostgreSQL。
- **t3code fork** 渲染工作台页面并管理 AI 会话；它通过 pnpm workspace 链接本仓库的 `extensions/workbench-ui` 和 `extensions/workbench-mail`。
- **本仓库**负责粘合：`desktop-runtime.json` 用相对路径指向两个兄弟检出。

## 安装

前置条件：Windows、PostgreSQL 17（系统服务或 Docker）、Go、Node.js + pnpm + vite-plus（`vp`）、已安装的 T3 Code 桌面端。

```bat
:: 1. 按上面的布局克隆三个仓库（两个 fork 切到 workbench 分支）

:: 2. 构建后端（在 specgraph-src 里产出 specgraph.exe）
cd %USERPROFILE%\specgraph-src
go build -o specgraph.exe ./cmd/specgraph

:: 3. 创建 %USERPROFILE%\project-workbench\specgraph-config.yaml（已被 gitignore）
::    字段：server.listen / server.backend / server.postgres.url / client.default_server

:: 4. 安装宿主依赖（pnpm workspace 会自动链接两个扩展包）
cd %USERPROFILE%\t3code-git
pnpm install
```

## 启动

```bat
cd %USERPROFILE%\project-workbench
start-workbench-stack.bat
```

它会启动带自动重启的 specgraph（`:8690`）和定制 vite 客户端（`:5733`），日志分别写入 `logs-specgraph.txt`、`logs-vite.txt`，然后拉起 T3 Code 桌面端。`stop-workbench-stack.bat` 停止这两个服务。

另一个入口：`launch-vacpms.bat` 通过 `extensions/workbench-desktop/launch.mjs` 直接运行**构建好的**源码桌面端——不需要 vite dev server，但要求 `t3code-git` 里先做过桌面端构建，且 Docker 在运行。详见 `extensions/workbench-desktop/README.md`。

## 日常使用流程

1. **打开工作台** —— 侧栏 → Workbench（中英文可切换）。用操作员密钥登录；邮件功能额外需要一次性的邮箱设置命令。
2. **规划** —— 概览页提供项目图、看板和依赖视图。创建节点草稿，明确批准后进入执行；大节点可拆分；依赖的增删都会记录原因。
3. **派发** —— 在节点上选择 T3 项目、工作区和模型，勾选审核确认，点"创建并派发"。AI 在真实的 T3 会话里干活，你随时可以打开原会话查看。准备/派发结果未知时，界面提供"恢复原派发"，按原命令身份续传，绝不静默重试。停止执行是"请求 + 确认"两段式；节点不会在责任未解除时继续写入。
4. **验收交付** —— AI 的工作以真实 Git 提交落在其工作区。提交交付、针对该交付登记测试报告，然后完成节点（人工完成的工作走"人工标定完成"）。
5. **协作** —— 节点间用绑定身份的邮件沟通（回复/转发/确认/关闭/移交）。知识检索一个输入框查规格、文件、历史对话三个来源；普通搜索绝不调用模型，只有明确的"向 AI 提问"才会打开原生对话草稿。

核心分工原则：语义判断（需求合理性、相关性、满意度、合并策略）归对话中的 LLM 或人；程序只提供原来源、真实身份、结构化记录、授权操作和并发/预算检查。未知就显示未知。

## 开发

- 后端：`specgraph-src` 的 `workbench` 分支；`go build ./...`，聚焦的 `go test`（依赖 PostgreSQL 的测试缺环境变量时自动跳过）。
- 宿主：`t3code-git` 的 `workbench` 分支；`pnpm install`、`pnpm run typecheck`、聚焦的 `vp test`。
- 动过宿主集成点后：`node extensions/workbench-ui/check-host.mjs %USERPROFILE%\t3code-git`。
- `extensions/workbench-ui/t3-workbench-host.patch` 是 68 个专属宿主文件的再生成快照；git 分支才是权威历史。
- 上游同步：在各 fork 里 `git fetch upstream`，然后 rebase `workbench` 分支。

## 文档

- [PRODUCT-DESIGN.md](PRODUCT-DESIGN.md) —— 业务合同与设计决定
- [REQUIREMENTS-REVIEW.md](REQUIREMENTS-REVIEW.md) —— 逐项功能状态（F01–F31）
- [TODO.md](TODO.md) —— 只列真实剩余动作
- [STATE.md](STATE.md) —— 按时间的实施证据
- [QA-TEST-PLAN.md](QA-TEST-PLAN.md) —— QA 流程：需求审核 → 设计审核 → 测试设计 → 代码实现 → 交付测试
- [design-drafts/](design-drafts/) —— 界面设计稿

## 许可证

[Apache-2.0](LICENSE)（版权见 `NOTICE`）。两个 fork 保留各自上游许可证；specgraph fork 按 Apache-2.0 第 4(b) 条附 `FORK-NOTICE.md`。
