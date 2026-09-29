# VACPMS 需求与实现审计

更新：2026-09-28。依据用户本轮质疑，重新核对当前源码和真实入口，不按历史勾选框、接口数或测试数量计进度。

## 统计口径

原清单31项：**26项源码功能已实现，F27正式合并及F28完整检查/真实问题修复待完成，F29-F31三项已取消**。用户2026-09-29明确这两项完成并修复检查问题后即结束，不再做其它交付工作。取消不计为实现；本清单不换算完成百分比。

“源码已实现”表示已有可调用入口及对应处理路径，并有既往模块检查记录；不代表最新版已统一部署、真实模型使用质量已证明或用户总体验收通过。本次审计只读代码并更新文档，没有重跑测试、启动模型或运行真实项目。

## 功能清单

| ID | 用户可以做的事 | 状态 | 现有路径或确切缺口 |
|---|---|---|---|
| F01 | 在已配置的本机从同一入口启动工作台、读取数据库 | 已实现 | 原启动器、本机IPC、数据库就绪检查；不包括新机器安装 |
| F02 | 查看项目概览、依赖图、看板及选定子图 | 已实现 | Page、DependencyGraph；整体交互易用性另列F29 |
| F03 | 创建工作草稿、明确批准其进入执行 | 已实现 | UI及PM的create-node、approve-execution；不自动判断需求合理性 |
| F04 | 增加/移除依赖并保留原因、操作者和历史 | 已实现 | UI、PM工具及原图存储；不是语义依赖推断算法 |
| F05 | 把节点拆成子节点、保留来源并读取继承内容 | 已实现 | SubdivideSpec、UI及PM工具；AI决定拆法，代码执行已给出的结构变更 |
| F06 | 选择模型/工作区，准备并派发到原生AI对话 | 已实现 | prepare_node_run、dispatch_prepared_run、原T3创建/启动链；模型选择策略归PM |
| F07 | 取消未启动准备、请求停止、确认原执行状态并解除写入责任 | 已实现 | 原派单/宿主状态/具名确认；断线或租约过期不会被当成进程已停止 |
| F08 | 节点间邮件、引用、确认、关闭、移交及退场接管 | 已实现 | 原mail工具、MailWorkspace、图上邮件关系；转邮件负责人不等于转任务执行者 |
| F09 | 在实施前审核需求/设计，绑定明确来源和测试计划 | 已实现 | 源审核、qaBasis、原准入校验；审核和测试设计内容由AI/人负责 |
| F10 | 对固定交付登记测试结果，并按原成果条件完成任务 | 已实现 | test_report、TestReportsPanel、RecordCompletion；登记报告不等于系统重新执行测试 |
| F11 | 人工标定节点完成，不创建虚假AI会话 | 已实现 | ManualComplete、NodeCompletion；与技术测试分开，活动执行仍须处理 |
| F12 | 准备、启动、取消程序节点，记录结果并按约定完成 | 已实现 | 原ProcessRunner、本机协议、WorkbenchProgram；结果和完成分开 |
| F13 | 固定程序机械/创新循环、次数上限、未知等待、停止及判断纠正 | 已实现 | program_attempts、program_loop_events、原human/PM入口；不覆写已消费判断 |
| F14 | 某次交付提交后触发指定测试工作 | 已实现 | delivery_test hook、宿主消费、人工配置UI及PM工具；复用原执行链 |
| F15 | 按报告或AI/人登记判断选分支，进行all/any汇合 | 已实现 | 同一flow的report/judgment、显式skip、追加纠正、原准入消费；程序不作语义判断 |
| F16 | 人工或授权PM标记风险/关键性并保留历史 | 已实现 | node_marks及具名工具；PM必须慎重，不确定先人工，不做自动风险总分 |
| F17 | 同一入口搜索规格、文件、历史对话，读原文并显式向AI提问 | 已实现 | 三源查询、原文读取、原生对话草稿；普通搜索不调用模型 |
| F18 | 查看某次执行当时保存的指导、QA和继承来源 | 已实现 | 明确run的原工作包、RunHarness；准备记录不证明模型实际遵守规则 |
| F19 | 用Git工作树及真实提交关联交付，查看固定双端提交和diff | 已实现 | readHead、submit_own_delivery、compareCommits；无第二提交树、源码副本或合并算法 |
| F20 | 查看能准确归属的token、历时、压缩通知及实际资料读取 | 已实现 | 原turn/request-linked/活动；缺项显示未知，工作难度和是否浪费由PM/LLM解释 |
| F21 | 查看需求变化的结构影响，停止/失效相关工作，再审核和重新准备 | 已实现 | ChangeImpactPreview、停止确认、AbandonNode、源审核/追加判定、原prepare；AI决定真正受影响范围，不建语义影响引擎 |
| F22 | 按目标处置汇总义务、接受/撤回汇总 | 已实现 | 后端、PM MCP及人类表单已接原路由；处置仅本目标，接受固定读取时引用，历史核对与显式重确认分开，不新增判断算法 |
| F23 | 节点或汇总完成后触发指定程序 | 已实现 | 人类配置/取消/就绪重核表单已接原后端、宿主和IPC；读取固定程序及原事实，未知请求跨刷新保留原key对账，不额外start。原授权要求人类确认，PM建议不等于代替人类授权 |
| F24 | 同一AI会话按正式候选+验证轮迭代，并以满意条件停止 | 已实现 | 首次准入前明确report/satisfaction模式；具名满意判断及纠正、两类矛盾持久转人工、人类按确切事实解除、原次数/汇合/成果门禁、MCP及人工表单已接；旧轮和完成依据不回写 |
| F25 | 记录返工/重试及Git撤销，并关联原任务 | 已实现 | 人工及Agent具名retry/rework/git_undo登记、分页历史和分类计数已接；Git引用明确revert/reset，Agent沿原Git核对可解析，人工引用是声明；不执行或独立证明撤销，不推断所有外部Git操作 |
| F26 | 点击“我来处理/交回AI”，让普通节点明确由人工负责 | 已实现 | 原节点human owner及具名两阶段接手、总结/人工补交接、确切停止确认、取消/交回与历史已接；原准备/绑定/准入/后继及新交付/完成尊重owner，交回不启动AI，不用邮件owner替代 |
| F27 | 把A/B正式合并成C并保留沿革、处理相关连接 | 未实现 | 未发现正式merge操作/事务/UI/MCP；AI给出目标内容和关系决定，代码负责一致写回，不做自动合并内容判断 |
| F28 | 全部开发完成后运行完整开发检查 | 未执行 | 工具已安装，部分检查曾通过；当前无最终全仓check通过结论，按用户要求后置 |
| F29 | 集中优化真实任务流程的前端UX | 已取消 | 用户2026-09-29取消；必要功能入口仍随F27完成，不另做集中UX阶段 |
| F30 | 把近期增量统一构建并匹配部署到运行版 | 已取消 | 用户2026-09-29取消部署；检查所需编译仍可执行，不声称近期增量已发布 |
| F31 | 新机器初始化、依赖组装、Windows发行包与升级安装 | 已取消 | 用户2026-09-29取消；不再安装打包或发布，保留已做源码 |

