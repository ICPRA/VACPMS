# VACPMS

**可视化 Agent 协作项目管理系统** —— 一个本机工作台：规格以节点形式存在于可查询的图中，工作被派发到真实的 AI 会话里执行，交付锚定在真实的 Git 提交上，人与多个 Agent 在同一套契约下协作。

[English](README.md) | [简体中文](README.zh-CN.md)

> 状态：活跃开发中，目前是单机环境。31 项规划能力中 26 项源码已实现；正式节点合并（F27）与最终完整检查（F28）待完成。尚无安装包。逐项功能状态见 [REQUIREMENTS-REVIEW.md](REQUIREMENTS-REVIEW.md)。

## 能做什么

- **规格图即项目计划** —— 需求与工作项是带意图、阶段、版本、依赖和具名决定的节点；可创建草稿、批准后进入执行、拆分，并可追溯每个决定的来源。
- **派发到原生 AI 会话** —— 节点经准备后派发进真实的 T3 Code 会话，模型与工作区经过审核。准备是幂等的：结果未知时按原命令身份恢复而不是悄悄重试；停止须人工确认后才解除写入责任。
- **交付锚定 Git** —— Git 是文件、提交、diff、合并与回退的唯一所有者。交付引用真实提交，评审比较固定双端提交；系统不复制提交图，也不给归属不明的改动猜测作者。
- **程序节点与有界循环** —— 机械/创新循环带次数上限、明确的通过/未知/失败结果、具名满意判断，预算耗尽即转人工。
- **Agent 邮件** —— 节点间以绑定身份的邮件协作：发送、回复、转发、确认、关闭、移交。转邮件负责人不等于转任务执行者。
- **不偷调模型的知识检索** —— 同一入口搜索规格、文件与历史对话，按来源组呈现命中原因；普通搜索绝不调用模型，只有明确的"向 AI 提问"才会打开原生对话草稿。
- **中英双语界面**。

## 解决什么痛点，具体怎么体现

| 痛点 | VACPMS 里的机制 | 你（或你的 AI）做什么 | 能看到的表现 |
|---|---|---|---|
| 一个超长主对话带几百个 subagent，反复压缩后可靠性丢失 | 项目状态存在数据库而非对话里；对话有独立生命周期，任务在对话之间带明确继承地交接 | PM Agent 把活拆成节点、在对话间交接；你可在分派面板人工覆盖 | 分派面板列出每个对话的负责范围和继承来源（要求/提交/风险/未决事项） |
| AI 写操作结果不明就静默重试 | 幂等写：同一请求键找到原准备；未知结果按原命令身份恢复 | 不用管——程序强制 | 界面保留"结果未知"的可见中间状态，不会出现第二份执行 |
| 断线被当成"已停止"就重新派单 | 停止是"请求 + 确认"两段式：先请求，观察到真实停止并由具名者确认后才解除写入责任 | 点"请求停止"→ 看到"请求已受理"→ 等宿主真实确认 | "请求已提交"和"实际已停止"是两个状态；租约丢失绝不显示成已停止 |
| 谁在读、谁负责、谁还能写，说不清 | 三套记录分开：claim 租约 / run 绑定 / 邮件负责人 | 自动维护；人工接手走两阶段"我来处理 / 交回 AI" | 节点上显示真实负责人、执行记录和交接状态 |
| 模型自报"完成了"就算完成 | 实施前的需求/设计审核；对固定 commit 登记测试报告；证据齐全才允许完成 | 审核者批准或退回；测试对话登记真实结果；产品判断归你 | 未审核/被退回/已批准/未测试/失败/通过分开显示；"没测"不会被藏起来 |
| 知识丢失、重复调查 | 一个搜索框同查规格、文件、历史对话；显式"向 AI 提问"打开原生对话草稿 | 一处搜索代替三处翻找；需要时才显式提问 | 结果按来源组呈现"为何命中"；来源失败、截断、未覆盖明确可见 |
| AI 悄悄扩大范围、偷换贵模型 | 预算定义允许的模型与并发；越界的结构变更自动升级 | AI 在批准的边界内自主工作；越界自动来找你 | 派发记录里"请求的模型/强度"和"实际的模型/强度"分开显示 |
| 进度假象（"发送成功=在干活"、"回合结束=已完成"） | 任务状态、执行尝试、协作、验证四条轴分离 | 程序按真实宿主事件驱动 | 已排队/已启动/等待输入/未知分开呈现，不用一片绿掩盖缺口 |

