#include <iostream>
#include "mylib.h"

int main() {
    // 正常调用
    std::cout << mylib::get_greeting("World") << std::endl;
    std::cout << "5! = " << mylib::factorial(5) << std::endl;
    
    // 以下代码包含错误，用于测试 LSP 诊断
    int x = "hello";  // 类型错误
    
    undefined_function();  // 未定义函数
    
    mylib::nonexistent_func();  // 不存在的成员
    
    return 0;
}
