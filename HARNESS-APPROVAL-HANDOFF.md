# 编译测试反复授权：调查材料

日期：2026-09-21。用户要求在codex_bugfix另开任务调查、修复。本文记录证据，不授予新的执行权限。

## 创建状态

已向Codex应用提交新任务，标题：排查 harness 编译测试反复授权。
保存项目：%USERPROFILE%\Desktop\codex_bugfix，Git worktree环境。
返回clientThreadId：client-new-thread:cf7f6be8-a9b6-4c6f-85b9-854832f4350e。
用户已确认新任务创建成功。工具尚未返回实际threadId，本线程按用户要求继续VACPMS，不再查询创建状态或重复创建；调查进展由新任务负责。
原对话：01a0ba29-2176-73f1-a8bf-f74352efa961。完整调查委托已随创建请求提交。

## 待查责任层

近期拒绝为exec_command创建进程前的自动审批拒绝；另有明确标注PreToolUse hook的不同案例。不能仅凭中文拒绝文本认定都来自自有harness。
当前主任务cwd为电脑配置，实际项目在specgraph-src/t3code-git/project-workbench，超出默认可写根，因此命令常申请require_escalated。需要分开核查路径审批的触发原因、auto_review判断、自有规则注入和主代理追问。

## 原始拒绝与成功对照

1. Go命令设置项目内GOTMPDIR后执行go build -o specgraph.next.exe ./cmd/specgraph。
   拒绝原文：本地构建本身范围有限，但命令明确设置了被用户指示严格禁止的 GOTMPDIR 临时路径，且会覆盖候选可执行文件；应移除该临时路径后再执行。
   没有移除GOTMPDIR后转用系统TMP，没有绕过拒绝。
2. 用户随后明确允许%USERPROFILE%\specgraph-src.manual-completion-check、编译器自清理中间文件、覆盖固定候选specgraph.next.exe。
   严格使用用户这次指定的项目旁目录，不擅自改回项目内的\.manual-completion-check。Go构建exit0，目录剩余文件0，目录保留。
3. Vitest使用同目录TEMP/TMP、NODE_DISABLE_COMPILE_CACHE=1，以及run --configLoader runner --no-cache --project unit src/components/workbench。
   再次拒绝原文：该测试命令把 TEMP/TMP 指向此前仅获准用于 Go 编译器的目录；用户未授权将该目录扩展用于 Vitest，且工作区指示禁止随意使用临时路径。
   用户前一次措辞是“编译器”；Go限定是否合理来自哪些上下文，需实际追溯。
4. 用户再次明确允许本项目Go、TypeScript、Vitest共用该精确目录，清理各自生成的文件，不使用系统临时目录，不清理其他文件，不扩展其他项目或浏览器下载。
   同一Vitest命令成功：5文件42测试通过；前端noEmit类型检查通过。

## 不要混淆的案例

- Start-Process -FilePath $env:ComSpec曾被明确的PreToolUse external-browser hook拒绝：动态启动路径被禁止。改用已核对的静态cmd.exe和SpecGraph脚本后获准。需独立判断其边界，不把它当作所有auto_review拒绝的同一根因。
- 项目级邮件监督接口会暴露正文和逐收件人回执；审查要求明确权限范围，用户批准workbench.manage后实现。它涉及真实敏感可见范围，不应与编译中间文件混同，更不能一并放开。

## 修复边界

- 依据实际生效的源码、安装配置和日志定位责任层，检查原codex_bugfix目录未提交变更与worktree差别。
- 区分业务数据删除、固定构建产物覆盖、编译/测试工具清理自身中间文件。
- 修复应覆盖同类合法操作，不堆工具名或路径特例；仍保护越界路径、任意程序借用授权、未授权业务删除和外部浏览器操作。
- 不以关闭审批、放宽沙箱或全局删除许可解决，不改动/重启VACPMS生产服务。
- 若责任在平台而非自有harness，明确证据和可控范围，不宣称已修改平台内部审批逻辑。
