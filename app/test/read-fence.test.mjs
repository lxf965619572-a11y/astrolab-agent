// 读取围栏的路径检查（不起 DSH）：Windows 和 Linux 两套规则，用例取自真实任务里智能体用过的命令
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createFence, denial } from '../engine/read-fence.mjs'

const W = 'D:\\lixf\\astrolab-agent\\runtime\\app-data\\workspace\\sample'
const win = createFence({
  platform: 'win32',
  roots: [W, 'D:\\lixf\\astrolab-agent\\skills', 'D:\\lixf\\astrolab-agent\\runtime\\app-data\\installed\\skills'],
  tools: ['C:\\msys64', 'D:\\Program Files\\nodejs', 'D:\\lixf\\astrolab-agent\\runtime\\dsh'],
  env: { SystemRoot: 'C:\\Windows', ProgramFiles: 'C:\\Program Files', 'ProgramFiles(x86)': 'C:\\Program Files (x86)', TEMP: 'C:\\Users\\u\\AppData\\Local\\Temp' },
})
const ok = (name, args, cwd = W) => assert.equal(win(name, args, cwd), undefined, `${name} ${JSON.stringify(args)} 应允许`)
const no = (name, args, cwd = W) => assert.ok(win(name, args, cwd), `${name} ${JSON.stringify(args)} 应拒绝`)

test('Windows：文件工具只读工作区和技能目录', () => {
  ok('read', { file_path: `${W}\\coding\\thm_ctrl\\doc\\thm_ctrl-详细设计.md` })
  ok('read', { file_path: 'coding\\thm_ctrl\\include\\thm_ctrl.h' })
  ok('read', { file_path: 'D:\\LIXF\\Astrolab-Agent\\skills\\coding\\references\\coding-rules.md' }) // 大小写不同
  ok('read', { file_path: 'D:/lixf/astrolab-agent/skills/code-walkthrough/references/checklist.md' })
  no('read', { file_path: 'D:\\lixf\\astrolab-agent\\sample\\coding\\thm_ctrl\\doc\\thm_ctrl-详细设计.md' }) // 仓库的 sample（这次真实发生过）
  no('read', { file_path: 'D:\\lixf\\astrolab-agent\\config\\local.env' })
  no('read', { file_path: '..\\..\\..\\..\\config\\local.env' })
  no('read', { file_path: 'D:\\lixf\\astrolab-agent\\evals\\coding\\thm_ctrl\\答案表.md' })
  no('read_image', { file_path: 'E:\\型号\\S天线\\图.png' })
  ok('glob', { pattern: '**/*.c' })
  ok('glob', { pattern: 'coding/**/*.h', path: 'coding' })
  no('glob', { pattern: 'D:/lixf/**/*.c' })
  no('grep', { pattern: 'thm', path: 'D:\\lixf\\astrolab-agent' })
  ok('grep', { pattern: 'D:\\\\secret', include: '*.c' }) // 搜索的内容不是路径
  no('working_directory', { cd: '..' })
  ok('working_directory', { cd: 'coding\\thm_ctrl' })
  no('subagent', { cwd: 'D:\\other', prompt: '看看', description: 'x' })
  ok('subagent', { prompt: '读 D:\\other\\x.c', description: 'x' }) // 说明文字不检查
  ok('write', { file_path: 'coding\\thm_ctrl\\src\\thm_ctrl.c', content: '/* 见 D:\\lixf\\x */' })
  ok('mcp__knowledge__propose_knowledge', { title: 't', body: '原来放在 D:\\lixf\\x', kind: '经验' })
})

test('Windows：MCP 工具的路径参数和 -I', () => {
  ok('mcp__utest__compile_check', { sources: ['coding/thm_ctrl/src/thm_ctrl.c'], includeDirs: ['coding/thm_ctrl/include'] })
  no('mcp__utest__compile_check', { sources: ['coding/x.c'], includeDirs: ['D:\\型号\\S天线\\include'] })
  no('mcp__utest__run_unit_tests', { sources: ['a.c'], tests: ['t.c'], cflags: ['-ID:\\other\\inc'] })
  no('mcp__utest__run_unit_tests', { sources: ['a.c'], tests: ['t.c'], cflags: ['-I', 'D:\\other\\inc'] })
  ok('mcp__utest__run_unit_tests', { sources: ['a.c'], tests: ['t.c'], cflags: ['-Iinclude', '-DDEBUG=1', '-include', 'test/hw.h'] })
  no('mcp__cppcheck__run_cppcheck', { paths: ['D:\\lixf\\astrolab-agent\\mcp'], target: 'sparc' })
  ok('mcp__docreader__read_document', { path: 'design\\oc_ctrl\\docs\\需求.docx' })
  ok('read_mcp_resource', { server: 'x', uri: 'file:///D:/elsewhere' }) // URL 交给服务自己管
})