## 上一报告的四类说法如何纠正

### 1. 条件与责任

目前具体条件事实只有明确实现的这些：程序attempt的退出码/退出状态；某交付的测试报告；具名AI/人的true/false/unknown判断；原来源引用及其当前内容；本轮分支的准入/完成记录。没有一份已确认的“其它结构化事实类型”清单，不能据此继续添加任意测量、文件监控或通用谓词框架。

判断是否满意、数学推导是否正确、是否改变方案，由AI/人做。代码只接收具名结果，核对主体、确切对象/来源、并发前驱和预算，并执行对应分支或停止。F24现已把这种具名判断接入原候选循环，不让代码理解语义。停止迭代与任务成功仍分开，原测试/成果条件不能被一句“满意”覆盖。

已经有三种具体记录，职责不同：claim是有期限的占用；run_binding/dispatch是任务与实际对话/程序及一次性启动的绑定，记录仍可能写入的执行；mail owner是协作事项的处理人。断线时租约可能到期，原执行却可能仍写文件，因此后两者不能被一个租约替代。

但没有理由再建设“通用跨任务责任谱系”。旧TODO中“跨任务责任关联仍须显式建模”撤出开发待办。若以后确实需要把同一循环迁到另一节点，先明确具体操作，再关联已有loop/attempt身份，不重建责任系统，也不声称程序能按任务名称判断两个任务语义相同。

### 2. 知识与规则

知识维护对话负责别名扩展、能力/经验归纳、沿引用查证、规则适用性及冲突判断、目录维护。PM解释负载并决定是否拆分。原工具已经能搜索、读原文、查会话关联run、查节点交付/图/来源；LLM可连续调用，不需要“关联展开引擎”或“能力复用引擎”。

代码职责是把这些工具、真实身份及来源入口提供好。知识目录仍是普通Git文档；有界面/业务字段消费者才解析结构化数据，只有LLM阅读时可以直接Markdown。规则文件存在、曾放进准备包、宿主实际加载、模型实际遵守是不同事实；没有证据就标未知，不另造加载证据账本。

先前提出的knowledge-node-sources仅是“选中节点时少点几次”的读取便利候选。本轮尚未实现，也不再作为阻挡后端完成的新必做框架。相关QA草案标为候选，不拿它扩充原需求。

