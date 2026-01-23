import os
from glob import glob

PRIME_DIR = ''
MULTI_DIR = ''

def count_lines_in_files(file_paths):
    total_lines = 0
    for file_path in file_paths:
        with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
            line_count = sum(1 for _ in f)-1
        print(f"{file_path}: {line_count} lines")
        total_lines += line_count
    return total_lines

def main():
    prime_files = glob(os.path.join(PRIME_DIR, '*_fixed.txt'))
    multi_files = glob(os.path.join(MULTI_DIR, '*_fixed.txt'))

    print(f"Found {len(prime_files)} prime files.")
    total_prime = count_lines_in_files(prime_files)
    print(f"Total lines in prime files: {total_prime}")

    print(f"\nFound {len(multi_files)} multi files.")
    total_multi = count_lines_in_files(multi_files)
    print(f"Total lines in multi files: {total_multi}")


    print(f"\n Prime rows: {total_prime}")
    print(f"\n Multi rows: {total_multi}")

if __name__ == "__main__":
    main()