test('Windows：命令行（取自真实任务的命令）', () => {
  ok('pwsh', { command: 'Get-ChildItem -Recurse -Force coding\\thm_ctrl | Select-Object FullName, Length' })
  ok('pwsh', { command: "$env:Path='C:\\msys64\\ucrt64\\bin;'+$env:Path; gcc -std=c99 -Wall -I coding\\thm_ctrl\\include coding\\thm_ctrl\\src\\thm_ctrl.c .utest\\thm_smoke\\test_thm.c -o .utest\\thm_smoke\\test_thm.exe" })
  ok('pwsh', { command: 'node D:\\lixf\\astrolab-agent\\skills\\coding\\scripts\\check-code.mjs coding\\thm_ctrl\\src\\thm_ctrl.c' })
  ok('pwsh', { command: 'git status --short; git log --oneline -5' })
  ok('pwsh', { command: 'cmd /c dir /s /b *.c' })
  ok('pwsh', { command: 'C:\\Windows\\System32\\where.exe gcc' })
  ok('pwsh', { command: 'Write-Output "完成..."; Get-Content .\\coding\\a.txt' })
  ok('pwsh', { command: 'Get-ChildItem C:\\Users\\u\\AppData\\Local\\Temp\\x; Get-ChildItem $env:TEMP' })
  no('glob', { pattern: '../**/*.md' })
  no('pwsh', { command: "Get-ChildItem -Force 'D:\\lixf\\astrolab-agent\\runtime\\app-data\\workspace' | Select-Object Name; Get-ChildItem -Force 'D:\\lixf\\astrolab-agent' | Select-Object Name" })
  no('pwsh', { command: "$src='D:\\lixf\\astrolab-agent\\sample\\coding\\thm_ctrl'; Copy-Item $src -Destination coding -Recurse" })
  no('pwsh', { command: 'Get-Content $env:USERPROFILE\\.ssh\\id_rsa' })
  no('pwsh', { command: 'Get-ChildItem %LOCALAPPDATA%' })
  no('pwsh', { command: 'cat ~/notes.txt' })
  no('pwsh', { command: 'Get-ChildItem \\\\fileserver\\型号' })
  no('pwsh', { command: 'Set-Location D:' })
  no('pwsh', { command: 'Get-ChildItem ..' })
  no('pwsh', { command: 'type ..\\..\\..\\config\\local.env' })
  no('bash', { command: 'ls /d/lixf/astrolab-agent/evals' })
  no('pwsh', { command: 'dir', workdir: 'D:\\other' })
  ok('pwsh', { command: 'dir', workdir: 'coding' })
  // 引号里带空格的路径（真实环境里 node 在 D:\Program Files\nodejs）
  ok('pwsh', { command: '& "D:\\Program Files\\nodejs\\node.exe" "D:\\lixf\\astrolab-agent\\skills\\coding\\scripts\\check-code.mjs" coding\\a.c' })
  ok('pwsh', { command: "& 'C:\\Program Files\\Cppcheck\\cppcheck.exe' --enable=warning coding\\a.c" })
  ok('pwsh', { command: '$env:Path = "C:\\msys64\\ucrt64\\bin;D:\\Program Files\\nodejs;" + $env:Path' })
  no('pwsh', { command: 'Get-Content "D:\\型号 项目\\S天线\\src\\main.c"' })
  no('pwsh', { command: '$env:Path = "C:\\msys64\\ucrt64\\bin;D:\\other tools\\bin;" + $env:Path' })
  no('pwsh', { command: "Get-ChildItem 'D:\\lixf\\astrolab-agent\\evals'" })
})

test('Linux：同样的规则', () => {
  const lin = createFence({ platform: 'linux', roots: ['/home/u/ws', '/repo/skills'], tools: ['/repo/runtime/dsh'] })
  const ok2 = (n, a) => assert.equal(lin(n, a, '/home/u/ws'), undefined, JSON.stringify(a))
  const no2 = (n, a) => assert.ok(lin(n, a, '/home/u/ws'), JSON.stringify(a))
  ok2('read', { file_path: 'src/a.c' })
  ok2('read', { file_path: '/repo/skills/coding/SKILL.md' })
  no2('read', { file_path: '/etc/passwd' })
  no2('read', { file_path: '../other/x' })
  ok2('bash', { command: 'gcc -std=c99 -Iinclude src/a.c -o /tmp/a && /tmp/a' })
  ok2('bash', { command: 'ls /usr/bin | head; grep -rn foo .' })
  ok2('bash', { command: 'curl -s http://127.0.0.1:8080/x' })
  ok2('bash', { command: '"/repo/runtime/dsh/my tool" src/a.c' })
  no2('bash', { command: 'cat "/home/u/other dir/x.c"' })
  no2('bash', { command: 'cat /home/u/other/x.c' })
  no2('bash', { command: 'ls -la /' })
  no2('bash', { command: 'echo $HOME' })
  no2('bash', { command: 'cd ../x && ls' })
})

test('拒绝理由告诉智能体怎么办', () => {
  const t = denial('read', 'D:\\x', W)
  assert.match(t, /不允许读取工作区外的文件/)
  assert.match(t, /ask_user_question/)
})
