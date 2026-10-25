# D2000 Linux 代码的 gtest 测试

D2000 上运行操作系统的应用代码用 GoogleTest。用例设计方法、桩、报告格式与手写驱动相同，只是驱动写成 gtest 的形式。

## 1 环境

- 需要 C++ 编译器和与之配套编译的 gtest 库。用 MSYS2 时：`pacman -S mingw-w64-ucrt-x86_64-gtest`，安装后头文件和库在 `C:\msys64\ucrt64` 下，`UTEST_GTEST_ROOT` 可以不设（编译器默认能找到）。
- 自己编译的 gtest，把 `UTEST_GTEST_ROOT` 设为安装目录（含 `include/gtest/` 和 `lib/libgtest.a`、`lib/libgtest_main.a`）。
- gtest 库必须与 `UTEST_CXX` 是同一个编译器编译的，否则链接失败。
- 调用 `run_unit_tests` 时加 `framework: "gtest"`，测试文件用 `.cpp`。链接 `gtest_main`，测试文件中不写 `main`。

## 2 写法

```cpp
extern "C" {
#include "cmd_check.h"      // 被测代码是 C，头文件要放在 extern "C" 中（头文件自己有保护时可省略）
}
#include <gtest/gtest.h>

class UT_CMD : public ::testing::Test {
protected:
    void SetUp() override { cmd_counter_reset(); stub_uart_reset(); }   // 每个用例开头设置初始状态
};

// 用例 UT-CMD-PAR-002：温度门限上边界 1000 合法（设计 3.3）
TEST_F(UT_CMD, PAR_002) {
    EXPECT_EQ(CMD_OK, check_frame(0x0201u, 1000u));
}
```

- 用例名：测试套件名 `UT_<模块简称>`，用例名 `<函数简称>_<序号>`，报告中写成 `UT-<模块简称>-<函数简称>-<序号>`。检查脚本会把 `UT_CMD.PAR_002` 对应到 `UT-CMD-PAR-002`。
- 用例说明写在 `TEST` 上一行的注释中。
- 用 `EXPECT_*`，不用 `ASSERT_*`，一个检查失败后其余检查照常执行；只有后续检查依赖前一步结果时（如指针非空）才用 `ASSERT_*`。
- 预期值写常量，不调用被测函数计算。
- 不用 `DISABLED_` 前缀或 `GTEST_SKIP()` 跳过失败的用例。

## 3 与目标机的差异

- D2000 是 ARMv8，`char` 无符号，主机 x86 上 `char` 有符号：编译选项加 `-funsigned-char`。
- 主机是 Windows 时，`long` 是 32 位，D2000 Linux 上是 64 位；被测代码用到 `long`、`size_t` 做数据长度或位运算时，在报告中列入目标机验证项。
- 依赖 Linux 系统调用（线程、信号、设备文件、`ioctl`）的代码，在 Windows 主机上不能编译，给这些调用写桩，或在 D2000 本机上用同一套测试编译运行。
- 多线程、定时、实时性相关的行为不能由单元测试证明，列入目标机验证项。

## 4 本工具对 gtest 的支持程度

utest 服务按 gtest 的标准输出（`[ RUN      ]`、`[       OK ]`、`[  FAILED  ]`）统计用例结果。gtest 支持尚未在部门环境中实测，第一次使用时请核对工具统计的用例数与 gtest 自己输出的统计是否一致，不一致时告诉维护人员。
