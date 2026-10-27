#!/usr/bin/env node
// 单元测试 MCP 服务：在主机上编译、运行手写驱动/桩或 gtest 测试，用 gcov 统计语句、分支、MC/DC 覆盖率。
// 传输方式：stdio（由 DSH 的 dsh-mcp-client 插件拉起）。
//
// 环境变量：UTEST_CC、UTEST_CXX、UTEST_GCOV、UTEST_GTEST_ROOT（见 lib/toolchain.mjs）；
//           DOC_ALLOWED_ROOTS（构建目录放在第一个允许目录下的 .utest 中，默认当前工作区）

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { hotHandler, hotModule } from '../common/hot.mjs'

// 工具实现修改后下一次调用自动生效，不用重启 DSH（见 ../common/hot.mjs）
const tools = hotModule(import.meta.url, 'tools.mjs')

const server = new McpServer({ name: 'dept-utest', version: '0.1.0' }, {
  instructions:
    '部门单元测试服务。按 unit-test-design Skill 设计用例后，用 run_unit_tests 编译运行；根据未覆盖的行和分支补充用例；' +
    '编译器不能测 MC/DC 时用 check_mcdc 核对 MC/DC 分析表。测试只在主机上运行，字节序、非对齐访问、寄存器时序等平台问题不能由主机测试发现。',
})

server.registerTool('toolchain_info', {
  description: '查看本机编译器、gcov 版本，以及是否支持 MC/DC 测量（GCC 14 及以上）。',
  inputSchema: {},
}, hotHandler(tools, 'toolchainInfo'))

server.registerTool('run_unit_tests', {
  description:
    '编译被测源文件（插桩统计覆盖率）和测试文件（驱动、桩），链接后运行，返回用例通过情况、失败检查、各函数的语句/分支/MC/DC 覆盖率及未覆盖行。' +
    '链接缺函数时列出需要的桩。手写驱动请使用 utest.h（已自动加入头文件路径）；地址直接写在被测代码中时，可用 ut_map.h 把目标机地址映射为主机内存。' +
    'includeDirs 中排在被测文件目录之前的目录里有与被测 .c 同目录头文件同名的头文件时，自动替换该头文件（编译影子副本，被测文件不改动）。每次运行会清空上次的覆盖率数据。',
  inputSchema: {
    sources: z.array(z.string()).min(1).describe('被测源文件（.c），会插桩统计覆盖率。不要列出测试文件'),
    tests: z.array(z.string()).min(1).describe('测试驱动和桩文件（.c；gtest 为 .cpp）'),
    includeDirs: z.array(z.string()).optional().describe('头文件目录，按顺序查找。替换硬件头文件的目录（如 test/hw）放在最前面'),
    defines: z.array(z.string()).optional().describe('预定义宏，如 "UNIT_TEST" 或 "REG_BASE=ut_regs"'),
    cflags: z.array(z.string()).optional().describe('其他编译选项，如 "-std=c99"、"-Wall"'),
    framework: z.enum(['c', 'gtest']).optional().describe('c=手写驱动+utest.h（默认）；gtest=GoogleTest（D2000 Linux 代码）'),
    timeoutSec: z.number().int().min(1).max(300).optional().describe('测试程序运行超时，默认 10 秒'),
    name: z.string().optional().describe('本次测试名，用作构建目录名，默认取第一个被测文件名'),
  },
}, hotHandler(tools, 'runUnitTests'))

server.registerTool('compile_check', {
  description:
    '编码环节用：只编译不运行，用严格告警（-Wall -Wextra -Wconversion 等）检查 .c 文件，返回每条错误和告警的文件、行号、告警类别。' +
    'target 为 sparc 或 d2000 时，配置了目标机交叉编译器（TARGET_CC_SPARC / TARGET_CC_D2000）就用它，否则用主机 gcc 并说明局限。',
  inputSchema: {
    sources: z.array(z.string()).min(1).describe('要检查的源文件（.c）'),
    includeDirs: z.array(z.string()).optional().describe('头文件目录'),
    defines: z.array(z.string()).optional().describe('预定义宏'),
    cflags: z.array(z.string()).optional().describe('其他编译选项'),
    std: z.enum(['c89', 'c99', 'c11']).optional().describe('C 标准，默认 c99；部门规定 C89 的项目填 c89'),
    target: z.enum(['sparc', 'd2000', 'host']).optional().describe('目标平台，默认 host'),
  },
}, hotHandler(tools, 'compileCheck'))

server.registerTool('coverage_detail', {
  description: '显示上次 run_unit_tests 中未覆盖的语句、未全覆盖的分支和 MC/DC 条件所在的源码行，用于补充用例。',
  inputSchema: {
    name: z.string().optional().describe('测试名（与 run_unit_tests 的 name 相同）；只有一次运行记录时可省略'),
    file: z.string().optional().describe('只看某个被测文件'),
    function: z.string().optional().describe('只看某个函数'),
    context: z.number().int().min(0).max(5).optional().describe('每处显示的上下文行数，默认 1'),
  },
}, hotHandler(tools, 'coverageDetail'))

server.registerTool('check_mcdc', {
  description:
    '核对一个判定的 MC/DC 分析表：给出判定表达式（用条件名表示，如 "(A && B) || C"）和测试向量（按条件顺序写 T/F/X，X 表示因短路未求值），' +
    '检查每个条件是否有独立影响对（短路求值下的唯一原因 MC/DC），并为未满足的条件建议补充向量。',
  inputSchema: {
    decision: z.string().describe('判定表达式，只用条件名、&&、||、!、括号。条件名与代码中的条件对应关系写在用例表里'),
    vectors: z.array(z.object({
      id: z.string().describe('用例标识'),
      values: z.string().describe('按条件出现顺序的取值，如 "TTF"、"FXT"'),
      expected: z.boolean().optional().describe('设计时预期的判定结果，填写后会核对'),
    })).min(1),
  },
}, hotHandler(tools, 'checkMcdcTool'))

await server.connect(new StdioServerTransport())
