"""Sous Windows, rend visibles les DLL CUDA installées par pip (nvidia-cublas-cu12,
nvidia-cudnn-cu12) avant le chargement de CTranslate2."""

from __future__ import annotations

import os
import sys
from pathlib import Path

_done = False


def register() -> list[str]:
    global _done
    if _done or sys.platform != "win32":
        return []
    _done = True
    added: list[str] = []
    try:
        import nvidia  # type: ignore[import-not-found]
    except ImportError:
        return added
    for base in getattr(nvidia, "__path__", []):
        for bin_dir in Path(base).glob("*/bin"):
            if any(bin_dir.glob("*.dll")):
                os.add_dll_directory(str(bin_dir))
                os.environ["PATH"] = str(bin_dir) + os.pathsep + os.environ.get("PATH", "")
                added.append(str(bin_dir))
    return added
