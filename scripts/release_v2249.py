"""MotionBench 2.24.9 release identity; behavior lives in the shared verifier."""
from pathlib import Path
from release_display import main

if __name__ == "__main__":
    main(Path(__file__).with_name("release-v2249.json"))