## 开始一个项目

目前**没有**一键"导入已有项目"的功能。两条路共用同一条主线：

**新项目。** VACPMS 项目就是一个 SpecGraph 项目：在目标仓库目录运行 `specgraph init <项目slug>`（会写入 `.specgraph.yaml` 和 Agent 集成文件），项目即出现在工作台里。工作项以节点**草稿**起步——从界面或 PM Agent 创建——经明确批准后才进入执行。

**接手已有代码库。** 同一条主线，只是现状证据来源不同：把工作台指向该仓库/工作区，用自然语言描述你想要的修改，PM Agent 会读取现状——已有能力、未知项、冲突——然后提出拆解建议；你审核后才正式建节点。注意：把仓库的历史资料（旧提交、旧对话）自动挂接到节点上是设计合同、**不是已实现功能**；目前三源检索覆盖的是当前文件、规格和对话历史。

## 和 AI 怎么合作

典型回路：

1. **你用自然语言说目标。** PM Agent 读取现状，提出拆成哪些节点草稿。
2. **你在工作台审核并批准**方案和预算（允许的模型、并发）。需求审核 → 设计审核 → 测试用例设计都在写代码之前完成。
3. **AI 派发并执行。** 工作在真实的 T3 会话里进行，你随时可打开查看。在批准的边界内，AI 自主派单、拆分、调整——但全部留痕。
4. **你验收交付。** 每个交付绑定真实 commit，由独立对话按事先设计的用例测试，证据齐全才算完成。
5. **升级事项来找你。** 范围/预算变更、歧义或反复失败、停止确认、人工接手——这些都必须具名的人来决定，系统绝不替你悄悄处理。

分工原则：语义判断（需求合理性、相关性、满意度、合并策略）归 LLM 或人；存储、身份、授权和并发/预算检查归程序。未知就显示未知。

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

## 给人看的部分

你只需要两样东西：

1. **机器上装好软件**：Windows、PostgreSQL 17、Go、Node.js + pnpm + vite-plus（`vp`）、T3 Code 桌面端。（这些也可以让 AI 装——直接看第 2 条。）
2. **一个跑在这台机器上的 AI Agent**（Claude Code、Kimi Code、Codex 等）。

然后对它说一句话：

> 帮我安装并启动 VACPMS。仓库是 `github.com/ICPRA/VACPMS`，外加两个 fork `ICPRA/specgraph` 和 `ICPRA/t3code`（都用 `workbench` 分支）。按 README 的"给 AI 的安装指引"操作。

从克隆、构建、配置文件、密钥、邮箱到启动和自检——下面那些事全是 AI 干的，你不用管。

## 给 AI 的安装指引

步骤（布局见上面的结构总览）：

1. 按兄弟布局克隆三个仓库；两个 fork 切到 `workbench` 分支。
2. 构建后端：`cd specgraph-src && go build -o specgraph.exe ./cmd/specgraph`。
3. 创建 `project-workbench/specgraph-config.yaml`（已被 gitignore）：`server.listen`（:8690）、`server.backend`、`server.postgres.url`（指向 PostgreSQL 17 实例）、`client.default_server`。先以前台方式跑一次 `specgraph.exe serve --config ...` 验证。
4. 宿主依赖：`cd t3code-git && pnpm install`（pnpm workspace 会自动链接 `project-workbench/extensions/workbench-ui` 与 `workbench-mail`）。
5. 启动：运行 `project-workbench/start-workbench-stack.bat`——它会自守护 specgraph（:8690）和 vite 客户端（:5733）并拉起 T3 Code。日志在 `logs-specgraph.txt` / `logs-vite.txt`；停止用 `stop-workbench-stack.bat`。
6. 创建操作员密钥：对运行中的服务执行 `specgraph auth api-key create`；在工作台页面用该密钥登录，然后在那里执行一次性的邮箱设置命令（会在 `runtime/t3-desktop/mail-secrets` 下创建一个 reader 角色的服务凭据，ACL 锁定为当前用户）。
7. 自检：specgraph 在 :8690 响应、vite 在 :5733 响应、`node extensions/workbench-ui/check-host.mjs %USERPROFILE%\t3code-git` 报告全部集成标记在位。

