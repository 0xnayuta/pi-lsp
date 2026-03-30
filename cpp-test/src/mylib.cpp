#include "mylib.h"
#include <sstream>

namespace mylib {

int factorial(int n) {
    if (n <= 1) return 1;
    return n * factorial(n - 1);
}

std::string get_greeting(const std::string& name) {
    std::ostringstream oss;
    oss << "Hello, " << name << "!";
    return oss.str();
}

} // namespace mylib
