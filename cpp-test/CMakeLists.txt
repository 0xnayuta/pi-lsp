cmake_minimum_required(VERSION 3.10)
project(lsp_test)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

add_executable(main src/main.cpp)
add_library(mylib src/mylib.cpp include/mylib.h)

target_include_directories(mylib PUBLIC include)
target_link_libraries(main PRIVATE mylib)