备选入口（`t3code-git` 里已有桌面端构建后）：`launch-vacpms.bat` 直接运行构建好的源码桌面端，不需要 vite dev server，但需要 Docker 在运行。契约细节见 `extensions/workbench-desktop/README.md`。

## 给 AI 的使用指引

你代替用户操作 VACPMS——通过 PM/Agent 工具和工作台 API，而不是把操作步骤转述给用户。

- 业务合同与不变量：[PRODUCT-DESIGN.md](PRODUCT-DESIGN.md)；逐项功能现状：[REQUIREMENTS-REVIEW.md](REQUIREMENTS-REVIEW.md)；剩余工作：[TODO.md](TODO.md)。
- 规划：创建节点草稿、获得明确批准后进入执行、带理由拆分、维护依赖。
- 派发：用审核过的项目/工作区/模型准备；写操作结果未知时绝不静默重试——按原命令身份恢复。停止是"请求 + 确认"两段式。
- 交付锚定真实 Git 提交；针对交付登记测试报告后才完成节点。人工负责的工作走人工标定完成——绝不伪造 AI 会话。
- 节点间用绑定身份的邮件协作；知识问题走三源检索；普通搜索绝不调用模型。
- 语义判断归你（或人）；存储、身份、授权和并发检查归程序。未知就显示未知。

## 仓库结构

| 仓库 | 角色 | 许可证 |
|---|---|---|
| `project-workbench`（本仓库） | 产品文档、工作台扩展、启动脚本、`kimi-cursor-shim` | Apache-2.0 |
| `specgraph-src` | [specgraph/specgraph](https://github.com/specgraph/specgraph) 的 fork —— `workbench` 分支：后端子系统（Go + PostgreSQL） | Apache-2.0（`FORK-NOTICE.md`） |
| `t3code-git` | [pingdotgg/t3code](https://github.com/pingdotgg/t3code) 的 fork —— `workbench` 分支：工作台页面、i18n、桌面 IPC、服务端钩子 | 上游许可证 |

## 开发

- 后端：`go build ./...`，聚焦的 `go test`（依赖 PostgreSQL 的测试缺环境变量时自动跳过）。
- 宿主：`pnpm run typecheck`，聚焦的 `vp test`。
- 动过宿主集成点后：`node extensions/workbench-ui/check-host.mjs %USERPROFILE%\t3code-git`。
- 上游同步：在各 fork 里 `git fetch upstream`，然后 rebase `workbench` 分支。
- `extensions/workbench-ui/t3-workbench-host.patch` 是快照；git 分支才是权威历史。

## 文档

- [PRODUCT-DESIGN.md](PRODUCT-DESIGN.md) —— 业务合同与设计决定
- [REQUIREMENTS-REVIEW.md](REQUIREMENTS-REVIEW.md) —— 逐项功能状态（F01–F31）
- [TODO.md](TODO.md) —— 只列真实剩余动作
- [STATE.md](STATE.md) —— 按时间的实施证据
- [QA-TEST-PLAN.md](QA-TEST-PLAN.md) —— QA 流程：需求审核 → 设计审核 → 测试设计 → 代码实现 → 交付测试
- [design-drafts/](design-drafts/) —— 界面设计稿

## 许可证

[Apache-2.0](LICENSE)（版权见 `NOTICE`）。两个 fork 保留各自上游许可证；specgraph fork 按 Apache-2.0 第 4(b) 条附 `FORK-NOTICE.md`。
