"""The nightly job: build the site, then the index, then check the links."""
import subprocess
import sys


def main():
    subprocess.run([sys.executable, "ops/build_site.py"], check=True)
    subprocess.run([sys.executable, "ops/build_index.py"], check=True)
    subprocess.run([sys.executable, "ops/check_links.py"], check=True)


if __name__ == "__main__":
    main()
