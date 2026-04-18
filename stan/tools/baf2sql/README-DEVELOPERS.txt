
Dynamically linked libraries compiled for Windows (32-bit and 64-bit), and Linux (64-bit)
are contained in this archive.

To use the Windows libraries successfully, you need to have the "Visual C++
Redistributable for Visual Studio 2017" installed on your system.

* src/schema.h - documentation of the database schema.

* src/c/baf2sql_c.h - definition and documentation of the C API.

* src/cpp/baf2sql_cpp.h - light-weight C++03 wrapper around the C API.

* src/cpp/bafscan.cpp - a C++ example program demonstrating the use of the C++ wrapper.

* src/cs/cs_example.cs - a C# example program demonstrating the use of the C API.

* src/py/baf2sql.py - Python wrapper around the C DLL.

* src/py/baf2sql_example.py - a Python example program.

The C++ example program "bafscan" is also provided in compiled form in this archive, for
quickly checking that the libraries work as intended on the developer's machine. You can
call the program with the full path name of an "analysis.baf" file; it will print some
basic information about its contents.

The file "redist.txt" contains a list of files that may be distributed together with
software using Baf2Sql. It also lists files that must be distributed in such cases.

Further documentation on specific fields in the database is provided upon request.

