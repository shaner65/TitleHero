import os
import glob
import concurrent.futures
import pymysql
from datetime import datetime
from tqdm import tqdm

WORKERS = 32
BASE_DIR = ''
DB_CONFIG = {
    'host': '',
    'user': '',
    'password': '',
    'database': ''
}

def ensure_abstract_exists(cursor, abstract_code):
    if not abstract_code or abstract_code.strip() == '':
        return None
    cursor.execute("SELECT abstractCode FROM Abstract WHERE abstractCode = %s", (abstract_code,))
    result = cursor.fetchone()
    if not result:
        return None
    return abstract_code

def process_prime_chunk(records, headers):
    db = pymysql.connect(**DB_CONFIG)
    cursor = db.cursor()

    for record in tqdm(records, desc="Prime chunk records", leave=False):
        if not record.strip():
            continue

        fields = record.rstrip('\n').split('\t')
        data = dict(zip(headers, fields))

        file_stamp = data.get('Instrument_Date')
        file_stamp_date = None
        if file_stamp and file_stamp.strip():
            try:
                file_stamp_date = datetime.strptime(file_stamp.split()[0], '%Y-%m-%d')
            except:
                pass

        filing_date_str = data.get('Filing_Date')
        filing_date = None
        if filing_date_str and filing_date_str.strip():
            try:
                filing_date = datetime.strptime(filing_date_str.split()[0], '%Y-%m-%d')
            except:
                pass

        acres_val = data.get('Acres')
        acres = float(acres_val) if acres_val and acres_val.strip() else None

        gfn_val = data.get('GF_Number')
        gfn = int(gfn_val) if gfn_val and gfn_val.strip() else None

        abstract_code = data.get('Abstract')
        if abstract_code:
            ensure_abstract_exists(cursor, abstract_code)

        try:
            cursor.execute("""
                INSERT INTO Document
                (PRSERV, book, page, clerkNumber, instrumentType, acres, abstractCode, subBlock,
                legalDescription, instrumentDate, filingDate, remarks, GFNNumber)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """, (
                data.get('PRSERV'),
                data.get('Book'),
                data.get('Page'),
                data.get('Clerk_Number'),
                data.get('Instrument_Type'),
                acres,
                abstract_code,
                data.get('Sub_Block_Lot'),
                data.get('Brief_Legal'),
                file_stamp_date,
                filing_date,
                data.get('Remarks'),
                gfn,
            ))
            db.commit()
        except Exception as e:
            print(f"Error inserting record with PRSERV={data.get('PRSERV')}: {e}")


    cursor.close()
    db.close()

def process_multi_chunk(records, headers):
    db = pymysql.connect(**DB_CONFIG)
    cursor = db.cursor()

    for record in tqdm(records, desc="Multi chunk records", leave=False):
        if not record.strip():
            continue
        fields = record.strip().split('\t')
        data = dict(zip(headers, fields))

        prserv = data.get('PRSERV')
        grantor = data.get('Grantor')
        grantee = data.get('Grantee')

        # Find documentID using PRSERV
        document_id = None
        if prserv:
            cursor.execute("SELECT documentID FROM Document WHERE PRSERV = %s LIMIT 1", (prserv,))
            result = cursor.fetchone()
            if result:
                document_id = result[0]

        if document_id:
            if grantor and grantor.strip():
                cursor.execute("""
                    INSERT INTO Party (documentID, name, role)
                    VALUES (%s, %s, 'Grantor')
                """, (document_id, grantor.strip()))

            if grantee and grantee.strip():
                cursor.execute("""
                    INSERT INTO Party (documentID, name, role)
                    VALUES (%s, %s, 'Grantee')
                """, (document_id, grantee.strip()))
            db.commit()
        else:
            print(f"Warning: No Document found with PRSERV={prserv} for Party insertion")

    cursor.close()
    db.close()

def process_file_multithreaded(file_path, process_chunk_func, num_threads=4):
    with open(file_path, 'r', encoding='utf-8') as f:
        content = f.read()


    records = [r.lstrip('\n') for r in content.split('{EOR}') if r.strip()]
    if not records:
        return
    
    # Extract header once
    header_line = records[0]
    headers = header_line.strip('\n').split('\t')

    # Data records exclude header
    data_records = records[1:]

    chunk_size = len(data_records) // num_threads
    chunks = [data_records[i*chunk_size:(i+1)*chunk_size] for i in range(num_threads)]
    if len(data_records) % num_threads != 0:
        chunks[-1].extend(data_records[num_threads*chunk_size:])

    with tqdm(total=num_threads, desc=f"Processing {os.path.basename(file_path)} chunks") as pbar:
        def wrapped_func(chunk):
            process_chunk_func(chunk, headers)
            pbar.update(1)

        with concurrent.futures.ThreadPoolExecutor(max_workers=num_threads) as executor:
            executor.map(wrapped_func, chunks)

def find_all_blu_file_pairs(base_dir):
    wastp_folders = glob.glob(os.path.join(base_dir, 'WASTP*'))
    file_pairs = []

    for folder in wastp_folders:
        blu_path = os.path.join(folder, 'BLU')
        if os.path.isdir(blu_path):
            prime_file = os.path.join(blu_path, 'WASTP_prime.txt')
            multi_file = os.path.join(blu_path, 'WASTP_multi.txt')
            if os.path.isfile(prime_file) and os.path.isfile(multi_file):
                file_pairs.append((prime_file, multi_file))
        else:
            print(f"No BLU folder in {folder}")

    return file_pairs

def main():
    file_pairs = find_all_blu_file_pairs(BASE_DIR)
    print(f"Found {len(file_pairs)} WASTP folders with prime & multi files.")

    # First: Process ALL prime files (Documents)
    with tqdm(total=len(file_pairs), desc="Processing all prime files") as prime_pbar:
        def process_prime_wrapper(pair):
            prime_path, _ = pair
            process_file_multithreaded(prime_path, process_prime_chunk, WORKERS)
            prime_pbar.update(1)

        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
            futures = [executor.submit(process_prime_wrapper, pair) for pair in file_pairs]
            for future in concurrent.futures.as_completed(futures):
                try:
                    future.result()
                except Exception as e:
                    print(f"Error occurred processing prime files: {e}")

    # Then: Process ALL multi files (Parties)
    with tqdm(total=len(file_pairs), desc="Processing all multi files") as multi_pbar:
        def process_multi_wrapper(pair):
            _, multi_path = pair
            process_file_multithreaded(multi_path, process_multi_chunk, WORKERS)
            multi_pbar.update(1)

        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
            futures = [executor.submit(process_multi_wrapper, pair) for pair in file_pairs]
            for future in concurrent.futures.as_completed(futures):
                try:
                    future.result()
                except Exception as e:
                    print(f"Error occurred processing multi files: {e}")

if __name__ == '__main__':
    main()
