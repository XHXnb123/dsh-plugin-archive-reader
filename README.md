# dsh-plugin-archive-reader

只读地翻看 **asar / zip** 归档内部：列条目、读单个条目、按正则搜内容。零依赖、不写盘、不联网。

> 不想看代码？读 [PLAIN.zh.md](PLAIN.zh.md)：一页纸讲清它做什么、不做什么、会碰你什么、怎么退回去。

给 DeepSeek Harness（dsh）用的 Host 插件，注册三个模型侧工具：`archive_list`、`archive_read`、`archive_grep`。

## 为什么有这个东西

读 Electron 应用的 `app.asar`（里面装着 dsh 自己的插件管理器、各种包的 README 和源码）本来要手写一段解析头部偏移的临时脚本，还要小心别把偏移算错、别把上万条条目全打进对话。这个插件把那件事变成一次工具调用：

```
archive_grep { path: "...\\app.asar", pattern: "版本兼容性与豁免" }
→ dsh/node_modules/@deepseek-ai/dsh-plugin-manager/README.zh.md:61: ### 版本兼容性与豁免
```

## 安装

```bash
dsh plugin --profile web add dsh-plugin-archive-reader   # npm 安装（尚未发布时用下面的本地路径）
dsh plugin --profile web add D:\path\to\dsh-plugin-archive-reader
```

装完**完全重启 dsh**（不是刷新页面），工具即出现在会话里。

## 工具

| 工具 | 用途 | 关键参数 |
| --- | --- | --- |
| `archive_list` | 列条目，支持按正则/子串过滤 | `path`、`pattern?`、`limit?`、`format?` |
| `archive_read` | 读单个条目的文本内容 | `path`、`entry`、`maxBytes?`、`format?` |
| `archive_grep` | 在所有文本条目里按正则搜内容 | `path`、`pattern`、`maxMatches?`、`maxEntryBytes?`、`format?` |

三个工具都**只读**：只打开归档读数据，从不写盘、不修改任何 profile 状态。

- `pattern` 先按不区分大小写的正则解释，解析失败（如 `x(1`）自动退回子串匹配，返回值里的 `matcherKind` 说明用了哪种。
- `archive_read` 检测到二进制内容（开头有 NUL 字节）时只报告大小并置 `binary: true`，不返回内容。
- `entry` 必须精确匹配（也接受忽略大小写的完全一致）；找不到时会列出相近候选，省一轮试错。

## 支持范围与已知限制

- 支持 `.asar`（Electron 打包格式）与 `.zip`（store / deflate）。**不支持** ZIP64、加密条目、tar/gz/7z/rar——遇到会明确报错，不做静默降级。
- zip 条目名未声明 UTF-8 时（历史 CP437 编码）按 UTF-8 尽力解码，可能有乱码。
- 截断按字节切，可能切在多字节字符中间，解码后会出现替换字符。
- `archive_grep` 逐条解压扫描，受总扫描预算约束（默认 64 MB，触顶时在 `stoppedEarly` 里说明）；对几百 MB 的归档仍会有可感知的 CPU 占用。
- 条目内容按需读取；`unpacked` 的 asar 条目从 `<归档名>.unpacked/` 目录读。

## 配置

`cordis.patch.yml` 里该行的 `config` 支持以下字段（都会被常量硬上限夹住）：

| 字段 | 默认 | 含义 |
| --- | --- | --- |
| `maxEntries` | 200 | `archive_list` 默认返回条目数 |
| `hardMaxEntries` | 5000 | 单次调用可请求的条目上限 |
| `maxReadBytes` | 65536 | `archive_read` 默认返回字节数 |
| `hardMaxReadBytes` | 1048576 | 单次可请求的字节上限 |
| `maxMatches` | 50 | `archive_grep` 默认命中行数 |
| `hardMaxMatches` | 500 | 单次可请求的命中上限 |
| `maxEntryBytes` | 4 MB | `archive_grep` 跳过的单条目大小 |
| `maxScanBytes` | 64 MB | `archive_grep` 的总扫描预算 |
| `maxLineChars` | 400 | 单行匹配文本的最大长度 |
| `timeoutMs` | 30000 | 三个工具的工具级超时 |

