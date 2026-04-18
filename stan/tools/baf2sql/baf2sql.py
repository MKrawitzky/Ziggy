# -*- coding: utf-8 -*-
"""Python wrapper for baf2sql_c.dll

"""

import sys
import os
import numpy as np
from ctypes import *
from pathlib import Path

# Prefer the bundled DLL in libs/ next to this file, fall back to system PATH.
_libs_dir = Path(__file__).parent / "libs"
if sys.platform.startswith("win"):
    _libname = "baf2sql_c.dll"
else:
    _libname = "libbaf2sql_c.so"
_bundled = _libs_dir / _libname
dll = cdll.LoadLibrary(str(_bundled) if _bundled.exists() else _libname)
dll.baf2sql_get_sqlite_cache_filename_v2.argtypes = [ c_char_p, c_uint32, c_char_p, c_int ]
dll.baf2sql_get_sqlite_cache_filename_v2.restype = c_uint32
dll.baf2sql_array_open_storage.argtypes = [ c_int, c_char_p ]
dll.baf2sql_array_open_storage.restype = c_uint64
dll.baf2sql_array_close_storage.argtypes = [ c_uint64 ]
dll.baf2sql_array_close_storage.restype = None
dll.baf2sql_get_last_error_string.argtypes = [ c_char_p, c_uint32 ]
dll.baf2sql_get_last_error_string.restype = c_uint32
dll.baf2sql_array_get_num_elements.argtypes = [ c_uint64, c_uint64, POINTER(c_uint64) ]
dll.baf2sql_array_get_num_elements.restype = c_int
dll.baf2sql_array_read_double.argtypes = [ c_uint64, c_uint64, POINTER(c_double) ]
dll.baf2sql_array_read_double.restype = c_int

def throwLastBaf2SqlError (dll_handle):
    """Throw last Baf2Sql error string as an exception."""

    len = dll_handle.baf2sql_get_last_error_string(None, 0)
    buf = create_string_buffer(len)
    dll_handle.baf2sql_get_last_error_string(buf, len)
    raise RuntimeError(buf.value)

# The Baf2Sql DLL expects all strings in UTF-8 encoding.
def toUtf8 (baf_filename):
    if sys.version_info.major == 2:
        if not isinstance(baf_filename, unicode):
            # try to convert in order to maintain compatibility with existing code; will
            # raise a UnicodeDecodeError if it doesn't work.
            baf_filename = unicode(baf_filename, 'ascii')
    if sys.version_info.major == 3:
        if not isinstance(baf_filename, str):
            raise ValueError("analysis_directory must be a string.")
    return baf_filename.encode('utf-8')

def getSQLiteCacheFilename (baf_filename, all_variables=False):
    """Find out the file name of the SQLite cache corresponding to the specified BAF file.
    (If the SQLite cache doesn't exist yet, it will be created.

    """

    u8path = toUtf8(baf_filename)

    len = dll.baf2sql_get_sqlite_cache_filename_v2(None, 0, u8path, all_variables)
    if len == 0:
        throwLastBaf2SqlError(dll)

    buf = create_string_buffer(len)
    dll.baf2sql_get_sqlite_cache_filename_v2(buf, len, u8path, all_variables)
    return buf.value

class BinaryStorage:

    def __init__ (self, baf_filename, raw_calibration=False):

        # Copy reference to DLL object so this instance works properly
        # even if the module is reloaded in an interactive session.
        self.dll = dll

        self.handle = self.dll.baf2sql_array_open_storage(
            1 if raw_calibration else 0,
            toUtf8(baf_filename))
        if self.handle == 0:
            throwLastBaf2SqlError(self.dll)

    def __del__ (self):
        self.dll.baf2sql_array_close_storage(self.handle)

    def getArrayNumElements (self, id):
        """Returns number of elements in array with specified ID."""
        n = c_uint64(0)
        if not self.dll.baf2sql_array_get_num_elements(self.handle, id, n):
            throwLastBaf2SqlError(self.dll)
        return n.value

    def readArrayDouble (self, id):
        """Returns the requested array as a double np.array."""
        buf = np.empty(shape=self.getArrayNumElements(id), dtype=np.float64)
        if not self.dll.baf2sql_array_read_double(self.handle, id, buf.ctypes.data_as(POINTER(c_double))):
            throwLastBaf2SqlError(self.dll)
        return buf