### 3. Commit与结构化输出

作为成果版本关联锚点，commit是主路线。现有链就是：宿主读基线HEAD -> 原run -> 交付时读实际HEAD -> 节点/交付 -> 原Git固定双端比较。不重建提交历史、diff或文件版本。

最小补法是LLM输出已有协议需要的JSON，程序解析并附真实run/项目/提交身份；正则可以定位一个标记块，JSON正文用JSON解析器，不用正则重写结构化解析。语义性字段是具名声明，不包装成程序已经独立证明。

仅保留必要例外：共享目录中混入他人修改不能据commit断言独占作者；reset或未提交改动可能不产生新commit；同一thread可关联多个run，不能拿最近run猜归属。这些只要求明确引用或显示未归属，不构成另建庞大归属框架的理由。F25已通过原事件表和两条固定引用接通，没有增加撤销执行器、提交索引或语义推断。

### 4. 业务操作与AI判断

代码确切业务缺口见F27；F22汇总、F23完成触发程序、F24候选满意判断和F26人工接手的人类入口已补齐。AI决定接受哪些义务、何时建议配置hook、怎样合并；人工负责状态由有权限的人具名操作。表单/MCP/事务按原权限把已经作出的决定写回真实状态；对话文本不能代替实际图或负责人变更。

需求变化已有可组合操作，不再笼统列“自动影响判定/旧交付重审系统”待建。是否复用旧成果、补哪些检查，由PM/审核者依据实际差异决定。

### 剩余动作的具体输入与结果

| 项目 | AI/人提供什么 | 尚待代码完成什么 | 不建设什么 |
|---|---|---|---|
| F27 | AI/人给出A/B到C的内容及具体关系处置 | 一次事务写入目标、来源沿革和相关连接，拒绝循环依赖及不合法的义务变更 | 自动内容合并算法、第二套Git |

已明确的政策：F24测试通过但不满意、满意但测试未通过均停止并转人工，前者附不满意理由；F26允许其他项目管理者具名变更人工负责人，已有执行必须先总结交还、再核实停止、最后接手。旧执行崩溃或失联无法自行总结时，允许人工依据日志和成果补做交接、标明缺失信息，核实旧执行停止后接手。上述政策疑问已全部确认，剩余是实现与验证。

## 关键源码证据

- 结构和PM操作：[workbenchMail.ts](C:/Users/zheng/t3code-git/apps/server/src/mcp/workbenchMail.ts)、[Page.tsx](C:/Users/zheng/project-workbench/extensions/workbench-ui/src/Page.tsx)、[subdivision.go](C:/Users/zheng/specgraph-src/internal/storage/postgres/subdivision.go)。
- 程序/条件/候选：[program_loop.go](C:/Users/zheng/specgraph-src/internal/storage/postgres/program_loop.go)、[report_branch_judgment.go](C:/Users/zheng/specgraph-src/internal/storage/postgres/report_branch_judgment.go)、[candidate_loop.go](C:/Users/zheng/specgraph-src/internal/storage/postgres/candidate_loop.go)。
- 执行责任而非通用责任框架：[run_dispatch.go](C:/Users/zheng/specgraph-src/internal/storage/postgres/run_dispatch.go)、[claim.go](C:/Users/zheng/specgraph-src/internal/storage/postgres/claim.go)、[mail_owner.go](C:/Users/zheng/specgraph-src/internal/storage/postgres/mail_owner.go)。
- 人工完成与需求变化：[manual_completion.go](C:/Users/zheng/specgraph-src/internal/storage/postgres/manual_completion.go)、[ChangeImpactPreview.tsx](C:/Users/zheng/project-workbench/extensions/workbench-ui/src/ChangeImpactPreview.tsx)、[AbandonNodePanel.tsx](C:/Users/zheng/project-workbench/extensions/workbench-ui/src/AbandonNodePanel.tsx)。
- 搜索/规则/Git/负载：[KnowledgeSearch.tsx](C:/Users/zheng/project-workbench/extensions/workbench-ui/src/KnowledgeSearch.tsx)、[RunHarness.tsx](C:/Users/zheng/project-workbench/extensions/workbench-ui/src/RunHarness.tsx)、[WorkbenchDeliveryGit.tsx](C:/Users/zheng/t3code-git/apps/web/src/components/workbench/WorkbenchDeliveryGit.tsx)、[WorkbenchSessions.tsx](C:/Users/zheng/t3code-git/apps/web/src/components/workbench/WorkbenchSessions.tsx)。

## 历史处理

审计前TODO、PLAN、需求对照已完整移到docs/history，原修改与证据记录没有丢弃。当前统计只由本表维护；TODO只列实际剩余动作，不再重复累计历史切片。STATE保留实施记录，旧段中的“未完成”只描述当时。