## 依赖与安全

- **零运行时依赖**：只用 `node:fs`、`node:zlib`。没有安装脚本、没有 `postinstall`，不引入任何第三方包。
- **不联网**：全部本地解析。
- **只读**：代码里没有任何写文件调用（`fs.open(..., 'r')` 与 `fs.readFile`）。

## 兼容性

`package.json` 声明了 `peerDependencies: { "@deepseek-ai/dsh": ">=0.2.0-rc.1" }`，与 dsh 运行时不匹配时会被 Harness 的兼容性检查拒绝加载（可用 `dsh plugin allow-version` 写精确版本豁免）。插件本身不 import 任何 Harness 包，因此不依赖 dsh 安装树里的包解析。

## 怎么确认它没骗你

不用读代码也能验证：

1. **双击 `verify.bat`**（Windows）——跑完全部测试，最后一行给出"通过 / 失败"的结论；失败时写出 `verify-output.txt` 供排查。等价命令：`node scripts/verify.mjs`。
2. **问四个问题**——它改不改我的文件？联网吗？依赖谁？怎么退回去？答案：不改（只读打开）、不联网、零依赖、一条卸载命令。

（CI 也会在 Ubuntu 与 Windows、Node 20 与 22 上重跑同一套测试，工作流文件尚未启用——推送它需要带 `workflow` 权限的凭据。）

## 开发与验证

```bash
node --test test/asar.test.mjs test/zip.test.mjs test/plugin.test.mjs test/contract.test.mjs
node scripts/verify.mjs   # 同上，但用人话汇报结果，给不看代码的人用
```

覆盖范围：

- **asar 真样本**：直接读本机 121 MB 的 `app.asar`，核对条目数、按 `dsh-plugin-manager/README.zh.md` 定位并读到已知文本、忽略大小写命中、近似候选报错、`unpacked` 条目走目录读取。
- **zip**：测试内手写构造归档（store + deflate + 中文路径 + 目录条目），验证两种压缩方法、路径解码、目录条目与缺失条目报错。
- **插件契约**：用 stub ctx 加载真实入口 `apply()`，确认注册了三个工具、返回值覆盖 `output.schema.required` 的全部字段、`dispose` 能清理注册。
- **schema 方言**：三个工具的 `parameters` 与 `output.schema` 已用 Harness 自己的 `assertSupportedJsonSchema`（自 `@deepseek-ai/dsh-tools` 提取）逐一校验通过——即注册时不会因 schema 不受支持而失败。

端到端验证状态：已在真实的 Harness 会话里跑过两次工具调用——一次装的是本地链接，一次是从本仓库 GitHub 地址装来的副本（`archive_grep` 命中 `app.asar` 内已知文本；`archive_list` 按正则筛出 15 个条目）。Desktop 图形界面下的调用未实测。

## License

MIT

---

## English

`dsh-plugin-archive-reader` is a read-only DeepSeek Harness plugin that exposes three model-facing tools for peeking inside **asar** and **zip** archives: `archive_list`, `archive_read`, `archive_grep`. It is dependency-free (only `node:fs` and `node:zlib`), performs no writes and no network access, and refuses ZIP64, encrypted entries, and non-zip/asar formats instead of degrading silently.

```bash
dsh plugin --profile web add D:\path\to\dsh-plugin-archive-reader
```

Restart dsh fully after installing. Run the test suite with `node --test test/asar.test.mjs test/zip.test.mjs test/plugin.test.mjs test/contract.test.mjs`, or double-click `verify.bat` for a plain-language summary. Non-programmers: see [PLAIN.zh.md](PLAIN.zh.md).
