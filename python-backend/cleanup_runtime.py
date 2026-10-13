#!/usr/bin/env python3
"""Delete expired Seshat job directories and uploaded working files."""

import os
import shutil
import time
from pathlib import Path


def cleanup(data_dir: Path, ttl_seconds: int) -> tuple[int, int]:
    cutoff = time.time() - ttl_seconds
    removed_jobs = 0
    removed_uploads = 0

    jobs_dir = data_dir / "static" / "jobs"
    if jobs_dir.is_dir():
        for entry in jobs_dir.iterdir():
            try:
                if entry.is_dir() and entry.stat().st_mtime < cutoff:
                    shutil.rmtree(entry)
                    removed_jobs += 1
            except FileNotFoundError:
                continue

    uploads_dir = data_dir / "uploads"
    if uploads_dir.is_dir():
        for entry in uploads_dir.iterdir():
            try:
                if entry.is_file() and entry.stat().st_mtime < cutoff:
                    entry.unlink()
                    removed_uploads += 1
            except FileNotFoundError:
                continue

    return removed_jobs, removed_uploads


if __name__ == "__main__":
    runtime_dir = Path(os.getenv("SESHAT_DATA_DIR", Path(__file__).resolve().parent))
    ttl = int(os.getenv("SESHAT_JOB_TTL_SECONDS", str(6 * 60 * 60)))
    jobs, uploads = cleanup(runtime_dir, ttl)
    print(f"Removed {jobs} expired job directories and {uploads} uploaded files")
