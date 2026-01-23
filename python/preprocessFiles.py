import os
import glob
import re
from tqdm import tqdm

BASE_DIR = ''
FOLDER_PATTERN = 'BLURC'

TARGET_DIR = ''
PRIME_TARGET = os.path.join(TARGET_DIR, 'prime')
MULTI_TARGET = os.path.join(TARGET_DIR, 'multi')

os.makedirs(PRIME_TARGET, exist_ok=True)
os.makedirs(MULTI_TARGET, exist_ok=True)

def extract_folder_name(path):
    # Split path parts
    parts = path.split(os.sep)

    for part in parts:
        if part.startswith(FOLDER_PATTERN):
            return part
    return None

def find_blu_file_pairs(base_dir):
    folders = glob.glob(os.path.join(base_dir, f'{FOLDER_PATTERN}*'))
    file_pairs = []
    for folder in folders:
        blu_path = os.path.join(folder, 'BLU')
        if os.path.isdir(blu_path):
            prime_file = os.path.join(blu_path, f'{FOLDER_PATTERN}_prime.txt')
            multi_file = os.path.join(blu_path, f'{FOLDER_PATTERN}_multi.txt')
            if os.path.isfile(prime_file) and os.path.isfile(multi_file):
                file_pairs.append((prime_file, multi_file))
        else:
            print(f"No BLU folder in {folder}")
    return file_pairs

def preprocess_and_save(file_path, output_dir):
    with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
        content = f.read()

    fixed_content = content.replace('{EOR}', '').strip()

    folder_name = extract_folder_name(file_path) or 'unknown'

    base_name = os.path.basename(file_path)

    new_base_name = base_name.replace(FOLDER_PATTERN, folder_name).replace('.txt', '_fixed')
    new_file_name = f"{new_base_name}.txt"

    output_path = os.path.join(output_dir, new_file_name)

    with open(output_path, 'w', encoding='utf-8') as f:
        f.write(fixed_content)

    return output_path

def main():
    pairs = find_blu_file_pairs(BASE_DIR)
    if not pairs:
        print("No file pairs found.")
        return

    for prime_file, multi_file in tqdm(pairs, desc=f"Processing files"):
        preprocess_and_save(prime_file, PRIME_TARGET)
        preprocess_and_save(multi_file, MULTI_TARGET)

if __name__ == '__main__':
    main()
